/**
 * Rule DSL lexer and parser (docs/v3/05 §3, pilot WP-A). Pure.
 *
 * Grammar, lowest precedence first:
 *
 *   or     := and ('or' and)*
 *   and    := not ('and' not)*
 *   not    := 'not' not | cmp
 *   cmp    := add (('<' | '<=' | '>' | '>=' | '==' | '!=') add)*
 *   add    := mul (('+' | '-') mul)*
 *   mul    := unary (('*' | '/') unary)*
 *   unary  := '-' unary | '+' unary | pow
 *   pow    := primary ('^' unary)?          right-associative; `2^-1` is allowed
 *   primary:= number | string | ident | ident '(' args ')' | '(' or ')'
 *
 * So `-2^2` is -(2^2) and `not a < b` is not (a < b), as in the spec.
 * Strings are double-quoted with no escapes; the checker only allows them as
 * arguments of lookup() and convert(). There are no unit literals: a quantity
 * with a unit comes from an input or a param.
 */

export type CompareOp = '<' | '<=' | '>' | '>=' | '==' | '!='
export type BinaryOp = '+' | '-' | '*' | '/' | '^' | CompareOp | 'and' | 'or'

interface NodeBase {
  /** 1-based column of the token that starts the node, for error messages. */
  pos: number
  /** The author wrapped this node in parentheses; kept so traces print them back. */
  paren?: boolean
}

export type Expr =
  | (NodeBase & { kind: 'num'; value: number; text: string })
  | (NodeBase & { kind: 'str'; value: string })
  | (NodeBase & { kind: 'ident'; name: string })
  | (NodeBase & { kind: 'unary'; op: '-' | 'not'; arg: Expr })
  | (NodeBase & { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr })
  | (NodeBase & { kind: 'call'; name: string; args: Expr[] })

export class DslSyntaxError extends Error {
  readonly column: number
  constructor(message: string, column: number) {
    super(message)
    this.name = 'DslSyntaxError'
    this.column = column
  }
}

type TokenKind = 'num' | 'str' | 'ident' | 'op' | 'eof'
interface Token {
  kind: TokenKind
  text: string
  pos: number
}

export const KEYWORDS = new Set(['and', 'or', 'not'])
export const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

const NUMBER_RE = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*/
const TWO_CHAR_OPS = new Set(['<=', '>=', '==', '!='])
const ONE_CHAR_OPS = new Set(['+', '-', '*', '/', '^', '(', ')', ',', '<', '>'])
const COMPARE_OPS = new Set<string>(['<', '<=', '>', '>=', '==', '!='])

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let index = 0
  while (index < source.length) {
    const char = source[index]
    if (/\s/.test(char)) {
      index += 1
      continue
    }
    const rest = source.slice(index)
    const pos = index + 1
    const number = NUMBER_RE.exec(rest)
    if (number) {
      tokens.push({ kind: 'num', text: number[0], pos })
      index += number[0].length
      continue
    }
    const ident = IDENT_RE.exec(rest)
    if (ident) {
      tokens.push({ kind: 'ident', text: ident[0], pos })
      index += ident[0].length
      continue
    }
    if (char === '"') {
      const end = source.indexOf('"', index + 1)
      if (end < 0) throw new DslSyntaxError('unterminated string (missing closing ")', pos)
      tokens.push({ kind: 'str', text: source.slice(index + 1, end), pos })
      index = end + 1
      continue
    }
    const two = source.slice(index, index + 2)
    if (TWO_CHAR_OPS.has(two)) {
      tokens.push({ kind: 'op', text: two, pos })
      index += 2
      continue
    }
    if (ONE_CHAR_OPS.has(char)) {
      tokens.push({ kind: 'op', text: char, pos })
      index += 1
      continue
    }
    const hint = char === '=' ? ' (use == to compare)' : char === '&' || char === '|' ? ' (use and / or)' : ''
    throw new DslSyntaxError(`unexpected character '${char}'${hint}`, pos)
  }
  tokens.push({ kind: 'eof', text: '', pos: source.length + 1 })
  return tokens
}

class Parser {
  private index = 0
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.index]
  }

  private next(): Token {
    const token = this.tokens[this.index]
    if (token.kind !== 'eof') this.index += 1
    return token
  }

  private isOp(text: string): boolean {
    const token = this.peek()
    return token.kind === 'op' && token.text === text
  }

  private isKeyword(word: string): boolean {
    const token = this.peek()
    return token.kind === 'ident' && token.text === word
  }

  private expectOp(text: string): Token {
    const token = this.peek()
    if (token.kind === 'op' && token.text === text) return this.next()
    throw new DslSyntaxError(`expected '${text}' but found ${describe(token)}`, token.pos)
  }

  parseAll(): Expr {
    if (this.peek().kind === 'eof') throw new DslSyntaxError('empty expression', 1)
    const expr = this.parseOr()
    const token = this.peek()
    if (token.kind !== 'eof') {
      const unitHint = token.kind === 'ident' && expr.kind === 'num'
        ? '; unit literals such as "150 MB/s" are not supported, use an input or param with that unit'
        : ''
      throw new DslSyntaxError(`unexpected ${describe(token)}${unitHint}`, token.pos)
    }
    return expr
  }

  private parseOr(): Expr {
    let left = this.parseAnd()
    while (this.isKeyword('or')) {
      const pos = this.next().pos
      left = { kind: 'binary', op: 'or', left, right: this.parseAnd(), pos }
    }
    return left
  }

  private parseAnd(): Expr {
    let left = this.parseNot()
    while (this.isKeyword('and')) {
      const pos = this.next().pos
      left = { kind: 'binary', op: 'and', left, right: this.parseNot(), pos }
    }
    return left
  }

  private parseNot(): Expr {
    if (this.isKeyword('not')) {
      const pos = this.next().pos
      return { kind: 'unary', op: 'not', arg: this.parseNot(), pos }
    }
    return this.parseComparison()
  }

  private parseComparison(): Expr {
    let left = this.parseAdditive()
    while (this.peek().kind === 'op' && COMPARE_OPS.has(this.peek().text)) {
      const token = this.next()
      left = { kind: 'binary', op: token.text as CompareOp, left, right: this.parseAdditive(), pos: token.pos }
    }
    return left
  }

  private parseAdditive(): Expr {
    let left = this.parseMultiplicative()
    while (this.isOp('+') || this.isOp('-')) {
      const token = this.next()
      left = { kind: 'binary', op: token.text as '+' | '-', left, right: this.parseMultiplicative(), pos: token.pos }
    }
    return left
  }

  private parseMultiplicative(): Expr {
    let left = this.parseUnary()
    while (this.isOp('*') || this.isOp('/')) {
      const token = this.next()
      left = { kind: 'binary', op: token.text as '*' | '/', left, right: this.parseUnary(), pos: token.pos }
    }
    return left
  }

  private parseUnary(): Expr {
    if (this.isOp('-')) {
      const pos = this.next().pos
      return { kind: 'unary', op: '-', arg: this.parseUnary(), pos }
    }
    if (this.isOp('+')) {
      this.next()
      return this.parseUnary()
    }
    return this.parsePower()
  }

  private parsePower(): Expr {
    const base = this.parsePrimary()
    if (this.isOp('^')) {
      const pos = this.next().pos
      return { kind: 'binary', op: '^', left: base, right: this.parseUnary(), pos }
    }
    return base
  }

  private parsePrimary(): Expr {
    const token = this.peek()
    if (token.kind === 'num') {
      this.next()
      return { kind: 'num', value: Number(token.text), text: token.text, pos: token.pos }
    }
    if (token.kind === 'str') {
      this.next()
      return { kind: 'str', value: token.text, pos: token.pos }
    }
    if (token.kind === 'ident') {
      if (KEYWORDS.has(token.text)) throw new DslSyntaxError(`unexpected keyword '${token.text}'`, token.pos)
      this.next()
      if (this.isOp('(')) {
        this.next()
        const args: Expr[] = []
        if (!this.isOp(')')) {
          args.push(this.parseOr())
          while (this.isOp(',')) {
            this.next()
            args.push(this.parseOr())
          }
        }
        this.expectOp(')')
        return { kind: 'call', name: token.text.toLowerCase(), args, pos: token.pos }
      }
      return { kind: 'ident', name: token.text, pos: token.pos }
    }
    if (token.kind === 'op' && token.text === '(') {
      this.next()
      const inner = this.parseOr()
      this.expectOp(')')
      return { ...inner, paren: true }
    }
    throw new DslSyntaxError(token.kind === 'eof' ? 'unexpected end of formula' : `unexpected ${describe(token)}`, token.pos)
  }
}

function describe(token: Token): string {
  if (token.kind === 'eof') return 'end of formula'
  if (token.kind === 'str') return `string "${token.text}"`
  return `'${token.text}'`
}

/** Parse one formula or condition. Throws `DslSyntaxError` with a 1-based column. */
export function parseFormula(source: string): Expr {
  return new Parser(tokenize(source)).parseAll()
}

/** Every identifier read by an expression, in source order, without duplicates. Lookup table names are excluded. */
export function referencedNames(expr: Expr): string[] {
  const seen: string[] = []
  const visit = (node: Expr) => {
    switch (node.kind) {
      case 'ident':
        if (!seen.includes(node.name)) seen.push(node.name)
        return
      case 'unary':
        visit(node.arg)
        return
      case 'binary':
        visit(node.left)
        visit(node.right)
        return
      case 'call':
        node.args.forEach((arg, index) => {
          if (node.name === 'lookup' && index === 0) return
          visit(arg)
        })
        return
      default:
        return
    }
  }
  visit(expr)
  return seen
}

const OP_TEXT: Record<BinaryOp, string> = {
  '+': ' + ', '-': ' - ', '*': ' × ', '/': ' / ', '^': '^',
  '<': ' < ', '<=': ' <= ', '>': ' > ', '>=': ' >= ', '==': ' == ', '!=': ' != ',
  and: ' and ', or: ' or ',
}

/**
 * Print an expression back. `leaf` may replace any node's text (the trace
 * substitutes identifier values through it); returning undefined falls back
 * to the default printing. Parentheses come from the source, not from
 * precedence, so the author's grouping is preserved.
 */
export function printExpr(expr: Expr, leaf?: (node: Expr) => string | undefined): string {
  const replaced = leaf?.(expr)
  let text: string
  if (replaced !== undefined) text = replaced
  else {
    switch (expr.kind) {
      case 'num':
        text = expr.text
        break
      case 'str':
        text = `"${expr.value}"`
        break
      case 'ident':
        text = expr.name
        break
      case 'unary':
        text = expr.op === '-' ? `-${printExpr(expr.arg, leaf)}` : `not ${printExpr(expr.arg, leaf)}`
        break
      case 'binary':
        text = `${printExpr(expr.left, leaf)}${OP_TEXT[expr.op]}${printExpr(expr.right, leaf)}`
        break
      case 'call':
        text = `${expr.name}(${expr.args.map((arg) => printExpr(arg, leaf)).join(', ')})`
        break
    }
  }
  return expr.paren ? `(${text})` : text
}

/**
 * Rule DSL -> Excel formula back-translation (WP-A2), used on export for
 * excel-mode content that has no original Excel text: warning conditions
 * (the contract keeps only the DSL) and calc steps typed in the rule editor.
 *
 * Covers the DSL subset the importer emits plus plain arithmetic. Unit
 * literals ("3 day"), convert(), catalog() and switch() have no Excel
 * equivalent: the function returns null and the exporter keeps the DSL text
 * in the dsl_* column instead.
 */
import { formatNumber } from './dsl'

type DTok =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }
  | { t: 'eof' }

type Ast =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'id'; name: string }
  | { k: 'neg'; a: Ast }
  | { k: 'not'; a: Ast }
  | { k: 'bin'; op: string; l: Ast; r: Ast }
  | { k: 'call'; fn: string; args: Ast[] }

class DslParseError extends Error {}

function lex(src: string): DTok[] {
  const toks: DTok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    const num = /^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i))
    if (num) {
      toks.push({ t: 'num', v: Number(num[0]) })
      i += num[0].length
      continue
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))
    if (id) {
      toks.push({ t: 'id', v: id[0] })
      i += id[0].length
      continue
    }
    if (c === '"') {
      const end = src.indexOf('"', i + 1)
      if (end < 0) throw new DslParseError('unterminated string')
      toks.push({ t: 'str', v: src.slice(i + 1, end) })
      i = end + 1
      continue
    }
    const two = src.slice(i, i + 2)
    if (['<=', '>=', '==', '!='].includes(two)) {
      toks.push({ t: 'op', v: two })
      i += 2
      continue
    }
    if ('+-*/^<>(),'.includes(c)) {
      toks.push({ t: 'op', v: c })
      i++
      continue
    }
    throw new DslParseError(`unexpected ${c}`)
  }
  toks.push({ t: 'eof' })
  return toks
}

function parse(src: string): Ast {
  const toks = lex(src)
  let p = 0
  const peek = () => toks[p]
  const isOp = (v: string) => {
    const t = toks[p]
    return t.t === 'op' && t.v === v
  }
  const isKw = (v: string) => {
    const t = toks[p]
    return t.t === 'id' && t.v === v
  }
  const expect = (v: string) => {
    if (!isOp(v)) throw new DslParseError(`expected ${v}`)
    p++
  }
  const parseOr = (): Ast => {
    let l = parseAnd()
    while (isKw('or')) {
      p++
      l = { k: 'bin', op: 'or', l, r: parseAnd() }
    }
    return l
  }
  const parseAnd = (): Ast => {
    let l = parseNot()
    while (isKw('and')) {
      p++
      l = { k: 'bin', op: 'and', l, r: parseNot() }
    }
    return l
  }
  const parseNot = (): Ast => {
    if (isKw('not')) {
      p++
      return { k: 'not', a: parseNot() }
    }
    return parseCmp()
  }
  const parseCmp = (): Ast => {
    const l = parseAdd()
    const t = peek()
    if (t.t === 'op' && ['<', '<=', '>', '>=', '==', '!='].includes(t.v)) {
      p++
      return { k: 'bin', op: t.v, l, r: parseAdd() }
    }
    return l
  }
  const parseAdd = (): Ast => {
    let l = parseMul()
    while (isOp('+') || isOp('-')) {
      const op = (toks[p++] as { v: string }).v
      l = { k: 'bin', op, l, r: parseMul() }
    }
    return l
  }
  const parseMul = (): Ast => {
    let l = parseUnary()
    while (isOp('*') || isOp('/')) {
      const op = (toks[p++] as { v: string }).v
      l = { k: 'bin', op, l, r: parseUnary() }
    }
    return l
  }
  const parseUnary = (): Ast => {
    if (isOp('-')) {
      p++
      return { k: 'neg', a: parseUnary() }
    }
    return parsePow()
  }
  const parsePow = (): Ast => {
    const base = parsePrimary()
    if (isOp('^')) {
      p++
      return { k: 'bin', op: '^', l: base, r: parseUnary() }
    }
    return base
  }
  const parsePrimary = (): Ast => {
    const t = toks[p++]
    if (t.t === 'num') {
      if (peek().t === 'id' || peek().t === 'str') throw new DslParseError('unit literal')
      return { k: 'num', v: t.v }
    }
    if (t.t === 'str') return { k: 'str', v: t.v }
    if (t.t === 'id') {
      if (['and', 'or', 'not'].includes(t.v)) throw new DslParseError('keyword')
      if (isOp('(')) {
        p++
        const args: Ast[] = []
        if (!isOp(')')) {
          for (;;) {
            args.push(parseOr())
            if (isOp(',')) {
              p++
              continue
            }
            break
          }
        }
        expect(')')
        return { k: 'call', fn: t.v, args }
      }
      return { k: 'id', name: t.v }
    }
    if (t.t === 'op' && t.v === '(') {
      const inner = parseOr()
      expect(')')
      return inner
    }
    throw new DslParseError('unexpected token')
  }
  const root = parseOr()
  if (peek().t !== 'eof') throw new DslParseError('trailing input')
  return root
}

export interface DslToExcelEnv {
  /** Excel defined name for a model identifier; null when unknown. */
  nameFor(ident: string): string | null
  /** Excel names for a lookup table: the key column and a value column; null when unknown. */
  lookupNames(table: string, column: string): { keyColumn: string; valueColumn: string } | null
}

// Excel precedence: comparison 1, + - 3, * / 4, ^ 5, unary - 7, atoms 9.
function xprec(a: Ast): number {
  switch (a.k) {
    case 'bin':
      if (a.op === '+' || a.op === '-') return 3
      if (a.op === '*' || a.op === '/') return 4
      if (a.op === '^') return 5
      return 1
    case 'neg':
      return 7
    case 'num':
      return a.v < 0 ? 7 : 9
    default:
      return 9
  }
}

const EXCEL_CMP: Record<string, string> = { '==': '=', '!=': '<>', '<': '<', '<=': '<=', '>': '>', '>=': '>=' }

/** Translate a DSL expression to an Excel formula with a leading "=", or null when it has no Excel equivalent. */
export function dslToExcel(dsl: string, env: DslToExcelEnv): string | null {
  let ast: Ast
  try {
    ast = parse(dsl)
  } catch {
    return null
  }
  const fail = (): never => {
    throw new DslParseError('no excel equivalent')
  }
  const wrap = (a: Ast, need: boolean) => (need ? `(${pr(a)})` : pr(a))
  const flatten = (a: Ast, op: string): Ast[] => (a.k === 'bin' && a.op === op ? [...flatten(a.l, op), ...flatten(a.r, op)] : [a])
  const pr = (a: Ast): string => {
    switch (a.k) {
      case 'num':
        return formatNumber(a.v)
      case 'str':
        return `"${a.v.replace(/"/g, '""')}"`
      case 'id':
        return env.nameFor(a.name) ?? fail()
      case 'neg':
        // Excel's unary minus binds tighter than every binary operator.
        return `-${wrap(a.a, xprec(a.a) < 9)}`
      case 'not':
        return `NOT(${pr(a.a)})`
      case 'bin': {
        if (a.op === 'and' || a.op === 'or') return `${a.op.toUpperCase()}(${flatten(a, a.op).map(pr).join(',')})`
        const cmp = EXCEL_CMP[a.op]
        if (cmp) return `${wrap(a.l, xprec(a.l) <= 1)}${cmp}${wrap(a.r, xprec(a.r) <= 1)}`
        const p = xprec(a)
        return `${wrap(a.l, xprec(a.l) < p)}${a.op}${wrap(a.r, xprec(a.r) <= p)}`
      }
      case 'call': {
        const args = a.args
        const n = args.length
        const plain: Record<string, string> = { min: 'MIN', max: 'MAX', sum: 'SUM', avg: 'AVERAGE', abs: 'ABS', if: 'IF' }
        if (plain[a.fn] && n >= 1) return `${plain[a.fn]}(${args.map(pr).join(',')})`
        if (a.fn === 'ceil' && n === 1) return `CEILING(${pr(args[0])},1)`
        if (a.fn === 'floor' && n === 1) return `FLOOR(${pr(args[0])},1)`
        if (a.fn === 'round' && (n === 1 || n === 2)) return `ROUND(${pr(args[0])},${n === 2 ? pr(args[1]) : '0'})`
        if (a.fn === 'roundup_to' && n === 2) return `CEILING(${pr(args[0])},${pr(args[1])})`
        if (a.fn === 'lookup' && n === 3 && args[0].k === 'id' && args[2].k === 'str') {
          const names = env.lookupNames(args[0].name, args[2].v) ?? fail()
          return `INDEX(${names.valueColumn},MATCH(${pr(args[1])},${names.keyColumn},0))`
        }
        return fail()
      }
    }
  }
  try {
    return `=${pr(ast)}`
  } catch {
    return null
  }
}

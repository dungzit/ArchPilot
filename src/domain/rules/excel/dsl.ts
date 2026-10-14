/**
 * Rule DSL output AST and printer (WP-A2). The translator builds this tree
 * from an Excel AST; the printer emits the target DSL with the minimum
 * parentheses the DSL grammar needs (docs/v3/05 §3):
 *
 *   or < and < not < comparisons < + - < * / < unary - < ^ (right-assoc)
 *
 * Evaluation order is preserved exactly: an equal-precedence right operand is
 * always parenthesised (a - (b - c), a + (b + c)), because floating-point
 * addition is not associative.
 */

export type DslBinaryOp = '+' | '-' | '*' | '/' | '^' | '<' | '<=' | '>' | '>=' | '==' | '!=' | 'and' | 'or'

export type DNode =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'id'; name: string }
  | { k: 'neg'; a: DNode }
  | { k: 'not'; a: DNode }
  | { k: 'bin'; op: DslBinaryOp; l: DNode; r: DNode }
  | { k: 'call'; fn: string; args: DNode[] }
  /** Explicit parentheses kept for readability, e.g. AND(a,b) -> (a and b). */
  | { k: 'group'; a: DNode }

export const dNum = (v: number): DNode => ({ k: 'num', v })
export const dStr = (v: string): DNode => ({ k: 'str', v })
export const dId = (name: string): DNode => ({ k: 'id', name })
export const dNeg = (a: DNode): DNode => ({ k: 'neg', a })
export const dNot = (a: DNode): DNode => ({ k: 'not', a })
export const dBin = (op: DslBinaryOp, l: DNode, r: DNode): DNode => ({ k: 'bin', op, l, r })
export const dCall = (fn: string, ...args: DNode[]): DNode => ({ k: 'call', fn, args })
export const dGroup = (a: DNode): DNode => ({ k: 'group', a })

const P_OR = 1
const P_AND = 2
const P_NOT = 3
const P_CMP = 4
const P_ADD = 5
const P_MUL = 6
const P_NEG = 7
const P_POW = 8
const P_ATOM = 9

function opPrec(op: DslBinaryOp): number {
  switch (op) {
    case 'or':
      return P_OR
    case 'and':
      return P_AND
    case '+':
    case '-':
      return P_ADD
    case '*':
    case '/':
      return P_MUL
    case '^':
      return P_POW
    default:
      return P_CMP
  }
}

function prec(n: DNode): number {
  switch (n.k) {
    case 'num':
      return n.v < 0 || Object.is(n.v, -0) ? P_NEG : P_ATOM
    case 'neg':
      return P_NEG
    case 'not':
      return P_NOT
    case 'bin':
      return opPrec(n.op)
    default:
      return P_ATOM
  }
}

/**
 * Format a finite number as a DSL literal without exponent notation
 * (1e-7 -> "0.0000001"), so the DSL lexer only ever sees plain decimals.
 */
export function formatNumber(v: number): string {
  if (!Number.isFinite(v)) throw new Error(`Not a finite number: ${v}`)
  if (Object.is(v, -0)) return '0'
  const s = String(v)
  if (!/e/i.test(s)) return s
  const negative = v < 0
  const [mantissa, expText] = String(Math.abs(v)).toLowerCase().split('e')
  const exp = Number(expText)
  const [intPart, fracPart = ''] = mantissa.split('.')
  const digits = intPart + fracPart
  const point = intPart.length + exp
  let out: string
  if (point <= 0) out = `0.${'0'.repeat(-point)}${digits}`
  else if (point >= digits.length) out = digits + '0'.repeat(point - digits.length)
  else out = `${digits.slice(0, point)}.${digits.slice(point)}`
  return (negative ? '-' : '') + out
}

function wrap(n: DNode, need: boolean): string {
  const s = printDsl(n)
  return need ? `(${s})` : s
}

/** Print a DSL tree. Strings must not contain `"`, `\` or line breaks (the translator checks). */
export function printDsl(n: DNode): string {
  switch (n.k) {
    case 'num':
      return formatNumber(n.v)
    case 'str':
      return `"${n.v}"`
    case 'id':
      return n.name
    case 'group':
      return `(${printDsl(n.a)})`
    case 'call':
      return `${n.fn}(${n.args.map(printDsl).join(', ')})`
    case 'neg': {
      const p = prec(n.a)
      return `-${wrap(n.a, p < P_NEG || n.a.k === 'neg' || (n.a.k === 'num' && p === P_NEG))}`
    }
    case 'not':
      return `not ${wrap(n.a, prec(n.a) < P_ATOM)}`
    case 'bin': {
      const p = opPrec(n.op)
      const lp = prec(n.l)
      const rp = prec(n.r)
      let leftNeeds: boolean
      let rightNeeds: boolean
      if (n.op === '^') {
        leftNeeds = lp <= P_POW
        rightNeeds = rp < P_POW
      } else if (p === P_CMP) {
        leftNeeds = lp <= P_CMP
        rightNeeds = rp <= P_CMP
      } else {
        leftNeeds = lp < p
        // a - (-b) rather than a - -b.
        rightNeeds = rp <= p || rp === P_NEG
      }
      if (n.op === '^') return `${wrap(n.l, leftNeeds)}^${wrap(n.r, rightNeeds)}`
      return `${wrap(n.l, leftNeeds)} ${n.op} ${wrap(n.r, rightNeeds)}`
    }
  }
}

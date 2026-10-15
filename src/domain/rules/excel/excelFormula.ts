/**
 * Excel formula tokenizer and parser (WP-A2, docs/v3/05 §4).
 *
 * Reads the formula text exactly as stored in the .xlsx XML (which is always
 * en-US: "." decimals, "," argument separators, A1 references). It never
 * evaluates anything. It recognises every construct a real workbook can
 * contain, so the translator can reject unsupported ones (cell references,
 * external references, array constants, error literals...) with a precise
 * message instead of mis-reading them.
 *
 * Excel precedence, low to high: comparison, &, + -, * /, ^ (LEFT-assoc),
 * %, unary - +, range ":". Note that Excel's unary minus binds tighter than ^
 * (=-2^2 is 4); the AST keeps that, and the DSL printer adds parentheses.
 */
import { msg, type Msg } from './messages'

export type XNode =
  | { type: 'num'; value: number; pos: number }
  | { type: 'str'; value: string; pos: number }
  | { type: 'bool'; value: boolean; pos: number }
  /** A defined name (or lookup table name). `sheet` is set for Sheet!name. */
  | { type: 'name'; name: string; sheet: string | null; pos: number }
  /** A cell or range reference such as A1, $B$2:$C$9, Sheet1!A1, R1C1. */
  | { type: 'ref'; text: string; kind: 'a1' | 'r1c1' | 'column' | 'row'; pos: number }
  /** External workbook or structured (Table[Column]) reference. */
  | { type: 'external'; text: string; pos: number }
  | { type: 'errlit'; text: string; pos: number }
  | { type: 'array'; pos: number }
  | { type: 'missing'; pos: number }
  | { type: 'unary'; op: '-' | '+'; arg: XNode; pos: number }
  | { type: 'percent'; arg: XNode; pos: number }
  | { type: 'binary'; op: XBinaryOp; left: XNode; right: XNode; pos: number }
  | { type: 'range'; left: XNode; right: XNode; pos: number }
  /** Function call. `name` is upper-case without the _xlfn./_xlws. prefix. */
  | { type: 'call'; name: string; args: XNode[]; pos: number }

export type XBinaryOp = '+' | '-' | '*' | '/' | '^' | '&' | '=' | '<>' | '<' | '>' | '<=' | '>='

type Tok =
  | { t: 'num'; v: number; pos: number }
  | { t: 'str'; v: string; pos: number }
  | { t: 'bool'; v: boolean; pos: number }
  | { t: 'name'; v: string; sheet: string | null; pos: number; end: number }
  | { t: 'func'; v: string; pos: number; end: number }
  | { t: 'ref'; v: string; kind: 'a1' | 'r1c1' | 'column' | 'row'; pos: number }
  | { t: 'external'; v: string; pos: number }
  | { t: 'errlit'; v: string; pos: number }
  | { t: 'op'; v: string; pos: number }
  | { t: '(' | ')' | ',' | '{' | 'eof'; pos: number }

export class FormulaSyntaxError extends Error {
  readonly detail: Msg
  readonly pos: number
  constructor(detail: Msg, pos: number) {
    super(detail.en)
    this.detail = detail
    this.pos = pos
  }
}

const MAX_COLUMN = 16384 // XFD
const MAX_ROW = 1048576
const MAX_FORMULA_LENGTH = 8192 // Excel's own limit

function columnNumber(letters: string): number {
  let n = 0
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n
}

/** True when `text` is an A1 cell address such as "B12" (no $), within Excel's grid. */
export function isA1Cell(text: string): boolean {
  const m = /^([A-Za-z]{1,3})(\d+)$/.exec(text)
  if (!m) return false
  const row = Number(m[2])
  return columnNumber(m[1]) <= MAX_COLUMN && row >= 1 && row <= MAX_ROW
}

/** True when `text` reads as an R1C1 reference ("R", "C", "RC", "R2C3", "R5", "C7"). */
export function isR1C1Like(text: string): boolean {
  return /^[Rr]\d*([Cc]\d*)?$/.test(text) || /^[Cc]\d*$/.test(text)
}

const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9'
const isNameStart = (c: string | undefined) => c !== undefined && /[A-Za-z_\\À-￿]/.test(c)
const isNameChar = (c: string | undefined) => c !== undefined && /[A-Za-z0-9_.\\?À-￿]/.test(c)

function stripFunctionPrefix(name: string): string {
  let n = name.toUpperCase()
  for (const prefix of ['_XLFN.', '_XLWS.', '_XLPM.']) {
    if (n.startsWith(prefix)) n = n.slice(prefix.length)
  }
  return n
}

export function tokenize(src: string): Tok[] {
  if (src.length > MAX_FORMULA_LENGTH) throw new FormulaSyntaxError(msg('Công thức quá dài.', 'Formula is too long.'), 0)
  const toks: Tok[] = []
  let i = 0
  const n = src.length
  const syntax = (vi: string, en: string, pos: number): never => {
    throw new FormulaSyntaxError(msg(vi, en), pos)
  }

  /** Reads what follows "Sheet!" : a $-reference, a cell, or a name. */
  const readAfterSheet = (sheet: string, start: number) => {
    let j = i
    while (j < n && (isNameChar(src[j]) || src[j] === '$' || src[j] === ':')) j++
    const target = src.slice(i, j)
    i = j
    if (target === '') syntax('Thiếu ô sau tên sheet.', 'Missing reference after the sheet name.', start)
    if (/^[A-Za-z_\\][A-Za-z0-9_.\\?]*$/.test(target) && !isA1Cell(target) && !isR1C1Like(target)) {
      toks.push({ t: 'name', v: target, sheet, pos: start, end: i })
    } else {
      toks.push({ t: 'ref', v: `${sheet}!${target}`, kind: 'a1', pos: start })
    }
  }

  while (i < n) {
    const c = src[i]
    const start = i
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++
      continue
    }
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1]))) {
      let j = i
      while (isDigit(src[j])) j++
      if (src[j] === '.') {
        j++
        while (isDigit(src[j])) j++
      }
      if ((src[j] === 'e' || src[j] === 'E') && (isDigit(src[j + 1]) || ((src[j + 1] === '+' || src[j + 1] === '-') && isDigit(src[j + 2])))) {
        j += 2
        while (isDigit(src[j])) j++
      }
      const text = src.slice(i, j)
      i = j
      if (src[i] === ':' && /^\d+$/.test(text)) {
        // Row range such as 1:1.
        let k = i + 1
        while (src[k] === '$' || isDigit(src[k])) k++
        toks.push({ t: 'ref', v: src.slice(start, k), kind: 'row', pos: start })
        i = k
        continue
      }
      if (isNameStart(src[i])) syntax(`Số không hợp lệ gần "${src.slice(start, i + 1)}".`, `Invalid number near "${src.slice(start, i + 1)}".`, start)
      toks.push({ t: 'num', v: Number(text), pos: start })
      continue
    }
    if (c === '"') {
      let j = i + 1
      let value = ''
      for (;;) {
        if (j >= n) syntax('Chuỗi chưa đóng dấu ".', 'Unterminated string literal.', start)
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            value += '"'
            j += 2
            continue
          }
          j++
          break
        }
        value += src[j]
        j++
      }
      i = j
      toks.push({ t: 'str', v: value, pos: start })
      continue
    }
    if (c === "'") {
      // 'Quoted sheet'!A1
      let j = i + 1
      let sheet = ''
      for (;;) {
        if (j >= n) syntax('Tên sheet chưa đóng dấu \'.', "Unterminated quoted sheet name.", start)
        if (src[j] === "'") {
          if (src[j + 1] === "'") {
            sheet += "'"
            j += 2
            continue
          }
          j++
          break
        }
        sheet += src[j]
        j++
      }
      if (src[j] !== '!') syntax('Thiếu "!" sau tên sheet.', 'Expected "!" after the sheet name.', start)
      i = j + 1
      if (sheet.includes('[')) {
        let k = i
        while (k < n && (isNameChar(src[k]) || src[k] === '$' || src[k] === ':')) k++
        toks.push({ t: 'external', v: src.slice(start, k), pos: start })
        i = k
        continue
      }
      readAfterSheet(sheet, start)
      continue
    }
    if (c === '[') {
      // [1]Sheet1!A1 (external workbook) or Table1[Column] fragments.
      let depth = 0
      let j = i
      while (j < n) {
        if (src[j] === '[') depth++
        if (src[j] === ']') depth--
        j++
        if (depth === 0) break
      }
      while (j < n && (isNameChar(src[j]) || src[j] === '$' || src[j] === ':' || src[j] === '!' || src[j] === '[' || src[j] === ']')) j++
      toks.push({ t: 'external', v: src.slice(start, j), pos: start })
      i = j
      continue
    }
    if (c === '#') {
      let j = i + 1
      while (j < n && /[A-Za-z0-9/!?_]/.test(src[j])) j++
      toks.push({ t: 'errlit', v: src.slice(start, j), pos: start })
      i = j
      continue
    }
    if (c === '$') {
      const m = /^\$?[A-Za-z]{1,3}\$?\d+|^\$[A-Za-z]{1,3}|^\$\d+/.exec(src.slice(i))
      if (!m) syntax('Tham chiếu "$" không hợp lệ.', 'Invalid "$" reference.', start)
      const text = m![0]
      i += text.length
      toks.push({ t: 'ref', v: text, kind: /\d$/.test(text) ? (/[A-Za-z]/.test(text) ? 'a1' : 'row') : 'column', pos: start })
      continue
    }
    if (isNameStart(c)) {
      let j = i
      while (isNameChar(src[j])) j++
      const word = src.slice(i, j)
      i = j
      if (src[i] === '[') {
        // Structured reference: Table1[Column].
        let depth = 0
        let k = i
        while (k < n) {
          if (src[k] === '[') depth++
          if (src[k] === ']') depth--
          k++
          if (depth === 0) break
        }
        toks.push({ t: 'external', v: src.slice(start, k), pos: start })
        i = k
        continue
      }
      if (src[i] === '!') {
        i++
        readAfterSheet(word, start)
        continue
      }
      if (src[i] === '(') {
        i++
        toks.push({ t: 'func', v: stripFunctionPrefix(word), pos: start, end: i })
        continue
      }
      const upper = word.toUpperCase()
      if (upper === 'TRUE' || upper === 'FALSE') {
        toks.push({ t: 'bool', v: upper === 'TRUE', pos: start })
      } else if (isA1Cell(word)) {
        toks.push({ t: 'ref', v: word, kind: 'a1', pos: start })
      } else if (isR1C1Like(word)) {
        toks.push({ t: 'ref', v: word, kind: 'r1c1', pos: start })
      } else if (/^[A-Za-z]{1,3}$/.test(word) && src[i] === ':') {
        toks.push({ t: 'ref', v: word, kind: 'column', pos: start })
      } else {
        toks.push({ t: 'name', v: word, sheet: null, pos: start, end: i })
      }
      continue
    }
    const two = src.slice(i, i + 2)
    if (two === '<>' || two === '<=' || two === '>=') {
      toks.push({ t: 'op', v: two, pos: start })
      i += 2
      continue
    }
    if ('+-*/^&=<>%:'.includes(c)) {
      toks.push({ t: 'op', v: c, pos: start })
      i++
      continue
    }
    if (c === '{') {
      // Array constant {1,2;3,4}: kept as one token so the error points at it.
      const close = src.indexOf('}', i)
      i = close < 0 ? n : close + 1
      toks.push({ t: '{', pos: start })
      continue
    }
    if (c === '(' || c === ')' || c === ',') {
      toks.push({ t: c, pos: start })
      i++
      continue
    }
    if (c === '@') syntax('Toán tử "@" (implicit intersection) không được hỗ trợ.', 'The "@" (implicit intersection) operator is not supported.', start)
    if (c === ';') syntax('Dùng dấu "," để ngăn cách đối số (công thức trong file luôn theo chuẩn en-US).', 'Use "," between arguments (formulas in the file are always en-US).', start)
    syntax(`Ký tự không hợp lệ "${c}".`, `Unexpected character "${c}".`, start)
  }
  toks.push({ t: 'eof', pos: n })
  return toks
}

/** Parse an Excel formula (with or without the leading "="). Throws FormulaSyntaxError. */
export function parseExcelFormula(formula: string): XNode {
  const src = formula.trim().replace(/^=/, '')
  if (src.trim() === '') throw new FormulaSyntaxError(msg('Công thức rỗng.', 'Empty formula.'), 0)
  const toks = tokenize(src)
  let p = 0
  const peek = () => toks[p]
  const next = () => toks[p++]
  const isOp = (v: string) => {
    const t = toks[p]
    return t.t === 'op' && t.v === v
  }
  const fail = (vi: string, en: string, pos: number): never => {
    throw new FormulaSyntaxError(msg(vi, en), pos)
  }

  const parseComparison = (): XNode => {
    let left = parseConcat()
    for (;;) {
      const t = peek()
      if (t.t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(t.v)) {
        next()
        const right = parseConcat()
        left = { type: 'binary', op: t.v as XBinaryOp, left, right, pos: t.pos }
      } else return left
    }
  }
  const parseConcat = (): XNode => {
    let left = parseAdditive()
    while (isOp('&')) {
      const t = next()
      left = { type: 'binary', op: '&', left, right: parseAdditive(), pos: t.pos }
    }
    return left
  }
  const parseAdditive = (): XNode => {
    let left = parseMultiplicative()
    while (isOp('+') || isOp('-')) {
      const t = next() as { v: string; pos: number }
      left = { type: 'binary', op: t.v as XBinaryOp, left, right: parseMultiplicative(), pos: t.pos }
    }
    return left
  }
  const parseMultiplicative = (): XNode => {
    let left = parsePower()
    while (isOp('*') || isOp('/')) {
      const t = next() as { v: string; pos: number }
      left = { type: 'binary', op: t.v as XBinaryOp, left, right: parsePower(), pos: t.pos }
    }
    return left
  }
  const parsePower = (): XNode => {
    let left = parsePercent()
    while (isOp('^')) {
      const t = next()
      left = { type: 'binary', op: '^', left, right: parsePercent(), pos: t.pos }
    }
    return left
  }
  const parsePercent = (): XNode => {
    let arg = parseUnary()
    while (isOp('%')) {
      const t = next()
      arg = { type: 'percent', arg, pos: t.pos }
    }
    return arg
  }
  const parseUnary = (): XNode => {
    if (isOp('-') || isOp('+')) {
      const t = next() as { v: string; pos: number }
      return { type: 'unary', op: t.v as '-' | '+', arg: parseUnary(), pos: t.pos }
    }
    return parseRange()
  }
  const parseRange = (): XNode => {
    const left = parsePrimary()
    if (isOp(':')) {
      const t = next()
      const right = parsePrimary()
      return { type: 'range', left, right, pos: t.pos }
    }
    return left
  }
  const parseArgs = (): XNode[] => {
    const args: XNode[] = []
    if (peek().t === ')') {
      next()
      return args
    }
    for (;;) {
      const t = peek()
      if (t.t === ',' || t.t === ')') args.push({ type: 'missing', pos: t.pos })
      else args.push(parseComparison())
      const sep = next()
      if (sep.t === ')') return args
      if (sep.t !== ',') fail('Thiếu "," hoặc ")" trong danh sách đối số.', 'Expected "," or ")" in the argument list.', sep.pos)
    }
  }
  const parsePrimary = (): XNode => {
    const t = next()
    switch (t.t) {
      case 'num':
        return { type: 'num', value: t.v, pos: t.pos }
      case 'str':
        return { type: 'str', value: t.v, pos: t.pos }
      case 'bool':
        return { type: 'bool', value: t.v, pos: t.pos }
      case 'name':
        return { type: 'name', name: t.v, sheet: t.sheet, pos: t.pos }
      case 'ref':
        return { type: 'ref', text: t.v, kind: t.kind, pos: t.pos }
      case 'external':
        return { type: 'external', text: t.v, pos: t.pos }
      case 'errlit':
        return { type: 'errlit', text: t.v, pos: t.pos }
      case 'func':
        return { type: 'call', name: t.v, args: parseArgs(), pos: t.pos }
      case '{':
        return { type: 'array', pos: t.pos }
      case '(': {
        const inner = parseComparison()
        const close = next()
        if (close.t !== ')') fail('Thiếu dấu ")".', 'Missing ")".', close.pos)
        return inner
      }
      case 'eof':
        return fail('Công thức kết thúc đột ngột.', 'Unexpected end of formula.', t.pos)
      default:
        return fail('Ký hiệu không mong đợi.', 'Unexpected token.', t.pos)
    }
  }

  const root = parseComparison()
  const rest = peek()
  if (rest.t !== 'eof') {
    if (rest.t === ',') fail('Dấu "," ngoài lời gọi hàm (union reference) không được hỗ trợ.', 'A "," outside a function call (union reference) is not supported.', rest.pos)
    fail('Thừa ký hiệu ở cuối công thức (có thể là toán tử giao bằng dấu cách).', 'Unexpected token after the end of the formula (possibly a space intersection operator).', rest.pos)
  }
  return root
}

/** Functions newer than Excel 2010 that must carry the _xlfn. prefix inside the file. */
const FUTURE_FUNCTIONS = new Set(['IFS', 'XLOOKUP', 'CEILING.MATH', 'FLOOR.MATH', 'SWITCH', 'MAXIFS', 'MINIFS', 'CONCAT', 'TEXTJOIN'])

/**
 * Rewrite a formula for writing into a workbook: every unqualified name is
 * passed to `rename` (null keeps it and reports it in `unknown`), newer
 * functions get their `_xlfn.` prefix back, and every other character is
 * kept verbatim. Returns the formula without the leading "=", as exceljs
 * expects. Throws FormulaSyntaxError when the formula does not tokenize.
 */
export function rewriteExcelFormula(formula: string, rename: (name: string) => string | null): { formula: string; unknown: string[] } {
  const src = formula.trim().replace(/^=/, '')
  const toks = tokenize(src)
  const unknown: string[] = []
  let out = ''
  let last = 0
  for (const t of toks) {
    if (t.t === 'name' && t.sheet === null) {
      const renamed = rename(t.v)
      if (renamed === null) unknown.push(t.v)
      out += src.slice(last, t.pos) + (renamed ?? t.v)
      last = t.end
    } else if (t.t === 'func') {
      const name = FUTURE_FUNCTIONS.has(t.v) ? `_xlfn.${t.v}` : t.v
      out += `${src.slice(last, t.pos)}${name}(`
      last = t.end
    }
  }
  out += src.slice(last)
  return { formula: out, unknown }
}

/** Display form of a formula read from a file: leading "=", no _xlfn./_xlws. prefixes. */
export function displayExcelFormula(formula: string): string {
  const src = formula.trim().replace(/^=/, '')
  try {
    const toks = tokenize(src)
    let out = ''
    let last = 0
    for (const t of toks) {
      if (t.t === 'func') {
        out += `${src.slice(last, t.pos)}${t.v}(`
        last = t.end
      }
    }
    return `=${out}${src.slice(last)}`
  } catch {
    return `=${src}`
  }
}

/**
 * Excel formula -> rule DSL translator (WP-A2, docs/v3/05 §4).
 *
 * Mapping (anything else is an error, never silently dropped):
 *   + - * / ^            same (precedence fixed up by the printer)
 *   = <>                 == !=
 *   70%                  0.7          x%  -> x / 100
 *   ROUND(x,n)           round(x, n)
 *   ROUNDUP(x,0)         ceil(x)      ROUNDUP(x,n)   -> ceil(x * 10^n) / 10^n
 *   ROUNDDOWN(x,0)       floor(x)     ROUNDDOWN(x,n) -> floor(x * 10^n) / 10^n
 *   CEILING(x[,1])       ceil(x)      CEILING(x,s)   -> roundup_to(x, s)   (also CEILING.MATH)
 *   FLOOR(x[,1])         floor(x)     FLOOR(x,s)     -> floor(x / s) * s   (also FLOOR.MATH)
 *   MAX MIN SUM AVERAGE ABS          max min sum avg abs
 *   IF(c,a,b)            if(c, a, b)  IFS(c1,v1,...) -> nested if
 *   AND(a,b) OR(a,b)     (a and b) (a or b)       NOT(a) -> not a
 *   VLOOKUP(k,T,n,FALSE)            lookup(T, k, "<column n>")
 *   XLOOKUP(k,T.key,T.col)          lookup(T, k, "col")
 *   INDEX(T.col,MATCH(k,T.key,0))   lookup(T, k, "col")   INDEX(T,MATCH(..),n) likewise
 *   defined names                    identifiers (via the TranslateEnv resolver)
 */
import { parseExcelFormula, FormulaSyntaxError, type XNode } from './excelFormula'
import { dBin, dCall, dGroup, dId, dNeg, dNot, dNum, dStr, printDsl, type DNode, type DslBinaryOp } from './dsl'
import { msg, type Msg } from './messages'

/** What a name in a formula stands for, decided by the importer (or a test). */
export type Resolved =
  | { kind: 'value'; ident: string; warning?: Msg }
  | { kind: 'table'; table: string; columns: string[] }
  | { kind: 'column'; table: string; columns: string[]; index: number }
  | { kind: 'error'; message: Msg }

export interface TranslateEnv {
  resolveName(name: string, sheet: string | null): Resolved
  /** Optional hint for a direct cell reference, e.g. "use the defined name ingress". */
  describeRef?(refText: string): Msg | null
}

export type TranslateResult =
  | { ok: true; dsl: string; idents: string[]; tables: string[]; warnings: Msg[] }
  | { ok: false; error: Msg; pos: number }

class TranslateError extends Error {
  readonly detail: Msg
  readonly pos: number
  constructor(detail: Msg, pos: number) {
    super(detail.en)
    this.detail = detail
    this.pos = pos
  }
}

export const SUPPORTED_EXCEL_FUNCTIONS = [
  'ROUND', 'ROUNDUP', 'ROUNDDOWN', 'CEILING', 'CEILING.MATH', 'FLOOR', 'FLOOR.MATH',
  'MAX', 'MIN', 'SUM', 'AVERAGE', 'ABS', 'IF', 'IFS', 'AND', 'OR', 'NOT',
  'VLOOKUP', 'XLOOKUP', 'INDEX', 'MATCH',
] as const

const DSL_FN: Record<string, string> = { MAX: 'max', MIN: 'min', SUM: 'sum', AVERAGE: 'avg', ABS: 'abs' }

const CMP: Record<string, DslBinaryOp> = { '=': '==', '<>': '!=', '<': '<', '>': '>', '<=': '<=', '>=': '>=' }

function isLiteral(n: XNode, value: number): boolean {
  return n.type === 'num' && n.value === value
}

/** Translate one Excel formula (leading "=" optional). Never throws. */
export function translateExcelFormula(formula: string, env: TranslateEnv): TranslateResult {
  const idents = new Set<string>()
  const tables = new Set<string>()
  const warnings: Msg[] = []
  const fail = (pos: number, vi: string, en: string): never => {
    throw new TranslateError(msg(vi, en), pos)
  }

  const arity = (n: Extract<XNode, { type: 'call' }>, min: number, max: number) => {
    if (n.args.length < min || n.args.length > max) {
      const want = min === max ? `${min}` : max === Infinity ? `>= ${min}` : `${min}-${max}`
      fail(n.pos, `${n.name} cần ${want} đối số, có ${n.args.length}.`, `${n.name} takes ${want} argument(s), got ${n.args.length}.`)
    }
    n.args.forEach((a) => {
      if (a.type === 'missing') fail(a.pos, `${n.name}: thiếu đối số.`, `${n.name}: missing argument.`)
    })
  }

  const checkString = (s: string, pos: number) => {
    if (/["\\\r\n]/.test(s)) fail(pos, 'Chuỗi không được chứa ", \\ hoặc xuống dòng.', 'Strings must not contain ", \\ or line breaks.')
  }

  /** Resolve a table argument of a lookup function. */
  const tableArg = (n: XNode, fn: string): Extract<Resolved, { kind: 'table' | 'column' }> => {
    if (n.type === 'name') {
      const r = env.resolveName(n.name, n.sheet)
      if (r.kind === 'table' || r.kind === 'column') {
        tables.add(r.table)
        return r
      }
      if (r.kind === 'error') throw new TranslateError(r.message, n.pos)
      return fail(n.pos, `${fn}: "${n.name}" không phải bảng trong sheet Lookups.`, `${fn}: "${n.name}" is not a table on the Lookups sheet.`)
    }
    if (n.type === 'ref' || n.type === 'range') {
      return fail(n.pos, `${fn}: dùng tên đã định nghĩa của bảng Lookups thay cho địa chỉ ô.`, `${fn}: use the defined name of the Lookups table instead of a cell address.`)
    }
    return fail(n.pos, `${fn}: đối số phải là bảng trong sheet Lookups.`, `${fn}: the argument must be a table on the Lookups sheet.`)
  }

  const exactMatchFlag = (n: XNode | undefined, fn: string, falseMeansExact: boolean) => {
    const ok = falseMeansExact
      ? n !== undefined && ((n.type === 'bool' && !n.value) || isLiteral(n, 0))
      : n !== undefined && isLiteral(n, 0)
    if (!ok) fail(n?.pos ?? 0, `${fn}: chỉ hỗ trợ tra cứu khớp chính xác (${falseMeansExact ? 'FALSE' : '0'}).`, `${fn}: only exact match (${falseMeansExact ? 'FALSE' : '0'}) is supported.`)
  }

  const lookup = (table: string, key: DNode, column: string, pos: number): DNode => {
    checkString(column, pos)
    return dCall('lookup', dId(table), key, dStr(column))
  }

  const tx = (n: XNode, allowString = false): DNode => {
    switch (n.type) {
      case 'num':
        return dNum(n.value)
      case 'str':
        if (!allowString) fail(n.pos, 'Chuỗi chỉ được dùng làm khóa tra cứu (VLOOKUP/XLOOKUP/MATCH).', 'Strings are only allowed as lookup keys (VLOOKUP/XLOOKUP/MATCH).')
        checkString(n.value, n.pos)
        return dStr(n.value)
      case 'bool':
        return fail(n.pos, 'TRUE/FALSE chỉ được dùng trong VLOOKUP (FALSE) hoặc nhánh cuối của IFS.', 'TRUE/FALSE is only allowed in VLOOKUP (FALSE) or as the last IFS condition.')
      case 'name': {
        const r = env.resolveName(n.name, n.sheet)
        if (r.kind === 'value') {
          idents.add(r.ident)
          if (r.warning) warnings.push(r.warning)
          return dId(r.ident)
        }
        if (r.kind === 'error') throw new TranslateError(r.message, n.pos)
        return fail(n.pos, `Bảng "${n.name}" chỉ dùng được trong VLOOKUP/XLOOKUP/INDEX.`, `Table "${n.name}" can only be used inside VLOOKUP/XLOOKUP/INDEX.`)
      }
      case 'ref': {
        const hint = env.describeRef?.(n.text)
        if (hint) throw new TranslateError(hint, n.pos)
        return fail(n.pos, `Tham chiếu ô "${n.text}" không được hỗ trợ; hãy dùng tên đã định nghĩa (defined name).`, `Cell reference "${n.text}" is not supported; use a defined name.`)
      }
      case 'range':
        return fail(n.pos, 'Vùng ô (A1:B2) không được hỗ trợ; hãy dùng tên đã định nghĩa.', 'Ranges (A1:B2) are not supported; use a defined name.')
      case 'external':
        return fail(n.pos, `Tham chiếu ngoài hoặc structured reference "${n.text}" không được hỗ trợ.`, `External or structured reference "${n.text}" is not supported.`)
      case 'errlit':
        return fail(n.pos, `Giá trị lỗi ${n.text} trong công thức.`, `Error value ${n.text} in the formula.`)
      case 'array':
        return fail(n.pos, 'Hằng mảng {…} không được hỗ trợ.', 'Array constants {…} are not supported.')
      case 'missing':
        return fail(n.pos, 'Thiếu đối số.', 'Missing argument.')
      case 'unary':
        return n.op === '-' ? dNeg(tx(n.arg)) : tx(n.arg)
      case 'percent':
        if (n.arg.type === 'num') return dNum(n.arg.value / 100)
        return dBin('/', tx(n.arg), dNum(100))
      case 'binary': {
        if (n.op === '&') return fail(n.pos, 'Toán tử nối chuỗi "&" không được hỗ trợ.', 'The "&" concatenation operator is not supported.')
        const cmp = CMP[n.op]
        if (cmp) {
          const chained = (x: XNode) => x.type === 'binary' && CMP[x.op] !== undefined
          if (chained(n.left) || chained(n.right)) fail(n.pos, 'So sánh nối tiếp (a<b<c) không được hỗ trợ; dùng AND().', 'Chained comparisons (a<b<c) are not supported; use AND().')
          return dBin(cmp, tx(n.left), tx(n.right))
        }
        return dBin(n.op as DslBinaryOp, tx(n.left), tx(n.right))
      }
      case 'call':
        return call(n)
    }
  }

  const call = (n: Extract<XNode, { type: 'call' }>): DNode => {
    const a = n.args
    switch (n.name) {
      case 'ROUND':
        arity(n, 2, 2)
        return dCall('round', tx(a[0]), tx(a[1]))
      case 'ROUNDUP':
      case 'ROUNDDOWN': {
        arity(n, 2, 2)
        const fn = n.name === 'ROUNDUP' ? 'ceil' : 'floor'
        if (isLiteral(a[1], 0)) return dCall(fn, tx(a[0]))
        const scale = dBin('^', dNum(10), tx(a[1]))
        return dBin('/', dCall(fn, dBin('*', tx(a[0]), scale)), scale)
      }
      case 'CEILING':
      case 'CEILING.MATH': {
        arity(n, 1, n.name === 'CEILING' ? 2 : 3)
        if (a.length === 3 && !isLiteral(a[2], 0)) fail(a[2].pos, 'CEILING.MATH: chỉ hỗ trợ mode = 0.', 'CEILING.MATH: only mode 0 is supported.')
        if (a.length === 1 || isLiteral(a[1], 1)) return dCall('ceil', tx(a[0]))
        return dCall('roundup_to', tx(a[0]), tx(a[1]))
      }
      case 'FLOOR':
      case 'FLOOR.MATH': {
        arity(n, 1, n.name === 'FLOOR' ? 2 : 3)
        if (a.length === 3 && !isLiteral(a[2], 0)) fail(a[2].pos, 'FLOOR.MATH: chỉ hỗ trợ mode = 0.', 'FLOOR.MATH: only mode 0 is supported.')
        if (a.length === 1 || isLiteral(a[1], 1)) return dCall('floor', tx(a[0]))
        const step = tx(a[1])
        return dBin('*', dCall('floor', dBin('/', tx(a[0]), step)), step)
      }
      case 'MAX':
      case 'MIN':
      case 'SUM':
      case 'AVERAGE':
        arity(n, 1, 255)
        return dCall(DSL_FN[n.name], ...a.map((x) => tx(x)))
      case 'ABS':
        arity(n, 1, 1)
        return dCall('abs', tx(a[0]))
      case 'IF':
        if (a.length === 2) fail(n.pos, 'IF cần đủ 3 đối số (có nhánh "sai").', 'IF needs all 3 arguments (including the "false" branch).')
        arity(n, 3, 3)
        return dCall('if', tx(a[0]), tx(a[1]), tx(a[2]))
      case 'IFS': {
        arity(n, 2, 254)
        if (a.length % 2 !== 0) fail(n.pos, 'IFS cần số đối số chẵn (điều kiện, giá trị).', 'IFS needs pairs of (condition, value).')
        const pairs: [XNode, XNode][] = []
        for (let i = 0; i < a.length; i += 2) pairs.push([a[i], a[i + 1]])
        const last = pairs[pairs.length - 1]
        let acc: DNode
        let rest: [XNode, XNode][]
        if (last[0].type === 'bool' && last[0].value) {
          acc = tx(last[1])
          rest = pairs.slice(0, -1)
        } else {
          warnings.push(msg(
            'IFS không có nhánh cuối TRUE: khi không điều kiện nào đúng, rule dùng giá trị cuối (Excel trả về #N/A).',
            'IFS has no final TRUE branch: when no condition matches, the rule uses the last value (Excel returns #N/A).',
          ))
          acc = tx(last[1])
          rest = pairs.slice(0, -1)
        }
        for (let i = rest.length - 1; i >= 0; i--) acc = dCall('if', tx(rest[i][0]), tx(rest[i][1]), acc)
        return acc
      }
      case 'AND':
      case 'OR': {
        arity(n, 1, 255)
        const op = n.name === 'AND' ? 'and' : 'or'
        const parts = a.map((x) => tx(x))
        const chain = parts.slice(1).reduce((l, r) => dBin(op, l, r), parts[0])
        return parts.length === 1 ? chain : dGroup(chain)
      }
      case 'NOT':
        arity(n, 1, 1)
        return dNot(tx(a[0]))
      case 'VLOOKUP': {
        arity(n, 3, 4)
        exactMatchFlag(a[3], 'VLOOKUP', true)
        const t = tableArg(a[1], 'VLOOKUP')
        if (t.kind !== 'table') fail(a[1].pos, 'VLOOKUP: đối số thứ 2 phải là cả bảng Lookups.', 'VLOOKUP: the 2nd argument must be a whole Lookups table.')
        const col = a[2]
        if (col.type !== 'num' || !Number.isInteger(col.value) || col.value < 1 || col.value > t.columns.length) {
          fail(col.pos, `VLOOKUP: số cột phải là số nguyên từ 1 đến ${t.columns.length}.`, `VLOOKUP: the column index must be an integer from 1 to ${t.columns.length}.`)
        }
        return lookup(t.table, tx(a[0], true), t.columns[(col as { value: number }).value - 1], n.pos)
      }
      case 'XLOOKUP': {
        arity(n, 3, 6)
        if (a.length >= 4 && a[3].type !== 'missing') fail(a[3].pos, 'XLOOKUP: không hỗ trợ if_not_found.', 'XLOOKUP: if_not_found is not supported.')
        if (a.length >= 5 && a[4].type !== 'missing' && !isLiteral(a[4], 0)) fail(a[4].pos, 'XLOOKUP: chỉ hỗ trợ match_mode 0.', 'XLOOKUP: only match_mode 0 is supported.')
        if (a.length >= 6 && a[5].type !== 'missing' && !isLiteral(a[5], 1)) fail(a[5].pos, 'XLOOKUP: chỉ hỗ trợ search_mode 1.', 'XLOOKUP: only search_mode 1 is supported.')
        const keyCol = tableArg(a[1], 'XLOOKUP')
        const retCol = tableArg(a[2], 'XLOOKUP')
        if (keyCol.kind !== 'column' || keyCol.index !== 0) fail(a[1].pos, 'XLOOKUP: vùng tìm kiếm phải là cột đầu (khóa) của bảng Lookups.', 'XLOOKUP: the lookup array must be the first (key) column of a Lookups table.')
        if (retCol.kind !== 'column' || retCol.table !== keyCol.table) fail(a[2].pos, 'XLOOKUP: vùng trả về phải là một cột của cùng bảng.', 'XLOOKUP: the return array must be a column of the same table.')
        const rc = retCol as Extract<Resolved, { kind: 'column' }>
        return lookup(rc.table, tx(a[0], true), rc.columns[rc.index], n.pos)
      }
      case 'INDEX': {
        arity(n, 2, 3)
        const m = a[1]
        if (m.type !== 'call' || m.name !== 'MATCH') fail(m.pos, 'INDEX chỉ được hỗ trợ dạng INDEX(..., MATCH(khóa, cột_khóa, 0)).', 'INDEX is only supported as INDEX(..., MATCH(key, key_column, 0)).')
        const match = m as Extract<XNode, { type: 'call' }>
        arity(match, 2, 3)
        exactMatchFlag(match.args[2], 'MATCH', false)
        const keyCol = tableArg(match.args[1], 'MATCH')
        if (keyCol.kind !== 'column' || keyCol.index !== 0) fail(match.args[1].pos, 'MATCH: vùng tìm kiếm phải là cột đầu (khóa) của bảng Lookups.', 'MATCH: the lookup array must be the first (key) column of a Lookups table.')
        const target = tableArg(a[0], 'INDEX')
        if (target.table !== keyCol.table) fail(a[0].pos, 'INDEX và MATCH phải dùng cùng một bảng.', 'INDEX and MATCH must use the same table.')
        const key = tx(match.args[0], true)
        if (target.kind === 'column') {
          if (a.length === 3 && !isLiteral(a[2], 1)) fail(a[2].pos, 'INDEX trên một cột: số cột phải là 1.', 'INDEX over one column: the column number must be 1.')
          return lookup(target.table, key, target.columns[target.index], n.pos)
        }
        const col = a[2]
        if (!col || col.type !== 'num' || !Number.isInteger(col.value) || col.value < 1 || col.value > target.columns.length) {
          fail(col?.pos ?? n.pos, `INDEX: số cột phải là số nguyên từ 1 đến ${target.columns.length}.`, `INDEX: the column number must be an integer from 1 to ${target.columns.length}.`)
        }
        return lookup(target.table, key, target.columns[(col as { value: number }).value - 1], n.pos)
      }
      case 'MATCH':
        return fail(n.pos, 'MATCH chỉ được dùng bên trong INDEX.', 'MATCH is only supported inside INDEX.')
      default:
        return fail(n.pos, `Hàm ${n.name} không được hỗ trợ.`, `Unsupported function ${n.name}.`)
    }
  }

  try {
    const ast = parseExcelFormula(formula)
    const dsl = printDsl(tx(ast))
    return { ok: true, dsl, idents: [...idents], tables: [...tables], warnings }
  } catch (e) {
    if (e instanceof TranslateError || e instanceof FormulaSyntaxError) return { ok: false, error: e.detail, pos: e.pos }
    return { ok: false, error: msg(`Lỗi khi dịch công thức: ${String(e)}`, `Could not translate the formula: ${String(e)}`), pos: 0 }
  }
}

/**
 * `terraform fmt`-canonical printer for the constrained IR (design-v2 4.4.4).
 *
 * What `terraform fmt` 1.16.4 was observed to do, and how this printer
 * matches it (probe files and results are recorded in
 * docs/development/iac-phase1-build-note.md):
 * - `=` alignment covers maximal runs of consecutive single-line attributes
 *   (or object entries). A comment line, a blank line, a nested block, or an
 *   attribute whose value opens a bracket at the end of the line ends a run.
 * - Interpolation-only strings are unwrapped (handled in `tmpl()`).
 * - Nothing is re-flowed: `[a, b]`, `{}`, `f(a, {` ... `})` are kept as
 *   written, so the printer's own choices are canonical as long as spacing
 *   and indentation are.
 *
 * Deterministic and pure: no clock, locale or environment.
 */
import { hclEscape, commentText } from './escape'
import type { Attribute, BinaryOp, Block, BodyItem, Expr, HclFile } from './ir'

export class HclPrintError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HclPrintError'
  }
}

const INDENT = '  '
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_-]*$/
const BARE_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/
const KEYWORDS = new Set(['true', 'false', 'null', 'for', 'in', 'if', 'endif', 'endfor', 'else'])
const REF_PATH = /^[A-Za-z_][A-Za-z0-9_-]*(\.[A-Za-z_][A-Za-z0-9_-]*|\[(\d+|\*|count\.index)\])*$/
const PRINTABLE_ASCII = /^[\x20-\x7E]+$/

const PRECEDENCE: Record<BinaryOp, number> = {
  '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6,
}

function fail(message: string): never {
  throw new HclPrintError(message)
}

function assertIdentifier(name: string, what: string): void {
  if (!IDENTIFIER.test(name)) fail(`${what} ${JSON.stringify(name)} is not a valid HCL identifier`)
}

// ---------------------------------------------------------------- expressions

/** True when the expression prints over more than one line. */
export function isMultiline(e: Expr): boolean {
  switch (e.k) {
    case 'obj':
      return e.entries.length > 0
    case 'list':
      return e.items.some((item) => isMultiline(item))
    case 'call':
      return e.args.some((arg) => isMultiline(arg))
    default:
      return false
  }
}

function printNumber(v: number): string {
  if (!Number.isFinite(v)) fail(`number ${v} has no HCL form`)
  const text = Object.is(v, -0) ? '0' : String(v)
  if (/e/i.test(text)) fail(`number ${text} would print in exponent form (IR constraint 6)`)
  return text
}

function printKey(key: string): string {
  if (!PRINTABLE_ASCII.test(key)) fail(`object key ${JSON.stringify(key)} must be printable ASCII`)
  return BARE_KEY.test(key) && !KEYWORDS.has(key) ? key : `"${hclEscape(key)}"`
}

function single(e: Expr, where: string): string {
  if (isMultiline(e)) fail(`${where} must be a single-line expression`)
  return printExpr(e, 0)
}

function operand(e: Expr, parent: BinaryOp, side: 'left' | 'right'): string {
  const text = single(e, `operand of ${parent}`)
  if (e.k === 'cond') return `(${text})`
  if (e.k === 'op') {
    const child = PRECEDENCE[e.op]
    const own = PRECEDENCE[parent]
    if (child < own || (child === own && side === 'right')) return `(${text})`
  }
  return text
}

/**
 * Print `e` at nesting depth `depth`. The first line carries no indent (the
 * caller has already written `name = `); continuation lines are indented
 * absolutely, and the closing bracket sits at `depth`.
 */
export function printExpr(e: Expr, depth: number): string {
  const pad = INDENT.repeat(depth)
  const inner = INDENT.repeat(depth + 1)
  switch (e.k) {
    case 'str':
      return `"${hclEscape(e.v)}"`
    case 'num':
      return printNumber(e.v)
    case 'bool':
      return e.v ? 'true' : 'false'
    case 'null':
      return 'null'
    case 'type':
      return e.t
    case 'ref':
      if (!REF_PATH.test(e.path)) fail(`reference ${JSON.stringify(e.path)} is not a plain traversal`)
      return e.path
    case 'tmpl': {
      if (e.parts.length < 2 && e.parts.every((part) => typeof part !== 'string')) {
        fail('interpolation-only template must be collapsed with tmpl() (IR constraint 1)')
      }
      const body = e.parts.map((part) => (typeof part === 'string' ? hclEscape(part) : `\${${single(part, 'template part')}}`)).join('')
      return `"${body}"`
    }
    case 'list': {
      if (e.items.length === 0) return '[]'
      if (!isMultiline(e)) return `[${e.items.map((item) => printExpr(item, depth)).join(', ')}]`
      const lines = e.items.map((item) => `${inner}${printExpr(item, depth + 1)},`)
      return `[\n${lines.join('\n')}\n${pad}]`
    }
    case 'obj': {
      if (e.entries.length === 0) return '{}'
      const seen = new Set<string>()
      for (const entry of e.entries) {
        if (seen.has(entry.key)) fail(`object key ${JSON.stringify(entry.key)} appears twice`)
        seen.add(entry.key)
      }
      const rows = e.entries.map((entry) => ({ name: printKey(entry.key), value: entry.value }))
      return `{\n${alignedRows(rows, depth + 1).join('\n')}\n${pad}}`
    }
    case 'call': {
      const multiIndex = e.args.findIndex((arg) => isMultiline(arg))
      if (multiIndex >= 0 && multiIndex !== e.args.length - 1) fail(`${e.fn}(): only the last argument may span lines`)
      const args = e.args.map((arg, index) => (index === multiIndex ? printExpr(arg, depth) : single(arg, `${e.fn}() argument`)))
      return `${e.fn}(${args.join(', ')})`
    }
    case 'op':
      return `${operand(e.left, e.op, 'left')} ${e.op} ${operand(e.right, e.op, 'right')}`
    case 'not': {
      const text = single(e.operand, 'operand of !')
      return e.operand.k === 'op' || e.operand.k === 'cond' ? `!(${text})` : `!${text}`
    }
    case 'cond': {
      const part = (x: Expr) => (x.k === 'cond' ? `(${single(x, 'conditional part')})` : single(x, 'conditional part'))
      return `${part(e.test)} ? ${part(e.then)} : ${part(e.else)}`
    }
    case 'paren':
      return `(${single(e.inner, 'parenthesised expression')})`
    case 'forList':
      assertIdentifier(e.name, 'for variable')
      return `[for ${e.name} in ${single(e.coll, 'for collection')} : ${single(e.body, 'for body')}]`
  }
}

/**
 * `name = value` rows at `depth`, with `=` aligned across each maximal run of
 * single-line rows. A multi-line row prints unaligned and ends the run
 * (observed fmt behaviour: a line ending in an open bracket breaks the chain).
 */
function alignedRows(rows: { name: string; value: Expr; comments?: string[] }[], depth: number): string[] {
  const pad = INDENT.repeat(depth)
  const out: string[] = []
  let run: { name: string; value: string }[] = []
  const flush = () => {
    const width = Math.max(0, ...run.map((row) => row.name.length))
    for (const row of run) out.push(`${pad}${row.name.padEnd(width)} = ${row.value}`)
    run = []
  }
  for (const row of rows) {
    if (row.comments && row.comments.length > 0) {
      flush()
      for (const comment of row.comments) out.push(`${pad}# ${commentText(comment)}`.trimEnd())
    }
    if (isMultiline(row.value)) {
      flush()
      out.push(`${pad}${row.name} = ${printExpr(row.value, depth)}`)
    } else {
      run.push({ name: row.name, value: printExpr(row.value, depth) })
    }
  }
  flush()
  return out
}

// ---------------------------------------------------------------- blocks

interface Segment { lines: string[]; spaced: boolean }

function printBody(items: BodyItem[], depth: number): string[] {
  const segments: Segment[] = []
  let chain: Attribute[] = []
  const flushChain = () => {
    if (chain.length > 0) segments.push({ lines: alignedRows(chain, depth), spaced: false })
    chain = []
  }
  const names = new Set<string>()
  for (const item of items) {
    if (item.kind === 'attr') {
      assertIdentifier(item.name, 'attribute name')
      if (names.has(item.name)) fail(`attribute ${item.name} is set twice in one block`)
      names.add(item.name)
      if (isMultiline(item.value)) {
        flushChain()
        segments.push({ lines: alignedRows([item], depth), spaced: true })
      } else {
        if (item.comments && item.comments.length > 0) flushChain()
        chain.push(item)
      }
    } else {
      flushChain()
      segments.push({ lines: printBlockLines(item, depth), spaced: true })
    }
  }
  flushChain()
  const out: string[] = []
  segments.forEach((segment, index) => {
    if (index > 0 && (segment.spaced || segments[index - 1].spaced)) out.push('')
    out.push(...segment.lines)
  })
  return out
}

function printBlockLines(b: Block, depth: number): string[] {
  assertIdentifier(b.type, 'block type')
  const pad = INDENT.repeat(depth)
  const out: string[] = []
  for (const comment of b.comments ?? []) out.push(`${pad}# ${commentText(comment)}`.trimEnd())
  for (const label of b.labels) assertIdentifier(label, `${b.type} label`)
  const head = [b.type, ...b.labels.map((label) => `"${label}"`)].join(' ')
  if (b.body.length === 0) {
    out.push(`${pad}${head} {}`)
    return out
  }
  out.push(`${pad}${head} {`)
  out.push(...printBody(b.body, depth + 1))
  out.push(`${pad}}`)
  return out
}

export function printBlock(b: Block): string {
  return `${printBlockLines(b, 0).join('\n')}\n`
}

/** A file of top-level attributes only (`terraform.tfvars`, `backend.hcl`): header, blank line, aligned rows. */
export function printAttributeFile(header: string[], attributes: Attribute[]): string {
  const parts: string[] = []
  if (header.length > 0) parts.push(header.map((line) => `# ${commentText(line)}`.trimEnd()).join('\n'))
  if (attributes.length > 0) parts.push(printBody(attributes, 0).join('\n'))
  return `${parts.join('\n\n')}\n`
}

/** A whole file: header comments, a blank line, blocks separated by one blank line, LF, one trailing newline. */
export function printFile(file: HclFile): string {
  const parts: string[] = []
  if (file.header.length > 0) parts.push(file.header.map((line) => `# ${commentText(line)}`.trimEnd()).join('\n'))
  for (const b of file.blocks) parts.push(printBlockLines(b, 0).join('\n'))
  return `${parts.join('\n\n')}\n`
}

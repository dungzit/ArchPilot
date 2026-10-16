/**
 * Constrained HCL IR (design-v2 4.4.4, red-team review M1 / D-07).
 *
 * The IR is deliberately smaller than HCL. Every shape it can express has a
 * single `terraform fmt`-canonical rendering, which `printer.ts` produces and
 * the `iac-validate` CI job proves with the real binary. The constraints:
 *
 * 1. A template with one expression part and no literal text collapses to the
 *    bare expression (fmt unwraps interpolation-only strings).
 * 2. No heredocs.
 * 3. Comments only as whole `#` lines above a block or an attribute.
 * 4. A multi-line attribute value (non-empty object, list of objects, nested
 *    call argument) and every nested block sit between blank lines, so an
 *    `=` alignment run only ever contains single-line attributes.
 * 5. Object literals print one entry per line; runs of single-line entries
 *    align their `=`.
 * 6. Numbers are integers or plain decimals, never exponent form.
 * 7. Two-space indent, LF, one blank line between top-level blocks, one
 *    trailing newline.
 * 8. Attribute order inside a block is the caller's order; mappings put
 *    meta-arguments first and tags/lifecycle last (see `block()` helpers).
 *
 * Nothing here knows about AWS or vSphere: it is the shared Terraform layer.
 */

/** Whitelisted functions. Anything else is a printer error, so a typo cannot reach a user. */
export type HclFunction =
  | 'alltrue' | 'base64encode' | 'can' | 'cidrhost' | 'cidrsubnet' | 'concat' | 'contains' | 'element'
  | 'format' | 'jsonencode' | 'length' | 'lower' | 'max' | 'merge' | 'min' | 'regex' | 'substr'
  | 'tostring' | 'trimsuffix' | 'yamlencode'

export type BinaryOp = '+' | '-' | '*' | '==' | '!=' | '<' | '<=' | '>' | '>=' | '&&' | '||'

/** Type constraints for `variable` blocks. Printed bare, never quoted. */
export type HclType = 'string' | 'number' | 'bool' | 'list(string)' | 'list(number)' | 'map(string)'

export type Expr =
  | { k: 'str'; v: string }
  | { k: 'num'; v: number }
  | { k: 'bool'; v: boolean }
  | { k: 'null' }
  /** A traversal: `aws_vpc.main.id`, `var.x`, `local.y`, `data.z.names[count.index]`, `aws_subnet.a[*].id`. */
  | { k: 'ref'; path: string }
  | { k: 'list'; items: Expr[] }
  | { k: 'obj'; entries: ObjEntry[] }
  | { k: 'call'; fn: HclFunction; args: Expr[] }
  /** "${local.name_prefix}-orders": literal parts are escaped by the printer. */
  | { k: 'tmpl'; parts: (string | Expr)[] }
  | { k: 'op'; op: BinaryOp; left: Expr; right: Expr }
  | { k: 'not'; operand: Expr }
  | { k: 'cond'; test: Expr; then: Expr; else: Expr }
  | { k: 'paren'; inner: Expr }
  /** `[for <name> in <coll> : <body>]` - used only by list validations. */
  | { k: 'forList'; name: string; coll: Expr; body: Expr }
  | { k: 'type'; t: HclType }

export interface ObjEntry { key: string; value: Expr }

export interface Attribute {
  kind: 'attr'
  name: string
  value: Expr
  /** `#` lines printed above the attribute. */
  comments?: string[]
}

export interface Block {
  kind: 'block'
  type: string
  labels: string[]
  body: BodyItem[]
  comments?: string[]
  /**
   * Security markers (design-v2 4.4.8): the two places `0.0.0.0/0` may appear
   * in a security-group rule, and the one IAM statement that may use
   * `Resource "*"`. Never printed; the security tests read them to tell a
   * deliberate exception from a mistake.
   */
  marks?: SecurityMark[]
}

export type SecurityMark = 'publicListenerIngress' | 'serviceEgress443' | 'iamWildcardResourceRequired' | 'tlsDenyAnyPrincipal'

export type BodyItem = Attribute | Block

/** A whole `.tf` file: header comment lines, then top-level blocks. */
export interface HclFile {
  header: string[]
  blocks: Block[]
}

// ---------------------------------------------------------------- constructors

export const str = (v: string): Expr => ({ k: 'str', v })
export const num = (v: number): Expr => ({ k: 'num', v })
export const bool = (v: boolean): Expr => ({ k: 'bool', v })
export const nul: Expr = { k: 'null' }
export const ref = (path: string): Expr => ({ k: 'ref', path })
export const list = (items: Expr[]): Expr => ({ k: 'list', items })
export const obj = (entries: [string, Expr][]): Expr => ({ k: 'obj', entries: entries.map(([key, value]) => ({ key, value })) })
export const call = (fn: HclFunction, ...args: Expr[]): Expr => ({ k: 'call', fn, args })
export const op = (left: Expr, operator: BinaryOp, right: Expr): Expr => ({ k: 'op', op: operator, left, right })
export const not = (operand: Expr): Expr => ({ k: 'not', operand })
export const cond = (test: Expr, then: Expr, otherwise: Expr): Expr => ({ k: 'cond', test, then, else: otherwise })
export const paren = (inner: Expr): Expr => ({ k: 'paren', inner })
export const forList = (name: string, coll: Expr, body: Expr): Expr => ({ k: 'forList', name, coll, body })
export const type = (t: HclType): Expr => ({ k: 'type', t })

/**
 * A template. Adjacent literal parts are merged, empty literals dropped, and a
 * template that is a single expression collapses to that expression (IR
 * constraint 1), so `"${var.x}"` can never be emitted.
 */
export function tmpl(...parts: (string | Expr)[]): Expr {
  const merged: (string | Expr)[] = []
  for (const part of parts) {
    if (typeof part === 'string') {
      if (part === '') continue
      const last = merged[merged.length - 1]
      if (typeof last === 'string') merged[merged.length - 1] = last + part
      else merged.push(part)
    } else if (part.k === 'str') {
      if (part.v === '') continue
      const last = merged[merged.length - 1]
      if (typeof last === 'string') merged[merged.length - 1] = last + part.v
      else merged.push(part.v)
    } else {
      merged.push(part)
    }
  }
  if (merged.length === 0) return str('')
  if (merged.length === 1) return typeof merged[0] === 'string' ? str(merged[0]) : merged[0]
  if (merged.every((part) => typeof part === 'string')) return str(merged.join(''))
  return { k: 'tmpl', parts: merged }
}

export function attr(name: string, value: Expr, comments?: string[]): Attribute {
  return comments && comments.length > 0 ? { kind: 'attr', name, value, comments } : { kind: 'attr', name, value }
}

export function block(typeName: string, labels: string[], body: BodyItem[], extra: { comments?: string[]; marks?: SecurityMark[] } = {}): Block {
  const out: Block = { kind: 'block', type: typeName, labels, body }
  if (extra.comments && extra.comments.length > 0) out.comments = extra.comments
  if (extra.marks && extra.marks.length > 0) out.marks = extra.marks
  return out
}

export const resource = (resourceType: string, label: string, body: BodyItem[], extra?: { comments?: string[]; marks?: SecurityMark[] }): Block =>
  block('resource', [resourceType, label], body, extra)

export const data = (dataType: string, label: string, body: BodyItem[], extra?: { comments?: string[] }): Block =>
  block('data', [dataType, label], body, extra)

/** Drop `undefined` entries, so mappings can write optional attributes inline. */
export function body(...items: (BodyItem | undefined | false)[]): BodyItem[] {
  return items.filter((item): item is BodyItem => Boolean(item))
}

/** `resource.address` of a resource or data block (`aws_vpc.main`, `data.aws_region.current`). */
export function addressOf(b: Block): string {
  if (b.type === 'resource') return `${b.labels[0]}.${b.labels[1]}`
  if (b.type === 'data') return `data.${b.labels[0]}.${b.labels[1]}`
  if (b.type === 'variable') return `var.${b.labels[0]}`
  if (b.type === 'output') return `output.${b.labels[0]}`
  return `${b.type}${b.labels.map((label) => `.${label}`).join('')}`
}

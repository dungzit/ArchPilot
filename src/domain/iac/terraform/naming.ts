/**
 * Naming rules for Terraform output (design-v2 4.4.5; REQ-IAC-025,
 * NFR2-DET-003).
 *
 * - Labels come only from `codeName` (pattern ^[a-z][a-z0-9_]{0,39}$) plus a
 *   fixed suffix, so a label rename never changes an address.
 * - Resource names are `"${local.name_prefix}-<kebab(codeName)><suffix>"`;
 *   types with a length limit are cut with `substr` and a trailing hyphen is
 *   trimmed, so the name stays valid for AWS.
 * - After planning, every `<type>.<label>` address, variable, output and
 *   local must be unique: a clash (a node called `orders_sg` next to a node
 *   `orders` whose security group is `orders_sg`) is IAC-E04 naming both.
 */
import { kebab } from '../core/text'
import type { IacProblem } from '../core/types'
import { addressOf, call, num, ref, str, tmpl, type Block, type Expr } from './ir'

const LABEL = /^[a-z_][a-z0-9_]{0,63}$/

export function label(codeName: string, suffix = ''): string {
  const out = `${codeName}${suffix}`
  if (!LABEL.test(out)) throw new Error(`label ${JSON.stringify(out)} is not a valid Terraform label`)
  return out
}

/** `"${local.name_prefix}-orders-db<suffix>"`, cut to `max` characters when given. */
export function resourceName(codeName: string, suffix = '', max?: number): Expr {
  const full = tmpl(ref('local.name_prefix'), `-${kebab(codeName)}${suffix}`)
  return max === undefined ? full : call('trimsuffix', call('substr', full, num(0), num(max)), str('-'))
}

export interface NamedThing {
  address: string
  /** The node that caused it, for the error message. */
  codeName?: string
}

/** IAC-E04 for every address used twice. */
export function addressCollisions(things: NamedThing[]): IacProblem[] {
  const first = new Map<string, NamedThing>()
  const out: IacProblem[] = []
  for (const thing of things) {
    const previous = first.get(thing.address)
    if (!previous) {
      first.set(thing.address, thing)
      continue
    }
    const who = [previous.codeName, thing.codeName].filter(Boolean).join(' and ')
    out.push({
      severity: 'error', ruleId: 'IAC-E04', path: 'nodes',
      message: {
        en: `Generated address ${thing.address} is produced twice${who ? ` (by ${who})` : ''}.`,
        vi: `Địa chỉ sinh ra ${thing.address} bị trùng${who ? ` (do ${who})` : ''}.`,
      },
      fix: { en: 'Rename one of the code names.', vi: 'Đổi tên mã của một trong hai thành phần.' },
    })
  }
  return out
}

export function blockAddresses(blocks: { block: Block; codeName?: string }[]): NamedThing[] {
  return blocks.map(({ block, codeName }) => ({ address: addressOf(block), ...(codeName ? { codeName } : {}) }))
}

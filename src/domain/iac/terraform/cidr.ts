/**
 * IPv4 CIDR maths for gate rule IAC-E03 and for the defaults written into
 * variables (design-v2 4.4.10). Strict parsing, matching Go's net.ParseCIDR
 * as Terraform uses it: four decimal octets without leading zeros, a prefix
 * 0..32. Pure integer maths, no dependencies.
 */

export interface Cidr {
  /** Network address as an unsigned 32-bit integer. */
  base: number
  prefix: number
  /** True when host bits were set in the input (for example 10.0.0.1/16). */
  hostBitsSet: boolean
}

const OCTET = /^(0|[1-9][0-9]{0,2})$/

export function parseCidr(text: string): Cidr | undefined {
  const match = /^([^/]+)\/(0|[1-9][0-9]?)$/.exec(text)
  if (!match) return undefined
  const octets = match[1].split('.')
  if (octets.length !== 4 || !octets.every((octet) => OCTET.test(octet) && Number(octet) <= 255)) return undefined
  const prefix = Number(match[2])
  if (prefix > 32) return undefined
  const address = octets.reduce((acc, octet) => acc * 256 + Number(octet), 0)
  const base = maskOf(address, prefix)
  return { base, prefix, hostBitsSet: base !== address }
}

function maskOf(address: number, prefix: number): number {
  if (prefix === 0) return 0
  const size = 2 ** (32 - prefix)
  return address - (address % size)
}

export function formatCidr(cidr: Pick<Cidr, 'base' | 'prefix'>): string {
  const octets = [24, 16, 8, 0].map((shift) => Math.floor(cidr.base / 2 ** shift) % 256)
  return `${octets.join('.')}/${cidr.prefix}`
}

export function sizeOf(cidr: Pick<Cidr, 'prefix'>): number {
  return 2 ** (32 - cidr.prefix)
}

/** `inner` lies entirely inside `outer`. */
export function contains(outer: Pick<Cidr, 'base' | 'prefix'>, inner: Pick<Cidr, 'base' | 'prefix'>): boolean {
  return inner.prefix >= outer.prefix && inner.base >= outer.base && inner.base + sizeOf(inner) <= outer.base + sizeOf(outer)
}

export function overlaps(a: Pick<Cidr, 'base' | 'prefix'>, b: Pick<Cidr, 'base' | 'prefix'>): boolean {
  return a.base < b.base + sizeOf(b) && b.base < a.base + sizeOf(a)
}

/** Terraform's `cidrsubnet(prefix, newbits, netnum)`. */
export function cidrsubnet(parent: Pick<Cidr, 'base' | 'prefix'>, newbits: number, netnum: number): Cidr {
  const prefix = parent.prefix + newbits
  if (prefix > 32) throw new RangeError(`prefix ${parent.prefix} + ${newbits} exceeds 32`)
  if (netnum < 0 || netnum >= 2 ** newbits) throw new RangeError(`netnum ${netnum} does not fit in ${newbits} bits`)
  return { base: parent.base + netnum * 2 ** (32 - prefix), prefix, hostBitsSet: false }
}

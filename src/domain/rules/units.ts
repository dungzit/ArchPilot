/**
 * Units for the rule DSL (docs/v3/05 §3, pilot WP-A).
 *
 * Every unit maps to a factor and a dimension over two base quantities, byte
 * and second. Everything a sizing model counts (keys, hosts, vCPU, requests)
 * is dimensionless on purpose: `req/s` and `IOPS` are both 1/second, and
 * `B/key` is simply bytes. That keeps the check aimed at the errors that
 * actually happen (TB vs TB/s, MB vs Mb, day vs s) without making authors
 * declare a unit algebra for nouns.
 *
 * Unit strings are case-sensitive: `MB` is a megabyte, `Mb` a megabit.
 * A rate is written `X/Y` (`MB/s`, `GB/day`, `req/s`); each extra `/Z`
 * divides again (`MB/s/broker`). `1/s` is accepted for a bare frequency.
 */

/** Exponents of [byte, second]. */
export type Dim = readonly [number, number]

export const DIMENSIONLESS: Dim = [0, 0]

export interface UnitInfo {
  /** Multiply a value in this unit by `factor` to get base units (byte, second). */
  factor: number
  dim: Dim
}

const BYTE: Dim = [1, 0]
const SECOND: Dim = [0, 1]
const PER_SECOND: Dim = [0, -1]
const BYTE_PER_SECOND: Dim = [1, -1]

const DAY = 86_400

/** Single-word units. Compound units (`X/Y`) are built from these. */
const ATOMS: Record<string, UnitInfo> = {
  // Bytes, decimal (SZ1-07: KB = 1000).
  B: { factor: 1, dim: BYTE },
  KB: { factor: 1e3, dim: BYTE },
  kB: { factor: 1e3, dim: BYTE },
  MB: { factor: 1e6, dim: BYTE },
  GB: { factor: 1e9, dim: BYTE },
  TB: { factor: 1e12, dim: BYTE },
  PB: { factor: 1e15, dim: BYTE },
  byte: { factor: 1, dim: BYTE },
  bytes: { factor: 1, dim: BYTE },
  // Bytes, binary (KiB = 1024).
  KiB: { factor: 1024, dim: BYTE },
  MiB: { factor: 1024 ** 2, dim: BYTE },
  GiB: { factor: 1024 ** 3, dim: BYTE },
  TiB: { factor: 1024 ** 4, dim: BYTE },
  PiB: { factor: 1024 ** 5, dim: BYTE },
  // Bits (1 b = 1/8 B).
  b: { factor: 1 / 8, dim: BYTE },
  bit: { factor: 1 / 8, dim: BYTE },
  Kb: { factor: 1e3 / 8, dim: BYTE },
  kb: { factor: 1e3 / 8, dim: BYTE },
  Mb: { factor: 1e6 / 8, dim: BYTE },
  Gb: { factor: 1e9 / 8, dim: BYTE },
  Tb: { factor: 1e12 / 8, dim: BYTE },
  // Bit rates.
  bps: { factor: 1 / 8, dim: BYTE_PER_SECOND },
  Kbps: { factor: 1e3 / 8, dim: BYTE_PER_SECOND },
  kbps: { factor: 1e3 / 8, dim: BYTE_PER_SECOND },
  Mbps: { factor: 1e6 / 8, dim: BYTE_PER_SECOND },
  Gbps: { factor: 1e9 / 8, dim: BYTE_PER_SECOND },
  Tbps: { factor: 1e12 / 8, dim: BYTE_PER_SECOND },
  // Time. A month is 30 days and a year 365 days: planning conventions, not calendar ones.
  ms: { factor: 1e-3, dim: SECOND },
  s: { factor: 1, dim: SECOND },
  sec: { factor: 1, dim: SECOND },
  min: { factor: 60, dim: SECOND },
  h: { factor: 3600, dim: SECOND },
  hour: { factor: 3600, dim: SECOND },
  day: { factor: DAY, dim: SECOND },
  days: { factor: DAY, dim: SECOND },
  week: { factor: 7 * DAY, dim: SECOND },
  month: { factor: 30 * DAY, dim: SECOND },
  year: { factor: 365 * DAY, dim: SECOND },
  // Operation rates.
  IOPS: { factor: 1, dim: PER_SECOND },
  TPS: { factor: 1, dim: PER_SECOND },
  QPS: { factor: 1, dim: PER_SECOND },
  RPS: { factor: 1, dim: PER_SECOND },
  // Dimensionless.
  // A % value is a fraction in base units (90% is 0.9); the engine rejects comparing one with a literal above 1.
  '%': { factor: 0.01, dim: DIMENSIONLESS },
  '1': { factor: 1, dim: DIMENSIONLESS },
}

/**
 * Count nouns: dimensionless, factor 1. The first group is the spec list; the
 * rest are synonyms authors reach for in sizing sheets.
 */
const COUNT_NOUNS = [
  'count', 'ratio', 'x', 'core', 'vCPU', 'host', 'node', 'broker', 'shard', 'instance', 'key', 'user', 'req', 'disk',
  'pCore', 'cpu', 'vcpu', 'thread', 'socket', 'server', 'vm', 'VM', 'pod', 'replica', 'partition', 'conn',
  'connection', 'msg', 'message', 'txn', 'tx', 'op', 'ops', 'item', 'record', 'row', 'file', 'object', 'event',
  'request', 'session', 'device', 'page',
]
for (const noun of COUNT_NOUNS) ATOMS[noun] = { factor: 1, dim: DIMENSIONLESS }

/** Units whose symbol adds nothing when printed after a number in a trace. */
const SILENT_UNITS = new Set(['', 'count', 'ratio', '1'])

export function dimEquals(a: Dim, b: Dim): boolean {
  return a[0] === b[0] && a[1] === b[1]
}

export function isDimensionless(dim: Dim): boolean {
  return dim[0] === 0 && dim[1] === 0
}

export function dimMul(a: Dim, b: Dim): Dim {
  return [a[0] + b[0], a[1] + b[1]]
}

export function dimDiv(a: Dim, b: Dim): Dim {
  return [a[0] - b[0], a[1] - b[1]]
}

export function dimPow(a: Dim, exponent: number): Dim {
  return [a[0] * exponent, a[1] * exponent]
}

/** `byte/second`, `1/second`, `byte^2`, `dimensionless`: what compile errors print. */
export function formatDim(dim: Dim): string {
  if (isDimensionless(dim)) return 'dimensionless'
  const part = (name: string, exp: number) => (Math.abs(exp) === 1 ? name : `${name}^${trimNumber(Math.abs(exp))}`)
  const up: string[] = []
  const down: string[] = []
  if (dim[0] > 0) up.push(part('byte', dim[0]))
  if (dim[0] < 0) down.push(part('byte', dim[0]))
  if (dim[1] > 0) up.push(part('second', dim[1]))
  if (dim[1] < 0) down.push(part('second', dim[1]))
  const top = up.length ? up.join('*') : '1'
  return down.length ? `${top}/${down.join('/')}` : top
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(6)))
}

const unitCache = new Map<string, UnitInfo | null>()

/**
 * Parse a unit string. `''` is dimensionless. Returns null for an unknown unit,
 * so the caller can name the field in its error.
 */
export function parseUnit(raw: string): UnitInfo | null {
  const unit = raw.trim()
  const cached = unitCache.get(unit)
  if (cached !== undefined) return cached
  const parsed = parseUncached(unit)
  unitCache.set(unit, parsed)
  return parsed
}

function parseUncached(unit: string): UnitInfo | null {
  if (unit === '') return { factor: 1, dim: DIMENSIONLESS }
  const parts = unit.split('/').map((part) => part.trim())
  if (parts.some((part) => part === '')) return null
  let factor = 1
  let dim: Dim = DIMENSIONLESS
  for (let index = 0; index < parts.length; index += 1) {
    const atom = ATOMS[parts[index]]
    if (!atom) return null
    if (index === 0) {
      factor = atom.factor
      dim = atom.dim
    } else {
      factor /= atom.factor
      dim = dimDiv(dim, atom.dim)
    }
  }
  return { factor, dim }
}

/** True when a result card should print the number without its unit (`3`, not `3 count`). */
export function isSilentUnit(unit: string): boolean {
  return SILENT_UNITS.has(unit.trim())
}

/**
 * True for count nouns (`broker`, `host`, `vCPU`, `x`): dimensionless with
 * factor 1. A trace prints them bare, so it reads `max(8, 14, 3)` as in
 * docs/v3/02 §10, while `150 MB/s`, `3 day` and `70%` keep their units.
 */
export function isCountUnit(unit: string): boolean {
  const parsed = parseUnit(unit)
  return parsed !== null && parsed.factor === 1 && isDimensionless(parsed.dim)
}

/** Every single-word unit, for editor autocomplete and docs. */
export function knownUnitAtoms(): string[] {
  return Object.keys(ATOMS)
}

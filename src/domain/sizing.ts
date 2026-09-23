/**
 * Capacity sizing engine — corrected per red-team blocker B3.
 *
 * `docs/architecture/reviews/review-systemsarchitect-prototype.md` B3 found four
 * defects in the v1.0 formulas. All four are fixed here, and the file is
 * `formulaVersion: '2.0'` because the numbers it produces are different:
 *
 *   B3(a) `replicationFactor` was applied to storage only. Three replicas is
 *         exactly the 3x write amplification that sizes a database tier, so
 *         v1.0 **under-sized** every write-heavy cluster. Replication now
 *         multiplies write throughput as well as bytes.
 *   B3(b) `sizeApi(peakRps, capacityPerInstance, …)` took ONE capacity number,
 *         but the design's own benchmark table gives a database TWO (8,000 read
 *         qps / 2,000 write qps). The formula structurally could not consume its
 *         own inputs. Node count is now driven by the binding side of a dual
 *         read/write benchmark.
 *   B3(c) There was no compression term, so storage was overstated by close to
 *         an order of magnitude for JSON-like records. `compressionRatio` is now
 *         a first-class, visible input — default 1.0, labelled "not modelled",
 *         so the honest answer stays the default and the optimistic one is a
 *         deliberate act.
 *   B3(d) There was no failure-domain spare: a capacity plan that assumes
 *         nothing ever fails. `spareNodes` defaults to 1 and is added *outside*
 *         the uncertainty band, because a spare is a policy, not an estimate.
 *
 * Also carried: red-team M8 — the hard-coded `*0.8 / *1.25` band is replaced by
 * a band derived from the weakest input benchmark's confidence tag, and
 * `assumptions` + `formula` are **required** by the result type so a number
 * cannot be rendered without the arithmetic that produced it (NFR-USE-002).
 *
 * Design constraint (build-scope D3): this arithmetic exists **only** in
 * TypeScript. The server stores results and owns the benchmark inputs; it never
 * computes a sizing number. One implementation means client/server drift is
 * impossible by construction rather than by discipline. Keep it pure: no fetch,
 * no imports beyond `./model`.
 */
import type { Confidence } from './model'

export type SizingDomain = 'api' | 'database' | 'kubernetes' | 'storage' | 'network' | 'firewall'

export const SIZING_FORMULA_VERSION = '2.0'

/* ------------------------------------------------------------------ *
 * Conversion constants. Named and exported on purpose (red-team m3):
 * every magic number in this file has to be defensible in a review.
 * ------------------------------------------------------------------ */

/** 1 KiB = 1024 B. Binary, not 1000 — storage vendors use decimal, our records don't. */
export const BYTES_PER_KIB = 1024
/** 1 GiB = 1024^3 B. */
export const BYTES_PER_GIB = 1024 ** 3
/** 1 TiB = 1024^4 B. */
export const BYTES_PER_TIB = 1024 ** 4
export const SECONDS_PER_DAY = 86_400
/** Mean Gregorian month: 365.2425 / 12. Using 30 loses ~1.5% of a year. */
export const DAYS_PER_MONTH = 30.44

/** Red-team M8: the band is derived from evidence quality, not hard-coded. */
export const CONFIDENCE_BAND: Record<Confidence, number> = {
  measured: 0.1,
  declared: 0.25,
  estimated: 0.5,
  unverified: 1.0,
}

/** Weakest-first ordering used to pick the band for a multi-input result. */
const CONFIDENCE_RANK: Record<Confidence, number> = {
  measured: 0,
  declared: 1,
  estimated: 2,
  unverified: 3,
}

export function weakestConfidence(...values: Confidence[]): Confidence {
  if (values.length === 0) return 'unverified'
  return values.reduce((worst, next) =>
    CONFIDENCE_RANK[next] > CONFIDENCE_RANK[worst] ? next : worst,
  )
}

/* ------------------------------------------------------------------ *
 * Inputs
 * ------------------------------------------------------------------ */

export interface WorkloadInputs {
  /** Average requests per second across the whole component, reads + writes. */
  avgQps: number
  /** Average size of one record on the wire/at rest, in KiB. */
  avgRecordKiB: number
  /** Reads per write. `9` means a 9:1 read:write mix. `0` means write-only. */
  readWriteRatio: number
  /** How long written data is kept. Drives storage, not throughput. */
  retentionMonths: number
  /** Peak-to-average multiplier. Default 3.0. */
  peakFactor?: number
  /** Copies of every write. Default 3. B3(a): this amplifies WRITES too. */
  replicationFactor?: number
  /** Index/metadata expansion on top of raw bytes. Default 0.30. */
  indexOverhead?: number
  /** B3(c). 1.0 = compression not modelled. 3.0–10.0 is typical for JSON. */
  compressionRatio?: number
  /** Spare capacity per node so utilisation is not 100%. Default 0.30. */
  headroom?: number
  /** B3(d). Nodes that may fail without the plan failing. Default 1. */
  spareNodes?: number
}

export type ResolvedInputs = Required<WorkloadInputs>

export const SIZING_DEFAULTS = {
  peakFactor: 3.0,
  replicationFactor: 3,
  indexOverhead: 0.3,
  compressionRatio: 1.0,
  headroom: 0.3,
  spareNodes: 1,
} as const

/**
 * B3(b): a per-node benchmark carries TWO capacity numbers, because a database
 * does not read and write at the same rate. `capacityPerInstance` is gone.
 */
export interface NodeBenchmark {
  componentType: string
  readQpsPerNode: number
  writeQpsPerNode: number
  confidence: Confidence
  /** Red-team M7: `measured`/`declared` without a citation is not defensible. */
  sourceUrl?: string
  sourceTitle?: string
  basis?: string
}

/**
 * Fallback benchmarks, used only until `GET /api/benchmarks` responds (task 3.3).
 * The authoritative, cited rows live in the `benchmarks` table, where a trigger
 * already refuses a `declared`/`measured` row with no `source_url` (M7). Nothing
 * here is cited, so nothing here is tagged better than `estimated`.
 */
export const DEFAULT_NODE_BENCHMARKS: Record<string, NodeBenchmark> = {
  service: {
    componentType: 'service',
    readQpsPerNode: 1_000,
    writeQpsPerNode: 1_000,
    confidence: 'estimated',
    basis: '4 vCPU JSON API, industry rule of thumb, p99 < 50 ms',
  },
  database: {
    componentType: 'database',
    readQpsPerNode: 8_000,
    writeQpsPerNode: 2_000,
    confidence: 'estimated',
    basis: '8 vCPU, NVMe, Postgres-like, rule of thumb',
  },
  cache: {
    componentType: 'cache',
    readQpsPerNode: 80_000,
    writeQpsPerNode: 80_000,
    confidence: 'estimated',
    basis: 'Redis single shard; downgraded from "declared" per red-team M7 — no citation yet',
  },
}

/* ------------------------------------------------------------------ *
 * Results
 * ------------------------------------------------------------------ */

export interface SizingRange {
  low: number
  expected: number
  high: number
}

export interface SizingResult {
  formulaId: string
  formulaVersion: string
  domain: SizingDomain
  value: number
  unit: string
  range: SizingRange
  confidence: Confidence
  warnings: string[]
  /** Required, not optional: a number without its assumptions is a liability. */
  assumptions: string[]
  /** Required: the literal arithmetic, renderable in the `[why?]` popover. */
  formula: string
  inputSnapshot: Record<string, number | string>
}

export interface ThroughputBreakdown {
  readQps: number
  writeQps: number
  peakReadQps: number
  peakWriteQps: number
  /** B3(a): what the storage tier actually has to absorb. */
  effectiveWriteQps: number
  ingressBytesPerSec: number
  egressBytesPerSec: number
}

export interface ComponentSizing {
  inputs: ResolvedInputs
  benchmark: NodeBenchmark
  throughput: ThroughputBreakdown
  nodes: SizingResult
  storage: SizingResult
  warnings: string[]
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

export function resolveInputs(inputs: WorkloadInputs): ResolvedInputs {
  const resolved: ResolvedInputs = { ...SIZING_DEFAULTS, ...stripUndefined(inputs) }

  requirePositive('avgQps', resolved.avgQps)
  requirePositive('avgRecordKiB', resolved.avgRecordKiB)
  requirePositive('retentionMonths', resolved.retentionMonths)
  if (!Number.isFinite(resolved.readWriteRatio) || resolved.readWriteRatio < 0) {
    throw new RangeError('readWriteRatio must be >= 0 (0 = write-only)')
  }
  if (resolved.peakFactor < 1) throw new RangeError('peakFactor must be >= 1')
  if (!Number.isInteger(resolved.replicationFactor) || resolved.replicationFactor < 1) {
    throw new RangeError('replicationFactor must be an integer >= 1')
  }
  if (resolved.indexOverhead < 0) throw new RangeError('indexOverhead cannot be negative')
  if (resolved.compressionRatio < 1) {
    // < 1 would mean compression makes data bigger. That is an input error, not
    // a scenario: it silently shrinks a storage plan if we let it through.
    throw new RangeError('compressionRatio must be >= 1 (1.0 = not modelled)')
  }
  if (resolved.headroom < 0 || resolved.headroom > 2) {
    throw new RangeError('headroom must be between 0 and 2')
  }
  if (!Number.isInteger(resolved.spareNodes) || resolved.spareNodes < 0) {
    throw new RangeError('spareNodes must be an integer >= 0')
  }
  return resolved
}

function stripUndefined(inputs: WorkloadInputs): WorkloadInputs {
  return Object.fromEntries(
    Object.entries(inputs).filter(([, value]) => value !== undefined),
  ) as WorkloadInputs
}

function requirePositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be > 0`)
}

export function assertBenchmark(benchmark: NodeBenchmark): void {
  requirePositive('readQpsPerNode', benchmark.readQpsPerNode)
  requirePositive('writeQpsPerNode', benchmark.writeQpsPerNode)
}

/* ------------------------------------------------------------------ *
 * Term 0 — throughput split
 * ------------------------------------------------------------------ */

export function deriveThroughput(inputs: WorkloadInputs): ThroughputBreakdown {
  const resolved = resolveInputs(inputs)
  const writeFraction = 1 / (1 + resolved.readWriteRatio)
  const readQps = resolved.avgQps * (1 - writeFraction)
  const writeQps = resolved.avgQps * writeFraction
  const recordBytes = resolved.avgRecordKiB * BYTES_PER_KIB
  const peakWriteQps = writeQps * resolved.peakFactor

  return {
    readQps,
    writeQps,
    peakReadQps: readQps * resolved.peakFactor,
    peakWriteQps,
    // B3(a). Every replica absorbs the write. This is the line whose absence
    // under-sized every replicated database in v1.0.
    effectiveWriteQps: peakWriteQps * resolved.replicationFactor,
    ingressBytesPerSec: writeQps * recordBytes,
    egressBytesPerSec: readQps * recordBytes,
  }
}

/* ------------------------------------------------------------------ *
 * Term 1 — node count (B3(a) + B3(b) + B3(d))
 * ------------------------------------------------------------------ */

const NODE_FORMULA =
  'ceil( max(peakReadQps / readQpsPerNode, peakWriteQps * replicationFactor / writeQpsPerNode)' +
  ' * (1 + headroom) ) + spareNodes'

export function sizeNodeCount(
  inputs: WorkloadInputs,
  benchmark: NodeBenchmark,
  domain: SizingDomain = 'database',
): SizingResult {
  const resolved = resolveInputs(inputs)
  assertBenchmark(benchmark)
  const throughput = deriveThroughput(resolved)

  const readNodes = throughput.peakReadQps / benchmark.readQpsPerNode
  // B3(a) is inside effectiveWriteQps; B3(b) is the separate writeQpsPerNode.
  const writeNodes = throughput.effectiveWriteQps / benchmark.writeQpsPerNode
  const bindingSide = writeNodes >= readNodes ? 'write' : 'read'

  const demandNodes = Math.ceil(Math.max(readNodes, writeNodes) * (1 + resolved.headroom))
  // B3(d). The spare sits OUTSIDE the uncertainty band: how many nodes may fail
  // is a policy the team chooses, not something the benchmark is uncertain about.
  const expected = demandNodes + resolved.spareNodes

  const band = CONFIDENCE_BAND[benchmark.confidence]
  const range: SizingRange = {
    low: Math.max(1, Math.ceil(demandNodes * (1 - band))) + resolved.spareNodes,
    expected,
    high: Math.ceil(demandNodes * (1 + band)) + resolved.spareNodes,
  }

  return {
    formulaId: 'sizing.node_count',
    formulaVersion: SIZING_FORMULA_VERSION,
    domain,
    value: expected,
    unit: 'node',
    range,
    confidence: benchmark.confidence,
    warnings: nodeWarnings(resolved, benchmark),
    assumptions: [
      `Peak is ${resolved.peakFactor}x average.`,
      `Read/write mix ${resolved.readWriteRatio}:1 → ${round(throughput.readQps, 1)} read qps / ${round(throughput.writeQps, 1)} write qps average.`,
      `Replication factor ${resolved.replicationFactor} applied to writes as well as to stored bytes (red-team B3a).`,
      `Per node: ${benchmark.readQpsPerNode} read qps / ${benchmark.writeQpsPerNode} write qps (${benchmark.confidence}${benchmark.basis ? `, ${benchmark.basis}` : ''}).`,
      `The ${bindingSide} side binds: ${round(Math.max(readNodes, writeNodes), 2)} nodes of raw demand before headroom.`,
      `Headroom ${Math.round(resolved.headroom * 100)}% → ${demandNodes} nodes, plus ${resolved.spareNodes} failure-domain spare (red-team B3d).`,
      `Range is ±${Math.round(band * 100)}% on the demand term, from the benchmark's "${benchmark.confidence}" tag (red-team M8).`,
    ],
    formula: NODE_FORMULA,
    inputSnapshot: {
      avgQps: resolved.avgQps,
      readWriteRatio: resolved.readWriteRatio,
      peakFactor: resolved.peakFactor,
      replicationFactor: resolved.replicationFactor,
      headroom: resolved.headroom,
      spareNodes: resolved.spareNodes,
      readQpsPerNode: benchmark.readQpsPerNode,
      writeQpsPerNode: benchmark.writeQpsPerNode,
      bindingSide,
      benchmarkConfidence: benchmark.confidence,
    },
  }
}

function nodeWarnings(resolved: ResolvedInputs, benchmark: NodeBenchmark): string[] {
  const warnings: string[] = []
  if (resolved.spareNodes === 0) {
    warnings.push(
      'No failure-domain spare: this plan is sized to exactly N nodes, so losing one node loses capacity.',
    )
  }
  if (resolved.replicationFactor === 1) {
    warnings.push('Replication factor 1: a single copy of every write, no redundancy.')
  }
  if (resolved.peakFactor === 1) {
    warnings.push('Peak factor 1.0: the plan assumes traffic never exceeds its average.')
  }
  if (benchmark.confidence === 'estimated' || benchmark.confidence === 'unverified') {
    warnings.push(
      `Per-node capacity is "${benchmark.confidence}" — it has not been benchmarked on your hardware.`,
    )
  }
  if (
    (benchmark.confidence === 'measured' || benchmark.confidence === 'declared') &&
    !benchmark.sourceUrl
  ) {
    warnings.push(
      `Benchmark is tagged "${benchmark.confidence}" but carries no source URL; it cannot be checked (red-team M7).`,
    )
  }
  return warnings
}

/* ------------------------------------------------------------------ *
 * Term 2 — storage (B3(c))
 * ------------------------------------------------------------------ */

const STORAGE_FORMULA =
  'writeQps * avgRecordKiB * 1024 * 86400 * (retentionMonths * 30.44)' +
  ' * replicationFactor * (1 + indexOverhead) / compressionRatio'

export function sizeStorage(
  inputs: WorkloadInputs,
  confidence: Confidence = 'estimated',
): SizingResult {
  const resolved = resolveInputs(inputs)
  const throughput = deriveThroughput(resolved)

  const recordBytes = resolved.avgRecordKiB * BYTES_PER_KIB
  const bytesPerDay = throughput.writeQps * recordBytes * SECONDS_PER_DAY
  const retentionDays = resolved.retentionMonths * DAYS_PER_MONTH

  const bytes =
    (bytesPerDay *
      retentionDays *
      resolved.replicationFactor *
      (1 + resolved.indexOverhead)) /
    // B3(c). Default 1.0 keeps the honest (pessimistic) answer the default.
    resolved.compressionRatio

  const expected = bytes / BYTES_PER_GIB
  const band = CONFIDENCE_BAND[confidence]

  return {
    formulaId: 'sizing.storage.capacity',
    formulaVersion: SIZING_FORMULA_VERSION,
    domain: 'storage',
    // Deliberately NOT rounded. Rounding here is a presentation concern that
    // leaks into arithmetic: at 117,000 GiB two decimal places are noise, and a
    // rounded value makes `uncompressed / compressed` stop being exactly the
    // compression ratio. The UI formats; the domain stays exact.
    value: expected,
    unit: 'GiB',
    range: {
      low: Math.max(0, expected * (1 - band)),
      expected,
      high: expected * (1 + band),
    },
    confidence,
    warnings: storageWarnings(resolved),
    assumptions: [
      `${round(throughput.writeQps, 1)} writes/s at ${resolved.avgRecordKiB} KiB (1 KiB = ${BYTES_PER_KIB} B) → ${round(bytesPerDay / BYTES_PER_GIB, 2)} GiB/day raw.`,
      `Retention ${resolved.retentionMonths} months = ${round(retentionDays, 1)} days (1 month = ${DAYS_PER_MONTH} days).`,
      `Replication factor ${resolved.replicationFactor}.`,
      `Index/metadata overhead ${Math.round(resolved.indexOverhead * 100)}%.`,
      resolved.compressionRatio === 1
        ? 'Compression NOT modelled (ratio 1.0) — this figure is an upper bound (red-team B3c).'
        : `Compression ratio ${resolved.compressionRatio}:1 applied (red-team B3c).`,
      `Storage is driven by average write rate, not peak: peaks change node count, not the retained byte count.`,
      `Range is ±${Math.round(band * 100)}% from the "${confidence}" tag (red-team M8).`,
    ],
    formula: STORAGE_FORMULA,
    inputSnapshot: {
      avgQps: resolved.avgQps,
      avgRecordKiB: resolved.avgRecordKiB,
      readWriteRatio: resolved.readWriteRatio,
      retentionMonths: resolved.retentionMonths,
      replicationFactor: resolved.replicationFactor,
      indexOverhead: resolved.indexOverhead,
      compressionRatio: resolved.compressionRatio,
    },
  }
}

function storageWarnings(resolved: ResolvedInputs): string[] {
  const warnings: string[] = []
  if (resolved.compressionRatio === 1) {
    warnings.push(
      'Compression is not modelled (ratio 1.0). Real compression for JSON-like records is typically 3–10x, so this figure is an upper bound, not an estimate.',
    )
  }
  if (resolved.retentionMonths > 24 && resolved.compressionRatio === 1) {
    warnings.push(
      `Retention of ${resolved.retentionMonths} months with no compression term dominates this number. Check the retention requirement before buying disk.`,
    )
  }
  if (resolved.compressionRatio > 10) {
    warnings.push(
      `Compression ratio ${resolved.compressionRatio}:1 is higher than typical (3–10x). Verify it against your own data before relying on it.`,
    )
  }
  return warnings
}

/* ------------------------------------------------------------------ *
 * Composite
 * ------------------------------------------------------------------ */

export function sizeComponent(
  inputs: WorkloadInputs,
  benchmark: NodeBenchmark,
  domain: SizingDomain = 'database',
): ComponentSizing {
  const resolved = resolveInputs(inputs)
  const throughput = deriveThroughput(resolved)
  const nodes = sizeNodeCount(resolved, benchmark, domain)
  const storage = sizeStorage(
    resolved,
    // Storage inherits the weakest evidence in play: no point claiming ±10% on
    // bytes when the workload numbers came from the same estimate as the nodes.
    weakestConfidence(benchmark.confidence, 'estimated'),
  )

  return {
    inputs: resolved,
    benchmark,
    throughput,
    nodes,
    storage,
    warnings: [...new Set([...nodes.warnings, ...storage.warnings])],
  }
}

/**
 * Human-readable range, e.g. `14–30 node (point estimate 20)` (red-team M8).
 * Rounding happens here, at the presentation edge, and nowhere else.
 */
export function formatRange(result: SizingResult): string {
  const show = (value: number) => String(Number.isInteger(value) ? value : round(value, 2))
  return `${show(result.range.low)}–${show(result.range.high)} ${result.unit} (point estimate ${show(result.range.expected)})`
}

export function gibToTib(gib: number): number {
  return (gib * BYTES_PER_GIB) / BYTES_PER_TIB
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/**
 * Sizing engine tests — one per red-team B3 term, each showing the v1.0 → v2.0
 * numeric difference so the fix is provably correct rather than plausible.
 *
 * Reference: docs/architecture/reviews/review-systemsarchitect-prototype.md, B3.
 * Reference: docs/development/systemsarchitect-build-scope.md §3.6, task 3.1/3.2.
 *
 * The `legacy*` helpers below are the v1.0 arithmetic copied verbatim from the
 * pre-fix `sizing.ts`. They exist ONLY in this file and ONLY to quantify the
 * delta; nothing in `src/` imports them.
 */
import { describe, expect, it } from 'vitest'
import {
  BYTES_PER_GIB,
  BYTES_PER_KIB,
  CONFIDENCE_BAND,
  DAYS_PER_MONTH,
  DEFAULT_NODE_BENCHMARKS,
  SECONDS_PER_DAY,
  SIZING_DEFAULTS,
  SIZING_FORMULA_VERSION,
  deriveThroughput,
  formatRange,
  gibToTib,
  resolveInputs,
  sizeComponent,
  sizeNodeCount,
  sizeStorage,
  weakestConfidence,
  type NodeBenchmark,
  type WorkloadInputs,
} from './sizing'

/** v1.0 `sizeApi`: ONE capacity number, replication ignored, no spare. */
function legacyNodeCount(peakRps: number, capacityPerInstance: number, headroom: number): number {
  return Math.ceil((peakRps / capacityPerInstance) * (1 + headroom))
}

/** v1.0 `sizeStorage`: no compression term anywhere in the expression. */
function legacyStorageGib(
  dailyGib: number,
  retentionDays: number,
  replicationFactor: number,
  overhead: number,
): number {
  return dailyGib * retentionDays * replicationFactor * (1 + overhead)
}

const DATABASE: NodeBenchmark = DEFAULT_NODE_BENCHMARKS.database

/** The worked example named in task 3.1: 5000 QPS / 2 KiB / 9:1 / 12 months. */
const WORKED_EXAMPLE: WorkloadInputs = {
  avgQps: 5_000,
  avgRecordKiB: 2,
  readWriteRatio: 9,
  retentionMonths: 12,
}

/** A write-heavy variant. Every B3 defect is largest where writes dominate. */
const WRITE_HEAVY: WorkloadInputs = {
  avgQps: 5_000,
  avgRecordKiB: 2,
  readWriteRatio: 1,
  retentionMonths: 12,
  spareNodes: 0, // isolated in its own test, held at 0 here
}

// ---------------------------------------------------------------------------
// B3(a) — replication must amplify WRITE THROUGHPUT, not only stored bytes
// ---------------------------------------------------------------------------

describe('B3(a) replication applies to write throughput', () => {
  it('a 3x replicated write path needs 3x the write capacity (5 nodes -> 15)', () => {
    const withoutReplication = sizeNodeCount({ ...WRITE_HEAVY, replicationFactor: 1 }, DATABASE)
    const withReplication = sizeNodeCount({ ...WRITE_HEAVY, replicationFactor: 3 }, DATABASE)

    // BEFORE (v1.0): replicationFactor touched storage only, so both of these
    // sized to the replication-1 answer and a 3-replica cluster shipped at 1/3
    // of the write capacity it needs.
    expect(withoutReplication.value).toBe(5)
    // AFTER (v2.0): the write side is amplified before it is compared.
    expect(withReplication.value).toBe(15)
    expect(withReplication.value / withoutReplication.value).toBe(3)
  })

  it('exposes effectiveWriteQps = peakWriteQps * replicationFactor', () => {
    const t = deriveThroughput({ ...WRITE_HEAVY, replicationFactor: 3 })
    expect(t.writeQps).toBe(2_500)
    expect(t.peakWriteQps).toBe(7_500) // peakFactor 3.0
    expect(t.effectiveWriteQps).toBe(22_500) // B3(a): the line that was missing
  })

  it('states the replication assumption next to the number', () => {
    const result = sizeNodeCount(WORKED_EXAMPLE, DATABASE)
    expect(result.assumptions.join(' ')).toContain('applied to writes as well as to stored bytes')
    expect(result.inputSnapshot.bindingSide).toBe('write')
  })
})

// ---------------------------------------------------------------------------
// B3(b) — dual read/write benchmark instead of one generic capacity figure
// ---------------------------------------------------------------------------

describe('B3(b) node count consumes the dual read/write benchmark', () => {
  it('the v1.0 single-capacity formula under-sizes a write-heavy tier (3 -> 15)', () => {
    // v1.0 took ONE capacity number. The design's own table gives a database
    // two (8,000 read qps / 2,000 write qps), and the mockup used the read one.
    const legacy = legacyNodeCount(
      WRITE_HEAVY.avgQps * SIZING_DEFAULTS.peakFactor, // 15,000 peak rps
      DATABASE.readQpsPerNode, // 8,000 — the only number it could take
      SIZING_DEFAULTS.headroom,
    )
    expect(legacy).toBe(3)

    const corrected = sizeNodeCount({ ...WRITE_HEAVY, replicationFactor: 3 }, DATABASE)
    expect(corrected.value).toBe(15)
  })

  it('changing ONLY writeQpsPerNode changes the answer — v1.0 structurally could not', () => {
    const slowWrites = sizeNodeCount(WRITE_HEAVY, { ...DATABASE, writeQpsPerNode: 2_000 })
    const fastWrites = sizeNodeCount(WRITE_HEAVY, { ...DATABASE, writeQpsPerNode: 4_000 })

    expect(slowWrites.value).toBe(15)
    expect(fastWrites.value).toBe(8)

    // The v1.0 signature took one capacity, so both benchmarks collapsed to the
    // same input and produced the same answer. That is the defect, quantified.
    const legacySlow = legacyNodeCount(15_000, DATABASE.readQpsPerNode, 0.3)
    const legacyFast = legacyNodeCount(15_000, DATABASE.readQpsPerNode, 0.3)
    expect(legacySlow).toBe(legacyFast)
  })

  it('picks the binding side, read or write, per workload', () => {
    const readHeavy = sizeNodeCount(
      { avgQps: 5_000, avgRecordKiB: 2, readWriteRatio: 999, retentionMonths: 12 },
      DATABASE,
    )
    expect(readHeavy.inputSnapshot.bindingSide).toBe('read')

    const writeHeavy = sizeNodeCount({ ...WRITE_HEAVY, replicationFactor: 3 }, DATABASE)
    expect(writeHeavy.inputSnapshot.bindingSide).toBe('write')
  })
})

// ---------------------------------------------------------------------------
// B3(c) — compression term
// ---------------------------------------------------------------------------

describe('B3(c) storage carries a compression term', () => {
  it('reproduces the v1.0 number at ratio 1.0, then divides by the ratio', () => {
    const uncompressed = sizeStorage({ ...WORKED_EXAMPLE, compressionRatio: 1 })
    const compressed10 = sizeStorage({ ...WORKED_EXAMPLE, compressionRatio: 10 })

    // BEFORE: v1.0 had no compression term, so its answer is exactly v2.0 at
    // ratio 1.0 — proving the only change to this expression is the new divisor.
    const writeQps = WORKED_EXAMPLE.avgQps * (1 / (1 + WORKED_EXAMPLE.readWriteRatio))
    const dailyGib =
      (writeQps * WORKED_EXAMPLE.avgRecordKiB * BYTES_PER_KIB * SECONDS_PER_DAY) / BYTES_PER_GIB
    const legacy = legacyStorageGib(
      dailyGib,
      WORKED_EXAMPLE.retentionMonths * DAYS_PER_MONTH,
      SIZING_DEFAULTS.replicationFactor,
      SIZING_DEFAULTS.indexOverhead,
    )
    expect(uncompressed.value).toBeCloseTo(legacy, 1)

    // AFTER: 114.6 TiB of claimed disk becomes 11.5 TiB at a realistic 10:1.
    expect(gibToTib(uncompressed.value)).toBeCloseTo(114.63, 1)
    expect(gibToTib(compressed10.value)).toBeCloseTo(11.46, 1)
    expect(uncompressed.value / compressed10.value).toBeCloseTo(10, 6)
  })

  it('defaults to 1.0 and says so, so the honest answer is the default', () => {
    expect(SIZING_DEFAULTS.compressionRatio).toBe(1.0)
    const result = sizeStorage(WORKED_EXAMPLE)
    expect(result.warnings.join(' ')).toContain('Compression is not modelled')
    expect(result.assumptions.join(' ')).toContain('upper bound')
  })

  it('refuses a ratio below 1, which would silently shrink the plan', () => {
    expect(() => sizeStorage({ ...WORKED_EXAMPLE, compressionRatio: 0.5 })).toThrow(RangeError)
  })

  it('warns when long retention meets an unmodelled compression term', () => {
    const result = sizeStorage({ ...WORKED_EXAMPLE, retentionMonths: 36 })
    expect(result.warnings.join(' ')).toContain('36 months with no compression term')
  })
})

// ---------------------------------------------------------------------------
// B3(d) — failure-domain spare
// ---------------------------------------------------------------------------

describe('B3(d) failure-domain spare node', () => {
  it('adds the spare on top of demand (3 -> 4 on the worked example)', () => {
    const noSpare = sizeNodeCount({ ...WORKED_EXAMPLE, spareNodes: 0 }, DATABASE)
    const oneSpare = sizeNodeCount(WORKED_EXAMPLE, DATABASE)

    expect(noSpare.value).toBe(3) // BEFORE: v1.0 had no spare term at all
    expect(oneSpare.value).toBe(4) // AFTER
    expect(SIZING_DEFAULTS.spareNodes).toBe(1)
  })

  it('the spared plan survives one node loss; the unspared plan does not', () => {
    // Raw demand before headroom: peakWrite*rf / writeCap = 4500/2000 = 2.25 -> 3 nodes.
    const rawDemandNodes = 3
    const noSpare = sizeNodeCount({ ...WORKED_EXAMPLE, spareNodes: 0 }, DATABASE)
    const oneSpare = sizeNodeCount(WORKED_EXAMPLE, DATABASE)

    expect(oneSpare.value - 1).toBeGreaterThanOrEqual(rawDemandNodes)
    expect(noSpare.value - 1).toBeLessThan(rawDemandNodes)
  })

  it('keeps the spare outside the uncertainty band — it is policy, not estimate', () => {
    // demand 3, estimated band +-50% -> 2..5 nodes of demand, +1 spare on each.
    const result = sizeNodeCount(WORKED_EXAMPLE, DATABASE)
    expect(result.range).toEqual({ low: 3, expected: 4, high: 6 })
  })

  it('warns when the team deliberately sizes with no spare', () => {
    const result = sizeNodeCount({ ...WORKED_EXAMPLE, spareNodes: 0 }, DATABASE)
    expect(result.warnings.join(' ')).toContain('No failure-domain spare')
  })
})

// ---------------------------------------------------------------------------
// M8 — confidence-derived range replaces the hard-coded 0.8 / 1.25 band
// ---------------------------------------------------------------------------

describe('M8 confidence-derived ranges', () => {
  it('a measured benchmark gives a tighter band than an estimated one', () => {
    const measured = sizeNodeCount(WORKED_EXAMPLE, {
      ...DATABASE,
      confidence: 'measured',
      sourceUrl: 'https://internal.example/benchmarks/pg-16-nvme',
    })
    const estimated = sizeNodeCount(WORKED_EXAMPLE, DATABASE)

    expect(CONFIDENCE_BAND.measured).toBe(0.1)
    expect(CONFIDENCE_BAND.unverified).toBe(1.0)
    expect(measured.range).toEqual({ low: 4, expected: 4, high: 5 })
    expect(estimated.range).toEqual({ low: 3, expected: 4, high: 6 })
    expect(measured.range.high - measured.range.low).toBeLessThan(
      estimated.range.high - estimated.range.low,
    )
  })

  it('renders as a range, never as a bare point estimate', () => {
    expect(formatRange(sizeNodeCount(WORKED_EXAMPLE, DATABASE))).toBe(
      '3–6 node (point estimate 4)',
    )
  })

  it('takes the weakest confidence when several inputs disagree', () => {
    expect(weakestConfidence('measured', 'estimated', 'declared')).toBe('estimated')
    expect(weakestConfidence('measured', 'unverified')).toBe('unverified')
  })

  it('flags a declared benchmark with no citation (M7)', () => {
    const result = sizeNodeCount(WORKED_EXAMPLE, { ...DATABASE, confidence: 'declared' })
    expect(result.warnings.join(' ')).toContain('no source URL')
  })
})

// ---------------------------------------------------------------------------
// Worked example end to end, plus structural guarantees
// ---------------------------------------------------------------------------

describe('worked example: 5000 QPS / 2 KiB / 9:1 / 12 months on a database node', () => {
  const sizing = sizeComponent(WORKED_EXAMPLE, DATABASE, 'database')

  it('splits throughput the way the design document does', () => {
    expect(sizing.throughput.readQps).toBe(4_500)
    expect(sizing.throughput.writeQps).toBe(500)
    expect(sizing.throughput.peakReadQps).toBe(13_500)
    expect(sizing.throughput.peakWriteQps).toBe(1_500)
    expect(sizing.throughput.effectiveWriteQps).toBe(4_500)
    expect(sizing.throughput.ingressBytesPerSec).toBe(500 * 2 * BYTES_PER_KIB)
    expect(sizing.throughput.egressBytesPerSec).toBe(4_500 * 2 * BYTES_PER_KIB)
  })

  it('sizes 4 nodes (3 demand + 1 spare) and ~114.6 TiB uncompressed', () => {
    expect(sizing.nodes.value).toBe(4)
    expect(gibToTib(sizing.storage.value)).toBeCloseTo(114.63, 1)
  })

  it('never returns a number without its formula and assumptions', () => {
    for (const result of [sizing.nodes, sizing.storage]) {
      expect(result.formula.length).toBeGreaterThan(0)
      expect(result.assumptions.length).toBeGreaterThan(0)
      expect(result.formulaVersion).toBe(SIZING_FORMULA_VERSION)
    }
    expect(SIZING_FORMULA_VERSION).toBe('2.0')
  })

  it('surfaces the union of node and storage warnings', () => {
    expect(sizing.warnings).toContain(
      'Compression is not modelled (ratio 1.0). Real compression for JSON-like records is typically 3–10x, so this figure is an upper bound, not an estimate.',
    )
    expect(sizing.warnings.length).toBe(new Set(sizing.warnings).size)
  })
})

describe('input validation', () => {
  it('applies the documented defaults', () => {
    expect(resolveInputs(WORKED_EXAMPLE)).toMatchObject({
      peakFactor: 3.0,
      replicationFactor: 3,
      indexOverhead: 0.3,
      compressionRatio: 1.0,
      headroom: 0.3,
      spareNodes: 1,
    })
  })

  it.each([
    ['avgQps', { avgQps: 0 }],
    ['avgRecordKiB', { avgRecordKiB: -1 }],
    ['retentionMonths', { retentionMonths: 0 }],
    ['readWriteRatio', { readWriteRatio: -1 }],
    ['peakFactor', { peakFactor: 0.5 }],
    ['replicationFactor', { replicationFactor: 0 }],
    ['fractional replicationFactor', { replicationFactor: 1.5 }],
    ['headroom', { headroom: 3 }],
    ['spareNodes', { spareNodes: -1 }],
  ])('rejects a bad %s', (_label, override) => {
    expect(() => resolveInputs({ ...WORKED_EXAMPLE, ...override })).toThrow(RangeError)
  })

  it('rejects a benchmark with a non-positive capacity', () => {
    expect(() => sizeNodeCount(WORKED_EXAMPLE, { ...DATABASE, writeQpsPerNode: 0 })).toThrow(
      RangeError,
    )
  })

  it('handles a write-only workload (ratio 0) without dividing by zero', () => {
    const t = deriveThroughput({ ...WORKED_EXAMPLE, readWriteRatio: 0 })
    expect(t.readQps).toBe(0)
    expect(t.writeQps).toBe(5_000)
    expect(sizeNodeCount({ ...WORKED_EXAMPLE, readWriteRatio: 0 }, DATABASE).value).toBeGreaterThan(
      0,
    )
  })
})

/**
 * Task 3.4 model: the form -> engine conversion, the substituted formulas, the
 * single-benchmark shortcut, the deterministic review hints, validation, and
 * the benchmark pairing that feeds the "load from benchmark" dropdown.
 */
import { describe, expect, test } from 'vitest'
import { builtInBenchmarkOptions, pairBenchmarks, type BenchmarkRow } from './benchmarks'
import { BYTES_PER_GIB, BYTES_PER_KIB, DAYS_PER_MONTH, SECONDS_PER_DAY, sizeComponent } from './sizing'
import {
  CALCULATOR_DEFAULTS,
  calculate,
  reviewHints,
  singleBenchmarkShortcut,
  storageDisplay,
  toNodeBenchmark,
  toWorkload,
  validateInputs,
  type CalculatorInputs,
} from './sizingCalculator'

const base: CalculatorInputs = { ...CALCULATOR_DEFAULTS, measured: false }
const withInputs = (overrides: Partial<CalculatorInputs>): CalculatorInputs => ({ ...base, ...overrides })

describe('form -> engine conversion', () => {
  test('the engine derives exactly the peaks the user typed', () => {
    const sizing = sizeComponent(toWorkload(base), toNodeBenchmark(base))
    expect(sizing.throughput.peakReadQps).toBeCloseTo(20_000, 6)
    expect(sizing.throughput.peakWriteQps).toBeCloseTo(5_000, 6)
    expect(sizing.throughput.writeQps).toBeCloseTo(5_000 / 3, 6)
  })

  test('write-only (0 reads) is supported', () => {
    const sizing = sizeComponent(toWorkload(withInputs({ peakReadQps: 0 })), toNodeBenchmark(base))
    expect(sizing.throughput.peakReadQps).toBe(0)
    expect(sizing.throughput.peakWriteQps).toBeCloseTo(5_000, 6)
  })

  test('confidence: hand-typed = estimated, a loaded benchmark keeps its tag, the toggle means measured', () => {
    expect(toNodeBenchmark(base).confidence).toBe('estimated')
    const source = { componentType: 'database', confidence: 'declared' as const, sourceUrl: 'https://example.invalid/x' }
    expect(toNodeBenchmark(withInputs({ source })).confidence).toBe('declared')
    expect(toNodeBenchmark(withInputs({ source, measured: true })).confidence).toBe('measured')
  })
})

describe('calculate - the demo scenario (20k read / 5k write peak, RF 3, 8k/2k per node)', () => {
  const result = calculate(base)

  test('nodes: the write side binds -> 11, range 6-16 at "estimated"', () => {
    expect(result.sizing.nodes.value).toBe(11)
    expect(result.sizing.nodes.range).toEqual({ low: 6, expected: 11, high: 16 })
    expect(result.sizing.nodes.inputSnapshot.bindingSide).toBe('write')
  })

  test('the substituted node formula shows the user\'s numbers and lands on the same result', () => {
    expect(result.nodesSubstituted).toBe(
      '= ceil( max(20000 / 8000, 5000 * 3 / 2000) * (1 + 0.3) ) + 1 = ceil( max(2.5, 7.5) * 1.3 ) + 1 = 10 + 1 = 11',
    )
  })

  test('storage matches the formula, driven by AVERAGE writes', () => {
    const expectedBytes = (5_000 / 3) * 2 * BYTES_PER_KIB * SECONDS_PER_DAY * (6 * DAYS_PER_MONTH) * 3 * 1.3 / 3
    expect(result.sizing.storage.value).toBeCloseTo(expectedBytes / BYTES_PER_GIB, 6)
    expect(storageDisplay(result.sizing.storage.value).unit).toBe('TiB')
    expect(result.storageSubstituted.endsWith(' GiB')).toBe(true)
  })

  test('write load per cluster = peak writes x RF', () => {
    expect(result.writeLoad.value).toBeCloseTo(15_000, 6)
    expect(result.writeLoad.substituted).toBe('= 5000 * 3 = 15000')
  })

  test('the single-benchmark shortcut says 6 nodes: 45% too small', () => {
    expect(result.shortcut).toEqual({ shortcutNodes: 6, correctNodes: 11, undersizePercent: 45 })
  })

  test('measured narrows the node range to ±10%', () => {
    expect(calculate(withInputs({ measured: true })).sizing.nodes.range).toEqual({ low: 10, expected: 11, high: 12 })
  })

  test('live recompute: doubling peak writes -> 21 nodes', () => {
    expect(calculate(withInputs({ peakWriteQps: 10_000 })).sizing.nodes.value).toBe(21)
  })
})

describe('single-benchmark shortcut', () => {
  test('no note when the shortcut would not under-size (read-bound, RF 1)', () => {
    const inputs = withInputs({ peakReadQps: 40_000, peakWriteQps: 100, replicationFactor: 1 })
    const sizing = sizeComponent(toWorkload(inputs), toNodeBenchmark(inputs))
    expect(singleBenchmarkShortcut(inputs, sizing)).toBeNull()
  })
})

describe('review hints (deterministic, no LLM)', () => {
  const ids = (inputs: CalculatorInputs) => calculate(inputs).hints.map((hint) => hint.id)

  test('the rules the build scope names for 3.7 fire', () => {
    expect(ids(withInputs({ peakFactor: 1 }))).toContain('no-peak-factor')
    expect(ids(withInputs({ retentionMonths: 36, compressionRatio: 1 }))).toEqual(
      expect.arrayContaining(['compression-not-modelled', 'long-retention-uncompressed']),
    )
  })

  test('each hint has VI and EN text', () => {
    for (const hint of calculate(withInputs({ spareNodes: 0, replicationFactor: 1, compressionRatio: 12 })).hints) {
      expect(hint.message.vi.length).toBeGreaterThan(0)
      expect(hint.message.en.length).toBeGreaterThan(0)
      expect(hint.message.vi).not.toBe(hint.message.en)
    }
  })

  test('measured with no citation is flagged (M7)', () => {
    expect(ids(withInputs({ measured: true }))).toContain('measured-without-citation')
    const cited = withInputs({ measured: true, source: { componentType: 'database', confidence: 'measured', sourceUrl: 'https://intranet.invalid/loadtest-42' } })
    expect(ids(cited)).not.toContain('measured-without-citation')
  })

  test('"no rule fired" only when nothing else did', () => {
    const clean = withInputs({ measured: true, readQpsPerNode: 100_000, writeQpsPerNode: 100_000, replicationFactor: 1, source: { componentType: 'x', confidence: 'measured', sourceUrl: 'https://intranet.invalid/x' } })
    // RF 1 fires "single-replica", so use RF 2 and a read-bound load instead.
    const quiet = { ...clean, replicationFactor: 2, peakWriteQps: 10 }
    expect(ids(quiet)).toEqual(['no-rule-fired'])
  })

  test('every engine warning has exactly one hint (nothing is lost in translation)', () => {
    const matrix: Partial<CalculatorInputs>[] = [
      {},
      { spareNodes: 0 },
      { replicationFactor: 1 },
      { peakFactor: 1 },
      { compressionRatio: 1 },
      { compressionRatio: 1, retentionMonths: 30 },
      { compressionRatio: 15 },
      { measured: true },
      { measured: true, source: { componentType: 'db', confidence: 'measured', sourceUrl: 'https://intranet.invalid/a' } },
      { source: { componentType: 'db', confidence: 'unverified' } },
      { spareNodes: 0, replicationFactor: 1, peakFactor: 1, compressionRatio: 1, retentionMonths: 48 },
    ]
    for (const overrides of matrix) {
      const inputs = withInputs(overrides)
      const result = calculate(inputs)
      const mirrored = reviewHints(inputs, result.sizing).filter((hint) => hint.id !== 'write-bound' && hint.id !== 'no-rule-fired')
      expect(mirrored.length, JSON.stringify(overrides)).toBe(result.sizing.warnings.length)
    }
  })
})

describe('validation', () => {
  test('defaults are valid', () => {
    expect(validateInputs(CALCULATOR_DEFAULTS)).toEqual({})
  })

  test('each rule has a bilingual message', () => {
    const errors = validateInputs({
      ...CALCULATOR_DEFAULTS,
      peakReadQps: -1,
      peakWriteQps: 0,
      payloadKiB: Number.NaN,
      peakFactor: 0.5,
      replicationFactor: 2.5,
      compressionRatio: 0.5,
      spareNodes: -1,
    })
    expect(Object.keys(errors).sort()).toEqual(['compressionRatio', 'payloadKiB', 'peakFactor', 'peakReadQps', 'peakWriteQps', 'replicationFactor', 'spareNodes'])
    expect(errors.payloadKiB).toEqual({ vi: 'Nhập một số.', en: 'Enter a number.' })
  })
})

describe('benchmark pairing (/api/benchmarks rows -> dropdown options)', () => {
  const row = (componentType: string, metric: string, value: number, extra: Partial<BenchmarkRow> = {}): BenchmarkRow => ({
    id: `${componentType}-${metric}`,
    componentType,
    metric,
    value,
    unit: 'qps per node',
    hardwareProfile: 'generic planning baseline',
    basis: 'rule of thumb',
    sourceTitle: 'ArchPilot generic planning heuristic',
    sourceUrl: null,
    retrievedDate: null,
    confidence: 'estimated',
    origin: 'seed',
    updatedAt: '2026-09-24T00:00:00+00:00',
    ...extra,
  })

  test('read + write rows become one dual-capacity option with its citation', () => {
    const [option] = pairBenchmarks([row('queue', 'read_qps', 20_000), row('queue', 'write_qps', 10_000)])
    expect(option.key).toBe('queue|generic planning baseline')
    expect(option.benchmark).toMatchObject({ readQpsPerNode: 20_000, writeQpsPerNode: 10_000, confidence: 'estimated' })
    expect(option.sourceTitle).toBe('ArchPilot generic planning heuristic')
  })

  test('the pair takes the weaker confidence, and a URL only when both rows share it', () => {
    const [option] = pairBenchmarks([
      row('database', 'read_qps', 9_000, { confidence: 'measured', sourceUrl: 'https://intranet.invalid/r' }),
      row('database', 'write_qps', 2_500, { confidence: 'declared', sourceUrl: 'https://intranet.invalid/w' }),
    ])
    expect(option.benchmark.confidence).toBe('declared')
    expect(option.benchmark.sourceUrl).toBeUndefined()
  })

  test('a type with only one metric is left out rather than guessed', () => {
    expect(pairBenchmarks([row('cache', 'read_qps', 1), row('queue', 'mb_per_sec', 5)])).toEqual([])
  })

  test('built-in fallback options exist and are never better than estimated', () => {
    const options = builtInBenchmarkOptions()
    expect(options.length).toBeGreaterThan(0)
    for (const option of options) expect(option.benchmark.confidence).toBe('estimated')
  })
})

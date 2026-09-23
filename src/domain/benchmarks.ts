/**
 * Benchmark types + the pairing step the calculator needs (build-scope §3.5.1).
 *
 * The server stores one row per metric (`database / read_qps`, `database /
 * write_qps`). The sizing engine consumes a dual-capacity `NodeBenchmark`
 * (red-team B3b). `pairBenchmarks` joins the two rows of a component type on a
 * hardware profile; a type with only one of the two metrics is left out rather
 * than guessed. The pair's confidence is the WEAKER of its two rows, and its
 * citation is kept, so the result card can show where the number came from.
 *
 * Pure: no fetch, no React.
 */
import type { Confidence } from './model'
import { DEFAULT_NODE_BENCHMARKS, weakestConfidence, type NodeBenchmark } from './sizing'

/** Wire shape of `BenchmarkOut` (backend/app/schemas.py). */
export interface BenchmarkRow {
  id: string
  componentType: string
  metric: string
  value: number
  unit: string
  hardwareProfile: string
  basis: string
  sourceTitle: string
  sourceUrl: string | null
  retrievedDate: string | null
  confidence: Confidence
  origin: 'seed' | 'user'
  updatedAt: string
}

/** One selectable entry in the calculator's "load from benchmark" dropdown. */
export interface BenchmarkOption {
  /** `componentType|hardwareProfile` - stable across reloads. */
  key: string
  componentType: string
  hardwareProfile: string
  benchmark: NodeBenchmark
  /** Always present: the citation, even when it says "generic heuristic". */
  sourceTitle: string
  origin: 'seed' | 'user' | 'built-in'
}

export function pairBenchmarks(rows: BenchmarkRow[]): BenchmarkOption[] {
  const groups = new Map<string, { read?: BenchmarkRow; write?: BenchmarkRow }>()
  for (const row of rows) {
    if (row.metric !== 'read_qps' && row.metric !== 'write_qps') continue
    const key = `${row.componentType}|${row.hardwareProfile}`
    const group = groups.get(key) ?? {}
    if (row.metric === 'read_qps') group.read = row
    else group.write = row
    groups.set(key, group)
  }

  const options: BenchmarkOption[] = []
  for (const [key, { read, write }] of groups) {
    if (!read || !write || read.value <= 0 || write.value <= 0) continue
    const sameUrl = read.sourceUrl && read.sourceUrl === write.sourceUrl ? read.sourceUrl : undefined
    const sourceTitle = read.sourceTitle === write.sourceTitle ? read.sourceTitle : `${read.sourceTitle} / ${write.sourceTitle}`
    options.push({
      key,
      componentType: read.componentType,
      hardwareProfile: read.hardwareProfile,
      sourceTitle,
      origin: read.origin === 'user' || write.origin === 'user' ? 'user' : 'seed',
      benchmark: {
        componentType: read.componentType,
        readQpsPerNode: read.value,
        writeQpsPerNode: write.value,
        confidence: weakestConfidence(read.confidence, write.confidence),
        sourceUrl: sameUrl,
        sourceTitle,
        basis: read.basis === write.basis ? read.basis : `${read.basis} / ${write.basis}`,
      },
    })
  }
  return options.sort((a, b) => a.key.localeCompare(b.key))
}

/** Used only when `/api/benchmarks` cannot be reached (build-scope §3.5.1). */
export function builtInBenchmarkOptions(): BenchmarkOption[] {
  return Object.values(DEFAULT_NODE_BENCHMARKS).map((benchmark) => ({
    key: `${benchmark.componentType}|built-in default`,
    componentType: benchmark.componentType,
    hardwareProfile: 'built-in default',
    benchmark,
    sourceTitle: 'Built-in rule of thumb (server benchmarks unavailable)',
    origin: 'built-in' as const,
  }))
}

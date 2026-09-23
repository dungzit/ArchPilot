/**
 * The Sizing screen's model (task 3.4): turns the form's inputs into engine
 * calls and adds the three things the screen shows next to the engine output:
 *
 *  1. The literal arithmetic with the user's numbers substituted in, so every
 *     number renders next to its own formula (NFR-USE-002).
 *  2. Deterministic review hints - fixed rules, no LLM (PO decision 5/6). They
 *     mirror every warning the engine raises, one-for-one (tested), plus a
 *     "which side binds" note, in VI and EN.
 *  3. The "single-benchmark shortcut" comparison: what the v1.0 formula (one
 *     capacity number, no replication on writes) would have said, and by how
 *     much that under-sizes (red-team B3a/B3b made visible).
 *
 * The form speaks in PEAK read/write QPS (what an architect has in hand); the
 * engine speaks in AVERAGE QPS + read:write ratio. `toWorkload` converts, and a
 * test asserts the engine's derived peaks equal the form's peaks.
 *
 * Pure: no React, no fetch. All arithmetic still lives in sizing.ts (D3).
 */
import type { Confidence } from './model'
import {
  BYTES_PER_GIB,
  BYTES_PER_KIB,
  DAYS_PER_MONTH,
  SECONDS_PER_DAY,
  SIZING_DEFAULTS,
  sizeComponent,
  type ComponentSizing,
  type NodeBenchmark,
  type WorkloadInputs,
} from './sizing'

/** Structurally identical to `Copy` in src/ui/copy.ts; domain code does not import UI code. */
export interface Bilingual {
  vi: string
  en: string
}

const say = (vi: string, en: string): Bilingual => ({ vi, en })

export interface CapacitySource {
  componentType: string
  confidence: Confidence
  sourceTitle?: string
  sourceUrl?: string
  basis?: string
}

export interface CalculatorInputs {
  peakReadQps: number
  peakWriteQps: number
  payloadKiB: number
  retentionMonths: number
  replicationFactor: number
  compressionRatio: number
  peakFactor: number
  readQpsPerNode: number
  writeQpsPerNode: number
  spareNodes: number
  /** "These numbers come from our own measurements" - narrows the band to ±10%. */
  measured: boolean
  /** The benchmark the per-node numbers were loaded from, if they have not been edited since. */
  source?: CapacitySource
}

export type CalculatorField = Exclude<keyof CalculatorInputs, 'measured' | 'source'>

export const CALCULATOR_FIELDS: CalculatorField[] = [
  'peakReadQps',
  'peakWriteQps',
  'payloadKiB',
  'peakFactor',
  'retentionMonths',
  'replicationFactor',
  'compressionRatio',
  'readQpsPerNode',
  'writeQpsPerNode',
  'spareNodes',
]

/** The demo's scenario (docs/prototype/systemsarchitect-demo.html): 20k read / 5k write peak. */
export const CALCULATOR_DEFAULTS: Record<CalculatorField, number> = {
  peakReadQps: 20_000,
  peakWriteQps: 5_000,
  payloadKiB: 2,
  peakFactor: 3,
  retentionMonths: 6,
  replicationFactor: 3,
  compressionRatio: 3,
  readQpsPerNode: 8_000,
  writeQpsPerNode: 2_000,
  spareNodes: 1,
}

/* ------------------------------------------------------------------ *
 * Validation - bilingual, per field, before the engine sees anything.
 * ------------------------------------------------------------------ */

export type FieldErrors = Partial<Record<CalculatorField, Bilingual>>

export function validateInputs(inputs: Record<CalculatorField, number>): FieldErrors {
  const errors: FieldErrors = {}
  const finite = (field: CalculatorField) => Number.isFinite(inputs[field])
  const need = (field: CalculatorField, ok: boolean, message: Bilingual) => {
    if (!finite(field)) errors[field] = say('Nhập một số.', 'Enter a number.')
    else if (!ok) errors[field] = message
  }
  need('peakReadQps', inputs.peakReadQps >= 0, say('Không được âm (0 = chỉ ghi).', 'Cannot be negative (0 = write-only).'))
  need('peakWriteQps', inputs.peakWriteQps > 0, say('Phải lớn hơn 0: mô hình cần có lượt ghi.', 'Must be greater than 0: the model needs some writes.'))
  need('payloadKiB', inputs.payloadKiB > 0, say('Phải lớn hơn 0.', 'Must be greater than 0.'))
  need('peakFactor', inputs.peakFactor >= 1, say('Tối thiểu 1 (đỉnh không thể thấp hơn trung bình).', 'At least 1 (a peak cannot be below the average).'))
  need('retentionMonths', inputs.retentionMonths > 0, say('Phải lớn hơn 0.', 'Must be greater than 0.'))
  need('replicationFactor', Number.isInteger(inputs.replicationFactor) && inputs.replicationFactor >= 1, say('Số nguyên từ 1 trở lên.', 'A whole number, 1 or more.'))
  need('compressionRatio', inputs.compressionRatio >= 1, say('Tối thiểu 1 (1 = không tính nén).', 'At least 1 (1 = compression not modelled).'))
  need('readQpsPerNode', inputs.readQpsPerNode > 0, say('Phải lớn hơn 0.', 'Must be greater than 0.'))
  need('writeQpsPerNode', inputs.writeQpsPerNode > 0, say('Phải lớn hơn 0.', 'Must be greater than 0.'))
  need('spareNodes', Number.isInteger(inputs.spareNodes) && inputs.spareNodes >= 0, say('Số nguyên từ 0 trở lên.', 'A whole number, 0 or more.'))
  return errors
}

/* ------------------------------------------------------------------ *
 * Form -> engine
 * ------------------------------------------------------------------ */

/** Peak read/write -> the engine's average QPS + read:write ratio. Exact inverse of `deriveThroughput`. */
export function toWorkload(inputs: CalculatorInputs): WorkloadInputs {
  return {
    avgQps: (inputs.peakReadQps + inputs.peakWriteQps) / inputs.peakFactor,
    readWriteRatio: inputs.peakReadQps / inputs.peakWriteQps,
    avgRecordKiB: inputs.payloadKiB,
    retentionMonths: inputs.retentionMonths,
    peakFactor: inputs.peakFactor,
    replicationFactor: inputs.replicationFactor,
    compressionRatio: inputs.compressionRatio,
    spareNodes: inputs.spareNodes,
  }
}

export function toNodeBenchmark(inputs: CalculatorInputs): NodeBenchmark {
  return {
    componentType: inputs.source?.componentType ?? 'custom',
    readQpsPerNode: inputs.readQpsPerNode,
    writeQpsPerNode: inputs.writeQpsPerNode,
    // The toggle is the user's claim about THEIR numbers; without it the loaded
    // benchmark's own tag applies, and a hand-typed number is an estimate.
    confidence: inputs.measured ? 'measured' : (inputs.source?.confidence ?? 'estimated'),
    sourceUrl: inputs.source?.sourceUrl,
    sourceTitle: inputs.source?.sourceTitle,
    basis: inputs.source?.basis,
  }
}

/* ------------------------------------------------------------------ *
 * Result
 * ------------------------------------------------------------------ */

export interface DerivedFigure {
  value: number
  unit: string
  formula: string
  substituted: string
  assumptions: Bilingual[]
  confidence: Confidence
}

export interface ShortcutComparison {
  shortcutNodes: number
  correctNodes: number
  /** Whole percent by which the shortcut is too small. */
  undersizePercent: number
}

export type HintSeverity = 'warn' | 'info'

export interface ReviewHint {
  id: string
  severity: HintSeverity
  message: Bilingual
}

export interface CalculatorResult {
  sizing: ComponentSizing
  nodesSubstituted: string
  storageSubstituted: string
  writeLoad: DerivedFigure
  network: DerivedFigure & { egressBytesPerSec: number; peakIngressBytesPerSec: number; peakEgressBytesPerSec: number }
  shortcut: ShortcutComparison | null
  hints: ReviewHint[]
}

/** Plain number for formula lines: no locale grouping, at most 2 decimals. */
export function plain(value: number): string {
  return String(Math.round(value * 100) / 100)
}

export function calculate(inputs: CalculatorInputs): CalculatorResult {
  const benchmark = toNodeBenchmark(inputs)
  const sizing = sizeComponent(toWorkload(inputs), benchmark)
  const { throughput } = sizing
  const resolved = sizing.inputs
  const workloadConfidence: Confidence = inputs.measured ? 'measured' : 'estimated'

  const readNodes = throughput.peakReadQps / benchmark.readQpsPerNode
  const writeNodes = throughput.effectiveWriteQps / benchmark.writeQpsPerNode
  const demand = sizing.nodes.value - resolved.spareNodes
  const nodesSubstituted =
    `= ceil( max(${plain(throughput.peakReadQps)} / ${plain(benchmark.readQpsPerNode)}, ` +
    `${plain(throughput.peakWriteQps)} * ${resolved.replicationFactor} / ${plain(benchmark.writeQpsPerNode)}) * (1 + ${resolved.headroom}) ) + ${resolved.spareNodes}` +
    ` = ceil( max(${plain(readNodes)}, ${plain(writeNodes)}) * ${plain(1 + resolved.headroom)} ) + ${resolved.spareNodes}` +
    ` = ${demand} + ${resolved.spareNodes} = ${sizing.nodes.value}`

  const storageSubstituted =
    `= ${plain(throughput.writeQps)} * ${plain(resolved.avgRecordKiB)} * ${BYTES_PER_KIB} * ${SECONDS_PER_DAY} * (${plain(resolved.retentionMonths)} * ${DAYS_PER_MONTH})` +
    ` * ${resolved.replicationFactor} * (1 + ${resolved.indexOverhead}) / ${plain(resolved.compressionRatio)} B` +
    ` = ${plain(sizing.storage.value)} GiB`

  const writeLoad: DerivedFigure = {
    value: throughput.effectiveWriteQps,
    unit: 'writes/s',
    formula: 'peakWriteQps * replicationFactor',
    substituted: `= ${plain(throughput.peakWriteQps)} * ${resolved.replicationFactor} = ${plain(throughput.effectiveWriteQps)}`,
    assumptions: [
      say(`Mỗi lượt ghi được ghi lên ${resolved.replicationFactor} bản sao (red-team B3a).`, `Every write lands on ${resolved.replicationFactor} replicas (red-team B3a).`),
      say('Đây là tải ghi cả cụm phải chịu ở giờ cao điểm, không phải tải ở một node.', 'This is the write load the whole cluster absorbs at peak, not per node.'),
      say('Số liệu công suất ghi mỗi node cần có nguồn trích dẫn trước khi dùng cho ngân sách.', 'The per-node write capacity needs a cited source before it goes into a budget.'),
    ],
    confidence: workloadConfidence,
  }

  const recordBytes = resolved.avgRecordKiB * BYTES_PER_KIB
  const network = {
    value: throughput.ingressBytesPerSec,
    unit: 'B/s',
    formula: 'ingress = writeQps * payloadKiB * 1024; egress = readQps * payloadKiB * 1024 (average; x peakFactor at peak)',
    substituted: `= ${plain(throughput.writeQps)} * ${plain(recordBytes)} B in; ${plain(throughput.readQps)} * ${plain(recordBytes)} B out`,
    assumptions: [
      say('Chỉ tính payload của client; replication, header và TLS chưa được cộng vào.', 'Client payload only; replication traffic, headers and TLS are not added.'),
      say(`Giá trị đỉnh = trung bình × ${resolved.peakFactor}.`, `Peak = average × ${resolved.peakFactor}.`),
    ],
    confidence: workloadConfidence,
    egressBytesPerSec: throughput.egressBytesPerSec,
    peakIngressBytesPerSec: throughput.ingressBytesPerSec * resolved.peakFactor,
    peakEgressBytesPerSec: throughput.egressBytesPerSec * resolved.peakFactor,
  }

  return {
    sizing,
    nodesSubstituted,
    storageSubstituted,
    writeLoad,
    network,
    shortcut: singleBenchmarkShortcut(inputs, sizing),
    hints: reviewHints(inputs, sizing),
  }
}

/**
 * The v1.0 shortcut: all traffic against ONE capacity number (the read
 * benchmark), replication ignored on writes. Same headroom and spare as the
 * real result, so the difference is exactly B3(a) + B3(b). `null` when the
 * shortcut would not under-size.
 */
export function singleBenchmarkShortcut(inputs: CalculatorInputs, sizing: ComponentSizing): ShortcutComparison | null {
  const { headroom, spareNodes } = sizing.inputs
  const shortcutNodes = Math.ceil(((inputs.peakReadQps + inputs.peakWriteQps) / inputs.readQpsPerNode) * (1 + headroom)) + spareNodes
  const correctNodes = sizing.nodes.value
  if (shortcutNodes >= correctNodes) return null
  return { shortcutNodes, correctNodes, undersizePercent: Math.round((1 - shortcutNodes / correctNodes) * 100) }
}

/**
 * Deterministic review rules. Each engine warning has exactly one hint here
 * (sizingCalculator.test.ts proves the correspondence), so nothing the engine
 * flags is lost in translation; `write-bound` and `no-rule-fired` are extra.
 */
export function reviewHints(inputs: CalculatorInputs, sizing: ComponentSizing): ReviewHint[] {
  const { compressionRatio, retentionMonths, peakFactor, spareNodes, replicationFactor } = sizing.inputs
  const benchmark = sizing.benchmark
  const hints: ReviewHint[] = []
  const warn = (id: string, message: Bilingual) => hints.push({ id, severity: 'warn', message })
  const info = (id: string, message: Bilingual) => hints.push({ id, severity: 'info', message })

  if (compressionRatio === 1) {
    warn('compression-not-modelled', say('Tỷ lệ nén = 1: dung lượng lưu trữ có thể bị ước lượng quá cao (đây là giới hạn trên).', 'Compression ratio is 1: storage is likely overstated (this is an upper bound).'))
  }
  if (retentionMonths > 24 && compressionRatio === 1) {
    warn('long-retention-uncompressed', say(`Lưu giữ ${retentionMonths} tháng mà không tính nén: kiểm tra lại yêu cầu lưu giữ trước khi mua đĩa.`, `Retention of ${retentionMonths} months with no compression: check the retention requirement before buying disk.`))
  }
  if (compressionRatio > 10) {
    warn('compression-optimistic', say(`Tỷ lệ nén ${compressionRatio}:1 cao hơn mức thường gặp (3–10x). Kiểm chứng bằng dữ liệu thật.`, `Compression ratio ${compressionRatio}:1 is above the usual 3–10x. Verify it on your own data.`))
  }
  if (peakFactor === 1) {
    warn('no-peak-factor', say('Hệ số đỉnh = 1: không có dư địa cho lưu lượng tăng đột biến.', 'Peak factor is 1: no headroom for traffic spikes.'))
  }
  if (spareNodes === 0) {
    warn('no-spare', say('Không có node dự phòng: mất một node là mất công suất.', 'No spare node: losing one node loses capacity.'))
  }
  if (replicationFactor === 1) {
    warn('single-replica', say('Hệ số nhân bản = 1: mỗi lượt ghi chỉ có một bản, không có dự phòng.', 'Replication factor 1: one copy of every write, no redundancy.'))
  }
  if ((benchmark.confidence === 'measured' || benchmark.confidence === 'declared') && !benchmark.sourceUrl) {
    warn('measured-without-citation', say('Đánh dấu "đo thực tế" nhưng chưa có nguồn trích dẫn: con số này chưa kiểm chứng được (M7).', 'Marked as measured but there is no cited source: the number cannot be checked (M7).'))
  }
  if (benchmark.confidence === 'estimated' || benchmark.confidence === 'unverified') {
    info('unmeasured-capacity', say('Công suất mỗi node là ước lượng, chưa đo trên phần cứng của bạn: khoảng kết quả được nới rộng tương ứng.', 'Per-node capacity is an estimate, not measured on your hardware: the range is widened to match.'))
  }
  if (sizing.nodes.inputSnapshot.bindingSide === 'write' && replicationFactor > 1) {
    info('write-bound', say(`Phía ghi quyết định số node (ghi × ${replicationFactor} bản sao). Tăng công suất đọc sẽ không giảm con số này.`, `The write side sets the node count (writes × ${replicationFactor} replicas). Faster reads will not lower this number.`))
  }
  if (hints.length === 0) {
    info('no-rule-fired', say('Không có quy tắc nào kích hoạt với các giá trị này.', 'No rule fired on these inputs.'))
  }
  return hints
}

/** Storage in the unit a human reads: TiB from 1024 GiB up. */
export function storageDisplay(gib: number): { value: number; unit: 'GiB' | 'TiB' } {
  return gib >= 1024 ? { value: gib / 1024, unit: 'TiB' } : { value: gib, unit: 'GiB' }
}

export const BYTES_PER_MIB = 1024 * 1024
export { BYTES_PER_GIB, SIZING_DEFAULTS }

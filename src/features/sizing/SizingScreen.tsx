import { useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { PageHeader } from '../../ui/PageHeader'
import { copy, type Copy, type TextFn } from '../../ui/copy'
import { listBenchmarks } from '../../api/benchmarks'
import { builtInBenchmarkOptions, pairBenchmarks, type BenchmarkOption } from '../../domain/benchmarks'
import type { Confidence } from '../../domain/model'
import { CONFIDENCE_BAND } from '../../domain/sizing'
import {
  BYTES_PER_MIB,
  CALCULATOR_DEFAULTS,
  calculate,
  storageDisplay,
  validateInputs,
  type CalculatorField,
  type CalculatorInputs,
  type CalculatorResult,
  type FieldErrors,
} from '../../domain/sizingCalculator'

/**
 * Sizing calculator (task 3.4). Inputs on the left, result cards on the right,
 * recomputed on every keystroke by the v2.0 engine (src/domain/sizing.ts).
 * Every number renders with its formula, the formula with the user's numbers
 * substituted, its assumptions and a confidence tag - there is no card
 * without them. Review hints are fixed rules (no LLM).
 *
 * Layout and behaviour follow the Sizing screen of
 * docs/prototype/systemsarchitect-demo.html, with the corrected engine instead
 * of the demo's inline arithmetic.
 */

type RawInputs = Record<CalculatorField, string>

interface FieldSpec {
  field: CalculatorField
  label: Copy
  unit: string | Copy
  step: string
  min: string
  help?: Copy
}

const WORKLOAD_FIELDS: FieldSpec[] = [
  { field: 'peakReadQps', label: copy('QPS đọc lúc cao điểm', 'Peak read QPS'), unit: 'qps', step: 'any', min: '0' },
  { field: 'peakWriteQps', label: copy('QPS ghi lúc cao điểm', 'Peak write QPS'), unit: 'qps', step: 'any', min: '0' },
  { field: 'payloadKiB', label: copy('Kích thước payload', 'Payload size'), unit: 'KiB', step: 'any', min: '0' },
  { field: 'peakFactor', label: copy('Hệ số đỉnh / trung bình', 'Peak / average factor'), unit: '×', step: 'any', min: '1', help: copy('3 = đỉnh gấp 3 lần trung bình.', '3 = the peak is 3× the average.') },
]

const DATA_FIELDS: FieldSpec[] = [
  { field: 'retentionMonths', label: copy('Thời gian lưu giữ', 'Retention'), unit: copy('tháng', 'months'), step: 'any', min: '0' },
  { field: 'replicationFactor', label: copy('Hệ số nhân bản', 'Replication factor'), unit: '×', step: '1', min: '1' },
  { field: 'compressionRatio', label: copy('Tỷ lệ nén', 'Compression ratio'), unit: ':1', step: 'any', min: '1', help: copy('1 = không tính nén (giới hạn trên).', '1 = compression not modelled (upper bound).') },
]

const CAPACITY_FIELDS: FieldSpec[] = [
  { field: 'readQpsPerNode', label: copy('QPS đọc mỗi node', 'Read QPS per node'), unit: 'qps', step: 'any', min: '0' },
  { field: 'writeQpsPerNode', label: copy('QPS ghi mỗi node', 'Write QPS per node'), unit: 'qps', step: 'any', min: '0' },
  { field: 'spareNodes', label: copy('Node dự phòng (failure domain)', 'Spare nodes (failure domain)'), unit: copy('node', 'nodes'), step: '1', min: '0' },
]

const COMPONENT_LABELS: Record<string, Copy> = {
  database: copy('CSDL quan hệ', 'Relational database'),
  cache: copy('Cache key-value', 'Key-value cache'),
  queue: copy('Hàng đợi message', 'Message queue'),
  service: copy('API service', 'API service'),
  object_store: copy('Object storage', 'Object storage'),
}

const CONFIDENCE_LABELS: Record<Confidence, Copy> = {
  measured: copy('đo thực tế', 'measured'),
  declared: copy('nhà cung cấp công bố', 'declared'),
  estimated: copy('ước lượng', 'estimated'),
  unverified: copy('chưa kiểm chứng', 'unverified'),
}

const defaultRaw = (): RawInputs =>
  Object.fromEntries(Object.entries(CALCULATOR_DEFAULTS).map(([key, value]) => [key, String(value)])) as RawInputs

function parse(raw: RawInputs): Record<CalculatorField, number> {
  return Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, value.trim() === '' ? Number.NaN : Number(value)]),
  ) as Record<CalculatorField, number>
}

type Catalog = { status: 'loading' | 'server' | 'fallback'; options: BenchmarkOption[] }

/** `/api/benchmarks`, paired into read+write options; built-in defaults if it cannot be reached. */
function useBenchmarkCatalog(): Catalog {
  const [catalog, setCatalog] = useState<Catalog>({ status: 'loading', options: [] })
  useEffect(() => {
    const controller = new AbortController()
    listBenchmarks(controller.signal)
      .then((list) => {
        const options = pairBenchmarks(list.items)
        setCatalog(options.length ? { status: 'server', options } : { status: 'fallback', options: builtInBenchmarkOptions() })
      })
      .catch(() => {
        if (!controller.signal.aborted) setCatalog({ status: 'fallback', options: builtInBenchmarkOptions() })
      })
    return () => controller.abort()
  }, [])
  return catalog
}

export function Sizing({ text }: { text: TextFn }) {
  const [raw, setRaw] = useState<RawInputs>(defaultRaw)
  const [measured, setMeasured] = useState(false)
  const [selectedKey, setSelectedKey] = useState('')
  const catalog = useBenchmarkCatalog()

  const numbers = parse(raw)
  const errors = validateInputs(numbers)
  const selected = catalog.options.find((option) => option.key === selectedKey)
  const inputs: CalculatorInputs = {
    ...numbers,
    measured,
    source: selected
      ? {
          componentType: selected.componentType,
          confidence: selected.benchmark.confidence,
          sourceTitle: selected.sourceTitle,
          sourceUrl: selected.benchmark.sourceUrl,
          basis: selected.benchmark.basis,
        }
      : undefined,
  }
  const errorCount = Object.keys(errors).length
  const result = errorCount === 0 ? calculate(inputs) : null

  function setField(field: CalculatorField, value: string) {
    setRaw((previous) => ({ ...previous, [field]: value }))
    // A hand-edited capacity is no longer the benchmark's number.
    if (field === 'readQpsPerNode' || field === 'writeQpsPerNode') setSelectedKey('')
  }

  function selectBenchmark(key: string) {
    setSelectedKey(key)
    const option = catalog.options.find((candidate) => candidate.key === key)
    if (option) {
      setRaw((previous) => ({
        ...previous,
        readQpsPerNode: String(option.benchmark.readQpsPerNode),
        writeQpsPerNode: String(option.benchmark.writeQpsPerNode),
      }))
    }
  }

  function reset() {
    setRaw(defaultRaw())
    setMeasured(false)
    setSelectedKey('')
  }

  const fieldProps = { text, raw, errors, onChange: setField }

  return (
    <div className="page-content sizing-calculator">
      <PageHeader
        eyebrow="SIZING STUDIO"
        title={text(copy('Ước lượng trước khi xây.', 'Estimate before you build.'))}
        description={text(copy('Đổi bất kỳ giá trị nào, mọi kết quả được tính lại. Mỗi con số đi kèm công thức, giả định và mức tin cậy.', 'Change any input and every result recomputes. Each number shows its formula, assumptions and confidence.'))}
        text={text}
        action={<button type="button" className="secondary-button" onClick={reset}><RotateCcw size={15} aria-hidden="true" /> {text(copy('Về giá trị mặc định', 'Reset to defaults'))}</button>}
      />
      <div className="calc-two">
        <form className="panel calc-form" aria-labelledby="sizing-inputs-title" onSubmit={(event) => event.preventDefault()} noValidate>
          <h2 id="sizing-inputs-title" className="calc-heading">{text(copy('Thông số tải', 'Workload inputs'))}</h2>
          <fieldset>
            <legend>{text(copy('Lưu lượng', 'Traffic'))}</legend>
            {WORKLOAD_FIELDS.map((spec) => <NumberField key={spec.field} spec={spec} {...fieldProps} />)}
          </fieldset>
          <fieldset>
            <legend>{text(copy('Dữ liệu', 'Data'))}</legend>
            {DATA_FIELDS.map((spec) => <NumberField key={spec.field} spec={spec} {...fieldProps} />)}
          </fieldset>
          <fieldset>
            <legend>{text(copy('Công suất mỗi node', 'Capacity per node'))}</legend>
            <label className="calc-field" htmlFor="sizing-benchmark">
              <span>{text(copy('Nạp từ benchmark', 'Load from benchmark'))}</span>
              <select id="sizing-benchmark" value={selectedKey} onChange={(event) => selectBenchmark(event.target.value)} aria-describedby="sizing-benchmark-note" disabled={catalog.status === 'loading'}>
                <option value="">{text(copy('Tự nhập (không dùng benchmark)', 'Custom (typed by hand)'))}</option>
                {catalog.options.map((option) => (
                  <option key={option.key} value={option.key}>
                    {text(COMPONENT_LABELS[option.componentType] ?? copy(option.componentType, option.componentType))} · {option.hardwareProfile} ({option.benchmark.readQpsPerNode} / {option.benchmark.writeQpsPerNode} qps)
                  </option>
                ))}
              </select>
            </label>
            <BenchmarkNote id="sizing-benchmark-note" text={text} catalog={catalog} selected={selected} />
            {CAPACITY_FIELDS.map((spec) => <NumberField key={spec.field} spec={spec} {...fieldProps} />)}
          </fieldset>
          <label className="calc-check" htmlFor="sizing-measured">
            <input id="sizing-measured" type="checkbox" checked={measured} onChange={(event) => setMeasured(event.target.checked)} />
            <span>{text(copy('Các con số này là số đo thực tế (khoảng kết quả hẹp hơn, ±10%)', 'These numbers come from our own measurements (narrower range, ±10%)'))}</span>
          </label>
        </form>

        <section className="calc-results" aria-labelledby="sizing-results-title">
          <h2 id="sizing-results-title" className="calc-heading visually-hidden">{text(copy('Kết quả', 'Results'))}</h2>
          {result ? <Results text={text} result={result} /> : (
            <div className="panel calc-paused" role="status">
              {text(copy(`Tạm dừng tính: sửa ${errorCount} ô đang báo lỗi bên trái.`, `Results paused: fix the ${errorCount} highlighted input${errorCount === 1 ? '' : 's'} on the left.`))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function NumberField({ spec, text, raw, errors, onChange }: { spec: FieldSpec; text: TextFn; raw: RawInputs; errors: FieldErrors; onChange: (field: CalculatorField, value: string) => void }) {
  const id = `sizing-${spec.field}`
  const error = errors[spec.field]
  const describedBy = [error ? `${id}-error` : null, spec.help ? `${id}-help` : null].filter(Boolean).join(' ') || undefined
  return (
    <div className="calc-field">
      <label htmlFor={id}>{text(spec.label)} <span className="calc-unit">({typeof spec.unit === 'string' ? spec.unit : text(spec.unit)})</span></label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={spec.min}
        step={spec.step}
        value={raw[spec.field]}
        onChange={(event) => onChange(spec.field, event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      {spec.help && <small id={`${id}-help`} className="calc-help">{text(spec.help)}</small>}
      {error && <small id={`${id}-error`} className="calc-error">{text(error)}</small>}
    </div>
  )
}

function BenchmarkNote({ id, text, catalog, selected }: { id: string; text: TextFn; catalog: Catalog; selected: BenchmarkOption | undefined }) {
  if (catalog.status === 'loading') return <p id={id} className="calc-help">{text(copy('Đang tải benchmark từ máy chủ…', 'Loading benchmarks from the server…'))}</p>
  return (
    <div id={id} className="calc-source">
      {catalog.status === 'fallback' && <p className="calc-help">{text(copy('Không tải được benchmark từ máy chủ; đang dùng giá trị mặc định có sẵn.', 'Could not load benchmarks from the server; using the built-in defaults.'))}</p>}
      {selected ? (
        <>
          <p><ConfidenceTag text={text} confidence={selected.benchmark.confidence} /> {selected.sourceTitle}</p>
          {selected.benchmark.basis && <p className="calc-help">{selected.benchmark.basis}</p>}
          {selected.benchmark.sourceUrl && <p><a href={selected.benchmark.sourceUrl} target="_blank" rel="noreferrer">{selected.benchmark.sourceUrl}</a></p>}
        </>
      ) : <p className="calc-help">{text(copy('Số tự nhập được coi là ước lượng, trừ khi bạn đánh dấu là số đo thực tế.', 'Hand-typed numbers count as estimates unless you mark them as measured.'))}</p>}
    </div>
  )
}

function ConfidenceTag({ text, confidence }: { text: TextFn; confidence: Confidence }) {
  return <span className={`calc-tag ${confidence}`}>{text(CONFIDENCE_LABELS[confidence])} ±{Math.round(CONFIDENCE_BAND[confidence] * 100)}%</span>
}

function Results({ text, result }: { text: TextFn; result: CalculatorResult }) {
  const locale = text(copy('vi-VN', 'en-US'))
  const number = (value: number, digits = 1) => value.toLocaleString(locale, { maximumFractionDigits: digits })
  const { sizing } = result
  const nodes = sizing.nodes
  const storage = storageDisplay(sizing.storage.value)
  const scale = storage.unit === 'TiB' ? 1 / 1024 : 1
  const engineNote = copy('Giả định do engine sinh ra (tiếng Anh, giữ nguyên để khớp với bản lưu):', 'Assumptions generated by the engine:')
  const mib = (bytes: number) => number(bytes / BYTES_PER_MIB, 2)

  return (
    <>
      <ResultCard
        id="nodes"
        text={text}
        title={copy('Số node cần', 'Nodes needed')}
        value={<><span aria-live="polite">{nodes.value}</span> <small>node</small></>}
        range={text(copy(`khoảng ${nodes.range.low}–${nodes.range.high}`, `range ${nodes.range.low}–${nodes.range.high}`))}
        confidence={nodes.confidence}
        formula={nodes.formula}
        substituted={result.nodesSubstituted}
        assumptionsLabel={engineNote}
        assumptions={nodes.assumptions}
      >
        {result.shortcut && (
          <p className="calc-compare" role="note">
            {text(copy(
              `Cách tính tắt bằng một benchmark duy nhất sẽ ra ${result.shortcut.shortcutNodes} node: thiếu khoảng ${result.shortcut.undersizePercent}% so với ${result.shortcut.correctNodes} node cho tải này.`,
              `A single-benchmark shortcut would say ${result.shortcut.shortcutNodes} node(s): about ${result.shortcut.undersizePercent}% too small against ${result.shortcut.correctNodes} for this load.`,
            ))}
          </p>
        )}
      </ResultCard>

      <ResultCard
        id="storage"
        text={text}
        title={copy('Dung lượng lưu trữ', 'Storage')}
        value={<>{number(storage.value)} <small>{storage.unit}</small></>}
        range={text(copy(
          `khoảng ${number(sizing.storage.range.low * scale)}–${number(sizing.storage.range.high * scale)} ${storage.unit}`,
          `range ${number(sizing.storage.range.low * scale)}–${number(sizing.storage.range.high * scale)} ${storage.unit}`,
        ))}
        confidence={sizing.storage.confidence}
        formula={sizing.storage.formula}
        substituted={result.storageSubstituted}
        assumptionsLabel={engineNote}
        assumptions={sizing.storage.assumptions}
      />

      <ResultCard
        id="write-load"
        text={text}
        title={copy('Tải ghi toàn cụm', 'Write load per cluster')}
        value={<>{number(result.writeLoad.value)} <small>{text(copy('lượt ghi/s', 'writes/s'))}</small></>}
        confidence={result.writeLoad.confidence}
        formula={result.writeLoad.formula}
        substituted={result.writeLoad.substituted}
        assumptions={result.writeLoad.assumptions.map(text)}
      />

      <ResultCard
        id="network"
        text={text}
        title={copy('Băng thông payload', 'Payload bandwidth')}
        value={<>{mib(result.network.value)} <small>{text(copy('MiB/s vào (TB)', 'MiB/s in (avg)'))}</small></>}
        range={text(copy(
          `ra ${mib(result.network.egressBytesPerSec)} MiB/s (TB) · đỉnh ${mib(result.network.peakIngressBytesPerSec)} vào / ${mib(result.network.peakEgressBytesPerSec)} ra`,
          `out ${mib(result.network.egressBytesPerSec)} MiB/s (avg) · peak ${mib(result.network.peakIngressBytesPerSec)} in / ${mib(result.network.peakEgressBytesPerSec)} out`,
        ))}
        confidence={result.network.confidence}
        formula={result.network.formula}
        substituted={result.network.substituted}
        assumptions={result.network.assumptions.map(text)}
      />

      <article className="panel calc-card calc-hints" aria-labelledby="sizing-card-hints">
        <h3 id="sizing-card-hints">{text(copy('Gợi ý rà soát', 'Review hints'))}</h3>
        <ul>
          {result.hints.map((hint) => <li key={hint.id} className={`calc-hint ${hint.severity}`} data-rule={hint.id}>{text(hint.message)}</li>)}
        </ul>
        <p className="calc-help">{text(copy('Chỉ dùng quy tắc cố định. Phiên bản này không có AI.', 'Deterministic rules only. No AI in this version.'))} · formula v{sizing.nodes.formulaVersion}</p>
      </article>
    </>
  )
}

function ResultCard({ id, text, title, value, range, confidence, formula, substituted, assumptions, assumptionsLabel, children }: {
  id: string
  text: TextFn
  title: Copy
  value: React.ReactNode
  range?: string
  confidence: Confidence
  formula: string
  substituted: string
  assumptions: string[]
  assumptionsLabel?: Copy
  children?: React.ReactNode
}) {
  const titleId = `sizing-card-${id}`
  return (
    <article className="panel calc-card" data-card={id} aria-labelledby={titleId}>
      <h3 id={titleId}>{text(title)}</h3>
      <p className="calc-big">{value}</p>
      <p className="calc-meta">{range && <span className="calc-range">{range}</span>} <ConfidenceTag text={text} confidence={confidence} /></p>
      <div className="calc-formula" aria-label={text(copy('Công thức', 'Formula'))}>
        <code>{formula}</code>
        <code>{substituted}</code>
      </div>
      <p className="calc-assumptions-title">{text(assumptionsLabel ?? copy('Giả định:', 'Assumptions:'))}</p>
      <ul className="calc-assumptions">
        {assumptions.map((line) => <li key={line}>{line}</li>)}
      </ul>
      {children}
    </article>
  )
}

/**
 * `/hld` (pilot WP-C, docs/v3/06): export a design as an HLD .docx.
 *
 * Pick a design -> fill the project meta -> choose sections -> edit the
 * manual text (prefilled with skeletons derived from the model; no AI in the
 * pilot) -> download. Everything the user changes is kept per design in
 * localStorage (`archpilot.hld.<designId>`, TP-05).
 *
 * Sizing runs and reference pins come from services that may not be deployed
 * yet: any error there is a visible "no data yet" notice, never a crash, and
 * the document still downloads.
 */
import { useEffect, useId, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ExternalLink, FileDown, Info, ListTree, RotateCcw, TriangleAlert } from 'lucide-react'
import { isApiError } from '../../api/client'
import { getDesign, listDesigns, type DesignRecord, type DesignSummary } from '../../api/designs'
import { listReferencePins } from '../../api/reference'
import { listSizingRuns } from '../../api/sizingRuns'
import type { ReferencePin, SizingRun } from '../../contracts/pilot'
import type { ArchGraphV2 } from '../../domain/graph'
// Import the pure modules directly, not the barrel: the DOCX renderer (and the
// docx library) is loaded on demand when the user downloads, so it stays out
// of the main bundle.
import { buildHldModel, enabledSections, mergeManual, runLabel, sectionNumbers } from '../../domain/hld/build'
import { buildDiagramSvg } from '../../domain/hld/diagram'
import { todayIso } from '../../domain/hld/format'
import { sectionTitle } from '../../domain/hld/i18n'
import { buildSkeleton } from '../../domain/hld/skeleton'
import { ALWAYS_ON, SECTION_IDS, type HldLanguage, type HldManual, type HldMeta, type ManualField, type SectionId } from '../../domain/hld/types'
import { openGraph } from '../design/model/document'
import { copy, type Copy, type TextFn } from '../../ui/copy'
import { PageHeader } from '../../ui/PageHeader'
import { svgToPng } from './rasterise'
import { emptyStored, loadHldState, loadLastDesign, saveHldState, saveLastDesign, type StoredHld } from './storage'
import './hld.css'

type ListState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; items: DesignSummary[] }
type DesignState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; record: DesignRecord; graph: ArchGraphV2 | null; graphError: string | null }
type DataState<T> = { status: 'loading' } | { status: 'ready'; items: T[] } | { status: 'unavailable'; message: string }

const META_FIELDS: { key: keyof HldMeta; label: Copy; type?: 'date' }[] = [
  { key: 'customer', label: copy('Khách hàng', 'Customer') },
  { key: 'projectName', label: copy('Tên dự án', 'Project name') },
  { key: 'version', label: copy('Phiên bản tài liệu', 'Document version') },
  { key: 'date', label: copy('Ngày', 'Date'), type: 'date' },
  { key: 'author', label: copy('Người lập', 'Author') },
  { key: 'reviewer', label: copy('Người duyệt', 'Reviewer') },
  { key: 'changeNote', label: copy('Mô tả thay đổi (lịch sử)', 'Change description (history)') },
]

/** Manual fields, the section each belongs to, and its sub-number inside that section. */
const MANUAL_INFO: { field: ManualField; section: SectionId; sub?: number; label: Copy; hint?: Copy }[] = [
  { field: 'intro', section: 'intro', label: copy('Giới thiệu: mục đích, phạm vi, thuật ngữ, tài liệu tham chiếu', 'Introduction: purpose, scope, terms, references') },
  { field: 'business', section: 'requirements', sub: 1, label: copy('Tổng quan nghiệp vụ', 'Business overview') },
  { field: 'functional', section: 'requirements', sub: 2, label: copy('Yêu cầu chức năng tóm tắt', 'Functional requirements summary') },
  { field: 'nonFunctional', section: 'requirements', sub: 3, label: copy('Yêu cầu phi chức năng (SLA, RPO/RTO, bảo mật, tuân thủ)', 'Non-functional requirements (SLA, RPO/RTO, security, compliance)') },
  { field: 'constraints', section: 'requirements', sub: 4, label: copy('Ràng buộc', 'Constraints') },
  { field: 'principles', section: 'architecture', sub: 1, label: copy('Nguyên tắc thiết kế', 'Design principles') },
  { field: 'deployment', section: 'deployment', label: copy('Kiến trúc triển khai: ghi chú (cả mục khi thiết kế không có vùng chứa)', 'Deployment: notes (the whole section when the design has no containers)') },
  { field: 'availability', section: 'availability', label: copy('Tính sẵn sàng và DR', 'High availability and DR') },
  { field: 'security', section: 'security', label: copy('Bảo mật', 'Security') },
  { field: 'operations', section: 'operations', label: copy('Vận hành', 'Operations') },
  { field: 'risks', section: 'risks', label: copy('Rủi ro bổ sung (mỗi dòng một rủi ro)', 'Additional risks (one per line)'), hint: copy('Cảnh báo sizing và kết quả kiểm tra thiết kế được thêm tự động.', 'Sizing warnings and design-check findings are added automatically.') },
  { field: 'rollout', section: 'rollout', label: copy('Kế hoạch triển khai (tùy chọn)', 'Rollout plan (optional)') },
  { field: 'questions', section: 'questionsAppendix', label: copy('Câu hỏi làm rõ (mỗi dòng một câu; "câu hỏi | trả lời")', 'Clarification questions (one per line; "question | answer")') },
]

const SOURCE_LABEL: Record<string, Copy> = {
  auto: copy('Tự động', 'Automatic'),
  manual: copy('Viết tay', 'Manual'),
  mixed: copy('Kết hợp', 'Mixed'),
}

const SECTION_SOURCE: Record<SectionId, 'auto' | 'manual' | 'mixed'> = {
  info: 'auto', intro: 'manual', requirements: 'mixed', architecture: 'mixed', deployment: 'mixed', availability: 'manual', sizing: 'auto',
  infrastructure: 'auto', security: 'manual', operations: 'manual', risks: 'mixed', rollout: 'manual', traceAppendix: 'auto', questionsAppendix: 'manual', referencesAppendix: 'auto',
}

function errorText(error: unknown): string {
  if (isApiError(error)) return error.status ? `${error.detail} (HTTP ${error.status})` : error.detail
  return error instanceof Error ? error.message : String(error)
}

/** Stable key for include/exclude: the id, else model + time. */
const runKey = (run: SizingRun, index: number) => run.id ?? `${run.modelId}@${run.createdAt ?? index}`

function saveBlob(blob: Blob, fileName: string): boolean {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
  return true
}

export function HldScreen({ text, language }: { text: TextFn; language: 'vi' | 'en' }) {
  const [list, setList] = useState<ListState>({ status: 'loading' })
  const [listAttempt, setListAttempt] = useState(0)
  const [designId, setDesignId] = useState<string | null>(null)
  const [design, setDesign] = useState<DesignState>({ status: 'idle' })
  const [runs, setRuns] = useState<DataState<SizingRun>>({ status: 'loading' })
  const [pins, setPins] = useState<DataState<ReferencePin>>({ status: 'loading' })
  const [stored, setStored] = useState<StoredHld>(emptyStored)
  const [persistFailed, setPersistFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [lastFile, setLastFile] = useState<string | null>(null)
  const ids = useId()

  // Design list.
  useEffect(() => {
    const controller = new AbortController()
    setList({ status: 'loading' })
    listDesigns({ limit: 100, signal: controller.signal })
      .then((result) => {
        setList({ status: 'ready', items: result.items })
        const remembered = loadLastDesign()
        const pick = result.items.find((item) => item.id === remembered) ?? result.items[0]
        setDesignId((current) => current ?? pick?.id ?? null)
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setList({ status: 'error', message: errorText(error) })
      })
    return () => controller.abort()
  }, [listAttempt])

  // The selected design, its runs and its pins. Runs/pins failures are notices only.
  useEffect(() => {
    if (!designId) return
    const controller = new AbortController()
    saveLastDesign(designId)
    setStored(loadHldState(designId))
    setPersistFailed(false)
    setDownloadError(null)
    setLastFile(null)
    setDesign({ status: 'loading' })
    setRuns({ status: 'loading' })
    setPins({ status: 'loading' })
    getDesign(designId, controller.signal)
      .then((record) => {
        let graph: ArchGraphV2 | null = null
        let graphError: string | null = null
        try {
          graph = openGraph(record.graph, record.name)
        } catch (error) {
          graphError = errorText(error)
        }
        setDesign({ status: 'ready', record, graph, graphError })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setDesign({ status: 'error', message: errorText(error) })
      })
    listSizingRuns(designId, controller.signal)
      .then((result) => {
        const items = Array.isArray(result?.items) ? result.items : []
        // Keep runs of this design (and runs whose designId the backend left out); drop others.
        setRuns({ status: 'ready', items: items.filter((run) => !run.designId || run.designId === designId) })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setRuns({ status: 'unavailable', message: errorText(error) })
      })
    listReferencePins(designId, controller.signal)
      .then((result) => {
        const items = Array.isArray(result?.items) ? result.items : []
        setPins({ status: 'ready', items: items.filter((pin) => !pin.designId || pin.designId === designId) })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setPins({ status: 'unavailable', message: errorText(error) })
      })
    return () => controller.abort()
  }, [designId])

  function update(patch: (previous: StoredHld) => StoredHld) {
    setStored((previous) => {
      const next = patch(previous)
      if (designId) setPersistFailed(!saveHldState(designId, next))
      return next
    })
  }

  const record = design.status === 'ready' ? design.record : null
  const graph = design.status === 'ready' ? design.graph : null
  const docLanguage: HldLanguage = stored.language ?? language
  const [today] = useState(() => todayIso())
  const meta: HldMeta = {
    customer: stored.meta.customer ?? '',
    projectName: stored.meta.projectName ?? record?.name ?? '',
    version: stored.meta.version ?? '1.0',
    author: stored.meta.author ?? '',
    reviewer: stored.meta.reviewer ?? '',
    date: stored.meta.date ?? today,
    changeNote: stored.meta.changeNote ?? '',
  }
  const includedRuns = useMemo(
    () => (runs.status === 'ready' ? runs.items.filter((run, index) => !stored.excludedRuns.includes(runKey(run, index))) : null),
    [runs, stored.excludedRuns],
  )
  const includedPins = useMemo(
    () => (pins.status === 'ready' ? pins.items.filter((pin) => !stored.excludedPins.includes(pin.id)) : null),
    [pins, stored.excludedPins],
  )
  const designInput = useMemo(
    () =>
      record
        ? {
            id: record.id,
            name: record.name,
            graph,
            revision: record.revision,
            url: `${typeof window !== 'undefined' ? window.location.origin : ''}/designs/${encodeURIComponent(record.id)}`,
          }
        : null,
    [record, graph],
  )
  const skeleton = useMemo<HldManual | null>(
    () => (designInput ? buildSkeleton({ design: designInput, runs: includedRuns, meta, language: docLanguage }) : null),
    // meta is rebuilt every render; only the two fields the skeleton reads matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [designInput, includedRuns, meta.customer, meta.projectName, docLanguage],
  )
  const manual = skeleton ? mergeManual(skeleton, stored.manual) : null
  const model = useMemo(
    () =>
      designInput && manual
        ? buildHldModel({ design: designInput, runs: includedRuns, pins: includedPins, meta, manual, language: docLanguage, sections: stored.sections })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [designInput, includedRuns, includedPins, JSON.stringify(meta), JSON.stringify(manual), docLanguage, stored.sections],
  )
  const diagram = useMemo(() => (graph ? buildDiagramSvg(graph, docLanguage) : null), [graph, docLanguage])
  const diagramPreview = useMemo(() => (diagram ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(diagram.svg)}` : null), [diagram])
  const numbers = sectionNumbers(enabledSections(stored.sections))
  const dataLoading = runs.status === 'loading' || pins.status === 'loading'

  async function download() {
    if (!model) return
    setBusy(true)
    setDownloadError(null)
    try {
      const [{ renderDocxBlob }, image] = await Promise.all([
        import('../../domain/hld/render'),
        stored.sections.architecture !== false && diagram ? svgToPng(diagram.svg, diagram.width, diagram.height) : Promise.resolve(null),
      ])
      const blob = await renderDocxBlob(model, { diagram: image })
      if (!saveBlob(blob, model.fileName)) throw new Error(text(copy('Trình duyệt không hỗ trợ tải tệp.', 'This browser cannot save files.')))
      setLastFile(model.fileName)
    } catch (error) {
      setDownloadError(errorText(error))
    } finally {
      setBusy(false)
    }
  }

  const downloadButton = (
    <button type="button" className="primary-button hld-download" onClick={download} disabled={!model || busy || dataLoading}>
      <FileDown size={16} aria-hidden="true" />
      {busy ? text(copy('Đang tạo tài liệu…', 'Building the document…')) : text(copy('Tải HLD (.docx)', 'Download HLD (.docx)'))}
    </button>
  )

  const notices: string[] = []
  if (runs.status === 'unavailable') notices.push(text(copy(`Chưa có dữ liệu sizing: dịch vụ chưa sẵn sàng (${runs.message}). Tài liệu vẫn tải được, mục Sizing sẽ ghi chú điều này.`, `No sizing data yet: the service is not available (${runs.message}). The document still downloads; the Sizing section says so.`)))
  if (pins.status === 'unavailable') notices.push(text(copy(`Chưa có danh sách tham chiếu: dịch vụ chưa sẵn sàng (${pins.message}).`, `No reference pins yet: the service is not available (${pins.message}).`)))
  if (design.status === 'ready' && design.graphError) notices.push(text(copy(`Không đọc được đồ thị thiết kế: ${design.graphError}`, `The design graph could not be read: ${design.graphError}`)))
  if (persistFailed) notices.push(text(copy('Trình duyệt không cho lưu nội dung (localStorage). Nội dung sẽ mất khi tải lại trang.', 'The browser refused to store your text (localStorage). It will be lost on reload.')))

  return (
    <div className="page-content hld-screen" data-studio="hld">
      <PageHeader
        eyebrow="HLD EXPORT"
        title={text(copy('Xuất tài liệu HLD', 'HLD export'))}
        description={text(copy('Sinh HLD dạng DOCX từ thiết kế, kết quả sizing và tham chiếu.', 'Generate a DOCX HLD from a design, its sizing runs and references.'))}
        text={text}
        action={downloadButton}
      />

      {list.status === 'loading' && <p role="status" className="hld-state">{text(copy('Đang tải danh sách thiết kế…', 'Loading designs…'))}</p>}
      {list.status === 'error' && (
        <div role="alert" className="hld-state hld-error">
          <p>{text(copy('Không tải được danh sách thiết kế.', 'The design list could not be loaded.'))} {list.message}</p>
          <button type="button" className="secondary-button" onClick={() => setListAttempt(listAttempt + 1)}>{text(copy('Thử lại', 'Retry'))}</button>
        </div>
      )}
      {list.status === 'ready' && list.items.length === 0 && (
        <div className="hld-state">
          <strong>{text(copy('Chưa có thiết kế nào', 'No designs yet'))}</strong>
          <p>{text(copy('Tạo một thiết kế trước, rồi quay lại đây để xuất HLD.', 'Create a design first, then come back here to export its HLD.'))}</p>
          <Link className="secondary-button" to="/designs">{text(copy('Đến trang Thiết kế', 'Go to Designs'))}</Link>
        </div>
      )}

      {list.status === 'ready' && list.items.length > 0 && (
        <div className="hld-layout">
          <div className="hld-main">
            <section className="panel hld-panel" aria-labelledby={`${ids}-design`}>
              <h2 id={`${ids}-design`}>{text(copy('1. Thiết kế', '1. Design'))}</h2>
              <div className="hld-row">
                <label className="hld-field hld-grow">
                  <span>{text(copy('Thiết kế nguồn', 'Source design'))}</span>
                  <select value={designId ?? ''} onChange={(event) => setDesignId(event.target.value)} data-testid="hld-design">
                    {list.items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
                {designId && (
                  <Link className="secondary-button" to={`/designs/${encodeURIComponent(designId)}`}>
                    <ExternalLink size={14} aria-hidden="true" />{text(copy('Mở thiết kế', 'Open design'))}
                  </Link>
                )}
              </div>
              {design.status === 'loading' && <p role="status" className="hld-muted">{text(copy('Đang mở thiết kế…', 'Opening the design…'))}</p>}
              {design.status === 'error' && <p role="alert" className="hld-error">{text(copy('Không mở được thiết kế.', 'The design could not be opened.'))} {design.message}</p>}
            </section>

            {notices.length > 0 && (
              <div className="hld-notices" role="status" data-testid="hld-notices">
                {notices.map((notice) => <p key={notice}><TriangleAlert size={15} aria-hidden="true" />{notice}</p>)}
              </div>
            )}

            {record && (
              <>
                <section className="panel hld-panel" aria-labelledby={`${ids}-meta`}>
                  <h2 id={`${ids}-meta`}>{text(copy('2. Thông tin dự án', '2. Project information'))}</h2>
                  <div className="hld-grid">
                    {META_FIELDS.map((field) => (
                      <label key={field.key} className={`hld-field${field.key === 'changeNote' ? ' hld-wide' : ''}`}>
                        <span>{text(field.label)}</span>
                        <input
                          type={field.type ?? 'text'}
                          value={meta[field.key] ?? ''}
                          maxLength={200}
                          data-meta={field.key}
                          onChange={(event) => {
                            const value = event.target.value
                            update((previous) => ({ ...previous, meta: { ...previous.meta, [field.key]: value } }))
                          }}
                        />
                      </label>
                    ))}
                    <fieldset className="hld-field hld-language">
                      <legend>{text(copy('Ngôn ngữ tài liệu', 'Document language'))}</legend>
                      {(['vi', 'en'] as const).map((value) => (
                        <label key={value} className="hld-radio">
                          <input
                            type="radio"
                            name={`${ids}-language`}
                            value={value}
                            checked={docLanguage === value}
                            onChange={() => update((previous) => ({ ...previous, language: value }))}
                          />
                          {value === 'vi' ? 'Tiếng Việt' : 'English'}
                        </label>
                      ))}
                    </fieldset>
                  </div>
                </section>

                <section className="panel hld-panel" aria-labelledby={`${ids}-sections`}>
                  <h2 id={`${ids}-sections`}>{text(copy('3. Các mục của tài liệu', '3. Document sections'))}</h2>
                  <ul className="hld-toggles">
                    {SECTION_IDS.map((id) => {
                      const locked = ALWAYS_ON.has(id)
                      const on = locked || stored.sections[id] !== false
                      return (
                        <li key={id}>
                          <label className={`hld-toggle${on ? '' : ' off'}`}>
                            <input
                              type="checkbox"
                              checked={on}
                              disabled={locked}
                              data-section={id}
                              onChange={(event) => {
                                const checked = event.target.checked
                                update((previous) => ({ ...previous, sections: { ...previous.sections, [id]: checked } }))
                              }}
                            />
                            <span className="hld-toggle-title">{sectionTitle(id, language)}</span>
                            <span className={`hld-badge ${SECTION_SOURCE[id]}`}>{text(SOURCE_LABEL[SECTION_SOURCE[id]])}</span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                </section>

                <section className="panel hld-panel" aria-labelledby={`${ids}-manual`}>
                  <h2 id={`${ids}-manual`}>{text(copy('4. Nội dung viết tay', '4. Manual content'))}</h2>
                  <p className="hld-muted"><Info size={14} aria-hidden="true" />{text(copy(
                    'Các ô đã điền sẵn khung nội dung từ thiết kế. Dòng bắt đầu bằng "- " thành gạch đầu dòng. Nội dung được lưu tự động trên trình duyệt này, theo từng thiết kế.',
                    'Fields start from a skeleton derived from the design. Lines starting with "- " become bullets. Your text is saved automatically in this browser, per design.',
                  ))}</p>
                  {MANUAL_INFO.filter((info) => numbers.has(info.section)).map((info) => {
                    const number = numbers.get(info.section)
                    const prefix = number ? (info.sub ? `${number}.${info.sub}` : /^[A-Z]$/.test(number) ? text(copy(`Phụ lục ${number}`, `Appendix ${number}`)) : number) : ''
                    const edited = typeof stored.manual[info.field] === 'string'
                    const fieldId = `${ids}-manual-${info.field}`
                    return (
                      <div key={info.field} className="hld-manual">
                        <div className="hld-manual-head">
                          <label htmlFor={fieldId}>{prefix ? `${prefix} · ` : ''}{text(info.label)}</label>
                          <span className={`hld-badge ${edited ? 'edited' : 'skeleton'}`}>{edited ? text(copy('Đã sửa', 'Edited')) : text(copy('Khung mẫu', 'Skeleton'))}</span>
                          {edited && (
                            <button
                              type="button"
                              className="hld-link-button"
                              onClick={() => update((previous) => {
                                const nextManual = { ...previous.manual }
                                delete nextManual[info.field]
                                return { ...previous, manual: nextManual }
                              })}
                            >
                              <RotateCcw size={13} aria-hidden="true" />{text(copy('Khôi phục khung mẫu', 'Reset to skeleton'))}
                            </button>
                          )}
                        </div>
                        {info.hint && <p className="hld-muted hld-hint">{text(info.hint)}</p>}
                        <textarea
                          id={fieldId}
                          data-manual={info.field}
                          rows={Math.min(12, Math.max(3, (manual?.[info.field] ?? '').split('\n').length + 1))}
                          value={manual?.[info.field] ?? ''}
                          onChange={(event) => {
                            const value = event.target.value
                            update((previous) => ({ ...previous, manual: { ...previous.manual, [info.field]: value } }))
                          }}
                        />
                      </div>
                    )
                  })}
                </section>

                <section className="panel hld-panel" aria-labelledby={`${ids}-data`}>
                  <h2 id={`${ids}-data`}>{text(copy('5. Sizing và tham chiếu', '5. Sizing and references'))}</h2>
                  <h3>{text(copy('Các lần chạy sizing', 'Sizing runs'))}</h3>
                  {runs.status === 'loading' && <p role="status" className="hld-muted">{text(copy('Đang tải…', 'Loading…'))}</p>}
                  {runs.status === 'unavailable' && <p className="hld-muted" data-testid="hld-runs-unavailable">{text(copy('Chưa có dữ liệu (dịch vụ sizing chưa sẵn sàng).', 'No data yet (the sizing service is not available).'))}</p>}
                  {runs.status === 'ready' && runs.items.length === 0 && <p className="hld-muted">{text(copy('Chưa có lần chạy sizing nào được lưu cho thiết kế này.', 'No sizing run has been saved for this design yet.'))}</p>}
                  {runs.status === 'ready' && runs.items.length > 0 && (
                    <ul className="hld-includes">
                      {runs.items.map((run, index) => {
                        const key = runKey(run, index)
                        const included = !stored.excludedRuns.includes(key)
                        return (
                          <li key={key}>
                            <label>
                              <input
                                type="checkbox"
                                checked={included}
                                onChange={(event) => {
                                  const checked = event.target.checked
                                  update((previous) => ({ ...previous, excludedRuns: checked ? previous.excludedRuns.filter((item) => item !== key) : [...previous.excludedRuns, key] }))
                                }}
                              />
                              <strong>{runLabel(run)}</strong>
                              <span className="hld-muted">{run.modelName} · {run.rulePackId} v{run.rulePackVersion}{run.createdAt ? ` · ${run.createdAt.slice(0, 16).replace('T', ' ')}` : ''}</span>
                            </label>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                  <h3>{text(copy('Tham chiếu đã ghim (SysDesAi)', 'Pinned references (SysDesAi)'))}</h3>
                  {pins.status === 'loading' && <p role="status" className="hld-muted">{text(copy('Đang tải…', 'Loading…'))}</p>}
                  {pins.status === 'unavailable' && <p className="hld-muted" data-testid="hld-pins-unavailable">{text(copy('Chưa có dữ liệu (dịch vụ tham chiếu chưa sẵn sàng).', 'No data yet (the reference service is not available).'))}</p>}
                  {pins.status === 'ready' && pins.items.length === 0 && <p className="hld-muted">{text(copy('Chưa ghim tham chiếu nào cho thiết kế này.', 'No references pinned for this design yet.'))}</p>}
                  {pins.status === 'ready' && pins.items.length > 0 && (
                    <ul className="hld-includes">
                      {pins.items.map((pin) => {
                        const included = !stored.excludedPins.includes(pin.id)
                        return (
                          <li key={pin.id}>
                            <label>
                              <input
                                type="checkbox"
                                checked={included}
                                onChange={(event) => {
                                  const checked = event.target.checked
                                  update((previous) => ({ ...previous, excludedPins: checked ? previous.excludedPins.filter((item) => item !== pin.id) : [...previous.excludedPins, pin.id] }))
                                }}
                              />
                              <strong>{pin.title}</strong>
                              <span className="hld-muted">{pin.stepPosition ? `${text(copy('Bước', 'Step'))} ${pin.stepPosition} · ` : ''}{pin.url}</span>
                            </label>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </section>
              </>
            )}
          </div>

          <aside className="panel hld-outline" aria-labelledby={`${ids}-outline`}>
            <h2 id={`${ids}-outline`}><ListTree size={16} aria-hidden="true" />{text(copy('Xem trước dàn ý', 'Outline preview'))}</h2>
            {model ? (
              <>
                <dl className="hld-counts" data-testid="hld-counts">
                  <div data-count="components"><dt>{text(copy('Thành phần', 'Components'))}</dt><dd>{model.stats.components}</dd></div>
                  <div data-count="connections"><dt>{text(copy('Kết nối', 'Connections'))}</dt><dd>{model.stats.connections}</dd></div>
                  <div data-count="runs"><dt>{text(copy('Lần chạy sizing', 'Sizing runs'))}</dt><dd>{runs.status === 'unavailable' ? '—' : model.stats.sizingRuns}</dd></div>
                  <div data-count="pins"><dt>{text(copy('Tham chiếu', 'References'))}</dt><dd>{pins.status === 'unavailable' ? '—' : model.stats.pins}</dd></div>
                  <div data-count="risks"><dt>{text(copy('Rủi ro', 'Risks'))}</dt><dd>{model.stats.risks}</dd></div>
                </dl>
                <ol className="hld-outline-list" data-testid="hld-outline">
                  {model.sections.map((section) => (
                    <li key={section.id} data-outline={section.id}>
                      <span>{section.heading}</span>
                      <span className={`hld-badge ${section.source}`}>{text(SOURCE_LABEL[section.source])}</span>
                    </li>
                  ))}
                </ol>
                {diagramPreview && stored.sections.architecture !== false && (
                  <figure className="hld-diagram">
                    <img src={diagramPreview} alt={text(copy('Sơ đồ logic sẽ chèn vào mục Kiến trúc tổng thể', 'Logical diagram to embed in Overall architecture'))} />
                    <figcaption>{text(copy('Sơ đồ chèn vào tài liệu', 'Diagram embedded in the document'))}</figcaption>
                  </figure>
                )}
                <p className="hld-muted hld-file">{text(copy('Tên tệp', 'File name'))}: <code>{model.fileName}</code></p>
                {downloadError && <p role="alert" className="hld-error">{text(copy('Không tạo được tài liệu.', 'The document could not be built.'))} {downloadError}</p>}
                {lastFile && !downloadError && <p role="status" className="hld-success">{text(copy(`Đã tạo ${lastFile}.`, `${lastFile} is ready.`))}</p>}
                <p className="hld-muted hld-hint">{text(copy('Khi mở trong Word, chọn "Yes" để cập nhật mục lục và số trang.', 'When Word opens the file, answer "Yes" to update the table of contents and page numbers.'))}</p>
              </>
            ) : (
              <p className="hld-muted">{text(copy('Chọn một thiết kế để xem dàn ý.', 'Pick a design to see the outline.'))}</p>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}

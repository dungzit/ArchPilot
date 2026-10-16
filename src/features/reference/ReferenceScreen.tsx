import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowUpRight, Pin, Search } from 'lucide-react'
import { copy, type Copy, type TextFn } from '../../ui/copy'
import { PageHeader } from '../../ui/PageHeader'
import { isApiError } from '../../api/client'
import { addReferencePin, referenceStatus, searchReferences } from '../../api/reference'
import { listDesigns, type DesignSummary } from '../../api/designs'
import type { ReferenceHit, ReferenceSearchResponse, ReferenceStatus, ReferenceTab } from '../../contracts/pilot'
import './reference.css'

/**
 * Pilot WP-B: SysDesAi reference search (docs/v3/03, KH-P1-07/09/15).
 *
 * - Search box: debounced 300 ms while typing, immediate on Enter.
 * - Filters: phase (Vietnamese labels) and category.
 * - Every card links to SysDesAi in a new tab and carries the attribution
 *   "Nguồn: SysDesAi · Nội dung AI-generated, chỉ để tham khảo" (KH-P1-15).
 * - "Pin to design" saves the reference on one of the user's own designs.
 *
 * Snippets are plain text from the API and rendered as text (never HTML);
 * only the query words are wrapped in <mark>.
 */

export const SEARCH_DEBOUNCE_MS = 300
const RESULT_LIMIT = 20

export const PHASES: { value: string; label: Copy }[] = [
  { value: 'clarify', label: copy('Làm rõ yêu cầu', 'Clarify requirements') },
  { value: 'problem', label: copy('Bài toán', 'Problem') },
  { value: 'scope', label: copy('Phạm vi', 'Scope') },
  { value: 'estimate', label: copy('Ước lượng', 'Estimates') },
  { value: 'api', label: copy('Thiết kế API', 'API design') },
  { value: 'data', label: copy('Mô hình dữ liệu', 'Data model') },
  { value: 'build', label: copy('Xây dựng kiến trúc', 'Build-up') },
  { value: 'flows', label: copy('Luồng xử lý', 'Flows') },
  { value: 'scale', label: copy('Mở rộng & sự cố', 'Scaling & failures') },
  { value: 'wrap', label: copy('Tổng kết', 'Wrap-up') },
]

// SysDesAi gallery filter chips (2026-10-14). Categories seen in results are added.
const KNOWN_CATEGORIES = [
  'AI & ML', 'API Platform', 'Analytics', 'E-commerce', 'Messaging', 'Other',
  'Real-time', 'Search & Discovery', 'Social Media', 'Storage & CDN',
]

const TAB_LABELS: Record<ReferenceTab, Copy> = {
  featured: copy('Nổi bật', 'Featured'),
  'real-world': copy('Thực tế', 'Real World'),
  community: copy('Cộng đồng', 'Community'),
}

const ATTRIBUTION = copy('Nguồn: SysDesAi · Nội dung AI-generated, chỉ để tham khảo', 'Source: SysDesAi · AI-generated content, for reference only')

type SearchState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; response: ReferenceSearchResponse }

function isHttpUrl(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^https?:\/\/[^\s<>"']+$/i.test(value)
}

function formatDate(value: string | null | undefined, language: 'vi' | 'en'): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString(language === 'vi' ? 'vi-VN' : 'en-GB', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

function phaseLabel(phase: string, text: TextFn): string {
  const known = PHASES.find((item) => item.value === phase)
  return known ? text(known.label) : phase
}

function errorMessage(error: unknown, text: TextFn): string {
  if (isApiError(error)) {
    if (error.kind === 'unreachable') return text(copy('Không kết nối được máy chủ.', 'The server is unreachable.'))
    return error.detail
  }
  return text(copy('Đã xảy ra lỗi không xác định.', 'Something went wrong.'))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Wrap query words in <mark>. Pure text in, React nodes out: no HTML parsing. */
export function highlight(snippet: string, words: string[]): ReactNode[] {
  const usable = words.filter((word) => word.length >= 3).map((word) => escapeRegExp(word.length > 4 ? word.slice(0, -1) : word))
  if (usable.length === 0) return [snippet]
  const pattern = new RegExp(`\\b(${usable.join('|')})[a-z]*`, 'gi')
  const nodes: ReactNode[] = []
  let last = 0
  for (const match of snippet.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > last) nodes.push(snippet.slice(last, index))
    nodes.push(<mark key={`${index}-${match[0]}`}>{match[0]}</mark>)
    last = index + match[0].length
  }
  if (last < snippet.length) nodes.push(snippet.slice(last))
  return nodes
}

function queryWords(expandedQuery: string): string[] {
  return Array.from(new Set(expandedQuery.toLowerCase().match(/[a-z0-9]+/g) ?? []))
}

export function ReferenceScreen({ text, language }: { text: TextFn; language: 'vi' | 'en' }) {
  const [query, setQuery] = useState('')
  const [phase, setPhase] = useState('')
  const [category, setCategory] = useState('')
  const [state, setState] = useState<SearchState>({ kind: 'idle' })
  const [status, setStatus] = useState<ReferenceStatus | null>(null)
  const [statusError, setStatusError] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    referenceStatus(controller.signal)
      .then(setStatus)
      .catch(() => {
        if (!controller.signal.aborted) setStatusError(true)
      })
    return () => controller.abort()
  }, [])

  const runSearch = useCallback((q: string, phaseValue: string, categoryValue: string) => {
    controllerRef.current?.abort()
    if (!q.trim()) {
      setState({ kind: 'idle' })
      return
    }
    const controller = new AbortController()
    controllerRef.current = controller
    setState({ kind: 'loading' })
    searchReferences(q.trim(), { limit: RESULT_LIMIT, phase: phaseValue || undefined, category: categoryValue || undefined, signal: controller.signal })
      .then((response) => {
        if (!controller.signal.aborted) setState({ kind: 'done', response })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ kind: 'error', message: errorMessage(error, text) })
      })
  }, [text])

  // Debounced search while typing or changing a filter.
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => runSearch(query, phase, category), SEARCH_DEBOUNCE_MS)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [query, phase, category, runSearch])

  useEffect(() => () => controllerRef.current?.abort(), [])

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (timerRef.current) clearTimeout(timerRef.current)
    runSearch(query, phase, category)
  }

  const categories = useMemo(() => {
    const seen = new Set(KNOWN_CATEGORIES)
    if (state.kind === 'done') state.response.items.forEach((item) => item.categories.forEach((value) => seen.add(value)))
    if (category) seen.add(category)
    return Array.from(seen).sort((a, b) => a.localeCompare(b))
  }, [state, category])

  const statusLine = (() => {
    if (statusError) return text(copy('Không đọc được trạng thái chỉ mục.', 'Could not read the index status.'))
    if (!status) return text(copy('Đang tải trạng thái chỉ mục…', 'Loading index status…'))
    if (status.indexedDesigns === 0) return text(copy('Chưa có dữ liệu tham chiếu. Quản trị viên cần chạy crawler và nạp snapshot.', 'No reference data yet. An administrator must run the crawler and load the snapshot.'))
    const updated = formatDate(status.lastCrawlAt, language)
    const count = status.indexedDesigns.toLocaleString(language === 'vi' ? 'vi-VN' : 'en-US')
    const base = text(copy(`Đã index ${count} thiết kế`, `Indexed ${count} designs`))
    return updated ? `${base} · ${text(copy('cập nhật', 'updated'))} ${updated}` : base
  })()

  return (
    <div className="page-content reference-screen" data-studio="reference">
      <PageHeader
        eyebrow="REFERENCE"
        title={text(copy('Tra cứu tham chiếu SysDesAi', 'SysDesAi reference search'))}
        description={text(copy('Tìm thiết kế tham chiếu theo từ khóa, trả về link và bước cụ thể.', 'Find reference designs by keyword, with links to the matching steps.'))}
        text={text}
        action={<span />}
      />

      <form className="ref-search" role="search" onSubmit={onSubmit}>
        <label className="ref-query">
          <Search size={17} aria-hidden="true" />
          <span className="visually-hidden">{text(copy('Từ khóa tìm kiếm', 'Search terms'))}</span>
          <input
            id="reference-query"
            type="search"
            value={query}
            maxLength={300}
            autoComplete="off"
            placeholder={text(copy('Ví dụ: bộ nhớ đệm cho chuyển hướng link rút gọn, rate limiting…', 'e.g. cache for URL shortener redirects, rate limiting…'))}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="ref-filter">
          <span>{text(copy('Bước', 'Step'))}</span>
          <select id="reference-phase" value={phase} onChange={(event) => setPhase(event.target.value)}>
            <option value="">{text(copy('Tất cả các bước', 'All steps'))}</option>
            {PHASES.map((item) => <option key={item.value} value={item.value}>{text(item.label)}</option>)}
          </select>
        </label>
        <label className="ref-filter">
          <span>{text(copy('Danh mục', 'Category'))}</span>
          <select id="reference-category" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">{text(copy('Tất cả danh mục', 'All categories'))}</option>
            {categories.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <button type="submit" className="primary-button">{text(copy('Tìm', 'Search'))}</button>
      </form>

      <p className="ref-status" data-testid="reference-status">{statusLine}</p>

      <ReferenceResults state={state} text={text} language={language} />
    </div>
  )
}

function ReferenceResults({ state, text, language }: { state: SearchState; text: TextFn; language: 'vi' | 'en' }) {
  if (state.kind === 'idle') {
    return <p className="ref-hint">{text(copy('Nhập từ khóa tiếng Việt hoặc tiếng Anh. Kết quả trỏ tới thiết kế và bước cụ thể trên SysDesAi.', 'Type Vietnamese or English keywords. Results link to the design and the matching step on SysDesAi.'))}</p>
  }
  if (state.kind === 'loading') {
    return <p className="ref-loading" role="status">{text(copy('Đang tìm…', 'Searching…'))}</p>
  }
  if (state.kind === 'error') {
    return <p className="ref-error" role="alert">{text(copy('Tìm kiếm thất bại: ', 'Search failed: '))}{state.message}</p>
  }
  const { response } = state
  const words = queryWords(response.expandedQuery)
  return (
    <section className="ref-results" aria-live="polite">
      <p className="ref-summary">
        {text(copy(`${response.total} thiết kế phù hợp`, `${response.total} matching designs`))}
        {response.expandedQuery ? <> · {text(copy('đã tìm', 'searched for'))}: <code className="ref-expanded">{response.expandedQuery}</code></> : null}
      </p>
      {response.items.length === 0
        ? <p className="ref-empty">{text(copy('Không tìm thấy tham chiếu phù hợp. Thử từ khóa khác hoặc bỏ bộ lọc.', 'No matching reference found. Try other keywords or clear the filters.'))}</p>
        : <ol className="ref-list">{response.items.map((hit) => <ReferenceCard key={hit.shareId} hit={hit} words={words} text={text} language={language} />)}</ol>}
    </section>
  )
}

function ReferenceCard({ hit, words, text, language }: { hit: ReferenceHit; words: string[]; text: TextFn; language: 'vi' | 'en' }) {
  const updated = formatDate(hit.updatedAt, language)
  const articleUrl = hit.designSource === 'article' && isHttpUrl(hit.sourceArticleUrl) ? hit.sourceArticleUrl : null
  return (
    <li className="ref-card" data-share-id={hit.shareId}>
      <div className="ref-card-head">
        <h2>
          <a href={hit.url} target="_blank" rel="noopener noreferrer">
            {hit.title} <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </h2>
        <div className="ref-badges">
          {hit.tab ? <span className={`ref-tab ref-tab-${hit.tab}`}>{text(TAB_LABELS[hit.tab])}</span> : null}
          {hit.upvoteCount != null ? <span className="ref-upvotes" title={text(copy('Lượt upvote (tín hiệu yếu)', 'Upvotes (weak signal)'))}>▲ {hit.upvoteCount}</span> : null}
        </div>
      </div>
      {hit.prompt ? <p className="ref-prompt">“{hit.prompt}”</p> : null}
      {hit.categories.length ? <div className="ref-chips">{hit.categories.map((value) => <span key={value} className="ref-chip">{value}</span>)}</div> : null}
      {articleUrl
        ? <p className="ref-article">{text(copy('Bài gốc', 'Original article'))}: <a href={articleUrl} target="_blank" rel="noopener noreferrer">{hit.sourceBlogName || articleUrl}</a></p>
        : null}
      {hit.steps.length ? (
        <ul className="ref-steps">
          {hit.steps.map((step) => (
            <li key={step.position}>
              <div className="ref-step-title">
                {text(copy(`Bước ${step.position}`, `Step ${step.position}`))}: {step.title} <span className="ref-phase">({phaseLabel(step.phase, text)})</span>
              </div>
              {step.snippet ? <p className="ref-snippet">{highlight(step.snippet, words)}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="ref-card-foot">
        <span className="ref-attribution">{text(ATTRIBUTION)}{updated ? ` · ${text(copy('cập nhật', 'updated'))} ${updated}` : ''}</span>
        <PinControl hit={hit} text={text} />
      </div>
    </li>
  )
}

type PinState =
  | { kind: 'closed' }
  | { kind: 'loading' }
  | { kind: 'open'; designs: DesignSummary[] }
  | { kind: 'saving'; designs: DesignSummary[] }
  | { kind: 'saved'; designName: string }
  | { kind: 'error'; message: string; designs: DesignSummary[] }

function PinControl({ hit, text }: { hit: ReferenceHit; text: TextFn }) {
  const [pin, setPin] = useState<PinState>({ kind: 'closed' })
  const [designId, setDesignId] = useState('')
  const [stepPosition, setStepPosition] = useState('')
  const [note, setNote] = useState('')

  const open = () => {
    setPin({ kind: 'loading' })
    listDesigns({ limit: 100 })
      .then((list) => {
        setPin({ kind: 'open', designs: list.items })
        setDesignId((current) => current || list.items[0]?.id || '')
      })
      .catch((error: unknown) => setPin({ kind: 'error', message: errorMessage(error, text), designs: [] }))
  }

  if (pin.kind === 'closed') {
    return <button type="button" className="secondary-button ref-pin-button" onClick={open}><Pin size={13} aria-hidden="true" /> {text(copy('Ghim vào thiết kế', 'Pin to design'))}</button>
  }
  if (pin.kind === 'loading') return <span className="ref-pin-note" role="status">{text(copy('Đang tải danh sách thiết kế…', 'Loading your designs…'))}</span>
  if (pin.kind === 'saved') return <span className="ref-pin-note ref-pin-ok" role="status">{text(copy(`Đã ghim vào “${pin.designName}”.`, `Pinned to “${pin.designName}”.`))}</span>

  const designs = pin.designs
  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!designId) return
    setPin({ kind: 'saving', designs })
    addReferencePin({ designId, shareId: hit.shareId, stepPosition: stepPosition ? Number(stepPosition) : null, note: note.trim() || null })
      .then(() => setPin({ kind: 'saved', designName: designs.find((item) => item.id === designId)?.name ?? designId }))
      .catch((error: unknown) => setPin({ kind: 'error', message: errorMessage(error, text), designs }))
  }

  return (
    <form className="ref-pin-form" onSubmit={save} aria-label={text(copy('Ghim tham chiếu', 'Pin reference'))}>
      {designs.length === 0
        ? <span className="ref-pin-note">{text(copy('Bạn chưa có thiết kế nào để ghim.', 'You have no design to pin to yet.'))}</span>
        : (
          <>
            <select aria-label={text(copy('Thiết kế', 'Design'))} value={designId} onChange={(event) => setDesignId(event.target.value)}>
              {designs.map((design) => <option key={design.id} value={design.id}>{design.name}</option>)}
            </select>
            <select aria-label={text(copy('Bước', 'Step'))} value={stepPosition} onChange={(event) => setStepPosition(event.target.value)}>
              <option value="">{text(copy('Cả thiết kế', 'Whole design'))}</option>
              {hit.steps.map((step) => <option key={step.position} value={String(step.position)}>{text(copy(`Bước ${step.position}`, `Step ${step.position}`))}: {step.title}</option>)}
            </select>
            <input aria-label={text(copy('Ghi chú', 'Note'))} value={note} maxLength={1000} placeholder={text(copy('Ghi chú (tuỳ chọn)', 'Note (optional)'))} onChange={(event) => setNote(event.target.value)} />
            <button type="submit" className="primary-button" disabled={pin.kind === 'saving' || !designId}>{text(copy('Ghim', 'Pin'))}</button>
          </>
        )}
      <button type="button" className="secondary-button" onClick={() => setPin({ kind: 'closed' })}>{text(copy('Huỷ', 'Cancel'))}</button>
      {pin.kind === 'error' ? <span className="ref-error" role="alert">{pin.message}</span> : null}
    </form>
  )
}

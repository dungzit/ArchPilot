import { Save, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { isApiError } from '../../api/client'
import { listDesigns, type DesignSummary } from '../../api/designs'
import { deleteSizingRun, listSizingRuns, saveSizingRun } from '../../api/sizingRuns'
import type { SizingRun } from '../../contracts/pilot'
import { formatDisplay } from '../../domain/rules/format'
import { isSilentUnit } from '../../domain/rules/units'
import { copy, type TextFn } from '../../ui/copy'

/**
 * Save the current evaluation (optionally against a design, with a component
 * label) and list saved runs, so the HLD export (WP-C) can cite them.
 * Every API failure is shown inline; the run itself never depends on the API.
 */

type Loadable<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T }

const errorText = (error: unknown) => (isApiError(error) ? error.detail : String(error))

function formatDate(iso: string | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

export function SavedRuns({ text, run }: { text: TextFn; language: 'vi' | 'en'; run: SizingRun | null }) {
  const [designs, setDesigns] = useState<Loadable<DesignSummary[]>>({ status: 'loading' })
  const [designId, setDesignId] = useState('')
  const [label, setLabel] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null)
  const [runs, setRuns] = useState<Loadable<SizingRun[]>>({ status: 'loading' })
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    listDesigns({ limit: 100, signal: controller.signal })
      .then((result) => setDesigns({ status: 'ready', data: result.items }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setDesigns({ status: 'error', message: errorText(error) })
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setRuns({ status: 'loading' })
    listSizingRuns(designId || null, controller.signal)
      .then((result) => setRuns({ status: 'ready', data: result.items }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setRuns({ status: 'error', message: errorText(error) })
      })
    return () => controller.abort()
  }, [designId, reload])

  const save = useCallback(async () => {
    if (!run) return
    setSaving(true)
    setNotice(null)
    try {
      await saveSizingRun({ ...run, designId: designId || null, componentLabel: label.trim() || null })
      setNotice({ kind: 'ok', message: text(copy('Đã lưu kết quả.', 'Result saved.')) })
      setReload((value) => value + 1)
    } catch (error) {
      setNotice({ kind: 'error', message: `${text(copy('Không lưu được:', 'Could not save:'))} ${errorText(error)}` })
    } finally {
      setSaving(false)
    }
  }, [run, designId, label, text])

  const remove = useCallback(async (id: string) => {
    setNotice(null)
    try {
      await deleteSizingRun(id)
      setReload((value) => value + 1)
    } catch (error) {
      setNotice({ kind: 'error', message: `${text(copy('Không xoá được:', 'Could not delete:'))} ${errorText(error)}` })
    }
  }, [text])

  const designName = (id: string | null | undefined) => (designs.status === 'ready' ? designs.data.find((design) => design.id === id)?.name : undefined) ?? id ?? ''

  return (
    <section className="panel rules-section" aria-labelledby="rules-save-heading" data-section="save">
      <h2 className="calc-heading" id="rules-save-heading">{text(copy('Lưu kết quả', 'Save the result'))}</h2>
      <div className="rules-save-row">
        <div className="calc-field">
          <label htmlFor="rules-design">{text(copy('Gắn với thiết kế', 'Attach to design'))}</label>
          <select id="rules-design" value={designId} onChange={(event) => setDesignId(event.target.value)}>
            <option value="">{text(copy('(không gắn thiết kế)', '(no design)'))}</option>
            {designs.status === 'ready' && designs.data.map((design) => <option key={design.id} value={design.id}>{design.name}</option>)}
          </select>
          {designs.status === 'error' && <span className="calc-help">{text(copy('Không tải được danh sách thiết kế:', 'Could not load designs:'))} {designs.message}</span>}
        </div>
        <div className="calc-field">
          <label htmlFor="rules-label">{text(copy('Nhãn thành phần', 'Component label'))}</label>
          <input id="rules-label" maxLength={200} value={label} placeholder={text(copy('VD: Kafka cluster (Prod)', 'e.g. Kafka cluster (Prod)'))} onChange={(event) => setLabel(event.target.value)} />
        </div>
        <button type="button" className="primary-button" disabled={!run || saving} onClick={save} data-action="save-run">
          <Save size={14} aria-hidden="true" /> {text(copy('Lưu kết quả', 'Save result'))}
        </button>
      </div>
      {notice && <p className={`rules-notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.message}</p>}

      <h3 className="rules-subheading">{designId ? text(copy('Kết quả đã lưu của thiết kế này', 'Saved results for this design')) : text(copy('Kết quả đã lưu của tôi', 'My saved results'))}</h3>
      {runs.status === 'loading' && <p className="calc-help" role="status">{text(copy('Đang tải…', 'Loading…'))}</p>}
      {runs.status === 'error' && <p className="rules-notice error" role="alert">{text(copy('Không tải được kết quả đã lưu:', 'Could not load saved results:'))} {runs.message}</p>}
      {runs.status === 'ready' && runs.data.length === 0 && <p className="calc-help">{text(copy('Chưa có kết quả nào.', 'Nothing saved yet.'))}</p>}
      {runs.status === 'ready' && runs.data.length > 0 && (
        <table className="designs-table rules-runs">
          <thead>
            <tr>
              <th scope="col">{text(copy('Thời điểm', 'When'))}</th>
              <th scope="col">{text(copy('Model', 'Model'))}</th>
              <th scope="col">{text(copy('Nhãn / thiết kế', 'Label / design'))}</th>
              <th scope="col">{text(copy('Kết quả chính', 'Primary result'))}</th>
              <th scope="col"><span className="dw-sr-only">{text(copy('Thao tác', 'Actions'))}</span></th>
            </tr>
          </thead>
          <tbody>
            {runs.data.map((saved) => {
              const primary = saved.outputs[0]
              return (
                <tr key={saved.id} data-run={saved.id}>
                  <td>{formatDate(saved.createdAt)}</td>
                  <td>{saved.modelName} <small className="calc-unit">{saved.rulePackId} v{saved.rulePackVersion}</small></td>
                  <td>{saved.componentLabel ?? '—'}{saved.designId ? <small className="calc-unit"> · {designName(saved.designId)}</small> : null}</td>
                  <td>{primary ? `${primary.label ?? primary.name}: ${formatDisplay(primary.value)}${isSilentUnit(primary.unit) ? '' : ` ${primary.unit}`}` : '—'}{saved.binding ? <small className="calc-unit"> ({saved.binding})</small> : null}</td>
                  <td>
                    {saved.id && (
                      <button type="button" className="text-button" onClick={() => remove(saved.id as string)} aria-label={text(copy('Xoá kết quả', 'Delete result'))}>
                        <Trash2 size={13} aria-hidden="true" /> {text(copy('Xoá', 'Delete'))}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}

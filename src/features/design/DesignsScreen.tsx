/**
 * `/designs` (task 2.1; REQ-DES-001, design-v2 4.2.1 and 4.2.13): the
 * caller's designs from `/api/designs`, newest first, and the New design
 * dialog. Blank is live; Template and Guided are shown with the phase that
 * builds them (templates = phase 5, guided wizard = phase W), not hidden.
 *
 * DesignsRoute picks this screen or the workspace from the route params.
 */
import { useEffect, useId, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { FilePlus2, FolderOpen, LayoutTemplate, WandSparkles } from 'lucide-react'
import { isApiError } from '../../api/client'
import { createDesign, listDesigns, type DesignSummary } from '../../api/designs'
import type { User } from '../../api/auth'
import { copy, type TextFn } from '../../ui/copy'
import { PageHeader } from '../../ui/PageHeader'
import { blankDesign, DESIGN_NAME_MAX } from './model/document'
import { Modal } from './dialogs'
import { DesignWorkspace } from './DesignWorkspace'

export function DesignsRoute({ text, language, user }: { text: TextFn; language: 'vi' | 'en'; user: User }) {
  const { designId } = useParams()
  if (designId) return <DesignWorkspace key={designId} designId={designId} text={text} language={language} user={user} />
  return <DesignsScreen text={text} />
}

type ListState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: DesignSummary[]; total: number }

function formatDate(iso: string): string {
  // Fixed, locale-independent form (YYYY-MM-DD HH:MM UTC) so tests and users see the same text.
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

export function DesignsScreen({ text }: { text: TextFn }) {
  const [list, setList] = useState<ListState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setList({ status: 'loading' })
    listDesigns({ signal: controller.signal })
      .then((result) => setList({ status: 'ready', items: result.items, total: result.total }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setList({ status: 'error', message: isApiError(error) ? error.detail : String(error) })
      })
    return () => controller.abort()
  }, [attempt])

  return (
    <div className="page-content designs-screen" data-studio="designs">
      <PageHeader
        eyebrow="DESIGNS"
        title={text(copy('Thiết kế', 'Designs'))}
        description={text(copy('Thiết kế logic, trung lập với nhà cung cấp. Chọn đích triển khai sau.', 'Logical, provider-neutral designs. Choose where they run later.'))}
        text={text}
        action={<button type="button" className="primary-button" onClick={() => setCreating(true)}><FilePlus2 size={15} aria-hidden="true" />{text(copy('Thiết kế mới', 'New design'))}</button>}
      />
      <section className="panel designs-list" aria-label={text(copy('Thiết kế của tôi', 'My designs'))}>
        {list.status === 'loading' && <p role="status">{text(copy('Đang tải…', 'Loading…'))}</p>}
        {list.status === 'error' && (
          <div role="alert">
            <p>{text(copy('Không tải được danh sách thiết kế.', 'The design list could not be loaded.'))} {list.message}</p>
            <button type="button" className="secondary-button" onClick={() => setAttempt(attempt + 1)}>{text(copy('Thử lại', 'Retry'))}</button>
          </div>
        )}
        {list.status === 'ready' && list.items.length === 0 && (
          <div className="dw-empty">
            <strong>{text(copy('Chưa có thiết kế nào', 'No designs yet'))}</strong>
            <p>{text(copy('Tạo một thiết kế trống để bắt đầu.', 'Create a blank design to start.'))}</p>
            <button type="button" className="primary-button" onClick={() => setCreating(true)}>{text(copy('Thiết kế mới', 'New design'))}</button>
          </div>
        )}
        {list.status === 'ready' && list.items.length > 0 && (
          <table className="designs-table">
            <caption className="dw-sr-only">{text(copy(`${list.total} thiết kế`, `${list.total} design${list.total === 1 ? '' : 's'}`))}</caption>
            <thead>
              <tr>
                <th scope="col">{text(copy('Tên', 'Name'))}</th>
                <th scope="col">{text(copy('Bản', 'Revision'))}</th>
                <th scope="col">{text(copy('Cập nhật', 'Updated'))}</th>
                <th scope="col"><span className="dw-sr-only">{text(copy('Thao tác', 'Actions'))}</span></th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((item) => (
                <tr key={item.id}>
                  <th scope="row"><Link to={`/designs/${encodeURIComponent(item.id)}`}>{item.name}</Link></th>
                  <td>{item.revision}</td>
                  <td>{formatDate(item.updatedAt)}</td>
                  <td>
                    <Link className="secondary-button" to={`/designs/${encodeURIComponent(item.id)}`} aria-label={text(copy(`Mở ${item.name}`, `Open ${item.name}`))}>
                      <FolderOpen size={14} aria-hidden="true" />{text(copy('Mở', 'Open'))}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {creating && <NewDesignDialog text={text} onClose={() => setCreating(false)} />}
    </div>
  )
}

function NewDesignDialog({ text, onClose }: { text: TextFn; onClose: () => void }) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameId = useId()
  const trimmed = name.trim()
  const invalid = trimmed.length === 0 || trimmed.length > DESIGN_NAME_MAX

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (invalid) {
      setError(text(copy(`Tên cần 1 đến ${DESIGN_NAME_MAX} ký tự.`, `A name needs 1 to ${DESIGN_NAME_MAX} characters.`)))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const created = await createDesign({ name: trimmed, graph: blankDesign(trimmed) })
      navigate(`/designs/${encodeURIComponent(created.id)}`)
    } catch (caught) {
      setError(isApiError(caught) ? caught.detail : String(caught))
      setBusy(false)
    }
  }

  return (
    <Modal title={text(copy('Thiết kế mới', 'New design'))} onClose={onClose} className="dw-new-design">
      <form onSubmit={submit}>
        <fieldset className="dw-fieldset">
          <legend className="dw-field-label">{text(copy('Bắt đầu từ', 'Start from'))}</legend>
          <div className="dw-start-options">
            <div className="dw-start-option selected">
              <FilePlus2 size={18} aria-hidden="true" />
              <strong>{text(copy('Trống', 'Blank'))}</strong>
              <small>{text(copy('Canvas trống, bạn tự thêm thành phần.', 'An empty canvas; you add the components.'))}</small>
            </div>
            <div className="dw-start-option disabled" aria-disabled="true">
              <LayoutTemplate size={18} aria-hidden="true" />
              <strong>{text(copy('Từ mẫu', 'From a template'))}</strong>
              <small>{text(copy('Thư viện mẫu sắp có (giai đoạn 5).', 'Template gallery coming in phase 5.'))}</small>
            </div>
            <div className="dw-start-option disabled" aria-disabled="true">
              <WandSparkles size={18} aria-hidden="true" />
              <strong>{text(copy('Có hướng dẫn', 'Guided'))}</strong>
              <small>{text(copy('Bảng câu hỏi dựa trên quy tắc, sắp có (giai đoạn W).', 'Rule-based questionnaire, coming in phase W.'))}</small>
            </div>
          </div>
        </fieldset>
        <div className={`dw-field${error ? ' invalid' : ''}`}>
          <label className="dw-field-label" htmlFor={nameId}>{text(copy('Tên thiết kế', 'Design name'))}</label>
          <input id={nameId} className="dw-input" value={name} maxLength={DESIGN_NAME_MAX} onChange={(event) => setName(event.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? `${nameId}-error` : undefined} data-autofocus />
          {error && <p className="dw-field-error" id={`${nameId}-error`} role="alert"><span aria-hidden="true">⚠ </span>{error}</p>}
        </div>
        <div className="dw-modal-actions">
          <button type="button" className="dw-button" onClick={onClose}>{text(copy('Hủy', 'Cancel'))}</button>
          <button type="submit" className="dw-button primary" disabled={busy}>{busy ? text(copy('Đang tạo…', 'Creating…')) : text(copy('Tạo thiết kế trống', 'Create blank design'))}</button>
        </div>
      </form>
    </Modal>
  )
}

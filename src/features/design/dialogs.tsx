/**
 * Workspace dialogs: the container delete choice (REQ-DES-006) and the code
 * name change with its warning (REQ-DES-008). A small accessible modal: the
 * first control takes focus, Tab stays inside, Escape cancels, and focus
 * returns to where it was.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { isValidCodeName, type ArchGraphV2 } from '../../domain/graph'
import { copy, type TextFn } from '../../ui/copy'

export function Modal({ title, onClose, children, className = '' }: { title: string; onClose: () => void; children: ReactNode; className?: string }) {
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const first = ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current?.querySelector<HTMLElement>('input, select, textarea, button')
    first?.focus()
    return () => { previous?.focus?.() }
  }, [])
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab' || !ref.current) return
    const focusable = Array.from(ref.current.querySelectorAll<HTMLElement>('input, select, textarea, button:not([disabled]), [href], [tabindex="0"]'))
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }
  return (
    <div className="dw-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={ref} className={`dw-modal ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
        <h2 id={titleId} className="dw-modal-title">{title}</h2>
        {children}
      </div>
    </div>
  )
}

/** "Delete app_a and its 3 children" / "Move 3 children out" / Cancel. Either choice is one undo step. */
export function DeleteContainerDialog({
  label, codeName, childCount, canLift, liftReason, text, onDelete, onLift, onCancel,
}: {
  label: string
  codeName: string
  childCount: number
  canLift: boolean
  liftReason?: string
  text: TextFn
  onDelete: () => void
  onLift: () => void
  onCancel: () => void
}) {
  return (
    <Modal title={text(copy(`Xóa ${label}?`, `Delete ${label}?`))} onClose={onCancel}>
      <p>
        {text(copy(
          `${codeName} là vùng chứa có ${childCount} thành phần con. Chọn cách xử lý các thành phần con.`,
          `${codeName} is a container with ${childCount} child${childCount === 1 ? '' : 'ren'}. Choose what happens to them.`,
        ))}
      </p>
      {!canLift && liftReason && <p className="dw-field-error" role="note"><span aria-hidden="true">⚠ </span>{liftReason}</p>}
      <div className="dw-modal-actions">
        <button type="button" className="dw-button danger" onClick={onDelete}>
          {text(copy(`Xóa ${codeName} và ${childCount} thành phần con`, `Delete ${codeName} and its ${childCount} child${childCount === 1 ? '' : 'ren'}`))}
        </button>
        <button type="button" className="dw-button" onClick={onLift} disabled={!canLift}>
          {text(copy(`Đưa ${childCount} thành phần con ra ngoài`, `Move ${childCount} child${childCount === 1 ? '' : 'ren'} out`))}
        </button>
        <button type="button" className="dw-button" onClick={onCancel} data-autofocus>{text(copy('Hủy', 'Cancel'))}</button>
      </div>
    </Modal>
  )
}

/**
 * REQ-DES-008: the code name becomes resource addresses in generated code,
 * so changing it is an explicit action with a warning.
 */
export function CodeNameDialog({
  document, nodeId, text, onRename, onCancel,
}: {
  document: ArchGraphV2
  nodeId: string
  text: TextFn
  onRename: (codeName: string) => void
  onCancel: () => void
}) {
  const node = document.nodes.find((candidate) => candidate.id === nodeId)
  const [draft, setDraft] = useState(node?.codeName ?? '')
  const inputId = useId()
  if (!node) return null
  const edges = document.edges.filter((edge) => edge.source === nodeId || edge.target === nodeId).length
  const taken = document.nodes.some((other) => other.id !== nodeId && other.codeName === draft)
  const error = !isValidCodeName(draft)
    ? text(copy('Tên mã gồm chữ thường, chữ số và _, bắt đầu bằng chữ cái, tối đa 40 ký tự.', 'Lower-case letters, digits and _, starting with a letter, at most 40 characters.'))
    : taken ? text(copy(`${draft} đã được nút khác dùng.`, `${draft} is used by another node.`)) : null
  const unchanged = draft === node.codeName
  return (
    <Modal title={text(copy('Đổi tên mã', 'Change code name'))} onClose={onCancel}>
      <p className="dw-warning" role="note">
        <span aria-hidden="true">⚠ </span>
        {text(copy(
          `Đổi ${node.codeName} sẽ đổi tên các địa chỉ tài nguyên được sinh ra (và các tham chiếu từ ${edges} kết nối). Các bản triển khai hiện có sẽ lên kế hoạch xóa rồi tạo lại, trừ khi bạn thêm khối moved.`,
          `Changing ${node.codeName} renames the generated resource addresses (and references from ${edges} connection${edges === 1 ? '' : 's'}). Existing deployments will plan destroy-and-create unless you add moved blocks.`,
        ))}
      </p>
      <div className={`dw-field${error ? ' invalid' : ''}`}>
        <label className="dw-field-label" htmlFor={inputId}>{text(copy('Tên mã mới', 'New code name'))}</label>
        <input id={inputId} className="dw-input mono" value={draft} maxLength={40} onChange={(event) => setDraft(event.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? `${inputId}-error` : undefined} />
        {error && <p className="dw-field-error" id={`${inputId}-error`} role="alert"><span aria-hidden="true">⚠ </span>{error}</p>}
      </div>
      <div className="dw-modal-actions">
        <button type="button" className="dw-button" onClick={onCancel}>{text(copy('Hủy', 'Cancel'))}</button>
        <button type="button" className="dw-button primary" disabled={Boolean(error) || unchanged} onClick={() => onRename(draft)}>{text(copy('Đổi tên', 'Rename'))}</button>
      </div>
    </Modal>
  )
}

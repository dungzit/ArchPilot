/**
 * Design workspace at `/designs/:designId` (task 2.1 shell, 2.6 save; design-v2
 * 4.2.2, layout from docs/prototype/systemsarchitect-demo.html).
 *
 *  top bar     back, name, save state + revision, Undo/Redo, Validate badge, Export
 *  left        Components (palette) / Layers (tree = screen-reader list view)
 *  centre      Diagram / Code / Issues dock tabs (Ctrl+J moves Code and Issues
 *              into the right panel, REQ-DES-017)
 *  right       Inspector / (Issues / Code) / Sizing / Target / Decisions / Assistant
 *  status bar  counts, problem totals, save state
 *
 * All edits go through the graph command layer (useDesignEditor), autosave is
 * DesignAutosaver, and every canvas action has a keyboard path.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ArrowLeft, Download, PanelLeft, PanelBottom, Redo2, ShieldCheck, Undo2 } from 'lucide-react'
import { isApiError } from '../../api/client'
import { createDesign, getDesign, putDesign, type DesignRecord } from '../../api/designs'
import type { User } from '../../api/auth'
import { canNest, canonicalJson, getRole, type ArchGraphV2, type CommandError } from '../../domain/graph'
import { copy, type Copy, type TextFn } from '../../ui/copy'
import { DesignAutosaver, pendingStorageKey, readPending, type AutosaveStatus, type PendingRecord } from './model/autosave'
import { DESIGN_NAME_MAX, openGraph, sortedIssues, issueCounts } from './model/document'
import { directChildren, planAddNode, planNudge } from './model/operations'
import { useDesignEditor } from './useDesignEditor'
import { Palette } from './Palette'
import { LayersTree } from './LayersTree'
import { Inspector } from './Inspector'
import { IssuesPanel } from './IssuesPanel'
import { CodePanel } from './CodePanel'
import { CommandMenu, type MenuAction } from './CommandMenu'
import { DeleteContainerDialog } from './dialogs'
import { DesignCanvas } from './DesignCanvas'

type Language = 'vi' | 'en'

type Load =
  | { status: 'loading' }
  | { status: 'error'; notFound: boolean; message: string }
  | { status: 'ready'; record: DesignRecord; document: ArchGraphV2 }

export function DesignWorkspace({ designId, text, language, user }: { designId: string; text: TextFn; language: Language; user: User }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoad({ status: 'loading' })
    getDesign(designId, controller.signal)
      .then((record) => setLoad({ status: 'ready', record, document: openGraph(record.graph, record.name) }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const notFound = isApiError(error) && error.status === 404
        const message = isApiError(error) ? error.detail : error instanceof Error ? error.message : String(error)
        setLoad({ status: 'error', notFound, message })
      })
    return () => controller.abort()
  }, [designId, attempt])

  if (load.status === 'loading') {
    return <div className="dw-state" role="status">{text(copy('Đang mở thiết kế…', 'Opening the design…'))}</div>
  }
  if (load.status === 'error') {
    return (
      <div className="dw-state" role="alert">
        <strong>{load.notFound ? text(copy('Không tìm thấy thiết kế này.', 'This design was not found.')) : text(copy('Không mở được thiết kế.', 'The design could not be opened.'))}</strong>
        {!load.notFound && <p>{load.message}</p>}
        <div className="dw-row">
          <Link className="dw-button" to="/designs">{text(copy('Về danh sách thiết kế', 'Back to designs'))}</Link>
          {!load.notFound && <button type="button" className="dw-button" onClick={() => setAttempt(attempt + 1)}>{text(copy('Thử lại', 'Retry'))}</button>}
        </div>
      </div>
    )
  }
  return <WorkspaceEditor key={`${load.record.id}:${load.record.revision}:${attempt}`} record={load.record} initial={load.document} text={text} language={language} user={user} />
}

type CentreTab = 'diagram' | 'code' | 'issues'
type RightTab = 'inspector' | 'issues' | 'code' | 'sizing' | 'target' | 'decisions' | 'assistant'

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element || !element.tagName) return false
  return element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT' || element.isContentEditable
}

function saveLabel(status: AutosaveStatus, text: TextFn): string {
  switch (status.state) {
    case 'saved': return text(copy(`Đã lưu · bản ${status.revision}`, `Saved · rev ${status.revision}`))
    case 'dirty': return text(copy('Có thay đổi chưa lưu', 'Unsaved changes'))
    case 'saving': return text(copy('Đang lưu…', 'Saving…'))
    case 'offline': return text(copy('Chưa lưu · mất kết nối', 'Not saved · offline'))
    case 'conflict': return text(copy('Xung đột phiên bản', 'Version conflict'))
    case 'error': return text(copy('Chưa lưu · lỗi', 'Not saved · error'))
  }
}

function WorkspaceEditor({ record, initial, text, language, user }: { record: DesignRecord; initial: ArchGraphV2; text: TextFn; language: Language; user: User }) {
  const navigate = useNavigate()
  const [toast, setToast] = useState<{ message: string; id: number } | null>(null)
  const showToast = useCallback((message: string) => setToast({ message, id: Date.now() }), [])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(timer)
  }, [toast])

  const onCommandError = useCallback((error: CommandError) => showToast(`${error.code}: ${text(error.message)}`), [showToast, text])
  const editor = useDesignEditor(initial, onCommandError)
  const { document, selection } = editor
  const [name, setName] = useState(record.name)
  const [nameDraft, setNameDraft] = useState(record.name)
  const [status, setStatus] = useState<AutosaveStatus>({ state: 'saved', revision: record.revision })
  const [stalePending, setStalePending] = useState<PendingRecord | null>(null)
  const [leftTab, setLeftTab] = useState<'components' | 'layers'>('components')
  const [leftOpen, setLeftOpen] = useState(true)
  const [centreTab, setCentreTab] = useState<CentreTab>('diagram')
  const [dock, setDock] = useState<'bottom' | 'right'>('bottom')
  const [rightTab, setRightTab] = useState<RightTab>('inspector')
  const [menuOpen, setMenuOpen] = useState(false)
  const [deleteRequest, setDeleteRequest] = useState<string | null>(null)
  const labelInput = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const inspectorRef = useRef<HTMLDivElement>(null)
  const autosaver = useRef<DesignAutosaver | null>(null)
  const storageKey = pendingStorageKey(user.id, record.id)
  const issues = useMemo(() => sortedIssues(document), [document])
  const counts = issueCounts(issues)

  // ------------------------------------------------------------ autosave
  useEffect(() => {
    const storage = typeof window !== 'undefined' ? window.localStorage : null
    const saver = new DesignAutosaver({
      designId: record.id,
      revision: record.revision,
      initial: { name: record.name, graph: initial },
      put: putDesign,
      onChange: setStatus,
      storage,
      storageKey,
    })
    autosaver.current = saver
    const pending = readPending(storage, storageKey)
    if (pending && pending.designId === record.id) {
      let differs = true
      try { differs = canonicalJson({ name: pending.name, graph: pending.graph }) !== canonicalJson({ name: record.name, graph: initial }) } catch { /* keep true */ }
      if (differs && pending.baseRevision === record.revision) {
        editor.adopt(openGraph(pending.graph, pending.name))
        setName(pending.name)
        setNameDraft(pending.name)
        showToast(text(copy('Đã khôi phục thay đổi chưa lưu từ trình duyệt này.', 'Restored unsaved changes from this browser.')))
      } else if (differs) {
        setStalePending(pending)
      }
    }
    return () => saver.dispose()
    // Runs once per loaded record (the component is keyed by id + revision).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { autosaver.current?.update({ name, graph: document }) }, [name, document])

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!autosaver.current?.hasUnsavedChanges) return
      event.preventDefault()
      event.returnValue = ''
    }
    const online = () => { void autosaver.current?.flush() }
    window.addEventListener('beforeunload', beforeUnload)
    window.addEventListener('online', online)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      window.removeEventListener('online', online)
    }
  }, [])

  const loadTheirs = async () => {
    try {
      const fresh = await getDesign(record.id)
      const theirs = openGraph(fresh.graph, fresh.name)
      editor.replace(theirs)
      setName(fresh.name)
      setNameDraft(fresh.name)
      autosaver.current?.rebase(fresh.revision, { name: fresh.name, graph: theirs })
      showToast(text(copy(`Đã tải bản ${fresh.revision} từ máy chủ. Lịch sử hoàn tác đã được đặt lại.`, `Loaded revision ${fresh.revision} from the server. Undo history was reset.`)))
    } catch (error) {
      showToast(isApiError(error) ? error.detail : String(error))
    }
  }

  const saveAsCopy = async (graph: ArchGraphV2, baseName: string) => {
    try {
      const created = await createDesign({ name: `${baseName} (${text(copy('bản sao', 'copy'))})`.slice(0, DESIGN_NAME_MAX), graph })
      try { window.localStorage.removeItem(storageKey) } catch { /* ignore */ }
      navigate(`/designs/${encodeURIComponent(created.id)}`)
    } catch (error) {
      showToast(isApiError(error) ? error.detail : String(error))
    }
  }

  // ------------------------------------------------------------ actions
  const selectedNode = selection?.kind === 'node' ? document.nodes.find((node) => node.id === selection.id) : undefined

  const showIssues = () => {
    if (dock === 'bottom') setCentreTab('issues')
    else setRightTab('issues')
  }

  const addRole = (roleId: string) => {
    // Into the selected container when the nesting rules allow it, else onto the canvas.
    const parentId = selectedNode && getRole(selectedNode.type)?.container && canNest(roleId, selectedNode.type).ok ? selectedNode.id : null
    const plan = planAddNode(document, roleId, language, { parentId })
    if (!plan.ok) {
      onCommandError(plan.error)
      return
    }
    if (editor.run(plan.commands, { select: { kind: 'node', id: plan.createdId! } })) {
      setCentreTab('diagram')
      setRightTab('inspector')
    }
  }

  const deleteNode = (nodeId: string) => {
    const children = directChildren(document, nodeId)
    if (children.length > 0) {
      setDeleteRequest(nodeId)
      return
    }
    editor.run([{ type: 'removeNode', id: nodeId, children: 'delete' }], { select: null })
  }

  const deleteSelection = () => {
    if (!selection) return
    if (selection.kind === 'node') deleteNode(selection.id)
    else editor.run([{ type: 'removeEdge', id: selection.id }], { select: null })
  }

  const focusInspector = (field: 'first' | 'label') => {
    setRightTab('inspector')
    requestAnimationFrame(() => {
      if (field === 'label' && labelInput.current) labelInput.current.focus()
      else inspectorRef.current?.querySelector<HTMLElement>('[data-inspector-first]')?.focus()
    })
  }

  const stepIssue = (delta: 1 | -1) => {
    const targets = issues.filter((issue) => issue.nodeId || issue.edgeId)
    if (targets.length === 0) return
    // Several issues can point at the selected node: step past all of them.
    const matches = targets.map((issue, index) => ((selection?.kind === 'node' && issue.nodeId === selection.id) || (selection?.kind === 'edge' && issue.edgeId === selection.id) ? index : -1)).filter((index) => index >= 0)
    const from = matches.length === 0 ? (delta === 1 ? -1 : 0) : delta === 1 ? matches[matches.length - 1] : matches[0]
    const next = targets[(from + delta + targets.length) % targets.length]
    editor.select(next.nodeId ? { kind: 'node', id: next.nodeId } : { kind: 'edge', id: next.edgeId! })
    showIssues()
  }

  const runMenu = (action: MenuAction) => {
    setMenuOpen(false)
    if (action.kind === 'add') addRole(action.roleId)
    else {
      editor.select({ kind: 'node', id: action.nodeId })
      setCentreTab('diagram')
      setRightTab('inspector')
    }
  }

  const exportJson = () => {
    const blob = new Blob([`${JSON.stringify(document, null, 2)}\n`], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = window.document.createElement('a')
    anchor.href = url
    anchor.download = `${document.settings.codeName}.archgraph.json`
    window.document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  // ------------------------------------------------------------ keyboard map (design-v2 4.2.19)
  const keyState = useRef({ editor, selection, selectedNode, menuOpen, deleteRequest })
  keyState.current = { editor, selection, selectedNode, menuOpen, deleteRequest }
  const handlers = useRef({ deleteSelection, stepIssue, focusInspector })
  handlers.current = { deleteSelection, stepIssue, focusInspector }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const state = keyState.current
      const ctrl = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      const typing = isTypingTarget(event.target)
      if (ctrl && key === 's') {
        event.preventDefault()
        void autosaver.current?.flush()
        return
      }
      if (state.menuOpen || state.deleteRequest) return
      if (ctrl && key === 'k') {
        event.preventDefault()
        setMenuOpen(true)
        return
      }
      if (ctrl && key === 'b') { event.preventDefault(); setLeftOpen((open) => !open); return }
      if (ctrl && key === 'j') { event.preventDefault(); setDock((current) => (current === 'bottom' ? 'right' : 'bottom')); return }
      if (event.key === 'F8') { event.preventDefault(); handlers.current.stepIssue(event.shiftKey ? -1 : 1); return }
      if (typing) return
      if (ctrl && key === 'z' && !event.shiftKey) { event.preventDefault(); state.editor.undo(); return }
      if (ctrl && (key === 'y' || (key === 'z' && event.shiftKey))) { event.preventDefault(); state.editor.redo(); return }
      if (ctrl || event.altKey) return
      const target = event.target as HTMLElement | null
      const onCanvas = target === window.document.body || Boolean(target?.closest?.('.dw-canvas'))
      if (event.key === '/') { event.preventDefault(); setMenuOpen(true); return }
      if ((event.key === 'Delete' || event.key === 'Backspace') && onCanvas) { event.preventDefault(); handlers.current.deleteSelection(); return }
      if (event.key === 'Escape') { state.editor.select(null); return }
      if (event.key === 'F2' && state.selection) { event.preventDefault(); handlers.current.focusInspector('label'); return }
      if (event.key === 'Enter' && state.selection && (event.target as HTMLElement | null)?.closest?.('.react-flow__node, .react-flow__edge')) {
        event.preventDefault()
        handlers.current.focusInspector('first')
        return
      }
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
      const arrow = arrows[event.key]
      if (arrow && state.selectedNode && onCanvas) {
        event.preventDefault()
        const step = event.shiftKey ? 40 : 8
        const plan = planNudge(state.editor.document, state.selectedNode.id, arrow[0] * step, arrow[1] * step)
        if (plan.ok) state.editor.run(plan.commands, { coalesceKey: `nudge:${state.selectedNode.id}` })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // ------------------------------------------------------------ render
  const commitName = () => {
    const trimmed = nameDraft.trim()
    if (trimmed.length === 0 || trimmed.length > DESIGN_NAME_MAX) {
      setNameDraft(name)
      showToast(text(copy(`Tên thiết kế cần 1 đến ${DESIGN_NAME_MAX} ký tự.`, `A design name needs 1 to ${DESIGN_NAME_MAX} characters.`)))
      return
    }
    if (trimmed !== name) setName(trimmed)
  }

  const inspector = (
    <Inspector
      document={document}
      selection={selection}
      language={language}
      text={text}
      run={editor.run}
      onSelect={editor.select}
      onDeleteNode={deleteNode}
      onDeleteEdge={(edgeId) => editor.run([{ type: 'removeEdge', id: edgeId }], { select: null })}
      onRegisterLabelInput={(element) => { labelInput.current = element }}
    />
  )
  const issuesPanel = <IssuesPanel issues={issues} selection={selection} text={text} onGoTo={(target) => { editor.select(target); if (dock === 'bottom') setCentreTab('diagram') }} />
  const issueBadge = counts.error + counts.warning
  const planned = (phase: string, what: Copy) => (
    <div className="dw-empty" role="note">
      <strong>{text(copy(`Sắp có (giai đoạn ${phase})`, `Coming in phase ${phase}`))}</strong>
      <p>{text(what)}</p>
    </div>
  )
  const rightTabs: { id: RightTab; label: Copy }[] = [
    { id: 'inspector', label: copy('Thuộc tính', 'Inspector') },
    ...(dock === 'right' ? [{ id: 'issues' as const, label: copy('Vấn đề', 'Issues') }, { id: 'code' as const, label: copy('Mã', 'Code') }] : []),
    { id: 'sizing', label: copy('Sizing', 'Sizing') },
    { id: 'target', label: copy('Đích', 'Target') },
    { id: 'decisions', label: copy('Quyết định', 'Decisions') },
    { id: 'assistant', label: copy('Trợ lý', 'Assistant') },
  ]
  const activeRight = rightTabs.some((tab) => tab.id === rightTab) ? rightTab : 'inspector'
  const centreTabs: { id: CentreTab; label: Copy }[] = [
    { id: 'diagram', label: copy('Sơ đồ', 'Diagram') },
    ...(dock === 'bottom' ? [{ id: 'code' as const, label: copy('Mã', 'Code') }, { id: 'issues' as const, label: copy('Vấn đề', 'Issues') }] : []),
  ]
  const activeCentre = centreTabs.some((tab) => tab.id === centreTab) ? centreTab : 'diagram'
  const deleteNodeTarget = deleteRequest ? document.nodes.find((node) => node.id === deleteRequest) : undefined
  const liftCheck = deleteNodeTarget ? (() => {
    const newParent = deleteNodeTarget.parentId ? document.nodes.find((node) => node.id === deleteNodeTarget.parentId) : undefined
    for (const child of document.nodes.filter((node) => node.parentId === deleteNodeTarget.id)) {
      const verdict = canNest(child.type, newParent ? newParent.type : null)
      if (!verdict.ok) return { ok: false, reason: `${verdict.ruleId}: ${text(verdict.message)}` }
    }
    return { ok: true, reason: undefined }
  })() : { ok: true, reason: undefined }

  return (
    <div className={`design-workspace${leftOpen ? '' : ' left-closed'}${dock === 'right' ? ' dock-right' : ''}`} data-design-id={record.id}>
      <header className="dw-topbar" aria-label={text(copy('Thanh công cụ thiết kế', 'Design toolbar'))}>
        <Link className="dw-icon-button" to="/designs" aria-label={text(copy('Về danh sách thiết kế', 'Back to designs'))}><ArrowLeft size={16} aria-hidden="true" /></Link>
        <input
          className="dw-name"
          value={nameDraft}
          maxLength={DESIGN_NAME_MAX}
          aria-label={text(copy('Tên thiết kế', 'Design name'))}
          onChange={(event) => setNameDraft(event.target.value)}
          onBlur={commitName}
          onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur() }}
        />
        <span className={`dw-save-state ${status.state}`} role="status" aria-live="polite">{saveLabel(status, text)}</span>
        <span className="dw-envchip" title={text(copy('Công cụ này chỉ vẽ thiết kế; không bao giờ triển khai.', 'This tool only edits a design; it never deploys anything.'))}>{text(copy('Logic · chưa chọn đích', 'Logical · no target'))}</span>
        <span className="dw-spacer" />
        <button type="button" className="dw-tool" onClick={editor.undo} disabled={!editor.canUndo} aria-keyshortcuts="Control+Z" title={text(copy('Hoàn tác (Ctrl+Z)', 'Undo (Ctrl+Z)'))}>
          <Undo2 size={15} aria-hidden="true" /><span className="dw-tool-label">{text(copy('Hoàn tác', 'Undo'))}</span>
        </button>
        <button type="button" className="dw-tool" onClick={editor.redo} disabled={!editor.canRedo} aria-keyshortcuts="Control+Y Control+Shift+Z" title={text(copy('Làm lại (Ctrl+Y)', 'Redo (Ctrl+Y)'))}>
          <Redo2 size={15} aria-hidden="true" /><span className="dw-tool-label">{text(copy('Làm lại', 'Redo'))}</span>
        </button>
        <button type="button" className="dw-tool validate" onClick={showIssues} title={text(copy('Mở danh sách vấn đề', 'Open the issues list'))}>
          <ShieldCheck size={15} aria-hidden="true" />
          <span className="dw-tool-label">{text(copy('Kiểm tra', 'Validate'))}</span>
          <span className={`dw-badge${counts.error > 0 ? ' error' : issueBadge > 0 ? ' warn' : ' ok'}`}>
            {text(copy(`${counts.error} lỗi, ${counts.warning} cảnh báo`, `${counts.error} E, ${counts.warning} W`))}
          </span>
        </button>
        <button type="button" className="dw-tool" onClick={exportJson} title={text(copy('Tải tài liệu thiết kế dạng JSON', 'Download the design document as JSON'))}>
          <Download size={15} aria-hidden="true" /><span className="dw-tool-label">{text(copy('Xuất JSON', 'Export JSON'))}</span>
        </button>
        <button type="button" className="dw-tool icon" onClick={() => setLeftOpen(!leftOpen)} aria-pressed={leftOpen} aria-keyshortcuts="Control+B" title={text(copy('Bật/tắt bảng trái (Ctrl+B)', 'Toggle left panel (Ctrl+B)'))} aria-label={text(copy('Bảng trái', 'Left panel'))}>
          <PanelLeft size={15} aria-hidden="true" />
        </button>
        <button type="button" className="dw-tool icon" onClick={() => setDock(dock === 'bottom' ? 'right' : 'bottom')} aria-pressed={dock === 'right'} aria-keyshortcuts="Control+J" title={text(copy('Chuyển Mã và Vấn đề giữa khung dưới và bảng phải (Ctrl+J)', 'Move Code and Issues between the bottom dock and the right panel (Ctrl+J)'))} aria-label={text(copy('Mã và Vấn đề ở bảng phải', 'Code and Issues in the right panel'))}>
          <PanelBottom size={15} aria-hidden="true" />
        </button>
      </header>

      {status.state === 'conflict' && (
        <div className="dw-banner warn" role="alert">
          <span>{text(copy('Thiết kế đã bị thay đổi ở nơi khác. Tự động lưu đã dừng; không có gì bị ghi đè.', 'This design was changed elsewhere. Autosave stopped; nothing was overwritten.'))}</span>
          <button type="button" className="dw-button small" onClick={loadTheirs}>{text(copy('Tải bản của máy chủ', 'Load theirs'))}</button>
          <button type="button" className="dw-button small" onClick={() => saveAsCopy(document, name)}>{text(copy('Lưu bản của tôi thành bản sao', 'Save mine as a copy'))}</button>
        </div>
      )}
      {(status.state === 'offline' || status.state === 'error') && (
        <div className="dw-banner warn" role="alert">
          <span>{status.state === 'offline'
            ? text(copy('Chưa lưu: không kết nối được máy chủ. Thay đổi được giữ trong trình duyệt này.', 'Not saved: the server is unreachable. Changes are kept in this browser.'))
            : `${text(copy('Chưa lưu', 'Not saved'))}: ${status.detail ?? ''}`}</span>
          <button type="button" className="dw-button small" onClick={() => { void autosaver.current?.flush() }}>{text(copy('Thử lại', 'Retry'))}</button>
        </div>
      )}
      {stalePending && (
        <div className="dw-banner info" role="alert">
          <span>{text(copy(`Trình duyệt này còn thay đổi chưa lưu dựa trên bản ${stalePending.baseRevision} (máy chủ đang ở bản ${record.revision}).`, `This browser holds unsaved changes based on revision ${stalePending.baseRevision} (the server is at revision ${record.revision}).`))}</span>
          <button type="button" className="dw-button small" onClick={() => saveAsCopy(openGraph(stalePending.graph, stalePending.name), stalePending.name)}>{text(copy('Lưu thành bản sao', 'Save them as a copy'))}</button>
          <button type="button" className="dw-button small" onClick={() => { try { window.localStorage.removeItem(storageKey) } catch { /* ignore */ } setStalePending(null) }}>{text(copy('Bỏ qua', 'Discard'))}</button>
        </div>
      )}

      <div className="dw-body">
        {leftOpen && (
          <aside className="dw-panel dw-left" aria-label={text(copy('Bảng trái', 'Left panel'))}>
            <Tabs
              label={text(copy('Bảng trái', 'Left panel'))}
              idBase="dw-left"
              tabs={[{ id: 'components', label: text(copy('Thành phần', 'Components')) }, { id: 'layers', label: text(copy('Lớp', 'Layers')) }]}
              active={leftTab}
              onChange={(id) => setLeftTab(id as 'components' | 'layers')}
            />
            <div className="dw-panel-body" role="tabpanel" id={`dw-left-panel-${leftTab}`} aria-labelledby={`dw-left-tab-${leftTab}`}>
              {leftTab === 'components'
                ? <Palette text={text} onAdd={addRole} />
                : <LayersTree document={document} selection={selection} issues={issues} text={text} onSelect={editor.select}
                    onActivate={(id) => { editor.select({ kind: 'node', id }); focusInspector('first') }}
                    onRename={(id) => { editor.select({ kind: 'node', id }); focusInspector('label') }}
                    onDelete={deleteNode} />}
            </div>
          </aside>
        )}

        <section className="dw-panel dw-centre" aria-label={text(copy('Vùng làm việc', 'Work area'))}>
          <div className="dw-centre-body" role="tabpanel" id={`dw-centre-panel-${activeCentre}`} aria-labelledby={`dw-centre-tab-${activeCentre}`}>
            <div className="dw-canvas-host" hidden={activeCentre !== 'diagram'}>
              <DesignCanvas
                document={document}
                selection={selection}
                issues={issues}
                language={language}
                text={text}
                run={editor.run}
                onSelect={editor.select}
                onToast={showToast}
                onAddFirst={() => addRole('site')}
                onOpenMenu={() => setMenuOpen(true)}
              />
            </div>
            {activeCentre === 'code' && <CodePanel document={document} text={text} />}
            {activeCentre === 'issues' && issuesPanel}
          </div>
          <Tabs
            label={text(copy('Khung dưới', 'Canvas dock'))}
            idBase="dw-centre"
            className="bottom"
            tabs={centreTabs.map((tab) => ({ id: tab.id, label: text(tab.label), badge: tab.id === 'issues' ? issueBadge : undefined }))}
            active={activeCentre}
            onChange={(id) => setCentreTab(id as CentreTab)}
          />
        </section>

        <aside className="dw-panel dw-right" aria-label={text(copy('Bảng phải', 'Right panel'))}>
          <Tabs
            label={text(copy('Bảng phải', 'Right panel'))}
            idBase="dw-right"
            tabs={rightTabs.map((tab) => ({ id: tab.id, label: text(tab.label), badge: tab.id === 'issues' ? issueBadge : undefined }))}
            active={activeRight}
            onChange={(id) => setRightTab(id as RightTab)}
          />
          <div ref={inspectorRef} className="dw-panel-body" role="tabpanel" id={`dw-right-panel-${activeRight}`} aria-labelledby={`dw-right-tab-${activeRight}`}>
            {activeRight === 'inspector' && inspector}
            {activeRight === 'issues' && issuesPanel}
            {activeRight === 'code' && <CodePanel document={document} text={text} />}
            {activeRight === 'sizing' && planned('4', copy('Gắn kết quả sizing vào một thành phần và theo dõi khi nó lỗi thời.', 'Attach a sizing result to a component and see when it goes stale.'))}
            {activeRight === 'target' && planned('T', copy('Chọn đích triển khai (AWS, vSphere, bare metal), xem huy hiệu và độ phủ.', 'Choose a deployment target (AWS, vSphere, bare metal) and see badges and coverage.'))}
            {activeRight === 'decisions' && planned('W', copy('Nhật ký quyết định kiến trúc gắn với các thành phần.', 'Architecture decision log linked to components.'))}
            {activeRight === 'assistant' && planned('v1.1', copy('Trợ lý dựa trên quy tắc. Không dùng AI và không gửi thiết kế ra ngoài.', 'A rule-based assistant. No AI, and the design never leaves the server.'))}
          </div>
        </aside>
      </div>

      <footer className="dw-statusbar">
        <span>{text(copy(`${document.nodes.length} thành phần · ${document.edges.length} kết nối`, `${document.nodes.length} components · ${document.edges.length} connections`))}</span>
        <button type="button" className="dw-link" onClick={showIssues}>
          {text(copy(`${counts.error} lỗi · ${counts.warning} cảnh báo · ${counts.info} thông tin`, `${counts.error} errors · ${counts.warning} warnings · ${counts.info} info`))}
        </button>
        <span className="dw-hint">{text(copy('/ thêm · Ctrl+Z hoàn tác · Ctrl+S lưu · F8 vấn đề', '/ add · Ctrl+Z undo · Ctrl+S save · F8 issues'))}</span>
      </footer>

      <div className="dw-toast" role="status" aria-live="assertive">{toast?.message ?? ''}</div>

      {menuOpen && (
        <CommandMenu
          document={document}
          text={text}
          targetLabel={selectedNode && getRole(selectedNode.type)?.container ? selectedNode.label : undefined}
          onRun={runMenu}
          onClose={() => setMenuOpen(false)}
        />
      )}
      {deleteNodeTarget && (
        <DeleteContainerDialog
          label={deleteNodeTarget.label}
          codeName={deleteNodeTarget.codeName}
          childCount={directChildren(document, deleteNodeTarget.id).length}
          canLift={liftCheck.ok}
          liftReason={liftCheck.reason}
          text={text}
          onCancel={() => setDeleteRequest(null)}
          onDelete={() => { editor.run([{ type: 'removeNode', id: deleteNodeTarget.id, children: 'delete' }], { select: null }); setDeleteRequest(null) }}
          onLift={() => { editor.run([{ type: 'removeNode', id: deleteNodeTarget.id, children: 'lift' }], { select: null }); setDeleteRequest(null) }}
        />
      )}
    </div>
  )
}

/** WAI-ARIA tabs with a roving tabindex: Left/Right/Home/End move and activate. */
function Tabs({ label, idBase, tabs, active, onChange, className = '' }: {
  label: string
  idBase: string
  tabs: { id: string; label: string; badge?: number }[]
  active: string
  onChange: (id: string) => void
  className?: string
}) {
  const refs = useRef(new Map<string, HTMLButtonElement>())
  const move = (index: number) => {
    const tab = tabs[(index + tabs.length) % tabs.length]
    onChange(tab.id)
    refs.current.get(tab.id)?.focus()
  }
  return (
    <div className={`dw-tabs ${className}`} role="tablist" aria-label={label}>
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          ref={(element) => { if (element) refs.current.set(tab.id, element); else refs.current.delete(tab.id) }}
          type="button"
          role="tab"
          id={`${idBase}-tab-${tab.id}`}
          aria-selected={tab.id === active}
          aria-controls={`${idBase}-panel-${tab.id}`}
          tabIndex={tab.id === active ? 0 : -1}
          className="dw-tab"
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') { event.preventDefault(); move(index + 1) }
            else if (event.key === 'ArrowLeft') { event.preventDefault(); move(index - 1) }
            else if (event.key === 'Home') { event.preventDefault(); move(0) }
            else if (event.key === 'End') { event.preventDefault(); move(tabs.length - 1) }
          }}
        >
          {tab.label}
          {tab.badge !== undefined && tab.badge > 0 && <span className="dw-badge warn">{tab.badge}</span>}
        </button>
      ))}
    </div>
  )
}

import { useState } from 'react'
import { CheckCircle2, ShieldCheck, X } from 'lucide-react'
import { copy, type TextFn } from '../../ui/copy'
import { isApiError } from '../../api/client'
import type { SaveResult, WorkspaceInput, WorkspaceRecord } from '../../domain/store'
import type { WorkspaceSync } from './useWorkspace'

/**
 * Task 1.4: saving is now a server round trip. The modal stays open while it
 * runs, closes on `saved` or `offline` (the sidebar then shows "not saved"),
 * and stays open on `conflict` with the typed values kept, so the user can
 * look at what changed and save again on top of the newer revision.
 */
export function WorkspaceModal({ text, workspace, sync, onClose, onSave }: { text: TextFn; workspace: WorkspaceRecord | null; sync: WorkspaceSync; onClose: () => void; onSave: (input: WorkspaceInput) => Promise<SaveResult> }) {
  const [name, setName] = useState(workspace?.name ?? 'Personal workspace')
  const [projectName, setProjectName] = useState(workspace?.projectName ?? 'OrderFlow modernization')
  const [systemName, setSystemName] = useState(workspace?.systemName ?? 'OrderFlow API')
  const [deploymentTarget, setDeploymentTarget] = useState(workspace?.deploymentTarget ?? 'aws')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function persist() {
    if (saving) return
    setSaving(true)
    setMessage(null)
    try {
      const result = await onSave({ name, projectName, systemName, deploymentTarget })
      if (result.status === 'conflict') {
        const latest = result.workspace
        setMessage(text(copy(
          `Workspace đã được lưu ở nơi khác (bản ${latest?.revision ?? '?'}: "${latest?.name ?? ''}"). Bản mới đã được tải lại, thay đổi của bạn CHƯA được lưu. Bấm Lưu lần nữa để ghi đè bằng nội dung đang nhập.`,
          `This workspace was saved somewhere else (revision ${latest?.revision ?? '?'}: "${latest?.name ?? ''}"). The newer version has been reloaded and your change was NOT saved. Press Save again to overwrite it with what you typed.`,
        )))
        setSaving(false)
        return
      }
      onClose()
    } catch (error) {
      setMessage(isApiError(error) ? error.detail : text(copy('Không lưu được workspace.', 'Could not save the workspace.')))
      setSaving(false)
    }
  }

  const status = sync === 'unsaved'
    ? copy('Chưa lưu lên máy chủ', 'Not saved to the server')
    : workspace
      ? copy(`Đã lưu trên máy chủ · bản ${workspace.revision}`, `Saved on the server · revision ${workspace.revision}`)
      : copy('Chưa có workspace trên máy chủ', 'No workspace on the server yet')

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="modal workspace-modal" role="dialog" aria-modal="true" aria-labelledby="workspace-modal-title"><div className="modal-header"><div><div className="eyebrow">WORKSPACE PROFILE</div><h2 id="workspace-modal-title">{text(copy('Thiết lập workspace', 'Configure workspace'))}</h2><p>{text(copy('Thông tin này là context chung cho các quyết định và báo cáo.', 'This context is shared by decisions and reports.'))}</p></div><button className="icon-button" onClick={onClose} aria-label={text(copy('Đóng', 'Close'))}><X size={18} /></button></div><div className="modal-body"><div className="form-column"><label>{text(copy('Tên workspace', 'Workspace name'))}<input value={name} onChange={(event) => setName(event.target.value)} /></label><label>{text(copy('Tên project', 'Project name'))}<input value={projectName} onChange={(event) => setProjectName(event.target.value)} /></label><label>{text(copy('Hệ thống pilot', 'Pilot system'))}<input value={systemName} onChange={(event) => setSystemName(event.target.value)} /></label><label>{text(copy('Deployment target', 'Deployment target'))}<select value={deploymentTarget} onChange={(event) => setDeploymentTarget(event.target.value)}><option value="aws">AWS</option><option value="kubernetes">Kubernetes</option><option value="vmware">VMware</option><option value="on_premises">On-premises</option><option value="hybrid">Hybrid</option></select></label>{message && <p className="workspace-modal-message" role="alert">{message}</p>}</div><div className="calculation-column"><div className="eyebrow">SERVER PROFILE</div><div className="result-card primary-result"><span>{text(copy('Current target', 'Current target'))}</span><strong>{deploymentTarget}</strong><small>{text(status)}</small></div><div className="calculation-note"><ShieldCheck size={16} /><span>{text(copy('Workspace được lưu trên máy chủ ArchPilot; trình duyệt chỉ giữ một bản sao để dùng khi mất kết nối.', 'The workspace is stored on the ArchPilot server; this browser only keeps a copy for when the server is unreachable.'))}</span></div></div></div><div className="modal-footer"><button className="secondary-button" onClick={onClose}>{text(copy('Hủy', 'Cancel'))}</button><button className="primary-button" onClick={persist} disabled={saving} aria-busy={saving}><CheckCircle2 size={16} /> {saving ? text(copy('Đang lưu…', 'Saving…')) : text(copy('Lưu workspace', 'Save workspace'))}</button></div></div></div>
}

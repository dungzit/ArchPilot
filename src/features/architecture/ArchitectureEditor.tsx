import { useState } from 'react'
import { CheckCircle2, Plus } from 'lucide-react'
import { copy, type TextFn } from '../../ui/copy'
import { createComponent, loadComponents, saveComponents } from '../../domain/architecture'
import type { ArchitectureComponent, DeploymentTarget } from '../../domain/model'

export function ArchitectureEditor({ text }: { text: TextFn }) {
  const [components, setComponents] = useState<ArchitectureComponent[]>(() => loadComponents())
  const [draft, setDraft] = useState({ name: '', type: 'service' as ArchitectureComponent['type'], target: 'aws' as DeploymentTarget, environment: 'production' })
  const [message, setMessage] = useState('')
  function addComponent() {
    if (!draft.name.trim()) {
      setMessage(text(copy('Cần nhập tên component.', 'Component name is required.')))
      return
    }
    const next = [...components, createComponent(draft)]
    setComponents(next)
    saveComponents(next)
    setDraft({ ...draft, name: '' })
    setMessage(text(copy('Đã lưu component vào architecture model.', 'Component saved to the architecture model.')))
  }
  return <div className="page-content architecture-editor-page"><div className="section-heading"><div><div className="eyebrow">ARCHITECTURE MODEL</div><h2>{text(copy('Components đã lưu', 'Persisted components'))}</h2></div><span className="status-pill teal">local model</span></div><div className="architecture-editor-layout"><section className="panel component-form"><div className="eyebrow">ADD COMPONENT</div><label>Name<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="e.g. Payment Service" /></label><div className="form-grid"><label>Type<select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as ArchitectureComponent['type'] })}><option value="service">Service</option><option value="database">Database</option><option value="cache">Cache</option><option value="queue">Queue</option><option value="storage">Storage</option><option value="network">Network</option><option value="security">Security</option></select></label><label>Target<select value={draft.target} onChange={(event) => setDraft({ ...draft, target: event.target.value as DeploymentTarget })}><option value="aws">AWS</option><option value="kubernetes">Kubernetes</option><option value="vmware">VMware</option><option value="on_premises">On-premises</option><option value="hybrid">Hybrid</option></select></label></div><label>Environment<input value={draft.environment} onChange={(event) => setDraft({ ...draft, environment: event.target.value })} /></label>{message && <div className="form-message">{message}</div>}<button className="primary-button full-button" onClick={addComponent}><Plus size={16} /> {text(copy('Add component', 'Add component'))}</button></section><section className="panel component-list"><div className="eyebrow">STORED GRAPH NODES</div>{components.map((component) => <div className="component-row" key={component.id}><span className={`component-type ${component.type}`}>{component.type.slice(0, 2).toUpperCase()}</span><div><strong>{component.name}</strong><small>{component.environment} · {component.target}</small></div><CheckCircle2 size={16} /></div>)}</section></div></div>
}

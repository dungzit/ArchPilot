/**
 * Inspector (task 2.5 nodes, task 2.4 edges; REQ-DES-005/007/008/024/025,
 * design-v2 4.2.5 and 4.2.6). Everything renders from the catalogue:
 * - General: label, code name (locked; "Change..." opens the warning dialog),
 *   role, variant, Parent (only valid containers: the keyboard re-parent path);
 * - Common attributes: catalogue.attributes, including the failure domain
 *   with the value inherited from the enclosing zone or site shown as a hint;
 * - Role configuration: the role's field descriptors;
 * - Connections: the edges plus "Add connection" (keyboard path to connect);
 * - Rationale.
 * Every change is a graph command; typing in one field is one undo step.
 */
import { useId, useState, type ReactNode } from 'react'
import {
  catalog,
  effectiveFailureDomain,
  getRole,
  validParents,
  type ArchEdgeV2,
  type ArchGraphV2,
  type ArchNodeV2,
  type Command,
  type ConfigValue,
  type EdgeMode,
  type EdgeProtocol,
  type FieldDescriptor,
  type NodeAttributes,
} from '../../domain/graph'
import { copy, type TextFn } from '../../ui/copy'
import type { RunOptions, Selection } from './model/editor'
import { commonModes, modeLabel } from './model/edgeDefaults'
import { planConnect, planReparent } from './model/operations'
import { CodeNameDialog } from './dialogs'
import { CheckboxField, CheckboxGroup, NumberField, SelectField, TextField } from './fields'

type Run = (commands: Command[], options?: RunOptions) => boolean

export interface InspectorProps {
  document: ArchGraphV2
  selection: Selection
  language: 'vi' | 'en'
  text: TextFn
  run: Run
  onSelect: (selection: Selection) => void
  onDeleteNode: (nodeId: string) => void
  onDeleteEdge: (edgeId: string) => void
  onRegisterLabelInput: (element: HTMLInputElement | HTMLTextAreaElement | null) => void
}

export function Inspector(props: InspectorProps) {
  const { document, selection, text } = props
  if (selection?.kind === 'node') {
    const node = document.nodes.find((candidate) => candidate.id === selection.id)
    if (node) return <NodeInspector key={node.id} {...props} node={node} />
  }
  if (selection?.kind === 'edge') {
    const edge = document.edges.find((candidate) => candidate.id === selection.id)
    if (edge) return <EdgeInspector key={edge.id} {...props} edge={edge} />
  }
  return (
    <div className="dw-empty">
      <strong>{text(copy('Chưa chọn gì', 'Nothing selected'))}</strong>
      <p>{text(copy('Chọn một thành phần hoặc kết nối trên canvas hay trong Lớp. Gõ / để thêm thành phần.', 'Select a component or a connection on the canvas or in Layers. Press / to add a component.'))}</p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()
  return (
    <section className="dw-section" aria-labelledby={id}>
      <h3 id={id} className="dw-group-title">{title}</h3>
      {children}
    </section>
  )
}

function enumLabel(value: string): string {
  return value.replace(/_/g, ' ')
}

function NodeInspector({ document, node, language, text, run, onSelect, onDeleteNode, onRegisterLabelInput }: InspectorProps & { node: ArchNodeV2 }) {
  const role = getRole(node.type)
  const [renaming, setRenaming] = useState(false)
  const [target, setTarget] = useState('')
  const byId = new Map(document.nodes.map((candidate) => [candidate.id, candidate]))
  const parents = validParents(document, node.id)
  const domain = effectiveFailureDomain(document, node.id)
  const attributes = node.attributes ?? {}
  const defaults = role?.defaultAttributes ?? {}

  const setAttribute = (key: keyof NodeAttributes, value: NodeAttributes[keyof NodeAttributes] | null, coalesce = false) =>
    run([{ type: 'updateNode', id: node.id, patch: { attributes: { [key]: value } } }], coalesce ? { coalesceKey: `${node.id}.attr.${key}` } : {})
  const setConfig = (key: string, value: ConfigValue | null, coalesce = false) =>
    run([{ type: 'updateNode', id: node.id, patch: { config: { [key]: value } } }], coalesce ? { coalesceKey: `${node.id}.config.${key}` } : {})

  const attributeField = (descriptor: FieldDescriptor) => {
    const key = descriptor.key as keyof NodeAttributes
    const label = text(descriptor.label)
    const current = attributes[key]
    if (descriptor.kind === 'int') {
      const fallback = defaults[key as keyof typeof defaults]
      return (
        <NumberField key={key} label={label} text={text} value={current as number | undefined} min={descriptor.min} max={descriptor.max}
          placeholder={fallback !== undefined ? String(fallback) : '1'}
          hint={current === undefined ? text(copy(`Mặc định: ${fallback ?? 1}`, `Default: ${fallback ?? 1}`)) : undefined}
          onCommit={(value) => setAttribute(key, value, true)} />
      )
    }
    if (descriptor.kind === 'enum') {
      let emptyLabel = text(copy('(chưa đặt)', '(not set)'))
      const fallback = defaults[key as keyof typeof defaults]
      if (fallback !== undefined) emptyLabel = text(copy(`(mặc định: ${enumLabel(String(fallback))})`, `(default: ${enumLabel(String(fallback))})`))
      let hint: string | undefined
      if (key === 'failureDomainLevel' && current === undefined && domain.level) {
        const from = domain.fromNodeId ? byId.get(domain.fromNodeId)?.label : undefined
        emptyLabel = text(copy(`(kế thừa: ${domain.level})`, `(inherited: ${domain.level})`))
        hint = from ? text(copy(`Kế thừa từ ${from}.`, `Inherited from ${from}.`)) : undefined
      }
      return (
        <SelectField key={key} label={label} value={current as string | undefined} emptyLabel={emptyLabel} hint={hint}
          options={(descriptor.values ?? []).map((value) => ({ value, label: enumLabel(value) }))}
          onCommit={(value) => setAttribute(key, value as NodeAttributes[keyof NodeAttributes] | null)} />
      )
    }
    const inherited = key === 'failureDomainLabel' && current === undefined ? domain.label : undefined
    return (
      <TextField key={key} label={label} text={text} value={(current as string | undefined) ?? ''} maxLength={descriptor.maxLength}
        placeholder={inherited}
        hint={inherited ? text(copy(`Kế thừa: ${inherited}`, `Inherited: ${inherited}`)) : undefined}
        onCommit={(value) => setAttribute(key, value.trim() === '' ? null : value, true)} />
    )
  }

  const configField = (descriptor: FieldDescriptor) => {
    const label = text(descriptor.label)
    const current = node.config?.[descriptor.key]
    const fallback = descriptor.default
    switch (descriptor.kind) {
      case 'int':
      case 'number':
        return (
          <NumberField key={descriptor.key} label={label} text={text} value={typeof current === 'number' ? current : undefined}
            integer={descriptor.kind === 'int'} min={descriptor.min} max={descriptor.max} unit={descriptor.unit}
            placeholder={fallback !== undefined ? String(fallback) : undefined}
            hint={current === undefined && fallback !== undefined ? text(copy(`Mặc định: ${fallback}`, `Default: ${fallback}`)) : undefined}
            onCommit={(value) => setConfig(descriptor.key, value, true)} />
        )
      case 'bool':
        return (
          <CheckboxField key={descriptor.key} label={label} checked={typeof current === 'boolean' ? current : fallback === true}
            hint={current === undefined ? text(copy('Giá trị mặc định', 'Default value')) : undefined}
            onCommit={(value) => setConfig(descriptor.key, value)} />
        )
      case 'enum':
        return (
          <SelectField key={descriptor.key} label={label} value={typeof current === 'string' ? current : undefined}
            emptyLabel={fallback !== undefined ? text(copy(`(mặc định: ${enumLabel(String(fallback))})`, `(default: ${enumLabel(String(fallback))})`)) : text(copy('(chưa đặt)', '(not set)'))}
            options={(descriptor.values ?? []).map((value) => ({ value, label: enumLabel(value) }))}
            onCommit={(value) => setConfig(descriptor.key, value)} />
        )
      case 'list':
        if (descriptor.values && descriptor.values.length > 0) {
          return (
            <CheckboxGroup key={descriptor.key} label={label} values={descriptor.values} selected={Array.isArray(current) ? current : []}
              onCommit={(value) => setConfig(descriptor.key, value.length > 0 ? value : null)} />
          )
        }
        return (
          <TextField key={descriptor.key} label={label} text={text} value={Array.isArray(current) ? current.join(', ') : ''}
            hint={text(copy('Phân tách bằng dấu phẩy.', 'Comma-separated.'))}
            onCommit={(value) => {
              const items = value.split(',').map((item) => item.trim()).filter(Boolean)
              setConfig(descriptor.key, items.length > 0 ? items : null, true)
            }} />
        )
      default:
        return (
          <TextField key={descriptor.key} label={label} text={text} value={typeof current === 'string' ? current : ''} maxLength={descriptor.maxLength}
            placeholder={fallback !== undefined ? String(fallback) : undefined}
            onCommit={(value) => setConfig(descriptor.key, value.trim() === '' ? null : value, true)} />
        )
    }
  }

  const edges = document.edges.filter((edge) => edge.source === node.id || edge.target === node.id)
  const others = document.nodes.filter((candidate) => candidate.id !== node.id)
  const parent = node.parentId ? byId.get(node.parentId) : undefined
  const placement = node.type === 'network_segment' && parent
    ? parent.type === 'site' ? text(copy('Trải rộng trên các zone của site', 'Stretched across the site\'s zones')) : parent.type === 'zone' ? text(copy('Cục bộ trong zone', 'Zone-local')) : undefined
    : undefined

  return (
    <div className="dw-inspector" aria-label={text(copy('Thuộc tính thành phần', 'Component properties'))}>
      <header className="dw-inspector-head">
        <span className={`dw-role-dot layer-${role?.layer ?? 'x'}`} aria-hidden="true" />
        <div>
          <strong>{role ? text(role.label) : node.type}</strong>
          <small>{role ? text(role.purpose) : ''}</small>
        </div>
      </header>

      <Section title={text(copy('Chung', 'General'))}>
        <TextField label={text(copy('Nhãn', 'Label'))} text={text} value={node.label} required maxLength={120} dataFirst inputRef={onRegisterLabelInput}
          onCommit={(value) => run([{ type: 'renameNode', id: node.id, label: value }], { coalesceKey: `${node.id}.label` })} />
        <div className="dw-field">
          <span className="dw-field-label" id={`cn-${node.id}`}>{text(copy('Tên mã', 'Code name'))}</span>
          <div className="dw-codename" aria-labelledby={`cn-${node.id}`}>
            <code>{node.codeName}</code>
            <span className="dw-chip">{text(copy('đã khóa', 'locked'))}</span>
            <button type="button" className="dw-button small" onClick={() => setRenaming(true)}>{text(copy('Đổi…', 'Change…'))}</button>
          </div>
          <p className="dw-field-hint">{text(copy('Đổi nhãn không đổi tên mã.', 'Renaming the label does not change the code name.'))}</p>
        </div>
        {role?.variants && role.variants.length > 0 && (
          <SelectField label={text(copy('Biến thể', 'Variant'))} value={node.variant}
            emptyLabel={text(copy('(không có)', '(none)'))}
            options={role.variants.map((variant) => ({ value: variant.id, label: text(variant.label) }))}
            onCommit={(value) => run([{ type: 'updateNode', id: node.id, patch: { variant: value } }])} />
        )}
        <SelectField label={text(copy('Nằm trong', 'Parent'))} value={node.parentId ?? '__root'}
          options={[
            ...(parents.includes(null) || !node.parentId ? [{ value: '__root', label: text(copy('Canvas (cấp cao nhất)', 'Canvas (top level)')), disabled: !parents.includes(null) }] : []),
            ...(node.parentId && !parents.includes(node.parentId) ? [{ value: node.parentId, label: byId.get(node.parentId)?.label ?? node.parentId }] : []),
            ...parents.filter((id): id is string => id !== null).map((id) => {
              const candidate = byId.get(id)!
              const candidateRole = getRole(candidate.type)
              return { value: id, label: `${candidate.label} (${candidateRole ? text(candidateRole.label) : candidate.type})` }
            }),
          ]}
          hint={placement ?? text(copy('Chỉ liệt kê các vùng chứa hợp lệ theo quy tắc lồng.', 'Only containers the nesting rules allow are listed.'))}
          onCommit={(value) => {
            const plan = planReparent(document, node.id, value === '__root' || value === null ? null : value)
            if (plan.ok) run(plan.commands)
          }} />
      </Section>

      <Section title={text(copy('Thuộc tính chung', 'Common attributes'))}>
        {catalog.attributes.map(attributeField)}
      </Section>

      {role && role.fields.length > 0 && (
        <Section title={text(copy('Cấu hình vai trò', 'Role configuration'))}>
          {role.fields.map(configField)}
        </Section>
      )}

      <Section title={text(copy('Kết nối', 'Connections'))}>
        {edges.length === 0 ? <p className="dw-hint">{text(copy('Chưa có kết nối.', 'No connections yet.'))}</p> : (
          <ul className="dw-link-list">
            {edges.map((edge) => {
              const other = byId.get(edge.source === node.id ? edge.target : edge.source)
              const arrow = edge.source === node.id ? '→' : '←'
              return (
                <li key={edge.id}>
                  <button type="button" className="dw-link" onClick={() => onSelect({ kind: 'edge', id: edge.id })}>
                    {arrow} {other?.label ?? '?'} <small>({edge.kind === 'access' ? text(copy('truy cập', 'access')) : text(copy('luồng', 'flow'))}{edge.label ? `: ${edge.label}` : ''})</small>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {others.length > 0 && (
          <div className="dw-add-connection">
            <SelectField label={text(copy('Thêm kết nối tới', 'Add connection to'))} value={target || undefined}
              emptyLabel={text(copy('(chọn thành phần)', '(choose a component)'))}
              options={others.map((candidate) => ({ value: candidate.id, label: `${candidate.label} (${candidate.codeName})` }))}
              onCommit={(value) => setTarget(value ?? '')} />
            <button type="button" className="dw-button small" disabled={!target} onClick={() => {
              const plan = planConnect(document, node.id, target, language)
              if (!plan.ok) return
              if (run(plan.commands, { select: { kind: 'edge', id: plan.createdId! } })) setTarget('')
            }}>{text(copy('Kết nối', 'Connect'))}</button>
          </div>
        )}
      </Section>

      <Section title={text(copy('Lý do', 'Rationale'))}>
        <TextField label={text(copy('Ghi chú lý do', 'Rationale note'))} text={text} value={node.rationale ?? ''} multiline maxLength={4000}
          onCommit={(value) => run([{ type: 'updateNode', id: node.id, patch: { rationale: value === '' ? null : value } }], { coalesceKey: `${node.id}.rationale` })} />
      </Section>

      <div className="dw-inspector-foot">
        <button type="button" className="dw-button danger" onClick={() => onDeleteNode(node.id)}>{text(copy('Xóa thành phần', 'Delete component'))}</button>
      </div>

      {renaming && (
        <CodeNameDialog document={document} nodeId={node.id} text={text} onCancel={() => setRenaming(false)}
          onRename={(codeName) => { if (run([{ type: 'setCodeName', id: node.id, codeName }])) setRenaming(false) }} />
      )}
    </div>
  )
}

const PROTOCOLS: EdgeProtocol[] = ['tcp', 'udp', 'http', 'https', 'grpc', 'amqp', 'mqtt', 'sql', 'nfs', 'smb', 'iscsi', 'other']

function EdgeInspector({ document, edge, text, run, onSelect, onDeleteEdge, onRegisterLabelInput }: InspectorProps & { edge: ArchEdgeV2 }) {
  const source = document.nodes.find((node) => node.id === edge.source)
  const target = document.nodes.find((node) => node.id === edge.target)
  const fitting = source && target ? commonModes(source.type, target.type) : []
  const patch = (value: Extract<Command, { type: 'updateEdge' }>['patch'], coalesceKey?: string) =>
    run([{ type: 'updateEdge', id: edge.id, patch: value }], coalesceKey ? { coalesceKey } : {})
  const modeOptions = catalog.edgeModes.map((mode) => ({
    value: mode.id,
    label: `${text(mode.label)}${edge.kind === 'access' && !fitting.includes(mode.id) ? text(copy(' (không phù hợp)', ' (does not fit)')) : ''}`,
  }))
  return (
    <div className="dw-inspector" aria-label={text(copy('Thuộc tính kết nối', 'Connection properties'))}>
      <header className="dw-inspector-head">
        <span className="dw-edge-glyph" aria-hidden="true">{edge.kind === 'access' ? '⚿' : '⇢'}</span>
        <div>
          <strong>{source?.label ?? edge.source} → {target?.label ?? edge.target}</strong>
          <small>{edge.kind === 'access'
            ? text(copy('Truy cập: nguồn sử dụng đích. Bộ sinh mã có thể suy ra luật tường lửa, quyền và tham chiếu.', 'Access: the source uses the target. Generators may derive firewall rules, permissions and references.'))
            : text(copy('Luồng: chỉ để minh họa, không sinh mã.', 'Flow: drawing only, produces no code.'))}</small>
        </div>
      </header>
      <Section title={text(copy('Kết nối', 'Connection'))}>
        <TextField label={text(copy('Nhãn', 'Label'))} text={text} value={edge.label} maxLength={120} dataFirst inputRef={onRegisterLabelInput}
          onCommit={(value) => patch({ label: value }, `${edge.id}.label`)} />
        <fieldset className="dw-fieldset">
          <legend className="dw-field-label">{text(copy('Loại', 'Kind'))}</legend>
          {(['access', 'flow'] as const).map((kind) => (
            <label key={kind} className="dw-check-inline">
              <input type="radio" name={`kind-${edge.id}`} checked={edge.kind === kind}
                onChange={() => patch(kind === 'access'
                  ? { kind, direction: 'forward', ...(edge.mode ? {} : fitting[0] ? { mode: fitting[0] } : {}) }
                  : { kind })} />
              {kind === 'access' ? text(copy('Truy cập (sinh quyền/luật)', 'Access (drives rules)')) : text(copy('Luồng (chỉ minh họa)', 'Flow (visual only)'))}
            </label>
          ))}
        </fieldset>
        <SelectField label={text(copy('Chế độ', 'Mode'))} value={edge.mode} emptyLabel={text(copy('(không có)', '(none)'))} options={modeOptions}
          hint={edge.kind === 'access' && fitting.length === 0 ? text(copy('Hai vai trò này không có chế độ truy cập chung.', 'These two roles share no access mode.')) : undefined}
          onCommit={(value) => patch({ mode: value as EdgeMode | null })} />
        <SelectField label={text(copy('Hướng', 'Direction'))} value={edge.direction}
          options={[
            { value: 'forward', label: text(copy('Một chiều', 'Forward')) },
            { value: 'bidirectional', label: text(copy('Hai chiều', 'Bidirectional')), disabled: edge.kind === 'access' },
          ]}
          hint={edge.kind === 'access' ? text(copy('Kết nối truy cập luôn một chiều.', 'Access edges are always forward.')) : undefined}
          onCommit={(value) => patch({ direction: value === 'bidirectional' ? 'bidirectional' : 'forward' })} />
        <SelectField label={text(copy('Giao thức', 'Protocol'))} value={edge.protocol} emptyLabel={text(copy('(không có)', '(none)'))}
          options={PROTOCOLS.map((protocol) => ({ value: protocol, label: protocol }))}
          onCommit={(value) => patch({ protocol: value as EdgeProtocol | null })} />
        <NumberField label={text(copy('Cổng', 'Port'))} text={text} value={edge.port} min={1} max={65535}
          onCommit={(value) => patch({ port: value }, `${edge.id}.port`)} />
        <TextField label={text(copy('Lý do', 'Rationale'))} text={text} value={edge.rationale ?? ''} multiline maxLength={4000}
          onCommit={(value) => patch({ rationale: value === '' ? null : value }, `${edge.id}.rationale`)} />
      </Section>
      <p className="dw-hint">{text(copy('Ảnh hưởng theo từng đích triển khai (luật SG, yêu cầu tường lửa) sẽ hiển thị khi có tab Target (giai đoạn T).', 'The per-target effect (security-group rule, firewall request) appears with the Target tab (phase T).'))}</p>
      <div className="dw-inspector-foot">
        {source && <button type="button" className="dw-button small" onClick={() => onSelect({ kind: 'node', id: source.id })}>{text(copy('Tới nguồn', 'Go to source'))}</button>}
        {target && <button type="button" className="dw-button small" onClick={() => onSelect({ kind: 'node', id: target.id })}>{text(copy('Tới đích', 'Go to target'))}</button>}
        <button type="button" className="dw-button danger" onClick={() => onDeleteEdge(edge.id)}>{text(copy('Xóa kết nối', 'Delete connection'))}</button>
      </div>
    </div>
  )
}

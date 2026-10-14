/**
 * Components palette (task 2.2; REQ-DES-002/003, design-v2 4.2.4). Rendered
 * from the catalogue: 11 layer groups, provider-neutral labels in VI/EN, a
 * one-line purpose, and search that folds Vietnamese diacritics and matches
 * synonyms ("VLAN" -> network segment, "NAS" -> file storage). Each item is a
 * button (click or Enter adds it) and a drag source for the canvas.
 */
import { useId, useMemo, useState, type DragEvent } from 'react'
import { rolesByLayer, searchRoles, type CatalogRole } from '../../domain/graph'
import { copy, type TextFn } from '../../ui/copy'

/** MIME type of a palette drag; the payload is the role id. */
export const ROLE_DRAG_TYPE = 'application/x-archpilot-role'

/** The role being dragged right now (dragover cannot read dataTransfer payloads). */
let draggingRole: string | null = null
export function currentPaletteDrag(): string | null {
  return draggingRole
}
export function setPaletteDrag(role: string | null): void {
  draggingRole = role
}

export function Palette({ text, onAdd }: { text: TextFn; onAdd: (roleId: string) => void }) {
  const [query, setQuery] = useState('')
  const searchId = useId()
  const groups = useMemo(() => rolesByLayer(), [])
  const results = useMemo(() => (query.trim() ? searchRoles(query) : null), [query])

  const item = (role: CatalogRole) => (
    <li key={role.id}>
      <button
        type="button"
        className="dw-palette-item"
        draggable
        data-role={role.id}
        onDragStart={(event: DragEvent<HTMLButtonElement>) => {
          event.dataTransfer.setData(ROLE_DRAG_TYPE, role.id)
          event.dataTransfer.setData('text/plain', role.id)
          event.dataTransfer.effectAllowed = 'copy'
          setPaletteDrag(role.id)
        }}
        onDragEnd={() => setPaletteDrag(null)}
        onClick={() => onAdd(role.id)}
        title={text(role.purpose)}
      >
        <span className={`dw-role-dot layer-${role.layer}`} aria-hidden="true" />
        <span className="dw-palette-text">
          <strong>{text(role.label)}</strong>
          <small>{text(role.purpose)}</small>
        </span>
        {role.container && <span className="dw-chip">{text(copy('vùng chứa', 'container'))}</span>}
      </button>
    </li>
  )

  return (
    <div className="dw-palette">
      <label className="dw-field-label" htmlFor={searchId}>{text(copy('Tìm thành phần', 'Search components'))}</label>
      <input
        id={searchId}
        className="dw-input"
        type="search"
        value={query}
        placeholder={text(copy('vd. VLAN, NAS, cơ sở dữ liệu', 'e.g. VLAN, NAS, database'))}
        onChange={(event) => setQuery(event.target.value)}
      />
      <p className="dw-hint">{text(copy('Nhấn để thêm, kéo vào canvas, hoặc gõ / để mở menu lệnh.', 'Click to add, drag onto the canvas, or press / for the command menu.'))}</p>
      {results ? (
        <section aria-label={text(copy('Kết quả tìm kiếm', 'Search results'))}>
          <p className="dw-hint" role="status">{text(copy(`${results.length} kết quả`, `${results.length} result${results.length === 1 ? '' : 's'}`))}</p>
          <ul className="dw-palette-list">{results.map(item)}</ul>
        </section>
      ) : (
        groups.filter((group) => group.roles.length > 0).map((group) => (
          <section key={group.layer.id} className="dw-palette-group" aria-labelledby={`${searchId}-${group.layer.id}`}>
            <h3 id={`${searchId}-${group.layer.id}`} className="dw-group-title">{text(group.layer.label)}</h3>
            <ul className="dw-palette-list">{group.roles.map(item)}</ul>
          </section>
        ))
      )}
    </div>
  )
}

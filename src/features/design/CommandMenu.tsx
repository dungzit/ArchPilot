/**
 * Command menu (task 2.2; REQ-DES-003 keyboard path, design-v2 4.2.19):
 * `/` or Ctrl+K. "Add <component>" for every catalogue role (same search as
 * the palette: VI folding + synonyms) and "Go to <node>". A combobox +
 * listbox: Up/Down move, Enter runs, Escape closes, focus returns.
 */
import { useId, useMemo, useState, type KeyboardEvent } from 'react'
import { foldForSearch, getRole, searchRoles, type ArchGraphV2 } from '../../domain/graph'
import { copy, type TextFn } from '../../ui/copy'
import { Modal } from './dialogs'

export type MenuAction = { kind: 'add'; roleId: string } | { kind: 'goto'; nodeId: string }

interface Entry { key: string; label: string; detail: string; action: MenuAction }

const MAX_ENTRIES = 40

export function CommandMenu({ document, text, targetLabel, onRun, onClose }: {
  document: ArchGraphV2
  text: TextFn
  /** Where "Add" puts the node: the selected container's label, or undefined for the canvas. */
  targetLabel?: string
  onRun: (action: MenuAction) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listId = useId()
  const inputId = useId()

  const entries = useMemo<Entry[]>(() => {
    const where = targetLabel ? text(copy(`vào ${targetLabel}`, `into ${targetLabel}`)) : text(copy('vào canvas', 'onto the canvas'))
    const adds: Entry[] = searchRoles(query).map((role) => ({
      key: `add:${role.id}`,
      label: text(copy(`Thêm ${text(role.label)}`, `Add ${text(role.label)}`)),
      detail: where,
      action: { kind: 'add', roleId: role.id },
    }))
    const folded = foldForSearch(query).trim()
    const gotos: Entry[] = document.nodes
      .filter((node) => folded === '' || foldForSearch(node.label).includes(folded) || node.codeName.includes(folded))
      .map((node) => ({
        key: `goto:${node.id}`,
        label: text(copy(`Tới ${node.label}`, `Go to ${node.label}`)),
        detail: `${getRole(node.type) ? text(getRole(node.type)!.label) : node.type} · ${node.codeName}`,
        action: { kind: 'goto', nodeId: node.id },
      }))
    return [...adds, ...gotos].slice(0, MAX_ENTRIES)
  }, [document, query, targetLabel, text])

  const current = Math.min(active, Math.max(0, entries.length - 1))

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((current + 1) % Math.max(1, entries.length))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((current - 1 + entries.length) % Math.max(1, entries.length))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const entry = entries[current]
      if (entry) onRun(entry.action)
    }
  }

  return (
    <Modal title={text(copy('Menu lệnh', 'Command menu'))} onClose={onClose} className="dw-command-menu">
      <label className="dw-field-label" htmlFor={inputId}>{text(copy('Gõ để tìm thành phần hoặc nút', 'Type to find a component or a node'))}</label>
      <input
        id={inputId}
        className="dw-input"
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={entries[current] ? `${listId}-${current}` : undefined}
        value={query}
        onChange={(event) => { setQuery(event.target.value); setActive(0) }}
        onKeyDown={onKeyDown}
        data-autofocus
      />
      <ul id={listId} role="listbox" className="dw-menu-list" aria-label={text(copy('Lệnh', 'Commands'))}>
        {entries.length === 0 && <li className="dw-hint" role="option" aria-selected="false" aria-disabled="true">{text(copy('Không có kết quả.', 'No matches.'))}</li>}
        {entries.map((entry, index) => (
          <li
            key={entry.key}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === current}
            className={index === current ? 'active' : ''}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onRun(entry.action)}
          >
            <span>{entry.label}</span>
            <small>{entry.detail}</small>
          </li>
        ))}
      </ul>
    </Modal>
  )
}

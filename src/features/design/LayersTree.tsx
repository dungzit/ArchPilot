/**
 * Layers (task 2.7; NFR2-A11Y-002, design-v2 4.2.4): the containment tree as
 * the screen-reader list view of the canvas, plus the list of connections.
 *
 * WAI-ARIA tree pattern with a roving tabindex: Up/Down move, Right opens a
 * container or enters it, Left closes it or goes to the parent, Home/End,
 * Enter selects (and moves focus to the Inspector), F2 renames, Delete
 * deletes. Each row reads label, role, code name and issue count.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { getRole, type ArchGraphV2, type ArchNodeV2, type Problem } from '../../domain/graph'
import { copy, type TextFn } from '../../ui/copy'
import type { Selection } from './model/editor'
import { modeLabel } from './model/edgeDefaults'

interface Row {
  node: ArchNodeV2
  level: number
  hasChildren: boolean
  parentId: string | null
}

function visibleRows(document: ArchGraphV2, collapsed: ReadonlySet<string>): Row[] {
  const ids = new Set(document.nodes.map((node) => node.id))
  const children = new Map<string | null, ArchNodeV2[]>()
  for (const node of document.nodes) {
    // A node whose parent is missing shows at the top, so nothing is ever unreachable.
    const parent = node.parentId !== undefined && ids.has(node.parentId) ? node.parentId : null
    children.set(parent, [...(children.get(parent) ?? []), node])
  }
  const rows: Row[] = []
  const seen = new Set<string>()
  const walk = (parentId: string | null, level: number) => {
    for (const node of children.get(parentId) ?? []) {
      if (seen.has(node.id)) continue
      seen.add(node.id)
      const kids = children.get(node.id) ?? []
      rows.push({ node, level, hasChildren: kids.length > 0, parentId })
      if (kids.length > 0 && !collapsed.has(node.id)) walk(node.id, level + 1)
    }
  }
  walk(null, 1)
  return rows
}

export function LayersTree({
  document, selection, issues, text, onSelect, onActivate, onRename, onDelete,
}: {
  document: ArchGraphV2
  selection: Selection
  issues: Problem[]
  text: TextFn
  onSelect: (selection: Selection) => void
  /** Enter: select and move focus to the Inspector. */
  onActivate: (nodeId: string) => void
  onRename: (nodeId: string) => void
  onDelete: (nodeId: string) => void
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [focusId, setFocusId] = useState<string | null>(null)
  const rows = useMemo(() => visibleRows(document, collapsed), [document, collapsed])
  const itemRefs = useRef(new Map<string, HTMLLIElement>())
  const focusPending = useRef(false)
  const selectedNodeId = selection?.kind === 'node' ? selection.id : null
  const current = rows.find((row) => row.node.id === focusId)?.node.id ?? selectedNodeId ?? rows[0]?.node.id ?? null

  useEffect(() => {
    if (!focusPending.current || !current) return
    focusPending.current = false
    itemRefs.current.get(current)?.focus()
  }, [current])

  const moveTo = (id: string | undefined) => {
    if (!id) return
    focusPending.current = true
    setFocusId(id)
    onSelect({ kind: 'node', id })
  }
  const toggle = (id: string, open: boolean) => {
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (open) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    // The key belongs to the row that has focus (the roving item), whatever the last selection was.
    const fromTarget = (event.target as HTMLElement).closest?.('[role="treeitem"]')?.getAttribute('data-node-id')
    const index = rows.findIndex((row) => row.node.id === (fromTarget ?? current))
    if (index < 0) return
    const row = rows[index]
    let handled = true
    switch (event.key) {
      case 'ArrowDown': moveTo(rows[index + 1]?.node.id); break
      case 'ArrowUp': moveTo(rows[index - 1]?.node.id); break
      case 'Home': moveTo(rows[0]?.node.id); break
      case 'End': moveTo(rows[rows.length - 1]?.node.id); break
      case 'ArrowRight':
        if (row.hasChildren && collapsed.has(row.node.id)) toggle(row.node.id, true)
        else if (row.hasChildren) moveTo(rows[index + 1]?.node.id)
        break
      case 'ArrowLeft':
        if (row.hasChildren && !collapsed.has(row.node.id)) toggle(row.node.id, false)
        else if (row.parentId) moveTo(row.parentId)
        break
      case 'Enter': onActivate(row.node.id); break
      case ' ': onSelect({ kind: 'node', id: row.node.id }); break
      case 'F2': onRename(row.node.id); break
      case 'Delete': onDelete(row.node.id); break
      default: handled = false
    }
    if (handled) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  if (document.nodes.length === 0) {
    return <p className="dw-empty">{text(copy('Chưa có thành phần nào.', 'No components yet.'))}</p>
  }

  const issueCount = (id: string) => issues.filter((issue) => issue.nodeId === id).length
  const byId = new Map(document.nodes.map((node) => [node.id, node]))

  return (
    <div className="dw-layers">
      <ul role="tree" aria-label={text(copy('Cây thành phần', 'Component tree'))} className="dw-tree" onKeyDown={onKeyDown}>
        {rows.map((row) => {
          const role = getRole(row.node.type)
          const count = issueCount(row.node.id)
          const selected = selectedNodeId === row.node.id
          return (
            <li
              key={row.node.id}
              ref={(element) => { if (element) itemRefs.current.set(row.node.id, element); else itemRefs.current.delete(row.node.id) }}
              role="treeitem"
              aria-level={row.level}
              aria-selected={selected}
              aria-expanded={row.hasChildren ? !collapsed.has(row.node.id) : undefined}
              tabIndex={row.node.id === current ? 0 : -1}
              className={`dw-tree-row${selected ? ' selected' : ''}`}
              style={{ paddingLeft: 8 + (row.level - 1) * 14 }}
              data-node-id={row.node.id}
              onClick={() => { setFocusId(row.node.id); onSelect({ kind: 'node', id: row.node.id }) }}
            >
              <span className="dw-tree-toggle" aria-hidden="true">{row.hasChildren ? (collapsed.has(row.node.id) ? '▸' : '▾') : ''}</span>
              <span className="dw-tree-text">
                <strong>{row.node.label}</strong>
                <small>{role ? text(role.label) : row.node.type} · <code>{row.node.codeName}</code></small>
              </span>
              {count > 0 && (
                <span className="dw-issue-count">
                  {text(copy(`${count} vấn đề`, `${count} issue${count === 1 ? '' : 's'}`))}
                </span>
              )}
            </li>
          )
        })}
      </ul>
      {document.edges.length > 0 && (
        <section className="dw-edge-list" aria-label={text(copy('Kết nối', 'Connections'))}>
          <h3 className="dw-group-title">{text(copy('Kết nối', 'Connections'))}</h3>
          <ul>
            {document.edges.map((edge) => {
              const selected = selection?.kind === 'edge' && selection.id === edge.id
              const source = byId.get(edge.source)?.label ?? edge.source
              const target = byId.get(edge.target)?.label ?? edge.target
              const kind = edge.kind === 'access' ? text(copy('truy cập', 'access')) : text(copy('luồng', 'flow'))
              return (
                <li key={edge.id}>
                  <button type="button" className={`dw-edge-row${selected ? ' selected' : ''}`} aria-pressed={selected} onClick={() => onSelect({ kind: 'edge', id: edge.id })}>
                    {source} → {target} <small>({kind}{edge.mode ? `, ${text(modeLabel(edge.mode))}` : ''})</small>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}

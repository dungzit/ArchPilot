/**
 * Canvas geometry for the logical design (tasks 2.2 / 2.3). Pure, no React,
 * no React Flow: positions in the document are relative to the parent
 * container (contract 2.0), and everything here converts between that and
 * absolute canvas coordinates, finds the container under a point, and works
 * out how small a container may be resized.
 *
 * Every walk is cycle-safe (containment.ancestors stops at loops), because an
 * imported document can be corrupt.
 */
import {
  ancestors,
  canNest,
  catalog,
  descendants,
  getRole,
  nodeMap,
  type ArchGraphV2,
  type ArchNodeV2,
  type NestVerdict,
  type Position,
} from '../../../domain/graph'

export const GRID = 8
/** Space kept between a container's border and its children (design-v2 4.2.3). */
export const CONTAINER_PADDING = 24
/** Room for the container's title row. */
export const CONTAINER_HEADER = 32

export const COMPONENT_SIZE = { width: 184, height: 56 } as const

const CONTAINER_DEFAULTS: Record<string, { width: number; height: number }> = {
  site: { width: 760, height: 480 },
  zone: { width: 520, height: 340 },
  network_segment: { width: 400, height: 220 },
  hypervisor_cluster: { width: 360, height: 220 },
  container_platform: { width: 360, height: 220 },
}
const CONTAINER_FALLBACK = { width: 360, height: 220 }

export const MIN_CONTAINER_SIZE = { width: 200, height: 120 } as const

export function isContainerRole(roleId: string): boolean {
  return getRole(roleId)?.container === true
}

export function defaultSize(roleId: string): { width: number; height: number } {
  if (!isContainerRole(roleId)) return { ...COMPONENT_SIZE }
  return { ...(CONTAINER_DEFAULTS[roleId] ?? CONTAINER_FALLBACK) }
}

export function nodeSize(node: ArchNodeV2): { width: number; height: number } {
  return node.size ? { ...node.size } : defaultSize(node.type)
}

export function snap(value: number, grid = GRID): number {
  return Math.round(value / grid) * grid
}

/** Absolute canvas position of a node (sum of relative positions up the chain). */
export function absolutePosition(document: ArchGraphV2, nodeId: string, byId = nodeMap(document)): Position {
  const node = byId.get(nodeId)
  if (!node) return { x: 0, y: 0 }
  let x = node.position.x
  let y = node.position.y
  for (const ancestorId of ancestors(document, nodeId, byId)) {
    const ancestor = byId.get(ancestorId)!
    x += ancestor.position.x
    y += ancestor.position.y
  }
  return { x, y }
}

/** Position of an absolute point relative to `parentId` (null = canvas). */
export function relativeTo(document: ArchGraphV2, parentId: string | null, point: Position, byId = nodeMap(document)): Position {
  if (parentId === null) return { x: point.x, y: point.y }
  const origin = absolutePosition(document, parentId, byId)
  return { x: point.x - origin.x, y: point.y - origin.y }
}

/**
 * Nodes ordered so every parent comes before its children (React Flow
 * requires it), keeping document order otherwise. Nodes whose parent is
 * missing or in a loop are placed at the end, as top-level.
 */
export function parentFirstOrder(document: ArchGraphV2): ArchNodeV2[] {
  const byId = nodeMap(document)
  const depth = new Map<string, number>()
  document.nodes.forEach((node) => depth.set(node.id, ancestors(document, node.id, byId).length))
  return document.nodes
    .map((node, index) => ({ node, index }))
    .sort((a, b) => (depth.get(a.node.id)! - depth.get(b.node.id)!) || a.index - b.index)
    .map((entry) => entry.node)
}

/**
 * The innermost container whose rectangle contains `point` (absolute),
 * skipping `exclude` (the dragged node and its subtree). Among overlapping
 * containers the deepest wins, then the later one in the document (drawn on top).
 */
export function containerAt(document: ArchGraphV2, point: Position, exclude: ReadonlySet<string> = new Set()): ArchNodeV2 | undefined {
  const byId = nodeMap(document)
  let best: { node: ArchNodeV2; depth: number; index: number } | undefined
  document.nodes.forEach((node, index) => {
    if (exclude.has(node.id) || !isContainerRole(node.type) || byId.get(node.id) !== node) return
    const origin = absolutePosition(document, node.id, byId)
    const size = nodeSize(node)
    const inside = point.x >= origin.x && point.x <= origin.x + size.width && point.y >= origin.y && point.y <= origin.y + size.height
    if (!inside) return
    const depth = ancestors(document, node.id, byId).length
    if (!best || depth > best.depth || (depth === best.depth && index > best.index)) best = { node, depth, index }
  })
  return best?.node
}

export interface DropTarget {
  parentId: string | null
  verdict: NestVerdict
}

/** Where a node of `roleId` would land if dropped at `point`, and whether NEST allows it. */
export function dropTargetFor(document: ArchGraphV2, roleId: string, point: Position, exclude: ReadonlySet<string> = new Set()): DropTarget {
  const container = containerAt(document, point, exclude)
  return { parentId: container?.id ?? null, verdict: canNest(roleId, container ? container.type : null) }
}

/** The node and every node below it: what a drag must not drop into. */
export function subtreeIds(document: ArchGraphV2, nodeId: string): Set<string> {
  return new Set([nodeId, ...descendants(document, nodeId)])
}

/**
 * The smallest size a container may be resized to: its children's extent
 * plus padding (design-v2 4.2.3), never below MIN_CONTAINER_SIZE.
 */
export function minContainerSize(document: ArchGraphV2, containerId: string): { width: number; height: number } {
  let width: number = MIN_CONTAINER_SIZE.width
  let height: number = MIN_CONTAINER_SIZE.height
  for (const child of document.nodes) {
    if (child.parentId !== containerId) continue
    const size = nodeSize(child)
    width = Math.max(width, child.position.x + size.width + CONTAINER_PADDING)
    height = Math.max(height, child.position.y + size.height + CONTAINER_PADDING)
  }
  return { width, height }
}

/**
 * A free spot for a click-added node: inside `parentId` below the header, or
 * on the canvas, stepping on a grid until nothing overlaps. Deterministic.
 */
export function freeSpot(document: ArchGraphV2, parentId: string | null, roleId: string): Position {
  const size = defaultSize(roleId)
  const siblings = document.nodes.filter((node) => (node.parentId ?? null) === parentId)
  const overlaps = (x: number, y: number) =>
    siblings.some((node) => {
      const other = nodeSize(node)
      return x < node.position.x + other.width + GRID && node.position.x < x + size.width + GRID &&
        y < node.position.y + other.height + GRID && node.position.y < y + size.height + GRID
    })
  const startX = parentId === null ? 40 : CONTAINER_PADDING
  const startY = parentId === null ? 40 : CONTAINER_HEADER + 8
  const columns = parentId === null ? 6 : 3
  for (let row = 0; row < 40; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = startX + column * (size.width + 2 * GRID)
      const y = startY + row * (size.height + 2 * GRID)
      if (!overlaps(x, y)) return { x, y }
    }
  }
  return { x: startX, y: startY }
}

/** The label a new node gets: its role label, numbered when taken ("Cache 2"). */
export function newNodeLabel(document: ArchGraphV2, roleLabel: string): string {
  const taken = new Set(document.nodes.map((node) => node.label.toLowerCase()))
  if (!taken.has(roleLabel.toLowerCase())) return roleLabel
  for (let n = 2; ; n += 1) {
    const candidate = `${roleLabel} ${n}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}

export const MAX_DEPTH = catalog.limits.maxNestingDepth

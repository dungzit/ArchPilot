/**
 * Canvas gestures turned into graph commands (tasks 2.2-2.4). Pure: each
 * function reads a document and returns the Command[] for ONE undo step, or
 * a refusal with the NEST rule id and VI/EN text. The command layer re-checks
 * everything; these only choose ids, positions and defaults.
 */
import {
  canNest,
  getRole,
  nextEdgeId,
  nextNodeId,
  nodeMap,
  type ArchGraphV2,
  type Bilingual,
  type Command,
  type CommandError,
  type Position,
} from '../../../domain/graph'
import { edgeDefaults } from './edgeDefaults'
import {
  absolutePosition,
  defaultSize,
  dropTargetFor,
  freeSpot,
  isContainerRole,
  newNodeLabel,
  relativeTo,
  snap,
  subtreeIds,
} from './geometry'

export type Plan = { ok: true; commands: Command[]; createdId?: string } | { ok: false; error: CommandError }

function refuse(code: string, message: Bilingual): Plan {
  return { ok: false, error: { code, message } }
}

/**
 * Add a node of `roleId`. With `at` (absolute drop point = the node's
 * top-left) the parent is the container under that point; without it the
 * node goes into `parentId` (or the canvas) at a free spot. Containers get
 * their default size in the same step.
 */
export function planAddNode(
  document: ArchGraphV2,
  roleId: string,
  language: keyof Bilingual,
  placement: { at: Position } | { parentId: string | null },
): Plan {
  const role = getRole(roleId)
  if (!role) return refuse('INT-UNKNOWN-ROLE', { en: `${roleId} is not a catalogue role.`, vi: `${roleId} không có trong danh mục.` })
  let parentId: string | null
  let position: Position
  if ('at' in placement) {
    const target = dropTargetFor(document, roleId, placement.at)
    if (!target.verdict.ok) return refuse(target.verdict.ruleId, target.verdict.message)
    parentId = target.parentId
    const relative = relativeTo(document, parentId, placement.at)
    position = { x: snap(relative.x), y: snap(relative.y) }
  } else {
    parentId = placement.parentId
    const verdict = canNest(roleId, parentId === null ? null : nodeMap(document).get(parentId)?.type ?? null)
    if (!verdict.ok) return refuse(verdict.ruleId, verdict.message)
    position = freeSpot(document, parentId, roleId)
  }
  const id = nextNodeId(document)
  const commands: Command[] = [{
    type: 'addNode',
    id,
    role: role.id,
    label: newNodeLabel(document, role.label[language]),
    position,
    parentId,
    ...(role.defaultVariant ? { variant: role.defaultVariant } : {}),
  }]
  if (isContainerRole(role.id)) commands.push({ type: 'resizeNode', id, size: defaultSize(role.id) })
  return { ok: true, commands, createdId: id }
}

/**
 * A node was dragged so its top-left is at `absoluteTopLeft`; `pointer` is
 * the drop point used to find the new container (defaults to the node's
 * centre-ish top-left). Same parent = move; another container = re-parent
 * (children travel with it); a NEST refusal returns the rule for a toast and
 * the canvas snaps back.
 */
export function planMoveNode(document: ArchGraphV2, nodeId: string, absoluteTopLeft: Position, pointer?: Position): Plan {
  const byId = nodeMap(document)
  const node = byId.get(nodeId)
  if (!node) return refuse('CMD-NO-SUCH-NODE', { en: `There is no node ${nodeId}.`, vi: `Không có nút ${nodeId}.` })
  const target = dropTargetFor(document, node.type, pointer ?? absoluteTopLeft, subtreeIds(document, nodeId))
  if (!target.verdict.ok) return refuse(target.verdict.ruleId, target.verdict.message)
  const relative = relativeTo(document, target.parentId, absoluteTopLeft, byId)
  const position = { x: snap(relative.x), y: snap(relative.y) }
  if ((node.parentId ?? null) === target.parentId) {
    if (position.x === node.position.x && position.y === node.position.y) return { ok: true, commands: [] }
    return { ok: true, commands: [{ type: 'moveNode', id: nodeId, position }] }
  }
  return { ok: true, commands: [{ type: 'reparentNode', id: nodeId, parentId: target.parentId, position }] }
}

/** Keyboard/inspector re-parent: keep the node where it is on screen when possible. */
export function planReparent(document: ArchGraphV2, nodeId: string, parentId: string | null): Plan {
  const byId = nodeMap(document)
  const node = byId.get(nodeId)
  if (!node) return refuse('CMD-NO-SUCH-NODE', { en: `There is no node ${nodeId}.`, vi: `Không có nút ${nodeId}.` })
  if ((node.parentId ?? null) === parentId) return { ok: true, commands: [] }
  // Into a container: a free spot inside it. To the canvas: where it is now.
  const position = parentId === null ? absolutePosition(document, nodeId, byId) : freeSpot(document, parentId, node.type)
  return { ok: true, commands: [{ type: 'reparentNode', id: nodeId, parentId, position }] }
}

/** Nudge by (dx, dy) px (arrow keys: 8, with Shift 40). */
export function planNudge(document: ArchGraphV2, nodeId: string, dx: number, dy: number): Plan {
  const node = nodeMap(document).get(nodeId)
  if (!node) return refuse('CMD-NO-SUCH-NODE', { en: `There is no node ${nodeId}.`, vi: `Không có nút ${nodeId}.` })
  return { ok: true, commands: [{ type: 'moveNode', id: nodeId, position: { x: node.position.x + dx, y: node.position.y + dy } }] }
}

/** Connect two nodes with the pair defaults (kind, mode, protocol, port, label). */
export function planConnect(document: ArchGraphV2, sourceId: string, targetId: string, language: keyof Bilingual): Plan {
  if (sourceId === targetId) {
    return refuse('CMD-SELF-EDGE', { en: 'A node cannot connect to itself.', vi: 'Một nút không thể kết nối với chính nó.' })
  }
  const defaults = edgeDefaults(document, sourceId, targetId, language)
  const id = nextEdgeId(document)
  return {
    ok: true,
    createdId: id,
    commands: [{ type: 'addEdge', id, source: sourceId, target: targetId, direction: 'forward', ...defaults }],
  }
}

/** Children directly inside a node: decides whether Delete needs the container dialog. */
export function directChildren(document: ArchGraphV2, nodeId: string): string[] {
  return document.nodes.filter((node) => node.parentId === nodeId).map((node) => node.id)
}

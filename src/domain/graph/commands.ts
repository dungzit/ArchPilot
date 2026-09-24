/**
 * The command layer (task 0.3): every edit to a 2.0 design document goes
 * through `applyCommand`. The canvas, the inspector, the keyboard paths, the
 * wizard and (later) the assistant all call it, so a rule is enforced once.
 *
 * Properties the tests hold it to:
 * - pure: the input document is never mutated (deep-frozen inputs work) and
 *   no clock, randomness or locale is read; ids come from the document;
 * - atomic: a refused command returns `{ ok: false }` and no document;
 * - honest refusals: the error code is the catalogue NEST rule id or the
 *   integrity code the backend would use, with VI/EN text for a toast;
 * - never produces an L1 integrity error from a clean document.
 *
 * Undo/redo (zundo, task 2.6) snapshots the documents this returns.
 */
import { catalog, getRole, variantsOf } from './catalog'
import { canNest, depthOf, descendants, nodeMap, subtreeHeight } from './containment'
import { isValidCodeName, toCodeName, uniqueCodeName } from './codeName'
import {
  LIMITS,
  type ArchEdgeV2,
  type ArchGraphV2,
  type ArchNodeV2,
  type Bilingual,
  type ConfigMap,
  type ConfigValue,
  type DeploymentModel,
  type EdgeDirection,
  type EdgeKind,
  type EdgeMode,
  type EdgeProtocol,
  type NodeAttributes,
  type Position,
} from './types'

type Nullable<T> = { [K in keyof T]?: T[K] | null }

export type NodePatch = {
  variant?: string | null
  /** Merged into the node's attributes; `null` removes a key. */
  attributes?: Nullable<NodeAttributes>
  /** Merged into the node's config; `null` removes a key. */
  config?: Record<string, ConfigValue | null>
  rationale?: string | null
  annotation?: ArchNodeV2['annotation'] | null
}

export type EdgePatch = {
  label?: string
  kind?: EdgeKind
  direction?: EdgeDirection
  mode?: EdgeMode | null
  protocol?: EdgeProtocol | null
  port?: number | null
  rationale?: string | null
}

export type Command =
  | { type: 'addNode'; role: string; label: string; position: Position; parentId?: string | null; variant?: string; id?: string; attributes?: NodeAttributes; config?: ConfigMap }
  | { type: 'moveNode'; id: string; position: Position }
  | { type: 'resizeNode'; id: string; size: { width: number; height: number } }
  | { type: 'renameNode'; id: string; label: string }
  | { type: 'setCodeName'; id: string; codeName: string }
  | { type: 'reparentNode'; id: string; parentId: string | null; position: Position }
  | { type: 'updateNode'; id: string; patch: NodePatch }
  | { type: 'removeNode'; id: string; children: 'delete' | 'lift' }
  | { type: 'addEdge'; source: string; target: string; kind: EdgeKind; mode?: EdgeMode; label?: string; direction?: EdgeDirection; protocol?: EdgeProtocol; port?: number; id?: string }
  | { type: 'updateEdge'; id: string; patch: EdgePatch }
  | { type: 'removeEdge'; id: string }
  | { type: 'setBinding'; nodeId: string; target: string; realisation: string | null; config?: ConfigMap }
  | { type: 'setPlacement'; scenarioId: string; nodeId: string; profileId: string | null }

export interface CommandError { code: string; message: Bilingual }

export type CommandResult =
  | { ok: true; document: ArchGraphV2; createdId?: string }
  | { ok: false; error: CommandError }

const ID_PATTERN = /^.{1,64}$/s
const TARGET_PATTERN = /^[a-z][a-z0-9_]{0,23}$/
const REALISATION_PATTERN = /^[a-z0-9_]+\.[a-z0-9_]+$/

function fail(code: string, en: string, vi: string): CommandResult {
  return { ok: false, error: { code, message: { en, vi } } }
}

function done(document: ArchGraphV2, createdId?: string): CommandResult {
  return createdId === undefined ? { ok: true, document } : { ok: true, document, createdId }
}

function noSuchNode(id: string): CommandResult {
  return fail('CMD-NO-SUCH-NODE', `There is no node ${id}.`, `Không có nút ${id}.`)
}

function nextId(taken: Iterable<string>, prefix: 'n' | 'e'): string {
  const ids = new Set(taken)
  let max = 0
  const pattern = new RegExp(`^${prefix}(\\d+)$`)
  for (const id of ids) {
    const match = pattern.exec(id)
    if (match) max = Math.max(max, Number(match[1]))
  }
  let n = max + 1
  while (ids.has(`${prefix}${n}`)) n += 1
  return `${prefix}${n}`
}

/** The next free `nN` id - derived from the document, so it is deterministic. */
export function nextNodeId(document: ArchGraphV2): string {
  return nextId(document.nodes.map((node) => node.id), 'n')
}

export function nextEdgeId(document: ArchGraphV2): string {
  return nextId(document.edges.map((edge) => edge.id), 'e')
}

function checkLabel(label: string): CommandResult | string {
  const trimmed = label.trim()
  if (trimmed.length < 1 || trimmed.length > 120) {
    return fail('CMD-INVALID-LABEL', 'A label needs 1 to 120 characters.', 'Nhãn cần từ 1 đến 120 ký tự.')
  }
  return trimmed
}

function checkPosition(position: Position): CommandResult | null {
  return Number.isFinite(position.x) && Number.isFinite(position.y)
    ? null
    : fail('CMD-INVALID-POSITION', 'A position needs finite x and y.', 'Vị trí cần x và y hữu hạn.')
}

const ATTRIBUTE_DESCRIPTORS = new Map(catalog.attributes.map((descriptor) => [descriptor.key, descriptor]))

function checkAttributes(attributes: Nullable<NodeAttributes>): CommandResult | null {
  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === undefined) continue
    const descriptor = ATTRIBUTE_DESCRIPTORS.get(key)
    const bad = () => fail('CMD-INVALID-ATTRIBUTE', `${key} cannot be ${JSON.stringify(value)}.`, `${key} không thể là ${JSON.stringify(value)}.`)
    if (!descriptor) return bad()
    if (descriptor.kind === 'enum' && !(descriptor.values ?? []).includes(String(value))) return bad()
    if (descriptor.kind === 'int' && (!Number.isInteger(value) || (value as number) < (descriptor.min ?? -Infinity) || (value as number) > (descriptor.max ?? Infinity))) return bad()
    if (descriptor.kind === 'text' && (typeof value !== 'string' || value.length > (descriptor.maxLength ?? 2000) || (key === 'failureDomainLabel' && value.length === 0))) return bad()
  }
  return null
}

function mergeNullable<T extends object>(base: T | undefined, patch: Record<string, unknown>): T | undefined {
  const merged: Record<string, unknown> = { ...(base ?? {}) }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete merged[key]
    else if (value !== undefined) merged[key] = value
  }
  return Object.keys(merged).length > 0 ? (merged as T) : undefined
}

function withOptional<T extends object, K extends keyof T>(object: T, key: K, value: T[K] | undefined): T {
  const copy = { ...object }
  if (value === undefined) delete copy[key]
  else copy[key] = value
  return copy
}

function replaceNode(document: ArchGraphV2, id: string, update: (node: ArchNodeV2) => ArchNodeV2): ArchGraphV2 {
  return { ...document, nodes: document.nodes.map((node) => (node.id === id ? update(node) : node)) }
}

/** Apply one command. Never mutates `document`. */
export function applyCommand(document: ArchGraphV2, command: Command): CommandResult {
  switch (command.type) {
    case 'addNode':
      return addNode(document, command)
    case 'moveNode': {
      if (!nodeMap(document).has(command.id)) return noSuchNode(command.id)
      const invalid = checkPosition(command.position)
      if (invalid) return invalid
      return done(replaceNode(document, command.id, (node) => ({ ...node, position: { x: command.position.x, y: command.position.y } })))
    }
    case 'resizeNode': {
      if (!nodeMap(document).has(command.id)) return noSuchNode(command.id)
      const { width, height } = command.size
      if (!(width > 0 && height > 0 && width <= 100000 && height <= 100000)) {
        return fail('CMD-INVALID-SIZE', 'Width and height must be between 0 and 100000.', 'Chiều rộng và cao phải trong khoảng 0 đến 100000.')
      }
      return done(replaceNode(document, command.id, (node) => ({ ...node, size: { width, height } })))
    }
    case 'renameNode': {
      if (!nodeMap(document).has(command.id)) return noSuchNode(command.id)
      const label = checkLabel(command.label)
      if (typeof label !== 'string') return label
      // REQ-DES-008 / NFR2-DET-003: the code name deliberately does NOT follow the label.
      return done(replaceNode(document, command.id, (node) => ({ ...node, label })))
    }
    case 'setCodeName':
      return setCodeName(document, command.id, command.codeName)
    case 'reparentNode':
      return reparentNode(document, command.id, command.parentId, command.position)
    case 'updateNode':
      return updateNode(document, command.id, command.patch)
    case 'removeNode':
      return removeNode(document, command.id, command.children)
    case 'addEdge':
      return addEdge(document, command)
    case 'updateEdge':
      return updateEdge(document, command.id, command.patch)
    case 'removeEdge': {
      if (!document.edges.some((edge) => edge.id === command.id)) {
        return fail('CMD-NO-SUCH-EDGE', `There is no edge ${command.id}.`, `Không có cạnh ${command.id}.`)
      }
      return done({ ...document, edges: document.edges.filter((edge) => edge.id !== command.id) })
    }
    case 'setBinding':
      return setBinding(document, command.nodeId, command.target, command.realisation, command.config)
    case 'setPlacement':
      return setPlacement(document, command.scenarioId, command.nodeId, command.profileId)
  }
}

/** Apply commands in order; all or nothing. */
export function applyCommands(document: ArchGraphV2, commands: Command[]): CommandResult {
  let current = document
  for (const command of commands) {
    const result = applyCommand(current, command)
    if (!result.ok) return result
    current = result.document
  }
  return done(current)
}

// ---------------------------------------------------------------- nodes

function addNode(document: ArchGraphV2, command: Extract<Command, { type: 'addNode' }>): CommandResult {
  if (document.nodes.length >= LIMITS.nodes) {
    return fail('CMD-LIMIT', `A design holds at most ${LIMITS.nodes} nodes.`, `Một thiết kế chứa tối đa ${LIMITS.nodes} nút.`)
  }
  const role = getRole(command.role)
  if (!role) return fail('INT-UNKNOWN-ROLE', `${command.role} is not a catalogue role.`, `${command.role} không có trong danh mục.`)
  if (command.variant !== undefined && !variantsOf(role.id).includes(command.variant)) {
    return fail('INT-UNKNOWN-VARIANT', `${command.variant} is not a variant of ${role.id}.`, `${command.variant} không phải biến thể của ${role.id}.`)
  }
  const label = checkLabel(command.label)
  if (typeof label !== 'string') return label
  const invalid = checkPosition(command.position) ?? (command.attributes ? checkAttributes(command.attributes) : null)
  if (invalid) return invalid
  const byId = nodeMap(document)
  const id = command.id ?? nextNodeId(document)
  if (!ID_PATTERN.test(id) || byId.has(id)) {
    return fail('CMD-DUPLICATE-ID', `The id ${id} is taken or invalid.`, `Mã ${id} đã tồn tại hoặc không hợp lệ.`)
  }
  const parentId = command.parentId ?? null
  const parent = parentId === null ? undefined : byId.get(parentId)
  if (parentId !== null && !parent) return noSuchNode(parentId)
  const verdict = canNest(role.id, parent ? parent.type : null)
  if (!verdict.ok) return { ok: false, error: { code: verdict.ruleId, message: verdict.message } }
  const depth = parent ? depthOf(document, parent.id, byId) + 1 : 1
  if (depth > catalog.limits.maxNestingDepth) {
    return fail('INT-DEPTH', `That would nest ${depth} levels deep; the limit is ${catalog.limits.maxNestingDepth}.`, `Như vậy sẽ lồng sâu ${depth} cấp; giới hạn là ${catalog.limits.maxNestingDepth}.`)
  }
  const codeName = uniqueCodeName(toCodeName(label, role.id), new Set(document.nodes.map((node) => node.codeName)))
  let node: ArchNodeV2 = {
    id,
    type: role.id,
    ...(command.variant !== undefined ? { variant: command.variant } : {}),
    label,
    codeName,
    position: { x: command.position.x, y: command.position.y },
    ...(parent ? { parentId: parent.id } : {}),
  }
  node = withOptional(node, 'attributes', command.attributes ? mergeNullable<NodeAttributes>(undefined, command.attributes as Record<string, unknown>) : undefined)
  node = withOptional(node, 'config', command.config && Object.keys(command.config).length > 0 ? { ...command.config } : undefined)
  return done({ ...document, nodes: [...document.nodes, node] }, id)
}

function setCodeName(document: ArchGraphV2, id: string, codeName: string): CommandResult {
  const node = nodeMap(document).get(id)
  if (!node) return noSuchNode(id)
  if (!isValidCodeName(codeName)) {
    return fail('CMD-INVALID-CODENAME', 'A code name is lower-case letters, digits and _, starting with a letter, at most 40 characters.', 'Tên mã gồm chữ thường, chữ số và _, bắt đầu bằng chữ cái, tối đa 40 ký tự.')
  }
  if (document.nodes.some((other) => other.id !== id && other.codeName === codeName)) {
    return fail('INT-DUPLICATE-CODENAME', `${codeName} is used by another node.`, `${codeName} đã được nút khác dùng.`)
  }
  return done(replaceNode(document, id, (current) => ({ ...current, codeName })))
}

function reparentNode(document: ArchGraphV2, id: string, parentId: string | null, position: Position): CommandResult {
  const byId = nodeMap(document)
  const node = byId.get(id)
  if (!node) return noSuchNode(id)
  const invalid = checkPosition(position)
  if (invalid) return invalid
  const parent = parentId === null ? undefined : byId.get(parentId)
  if (parentId !== null && !parent) return noSuchNode(parentId)
  if (parentId !== null && (parentId === id || descendants(document, id).includes(parentId))) {
    return fail('INT-PARENT-CYCLE', 'A container cannot go inside itself or one of its own children.', 'Không thể đặt vùng chứa vào chính nó hoặc vào con của nó.')
  }
  const verdict = canNest(node.type, parent ? parent.type : null)
  if (!verdict.ok) return { ok: false, error: { code: verdict.ruleId, message: verdict.message } }
  const deepest = (parent ? depthOf(document, parent.id, byId) : 0) + subtreeHeight(document, id)
  if (deepest > catalog.limits.maxNestingDepth) {
    return fail('INT-DEPTH', `That would nest ${deepest} levels deep; the limit is ${catalog.limits.maxNestingDepth}.`, `Như vậy sẽ lồng sâu ${deepest} cấp; giới hạn là ${catalog.limits.maxNestingDepth}.`)
  }
  return done(replaceNode(document, id, (current) => withOptional({ ...current, position: { x: position.x, y: position.y } }, 'parentId', parent?.id)))
}

function updateNode(document: ArchGraphV2, id: string, patch: NodePatch): CommandResult {
  const node = nodeMap(document).get(id)
  if (!node) return noSuchNode(id)
  if (patch.variant !== undefined && patch.variant !== null && !variantsOf(node.type).includes(patch.variant)) {
    return fail('INT-UNKNOWN-VARIANT', `${patch.variant} is not a variant of ${node.type}.`, `${patch.variant} không phải biến thể của ${node.type}.`)
  }
  if (patch.attributes) {
    const invalid = checkAttributes(patch.attributes)
    if (invalid) return invalid
  }
  let next: ArchNodeV2 = { ...node }
  if (patch.variant !== undefined) next = withOptional(next, 'variant', patch.variant ?? undefined)
  if (patch.attributes) next = withOptional(next, 'attributes', mergeNullable<NodeAttributes>(node.attributes, patch.attributes as Record<string, unknown>))
  if (patch.config) next = withOptional(next, 'config', mergeNullable<ConfigMap>(node.config, patch.config))
  if (patch.rationale !== undefined) next = withOptional(next, 'rationale', patch.rationale === null || patch.rationale === '' ? undefined : patch.rationale)
  if (patch.annotation !== undefined) next = withOptional(next, 'annotation', patch.annotation ?? undefined)
  return done(replaceNode(document, id, () => next))
}

/**
 * Remove a node. `delete` removes its whole subtree; `lift` moves its direct
 * children up to its own parent (positions shifted so they stay put on the
 * canvas) and is refused if a child may not live there. Either way, every
 * reference to a removed node goes too: edges, bindings, placements, ADR links
 * and wizard-suggestion links - so the result is still integrity-clean.
 */
function removeNode(document: ArchGraphV2, id: string, children: 'delete' | 'lift'): CommandResult {
  const byId = nodeMap(document)
  const node = byId.get(id)
  if (!node) return noSuchNode(id)
  const removed = new Set(children === 'delete' ? [id, ...descendants(document, id)] : [id])
  let nodes = document.nodes.filter((candidate) => !removed.has(candidate.id))

  if (children === 'lift') {
    const newParent = node.parentId !== undefined ? byId.get(node.parentId) : undefined
    for (const child of nodes.filter((candidate) => candidate.parentId === id)) {
      const verdict = canNest(child.type, newParent ? newParent.type : null)
      if (!verdict.ok) return { ok: false, error: { code: verdict.ruleId, message: verdict.message } }
    }
    nodes = nodes.map((candidate) =>
      candidate.parentId !== id
        ? candidate
        : withOptional(
            { ...candidate, position: { x: candidate.position.x + node.position.x, y: candidate.position.y + node.position.y } },
            'parentId',
            newParent?.id,
          ),
    )
  }

  const keepId = (nodeId: string) => !removed.has(nodeId)
  let next: ArchGraphV2 = { ...document, nodes, edges: document.edges.filter((edge) => keepId(edge.source) && keepId(edge.target)) }
  if (document.deployment) {
    const deployment: DeploymentModel = {
      ...document.deployment,
      scenarios: document.deployment.scenarios.map((scenario) =>
        scenario.placements === undefined ? scenario : withOptional(scenario, 'placements', scenario.placements.filter((placement) => keepId(placement.nodeId))),
      ),
    }
    if (document.deployment.bindings) deployment.bindings = document.deployment.bindings.filter((binding) => keepId(binding.nodeId))
    next = { ...next, deployment }
  }
  if (document.decisions) {
    next = {
      ...next,
      decisions: document.decisions.map((record) =>
        record.linkedNodeIds === undefined ? record : { ...record, linkedNodeIds: record.linkedNodeIds.filter(keepId) },
      ),
    }
  }
  if (document.brief?.suggestions) {
    next = {
      ...next,
      brief: {
        ...document.brief,
        suggestions: document.brief.suggestions.map((suggestion) =>
          suggestion.nodeId !== undefined && removed.has(suggestion.nodeId) ? withOptional(suggestion, 'nodeId', undefined) : suggestion,
        ),
      },
    }
  }
  return done(next)
}

// ---------------------------------------------------------------- edges

function addEdge(document: ArchGraphV2, command: Extract<Command, { type: 'addEdge' }>): CommandResult {
  if (document.edges.length >= LIMITS.edges) {
    return fail('CMD-LIMIT', `A design holds at most ${LIMITS.edges} edges.`, `Một thiết kế chứa tối đa ${LIMITS.edges} cạnh.`)
  }
  const byId = nodeMap(document)
  if (!byId.has(command.source)) return noSuchNode(command.source)
  if (!byId.has(command.target)) return noSuchNode(command.target)
  const label = (command.label ?? '').trim()
  if (label.length > 120) return fail('CMD-INVALID-LABEL', 'An edge label has at most 120 characters.', 'Nhãn cạnh tối đa 120 ký tự.')
  if (command.port !== undefined && !(Number.isInteger(command.port) && command.port >= 1 && command.port <= 65535)) {
    return fail('CMD-INVALID-PORT', 'A port is a whole number from 1 to 65535.', 'Cổng là số nguyên từ 1 đến 65535.')
  }
  const duplicate = document.edges.some(
    (edge) => edge.source === command.source && edge.target === command.target && edge.kind === command.kind && edge.mode === command.mode,
  )
  if (duplicate) return fail('CMD-DUPLICATE-EDGE', 'That connection already exists.', 'Kết nối này đã tồn tại.')
  const id = command.id ?? nextEdgeId(document)
  if (!ID_PATTERN.test(id) || document.edges.some((edge) => edge.id === id)) {
    return fail('CMD-DUPLICATE-ID', `The id ${id} is taken or invalid.`, `Mã ${id} đã tồn tại hoặc không hợp lệ.`)
  }
  let edge: ArchEdgeV2 = { id, source: command.source, target: command.target, label, direction: command.direction ?? 'forward', kind: command.kind }
  edge = withOptional(edge, 'mode', command.mode)
  edge = withOptional(edge, 'protocol', command.protocol)
  edge = withOptional(edge, 'port', command.port)
  return done({ ...document, edges: [...document.edges, edge] }, id)
}

function updateEdge(document: ArchGraphV2, id: string, patch: EdgePatch): CommandResult {
  const edge = document.edges.find((candidate) => candidate.id === id)
  if (!edge) return fail('CMD-NO-SUCH-EDGE', `There is no edge ${id}.`, `Không có cạnh ${id}.`)
  if (patch.label !== undefined && patch.label.trim().length > 120) {
    return fail('CMD-INVALID-LABEL', 'An edge label has at most 120 characters.', 'Nhãn cạnh tối đa 120 ký tự.')
  }
  if (patch.port !== undefined && patch.port !== null && !(Number.isInteger(patch.port) && patch.port >= 1 && patch.port <= 65535)) {
    return fail('CMD-INVALID-PORT', 'A port is a whole number from 1 to 65535.', 'Cổng là số nguyên từ 1 đến 65535.')
  }
  let next: ArchEdgeV2 = { ...edge }
  if (patch.label !== undefined) next.label = patch.label.trim()
  if (patch.kind !== undefined) next.kind = patch.kind
  if (patch.direction !== undefined) next.direction = patch.direction
  if (patch.mode !== undefined) next = withOptional(next, 'mode', patch.mode ?? undefined)
  if (patch.protocol !== undefined) next = withOptional(next, 'protocol', patch.protocol ?? undefined)
  if (patch.port !== undefined) next = withOptional(next, 'port', patch.port ?? undefined)
  if (patch.rationale !== undefined) next = withOptional(next, 'rationale', patch.rationale === null || patch.rationale === '' ? undefined : patch.rationale)
  return done({ ...document, edges: document.edges.map((candidate) => (candidate.id === id ? next : candidate)) })
}

// ---------------------------------------------------------------- deployment layer

function emptyDeployment(): DeploymentModel {
  return { profiles: [], scenarios: [] }
}

/**
 * Choose (or clear, with `null`) a node's realisation on one target. Bindings
 * for other targets are untouched: re-targeting away and back is lossless
 * (REQ-TGT-005).
 */
function setBinding(document: ArchGraphV2, nodeId: string, target: string, realisation: string | null, config?: ConfigMap): CommandResult {
  if (!nodeMap(document).has(nodeId)) return noSuchNode(nodeId)
  if (!TARGET_PATTERN.test(target)) return fail('CMD-INVALID-TARGET', `${target} is not a target id.`, `${target} không phải mã đích.`)
  if (realisation !== null && !REALISATION_PATTERN.test(realisation)) {
    return fail('CMD-INVALID-REALISATION', `${realisation} is not a realisation id (<target>.<name>).`, `${realisation} không phải mã hiện thực (<đích>.<tên>).`)
  }
  const deployment = document.deployment ?? emptyDeployment()
  const others = (deployment.bindings ?? []).filter((binding) => !(binding.nodeId === nodeId && binding.target === target))
  if (realisation !== null && others.length >= LIMITS.bindings) {
    return fail('CMD-LIMIT', `A design holds at most ${LIMITS.bindings} bindings.`, `Một thiết kế chứa tối đa ${LIMITS.bindings} liên kết hiện thực.`)
  }
  const existingIndex = (deployment.bindings ?? []).findIndex((binding) => binding.nodeId === nodeId && binding.target === target)
  let bindings = others
  if (realisation !== null) {
    const binding = { nodeId, target, realisation, ...(config && Object.keys(config).length > 0 ? { config: { ...config } } : {}) }
    // Keep the binding where it was, so a re-choice does not reorder the document.
    bindings = existingIndex >= 0
      ? (deployment.bindings ?? []).map((candidate, index) => (index === existingIndex ? binding : candidate))
      : [...others, binding]
  }
  return done({ ...document, deployment: withOptional({ ...deployment }, 'bindings', bindings.length > 0 ? bindings : undefined) })
}

/** Per-node profile override in one scenario (hybrid). `null`, or the default profile, clears it. */
function setPlacement(document: ArchGraphV2, scenarioId: string, nodeId: string, profileId: string | null): CommandResult {
  const deployment = document.deployment
  const scenario = deployment?.scenarios.find((candidate) => candidate.id === scenarioId)
  if (!deployment || !scenario) return fail('CMD-NO-SUCH-SCENARIO', `There is no scenario ${scenarioId}.`, `Không có kịch bản ${scenarioId}.`)
  if (!nodeMap(document).has(nodeId)) return noSuchNode(nodeId)
  if (profileId !== null && !deployment.profiles.some((profile) => profile.id === profileId)) {
    return fail('INT-UNKNOWN-PROFILE', `${profileId} is not a profile in this design.`, `${profileId} không phải hồ sơ đích của thiết kế này.`)
  }
  const others = (scenario.placements ?? []).filter((placement) => placement.nodeId !== nodeId)
  const placements = profileId === null || profileId === scenario.defaultProfileId ? others : [...others, { nodeId, profileId }]
  const nextScenario = withOptional({ ...scenario }, 'placements', placements.length > 0 ? placements : undefined)
  return done({
    ...document,
    deployment: { ...deployment, scenarios: deployment.scenarios.map((candidate) => (candidate.id === scenarioId ? nextScenario : candidate)) },
  })
}

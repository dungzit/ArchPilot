/**
 * validateGraph() (task 0.3; design-v2 4.3.3 layers L1 and L2).
 *
 * L1 - integrity, severity `error`. The SAME rules, codes, paths and order as
 * `backend/app/graph_integrity.py`; the server refuses to save a document with
 * any of them (422). The shared manifest `contracts/fixtures/index.json`
 * (`integrityRules`, `integrityCases`) is run against both implementations.
 *
 * L2 - design rules, severity `warning` / `info`. TypeScript only; they never
 * block a save (REQ-DES-011):
 *   NEST-xx     containment rule from the catalogue (REQ-DES-004)
 *   DES-W01     orphan: a code-bearing, non-container node with no edges
 *   DES-W03     replicas >= 2 but no failure-domain level (design-v2 4.3.3)
 *   DES-W04     stateful or high-criticality node with a single replica (REQ-DES-026)
 *   DES-W05     access edge mode the source cannot use or the target does not accept
 *   DES-W06     an annotation takes part in an access edge
 *   DES-I01     edge without a label (1.0 contract: "a warning, not a contract violation")
 *
 * Pure and deterministic: same document, same problems, same order.
 */
import { catalog, canonicalFor, describeRoleRef, getRole, isRole, variantsOf } from './catalog'
import { canNest, effectiveFailureDomain } from './containment'
import type { ArchGraph, ArchGraphV2, ArchNodeV2, Bilingual, Problem } from './types'

export const INTEGRITY_RULES = [
  'INT-DUPLICATE-NODE-ID',
  'INT-DUPLICATE-EDGE-ID',
  'INT-DANGLING-EDGE',
  'INT-DUPLICATE-CODENAME',
  'INT-DANGLING-PARENT',
  'INT-PARENT-CYCLE',
  'INT-DEPTH',
  'INT-UNKNOWN-ROLE',
  'INT-UNKNOWN-VARIANT',
  'INT-DUPLICATE-PROFILE-ID',
  'INT-DUPLICATE-SCENARIO-ID',
  'INT-UNKNOWN-PROFILE',
  'INT-UNKNOWN-SCENARIO',
  'INT-DANGLING-BINDING',
  'INT-DUPLICATE-BINDING',
  'INT-DANGLING-PLACEMENT',
  'INT-DUPLICATE-PLACEMENT',
  'INT-DUPLICATE-DECISION-ID',
  'INT-DANGLING-DECISION-REF',
] as const

export type IntegrityRule = (typeof INTEGRITY_RULES)[number]

const MAX_VALUE_CHARS = 64

/** Python's repr() of a short string, truncated the same way graph_integrity._show does. */
function show(value: unknown): string {
  const text = typeof value === 'string' ? `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'` : String(value)
  return text.length <= MAX_VALUE_CHARS ? text : `${text.slice(0, MAX_VALUE_CHARS - 3)}...`
}

function error(ruleId: IntegrityRule, path: string, en: string, vi: string, extra: Partial<Problem> = {}): Problem {
  return { severity: 'error', ruleId, path, message: { en, vi }, ...extra }
}

function duplicates<T>(keys: T[]): { index: number; key: T }[] {
  const seen = new Set<string>()
  const out: { index: number; key: T }[] = []
  keys.forEach((key, index) => {
    const token = JSON.stringify(key)
    if (seen.has(token)) out.push({ index, key })
    else seen.add(token)
  })
  return out
}

/** Every problem in `document`: L1 errors first (backend order), then L2 findings. */
export function validateGraph(document: ArchGraph): Problem[] {
  const problems = integrityProblems(document)
  if (document.schemaVersion === '2.0') problems.push(...designProblems(document))
  return problems
}

/** Only the L1 errors - exactly what the backend would refuse. */
export function integrityErrors(document: ArchGraph): Problem[] {
  return integrityProblems(document)
}

export function isSaveable(document: ArchGraph): boolean {
  return integrityProblems(document).length === 0
}

// ================================================================ L1 integrity

function integrityProblems(document: ArchGraph): Problem[] {
  const nodes = document.nodes as { id: string; parentId?: string }[]
  const edges = document.edges
  const out: Problem[] = []

  for (const { index, key } of duplicates(nodes.map((node) => node.id))) {
    out.push(error('INT-DUPLICATE-NODE-ID', `nodes[${index}].id`, `${show(key)} is used by another node`, `${show(key)} đã được nút khác dùng`, { nodeId: key }))
  }
  for (const { index, key } of duplicates(edges.map((edge) => edge.id))) {
    out.push(error('INT-DUPLICATE-EDGE-ID', `edges[${index}].id`, `${show(key)} is used by another edge`, `${show(key)} đã được cạnh khác dùng`, { edgeId: key }))
  }
  const nodeIds = new Set(nodes.map((node) => node.id))
  edges.forEach((edge, index) => {
    for (const end of ['source', 'target'] as const) {
      if (!nodeIds.has(edge[end])) {
        out.push(error('INT-DANGLING-EDGE', `edges[${index}].${end}`, `${show(edge[end])} is not a node id`, `${show(edge[end])} không phải mã của nút nào`, { edgeId: edge.id }))
      }
    }
  })
  if (document.schemaVersion !== '2.0') return out

  const v2 = document
  for (const { index, key } of duplicates(v2.nodes.map((node) => node.codeName))) {
    out.push(error('INT-DUPLICATE-CODENAME', `nodes[${index}].codeName`, `${show(key)} is used by another node`, `${show(key)} đã được nút khác dùng`, { nodeId: v2.nodes[index].id }))
  }
  v2.nodes.forEach((node, index) => {
    if (!isRole(node.type)) {
      const canonical = canonicalFor(node.type)
      const hintEn = canonical ? `; use ${show(describeRoleRef(canonical))}` : ''
      const hintVi = canonical ? `; hãy dùng ${show(describeRoleRef(canonical))}` : ''
      out.push(error(
        'INT-UNKNOWN-ROLE', `nodes[${index}].type`,
        `${show(node.type)} is not a role in component catalogue ${catalog.version}${hintEn}`,
        `${show(node.type)} không có trong danh mục thành phần ${catalog.version}${hintVi}`,
        { nodeId: node.id },
      ))
    } else if (node.variant !== undefined && !variantsOf(node.type).includes(node.variant)) {
      const allowed = [...variantsOf(node.type)].sort().join(', ') || 'none'
      out.push(error(
        'INT-UNKNOWN-VARIANT', `nodes[${index}].variant`,
        `${show(node.variant)} is not a variant of ${node.type} (allowed: ${allowed})`,
        `${show(node.variant)} không phải biến thể của ${node.type} (cho phép: ${allowed})`,
        { nodeId: node.id },
      ))
    }
  })
  out.push(...containmentProblems(v2))
  out.push(...deploymentProblems(v2, nodeIds))
  out.push(...decisionProblems(v2, nodeIds))
  return out
}

function containmentProblems(document: ArchGraphV2): Problem[] {
  const out: Problem[] = []
  const indexOf = new Map<string, number>()
  const parentOf = new Map<string, string>()
  document.nodes.forEach((node, index) => {
    if (indexOf.has(node.id)) return
    indexOf.set(node.id, index)
    if (node.parentId !== undefined) {
      parentOf.set(node.id, node.parentId)
      if (!document.nodes.some((candidate) => candidate.id === node.parentId)) {
        out.push(error('INT-DANGLING-PARENT', `nodes[${index}].parentId`, `${show(node.parentId)} is not a node id`, `${show(node.parentId)} không phải mã của nút nào`, { nodeId: node.id }))
      }
    }
  })

  // Same walk as graph_integrity._check_containment: depth 1 at the top (or
  // below a missing parent), null on or below a loop.
  const depth = new Map<string, number | null>()
  for (const startId of indexOf.keys()) {
    let path: string[] = []
    let current = startId
    let base: number | null
    for (;;) {
      if (depth.has(current)) {
        base = depth.get(current) ?? null
        break
      }
      const loopStart = path.indexOf(current)
      if (loopStart >= 0) {
        const cycle = path.slice(loopStart)
        out.push(cycleProblem(cycle, indexOf))
        for (const member of cycle) depth.set(member, null)
        path = path.slice(0, loopStart)
        base = null
        break
      }
      path.push(current)
      const parent = parentOf.get(current)
      if (parent === undefined || !indexOf.has(parent)) {
        depth.set(current, 1)
        path.pop()
        base = 1
        break
      }
      current = parent
    }
    for (const item of [...path].reverse()) {
      base = base === null ? null : base + 1
      depth.set(item, base)
    }
  }

  const max = catalog.limits.maxNestingDepth
  for (const [nodeId, index] of indexOf) {
    const level = depth.get(nodeId)
    if (level !== null && level !== undefined && level === max + 1) {
      out.push(error('INT-DEPTH', `nodes[${index}].parentId`, `${show(nodeId)} is nested ${level} levels deep; the limit is ${max}`, `${show(nodeId)} lồng sâu ${level} cấp; giới hạn là ${max}`, { nodeId }))
    }
  }
  return out
}

function cycleProblem(cycle: string[], indexOf: Map<string, number>): Problem {
  const first = cycle.reduce((best, id) => (indexOf.get(id)! < indexOf.get(best)! ? id : best))
  const start = cycle.indexOf(first)
  const loop = [...cycle.slice(start), ...cycle.slice(0, start), first].join(' -> ')
  return error('INT-PARENT-CYCLE', `nodes[${indexOf.get(first)}].parentId`, `containment loop ${loop}`, `vòng lặp chứa ${loop}`, { nodeId: first })
}

function deploymentProblems(document: ArchGraphV2, nodeIds: Set<string>): Problem[] {
  const deployment = document.deployment
  if (!deployment) return []
  const out: Problem[] = []
  const profiles = deployment.profiles ?? []
  const scenarios = deployment.scenarios ?? []
  const bindings = deployment.bindings ?? []

  for (const { index, key } of duplicates(profiles.map((profile) => profile.id))) {
    out.push(error('INT-DUPLICATE-PROFILE-ID', `deployment.profiles[${index}].id`, `${show(key)} is used twice`, `${show(key)} bị dùng hai lần`))
  }
  for (const { index, key } of duplicates(scenarios.map((scenario) => scenario.id))) {
    out.push(error('INT-DUPLICATE-SCENARIO-ID', `deployment.scenarios[${index}].id`, `${show(key)} is used twice`, `${show(key)} bị dùng hai lần`))
  }
  const profileIds = new Set(profiles.map((profile) => profile.id))
  const scenarioIds = new Set(scenarios.map((scenario) => scenario.id))

  scenarios.forEach((scenario, sIndex) => {
    const where = `deployment.scenarios[${sIndex}]`
    if (!profileIds.has(scenario.defaultProfileId)) {
      out.push(error('INT-UNKNOWN-PROFILE', `${where}.defaultProfileId`, `${show(scenario.defaultProfileId)} is not a profile id`, `${show(scenario.defaultProfileId)} không phải hồ sơ đích nào`))
    }
    const placements = scenario.placements ?? []
    placements.forEach((placement, pIndex) => {
      if (!nodeIds.has(placement.nodeId)) {
        out.push(error('INT-DANGLING-PLACEMENT', `${where}.placements[${pIndex}].nodeId`, `${show(placement.nodeId)} is not a node id`, `${show(placement.nodeId)} không phải mã của nút nào`))
      }
      if (!profileIds.has(placement.profileId)) {
        out.push(error('INT-UNKNOWN-PROFILE', `${where}.placements[${pIndex}].profileId`, `${show(placement.profileId)} is not a profile id`, `${show(placement.profileId)} không phải hồ sơ đích nào`))
      }
    })
    for (const { index, key } of duplicates(placements.map((placement) => placement.nodeId))) {
      out.push(error('INT-DUPLICATE-PLACEMENT', `${where}.placements[${index}].nodeId`, `${show(key)} is placed twice in this scenario`, `${show(key)} được đặt hai lần trong kịch bản này`, { nodeId: key }))
    }
  })

  if (deployment.activeScenarioId !== undefined && !scenarioIds.has(deployment.activeScenarioId)) {
    out.push(error('INT-UNKNOWN-SCENARIO', 'deployment.activeScenarioId', `${show(deployment.activeScenarioId)} is not a scenario id`, `${show(deployment.activeScenarioId)} không phải kịch bản nào`))
  }
  bindings.forEach((binding, index) => {
    if (!nodeIds.has(binding.nodeId)) {
      out.push(error('INT-DANGLING-BINDING', `deployment.bindings[${index}].nodeId`, `${show(binding.nodeId)} is not a node id`, `${show(binding.nodeId)} không phải mã của nút nào`))
    }
  })
  for (const { index, key } of duplicates(bindings.map((binding) => [binding.nodeId, binding.target]))) {
    out.push(error('INT-DUPLICATE-BINDING', `deployment.bindings[${index}]`, `node ${show(key[0])} already has a binding for target ${show(key[1])}`, `nút ${show(key[0])} đã có hiện thực cho đích ${show(key[1])}`, { nodeId: key[0] }))
  }
  return out
}

function decisionProblems(document: ArchGraphV2, nodeIds: Set<string>): Problem[] {
  const records = document.decisions ?? []
  const out: Problem[] = []
  for (const { index, key } of duplicates(records.map((record) => record.id))) {
    out.push(error('INT-DUPLICATE-DECISION-ID', `decisions[${index}].id`, `${show(key)} is used twice`, `${show(key)} bị dùng hai lần`))
  }
  const decisionIds = new Set(records.map((record) => record.id))
  records.forEach((record, index) => {
    ;(record.linkedNodeIds ?? []).forEach((nodeId, lIndex) => {
      if (!nodeIds.has(nodeId)) {
        out.push(error('INT-DANGLING-DECISION-REF', `decisions[${index}].linkedNodeIds[${lIndex}]`, `${show(nodeId)} is not a node id`, `${show(nodeId)} không phải mã của nút nào`))
      }
    })
    if (record.supersedes !== undefined && !decisionIds.has(record.supersedes)) {
      out.push(error('INT-DANGLING-DECISION-REF', `decisions[${index}].supersedes`, `${show(record.supersedes)} is not a decision id`, `${show(record.supersedes)} không phải quyết định nào`))
    }
  })
  return out
}

// ================================================================ L2 design rules

/** Roles that may go anywhere (NEST-08): note, shape, text. They never take part in access. */
const ANNOTATION_ROLES = new Set(
  catalog.nestRules.filter((rule) => rule.kind === 'child' && (rule.parents ?? []).includes('*')).flatMap((rule) => rule.roles),
)

function finding(severity: 'warning' | 'info', ruleId: string, path: string, message: Bilingual, extra: Partial<Problem>): Problem {
  return { severity, ruleId, path, message, ...extra }
}

function designProblems(document: ArchGraphV2): Problem[] {
  const out: Problem[] = []
  const byId = new Map<string, ArchNodeV2>()
  for (const node of document.nodes) if (!byId.has(node.id)) byId.set(node.id, node)
  const connected = new Set<string>()
  for (const edge of document.edges) {
    connected.add(edge.source)
    connected.add(edge.target)
  }

  document.nodes.forEach((node, index) => {
    const role = getRole(node.type)
    if (!role || byId.get(node.id) !== node) return // unknown role / duplicate id: already an L1 error
    const path = `nodes[${index}]`

    const parent = node.parentId !== undefined ? byId.get(node.parentId) : undefined
    if (node.parentId === undefined || parent) {
      const verdict = canNest(node.type, parent ? parent.type : null)
      if (!verdict.ok) out.push(finding('warning', verdict.ruleId, `${path}.parentId`, verdict.message, { nodeId: node.id }))
    }

    if (role.codeBearing && !role.container && !connected.has(node.id)) {
      out.push(finding('warning', 'DES-W01', path, {
        en: `${node.label} is not connected to anything.`,
        vi: `${node.label} chưa được kết nối với thành phần nào.`,
      }, { nodeId: node.id }))
    }

    const replicas = node.attributes?.replicas ?? role.defaultAttributes.replicas ?? 1
    const domain = effectiveFailureDomain(document, node.id)
    if (replicas >= 2 && !domain.level) {
      out.push(finding('warning', 'DES-W03', `${path}.attributes.failureDomainLevel`, {
        en: `${node.label} has ${replicas} replicas but no failure-domain level, so nothing says what they are spread across.`,
        vi: `${node.label} có ${replicas} bản sao nhưng chưa có mức miền lỗi, nên không rõ các bản sao được phân tán theo cấp nào.`,
      }, { nodeId: node.id }))
    }
    const stateful = (node.attributes?.statefulness ?? role.defaultAttributes.statefulness) === 'stateful'
    const critical = (node.attributes?.criticality ?? role.defaultAttributes.criticality) === 'high'
    if ((stateful || critical) && role.codeBearing && !role.container && replicas < 2) {
      out.push(finding('warning', 'DES-W04', `${path}.attributes.replicas`, {
        en: `${node.label} is ${stateful ? 'stateful' : 'high-criticality'} and has a single replica: a single point of failure.`,
        vi: `${node.label} ${stateful ? 'có trạng thái' : 'có mức quan trọng cao'} và chỉ có một bản sao: điểm lỗi đơn.`,
      }, { nodeId: node.id }))
    }
  })

  document.edges.forEach((edge, index) => {
    const path = `edges[${index}]`
    const source = byId.get(edge.source)
    const target = byId.get(edge.target)
    const sourceRole = source ? getRole(source.type) : undefined
    const targetRole = target ? getRole(target.type) : undefined
    if (edge.kind === 'access' && sourceRole && targetRole) {
      const annotation = [sourceRole, targetRole].find((role) => ANNOTATION_ROLES.has(role.id))
      if (annotation) {
        out.push(finding('warning', 'DES-W06', `${path}.kind`, {
          en: `An annotation (${annotation.label.en}) cannot take part in an access edge; use a flow edge.`,
          vi: `Chú thích (${annotation.label.vi}) không thể tham gia cạnh truy cập; hãy dùng cạnh luồng.`,
        }, { edgeId: edge.id }))
      } else if (edge.mode && (!sourceRole.accessModes.asSource.includes(edge.mode) || !targetRole.accessModes.asTarget.includes(edge.mode))) {
        out.push(finding('warning', 'DES-W05', `${path}.mode`, {
          en: `${sourceRole.label.en} -> ${targetRole.label.en}: mode "${edge.mode}" does not fit these roles.`,
          vi: `${sourceRole.label.vi} -> ${targetRole.label.vi}: chế độ "${edge.mode}" không phù hợp với các vai trò này.`,
        }, { edgeId: edge.id }))
      }
    }
    if (edge.label.trim() === '') {
      out.push(finding('info', 'DES-I01', `${path}.label`, { en: 'This edge has no label.', vi: 'Cạnh này chưa có nhãn.' }, { edgeId: edge.id }))
    }
  })
  return out
}

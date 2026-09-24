/**
 * Containment (task 0.3): NEST rules from the catalogue, ancestry, depth and
 * inherited failure domains (REQ-DES-004, REQ-DES-025).
 *
 * NEST rules are logical and never block a save (they are L2, design-v2
 * 4.3.3): the command layer refuses an invalid drop, and validateGraph()
 * reports one that arrived another way (import, older client) as a warning.
 * Every walk here is cycle-safe, because a document can arrive corrupt.
 */
import { catalog, getRole, type NestRule } from './catalog'
import type { ArchGraphV2, ArchNodeV2, Bilingual, FailureDomainLevel } from './types'

export type NestVerdict = { ok: true } | { ok: false; ruleId: string; message: Bilingual }

const childRuleByRole = new Map<string, NestRule>()
const containerRuleByRole = new Map<string, NestRule>()
for (const rule of catalog.nestRules) {
  for (const role of rule.roles) (rule.kind === 'child' ? childRuleByRole : containerRuleByRole).set(role, rule)
}

function roleLabel(roleId: string): Bilingual {
  return getRole(roleId)?.label ?? { en: roleId, vi: roleId }
}

function refuse(rule: NestRule, childRole: string, parentRole: string | null): NestVerdict {
  const child = roleLabel(childRole)
  const parent = parentRole ? roleLabel(parentRole) : { en: 'the top level', vi: 'cấp cao nhất' }
  const fill = (template: string, lang: 'en' | 'vi') => template.replace('{child}', child[lang]).replace('{parent}', parent[lang])
  return { ok: false, ruleId: rule.id, message: { en: fill(rule.message.en, 'en'), vi: fill(rule.message.vi, 'vi') } }
}

/**
 * May a `childRole` node sit directly inside a `parentRole` node (`null` =
 * top level)? Checks the child's rule (where it may go) and then the
 * container's rule (what it accepts). Unknown roles are refused with the
 * integrity code, so callers need one code path.
 */
export function canNest(childRole: string, parentRole: string | null): NestVerdict {
  const childRule = childRuleByRole.get(childRole)
  if (!childRule || !getRole(childRole)) {
    return { ok: false, ruleId: 'INT-UNKNOWN-ROLE', message: { en: `${childRole} is not a catalogue role.`, vi: `${childRole} không có trong danh mục.` } }
  }
  const parents = childRule.parents ?? []
  if (parentRole === null) {
    return parents.includes('root') || parents.includes('*') ? { ok: true } : refuse(childRule, childRole, null)
  }
  const parent = getRole(parentRole)
  if (!parent || !parent.container) return refuse(childRule, childRole, parentRole)
  if (!parents.includes('*') && !parents.includes(parentRole)) return refuse(childRule, childRole, parentRole)
  const containerRule = containerRuleByRole.get(parentRole)
  if (containerRule && !(containerRule.accepts ?? []).includes(childRole)) return refuse(containerRule, childRole, parentRole)
  return { ok: true }
}

export function nodeMap(document: ArchGraphV2): Map<string, ArchNodeV2> {
  const byId = new Map<string, ArchNodeV2>()
  for (const node of document.nodes) if (!byId.has(node.id)) byId.set(node.id, node)
  return byId
}

/** Ancestor ids, nearest first. Stops at a missing parent or a loop. */
export function ancestors(document: ArchGraphV2, nodeId: string, byId = nodeMap(document)): string[] {
  const out: string[] = []
  const seen = new Set<string>([nodeId])
  let current = byId.get(nodeId)?.parentId
  while (current !== undefined && byId.has(current) && !seen.has(current)) {
    out.push(current)
    seen.add(current)
    current = byId.get(current)?.parentId
  }
  return out
}

/** 1 for a top-level node. */
export function depthOf(document: ArchGraphV2, nodeId: string, byId = nodeMap(document)): number {
  return ancestors(document, nodeId, byId).length + 1
}

export function childrenOf(document: ArchGraphV2, parentId: string | null): ArchNodeV2[] {
  return document.nodes.filter((node) => (node.parentId ?? null) === parentId)
}

/** Every node below `nodeId`, in document order. Cycle-safe. */
export function descendants(document: ArchGraphV2, nodeId: string): string[] {
  const below = new Set<string>()
  let frontier = [nodeId]
  while (frontier.length > 0) {
    const next: string[] = []
    for (const node of document.nodes) {
      if (node.parentId !== undefined && frontier.includes(node.parentId) && node.id !== nodeId && !below.has(node.id)) {
        below.add(node.id)
        next.push(node.id)
      }
    }
    frontier = next
  }
  return document.nodes.map((node) => node.id).filter((id) => below.has(id))
}

/** Levels in the subtree rooted at `nodeId`, the node itself included (a leaf is 1). */
export function subtreeHeight(document: ArchGraphV2, nodeId: string): number {
  const byId = nodeMap(document)
  const base = depthOf(document, nodeId, byId)
  return Math.max(1, ...descendants(document, nodeId).map((id) => depthOf(document, id, byId) - base + 1))
}

/**
 * Where `nodeId` may be moved (the inspector's Parent select - the keyboard
 * path for re-parenting): `null` (top level) and every container that passes
 * the NEST rules, is not the node or one of its descendants, and keeps the
 * whole subtree within the depth limit. Document order, top level first.
 */
export function validParents(document: ArchGraphV2, nodeId: string): (string | null)[] {
  const byId = nodeMap(document)
  const node = byId.get(nodeId)
  if (!node) return []
  const excluded = new Set([nodeId, ...descendants(document, nodeId)])
  const height = subtreeHeight(document, nodeId)
  const max = catalog.limits.maxNestingDepth
  const out: (string | null)[] = []
  if (canNest(node.type, null).ok && height <= max) out.push(null)
  for (const candidate of document.nodes) {
    if (excluded.has(candidate.id) || byId.get(candidate.id) !== candidate) continue
    if (!canNest(node.type, candidate.type).ok) continue
    if (depthOf(document, candidate.id, byId) + height > max) continue
    out.push(candidate.id)
  }
  return out
}

export interface EffectiveFailureDomain {
  level?: FailureDomainLevel
  label?: string
  /** Where the level came from. */
  source: 'node' | 'container' | 'role' | 'none'
  /** The zone or site container that supplied it, when source = 'container'. */
  fromNodeId?: string
}

/**
 * REQ-DES-025, in precedence order:
 * 1. the node's own failureDomainLevel (label: its own, else inherited);
 * 2. its role's default level, for roles that ARE failure domains (site,
 *    zone, hypervisor cluster), labelled with its own label or codeName;
 * 3. the nearest enclosing zone or site ("containers of type site and zone
 *    supply defaults to children"): that container's level and label, else
 *    its role default and its codeName;
 * 4. nothing.
 * A node that sets only a label keeps the inherited level with its own label.
 */
export function effectiveFailureDomain(document: ArchGraphV2, nodeId: string): EffectiveFailureDomain {
  const byId = nodeMap(document)
  const node = byId.get(nodeId)
  if (!node) return { source: 'none' }
  const own = node.attributes ?? {}
  const roleLevel = getRole(node.type)?.defaultAttributes.failureDomainLevel
  let inherited: EffectiveFailureDomain = { source: 'none' }
  if (roleLevel) {
    inherited = { level: roleLevel, label: node.codeName, source: 'role' }
  } else {
    const supplier = ancestors(document, nodeId, byId)
      .map((id) => byId.get(id)!)
      .find((ancestor) => ancestor.type === 'zone' || ancestor.type === 'site')
    if (supplier) {
      inherited = {
        level: supplier.attributes?.failureDomainLevel ?? getRole(supplier.type)?.defaultAttributes.failureDomainLevel,
        label: supplier.attributes?.failureDomainLabel ?? supplier.codeName,
        source: 'container',
        fromNodeId: supplier.id,
      }
    }
  }
  if (own.failureDomainLevel) {
    return { level: own.failureDomainLevel, label: own.failureDomainLabel ?? inherited.label, source: 'node' }
  }
  return own.failureDomainLabel ? { ...inherited, label: own.failureDomainLabel } : inherited
}

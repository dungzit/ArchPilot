/**
 * Which nodes belong to which target profile (design-v2 4.3.6 step 1, as
 * reshaped by review B2 into `deployment.profiles[]` / `scenarios[]`).
 *
 * - The scenario is `deployment.activeScenarioId`, else the first scenario.
 * - A node's profile is its placement in that scenario, else the scenario's
 *   `defaultProfileId`.
 * - With no scenarios at all, every node is on the requested profile.
 * - With no deployment, or an unknown profile, there is no target: IAC-E09.
 *
 * Pure: the same document gives the same sets in every run.
 */
import { catalog, getRole } from '../../graph/catalog'
import type { ArchGraphV2, ArchNodeV2, Scenario, TargetProfile } from '../../graph/types'
import { byCodeUnit } from './text'
import type { IacProblem } from './types'

export interface Assignment {
  profile: TargetProfile
  scenario?: Scenario
  onTarget: Set<string>
}

export function resolveAssignment(doc: ArchGraphV2, profileId: string | undefined): Assignment | IacProblem {
  const profiles = doc.deployment?.profiles ?? []
  const profile = profiles.find((candidate) => candidate.id === profileId)
  if (!profile) {
    return {
      severity: 'error',
      ruleId: 'IAC-E09',
      path: 'deployment.profiles',
      message: profiles.length === 0
        ? { en: 'No deployment target is chosen for this design.', vi: 'Thiết kế chưa chọn đích triển khai.' }
        : { en: `Target profile ${JSON.stringify(profileId ?? '')} does not exist.`, vi: `Hồ sơ đích ${JSON.stringify(profileId ?? '')} không tồn tại.` },
      fix: { en: 'Choose a target in the Target tab, then generate again.', vi: 'Chọn một đích ở thẻ Đích rồi sinh mã lại.' },
    }
  }
  const scenarios = doc.deployment?.scenarios ?? []
  const scenario = scenarios.find((candidate) => candidate.id === doc.deployment?.activeScenarioId) ?? scenarios[0]
  const onTarget = new Set<string>()
  for (const node of doc.nodes) {
    const effective = scenario
      ? scenario.placements?.find((placement) => placement.nodeId === node.id)?.profileId ?? scenario.defaultProfileId
      : profile.id
    if (effective === profile.id) onTarget.add(node.id)
  }
  return { profile, scenario, onTarget }
}

export function isProblem(value: Assignment | IacProblem): value is IacProblem {
  return (value as IacProblem).ruleId !== undefined
}

const roleRank = new Map<string, number>(catalog.roles.map((role, index) => [role.id, index]))

/**
 * Emission order (design-v2 4.4.5): containment first (depth-first from the
 * top), siblings by the catalogue's role order, then codeName by code unit.
 * Node array order, positions and labels never matter.
 */
export function orderedNodes(doc: ArchGraphV2, keep: (node: ArchNodeV2) => boolean = () => true): ArchNodeV2[] {
  const ids = new Set(doc.nodes.map((node) => node.id))
  const children = new Map<string | null, ArchNodeV2[]>()
  for (const node of doc.nodes) {
    const parent = node.parentId !== undefined && ids.has(node.parentId) ? node.parentId : null
    children.set(parent, [...(children.get(parent) ?? []), node])
  }
  const compare = (a: ArchNodeV2, b: ArchNodeV2) =>
    (roleRank.get(a.type) ?? 9999) - (roleRank.get(b.type) ?? 9999) || byCodeUnit(a.codeName, b.codeName) || byCodeUnit(a.id, b.id)
  const out: ArchNodeV2[] = []
  const seen = new Set<string>()
  const walk = (parent: string | null) => {
    for (const node of [...(children.get(parent) ?? [])].sort(compare)) {
      if (seen.has(node.id)) continue
      seen.add(node.id)
      if (keep(node)) out.push(node)
      walk(node.id)
    }
  }
  walk(null)
  // Nodes caught in a parent cycle are unreachable from the top: append them in a stable order.
  for (const node of [...doc.nodes].sort(compare)) if (!seen.has(node.id) && keep(node)) out.push(node)
  return out
}

/** Annotation roles never produce code and never count as generatable (note, shape, text, client, external_service). */
export function isAnnotationRole(roleId: string): boolean {
  const role = getRole(roleId)
  return role ? !role.codeBearing : false
}

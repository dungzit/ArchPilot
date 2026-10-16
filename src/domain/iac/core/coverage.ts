/**
 * The coverage query (design-v2 4.3.6 resolution, 4.3.7 report; REQ-ADP-002,
 * REQ-ADP-004, AC-22, NFR2-COR-004; review M7).
 *
 * Invariant: every node and every edge of the design appears exactly once,
 * whatever its class. `coverage.test.ts` checks it over random designs.
 *
 * Resolution for node n on profile p (target kind t):
 * 1. n is placed elsewhere -> assignedToOtherTarget.
 * 2. n's role is not code-bearing (client, external_service, note, ...) -> annotation.
 * 3. A stored binding (n, t) names a realisation. Aliases are applied; an id
 *    the catalogue does not know gives `unsupported` + TGT-E01. Never a
 *    silent fallback to the default.
 * 4. No binding: the first catalogue realisation for the role whose `when`
 *    matches, recorded as an assumption. None -> unsupported.
 * 5. `generatable` becomes `manual` when the adapter may not generate
 *    (not registered, or registered as `test` and tests are not allowed).
 */
import { getRole } from '../../graph/catalog'
import type { ArchGraphV2, ArchNodeV2, ConfigValue } from '../../graph/types'
import { isAnnotationRole, orderedNodes, type Assignment } from './context'
import { byCodeUnit, configText } from './text'
import type {
  AttributeRow, CoverageReport, CoverageTotals, EdgeCoverage, IacProblem, NodeCoverage, Realisation, RealisationCatalogue,
} from './types'

export interface CoverageInput {
  doc: ArchGraphV2
  assignment: Assignment
  catalogue: RealisationCatalogue
  adapterId?: string
  /** False when no usable adapter exists: generatable rows are downgraded to manual. */
  canGenerate: boolean
}

function whenMatches(realisation: Realisation, node: ArchNodeV2): boolean {
  const when = realisation.when
  if (!when) return true
  if (when.variant) {
    const variant = node.variant ?? getRole(node.type)?.defaultVariant
    if (variant === undefined || !when.variant.includes(variant)) return false
  }
  if (when.configKey !== undefined) {
    const value = node.config?.[when.configKey] ?? getRole(node.type)?.fields.find((field) => field.key === when.configKey)?.default
    if (value === undefined || Array.isArray(value) || !(when.in ?? []).includes(value)) return false
  }
  return true
}

function sameValue(a: ConfigValue | undefined, b: ConfigValue | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function resolveRealisation(
  node: ArchNodeV2, doc: ArchGraphV2, targetKind: string, catalogue: RealisationCatalogue,
): { realisation?: Realisation; assumed: boolean; unknownId?: string } {
  const binding = (doc.deployment?.bindings ?? []).find((candidate) => candidate.nodeId === node.id && candidate.target === targetKind)
  if (binding) {
    const id = catalogue.aliases.find((alias) => alias.from === binding.realisation)?.to ?? binding.realisation
    const realisation = catalogue.realisations.find((candidate) => candidate.id === id && candidate.role === node.type)
    return realisation ? { realisation, assumed: false } : { assumed: false, unknownId: binding.realisation }
  }
  const realisation = catalogue.realisations.find((candidate) => candidate.role === node.type && whenMatches(candidate, node))
  return { realisation, assumed: realisation !== undefined }
}

export function resolveCoverage(input: CoverageInput): CoverageReport {
  const { doc, assignment, catalogue } = input
  const target = assignment.profile.target
  const problems: IacProblem[] = []
  const nodes: NodeCoverage[] = []
  const byNode = new Map<string, NodeCoverage>()
  const realisationOf = new Map<string, Realisation>()
  const indexOf = new Map(doc.nodes.map((node, index) => [node.id, index]))

  for (const node of orderedNodes(doc)) {
    const base = { nodeId: node.id, codeName: node.codeName, role: node.type }
    let row: NodeCoverage
    if (!assignment.onTarget.has(node.id)) {
      row = { ...base, class: 'assignedToOtherTarget', note: 'Placed on another target; not in this package.' }
    } else if (isAnnotationRole(node.type)) {
      row = { ...base, class: 'annotation', note: node.type === 'external_service' ? 'No code; a service that uses it gets a URL variable.' : 'No code (annotation).' }
    } else {
      const resolved = resolveRealisation(node, doc, target, catalogue)
      if (resolved.unknownId !== undefined) {
        row = { ...base, class: 'unsupported', realisation: resolved.unknownId, note: `Unknown realisation ${resolved.unknownId}.`, reason: 'TGT-E01' }
        problems.push({
          severity: 'error', ruleId: 'TGT-E01', path: `nodes[${indexOf.get(node.id)}]`, nodeId: node.id,
          message: {
            en: `${node.codeName}: realisation ${JSON.stringify(resolved.unknownId)} is not in the ${target} catalogue ${catalogue.version}.`,
            vi: `${node.codeName}: hiện thực ${JSON.stringify(resolved.unknownId)} không có trong danh mục ${target} ${catalogue.version}.`,
          },
          fix: { en: 'Pick a realisation again in the Target tab.', vi: 'Chọn lại hiện thực ở thẻ Đích.' },
        })
      } else if (!resolved.realisation) {
        row = { ...base, class: 'unsupported', note: `No ${target} realisation for ${node.type}.` }
      } else {
        const r = resolved.realisation
        realisationOf.set(node.id, r)
        let cls: NodeCoverage['class'] = r.badge
        let reason: string | undefined
        if (cls === 'generatable' && !input.canGenerate) {
          cls = 'manual'
          reason = 'No shipped adapter can generate this target.'
        }
        row = { ...base, class: cls, realisation: r.id, note: r.note.en, ...(r.detail ? { detail: r.detail } : {}), ...(resolved.assumed ? { assumed: true } : {}), ...(reason ? { reason } : {}) }
      }
    }
    nodes.push(row)
    byNode.set(node.id, row)
  }

  const edges = [...doc.edges]
    .sort((a, b) => byCodeUnit(a.id, b.id))
    .map((edge): EdgeCoverage => {
      const base = { edgeId: edge.id, source: edge.source, target: edge.target, kind: edge.kind, ...(edge.mode ? { mode: edge.mode } : {}) }
      const source = byNode.get(edge.source)
      const dest = byNode.get(edge.target)
      const path = `edges[${doc.edges.indexOf(edge)}]`
      if (!source || !dest) return { ...base, class: 'noCode', note: 'An endpoint is missing (integrity error).' }
      const onSource = source.class !== 'assignedToOtherTarget'
      const onDest = dest.class !== 'assignedToOtherTarget'
      if (!onSource && !onDest) return { ...base, class: 'assignedToOtherTarget', note: 'Both endpoints are on another target.' }
      if (onSource !== onDest) return { ...base, class: 'manual', note: 'Cross-target connectivity: see MANUAL-STEPS.md.' }
      if (edge.kind === 'flow') return { ...base, class: 'noCode', note: 'Flow edge (visual only).' }
      const annotationEnds = [source, dest].filter((end) => end.class === 'annotation')
      if (annotationEnds.some((end) => ['note', 'shape', 'text'].includes(end.role))) return { ...base, class: 'noCode', note: 'Touches an annotation.' }
      const codeEnds = [source, dest].filter((end) => end.class !== 'annotation')
      const allGeneratable = codeEnds.every((end) => end.class === 'generatable')
      const pair = input.catalogue.accessPairs.find((candidate) =>
        candidate.source === source.role && candidate.target === dest.role && edge.mode !== undefined && candidate.modes.includes(edge.mode))
      const edgeProblem = (en: string, vi: string, fixEn: string, fixVi: string) => problems.push({
        severity: 'error', ruleId: 'IAC-E05', path, edgeId: edge.id, message: { en, vi }, fix: { en: fixEn, vi: fixVi },
      })
      if (allGeneratable && edge.direction === 'bidirectional') {
        edgeProblem(
          `Access edge ${edge.id} (${source.codeName} -> ${dest.codeName}) is bidirectional.`,
          `Cạnh truy cập ${edge.id} (${source.codeName} -> ${dest.codeName}) là hai chiều.`,
          'Make it forward, from the user of the resource to the resource.',
          'Đổi thành một chiều, từ bên sử dụng đến tài nguyên.',
        )
        return { ...base, class: 'manual', note: 'Bidirectional access edge (IAC-E05).' }
      }
      if (allGeneratable && edge.mode === undefined) {
        edgeProblem(
          `Access edge ${edge.id} (${source.codeName} -> ${dest.codeName}) has no mode.`,
          `Cạnh truy cập ${edge.id} (${source.codeName} -> ${dest.codeName}) chưa có chế độ.`,
          'Set the edge mode (connect, read, write, ...).',
          'Đặt chế độ cho cạnh (connect, read, write, ...).',
        )
        return { ...base, class: 'manual', note: 'Access edge without a mode (IAC-E05).' }
      }
      if (pair) {
        return allGeneratable
          ? { ...base, class: 'generatable', note: pair.note.en }
          : { ...base, class: 'manual', note: 'An endpoint is not generated; see MANUAL-STEPS.md.' }
      }
      if (allGeneratable && input.catalogue.unmappedAccess === 'manual') {
        return { ...base, class: 'manual', note: 'Firewall request: see MANUAL-STEPS.md.' }
      }
      if (allGeneratable) {
        const reverse = input.catalogue.accessPairs.find((candidate) => candidate.source === dest.role && candidate.target === source.role)
        edgeProblem(
          `No ${target} mapping for access ${source.role} -> ${dest.role} (mode ${edge.mode}) on edge ${edge.id}.`,
          `Không có ánh xạ ${target} cho truy cập ${source.role} -> ${dest.role} (chế độ ${edge.mode}) ở cạnh ${edge.id}.`,
          reverse
            ? `Draw the edge from ${dest.codeName} to ${source.codeName} with mode ${reverse.modes[0]}.`
            : 'Remove the edge, make it a flow edge, or connect the two components directly.',
          reverse
            ? `Vẽ cạnh từ ${dest.codeName} đến ${source.codeName} với chế độ ${reverse.modes[0]}.`
            : 'Xóa cạnh, đổi thành cạnh luồng, hoặc nối trực tiếp hai thành phần.',
        )
        return { ...base, class: 'manual', note: 'No mapping for this pair (IAC-E05).' }
      }
      return { ...base, class: 'manual', note: 'An endpoint is not generated; see MANUAL-STEPS.md.' }
    })

  const attributes: AttributeRow[] = []
  for (const node of orderedNodes(doc)) {
    const r = realisationOf.get(node.id)
    if (!r) continue
    const role = getRole(node.type)
    for (const key of Object.keys(node.config ?? {}).sort(byCodeUnit)) {
      const value = node.config![key]
      const fieldDefault = role?.fields.find((field) => field.key === key)?.default
      if (r.consumes.includes(key) || sameValue(value, fieldDefault)) continue
      attributes.push({ nodeId: node.id, codeName: node.codeName, key, value: configText(value), note: `Not expressed by ${r.id}.` })
    }
    const replicas = node.attributes?.replicas
    if (replicas !== undefined && replicas !== 1 && !r.consumes.includes('replicas')) {
      attributes.push({ nodeId: node.id, codeName: node.codeName, key: 'replicas', value: String(replicas), note: `Not expressed by ${r.id}.` })
    }
  }

  const totals: CoverageTotals = { generatable: 0, manual: 0, unsupported: 0, annotation: 0, other: 0 }
  for (const row of nodes) {
    if (row.class === 'assignedToOtherTarget') totals.other += 1
    else totals[row.class] += 1
  }
  return { profileId: assignment.profile.id, target, ...(input.adapterId ? { adapterId: input.adapterId } : {}), nodes, edges, attributes, totals, problems }
}

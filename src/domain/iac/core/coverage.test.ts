/**
 * Coverage integrity (REQ-ADP-004, AC-22, NFR2-COR-004; TC-COV-EDGE,
 * TC-COV-ATTR, TC-COV-UNKNOWN). Property test over random designs x targets:
 * every node and every edge appears exactly once, totals add up, unknown
 * realisations are unsupported (never a silent default), and non-default
 * attributes that a realisation does not consume are reported.
 */
import { describe, expect, it } from 'vitest'
import { catalog } from '../../graph/catalog'
import type { ArchEdgeV2, ArchGraphV2, ArchNodeV2, EdgeMode } from '../../graph/types'
import { createDefaultRegistry } from '../index'
import { coverageFor } from './generate'
import type { CoverageReport } from './types'

const registry = createDefaultRegistry()
const MODES: EdgeMode[] = ['connect', 'read', 'write', 'read_write', 'send', 'consume', 'send_consume', 'publish', 'deliver', 'replicate']

function randomDesign(seed: number): ArchGraphV2 {
  let s = seed
  const next = (n: number) => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s % n
  }
  const nodes: ArchNodeV2[] = []
  const count = 1 + next(30)
  for (let i = 0; i < count; i += 1) {
    const role = catalog.roles[next(catalog.roles.length)]
    const containers = nodes.filter((candidate) => catalog.roles.find((r) => r.id === candidate.type)?.container)
    const parent = containers.length > 0 && next(2) === 0 ? containers[next(containers.length)] : undefined
    nodes.push({
      id: `n${i}`, type: role.id, label: `N ${i}`, codeName: `${role.id}_${i}`.slice(0, 40), position: { x: i, y: i },
      ...(parent ? { parentId: parent.id } : {}),
      ...(next(3) === 0 ? { config: { unconsumedKey: `v${i}` } } : {}),
      ...(next(4) === 0 ? { attributes: { replicas: 3 } } : {}),
    })
  }
  const edges: ArchEdgeV2[] = []
  for (let i = 0; i < next(40); i += 1) {
    edges.push({
      id: `e${i}`, source: nodes[next(nodes.length)].id, target: nodes[next(nodes.length)].id, label: '',
      direction: next(5) === 0 ? 'bidirectional' : 'forward', kind: next(2) === 0 ? 'flow' : 'access',
      ...(next(6) === 0 ? {} : { mode: MODES[next(MODES.length)] }),
    })
  }
  const targets = ['aws', 'vsphere', 'bare_metal']
  return {
    schemaVersion: '2.0',
    settings: { codeName: 'random', environment: 'test' },
    nodes, edges,
    deployment: {
      profiles: targets.map((target) => ({ id: `p_${target}`, target, label: target })),
      bindings: nodes.filter(() => next(5) === 0).map((node) => ({ nodeId: node.id, target: 'aws', realisation: next(2) === 0 ? 'aws.renamed_away' : 'aws.rds' })),
      scenarios: [{ id: 's', label: 'S', defaultProfileId: `p_${targets[next(3)]}`, placements: nodes.filter(() => next(4) === 0).map((node) => ({ nodeId: node.id, profileId: `p_${targets[next(3)]}` })) }],
    },
  }
}

function asReport(value: ReturnType<typeof coverageFor>): CoverageReport {
  if ('ruleId' in value) throw new Error(value.ruleId)
  return value
}

describe('coverage invariant over 300 random designs x 3 targets', () => {
  it('every node and edge exactly once; totals add up; unknown realisations never fall back', () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const doc = randomDesign(seed)
      for (const target of ['aws', 'vsphere', 'bare_metal']) {
        const report = asReport(coverageFor(doc, { profileId: `p_${target}`, allowTestAdapters: true }, registry))
        const nodeIds = report.nodes.map((row) => row.nodeId).sort()
        expect(nodeIds, `seed ${seed} ${target}`).toEqual(doc.nodes.map((node) => node.id).sort())
        expect(report.edges.map((row) => row.edgeId).sort()).toEqual(doc.edges.map((edge) => edge.id).sort())
        const t = report.totals
        expect(t.generatable + t.manual + t.unsupported + t.annotation + t.other).toBe(doc.nodes.length)
        for (const binding of doc.deployment!.bindings!) {
          const row = report.nodes.find((candidate) => candidate.nodeId === binding.nodeId)!
          if (target === 'aws' && binding.realisation === 'aws.renamed_away' && row.class !== 'assignedToOtherTarget' && row.class !== 'annotation') {
            expect(row.class).toBe('unsupported')
            expect(report.problems.some((problem) => problem.ruleId === 'TGT-E01' && problem.nodeId === binding.nodeId)).toBe(true)
          }
        }
        for (const row of report.nodes.filter((candidate) => candidate.realisation && candidate.class !== 'unsupported')) {
          const node = doc.nodes.find((candidate) => candidate.id === row.nodeId)!
          if (node.config?.unconsumedKey) {
            expect(report.attributes.some((attribute) => attribute.nodeId === node.id && attribute.key === 'unconsumedKey'), `seed ${seed}`).toBe(true)
          }
        }
      }
    }
  })

  it('bare_metal has no adapter: everything code-bearing is manual or unsupported, never generatable', () => {
    const report = asReport(coverageFor(randomDesign(7), { profileId: 'p_bare_metal' }, registry))
    expect(report.nodes.filter((row) => row.class === 'generatable')).toEqual([])
  })

  it('a test adapter is not used by the coverage query unless tests are allowed (generatable becomes manual)', () => {
    const doc = randomDesign(11)
    doc.nodes.push({ id: 'vm', type: 'virtual_machine', label: 'VM', codeName: 'vm_x', position: { x: 0, y: 0 } })
    doc.deployment!.scenarios[0].placements = [{ nodeId: 'vm', profileId: 'p_vsphere' }]
    const shipped = asReport(coverageFor(doc, { profileId: 'p_vsphere' }, registry))
    expect(shipped.nodes.find((row) => row.nodeId === 'vm')).toMatchObject({ class: 'manual', realisation: 'vsphere.vm', reason: 'No shipped adapter can generate this target.' })
    const spike = asReport(coverageFor(doc, { profileId: 'p_vsphere', allowTestAdapters: true }, registry))
    expect(spike.nodes.find((row) => row.nodeId === 'vm')!.class).toBe('generatable')
  })
})

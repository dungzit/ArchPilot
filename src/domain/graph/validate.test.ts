import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { ArchEdgeV2, ArchGraph, ArchGraphV2, ArchNodeV2 } from './types'
import { INTEGRITY_RULES, integrityErrors, isSaveable, validateGraph } from './validate'

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), '../../../contracts/fixtures')
const load = <T = ArchGraph>(name: string): T => JSON.parse(readFileSync(resolve(fixtures, name), 'utf-8')) as T
const manifest = load<{ integrityRules: { code: string }[] }>('index.json')
const hybrid = load<ArchGraphV2>('archgraph.v2-hybrid-orders.valid.json')

const node = (id: string, type = 'service', extra: Partial<ArchNodeV2> = {}): ArchNodeV2 => ({ id, type, label: id, codeName: id, position: { x: 0, y: 0 }, ...extra })
const edge = (id: string, source: string, target: string, extra: Partial<ArchEdgeV2> = {}): ArchEdgeV2 => ({ id, source, target, label: 'uses', direction: 'forward', kind: 'access', ...extra })
const doc = (nodes: ArchNodeV2[], edges: ArchEdgeV2[] = [], extra: Partial<ArchGraphV2> = {}): ArchGraphV2 => ({
  schemaVersion: '2.0', settings: { codeName: 't', environment: 'dev' }, nodes, edges, ...extra,
})
const rules = (graph: ArchGraph, severity?: string) => validateGraph(graph).filter((p) => !severity || p.severity === severity).map((p) => p.ruleId)

describe('L1 integrity (mirrors backend/app/graph_integrity.py)', () => {
  it('declares exactly the manifest rules, in the manifest order', () => {
    expect([...INTEGRITY_RULES]).toEqual(manifest.integrityRules.map((rule) => rule.code))
  })

  it('finds nothing wrong with the rich fixture', () => {
    expect(integrityErrors(hybrid)).toEqual([])
    expect(isSaveable(hybrid)).toBe(true)
  })

  it('reports in the same stable order and with the same paths as the Python side', () => {
    const broken = structuredClone(hybrid)
    broken.nodes[3].parentId = 'ghost'
    broken.edges[1].source = 'gone'
    broken.deployment!.bindings![0].nodeId = 'gone'
    expect(integrityErrors(broken).map((p) => [p.ruleId, p.path])).toEqual([
      ['INT-DANGLING-EDGE', 'edges[1].source'],
      ['INT-DANGLING-PARENT', 'nodes[3].parentId'],
      ['INT-DANGLING-BINDING', 'deployment.bindings[0].nodeId'],
    ])
  })

  it('reports a loop once with the same message as Python, whatever the node order', () => {
    const ring = [node('b', 'zone', { parentId: 'c' }), node('a', 'network_segment', { parentId: 'b' }), node('c', 'zone', { parentId: 'a' })]
    for (let rotation = 0; rotation < 3; rotation += 1) {
      const nodes = [...ring.slice(rotation), ...ring.slice(0, rotation)]
      const problems = integrityErrors(doc(nodes))
      expect(problems.map((p) => p.ruleId)).toEqual(['INT-PARENT-CYCLE'])
      expect(problems[0].path).toBe('nodes[0].parentId')
      expect(problems[0].message.en.startsWith(`containment loop ${nodes[0].id} -> `)).toBe(true)
    }
  })

  it('allows depth 6 and reports depth 7 once', () => {
    const chain = (levels: number) => [node('l1', 'site'), ...Array.from({ length: levels - 1 }, (_, i) => node(`l${i + 2}`, 'network_segment', { parentId: `l${i + 1}` }))]
    expect(integrityErrors(doc(chain(6)))).toEqual([])
    expect(integrityErrors(doc(chain(9))).map((p) => [p.ruleId, p.path, p.message.en])).toEqual([
      ['INT-DEPTH', 'nodes[6].parentId', "'l7' is nested 7 levels deep; the limit is 6"],
    ])
  })

  it('names the canonical id for a legacy or design-v0.2 role id, in both languages', () => {
    const [problem] = integrityErrors(doc([node('n', 'subnet')]))
    expect(problem.ruleId).toBe('INT-UNKNOWN-ROLE')
    expect(problem.message.en).toBe("'subnet' is not a role in component catalogue 1.0.0; use 'network_segment (variant subnet)'")
    expect(problem.message.vi).toContain("hãy dùng 'network_segment (variant subnet)'")
    expect(problem.nodeId).toBe('n')
  })

  it('checks the deployment layer and the decision log', () => {
    const graph = doc([node('a')], [], {
      deployment: {
        profiles: [{ id: 'dc1', target: 'vsphere', label: 'DC1' }, { id: 'dc1', target: 'bare_metal', label: 'again' }],
        scenarios: [{ id: 's1', label: 'x', defaultProfileId: 'dc1', placements: [{ nodeId: 'a', profileId: 'nope' }, { nodeId: 'a', profileId: 'dc1' }] }],
        activeScenarioId: 's9',
        bindings: [{ nodeId: 'a', target: 'vsphere', realisation: 'vsphere.vm_group' }, { nodeId: 'a', target: 'vsphere', realisation: 'vsphere.vm' }],
      },
      decisions: [{ id: 'd1', number: 1, title: 'x', status: 'accepted', supersedes: 'd0' }, { id: 'd1', number: 2, title: 'y', status: 'proposed' }],
    })
    expect(rules(graph, 'error')).toEqual([
      'INT-DUPLICATE-PROFILE-ID', 'INT-UNKNOWN-PROFILE', 'INT-DUPLICATE-PLACEMENT', 'INT-UNKNOWN-SCENARIO',
      'INT-DUPLICATE-BINDING', 'INT-DUPLICATE-DECISION-ID', 'INT-DANGLING-DECISION-REF',
    ])
  })

  it('applies only the id and edge rules to a 1.0 document', () => {
    const v1: ArchGraph = { schemaVersion: '1.0', nodes: [{ id: 'n1', type: 'external_api', label: 'x', position: { x: 0, y: 0 } }], edges: [] }
    expect(validateGraph(v1)).toEqual([])
    const broken: ArchGraph = { ...v1, edges: [{ id: 'e1', source: 'n1', target: 'n2', label: '', direction: 'forward' }] }
    expect(rules(broken)).toEqual(['INT-DANGLING-EDGE'])
  })

  it('truncates long user values exactly like the Python side', () => {
    const [problem] = integrityErrors(doc([node('a')], [edge('e', 'a', 'x'.repeat(64))]))
    // repr() is 66 characters; both sides keep the first 61 and add "...".
    expect(problem.message.en).toBe(`'${'x'.repeat(60)}... is not a node id`)
  })
})

describe('L2 design rules (never block a save)', () => {
  it('the rich fixture has no NEST findings and no errors', () => {
    const problems = validateGraph(hybrid)
    expect(problems.filter((p) => p.severity === 'error')).toEqual([])
    expect(problems.filter((p) => p.ruleId.startsWith('NEST-'))).toEqual([])
  })

  it('reports a NEST violation that arrived by import as a warning with the rule id', () => {
    const problems = validateGraph(doc([node('hv', 'hypervisor_cluster'), node('svc', 'service', { parentId: 'hv' })], [edge('e1', 'svc', 'svc')]))
    const nest = problems.find((p) => p.ruleId === 'NEST-09')
    expect(nest).toMatchObject({ severity: 'warning', path: 'nodes[1].parentId', nodeId: 'svc' })
    expect(isSaveable(doc([node('hv', 'hypervisor_cluster'), node('svc', 'service', { parentId: 'hv' })]))).toBe(true)
  })

  it('DES-W01 flags an unconnected code-bearing component but not containers or annotations', () => {
    const graph = doc([node('svc'), node('seg', 'network_segment'), node('memo', 'note'), node('u', 'client')])
    expect(validateGraph(graph).filter((p) => p.ruleId === 'DES-W01').map((p) => p.nodeId)).toEqual(['svc'])
  })

  it('DES-W03: replicas without a failure-domain level; an enclosing zone or site supplies one', () => {
    const bare = doc([node('svc', 'service', { attributes: { replicas: 3 } })])
    expect(rules(bare)).toContain('DES-W03')
    const inSite = doc([node('s', 'site'), node('svc', 'service', { parentId: 's', attributes: { replicas: 3 } })])
    expect(rules(inSite)).not.toContain('DES-W03')
  })

  it('DES-W04: a stateful or high-criticality single replica is a single point of failure (REQ-DES-026)', () => {
    expect(rules(doc([node('db', 'relational_db')]))).toContain('DES-W04')
    expect(rules(doc([node('svc', 'service', { attributes: { criticality: 'high' } })]))).toContain('DES-W04')
    expect(rules(doc([node('db', 'relational_db', { attributes: { replicas: 2, failureDomainLevel: 'zone' } })]))).not.toContain('DES-W04')
    expect(rules(doc([node('svc')]))).not.toContain('DES-W04')
  })

  it('DES-W05: an access mode the roles cannot use', () => {
    const ok = doc([node('svc'), node('db', 'relational_db')], [edge('e1', 'svc', 'db', { mode: 'read_write' })])
    const bad = doc([node('svc'), node('db', 'relational_db')], [edge('e1', 'svc', 'db', { mode: 'publish' })])
    expect(rules(ok)).not.toContain('DES-W05')
    expect(validateGraph(bad).find((p) => p.ruleId === 'DES-W05')).toMatchObject({ severity: 'warning', edgeId: 'e1', path: 'edges[0].mode' })
  })

  it('DES-W06: an annotation in an access edge; a flow edge to a note is fine', () => {
    const access = doc([node('svc'), node('memo', 'note')], [edge('e1', 'svc', 'memo')])
    const flow = doc([node('svc'), node('memo', 'note')], [edge('e1', 'svc', 'memo', { kind: 'flow' })])
    expect(rules(access)).toContain('DES-W06')
    expect(rules(flow)).not.toContain('DES-W06')
  })

  it('DES-I01: an unlabelled edge is information only', () => {
    const graph = doc([node('a'), node('b')], [edge('e1', 'a', 'b', { label: '  ', kind: 'flow' })])
    expect(validateGraph(graph).find((p) => p.ruleId === 'DES-I01')?.severity).toBe('info')
  })

  it('design rules skip nodes whose role is unknown (already an L1 error)', () => {
    const problems = validateGraph(doc([node('q', 'quantum_router')]))
    expect(problems.map((p) => p.ruleId)).toEqual(['INT-UNKNOWN-ROLE'])
  })

  it('every message is bilingual and non-empty', () => {
    const graph = doc([node('hv', 'hypervisor_cluster'), node('db', 'relational_db', { parentId: 'hv', attributes: { replicas: 2 } }), node('q', 'nope')], [edge('e1', 'db', 'zz', { label: '' })])
    for (const problem of validateGraph(graph)) {
      expect(problem.message.en.length, problem.ruleId).toBeGreaterThan(0)
      expect(problem.message.vi.length, problem.ruleId).toBeGreaterThan(0)
    }
  })
})

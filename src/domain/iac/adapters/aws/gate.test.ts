/**
 * Gate rules (design-v2 4.4.10, AC-06): every E rule implemented in Phase 1
 * has a blocking test, every W/I rule a warn-and-allow test.
 */
import { describe, expect, it } from 'vitest'
import type { ArchEdgeV2, ArchGraphV2, ArchNodeV2 } from '../../../graph/types'
import { generatePackage, type PackageResult } from '../../core/generate'
import { goldenRegistry, loadFixture } from '../../testing/goldens'

const base = () => loadFixture('aws-three-tier')
const node = (doc: ArchGraphV2, codeName: string): ArchNodeV2 => doc.nodes.find((n) => n.codeName === codeName)!
const byId = (doc: ArchGraphV2, id: string): ArchNodeV2 => doc.nodes.find((n) => n.id === id)!
const run = (doc: ArchGraphV2, profileId = doc.deployment?.profiles[0]?.id ?? 'none'): PackageResult =>
  generatePackage(doc, { profileId, options: { pipeline: 'none' } }, goldenRegistry)
const errors = (result: PackageResult) => result.problems.filter((p) => p.severity === 'error').map((p) => p.ruleId)
const findings = (result: PackageResult) => result.problems.map((p) => p.ruleId)
const edge = (id: string, source: string, target: string, extra: Partial<ArchEdgeV2> = {}): ArchEdgeV2 =>
  ({ id, source, target, label: '', direction: 'forward', kind: 'access', mode: 'connect', ...extra })

function blocked(mutate: (doc: ArchGraphV2) => void, rule: string, profileId?: string) {
  const doc = base()
  mutate(doc)
  const result = run(doc, profileId)
  expect(result.ok).toBe(false)
  expect(result.files).toEqual([])
  expect(errors(result)).toContain(rule)
  for (const problem of result.problems.filter((p) => p.severity === 'error' && p.ruleId === rule)) {
    expect(problem.message.en.length).toBeGreaterThan(0)
    expect(problem.message.vi.length).toBeGreaterThan(0)
  }
  return result
}

describe('the baseline fixture generates', () => {
  it('aws-three-tier is clean of errors and carries the expected warnings', () => {
    const result = run(base())
    expect(errors(result)).toEqual([])
    expect(findings(result)).toEqual(expect.arrayContaining(['IAC-W07', 'IAC-I01', 'IAC-I02']))
  })
})

describe('neutral rules', () => {
  it('IAC-E09: no target / unknown profile', () => {
    const doc = base()
    delete doc.deployment
    expect(errors(run(doc, 'aws_sg'))).toEqual(['IAC-E09'])
    expect(errors(run(base(), 'nope'))).toEqual(['IAC-E09'])
  })
  it('IAC-E08: nothing generatable (unsupported-only design); coverage still returned', () => {
    const doc = base()
    doc.nodes = [{ id: 'b1', type: 'bare_metal_host', label: 'Host', codeName: 'host', position: { x: 0, y: 0 } }, { id: 's1', type: 'san', label: 'SAN', codeName: 'san_a', position: { x: 0, y: 0 } }]
    doc.edges = []
    doc.deployment!.bindings = []
    doc.decisions = []
    const result = run(doc)
    expect(errors(result)).toEqual(['IAC-E08'])
    expect(result.coverage!.totals.unsupported).toBe(2)
  })
  it('IAC-E05: unmapped pair, bidirectional access, access without a mode', () => {
    blocked((doc) => doc.edges.push(edge('x1', 'n12', 'n11')), 'IAC-E05')
    blocked((doc) => { doc.edges[2].direction = 'bidirectional' }, 'IAC-E05')
    blocked((doc) => { delete doc.edges[2].mode }, 'IAC-E05')
  })
  it('TGT-E01: an unknown stored realisation never falls back to the default', () => {
    const result = blocked((doc) => { doc.deployment!.bindings![0].realisation = 'aws.rds_renamed' }, 'TGT-E01')
    expect(result.coverage!.nodes.find((row) => row.codeName === 'orders_db')!.class).toBe('unsupported')
  })
  it('IAC-E01: a required field is missing', () => {
    blocked((doc) => { delete node(doc, 'app').config!.cidr }, 'IAC-E01')
  })
  it('IAC-E06: a secret-looking literal in a config field', () => {
    blocked((doc) => { node(doc, 'orders_api').config!.apiToken = 'abcdef123456' }, 'IAC-E06')
    blocked((doc) => { node(doc, 'orders_api').config!.runtime = 'AKIAABCDEFGHIJKLMNOP' }, 'IAC-E06')
  })
  it('INT-* integrity errors block generation too', () => {
    blocked((doc) => doc.edges.push(edge('x2', 'n9', 'missing')), 'INT-DANGLING-EDGE')
  })
  it('IAC-W08: a failure-domain level aws cannot express warns and allows', () => {
    const doc = base()
    node(doc, 'orders_api').attributes!.failureDomainLevel = 'rack'
    const result = run(doc)
    expect(result.ok).toBe(true)
    expect(findings(result)).toContain('IAC-W08')
  })
  it('IAC-W03: a stateful node with one replica warns and allows', () => {
    const doc = base()
    node(doc, 'orders_db').attributes!.replicas = 1
    const result = run(doc)
    expect(result.ok).toBe(true)
    expect(findings(result)).toContain('IAC-W03')
  })
  it('IAC-W09: nodes placed on another target are excluded and listed', () => {
    const doc = base()
    doc.deployment!.profiles.push({ id: 'dc', target: 'vsphere', label: 'DC' })
    doc.deployment!.scenarios[0].placements = [{ nodeId: 'n10', profileId: 'dc' }]
    const result = run(doc)
    expect(result.ok).toBe(true)
    expect(findings(result)).toContain('IAC-W09')
    expect(result.coverage!.edges.find((row) => row.edgeId === 'e5')!.class).toBe('manual')
  })
})

describe('aws rules', () => {
  it('IAC-E02: a subnet tier outside a network, a network inside a zone', () => {
    blocked((doc) => { node(doc, 'app').parentId = 'n1' }, 'IAC-E02')
    blocked((doc) => { node(doc, 'main').parentId = 'n2' }, 'IAC-E02')
  })
  it('IAC-E03: malformed, outside, overlapping, too long for the zone split', () => {
    blocked((doc) => { node(doc, 'app').config!.cidr = '10.0.4.1/22' }, 'IAC-E03')
    blocked((doc) => { node(doc, 'app').config!.cidr = '10.9.0.0/22' }, 'IAC-E03')
    blocked((doc) => { node(doc, 'app').config!.cidr = '10.0.1.0/24' }, 'IAC-E03')
    blocked((doc) => { node(doc, 'app').config!.cidr = '10.0.4.0/27' }, 'IAC-E03')
    blocked((doc) => { node(doc, 'main').config!.cidr = '10.0.0.0/8' }, 'IAC-E03')
  })
  it('IAC-E07: curated values and target options', () => {
    blocked((doc) => { doc.deployment!.bindings![0].config = { instanceClass: 'db.x1.32xlarge' } }, 'IAC-E07')
    blocked((doc) => { node(doc, 'orders_db').config!.engineMajor = '9' }, 'IAC-E07')
    blocked((doc) => { doc.deployment!.profiles[0].options = { region: 'mars-1', nat: 'single' } }, 'IAC-E07')
    blocked((doc) => { doc.deployment!.profiles[0].options = { region: 'ap-southeast-1', nat: 'single', projectName: 'Has Spaces' } }, 'IAC-E07')
    blocked((doc) => { node(doc, 'web_lb').config!.healthPath = 'no slash' }, 'IAC-E07')
  })
  it('AWS-E01: load balancer without a service, or in one zone', () => {
    blocked((doc) => { doc.edges = doc.edges.filter((e) => e.id !== 'e2') }, 'AWS-E01')
    blocked((doc) => { node(doc, 'public_web').parentId = 'n2'; byId(doc, 'n2').parentId = 'n4'; byId(doc, 'n3').parentId = 'n4' }, 'AWS-E01')
  })
  it('AWS-E02: database subnet group in one zone', () => {
    blocked((doc) => { byId(doc, 'n2').parentId = 'n4'; byId(doc, 'n3').parentId = 'n4'; node(doc, 'data').parentId = 'n3' }, 'AWS-E02')
  })
  it('AWS-E03: VPC-bound node outside a tier; internet-facing LB in a private tier', () => {
    blocked((doc) => { delete node(doc, 'orders_api').parentId }, 'AWS-E03')
    blocked((doc) => { node(doc, 'web_lb').parentId = 'n6' }, 'AWS-E03')
  })
  it('AWS-E04: service with no route to pull images', () => {
    blocked((doc) => { doc.deployment!.profiles[0].options!.nat = 'none' }, 'AWS-E04')
    blocked((doc) => { node(doc, 'orders_api').parentId = 'n5' }, 'AWS-E04')
  })
  it('AWS-E05: NAT without a suitable public tier', () => {
    blocked((doc) => { node(doc, 'public_web').config!.exposure = 'isolated'; node(doc, 'web_lb').config!.scheme = 'internal'; doc.edges = doc.edges.filter((e) => e.id !== 'e1') }, 'AWS-E05')
    blocked((doc) => {
      doc.deployment!.profiles[0].options!.nat = 'perZone'
      byId(doc, 'n2').parentId = 'n4'; byId(doc, 'n3').parentId = 'n4'; node(doc, 'public_web').parentId = 'n2'
    }, 'AWS-E05')
  })
  it('IAC-E05 (aws): client to an internal LB; one LB fronting two services', () => {
    blocked((doc) => { node(doc, 'web_lb').config!.scheme = 'internal'; node(doc, 'web_lb').parentId = 'n6' }, 'IAC-E05')
    blocked((doc) => {
      doc.nodes.push({ id: 'x9', type: 'service', variant: 'api', label: 'Second', codeName: 'second_api', parentId: 'n6', position: { x: 0, y: 0 } })
      doc.edges.push(edge('x9e', 'n8', 'x9'))
    }, 'IAC-E05')
  })
  it('IAC-E04: two edges that would produce the same security-group rule address', () => {
    blocked((doc) => {
      // orders_api -> b_to_c and a_to_b -> c both yield "..._to_b_to_c_5432"-shaped labels.
      node(doc, 'orders_api').codeName = 'a'
      node(doc, 'orders_db').codeName = 'b_to_c'
      doc.nodes.push(
        { id: 'y1', type: 'service', variant: 'worker', label: 'Y1', codeName: 'a_to_b', parentId: 'n6', position: { x: 0, y: 0 } },
        { id: 'y2', type: 'relational_db', label: 'Y2', codeName: 'c', parentId: 'n7', position: { x: 0, y: 0 }, attributes: { replicas: 2 }, config: { engine: 'postgres' } },
      )
      doc.edges.push(edge('y3', 'y1', 'y2', { mode: 'read' }))
    }, 'IAC-E04')
  })
  it('warn-and-allow: W02 HTTP only, W05 relaxed default, W06 NAT per zone, W10 stateful public, W11 clamp, I03 assumed zones', () => {
    const doc = base()
    node(doc, 'web_lb').config!.protocol = 'http'
    node(doc, 'orders_db').config!.deletionProtection = false
    node(doc, 'orders_db').config!.storageGiB = 5
    node(doc, 'data').config!.exposure = 'public'
    doc.deployment!.profiles[0].options!.nat = 'perZone'
    const result = run(doc)
    expect(errors(result)).toEqual([])
    expect(findings(result)).toEqual(expect.arrayContaining(['IAC-W02', 'IAC-W05', 'IAC-W06', 'IAC-W10', 'IAC-W11']))
    const readme = result.files.find((file) => file.path === 'README.md')!.content
    expect(readme).toContain('`IAC-W02`')
    const noZones = base()
    noZones.nodes = noZones.nodes.filter((n) => n.type !== 'zone')
    expect(findings(run(noZones))).toContain('IAC-I03')
  })
})

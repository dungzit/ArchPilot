import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { catalog } from './catalog'
import { ancestors, canNest, childrenOf, depthOf, descendants, effectiveFailureDomain, subtreeHeight, validParents } from './containment'
import type { ArchGraphV2, ArchNodeV2 } from './types'

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), '../../../contracts/fixtures')
const hybrid = JSON.parse(readFileSync(resolve(fixtures, 'archgraph.v2-hybrid-orders.valid.json'), 'utf-8')) as ArchGraphV2

const node = (id: string, type: string, parentId?: string, extra: Partial<ArchNodeV2> = {}): ArchNodeV2 => ({
  id, type, label: id, codeName: id, position: { x: 0, y: 0 }, ...(parentId ? { parentId } : {}), ...extra,
})
const doc = (nodes: ArchNodeV2[]): ArchGraphV2 => ({ schemaVersion: '2.0', settings: { codeName: 't', environment: 'dev' }, nodes, edges: [] })

function refusedBy(child: string, parent: string | null): string | undefined {
  const verdict = canNest(child, parent)
  return verdict.ok ? undefined : verdict.ruleId
}

describe('canNest: one test per NEST rule', () => {
  it('NEST-01 a site is the outermost container', () => {
    expect(refusedBy('site', null)).toBeUndefined()
    expect(refusedBy('site', 'site')).toBe('NEST-01')
    expect(refusedBy('site', 'network_segment')).toBe('NEST-01')
  })

  it('NEST-02 a zone sits at the top, in a site or in a network segment', () => {
    for (const parent of [null, 'site', 'network_segment']) expect(refusedBy('zone', parent), String(parent)).toBeUndefined()
    expect(refusedBy('zone', 'zone')).toBe('NEST-02')
    expect(refusedBy('zone', 'hypervisor_cluster')).toBe('NEST-02')
  })

  it('NEST-03 network segments nest in site > zone > segment (REQ-DES-004)', () => {
    for (const parent of [null, 'site', 'zone', 'network_segment']) expect(refusedBy('network_segment', parent), String(parent)).toBeUndefined()
    expect(refusedBy('network_segment', 'container_platform')).toBe('NEST-03')
  })

  it('NEST-04 clusters sit at the top or in site, zone or segment', () => {
    for (const cluster of ['container_platform', 'hypervisor_cluster']) {
      expect(refusedBy(cluster, 'network_segment')).toBeUndefined()
      expect(refusedBy(cluster, 'hypervisor_cluster')).toBe('NEST-04')
    }
  })

  it('NEST-05 workloads and data go in segments and clusters, with the role labels in the message', () => {
    expect(refusedBy('service', 'network_segment')).toBeUndefined()
    const verdict = canNest('relational_db', 'relational_db')
    expect(verdict).toEqual({
      ok: false,
      ruleId: 'NEST-05',
      message: { en: 'Relational database cannot be placed inside Relational database.', vi: 'Không thể đặt Cơ sở dữ liệu quan hệ bên trong Cơ sở dữ liệu quan hệ.' },
    })
  })

  it('NEST-06 physical equipment never goes inside a cluster', () => {
    expect(refusedBy('san', 'zone')).toBeUndefined()
    expect(refusedBy('bare_metal_host', 'network_segment')).toBeUndefined()
    expect(refusedBy('switch', 'hypervisor_cluster')).toBe('NEST-06')
    expect(refusedBy('router', 'container_platform')).toBe('NEST-06')
  })

  it('NEST-07 clients, external services, DNS, CDN, DDoS protection and functions are outside your networks', () => {
    expect(refusedBy('client', null)).toBeUndefined()
    expect(refusedBy('dns', 'site')).toBeUndefined()
    const verdict = canNest('cdn', 'network_segment')
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.ruleId).toBe('NEST-07')
      expect(verdict.message.en).toBe('Content delivery network is outside your networks: place it at the top level or directly in a site.')
    }
  })

  it('NEST-08 annotations go anywhere a container is, but not inside a non-container', () => {
    for (const parent of [null, 'site', 'zone', 'network_segment', 'container_platform', 'hypervisor_cluster']) {
      expect(refusedBy('note', parent), String(parent)).toBeUndefined()
    }
    expect(refusedBy('note', 'service')).toBe('NEST-08')
  })

  it('NEST-09 a hypervisor cluster holds virtual machines only', () => {
    expect(refusedBy('virtual_machine', 'hypervisor_cluster')).toBeUndefined()
    expect(refusedBy('service', 'hypervisor_cluster')).toBe('NEST-09')
    expect(refusedBy('relational_db', 'hypervisor_cluster')).toBe('NEST-09')
  })

  it('NEST-10 a container platform holds workloads, data, messaging and ingress only', () => {
    for (const child of ['service', 'relational_db', 'queue', 'load_balancer', 'reverse_proxy']) {
      expect(refusedBy(child, 'container_platform'), child).toBeUndefined()
    }
    expect(refusedBy('virtual_machine', 'container_platform')).toBe('NEST-10')
    expect(refusedBy('firewall', 'container_platform')).toBe('NEST-10')
  })

  it('every rule in the catalogue is exercised above', () => {
    expect(catalog.nestRules.map((rule) => rule.id)).toEqual(['NEST-01', 'NEST-02', 'NEST-03', 'NEST-04', 'NEST-05', 'NEST-06', 'NEST-07', 'NEST-08', 'NEST-09', 'NEST-10'])
  })

  it('a non-container parent is refused, and an unknown child is an integrity refusal', () => {
    expect(refusedBy('service', 'relational_db')).toBe('NEST-05')
    expect(refusedBy('quantum_router', null)).toBe('INT-UNKNOWN-ROLE')
  })

  it('every role can live somewhere, and every placement the rich fixture uses is allowed', () => {
    for (const role of catalog.roles) expect(canNest(role.id, null).ok, role.id).toBe(true)
    const byId = new Map(hybrid.nodes.map((n) => [n.id, n]))
    for (const n of hybrid.nodes) {
      const parent = n.parentId ? byId.get(n.parentId)!.type : null
      expect(canNest(n.type, parent).ok, n.id).toBe(true)
    }
  })
})

describe('ancestry and depth', () => {
  it('walks ancestors nearest first and measures depth from 1', () => {
    expect(ancestors(hybrid, 'n10')).toEqual(['n9', 'n5', 'n3', 'n1'])
    expect(depthOf(hybrid, 'n10')).toBe(5)
    expect(depthOf(hybrid, 'n18')).toBe(1)
  })

  it('lists children and descendants in document order', () => {
    expect(childrenOf(hybrid, 'n9').map((n) => n.id)).toEqual(['n10'])
    expect(descendants(hybrid, 'n5')).toEqual(['n9', 'n10', 'n11', 'n12', 'n14'])
    expect(subtreeHeight(hybrid, 'n3')).toBe(4)
    expect(subtreeHeight(hybrid, 'n10')).toBe(1)
  })

  it('never loops on a corrupt document', () => {
    const loop = doc([node('a', 'zone', 'b'), node('b', 'zone', 'a'), node('c', 'service', 'a')])
    expect(ancestors(loop, 'c')).toEqual(['a', 'b'])
    expect(descendants(loop, 'a')).toEqual(['b', 'c'])
  })
})

describe('validParents (the keyboard path for re-parenting)', () => {
  it('offers only allowed containers, never the node itself or its descendants', () => {
    expect(validParents(hybrid, 'n11')).toEqual([null, 'n1', 'n20', 'n3', 'n4', 'n5', 'n6'])
    expect(validParents(hybrid, 'n10')).toEqual([null, 'n1', 'n20', 'n3', 'n4', 'n5', 'n6', 'n9'])
    expect(validParents(hybrid, 'n3')).not.toContain('n4')
    expect(validParents(hybrid, 'missing')).toEqual([])
  })

  it('drops a container when the move would break the depth limit', () => {
    const levels = ['site', 'network_segment', 'zone', 'network_segment', 'network_segment']
    const nodes = levels.map((type, i) => node(`l${i + 1}`, type, i === 0 ? undefined : `l${i}`))
    nodes.push(node('seg', 'network_segment'), node('svc', 'service', 'seg'))
    const deep = doc(nodes)
    expect(validParents(deep, 'svc')).toContain('l5') // l5 is depth 5, svc lands at 6
    expect(validParents(deep, 'seg')).not.toContain('l5') // seg at 6 would put svc at 7
    expect(validParents(deep, 'seg')).toContain('l4')
  })
})

describe('effective failure domain (REQ-DES-025)', () => {
  it("a node's own level wins", () => {
    expect(effectiveFailureDomain(hybrid, 'n13')).toEqual({ level: 'rack', label: 'dc1', source: 'node' })
  })

  it('a zone or site container supplies level and label to its children', () => {
    expect(effectiveFailureDomain(hybrid, 'n15')).toEqual({ level: 'rack', label: 'room-a', source: 'container', fromNodeId: 'n20' })
    expect(effectiveFailureDomain(hybrid, 'n14')).toEqual({ level: 'site', label: 'dc1', source: 'container', fromNodeId: 'n1' })
  })

  it('a failure-domain role (zone, site, hypervisor cluster) is its own domain', () => {
    expect(effectiveFailureDomain(hybrid, 'n20')).toEqual({ level: 'rack', label: 'room-a', source: 'node' })
    expect(effectiveFailureDomain(hybrid, 'n9')).toEqual({ level: 'host', label: 'prod_cluster', source: 'role' })
  })

  it('outside any zone or site there is nothing to inherit', () => {
    expect(effectiveFailureDomain(hybrid, 'n21')).toEqual({ source: 'none' })
    expect(effectiveFailureDomain(hybrid, 'missing')).toEqual({ source: 'none' })
  })

  it('a label alone keeps the inherited level', () => {
    const d = doc([node('s', 'site'), node('db', 'relational_db', 's', { attributes: { failureDomainLabel: 'rack-2' } })])
    expect(effectiveFailureDomain(d, 'db')).toEqual({ level: 'site', label: 'rack-2', source: 'container', fromNodeId: 's' })
  })
})

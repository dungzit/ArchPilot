import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { applyCommand, applyCommands, nextEdgeId, nextNodeId, type Command, type CommandResult } from './commands'
import { integrityErrors } from './validate'
import type { ArchGraphV2 } from './types'

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), '../../../contracts/fixtures')
const load = (name: string) => JSON.parse(readFileSync(resolve(fixtures, name), 'utf-8')) as ArchGraphV2

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

const hybrid = deepFreeze(load('archgraph.v2-hybrid-orders.valid.json'))
const empty = deepFreeze(load('archgraph.v2-minimal.valid.json'))

function ok(result: CommandResult): ArchGraphV2 {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message.en}`)
  expect(integrityErrors(result.document), 'a command must never create an integrity error').toEqual([])
  return result.document
}

function refused(result: CommandResult): string {
  if (result.ok) throw new Error('expected a refusal')
  expect(result.error.message.en.length).toBeGreaterThan(0)
  expect(result.error.message.vi.length).toBeGreaterThan(0)
  return result.error.code
}

const node = (doc: ArchGraphV2, id: string) => doc.nodes.find((n) => n.id === id)

describe('ids', () => {
  it('derives the next ids from the document, so they are deterministic', () => {
    expect(nextNodeId(empty)).toBe('n1')
    expect(nextNodeId(hybrid)).toBe('n22')
    expect(nextEdgeId(hybrid)).toBe('e9')
  })
})

describe('addNode', () => {
  it('adds a node with a code name from its label, inside a valid container', () => {
    const doc = ok(applyCommand(hybrid, { type: 'addNode', role: 'cache', label: 'Bộ đệm Đơn hàng', position: { x: 10, y: 20 }, parentId: 'n6' }))
    expect(node(doc, 'n22')).toEqual({ id: 'n22', type: 'cache', label: 'Bộ đệm Đơn hàng', codeName: 'bo_dem_don_hang', position: { x: 10, y: 20 }, parentId: 'n6' })
  })

  it('returns the created id and trims the label', () => {
    const result = applyCommand(empty, { type: 'addNode', role: 'service', label: '  Orders API ', position: { x: 0, y: 0 } })
    expect(result.ok && result.createdId).toBe('n1')
    expect(ok(result).nodes[0].label).toBe('Orders API')
  })

  it('makes the code name unique', () => {
    const doc = ok(applyCommand(hybrid, { type: 'addNode', role: 'service', variant: 'api', label: 'Orders API', position: { x: 0, y: 0 }, parentId: 'n5' }))
    expect(node(doc, 'n22')?.codeName).toBe('orders_api_2')
  })

  it('refuses an invalid drop with the NEST rule id and a bilingual message (the toast)', () => {
    const result = applyCommand(hybrid, { type: 'addNode', role: 'service', label: 'x', position: { x: 0, y: 0 }, parentId: 'n9' })
    expect(refused(result)).toBe('NEST-09')
    if (!result.ok) expect(result.error.message.en).toBe('A hypervisor cluster holds virtual machines only.')
  })

  it.each<[string, Partial<Extract<Command, { type: 'addNode' }>>, string]>([
    ['unknown role', { role: 'mainframe' }, 'INT-UNKNOWN-ROLE'],
    ['legacy role id', { role: 'database' }, 'INT-UNKNOWN-ROLE'],
    ['unknown variant', { role: 'service', variant: 'lambda_like' }, 'INT-UNKNOWN-VARIANT'],
    ['blank label', { label: '   ' }, 'CMD-INVALID-LABEL'],
    ['long label', { label: 'x'.repeat(121) }, 'CMD-INVALID-LABEL'],
    ['NaN position', { position: { x: Number.NaN, y: 0 } }, 'CMD-INVALID-POSITION'],
    ['missing parent', { parentId: 'n404' }, 'CMD-NO-SUCH-NODE'],
    ['taken id', { id: 'n1' }, 'CMD-DUPLICATE-ID'],
    ['bad attribute enum', { attributes: { failureDomainLevel: 'datacenter' as never } }, 'CMD-INVALID-ATTRIBUTE'],
    ['replicas out of range', { attributes: { replicas: 0 } }, 'CMD-INVALID-ATTRIBUTE'],
    ['old attribute name', { attributes: { stateful: true } as never }, 'CMD-INVALID-ATTRIBUTE'],
  ])('refuses %s', (_name, override, code) => {
    const command = { type: 'addNode', role: 'service', label: 'x', position: { x: 0, y: 0 }, ...override } as Command
    expect(refused(applyCommand(hybrid, command))).toBe(code)
  })

  it('refuses beyond the depth limit', () => {
    let doc = empty
    const levels = ['site', 'network_segment', 'zone', 'network_segment', 'network_segment', 'network_segment']
    levels.forEach((role, index) => {
      doc = ok(applyCommand(doc, { type: 'addNode', role, label: `L${index + 1}`, position: { x: 0, y: 0 }, parentId: index === 0 ? null : `n${index}` }))
    })
    expect(refused(applyCommand(doc, { type: 'addNode', role: 'service', label: 'too deep', position: { x: 0, y: 0 }, parentId: 'n6' }))).toBe('INT-DEPTH')
  })

  it('refuses the 501st node', () => {
    const full: ArchGraphV2 = { ...empty, nodes: Array.from({ length: 500 }, (_, i) => ({ id: `x${i}`, type: 'note', label: 'n', codeName: `note_${i}`, position: { x: 0, y: 0 } })) }
    expect(refused(applyCommand(full, { type: 'addNode', role: 'note', label: 'one more', position: { x: 0, y: 0 } }))).toBe('CMD-LIMIT')
  })
})

describe('rename, code name, move, resize, update', () => {
  it('renaming never changes the code name (REQ-DES-008, NFR2-DET-003)', () => {
    const doc = ok(applyCommand(hybrid, { type: 'renameNode', id: 'n13', label: 'Primary orders store' }))
    expect(node(doc, 'n13')).toMatchObject({ label: 'Primary orders store', codeName: 'orders_db' })
  })

  it('changing a code name is explicit, validated and unique', () => {
    expect(node(ok(applyCommand(hybrid, { type: 'setCodeName', id: 'n13', codeName: 'orders_primary' })), 'n13')?.codeName).toBe('orders_primary')
    expect(refused(applyCommand(hybrid, { type: 'setCodeName', id: 'n13', codeName: 'Orders DB' }))).toBe('CMD-INVALID-CODENAME')
    expect(refused(applyCommand(hybrid, { type: 'setCodeName', id: 'n13', codeName: 'orders_api' }))).toBe('INT-DUPLICATE-CODENAME')
    expect(node(ok(applyCommand(hybrid, { type: 'setCodeName', id: 'n13', codeName: 'orders_db' })), 'n13')?.codeName).toBe('orders_db')
  })

  it('moves and resizes', () => {
    const moved = ok(applyCommand(hybrid, { type: 'moveNode', id: 'n7', position: { x: 5, y: 6 } }))
    expect(node(moved, 'n7')?.position).toEqual({ x: 5, y: 6 })
    const resized = ok(applyCommand(hybrid, { type: 'resizeNode', id: 'n3', size: { width: 10, height: 20 } }))
    expect(node(resized, 'n3')?.size).toEqual({ width: 10, height: 20 })
    expect(refused(applyCommand(hybrid, { type: 'resizeNode', id: 'n3', size: { width: 0, height: 20 } }))).toBe('CMD-INVALID-SIZE')
    expect(refused(applyCommand(hybrid, { type: 'moveNode', id: 'nope', position: { x: 0, y: 0 } }))).toBe('CMD-NO-SUCH-NODE')
  })

  it('merges attributes and config, and null removes a key; an emptied map disappears', () => {
    let doc = ok(applyCommand(hybrid, { type: 'updateNode', id: 'n13', patch: { attributes: { replicas: 3, sizeClass: null }, config: { engineMajor: '17', deletionProtection: null } } }))
    expect(node(doc, 'n13')?.attributes).toEqual({ statefulness: 'stateful', replicas: 3, failureDomainLevel: 'rack', criticality: 'high', dataClassification: 'confidential' })
    expect(node(doc, 'n13')?.config).toEqual({ engine: 'postgresql', engineMajor: '17', storageGiB: 120, backupRetentionDays: 7 })
    doc = ok(applyCommand(doc, { type: 'updateNode', id: 'n16', patch: { config: { ports: null, speedGbps: null, redundantPair: null } } }))
    expect(node(doc, 'n16')).not.toHaveProperty('config')
  })

  it('validates a variant change and clears it with null', () => {
    expect(node(ok(applyCommand(hybrid, { type: 'updateNode', id: 'n12', patch: { variant: 'scheduler' } })), 'n12')?.variant).toBe('scheduler')
    expect(node(ok(applyCommand(hybrid, { type: 'updateNode', id: 'n12', patch: { variant: null } })), 'n12')).not.toHaveProperty('variant')
    expect(refused(applyCommand(hybrid, { type: 'updateNode', id: 'n13', patch: { variant: 'relational' } }))).toBe('INT-UNKNOWN-VARIANT')
  })

  it('sets and clears a rationale', () => {
    const doc = ok(applyCommand(hybrid, { type: 'updateNode', id: 'n7', patch: { rationale: 'Two for failover.' } }))
    expect(node(doc, 'n7')?.rationale).toBe('Two for failover.')
    expect(node(ok(applyCommand(doc, { type: 'updateNode', id: 'n7', patch: { rationale: '' } })), 'n7')).not.toHaveProperty('rationale')
  })
})

describe('reparentNode', () => {
  it('moves a node into another valid container', () => {
    const doc = ok(applyCommand(hybrid, { type: 'reparentNode', id: 'n11', parentId: 'n4', position: { x: 1, y: 2 } }))
    expect(node(doc, 'n11')).toMatchObject({ parentId: 'n4', position: { x: 1, y: 2 } })
  })

  it('moves a node to the top level (parentId removed)', () => {
    const doc = ok(applyCommand(hybrid, { type: 'reparentNode', id: 'n17', parentId: null, position: { x: 0, y: 0 } }))
    expect(node(doc, 'n17')).not.toHaveProperty('parentId')
  })

  it('refuses a cycle, a NEST violation and a depth overflow', () => {
    expect(refused(applyCommand(hybrid, { type: 'reparentNode', id: 'n3', parentId: 'n5', position: { x: 0, y: 0 } }))).toBe('INT-PARENT-CYCLE')
    expect(refused(applyCommand(hybrid, { type: 'reparentNode', id: 'n3', parentId: 'n3', position: { x: 0, y: 0 } }))).toBe('INT-PARENT-CYCLE')
    expect(refused(applyCommand(hybrid, { type: 'reparentNode', id: 'n16', parentId: 'n9', position: { x: 0, y: 0 } }))).toBe('NEST-06')
    const deepSite = ok(applyCommands(hybrid, [
      { type: 'addNode', role: 'network_segment', label: 'a', position: { x: 0, y: 0 }, parentId: 'n6' },
      { type: 'addNode', role: 'network_segment', label: 'b', position: { x: 0, y: 0 }, parentId: 'n22' },
    ]))
    // n3's subtree is 4 levels; under n23 (depth 5) it would reach 9.
    expect(refused(applyCommand(deepSite, { type: 'reparentNode', id: 'n3', parentId: 'n23', position: { x: 0, y: 0 } }))).toBe('INT-PARENT-CYCLE')
    expect(refused(applyCommand(deepSite, { type: 'reparentNode', id: 'n5', parentId: 'n23', position: { x: 0, y: 0 } }))).toBe('INT-DEPTH')
  })
})

describe('removeNode', () => {
  it('delete removes the subtree and every reference to it', () => {
    const doc = ok(applyCommand(hybrid, { type: 'removeNode', id: 'n6', children: 'delete' }))
    expect(node(doc, 'n6')).toBeUndefined()
    expect(node(doc, 'n13')).toBeUndefined()
    expect(doc.edges.map((e) => e.id)).toEqual(['e1', 'e2', 'e4', 'e5', 'e7'])
    expect(doc.deployment?.bindings?.map((b) => b.nodeId)).toEqual(['n11'])
    expect(doc.deployment?.scenarios[2].placements).toEqual([{ nodeId: 'n15', profileId: 'dc1_vsphere' }])
    expect(doc.decisions?.[0].linkedNodeIds).toEqual([])
  })

  it('lift keeps the children, one level up, at the same place on the canvas', () => {
    const doc = ok(applyCommand(hybrid, { type: 'removeNode', id: 'n9', children: 'lift' }))
    expect(node(doc, 'n10')).toMatchObject({ parentId: 'n5', position: { x: 640, y: 100 } })
  })

  it('lift to the top level drops parentId', () => {
    const doc = ok(applyCommands(empty, [
      { type: 'addNode', role: 'container_platform', label: 'k8s', position: { x: 10, y: 10 } },
      { type: 'addNode', role: 'service', label: 'svc', position: { x: 5, y: 5 }, parentId: 'n1' },
    ]))
    const lifted = ok(applyCommand(doc, { type: 'removeNode', id: 'n1', children: 'lift' }))
    expect(lifted.nodes).toEqual([{ id: 'n2', type: 'service', label: 'svc', codeName: 'svc', position: { x: 15, y: 15 } }])
  })

  it('lift is refused when a child may not live one level up (a NEST-violating import)', () => {
    const imported: ArchGraphV2 = {
      ...empty,
      nodes: [
        { id: 'hv', type: 'hypervisor_cluster', label: 'hv', codeName: 'hv', position: { x: 0, y: 0 } },
        { id: 'seg', type: 'network_segment', label: 'seg', codeName: 'seg', position: { x: 0, y: 0 }, parentId: 'hv' },
        { id: 'svc', type: 'service', label: 'svc', codeName: 'svc', position: { x: 0, y: 0 }, parentId: 'seg' },
      ],
    }
    expect(refused(applyCommand(imported, { type: 'removeNode', id: 'seg', children: 'lift' }))).toBe('NEST-09')
    expect(ok(applyCommand(imported, { type: 'removeNode', id: 'seg', children: 'delete' })).nodes.map((n) => n.id)).toEqual(['hv'])
  })

  it('clears a wizard suggestion link to a removed node', () => {
    const doc = ok(applyCommand(hybrid, { type: 'removeNode', id: 'n14', children: 'delete' }))
    expect(doc.brief?.suggestions?.[0]).not.toHaveProperty('nodeId')
  })
})

describe('edges', () => {
  it('adds an access edge with defaults and refuses duplicates and dangling ends', () => {
    const result = applyCommand(hybrid, { type: 'addEdge', source: 'n11', target: 'n21', kind: 'access', mode: 'write', protocol: 'https', port: 443 })
    const doc = ok(result)
    expect(doc.edges.at(-1)).toEqual({ id: 'e9', source: 'n11', target: 'n21', label: '', direction: 'forward', kind: 'access', mode: 'write', protocol: 'https', port: 443 })
    expect(refused(applyCommand(doc, { type: 'addEdge', source: 'n11', target: 'n21', kind: 'access', mode: 'write' }))).toBe('CMD-DUPLICATE-EDGE')
    expect(refused(applyCommand(doc, { type: 'addEdge', source: 'n11', target: 'nx', kind: 'flow' }))).toBe('CMD-NO-SUCH-NODE')
    expect(refused(applyCommand(doc, { type: 'addEdge', source: 'n11', target: 'n13', kind: 'flow', port: 70000 }))).toBe('CMD-INVALID-PORT')
  })

  it('updates kind and mode, clears optional fields with null, and removes', () => {
    let doc = ok(applyCommand(hybrid, { type: 'updateEdge', id: 'e3', patch: { mode: null, protocol: null, port: null, kind: 'flow', label: ' stores ' } }))
    expect(doc.edges.find((e) => e.id === 'e3')).toEqual({ id: 'e3', source: 'n11', target: 'n13', label: 'stores', direction: 'forward', kind: 'flow' })
    doc = ok(applyCommand(doc, { type: 'removeEdge', id: 'e3' }))
    expect(doc.edges.find((e) => e.id === 'e3')).toBeUndefined()
    expect(refused(applyCommand(doc, { type: 'removeEdge', id: 'e3' }))).toBe('CMD-NO-SUCH-EDGE')
  })
})

describe('deployment layer: bindings and placements (review B2 data shape)', () => {
  it('re-targeting is lossless: bindings for other targets are kept and a re-choice keeps its place', () => {
    let doc = ok(applyCommand(hybrid, { type: 'setBinding', nodeId: 'n13', target: 'vsphere', realisation: 'vsphere.vm_group', config: { vcpu: 8 } }))
    expect(doc.deployment?.bindings).toEqual([
      { nodeId: 'n13', target: 'aws', realisation: 'aws.rds', config: { instanceClass: 'db.t4g.medium' } },
      { nodeId: 'n13', target: 'vsphere', realisation: 'vsphere.vm_group', config: { vcpu: 8 } },
      { nodeId: 'n11', target: 'vsphere', realisation: 'vsphere.vm_group' },
    ])
    doc = ok(applyCommand(doc, { type: 'setBinding', nodeId: 'n13', target: 'vsphere', realisation: null }))
    expect(doc.deployment?.bindings?.map((b) => `${b.nodeId}:${b.target}`)).toEqual(['n13:aws', 'n11:vsphere'])
  })

  it('creates the deployment section on the first binding, and never touches the node', () => {
    const doc = ok(applyCommand(empty, { type: 'addNode', role: 'relational_db', label: 'db', position: { x: 0, y: 0 } }))
    const bound = ok(applyCommand(doc, { type: 'setBinding', nodeId: 'n1', target: 'bare_metal', realisation: 'bare_metal.server_pair' }))
    expect(bound.deployment).toEqual({ profiles: [], scenarios: [], bindings: [{ nodeId: 'n1', target: 'bare_metal', realisation: 'bare_metal.server_pair' }] })
    expect(bound.nodes[0]).toEqual(doc.nodes[0])
  })

  it.each<[string, Extract<Command, { type: 'setBinding' }>, string]>([
    ['missing node', { type: 'setBinding', nodeId: 'zz', target: 'aws', realisation: 'aws.rds' }, 'CMD-NO-SUCH-NODE'],
    ['bad target', { type: 'setBinding', nodeId: 'n13', target: 'AWS', realisation: 'aws.rds' }, 'CMD-INVALID-TARGET'],
    ['bad realisation', { type: 'setBinding', nodeId: 'n13', target: 'aws', realisation: 'rds' }, 'CMD-INVALID-REALISATION'],
  ])('refuses a binding with a %s', (_name, command, code) => {
    expect(refused(applyCommand(hybrid, command))).toBe(code)
  })

  it('places a node on another profile in a scenario, and placing it on the default clears the override', () => {
    let doc = ok(applyCommand(hybrid, { type: 'setPlacement', scenarioId: 'hybrid', nodeId: 'n11', profileId: 'dc1_vsphere' }))
    expect(doc.deployment?.scenarios[2].placements?.map((p) => p.nodeId)).toEqual(['n13', 'n15', 'n11'])
    doc = ok(applyCommand(doc, { type: 'setPlacement', scenarioId: 'hybrid', nodeId: 'n11', profileId: 'aws_sg' }))
    expect(doc.deployment?.scenarios[2].placements?.map((p) => p.nodeId)).toEqual(['n13', 'n15'])
    expect(refused(applyCommand(hybrid, { type: 'setPlacement', scenarioId: 'nope', nodeId: 'n11', profileId: null }))).toBe('CMD-NO-SUCH-SCENARIO')
    expect(refused(applyCommand(hybrid, { type: 'setPlacement', scenarioId: 'hybrid', nodeId: 'n11', profileId: 'gcp_x' }))).toBe('INT-UNKNOWN-PROFILE')
  })
})

describe('purity and atomicity', () => {
  it('never mutates its (deep-frozen) input and is deterministic', () => {
    const before = JSON.stringify(hybrid)
    const commands: Command[] = [
      { type: 'addNode', role: 'cache', label: 'c', position: { x: 0, y: 0 }, parentId: 'n6' },
      { type: 'addEdge', source: 'n11', target: 'n22', kind: 'access', mode: 'read' },
      { type: 'removeNode', id: 'n5', children: 'delete' },
    ]
    const first = ok(applyCommands(hybrid, commands))
    const second = ok(applyCommands(hybrid, commands))
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    expect(JSON.stringify(hybrid)).toBe(before)
  })

  it('applyCommands is all-or-nothing', () => {
    const result = applyCommands(hybrid, [
      { type: 'addNode', role: 'cache', label: 'c', position: { x: 0, y: 0 }, parentId: 'n6' },
      { type: 'addNode', role: 'site', label: 'bad', position: { x: 0, y: 0 }, parentId: 'n6' },
    ])
    expect(refused(result)).toBe('NEST-01')
  })
})

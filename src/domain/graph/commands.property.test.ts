/**
 * Property test for the command layer (review-v2-phase0).
 *
 * commands.ts promises: pure (inputs never mutated), atomic (a refusal returns
 * no document) and "never produces an L1 integrity error from a clean
 * document". This drives 300 seeded random sequences of 60 commands each -
 * every command type, valid and invalid arguments, nesting, lift/delete,
 * bindings and placements - from a deep-frozen start document, and after every
 * accepted command asserts: no integrity error, and the document still
 * matches contracts/archgraph.schema.json.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020'
import { describe, expect, it } from 'vitest'
import { catalog, variantsOf } from './catalog'
import { applyCommand, type Command } from './commands'
import type { ArchGraphV2 } from './types'
import { integrityErrors } from './validate'

const contract = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../contracts/archgraph.schema.json'), 'utf-8'),
) as { $id: string }
const AjvCtor = ((Ajv2020 as unknown as { default?: typeof Ajv2020 }).default ?? Ajv2020) as typeof Ajv2020
const ajv = new AjvCtor({ strict: false, allErrors: true })
ajv.addSchema(contract)
const validArchGraph = ajv.getSchema(`${contract.$id}#/$defs/archGraph`)!

function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const item of Object.values(value)) deepFreeze(item)
  }
  return value
}

const START: ArchGraphV2 = {
  schemaVersion: '2.0',
  settings: { codeName: 'fuzz', environment: 'dev' },
  nodes: [],
  edges: [],
  deployment: {
    profiles: [
      { id: 'cloud', target: 'aws', label: 'Cloud' },
      { id: 'dc', target: 'vsphere', label: 'Data centre' },
    ],
    scenarios: [
      { id: 's1', label: 'Primary', defaultProfileId: 'cloud' },
      { id: 's2', label: 'Hybrid', defaultProfileId: 'dc', placements: [] },
    ],
    activeScenarioId: 's1',
  },
  decisions: [{ id: 'd1', number: 1, title: 'Start', status: 'accepted', linkedNodeIds: [] }],
}

const ROLES = catalog.roles.map((role) => role.id)
const MODES = catalog.edgeModes.map((mode) => mode.id)
const LABELS = ['Web', 'Orders DB', 'Đơn hàng', '3rd party', '!!!', 'x'.repeat(120), '  padded  ', '']

function randomCommand(doc: ArchGraphV2, random: () => number): Command {
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)]
  const ids = doc.nodes.map((node) => node.id)
  const anyId = () => (ids.length && random() < 0.9 ? pick(ids) : 'ghost')
  const edgeIds = doc.edges.map((edge) => edge.id)
  const position = () => ({ x: Math.round(random() * 800), y: Math.round(random() * 600) })
  switch (Math.floor(random() * 13)) {
    case 0:
    case 1: {
      const role = pick(ROLES)
      const variants = variantsOf(role)
      return {
        type: 'addNode', role, label: pick(LABELS), position: position(),
        parentId: random() < 0.5 && ids.length ? pick(ids) : null,
        ...(variants.length && random() < 0.5 ? { variant: pick(variants) } : {}),
        ...(random() < 0.3 ? { attributes: { replicas: 1 + Math.floor(random() * 3), failureDomainLevel: 'zone' as const } } : {}),
        ...(random() < 0.2 ? { config: { port: 8080, note: 'n' } } : {}),
      }
    }
    case 2: return { type: 'moveNode', id: anyId(), position: position() }
    case 3: return { type: 'renameNode', id: anyId(), label: pick(LABELS) }
    case 4: return { type: 'setCodeName', id: anyId(), codeName: pick(['svc', 'orders_db', 'web', 'Bad-Name', doc.nodes[0]?.codeName ?? 'x']) }
    case 5: return { type: 'reparentNode', id: anyId(), parentId: random() < 0.3 ? null : anyId(), position: position() }
    case 6: {
      const id = anyId()
      const node = doc.nodes.find((candidate) => candidate.id === id)
      const variants = node ? variantsOf(node.type) : []
      return {
        type: 'updateNode', id,
        patch: {
          ...(random() < 0.3 ? { variant: variants.length ? pick([...variants, null]) : null } : {}),
          ...(random() < 0.5 ? { attributes: { replicas: pick([1, 2, 3, null]), statefulness: pick(['stateful', 'stateless', null] as const) } } : {}),
          ...(random() < 0.3 ? { config: { port: pick([443, null]) } } : {}),
          ...(random() < 0.2 ? { rationale: pick(['why', '', null]) } : {}),
        },
      }
    }
    case 7: return { type: 'removeNode', id: anyId(), children: pick(['delete', 'lift'] as const) }
    case 8: {
      const kind = pick(['flow', 'access'] as const)
      return { type: 'addEdge', source: anyId(), target: anyId(), kind, ...(kind === 'access' && random() < 0.7 ? { mode: pick(MODES) } : {}), label: pick(['', 'reads', 'x'.repeat(121)]) }
    }
    case 9: return { type: 'updateEdge', id: edgeIds.length ? pick(edgeIds) : 'nope', patch: { label: 'l', kind: pick(['flow', 'access'] as const), mode: random() < 0.5 ? pick(MODES) : null, port: pick([443, null, 0]) } }
    case 10: return { type: 'removeEdge', id: edgeIds.length ? pick(edgeIds) : 'nope' }
    case 11: return { type: 'setBinding', nodeId: anyId(), target: pick(['aws', 'vsphere', 'Bad']), realisation: pick(['aws.rds', 'vsphere.vm', null, 'bad']) }
    default: return { type: 'setPlacement', scenarioId: pick(['s1', 's2', 's9']), nodeId: anyId(), profileId: pick(['cloud', 'dc', null, 'nope']) }
  }
}

describe('applyCommand over 300 random sequences of 60 commands', () => {
  it('never mutates its input, and every accepted command leaves the document integrity-clean and contract-valid', () => {
    let accepted = 0
    let refused = 0
    const counts = new Map<string, number>()
    for (let seed = 1; seed <= 300; seed += 1) {
      const random = prng(seed)
      let doc = deepFreeze(structuredClone(START))
      for (let step = 0; step < 60; step += 1) {
        const command = randomCommand(doc, random)
        const snapshot = JSON.stringify(doc)
        const result = applyCommand(doc, command)
        expect(JSON.stringify(doc), `seed ${seed} step ${step}: ${command.type} mutated its input`).toBe(snapshot)
        if (!result.ok) {
          refused += 1
          continue
        }
        accepted += 1
        counts.set(command.type, (counts.get(command.type) ?? 0) + 1)
        const errors = integrityErrors(result.document)
        expect(errors, `seed ${seed} step ${step}: ${JSON.stringify(command)}`).toEqual([])
        const valid = validArchGraph(result.document)
        expect(valid ? [] : validArchGraph.errors?.slice(0, 2), `seed ${seed} step ${step}: ${command.type}`).toEqual([])
        doc = deepFreeze(result.document)
      }
    }
    // The run is only meaningful if every command type was actually accepted many times.
    expect(accepted).toBeGreaterThan(4000)
    expect(refused).toBeGreaterThan(1000)
    for (const type of ['addNode', 'moveNode', 'renameNode', 'setCodeName', 'reparentNode', 'updateNode', 'removeNode', 'addEdge', 'updateEdge', 'removeEdge', 'setBinding', 'setPlacement']) {
      expect(counts.get(type) ?? 0, type).toBeGreaterThan(50)
    }
  }, 60_000) // ~2 s alone; generous so a loaded CI runner cannot flake it
})

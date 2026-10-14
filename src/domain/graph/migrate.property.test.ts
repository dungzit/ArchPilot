/**
 * Property test for migrateGraph 1.0 -> 2.0 (review-v2-phase0, item 4).
 *
 * The shared fixture pair pins one document byte for byte. This runs 400
 * seeded random 1.0 documents - Vietnamese, emoji-only, digit-first,
 * punctuation-only and 120-character labels, duplicate labels, props, sizing
 * links, rationales - and checks that migration is:
 *   - contract-valid (ajv against contracts/archgraph.schema.json),
 *   - integrity-clean whenever the input was,
 *   - lossless (every 1.0 field lands in its 2.0 place, order kept),
 *   - deterministic, idempotent and non-mutating.
 * Inputs stay inside the 2.0 limits (<= 500 nodes, props values <= 2000
 * chars); a 1.0 document beyond them is review finding m-MIG-1.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020'
import { describe, expect, it } from 'vitest'
import { catalog } from './catalog'
import { CODE_NAME_PATTERN } from './codeName'
import { migrateGraph } from './migrate'
import type { ArchGraphV1 } from './types'
import { integrityErrors } from './validate'

const contract = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../contracts/archgraph.schema.json'), 'utf-8'),
) as { $id: string }
const AjvCtor = ((Ajv2020 as unknown as { default?: typeof Ajv2020 }).default ?? Ajv2020) as typeof Ajv2020
const ajv = new AjvCtor({ strict: false, allErrors: true })
ajv.addSchema(contract)
const validArchGraph = ajv.getSchema(`${contract.$id}#/$defs/archGraph`)!

/** mulberry32: tiny seeded PRNG, test-only. */
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

const cp = (...points: number[]) => String.fromCodePoint(...points)
const LABELS = [
  'Web', 'API', 'Orders DB', 'orders db', 'Orders  DB', '3rd-party check', '!!!', '---', '42',
  cp(0x110, 0x1a1, 0x6e, 0x20, 0x68, 0xe0, 0x6e, 0x67), // Vietnamese, NFC
  'Do' + cp(0x31b, 0x301) + 'n', // combining marks (NFD-ish)
  cp(0x1f600, 0x1f680), // emoji only
  cp(0x65e5, 0x672c), // CJK only: folds to nothing
  'x'.repeat(120),
  'Service ' + 'y'.repeat(60),
]

function randomV1(random: () => number): { doc: ArchGraphV1; clean: boolean } {
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)]
  const types = Object.keys(catalog.legacyTypes['1.0'])
  const clean = random() < 0.7
  const nodeCount = Math.floor(random() * 30)
  const nodes: ArchGraphV1['nodes'] = []
  for (let i = 0; i < nodeCount; i += 1) {
    const node: ArchGraphV1['nodes'][number] = {
      id: clean ? `n${i}` : pick(['a', 'b', `n${i}`]),
      type: pick(types) as ArchGraphV1['nodes'][number]['type'],
      label: pick(LABELS),
      position: { x: Math.round((random() - 0.5) * 2000), y: random() * 100 },
    }
    if (random() < 0.3) node.rationale = pick(['', 'because', 'x'.repeat(4000)])
    if (random() < 0.3) node.sizingScenarioId = `scn_${i}`
    if (random() < 0.4) node.props = random() < 0.2 ? {} : { engine: pick(['pg', 'x'.repeat(2000)]), replicas: Math.floor(random() * 5), ratio: 0.25 }
    nodes.push(node)
  }
  const ids = nodes.map((node) => node.id)
  const edges: ArchGraphV1['edges'] = []
  const edgeCount = ids.length ? Math.floor(random() * 30) : 0
  for (let i = 0; i < edgeCount; i += 1) {
    const edge: ArchGraphV1['edges'][number] = {
      id: `e${i}`,
      source: clean ? pick(ids) : pick([...ids, 'ghost']),
      target: pick(ids),
      label: pick(['', 'reads', 'HTTPS 443']),
      direction: pick(['forward', 'bidirectional'] as const),
    }
    if (random() < 0.2) edge.rationale = 'why'
    edges.push(edge)
  }
  return { doc: { schemaVersion: '1.0', nodes, edges }, clean }
}

const CASES = Array.from({ length: 400 }, (_, index) => randomV1(prng(0x5eed + index)))

describe('migrateGraph 1.0 -> 2.0 over 400 random documents', { timeout: 60_000 }, () => {
  it('always produces a contract-valid 2.0 document', () => {
    const failures = CASES.map(({ doc }, index) => ({ index, ok: validArchGraph(migrateGraph(doc)), errors: validArchGraph.errors }))
      .filter((result) => !result.ok)
    expect(failures.slice(0, 3)).toEqual([])
  })

  it('is integrity-clean whenever the 1.0 input was', () => {
    for (const { doc, clean } of CASES.filter((c) => c.clean)) {
      expect(integrityErrors(doc)).toEqual([])
      expect(clean).toBe(true)
      expect(integrityErrors(migrateGraph(doc))).toEqual([])
    }
  })

  it('is lossless: every 1.0 field lands in its 2.0 place, in order', () => {
    for (const { doc } of CASES) {
      const out = migrateGraph(doc)
      expect(out.nodes).toHaveLength(doc.nodes.length)
      doc.nodes.forEach((node, index) => {
        const migrated = out.nodes[index]
        const ref = catalog.legacyTypes['1.0'][node.type]
        expect(migrated.id).toBe(node.id)
        expect(migrated.type).toBe(ref.role)
        expect(migrated.variant).toBe(ref.variant)
        expect(migrated.label).toBe(node.label)
        expect(migrated.position).toEqual(node.position)
        expect(migrated.rationale).toBe(node.rationale)
        expect(migrated.sizing).toEqual(node.sizingScenarioId ? { scenarioId: node.sizingScenarioId, stale: true } : undefined)
        expect(migrated.config).toEqual(node.props && Object.keys(node.props).length ? node.props : undefined)
        expect(migrated.codeName).toMatch(CODE_NAME_PATTERN)
      })
      expect(new Set(out.nodes.map((node) => node.codeName)).size).toBe(out.nodes.length)
      expect(out.edges).toEqual(doc.edges.map((edge) => ({ ...edge, kind: 'flow' })))
      expect(out.deployment).toBeUndefined()
    }
  })

  it('is deterministic, idempotent and leaves its input alone', () => {
    for (const { doc } of CASES) {
      const before = JSON.stringify(doc)
      const once = migrateGraph(doc)
      expect(JSON.stringify(migrateGraph(doc))).toBe(JSON.stringify(once))
      expect(migrateGraph(once)).toBe(once)
      expect(JSON.stringify(doc)).toBe(before)
    }
  })
})

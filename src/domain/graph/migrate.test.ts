import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { catalog } from './catalog'
import { MigrationError, isGraphV2, migrateGraph } from './migrate'
import type { ArchGraph, ArchGraphV1 } from './types'
import { validateGraph } from './validate'

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), '../../../contracts/fixtures')
const load = <T = ArchGraph>(name: string): T => JSON.parse(readFileSync(resolve(fixtures, name), 'utf-8')) as T

const input = load<ArchGraphV1>('archgraph.migration-v1.input.valid.json')
const expected = load('archgraph.migration-v1.expected.valid.json')

describe('migrateGraph 1.0 -> 2.0', () => {
  it('turns the shared input into the shared expected output, byte for byte', () => {
    const migrated = migrateGraph(input)
    expect(migrated).toEqual(expected)
    expect(JSON.stringify(migrated)).toBe(JSON.stringify(expected))
  })

  it('is deterministic and does not touch its input', () => {
    const before = JSON.stringify(input)
    expect(JSON.stringify(migrateGraph(input))).toBe(JSON.stringify(migrateGraph(input)))
    expect(JSON.stringify(input)).toBe(before)
  })

  it('produces an integrity-clean document', () => {
    expect(validateGraph(migrateGraph(input)).filter((problem) => problem.severity === 'error')).toEqual([])
  })

  it('maps every 1.0 type through the catalogue legacy table', () => {
    const migrated = migrateGraph(input)
    input.nodes.forEach((node, index) => {
      expect(migrated.nodes[index].type).toBe(catalog.legacyTypes['1.0'][node.type].role)
    })
  })

  it('adds no deployment: the target starts unset (REQ-TGT-003, review B1g)', () => {
    expect(migrateGraph(input).deployment).toBeUndefined()
  })

  it('makes every legacy edge a flow edge, so nothing silently starts producing access rules', () => {
    expect(migrateGraph(input).edges.every((edge) => edge.kind === 'flow' && edge.mode === undefined)).toBe(true)
  })

  it('names the design from options and records the catalogue version', () => {
    const migrated = migrateGraph(input, { name: 'Hệ thống Đơn hàng', environment: 'staging' })
    expect(migrated.settings).toEqual({ codeName: 'he_thong_don_hang', environment: 'staging', catalogueVersion: catalog.version })
  })

  it('returns a 2.0 document unchanged (same object)', () => {
    const v2 = load('archgraph.v2-hybrid-orders.valid.json')
    expect(isGraphV2(v2)).toBe(true)
    expect(migrateGraph(v2)).toBe(v2)
  })

  it('refuses an unknown schema version', () => {
    expect(() => migrateGraph({ schemaVersion: '1.1', nodes: [], edges: [] } as unknown as ArchGraph)).toThrow(MigrationError)
  })

  it('refuses a 1.0 type the legacy table does not know', () => {
    const bad = { ...input, nodes: [{ ...input.nodes[0], type: 'mainframe' }] } as unknown as ArchGraph
    expect(() => migrateGraph(bad)).toThrow(/has no 2.0 role/)
  })

  it('keeps empty props out of the migrated node', () => {
    const graph: ArchGraphV1 = { schemaVersion: '1.0', nodes: [{ id: 'n1', type: 'service', label: 'A', position: { x: 0, y: 0 }, props: {} }], edges: [] }
    expect(migrateGraph(graph).nodes[0]).toEqual({ id: 'n1', type: 'service', label: 'A', codeName: 'a', position: { x: 0, y: 0 } })
  })
})

/**
 * Document -> React Flow mapping (task 2.1) and the live-field merge that
 * keeps a drag alive while drop feedback re-renders nodes (found in the
 * headless-Chrome check: React Flow warning #015 before the fix).
 */
import { describe, expect, test } from 'vitest'
import type { ArchGraphV2 } from '../../domain/graph'
import type { Copy } from '../../ui/copy'
import type { DesignFlowNode } from './canvasParts'
import { mergeLive } from './DesignCanvas'
import { toFlowEdges, toFlowNodes } from './flowMapping'
import { sortedIssues } from './model/document'

const en = (value: Copy) => value.en

const doc: ArchGraphV2 = {
  schemaVersion: '2.0',
  settings: { codeName: 'orders', environment: 'dev' },
  nodes: [
    { id: 'n3', type: 'network_segment', label: 'App', codeName: 'app', position: { x: 24, y: 40 }, parentId: 'n2', size: { width: 400, height: 220 } },
    { id: 'n1', type: 'site', label: 'DC1', codeName: 'dc1', position: { x: 0, y: 0 } },
    { id: 'n2', type: 'zone', label: 'Room A', codeName: 'room_a', position: { x: 40, y: 40 }, parentId: 'n1' },
    { id: 'n4', type: 'service', label: 'Orders API', codeName: 'orders_api', position: { x: 24, y: 40 }, parentId: 'n3' },
    { id: 'n5', type: 'relational_db', label: 'Orders DB', codeName: 'orders_db', position: { x: 900, y: 0 } },
  ],
  edges: [
    { id: 'e1', source: 'n4', target: 'n5', label: '', direction: 'forward', kind: 'access', mode: 'read_write', protocol: 'tcp', port: 5432 },
    { id: 'e2', source: 'n1', target: 'n5', label: 'notes', direction: 'bidirectional', kind: 'flow' },
  ],
}

describe('toFlowNodes / toFlowEdges', () => {
  const input = { document: doc, selection: { kind: 'node' as const, id: 'n4' }, issues: sortedIssues(doc), language: 'en' as const, text: en }

  test('parents first, relative positions, sizes, container types, tags and accessible names', () => {
    const nodes = toFlowNodes(input)
    expect(nodes.map((node) => node.id)).toEqual(['n1', 'n5', 'n2', 'n3', 'n4'])
    const segment = nodes.find((node) => node.id === 'n3')!
    expect(segment).toMatchObject({ type: 'container', parentId: 'n2', width: 400, height: 220, position: { x: 24, y: 40 } })
    expect(segment.data.tag).toBe('zone-local')
    expect(segment.data.minWidth).toBe(24 + 184 + 24)
    const service = nodes.find((node) => node.id === 'n4')!
    expect(service).toMatchObject({ type: 'component', selected: true, width: 184, height: 56 })
    expect(service.ariaLabel).toBe('Orders API, Service, orders_api, in App, 1 connection')
    expect(nodes.find((node) => node.id === 'n1')!.width).toBe(760) // container default size
  })

  test('edges: access solid with mode wording and port; flow keeps its label; bidirectional has two markers', () => {
    const [access, flow] = toFlowEdges(input)
    expect(access.data).toEqual({ kind: 'access', text: 'reads and writes tcp/5432' })
    expect(access.ariaLabel).toBe('Orders API → Orders DB, access, reads and writes tcp/5432')
    expect(access.markerStart).toBeUndefined()
    expect(flow.data).toEqual({ kind: 'flow', text: 'notes' })
    expect(flow.markerStart).toBeDefined()
  })

  test('drop feedback is attached to the hovered container only', () => {
    const nodes = toFlowNodes({ ...input, drop: { containerId: 'n2', hint: { ok: false, message: 'NEST-07: …' } } })
    expect(nodes.find((node) => node.id === 'n2')!.data.drop).toEqual({ ok: false, message: 'NEST-07: …' })
    expect(nodes.find((node) => node.id === 'n3')!.data.drop).toBeUndefined()
  })
})

describe('mergeLive', () => {
  test('keeps measurements, and the live position of a node being dragged', () => {
    const derived = toFlowNodes({ document: doc, selection: null, issues: [], language: 'en', text: en })
    const current = derived.map((node) => (node.id === 'n5'
      ? { ...node, measured: { width: 184, height: 56 }, dragging: true, position: { x: 1234, y: 56 } }
      : { ...node, measured: { width: 10, height: 10 } })) as DesignFlowNode[]
    const merged = mergeLive(current, derived)
    const db = merged.find((node) => node.id === 'n5')!
    expect(db).toMatchObject({ position: { x: 1234, y: 56 }, dragging: true, measured: { width: 184, height: 56 } })
    expect(merged.find((node) => node.id === 'n4')!.position).toEqual({ x: 24, y: 40 })
    // after a refused drop the canvas snaps back to the document
    const back = mergeLive(current.map((node) => ({ ...node, dragging: false })), derived)
    expect(back.find((node) => node.id === 'n5')!.position).toEqual({ x: 900, y: 0 })
  })
})

/**
 * Phase 2 pure model: history (REQ-DES-010), editor reducer, geometry,
 * edge pair defaults (REQ-DES-005), gesture plans (REQ-DES-003/004) and the
 * ordered Issues list (REQ-DES-011). Node environment, no DOM.
 */
import { describe, expect, test } from 'vitest'
import { applyCommands, type ArchGraphV2, type Command } from '../../../domain/graph'
import { COALESCE_MS, HISTORY_LIMIT, canRedo, canUndo, createHistory, record, redo, undo } from './history'
import { createEditorState, currentDocument, redoEdit, runCommands, select, undoEdit } from './editor'
import { absolutePosition, containerAt, dropTargetFor, freeSpot, minContainerSize, newNodeLabel, parentFirstOrder } from './geometry'
import { commonModes, edgeDefaults } from './edgeDefaults'
import { planAddNode, planConnect, planMoveNode, planReparent } from './operations'
import { blankDesign, describeNode, openGraph, sortedIssues } from './document'

function build(commands: Command[], base: ArchGraphV2 = blankDesign('Test design')): ArchGraphV2 {
  const result = applyCommands(base, commands)
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message.en}`)
  return result.document
}

/** site n1 (0,0 760x480) > zone n2 (40,40 520x340) > segment n3 (24,40 400x220) > service n4 (24,40). */
function nested(): ArchGraphV2 {
  return build([
    { type: 'addNode', id: 'n1', role: 'site', label: 'DC1', position: { x: 0, y: 0 } },
    { type: 'resizeNode', id: 'n1', size: { width: 760, height: 480 } },
    { type: 'addNode', id: 'n2', role: 'zone', label: 'Room A', position: { x: 40, y: 40 }, parentId: 'n1' },
    { type: 'resizeNode', id: 'n2', size: { width: 520, height: 340 } },
    { type: 'addNode', id: 'n3', role: 'network_segment', label: 'App', position: { x: 24, y: 40 }, parentId: 'n2' },
    { type: 'resizeNode', id: 'n3', size: { width: 400, height: 220 } },
    { type: 'addNode', id: 'n4', role: 'service', label: 'Orders API', position: { x: 24, y: 40 }, parentId: 'n3' },
  ])
}

describe('history', () => {
  test('undo and redo walk the snapshots; a new edit clears redo', () => {
    let h = createHistory(1)
    h = record(h, 2)
    h = record(h, 3)
    expect(canUndo(h)).toBe(true)
    h = undo(h)
    expect(h.present).toBe(2)
    expect(canRedo(h)).toBe(true)
    h = redo(h)
    expect(h.present).toBe(3)
    h = undo(h)
    h = record(h, 9)
    expect(canRedo(h)).toBe(false)
    expect(h.past).toEqual([1, 2])
  })

  test(`keeps at least 50 steps (limit ${HISTORY_LIMIT}); the oldest fall off beyond the limit`, () => {
    let h = createHistory(0)
    for (let i = 1; i <= HISTORY_LIMIT + 20; i += 1) h = record(h, i)
    expect(h.past).toHaveLength(HISTORY_LIMIT)
    let steps = 0
    while (canUndo(h)) { h = undo(h); steps += 1 }
    expect(steps).toBe(HISTORY_LIMIT)
    expect(steps).toBeGreaterThanOrEqual(50)
    expect(h.present).toBe(20)
  })

  test('same coalesce key within 1 s is one step; a pause or another key starts a new one', () => {
    let h = createHistory('')
    h = record(h, 'a', { coalesceKey: 'n1.label', now: 0 })
    h = record(h, 'ab', { coalesceKey: 'n1.label', now: 400 })
    h = record(h, 'abc', { coalesceKey: 'n1.label', now: 800 })
    expect(h.past).toEqual([''])
    h = record(h, 'abcd', { coalesceKey: 'n1.label', now: 800 + COALESCE_MS + 1 })
    h = record(h, 'x', { coalesceKey: 'n2.label', now: 1900 })
    expect(h.past).toEqual(['', 'abc', 'abcd'])
    expect(undo(h).present).toBe('abcd')
  })

  test('recording the same object is not a step', () => {
    const h = createHistory({ a: 1 })
    expect(record(h, h.present)).toBe(h)
  })
})

describe('editor reducer', () => {
  test('a refused command leaves state untouched and returns the NEST rule', () => {
    const state = createEditorState(nested())
    const result = runCommands(state, [{ type: 'addNode', role: 'site', label: 'Inner', position: { x: 0, y: 0 }, parentId: 'n2' }])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('NEST-01')
    expect(result.state).toBe(state)
  })

  test('a multi-command run is one undo step and undo clears a vanished selection', () => {
    let state = createEditorState(blankDesign('x'))
    const plan = planAddNode(currentDocument(state), 'site', 'en', { parentId: null })
    if (!plan.ok) throw new Error(plan.error.code)
    const result = runCommands(state, plan.commands, { select: { kind: 'node', id: plan.createdId! } })
    if (!result.ok) throw new Error(result.error.code)
    state = result.state
    expect(currentDocument(state).nodes[0].size).toEqual({ width: 760, height: 480 })
    expect(state.selection).toEqual({ kind: 'node', id: 'n1' })
    state = undoEdit(state)
    expect(currentDocument(state).nodes).toHaveLength(0)
    expect(state.selection).toBeNull()
  })

  test('50 separate edits undo back to the empty design and redo forward again', () => {
    let state = createEditorState(blankDesign('x'))
    for (let i = 0; i < 50; i += 1) {
      const result = runCommands(state, [{ type: 'addNode', role: 'service', label: `S${i}`, position: { x: i * 10, y: 0 } }], { select: { kind: 'node', id: `n${i + 1}` } })
      expect(result.ok).toBe(true)
      state = result.state
    }
    expect(currentDocument(state).nodes).toHaveLength(50)
    expect(state.selection).toEqual({ kind: 'node', id: 'n50' })
    for (let i = 0; i < 50; i += 1) state = undoEdit(state)
    expect(currentDocument(state).nodes).toHaveLength(0)
    expect(state.selection).toBeNull()
    for (let i = 0; i < 50; i += 1) state = redoEdit(state)
    expect(currentDocument(state).nodes).toHaveLength(50)
  })

  test('select() ignores ids that do not exist', () => {
    const state = createEditorState(nested())
    expect(select(state, { kind: 'node', id: 'n4' }).selection).toEqual({ kind: 'node', id: 'n4' })
    expect(select(state, { kind: 'edge', id: 'e9' }).selection).toBeNull()
  })
})

describe('geometry', () => {
  test('absolute position sums the parent chain', () => {
    const doc = nested()
    expect(absolutePosition(doc, 'n4')).toEqual({ x: 0 + 40 + 24 + 24, y: 0 + 40 + 40 + 40 })
  })

  test('containerAt finds the innermost container under a point and honours exclusions', () => {
    const doc = nested()
    expect(containerAt(doc, { x: 100, y: 100 })?.id).toBe('n3')
    expect(containerAt(doc, { x: 50, y: 50 })?.id).toBe('n2')
    expect(containerAt(doc, { x: 700, y: 450 })?.id).toBe('n1')
    expect(containerAt(doc, { x: 900, y: 900 })).toBeUndefined()
    expect(containerAt(doc, { x: 100, y: 100 }, new Set(['n3']))?.id).toBe('n2')
  })

  test('drop verdict names the NEST rule when the container refuses', () => {
    const doc = nested()
    expect(dropTargetFor(doc, 'service', { x: 100, y: 100 })).toMatchObject({ parentId: 'n3', verdict: { ok: true } })
    const refused = dropTargetFor(doc, 'site', { x: 100, y: 100 })
    expect(refused.verdict.ok).toBe(false)
    if (!refused.verdict.ok) expect(refused.verdict.ruleId).toBe('NEST-01')
  })

  test('parents come before children regardless of document order', () => {
    const doc = nested()
    const shuffled = { ...doc, nodes: [...doc.nodes].reverse() }
    const order = parentFirstOrder(shuffled).map((node) => node.id)
    expect(order.indexOf('n1')).toBeLessThan(order.indexOf('n2'))
    expect(order.indexOf('n2')).toBeLessThan(order.indexOf('n3'))
    expect(order.indexOf('n3')).toBeLessThan(order.indexOf('n4'))
  })

  test('a container cannot shrink past its children plus 24 px padding', () => {
    const doc = nested()
    expect(minContainerSize(doc, 'n3')).toEqual({ width: 24 + 184 + 24, height: Math.max(120, 40 + 56 + 24) })
    expect(minContainerSize(doc, 'n1')).toEqual({ width: 40 + 520 + 24, height: 40 + 340 + 24 })
  })

  test('freeSpot avoids siblings; labels get numbered', () => {
    const doc = nested()
    const spot = freeSpot(doc, 'n3', 'service')
    expect(spot).not.toEqual({ x: 24, y: 40 })
    expect(newNodeLabel(doc, 'Orders API')).toBe('Orders API 2')
    expect(newNodeLabel(doc, 'Cache')).toBe('Cache')
  })
})

describe('edge pair defaults (REQ-DES-005)', () => {
  test('service -> relational_db is an access edge, reads and writes, tcp/5432; mysql gives 3306', () => {
    let doc = build([
      { type: 'addNode', id: 'n1', role: 'service', label: 'API', position: { x: 0, y: 0 } },
      { type: 'addNode', id: 'n2', role: 'relational_db', label: 'DB', position: { x: 300, y: 0 } },
    ])
    expect(edgeDefaults(doc, 'n1', 'n2', 'en')).toEqual({ kind: 'access', mode: 'read_write', protocol: 'tcp', port: 5432, label: 'reads and writes' })
    expect(edgeDefaults(doc, 'n1', 'n2', 'vi').label).toBe('đọc và ghi')
    doc = build([{ type: 'updateNode', id: 'n2', patch: { config: { engine: 'MySQL' } } }], doc)
    expect(edgeDefaults(doc, 'n1', 'n2', 'en').port).toBe(3306)
  })

  test('pairs without a common mode, and annotations, default to flow', () => {
    const doc = build([
      { type: 'addNode', id: 'n1', role: 'relational_db', label: 'DB', position: { x: 0, y: 0 } },
      { type: 'addNode', id: 'n2', role: 'service', label: 'API', position: { x: 300, y: 0 } },
      { type: 'addNode', id: 'n3', role: 'note', label: 'Why', position: { x: 600, y: 0 } },
    ])
    expect(edgeDefaults(doc, 'n1', 'n2', 'en').kind).toBe('flow')
    expect(edgeDefaults(doc, 'n3', 'n2', 'en')).toEqual({ kind: 'flow', label: 'flow' })
    expect(commonModes('client', 'load_balancer')).toEqual(['connect'])
    expect(commonModes('service', 'queue')[0]).toBe('send')
  })

  test('planConnect refuses a self-loop and the command layer refuses a duplicate', () => {
    const doc = build([
      { type: 'addNode', id: 'n1', role: 'service', label: 'API', position: { x: 0, y: 0 } },
      { type: 'addNode', id: 'n2', role: 'cache', label: 'Cache', position: { x: 300, y: 0 } },
    ])
    expect(planConnect(doc, 'n1', 'n1', 'en').ok).toBe(false)
    const plan = planConnect(doc, 'n1', 'n2', 'en')
    if (!plan.ok) throw new Error('expected a plan')
    const once = build(plan.commands, doc)
    expect(once.edges[0]).toMatchObject({ id: 'e1', kind: 'access', mode: 'read_write', port: 6379 })
    const again = planConnect(once, 'n1', 'n2', 'en')
    if (!again.ok) throw new Error('expected a plan')
    const result = applyCommands(once, again.commands)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('CMD-DUPLICATE-EDGE')
  })
})

describe('gesture plans (REQ-DES-003/004)', () => {
  test('dropping a service inside a segment nests it with a relative, snapped position', () => {
    const doc = nested()
    const plan = planAddNode(doc, 'service', 'en', { at: { x: 301, y: 203 } })
    if (!plan.ok) throw new Error(plan.error.code)
    const after = build(plan.commands, doc)
    const node = after.nodes.find((candidate) => candidate.id === plan.createdId)!
    expect(node.parentId).toBe('n3')
    // segment origin is (64, 80): (237, 123) snapped to the 8 px grid
    expect(node.position).toEqual({ x: 240, y: 120 })
    expect(node.label).toBe('Service')
    expect(node.variant).toBe('api')
  })

  test('a container gets its default size in the same step', () => {
    const plan = planAddNode(blankDesign('x'), 'site', 'vi', { parentId: null })
    if (!plan.ok) throw new Error(plan.error.code)
    expect(plan.commands.map((command) => command.type)).toEqual(['addNode', 'resizeNode'])
    const after = build(plan.commands)
    expect(after.nodes[0]).toMatchObject({ label: 'Địa điểm', size: { width: 760, height: 480 } })
  })

  test('dropping a site into a zone is refused with NEST-01 and its text', () => {
    const plan = planAddNode(nested(), 'site', 'en', { at: { x: 60, y: 60 } })
    expect(plan.ok).toBe(false)
    if (!plan.ok) {
      expect(plan.error.code).toBe('NEST-01')
      expect(plan.error.message.en.length).toBeGreaterThan(5)
    }
  })

  test('dragging a node into another container re-parents it; its own subtree is not a target', () => {
    let doc = nested()
    doc = build([{ type: 'addNode', id: 'n5', role: 'cache', label: 'Cache', position: { x: 600, y: 420 }, parentId: 'n1' }], doc)
    const plan = planMoveNode(doc, 'n5', { x: 100, y: 150 })
    if (!plan.ok) throw new Error(plan.error.code)
    // segment origin is (64, 80): (36, 70) snapped to the 8 px grid
    expect(plan.commands).toEqual([{ type: 'reparentNode', id: 'n5', parentId: 'n3', position: { x: 40, y: 72 } }])
    // dragging the zone over its own segment: the segment is excluded, the site wins
    const self = planMoveNode(doc, 'n2', { x: 104, y: 104 })
    if (!self.ok) throw new Error(self.error.code)
    expect(self.commands).toEqual([{ type: 'moveNode', id: 'n2', position: { x: 104, y: 104 } }])
  })

  test('the Parent select path keeps the node in place when moving to the canvas', () => {
    const doc = nested()
    const plan = planReparent(doc, 'n4', null)
    if (!plan.ok) throw new Error(plan.error.code)
    expect(plan.commands).toEqual([{ type: 'reparentNode', id: 'n4', parentId: null, position: { x: 88, y: 120 } }])
  })
})

describe('documents and issues', () => {
  test('a blank design is a valid, empty 2.0 document with a code name from its name', () => {
    expect(blankDesign('Đơn hàng Platform')).toEqual({ schemaVersion: '2.0', settings: { codeName: 'don_hang_platform', environment: 'dev' }, nodes: [], edges: [] })
    expect(sortedIssues(blankDesign('x'))).toEqual([])
  })

  test('a 1.0 graph is migrated on open', () => {
    const doc = openGraph({ schemaVersion: '1.0', nodes: [{ id: 'a', type: 'database', label: 'Orders DB', position: { x: 0, y: 0 } }], edges: [] }, 'Legacy')
    expect(doc.schemaVersion).toBe('2.0')
    expect(doc.nodes[0]).toMatchObject({ type: 'relational_db', codeName: 'orders_db' })
    expect(() => openGraph(null, 'x')).toThrow()
  })

  test('issues sort by severity, rule id, then code name; nodes are described for screen readers', () => {
    const doc = build([
      { type: 'addNode', id: 'n1', role: 'relational_db', label: 'Zeta DB', position: { x: 0, y: 0 } },
      { type: 'addNode', id: 'n2', role: 'relational_db', label: 'Alpha DB', position: { x: 300, y: 0 } },
    ])
    const issues = sortedIssues(doc)
    expect(issues.map((issue) => `${issue.ruleId}:${issue.subject}`)).toEqual(['DES-W01:alpha_db', 'DES-W01:zeta_db', 'DES-W04:alpha_db', 'DES-W04:zeta_db'])
    expect(describeNode(doc, 'n1', 'en', issues)).toBe('Zeta DB, Relational database, zeta_db, 0 connections, 2 issues')
  })
})

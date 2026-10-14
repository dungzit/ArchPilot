/**
 * Task 2.6 autosave (REQ-DES-009): debounce, no identical re-send, revision
 * carried forward, 409 conflict stops autosave, offline keeps a pending copy
 * in storage, errors surface the server detail.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ApiError } from '../../../api/client'
import type { DesignPut, DesignRecord } from '../../../api/designs'
import { applyCommands, type ArchGraphV2 } from '../../../domain/graph'
import { DEBOUNCE_MS, DesignAutosaver, MAX_WAIT_MS, pendingStorageKey, readPending, type AutosaveStatus } from './autosave'
import { blankDesign } from './document'

class MemoryStorage {
  data = new Map<string, string>()
  getItem(key: string) { return this.data.get(key) ?? null }
  setItem(key: string, value: string) { this.data.set(key, value) }
  removeItem(key: string) { this.data.delete(key) }
}

function withService(document: ArchGraphV2, label: string): ArchGraphV2 {
  const result = applyCommands(document, [{ type: 'addNode', role: 'service', label, position: { x: 0, y: 0 } }])
  if (!result.ok) throw new Error(result.error.code)
  return result.document
}

function record(revision: number, body: DesignPut): DesignRecord {
  return { id: 'dsg_1', workspaceId: 'w', name: body.name, schemaVersion: '2.0', visibility: 'private', revision, createdAt: '', updatedAt: '', graph: body.graph }
}

let statuses: AutosaveStatus[]
let storage: MemoryStorage
const key = pendingStorageKey('usr_1', 'dsg_1')

function saver(put: (id: string, body: DesignPut) => Promise<DesignRecord>, initial = blankDesign('Orders')) {
  return new DesignAutosaver({
    designId: 'dsg_1',
    revision: 3,
    initial: { name: 'Orders', graph: initial },
    put,
    onChange: (status) => statuses.push(status),
    storage,
    storageKey: key,
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  statuses = []
  storage = new MemoryStorage()
})
afterEach(() => { vi.useRealTimers() })

describe('DesignAutosaver', () => {
  test('saves once, 1.5 s after the last change, with the last revision; then carries the new one', async () => {
    const puts: DesignPut[] = []
    let revision = 3
    const autosaver = saver(async (_id, body) => { puts.push(body); revision += 1; return record(revision, body) })
    const base = blankDesign('Orders')
    const one = withService(base, 'A')
    autosaver.update({ name: 'Orders', graph: one })
    expect(autosaver.current.state).toBe('dirty')
    expect(readPending(storage, key)?.baseRevision).toBe(3)
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 100)
    const two = withService(one, 'B')
    autosaver.update({ name: 'Orders', graph: two })
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 100)
    expect(puts).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(200)
    expect(puts).toHaveLength(1)
    expect(puts[0]).toMatchObject({ name: 'Orders', revision: 3 })
    expect((puts[0].graph as ArchGraphV2).nodes).toHaveLength(2)
    expect(autosaver.current).toEqual({ state: 'saved', revision: 4 })
    expect(readPending(storage, key)).toBeNull()

    autosaver.update({ name: 'Orders 2', graph: two })
    await autosaver.flush()
    expect(puts[1]).toMatchObject({ name: 'Orders 2', revision: 4 })
    expect(statuses.map((status) => status.state)).toEqual(['dirty', 'saving', 'saved', 'dirty', 'saving', 'saved'])
  })

  test('an identical canonical document is never sent (undo back to saved = saved)', async () => {
    const put = vi.fn(async (_id: string, body: DesignPut) => record(4, body))
    const base = blankDesign('Orders')
    const autosaver = saver(put, base)
    autosaver.update({ name: 'Orders', graph: withService(base, 'A') })
    autosaver.update({ name: 'Orders', graph: { ...base } })
    expect(autosaver.current.state).toBe('saved')
    await vi.advanceTimersByTimeAsync(MAX_WAIT_MS * 2)
    await autosaver.flush()
    expect(put).not.toHaveBeenCalled()
  })

  test('keeps editing for 10 s: a save is forced by the max-wait timer', async () => {
    const put = vi.fn(async (_id: string, body: DesignPut) => record(4, body))
    let graph = blankDesign('Orders')
    const autosaver = saver(put, graph)
    for (let second = 0; second < 11; second += 1) {
      graph = withService(graph, `S${second}`)
      autosaver.update({ name: 'Orders', graph })
      await vi.advanceTimersByTimeAsync(1000)
    }
    expect(put).toHaveBeenCalledTimes(1)
  })

  test('409 stops autosave, keeps the pending copy and reports the detail; rebase resumes', async () => {
    const put = vi.fn(async () => { throw new ApiError({ status: 409, detail: 'revision 3 is stale; current is 5', kind: 'http' }) })
    const autosaver = saver(put)
    const changed = withService(blankDesign('Orders'), 'A')
    autosaver.update({ name: 'Orders', graph: changed })
    await autosaver.flush()
    expect(autosaver.current).toEqual({ state: 'conflict', revision: 3, detail: 'revision 3 is stale; current is 5' })
    expect(readPending(storage, key)?.graph.nodes).toHaveLength(1)
    autosaver.update({ name: 'Orders', graph: withService(changed, 'B') })
    await vi.advanceTimersByTimeAsync(MAX_WAIT_MS * 2)
    expect(put).toHaveBeenCalledTimes(1)
    autosaver.rebase(5, { name: 'Orders', graph: blankDesign('Orders') })
    expect(autosaver.current).toEqual({ state: 'saved', revision: 5 })
    expect(readPending(storage, key)).toBeNull()
  })

  test('unreachable -> offline with the pending copy in storage; the next attempt succeeds', async () => {
    let online = false
    const put = vi.fn(async (_id: string, body: DesignPut) => {
      if (!online) throw new ApiError({ status: 0, detail: 'network error', kind: 'unreachable' })
      return record(4, body)
    })
    const autosaver = saver(put)
    autosaver.update({ name: 'Orders', graph: withService(blankDesign('Orders'), 'A') })
    await autosaver.flush()
    expect(autosaver.current.state).toBe('offline')
    expect(readPending(storage, key)).toMatchObject({ designId: 'dsg_1', baseRevision: 3, name: 'Orders' })
    expect(autosaver.hasUnsavedChanges).toBe(true)
    online = true
    await autosaver.flush()
    expect(autosaver.current).toEqual({ state: 'saved', revision: 4 })
    expect(readPending(storage, key)).toBeNull()
  })

  test('a 422 is an error state with the server detail; the next change retries', async () => {
    let fail = true
    const put = vi.fn(async (_id: string, body: DesignPut) => {
      if (fail) throw new ApiError({ status: 422, detail: 'INT-DANGLING-EDGE', kind: 'http' })
      return record(4, body)
    })
    const autosaver = saver(put)
    const one = withService(blankDesign('Orders'), 'A')
    autosaver.update({ name: 'Orders', graph: one })
    await autosaver.flush()
    expect(autosaver.current).toEqual({ state: 'error', revision: 3, detail: 'INT-DANGLING-EDGE' })
    fail = false
    autosaver.update({ name: 'Orders', graph: withService(one, 'B') })
    expect(autosaver.current.state).toBe('dirty')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(autosaver.current.state).toBe('saved')
  })

  test('changes made while a save is in flight are saved right after it', async () => {
    let release: () => void = () => {}
    const bodies: DesignPut[] = []
    let revision = 3
    const put = vi.fn((_id: string, body: DesignPut) => new Promise<DesignRecord>((resolve) => {
      bodies.push(body)
      release = () => { revision += 1; resolve(record(revision, body)) }
    }))
    const autosaver = saver(put)
    const one = withService(blankDesign('Orders'), 'A')
    autosaver.update({ name: 'Orders', graph: one })
    const first = autosaver.flush()
    await vi.advanceTimersByTimeAsync(0)
    autosaver.update({ name: 'Orders', graph: withService(one, 'B') })
    release()
    await first
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(bodies.map((body) => body.revision)).toEqual([3, 4])
    expect(autosaver.current).toEqual({ state: 'saved', revision: 5 })
  })
})

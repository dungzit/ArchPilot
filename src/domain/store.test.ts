// @vitest-environment jsdom
/**
 * Task 1.4: store.ts against a scripted `/api/workspaces/current`.
 * Verification line from the build scope: "an existing localStorage workspace
 * appears server-side after first login". Plus: 404 before the first save,
 * 409 stale revision (reload + report, never overwrite), offline (cache +
 * pending edit, pushed later), owner-scoped cache, cleared on logout.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ApiError } from '../api/client'
import { installFakeFetch, jsonResponse, type FakeHandler, type RecordedRequest } from '../test/fakeFetch'
import {
  clearWorkspaceCache,
  hasPendingSave,
  LEGACY_IMPORT_MARKER_KEY,
  LEGACY_WORKSPACE_KEY,
  loadWorkspace,
  readCachedWorkspace,
  readLegacyWorkspace,
  retryPendingSave,
  saveWorkspace,
  WORKSPACE_CACHE_KEY,
  type WorkspaceRecord,
} from './store'

const URL = '/api/workspaces/current'
const OWNER = 'usr_a'

const INPUT = { name: 'Payments', projectName: 'OrderFlow', systemName: 'OrderFlow API', deploymentTarget: 'aws' }

/** An in-memory stand-in for the real endpoint, with its revision rules (backend/app/repositories/workspaces.py). */
function fakeServer(initial: WorkspaceRecord | null = null) {
  let current = initial
  let reachable = true
  const handler: FakeHandler = (request: RecordedRequest) => {
    if (!reachable) throw new TypeError('Failed to fetch')
    if (request.url !== URL) return jsonResponse(404, { detail: 'not found' })
    if (request.method === 'GET') return current ? jsonResponse(200, current) : jsonResponse(404, { detail: 'no workspace yet' })
    const body = JSON.parse(request.body ?? '{}')
    const expected = current?.revision ?? 0
    if (body.revision !== expected) {
      return jsonResponse(409, { detail: `revision conflict: you sent revision ${body.revision} but the current revision is ${expected}; reload and re-apply your change` })
    }
    const { revision: _ignored, ...fields } = body
    current = { id: current?.id ?? 'wsp_1', ...fields, revision: expected + 1, updatedAt: '2026-09-24T00:00:00+00:00' }
    return jsonResponse(200, current)
  }
  const { calls } = installFakeFetch(async (request) => handler(request))
  return {
    calls,
    get current() { return current },
    setReachable(value: boolean) { reachable = value },
    /** Someone else saves in another browser. */
    externalSave(name: string) {
      current = { ...(current as WorkspaceRecord), name, revision: (current?.revision ?? 0) + 1 }
    },
  }
}

beforeEach(() => window.localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

describe('load', () => {
  test('404 before the first save, no legacy data: null, and nothing is PUT', async () => {
    const server = fakeServer()
    const result = await loadWorkspace(OWNER)
    expect(result).toEqual({ workspace: null, status: 'synced', source: 'none' })
    expect(server.calls.map((call) => call.method)).toEqual(['GET'])
  })

  test('an existing server workspace is returned and cached for this owner only', async () => {
    fakeServer({ id: 'wsp_1', ...INPUT, revision: 4, updatedAt: '2026-09-23T00:00:00+00:00' })
    const result = await loadWorkspace(OWNER)
    expect(result.source).toBe('server')
    expect(result.workspace?.revision).toBe(4)
    expect(readCachedWorkspace(OWNER)?.name).toBe('Payments')
    expect(readCachedWorkspace('usr_someone_else')).toBeNull()
  })

  test('first login imports the legacy local workspace with PUT revision 0, exactly once', async () => {
    window.localStorage.setItem(LEGACY_WORKSPACE_KEY, JSON.stringify({ id: 'workspace-personal', ...INPUT, revision: 7, updatedAt: 'x' }))
    const server = fakeServer()
    const result = await loadWorkspace(OWNER)
    expect(result.source).toBe('imported')
    expect(server.current?.name).toBe('Payments')
    const put = server.calls.find((call) => call.method === 'PUT')!
    expect(JSON.parse(put.body!)).toEqual({ ...INPUT, revision: 0 })
    expect(window.localStorage.getItem(LEGACY_IMPORT_MARKER_KEY)).toContain('imported')
    expect(window.localStorage.getItem(LEGACY_WORKSPACE_KEY), 'the user\'s legacy data is never deleted').not.toBeNull()

    // A different user on the same browser, with an empty server side, does not get it a second time.
    const second = fakeServer()
    expect((await loadWorkspace('usr_b')).source).toBe('none')
    expect(second.calls.some((call) => call.method === 'PUT')).toBe(false)
  })

  test('legacy data is not imported over an existing server workspace', async () => {
    window.localStorage.setItem(LEGACY_WORKSPACE_KEY, JSON.stringify({ ...INPUT, name: 'Old local' }))
    const server = fakeServer({ id: 'wsp_1', ...INPUT, revision: 2, updatedAt: '2026-09-23T00:00:00+00:00' })
    const result = await loadWorkspace(OWNER)
    expect(result.workspace?.name).toBe('Payments')
    expect(server.calls.some((call) => call.method === 'PUT')).toBe(false)
    expect(readLegacyWorkspace(), 'decision recorded, not re-offered').toBeNull()
  })

  test('legacy values are normalised to what the server accepts', () => {
    window.localStorage.setItem(LEGACY_WORKSPACE_KEY, JSON.stringify({ name: '   ', projectName: 'p'.repeat(300), deploymentTarget: 'mainframe' }))
    expect(readLegacyWorkspace()).toEqual({ name: 'Personal workspace', projectName: 'p'.repeat(200), systemName: '', deploymentTarget: 'on_premises' })
    window.localStorage.setItem(LEGACY_WORKSPACE_KEY, '{not json')
    expect(readLegacyWorkspace()).toBeNull()
  })

  test('server unreachable: falls back to this owner\'s cache and says offline', async () => {
    const server = fakeServer({ id: 'wsp_1', ...INPUT, revision: 1, updatedAt: '2026-09-23T00:00:00+00:00' })
    await loadWorkspace(OWNER)
    server.setReachable(false)
    const offline = await loadWorkspace(OWNER)
    expect(offline).toMatchObject({ status: 'offline', source: 'cache' })
    expect(offline.workspace?.name).toBe('Payments')
    expect((await loadWorkspace('usr_b')).workspace, 'another user never sees this cache').toBeNull()
  })

  test('a 500 with an error envelope is not "offline": it throws', async () => {
    installFakeFetch(() => jsonResponse(500, { detail: 'internal server error', requestId: 'r1' }))
    await expect(loadWorkspace(OWNER)).rejects.toBeInstanceOf(ApiError)
  })
})

describe('save', () => {
  test('sends the revision the caller last saw; the server assigns the next one', async () => {
    const server = fakeServer()
    const created = await saveWorkspace(OWNER, INPUT, 0)
    expect(created).toMatchObject({ status: 'saved', workspace: { revision: 1 } })
    const updated = await saveWorkspace(OWNER, { ...INPUT, name: 'Renamed' }, 1)
    expect(updated).toMatchObject({ status: 'saved', workspace: { revision: 2, name: 'Renamed' } })
    expect(JSON.parse(server.calls.at(-1)!.body!).revision).toBe(1)
    expect(readCachedWorkspace(OWNER)?.revision).toBe(2)
  })

  test('409 stale revision: nothing is overwritten, the newer record is reloaded and reported', async () => {
    const server = fakeServer()
    await saveWorkspace(OWNER, INPUT, 0)
    server.externalSave('Saved in another tab')
    const result = await saveWorkspace(OWNER, { ...INPUT, name: 'My stale edit' }, 1)
    expect(result.status).toBe('conflict')
    if (result.status !== 'conflict') throw new Error('unreachable')
    expect(result.detail).toContain('current revision is 2')
    expect(result.workspace).toMatchObject({ name: 'Saved in another tab', revision: 2 })
    expect(server.current?.name).toBe('Saved in another tab')
    expect(readCachedWorkspace(OWNER)?.name).toBe('Saved in another tab')
  })

  test('unreachable: kept locally as a pending edit, then pushed on the next successful load', async () => {
    const server = fakeServer()
    await saveWorkspace(OWNER, INPUT, 0)
    server.setReachable(false)
    const offline = await saveWorkspace(OWNER, { ...INPUT, name: 'Edited on the train' }, 1)
    expect(offline).toMatchObject({ status: 'offline', workspace: { name: 'Edited on the train', revision: 1 } })
    expect(hasPendingSave(OWNER)).toBe(true)
    expect(readCachedWorkspace(OWNER)?.name).toBe('Edited on the train')

    server.setReachable(true)
    const back = await loadWorkspace(OWNER)
    expect(back).toMatchObject({ status: 'synced', workspace: { name: 'Edited on the train', revision: 2 } })
    expect(server.current?.name).toBe('Edited on the train')
    expect(hasPendingSave(OWNER)).toBe(false)
  })

  test('a pending offline edit that went stale is reported as a conflict, not forced through', async () => {
    const server = fakeServer()
    await saveWorkspace(OWNER, INPUT, 0)
    server.setReachable(false)
    await saveWorkspace(OWNER, { ...INPUT, name: 'Offline edit' }, 1)
    server.setReachable(true)
    server.externalSave('Colleague saved first')
    const back = await loadWorkspace(OWNER)
    expect(back.status).toBe('conflict')
    expect(back.conflictDetail).toContain('current revision is 2')
    expect(back.workspace?.name).toBe('Colleague saved first')
    expect(server.current?.name).toBe('Colleague saved first')
    expect(hasPendingSave(OWNER)).toBe(false)
  })

  test('retryPendingSave pushes the pending edit, and is a no-op when nothing is pending', async () => {
    const server = fakeServer()
    expect(await retryPendingSave(OWNER)).toBeNull()
    server.setReachable(false)
    await saveWorkspace(OWNER, INPUT, 0)
    server.setReachable(true)
    expect(await retryPendingSave(OWNER)).toMatchObject({ status: 'saved', workspace: { revision: 1 } })
  })

  test('a 422 is not swallowed', async () => {
    installFakeFetch(() => jsonResponse(422, { detail: 'body.name: String should have at least 1 character' }))
    await expect(saveWorkspace(OWNER, { ...INPUT, name: '' }, 0)).rejects.toMatchObject({ status: 422 })
  })

  test('clearWorkspaceCache (logout) removes the cache but keeps the legacy data and marker', async () => {
    window.localStorage.setItem(LEGACY_WORKSPACE_KEY, JSON.stringify(INPUT))
    fakeServer()
    await loadWorkspace(OWNER)
    clearWorkspaceCache()
    expect(window.localStorage.getItem(WORKSPACE_CACHE_KEY)).toBeNull()
    expect(window.localStorage.getItem(LEGACY_WORKSPACE_KEY)).not.toBeNull()
    expect(window.localStorage.getItem(LEGACY_IMPORT_MARKER_KEY)).not.toBeNull()
  })
})

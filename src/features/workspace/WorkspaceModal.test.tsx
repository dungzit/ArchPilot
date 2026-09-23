// @vitest-environment jsdom
/**
 * Task 1.4 through the real <App/>: the sidebar shows the server's workspace,
 * the modal saves with the right revision, a 409 keeps the modal open with a
 * clear message, and an unreachable server leaves a visible "not saved" line
 * with a working Retry.
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { App } from '../../app/App'
import { LEGACY_WORKSPACE_KEY, type WorkspaceRecord } from '../../domain/store'
import { installFakeFetch, jsonResponse, TEST_USER, waitFor, type RecordedRequest } from '../../test/fakeFetch'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
let calls: RecordedRequest[]
let current: WorkspaceRecord | null
let reachable: boolean

const $ = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector)
const sidebarName = () => $('.workspace-copy strong')?.textContent
const syncLine = () => $('.workspace-sync')?.textContent ?? ''

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

const click = (element: Element | null) => act(async () => { element!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

async function boot(initial: WorkspaceRecord | null) {
  current = initial
  reachable = true
  calls = installFakeFetch((request) => {
    if (!reachable && request.url !== '/api/auth/me') throw new TypeError('Failed to fetch')
    if (request.url === '/api/auth/me') return jsonResponse(200, TEST_USER)
    if (request.url !== '/api/workspaces/current') return jsonResponse(404, { detail: 'not found' })
    if (request.method === 'GET') return current ? jsonResponse(200, current) : jsonResponse(404, { detail: 'no workspace yet' })
    const body = JSON.parse(request.body!)
    const expected = current?.revision ?? 0
    if (body.revision !== expected) return jsonResponse(409, { detail: `you sent revision ${body.revision} but the current revision is ${expected}` })
    const { revision: _r, ...fields } = body
    current = { id: 'wsp_1', ...fields, revision: expected + 1, updatedAt: '2026-09-24T00:00:00+00:00' }
    return jsonResponse(200, current)
  }).calls
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<App />) })
  await waitFor(() => $('.app-shell') !== null, 'shell')
}

async function openModalAndRename(name: string) {
  await click($('.workspace-switcher'))
  await act(async () => { type(container.querySelector<HTMLInputElement>('.workspace-modal input')!, name) })
  await click($('.workspace-modal .modal-footer .primary-button'))
}

const SERVER_WS: WorkspaceRecord = { id: 'wsp_1', name: 'Server team', projectName: 'P', systemName: 'Server system', deploymentTarget: 'hybrid', revision: 3, updatedAt: '2026-09-23T00:00:00+00:00' }

beforeEach(() => {
  window.localStorage.clear()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
})

describe('workspace in the shell (task 1.4)', () => {
  test('the sidebar shows the server workspace once loaded', async () => {
    await boot(SERVER_WS)
    await waitFor(() => sidebarName() === 'Server team', 'server workspace in the sidebar')
    expect(syncLine()).toBe('')
  })

  test('saving from the modal PUTs the last-seen revision and updates the sidebar', async () => {
    await boot(SERVER_WS)
    await waitFor(() => sidebarName() === 'Server team', 'loaded')
    await openModalAndRename('Renamed team')
    await waitFor(() => $('.workspace-modal') === null, 'modal closed')
    const put = calls.find((call) => call.method === 'PUT')!
    expect(JSON.parse(put.body!)).toMatchObject({ name: 'Renamed team', revision: 3 })
    expect(sidebarName()).toBe('Renamed team')
  })

  test('409: the modal stays open with a clear message and the newer version is reloaded', async () => {
    await boot(SERVER_WS)
    await waitFor(() => sidebarName() === 'Server team', 'loaded')
    current = { ...SERVER_WS, name: 'Colleague edit', revision: 4 }
    await openModalAndRename('My edit')
    await waitFor(() => $('.workspace-modal [role="alert"]') !== null, 'conflict message')
    expect($('.workspace-modal [role="alert"]')!.textContent).toContain('Colleague edit')
    expect(container.querySelector<HTMLInputElement>('.workspace-modal input')!.value, 'typed value kept').toBe('My edit')
    expect(sidebarName()).toBe('Colleague edit')
    expect(current.name).toBe('Colleague edit')

    // Saving again is an explicit overwrite on top of revision 4.
    await click($('.workspace-modal .modal-footer .primary-button'))
    await waitFor(() => $('.workspace-modal') === null, 'modal closed')
    expect(current).toMatchObject({ name: 'My edit', revision: 5 })
  })

  test('unreachable: the edit is kept, the sidebar says "not saved", Retry pushes it', async () => {
    await boot(SERVER_WS)
    await waitFor(() => sidebarName() === 'Server team', 'loaded')
    reachable = false
    await openModalAndRename('Offline edit')
    await waitFor(() => $('.workspace-modal') === null, 'modal closed')
    expect(sidebarName()).toBe('Offline edit')
    expect(syncLine()).toContain('Chưa lưu lên máy chủ')

    reachable = true
    await click($('.workspace-sync button'))
    await waitFor(() => syncLine() === '', 'sync line cleared')
    expect(current).toMatchObject({ name: 'Offline edit', revision: 4 })
  })

  test('first login imports the legacy local workspace and says so', async () => {
    window.localStorage.setItem(LEGACY_WORKSPACE_KEY, JSON.stringify({ id: 'workspace-personal', name: 'From my browser', projectName: 'x', systemName: 'y', deploymentTarget: 'aws', revision: 9, updatedAt: 'z' }))
    await boot(null)
    await waitFor(() => sidebarName() === 'From my browser', 'imported workspace')
    expect(current).toMatchObject({ name: 'From my browser', revision: 1 })
    expect(syncLine()).toContain('Đã chuyển workspace cục bộ lên máy chủ')
  })
})

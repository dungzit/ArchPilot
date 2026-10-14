// @vitest-environment jsdom
/**
 * Phase 2 workspace in jsdom with Testing Library, against a scripted
 * `/api/designs` backend (revisions, 409, offline). Covers: design list and
 * the New design flow (2.1), palette groups + synonym search + click-to-add
 * and the `/` command menu (2.2), nesting, Parent select and the container
 * delete dialog (2.3), connections with pair defaults and the edge inspector
 * (2.4), inspector forms and the code-name dialog (2.5), undo/redo, Ctrl+S,
 * 409 and offline (2.6), Layers tree keyboard (2.7) and Issues (2.8).
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { DesignRecord } from '../../api/designs'
import type { ArchGraphV2 } from '../../domain/graph'
import { installFakeFetch, jsonResponse, TEST_USER, type RecordedRequest } from '../../test/fakeFetch'
import type { Copy } from '../../ui/copy'
import { blankDesign } from './model/document'
import { DesignsRoute } from './DesignsScreen'

// ---------------------------------------------------------------- jsdom shims React Flow needs
beforeAll(() => {
  class ResizeObserverShim {
    private readonly callback: ResizeObserverCallback
    constructor(callback: ResizeObserverCallback) { this.callback = callback }
    observe(target: Element) {
      // Only the pane needs a size callback; nodes carry explicit width/height (and
      // measuring every node on every render makes jsdom crawl).
      if ((target as HTMLElement).classList?.contains('react-flow__node')) return
      const box = { width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600, x: 0, y: 0 }
      this.callback([{ target, contentRect: box, borderBoxSize: [{ inlineSize: 800, blockSize: 600 }], contentBoxSize: [{ inlineSize: 800, blockSize: 600 }] } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver)
    }
    unobserve() {}
    disconnect() {}
  }
  class DOMMatrixReadOnlyShim {
    m22: number
    constructor(transform?: string) {
      const scale = transform?.match(/scale\(([0-9.]+)\)/)?.[1]
      this.m22 = scale !== undefined ? Number(scale) : 1
    }
  }
  // Assigned directly (not vi.stubGlobal): afterEach's unstubAllGlobals resets the fetch stub only.
  Object.assign(globalThis, { ResizeObserver: ResizeObserverShim, DOMMatrixReadOnly: DOMMatrixReadOnlyShim })
  Object.defineProperties(HTMLElement.prototype, {
    offsetHeight: { configurable: true, get() { return parseFloat((this as HTMLElement).style.height) || 600 } },
    offsetWidth: { configurable: true, get() { return parseFloat((this as HTMLElement).style.width) || 800 } },
  })
  ;(SVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 }) as DOMRect
})

// ---------------------------------------------------------------- scripted backend
interface Backend {
  designs: Map<string, DesignRecord>
  offline: boolean
  requests: RecordedRequest[]
}

let backend: Backend

function record(id: string, name: string, graph: unknown, revision = 1): DesignRecord {
  return { id, workspaceId: 'wsp_1', name, schemaVersion: '2.0', visibility: 'private', seededFromPatternId: null, revision, createdAt: '2026-09-24T01:00:00Z', updatedAt: '2026-09-24T02:30:00Z', graph }
}

function startBackend(initial: DesignRecord[] = []) {
  backend = { designs: new Map(initial.map((item) => [item.id, item])), offline: false, requests: [] }
  let next = initial.length + 1
  installFakeFetch((request) => {
    backend.requests.push(request)
    if (backend.offline) throw new TypeError('Failed to fetch')
    const url = new URL(request.url, 'http://localhost')
    if (url.pathname === '/api/designs' && request.method === 'GET') {
      const items = [...backend.designs.values()].map(({ graph: _graph, ...summary }) => summary)
      return jsonResponse(200, { items, total: items.length, limit: 50, offset: 0 })
    }
    if (url.pathname === '/api/designs' && request.method === 'POST') {
      const body = JSON.parse(request.body ?? '{}')
      const created = record(`dsg_${next++}`, body.name, body.graph)
      backend.designs.set(created.id, created)
      return jsonResponse(201, created)
    }
    const match = /^\/api\/designs\/([^/]+)$/.exec(url.pathname)
    const existing = match ? backend.designs.get(decodeURIComponent(match[1])) : undefined
    if (match && !existing) return jsonResponse(404, { detail: 'design not found' })
    if (existing && request.method === 'GET') return jsonResponse(200, existing)
    if (existing && request.method === 'PUT') {
      const body = JSON.parse(request.body ?? '{}')
      if (body.revision !== existing.revision) return jsonResponse(409, { detail: `revision ${body.revision} is stale; current is ${existing.revision}` })
      const updated = { ...existing, name: body.name, graph: body.graph, revision: existing.revision + 1 }
      backend.designs.set(existing.id, updated)
      return jsonResponse(200, updated)
    }
    return jsonResponse(404, { detail: 'not found' })
  })
}

const en = (value: Copy) => value.en

function renderAt(path: string) {
  const element = <DesignsRoute text={en} language="en" user={TEST_USER} />
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/designs" element={element} />
        <Route path="/designs/:designId" element={element} />
      </Routes>
    </MemoryRouter>,
  )
}

async function openWorkspace(graph: ArchGraphV2 = blankDesign('Orders platform')) {
  startBackend([record('dsg_1', 'Orders platform', graph, 3)])
  renderAt('/designs/dsg_1')
  await screen.findByLabelText('Design name')
}

const layers = () => screen.getByRole('tree', { name: 'Component tree' })
const treeItems = () => within(layers()).queryAllByRole('treeitem')
const showLayers = () => fireEvent.click(screen.getByRole('tab', { name: 'Layers' }))
const showComponents = () => fireEvent.click(screen.getByRole('tab', { name: 'Components' }))
/** Palette items by role id (a CSS query: role queries over the whole workspace are slow in jsdom). */
const paletteButton = (roleId: string) => window.document.querySelector<HTMLButtonElement>(`.dw-palette-item[data-role="${roleId}"]`)!
const key = (keyName: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(window.document.body, { key: keyName, ...init })
const savedGraph = (id = 'dsg_1') => backend.designs.get(id)!.graph as ArchGraphV2

beforeEach(() => { window.localStorage.clear() })
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('designs list and new design (2.1)', () => {
  test('lists designs from /api/designs and creates a blank 2.0 design, then opens it', async () => {
    startBackend([record('dsg_1', 'Checkout', blankDesign('Checkout'), 4)])
    renderAt('/designs')
    const row = await screen.findByRole('row', { name: /Checkout/ })
    expect(within(row).getByText('4')).toBeTruthy()
    expect(within(row).getByText('2026-09-24 02:30 UTC')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'New design' }))
    const dialog = screen.getByRole('dialog', { name: 'New design' })
    expect(within(dialog).getByText('Template gallery coming in phase 5.')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create blank design' }))
    expect(within(dialog).getByRole('alert').textContent).toContain('A name needs 1 to 120 characters.')
    fireEvent.change(within(dialog).getByLabelText('Design name'), { target: { value: 'Đơn hàng' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create blank design' }))

    await waitFor(() => expect(window.document.querySelector('.dw-name')).not.toBeNull())
    const post = backend.requests.find((request) => request.method === 'POST')!
    expect(JSON.parse(post.body!)).toEqual({ name: 'Đơn hàng', graph: { schemaVersion: '2.0', settings: { codeName: 'don_hang', environment: 'dev' }, nodes: [], edges: [] } })
    expect((screen.getByLabelText('Design name') as HTMLInputElement).value).toBe('Đơn hàng')
    expect(screen.getByText('Saved · rev 1')).toBeTruthy()
    expect(screen.getByText('The canvas is empty')).toBeTruthy()
  })

  test('an unknown design id shows not found with a way back', async () => {
    startBackend([])
    renderAt('/designs/nope')
    expect((await screen.findByRole('alert')).textContent).toContain('This design was not found.')
    expect(screen.getByRole('link', { name: 'Back to designs' }).getAttribute('href')).toBe('/designs')
  })
})

describe('palette and command menu (2.2)', () => {
  test('11 catalogue layer groups, provider-neutral, synonym search with VI folding', async () => {
    await openWorkspace()
    const groups = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)
    expect(groups).toEqual(expect.arrayContaining(['External and annotation', 'Edge and access', 'Network containers', 'Network', 'Compute', 'Application', 'Data stores', 'Storage', 'Messaging', 'Security and identity', 'Observability and operations']))
    const palette = screen.getByLabelText('Search components').closest('.dw-palette') as HTMLElement
    expect(palette.textContent).not.toMatch(/\b(AWS|Azure|GCP|VMware|vSphere|EC2|RDS)\b/)

    fireEvent.change(screen.getByLabelText('Search components'), { target: { value: 'VLAN' } })
    const results = screen.getByRole('region', { name: 'Search results' })
    expect(within(results).getAllByRole('button')[0].getAttribute('data-role')).toBe('network_segment')
    fireEvent.change(screen.getByLabelText('Search components'), { target: { value: 'NAS' } })
    expect(within(screen.getByRole('region', { name: 'Search results' })).getAllByRole('button')[0].getAttribute('data-role')).toBe('file_storage')
    fireEvent.change(screen.getByLabelText('Search components'), { target: { value: 'co so du lieu' } })
    expect(within(screen.getByRole('region', { name: 'Search results' })).getAllByRole('button')[0].getAttribute('data-role')).toBe('relational_db')
  })

  test('click-to-add creates one selected node; undo and redo walk it back and forth', async () => {
    await openWorkspace()
    fireEvent.click(paletteButton('site'))
    expect((screen.getByLabelText('Label') as HTMLInputElement).value).toBe('Site')
    showLayers()
    expect(treeItems()).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByText('No components yet.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    expect(treeItems()).toHaveLength(1)
    key('z', { ctrlKey: true })
    expect(screen.getByText('No components yet.')).toBeTruthy()
    key('y', { ctrlKey: true })
    expect(treeItems()).toHaveLength(1)
  })

  test('"/" opens the command menu; typing and Enter adds a component; it goes into the selected container', async () => {
    await openWorkspace()
    fireEvent.click(paletteButton('site'))
    act(() => { (window.document.activeElement as HTMLElement | null)?.blur() })
    key('/')
    const menu = screen.getByRole('dialog', { name: 'Command menu' })
    const input = within(menu).getByRole('combobox')
    expect(window.document.activeElement).toBe(input)
    fireEvent.change(input, { target: { value: 'az' } })
    expect(within(menu).getAllByRole('option')[0].textContent).toContain('Add Zone')
    expect(within(menu).getAllByRole('option')[0].textContent).toContain('into Site')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.queryByRole('dialog', { name: 'Command menu' })).toBeNull()
    showLayers()
    const [site, zone] = treeItems()
    expect(site.getAttribute('aria-level')).toBe('1')
    expect(zone.getAttribute('aria-level')).toBe('2')
    expect(zone.getAttribute('aria-selected')).toBe('true')
  })
})

/** site n1 > zone n2 > segment n3 > service n4, plus a cache n5 at the top. */
function nestedGraph(): ArchGraphV2 {
  return {
    schemaVersion: '2.0',
    settings: { codeName: 'orders', environment: 'dev' },
    nodes: [
      { id: 'n1', type: 'site', label: 'DC1', codeName: 'dc1', position: { x: 0, y: 0 }, size: { width: 760, height: 480 } },
      { id: 'n2', type: 'zone', label: 'Room A', codeName: 'room_a', position: { x: 40, y: 40 }, parentId: 'n1', size: { width: 520, height: 340 } },
      { id: 'n3', type: 'network_segment', variant: 'subnet', label: 'App', codeName: 'app', position: { x: 24, y: 40 }, parentId: 'n2', size: { width: 400, height: 220 } },
      { id: 'n4', type: 'service', variant: 'api', label: 'Orders API', codeName: 'orders_api', position: { x: 24, y: 40 }, parentId: 'n3' },
      { id: 'n5', type: 'relational_db', label: 'Orders DB', codeName: 'orders_db', position: { x: 900, y: 40 } },
    ],
    edges: [],
  }
}

describe('containers (2.3)', () => {
  test('the Parent select lists only valid containers and re-parents in one undo step', async () => {
    await openWorkspace(nestedGraph())
    showLayers()
    fireEvent.click(within(layers()).getByText('Orders DB'))
    const parent = screen.getByLabelText('Parent') as HTMLSelectElement
    expect(Array.from(parent.options).map((option) => option.textContent)).toEqual([
      'Canvas (top level)', 'DC1 (Site)', 'Room A (Zone)', 'App (Network segment)',
    ])
    fireEvent.change(parent, { target: { value: 'n3' } })
    const db = treeItems().find((item) => item.textContent?.includes('Orders DB'))!
    expect(db.getAttribute('aria-level')).toBe('4')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(treeItems().find((item) => item.textContent?.includes('Orders DB'))!.getAttribute('aria-level')).toBe('1')
  })

  test('a site only offers the canvas; the stretched / zone-local hint follows the parent', async () => {
    await openWorkspace(nestedGraph())
    showLayers()
    fireEvent.click(within(layers()).getByText('DC1'))
    expect(Array.from((screen.getByLabelText('Parent') as HTMLSelectElement).options).map((option) => option.textContent)).toEqual(['Canvas (top level)'])
    fireEvent.click(within(layers()).getByText('App'))
    expect(screen.getByText('Zone-local')).toBeTruthy()
  })

  test('deleting a container asks: delete with children / move children out / cancel; each is one undo step', async () => {
    await openWorkspace(nestedGraph())
    showLayers()
    fireEvent.click(within(layers()).getByText('App'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete component' }))
    let dialog = screen.getByRole('dialog', { name: 'Delete App?' })
    expect(window.document.activeElement?.textContent).toBe('Cancel')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(treeItems()).toHaveLength(5)

    fireEvent.click(within(layers()).getByText('App'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete component' }))
    dialog = screen.getByRole('dialog', { name: 'Delete App?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move 1 child out' }))
    expect(treeItems().map((item) => item.querySelector('strong')?.textContent)).toEqual(['DC1', 'Room A', 'Orders API', 'Orders DB'])
    expect(treeItems()[2].getAttribute('aria-level')).toBe('3')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(treeItems()).toHaveLength(5)

    fireEvent.click(within(layers()).getByText('Room A'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete component' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete room_a and its 1 child' }))
    expect(treeItems().map((item) => item.querySelector('strong')?.textContent)).toEqual(['DC1', 'Orders DB'])
  })
})

describe('edges (2.4)', () => {
  test('Add connection uses the pair defaults and opens the edge inspector; kind and port are editable', async () => {
    await openWorkspace(nestedGraph())
    showLayers()
    fireEvent.click(within(layers()).getByText('Orders API'))
    fireEvent.change(screen.getByLabelText('Add connection to'), { target: { value: 'n5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(screen.getByText('Orders API → Orders DB', { selector: '.dw-inspector-head strong' })).toBeTruthy()
    expect((screen.getByLabelText('Label') as HTMLInputElement).value).toBe('reads and writes')
    expect((screen.getByRole('radio', { name: 'Access (drives rules)' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('Mode') as HTMLSelectElement).value).toBe('read_write')
    expect((screen.getByLabelText('Port') as HTMLInputElement).value).toBe('5432')
    expect((screen.getByLabelText('Protocol') as HTMLSelectElement).value).toBe('tcp')
    fireEvent.change(screen.getByLabelText('Port'), { target: { value: '70000' } })
    expect(screen.getByText('The maximum is 65535.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Port'), { target: { value: '6432' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Flow (visual only)' }))
    const connections = screen.getByRole('region', { name: 'Connections' })
    expect(connections.textContent).toContain('Orders API → Orders DB (flow, reads and writes)')
    fireEvent.click(screen.getByRole('tab', { name: 'Code' }))
    const json = JSON.parse(screen.getByLabelText('Design document as JSON').textContent!)
    expect(json.edges).toEqual([{ id: 'e1', source: 'n4', target: 'n5', label: 'reads and writes', direction: 'forward', kind: 'flow', mode: 'read_write', protocol: 'tcp', port: 6432 }])
  })
})

describe('inspector (2.5)', () => {
  test('label edits keep the code name; Change... validates and renames; attributes come from the catalogue', async () => {
    await openWorkspace(nestedGraph())
    showLayers()
    fireEvent.click(within(layers()).getByText('Orders DB'))
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Billing DB' } })
    expect(screen.getByText('orders_db', { selector: '.dw-codename code' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: '' } })
    expect(screen.getByText('Required.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Change…' }))
    const dialog = screen.getByRole('dialog', { name: 'Change code name' })
    expect(within(dialog).getByRole('note').textContent).toContain('renames the generated resource addresses')
    fireEvent.change(within(dialog).getByLabelText('New code name'), { target: { value: 'Billing DB' } })
    expect((within(dialog).getByRole('button', { name: 'Rename' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText('New code name'), { target: { value: 'orders_api' } })
    expect(within(dialog).getByRole('alert').textContent).toContain('orders_api is used by another node.')
    fireEvent.change(within(dialog).getByLabelText('New code name'), { target: { value: 'billing_db' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rename' }))
    expect(screen.getByText('billing_db', { selector: '.dw-codename code' })).toBeTruthy()

    // Common attributes (REQ-DES-024/025) and role fields from the catalogue
    for (const label of ['Replicas', 'Statefulness', 'Failure domain level', 'Failure domain label', 'Tier', 'Criticality', 'Data classification', 'Size class', 'Owner', 'Engine family', 'Storage (GiB)', 'Deletion protection']) {
      expect(screen.getByLabelText(label)).toBeTruthy()
    }
    fireEvent.change(screen.getByLabelText('Replicas'), { target: { value: '0' } })
    expect(screen.getByText('The minimum is 1.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Replicas'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Failure domain level'), { target: { value: 'zone' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Code' }))
    const node = JSON.parse(screen.getByLabelText('Design document as JSON').textContent!).nodes.find((candidate: { id: string }) => candidate.id === 'n5')
    expect(node).toMatchObject({ label: 'Billing DB', codeName: 'billing_db', attributes: { replicas: 2, failureDomainLevel: 'zone' } })
  })

  test('a service inside a zone shows the inherited failure domain', async () => {
    await openWorkspace(nestedGraph())
    showLayers()
    fireEvent.click(within(layers()).getByText('Orders API'))
    expect((screen.getByLabelText('Failure domain level') as HTMLSelectElement).selectedOptions[0].textContent).toBe('(inherited: zone)')
    expect(screen.getByText('Inherited from Room A.')).toBeTruthy()
    expect(screen.getByText('Inherited: room_a')).toBeTruthy()
  })
})

describe('save, undo depth, conflicts, offline (2.6)', () => {
  test('Ctrl+S saves with the current revision; 50 edits undo back to the start', async () => {
    await openWorkspace()
    for (let i = 0; i < 50; i += 1) fireEvent.click(paletteButton('cache'))
    showLayers()
    expect(treeItems()).toHaveLength(50)
    key('s', { ctrlKey: true })
    await waitFor(() => expect(screen.getByText('Saved · rev 4')).toBeTruthy())
    const put = backend.requests.find((request) => request.method === 'PUT')!
    expect(JSON.parse(put.body!).revision).toBe(3)
    expect(savedGraph().nodes).toHaveLength(50)
    for (let i = 0; i < 50; i += 1) key('z', { ctrlKey: true })
    expect(screen.getByText('No components yet.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true)
  }, 30000)

  test('409: autosave stops with a banner; Load theirs replaces the document and resumes', async () => {
    await openWorkspace()
    const theirs = { ...blankDesign('Orders platform'), nodes: [{ id: 'n1', type: 'queue', label: 'Their queue', codeName: 'their_queue', position: { x: 0, y: 0 } }] }
    backend.designs.set('dsg_1', record('dsg_1', 'Orders platform', theirs, 7))
    fireEvent.click(paletteButton('cache'))
    key('s', { ctrlKey: true })
    const banner = await screen.findByText('This design was changed elsewhere. Autosave stopped; nothing was overwritten.')
    expect(screen.getByText('Version conflict')).toBeTruthy()
    expect((backend.designs.get('dsg_1')!.graph as ArchGraphV2).nodes[0].label).toBe('Their queue')
    fireEvent.click(within(banner.parentElement!).getByRole('button', { name: 'Load theirs' }))
    await waitFor(() => expect(screen.getByText('Saved · rev 7')).toBeTruthy())
    showLayers()
    expect(treeItems().map((item) => item.querySelector('strong')?.textContent)).toEqual(['Their queue'])
    fireEvent.click(within(layers()).getByText('Their queue'))
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Orders queue' } })
    key('s', { ctrlKey: true })
    await waitFor(() => expect(screen.getByText('Saved · rev 8')).toBeTruthy())
  })

  test('409: Save mine as a copy creates a new design with my document', async () => {
    await openWorkspace()
    backend.designs.set('dsg_1', record('dsg_1', 'Orders platform', blankDesign('x'), 9))
    fireEvent.click(paletteButton('queue'))
    key('s', { ctrlKey: true })
    fireEvent.click(await screen.findByRole('button', { name: 'Save mine as a copy' }))
    await waitFor(() => expect(backend.designs.has('dsg_2')).toBe(true))
    expect(backend.designs.get('dsg_2')!.name).toBe('Orders platform (copy)')
    expect(savedGraph('dsg_2').nodes.map((node) => node.type)).toEqual(['queue'])
  })

  test('offline: the change is kept in localStorage with a Retry; Retry saves when the server is back', async () => {
    await openWorkspace()
    backend.offline = true
    fireEvent.click(paletteButton('cache'))
    key('s', { ctrlKey: true })
    await screen.findByText('Not saved: the server is unreachable. Changes are kept in this browser.')
    const pending = JSON.parse(window.localStorage.getItem(`archpilot.design.pending.${TEST_USER.id}.dsg_1`)!)
    expect(pending).toMatchObject({ designId: 'dsg_1', baseRevision: 3 })
    expect(pending.graph.nodes).toHaveLength(1)
    backend.offline = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByText('Saved · rev 4')).toBeTruthy())
    expect(window.localStorage.getItem(`archpilot.design.pending.${TEST_USER.id}.dsg_1`)).toBeNull()
  })

  test('a pending copy for the same revision is restored on open (and is one undo step)', async () => {
    const mine = { ...blankDesign('Orders platform'), nodes: [{ id: 'n1', type: 'cache', label: 'Cache', codeName: 'cache', position: { x: 0, y: 0 } }] }
    window.localStorage.setItem(`archpilot.design.pending.${TEST_USER.id}.dsg_1`, JSON.stringify({ designId: 'dsg_1', baseRevision: 3, name: 'Orders platform', graph: mine }))
    await openWorkspace()
    expect(await screen.findByText('Restored unsaved changes from this browser.')).toBeTruthy()
    showLayers()
    expect(treeItems()).toHaveLength(1)
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByText('No components yet.')).toBeTruthy()
  })
})

describe('layers tree and issues (2.7, 2.8)', () => {
  test('Layers is an ARIA tree: arrows move, Left collapses, Enter moves focus to the Inspector', async () => {
    await openWorkspace(nestedGraph())
    showLayers()
    const [first] = treeItems()
    fireEvent.click(first)
    act(() => first.focus())
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(treeItems()[1].getAttribute('aria-selected')).toBe('true')
    expect(window.document.activeElement).toBe(treeItems()[1])
    fireEvent.keyDown(treeItems()[1], { key: 'ArrowLeft' })
    expect(treeItems()[1].getAttribute('aria-expanded')).toBe('false')
    expect(treeItems().map((item) => item.querySelector('strong')?.textContent)).toEqual(['DC1', 'Room A', 'Orders DB'])
    fireEvent.keyDown(treeItems()[1], { key: 'ArrowRight' })
    expect(treeItems()).toHaveLength(5)
    expect(treeItems()[3].textContent).toContain('Service')
    expect(treeItems()[3].textContent).toContain('orders_api')
    expect(treeItems()[3].textContent).toContain('1 issue')
    fireEvent.keyDown(treeItems()[3], { key: 'Enter' })
    await waitFor(() => expect(window.document.activeElement).toBe(screen.getByLabelText('Label')))
    expect((screen.getByLabelText('Label') as HTMLInputElement).value).toBe('Orders API')
  })

  test('Issues lists validateGraph findings with severity words; clicking one selects its node; F8 steps', async () => {
    await openWorkspace(nestedGraph())
    fireEvent.click(screen.getByRole('button', { name: /Validate/ }))
    const list = screen.getByText(/Nothing here blocks saving\./).closest('.dw-issues') as HTMLElement
    const rows = within(list).getAllByRole('button')
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringMatching(/^▲ WarningDES-W01 · orders_api/),
      expect.stringMatching(/^▲ WarningDES-W01 · orders_db/),
      expect.stringMatching(/^▲ WarningDES-W04 · orders_db/),
    ])
    fireEvent.click(rows[1])
    fireEvent.click(screen.getByRole('tab', { name: 'Inspector' }))
    expect((screen.getByLabelText('Label') as HTMLInputElement).value).toBe('Orders DB')
    key('F8')
    expect((screen.getByLabelText('Label') as HTMLInputElement).value).toBe('Orders API')
  })

  test('Ctrl+J moves Code and Issues into the right panel (REQ-DES-017 tabs)', async () => {
    await openWorkspace()
    const right = () => screen.getByRole('tablist', { name: 'Right panel' })
    expect(within(right()).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Inspector', 'Sizing', 'Target', 'Decisions', 'Assistant'])
    key('j', { ctrlKey: true })
    expect(within(right()).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Inspector', 'Issues', 'Code', 'Sizing', 'Target', 'Decisions', 'Assistant'])
    expect(within(screen.getByRole('tablist', { name: 'Canvas dock' })).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Diagram'])
  })
})

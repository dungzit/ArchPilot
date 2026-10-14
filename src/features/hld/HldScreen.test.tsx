// @vitest-environment jsdom
/**
 * WP-C: the HLD export screen against scripted `/api` answers. The runs and
 * pins backends do not exist yet in this branch, so their 404 must become a
 * notice, the outline must still count the design, edits must persist per
 * design, and the download must still produce a .docx.
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Copy } from '../../ui/copy'
import { installFakeFetch, jsonResponse, waitFor } from '../../test/fakeFetch'
import { hybridGraph, KAFKA_RUN, PIN } from '../../domain/hld/testFixtures'

// jsdom has no canvas: the diagram falls back to the design link.
vi.mock('./rasterise', () => ({ svgToPng: async () => null }))

import { HldScreen } from './HldScreen'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

const en = (value: Copy) => value.en
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
const $ = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector)

const SUMMARY = { id: 'dsg_1', workspaceId: 'w', name: 'Orders platform', schemaVersion: '2.0', visibility: 'private', revision: 4, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z' }

async function open(options: { runs?: 'missing' | 'ok'; pins?: 'missing' | 'ok' } = {}) {
  window.localStorage.clear()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  installFakeFetch((request) => {
    if (request.url.startsWith('/api/designs?')) return jsonResponse(200, { items: [SUMMARY], total: 1, limit: 100, offset: 0 })
    if (request.url === '/api/designs/dsg_1') return jsonResponse(200, { ...SUMMARY, graph: hybridGraph() })
    if (request.url === '/api/sizing-runs?designId=dsg_1') {
      return options.runs === 'ok'
        ? jsonResponse(200, { items: [KAFKA_RUN, { ...KAFKA_RUN, id: 'other', designId: 'dsg_other' }], total: 2 })
        : jsonResponse(404, { detail: 'Not Found' })
    }
    if (request.url === '/api/reference/pins?designId=dsg_1') {
      return options.pins === 'ok' ? jsonResponse(200, { items: [PIN], total: 1 }) : jsonResponse(404, { detail: 'Not Found' })
    }
    return jsonResponse(404, { detail: 'not found' })
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<MemoryRouter><HldScreen text={en} language="en" /></MemoryRouter>)
  })
  await waitFor(() => $('[data-testid="hld-counts"]') !== null && !$<HTMLButtonElement>('.hld-download')!.disabled, 'the outline and an enabled download')
}

const count = (name: string) => $(`[data-count="${name}"] dd`)?.textContent

function typeInto(element: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('HldScreen', () => {
  test('missing runs/pins services become notices; the outline still counts the design', async () => {
    await open()
    const notices = $('[data-testid="hld-notices"]')!.textContent!
    expect(notices).toContain('No sizing data yet')
    expect(notices).toContain('No reference pins yet')
    expect($('[data-testid="hld-runs-unavailable"]')).not.toBeNull()
    expect(count('components')).toBe('19')
    expect(count('connections')).toBe('8')
    expect(count('runs')).toBe('—')
    expect(count('pins')).toBe('—')
    expect(Number(count('risks'))).toBeGreaterThan(0)
    expect($('[data-outline="sizing"]')!.textContent).toContain('6. Sizing')
    // Manual fields start from the skeleton derived from the design brief.
    expect($<HTMLTextAreaElement>('[data-manual="nonFunctional"]')!.value).toContain('Availability (SLA): 99.95%')
    expect($<HTMLInputElement>('[data-meta="projectName"]')!.value).toBe('Orders platform')
  })

  test('runs and pins, when available, are counted and filtered to the design', async () => {
    await open({ runs: 'ok', pins: 'ok' })
    expect($('[data-testid="hld-notices"]')).toBeNull()
    expect(count('runs')).toBe('1') // the run of another design is dropped
    expect(count('pins')).toBe('1')
  })

  test('edits and toggles persist per design and renumber the outline', async () => {
    await open()
    await act(async () => { typeInto($<HTMLTextAreaElement>('[data-manual="security"]')!, 'TLS everywhere') })
    await act(async () => { typeInto($<HTMLInputElement>('[data-meta="customer"]')!, 'Bank ABC') })
    await act(async () => { $<HTMLInputElement>('[data-section="deployment"]')!.click() })
    const stored = JSON.parse(window.localStorage.getItem('archpilot.hld.dsg_1')!)
    expect(stored.manual).toEqual({ security: 'TLS everywhere' })
    expect(stored.meta.customer).toBe('Bank ABC')
    expect(stored.sections).toEqual({ deployment: false })
    expect($('[data-outline="deployment"]')).toBeNull()
    expect($('[data-outline="availability"]')!.textContent).toContain('4. High availability and DR')
    expect(window.localStorage.getItem('archpilot.hld-last-design')).toBe('dsg_1')
  })

  test('downloads HLD_<project>_v<version>.docx', async () => {
    await open()
    const created: Blob[] = []
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: vi.fn((blob: Blob) => { created.push(blob); return 'blob:hld' }),
      revokeObjectURL: vi.fn(),
    }))
    const clicked: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this.download) })
    await act(async () => { $<HTMLButtonElement>('.hld-download')!.click() })
    await waitFor(() => clicked.length === 1 || $('.hld-error') !== null, 'the download')
    expect($('.hld-error')).toBeNull()
    expect(clicked).toEqual(['HLD_Orders_platform_v1.0.docx'])
    expect(created[0].size).toBeGreaterThan(1000)
  })
})

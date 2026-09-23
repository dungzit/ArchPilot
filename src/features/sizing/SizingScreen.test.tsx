// @vitest-environment jsdom
/**
 * Task 3.4: the Sizing screen against a scripted `/api/benchmarks`.
 * Build-scope verification line: "no number renders without its formula".
 * Also: live recompute, the benchmark dropdown (server and fallback), the
 * measured toggle, the shortcut note, review hints, validation with accessible
 * errors, VI/EN.
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Sizing } from './SizingScreen'
import type { Copy } from '../../ui/copy'
import type { BenchmarkRow } from '../../domain/benchmarks'
import { installFakeFetch, jsonResponse, waitFor, type RecordedRequest } from '../../test/fakeFetch'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

const en = (value: Copy) => value.en
const vi_ = (value: Copy) => value.vi

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
let calls: RecordedRequest[]

const $ = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector)
const input = (field: string) => $<HTMLInputElement>(`#sizing-${field}`)!
const card = (id: string) => $(`[data-card="${id}"]`)!
const big = (id: string) => card(id).querySelector('.calc-big')!.textContent!.replace(/\s+/g, ' ').trim()
const hintIds = () => Array.from(container.querySelectorAll('.calc-hint')).map((node) => node.getAttribute('data-rule'))

function type(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

const edit = (field: string, value: string) => act(async () => { type(input(field), value) })

function row(componentType: string, metric: string, value: number): BenchmarkRow {
  return {
    id: `bmk_seed_${componentType}_${metric}_generic`,
    componentType,
    metric,
    value,
    unit: 'qps per node',
    hardwareProfile: 'generic planning baseline',
    basis: 'Message queue broker, persistent small messages. Rule of thumb for early planning.',
    sourceTitle: 'ArchPilot generic planning heuristic - not a vendor benchmark and not a measurement.',
    sourceUrl: null,
    retrievedDate: null,
    confidence: 'estimated',
    origin: 'seed',
    updatedAt: '2026-09-24T00:00:00+00:00',
  }
}

const SERVER_ROWS = [row('database', 'read_qps', 8_000), row('database', 'write_qps', 2_000), row('queue', 'read_qps', 20_000), row('queue', 'write_qps', 10_000)]

async function render(text = en, benchmarks: 'ok' | 'down' = 'ok') {
  calls = installFakeFetch((request) => {
    if (benchmarks === 'down') throw new TypeError('Failed to fetch')
    return request.url === '/api/benchmarks' ? jsonResponse(200, { items: SERVER_ROWS, total: SERVER_ROWS.length }) : jsonResponse(404, { detail: 'not found' })
  }).calls
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<Sizing text={text} />) })
  await waitFor(() => !$<HTMLSelectElement>('#sizing-benchmark')!.disabled, 'benchmarks loaded')
}

beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true })
afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
})

describe('Sizing screen (task 3.4)', () => {
  test('default scenario renders from the v2.0 engine, not hard-coded HTML', async () => {
    await render()
    expect(big('nodes')).toBe('11 node')
    expect(card('nodes').querySelector('.calc-range')!.textContent).toBe('range 6–16')
    expect(big('write-load')).toBe('15,000 writes/s')
    expect(big('storage')).toMatch(/^63\.\d TiB$/)
    expect(card('nodes').textContent).toContain('= ceil( max(20000 / 8000, 5000 * 3 / 2000) * (1 + 0.3) ) + 1')
  })

  test('no number renders without its formula, assumptions and a confidence tag', async () => {
    await render()
    const cards = Array.from(container.querySelectorAll('[data-card]'))
    expect(cards.map((node) => node.getAttribute('data-card'))).toEqual(['nodes', 'storage', 'write-load', 'network'])
    for (const node of cards) {
      const id = node.getAttribute('data-card')
      expect(node.querySelectorAll('.calc-formula code').length, `${id} formula + substitution`).toBe(2)
      expect(node.querySelectorAll('.calc-assumptions li').length, `${id} assumptions`).toBeGreaterThan(0)
      expect(node.querySelector('.calc-tag')?.textContent, `${id} confidence`).toMatch(/^(measured|declared|estimated|unverified) ±\d+%$/)
    }
  })

  test('live recompute on every input change', async () => {
    await render()
    await edit('peakWriteQps', '10000')
    expect(big('nodes')).toBe('21 node')
    await edit('replicationFactor', '1')
    // 10000 / 2000 = 5 write-nodes; x 1.3 = 6.5 -> 7; + 1 spare
    expect(big('nodes')).toBe('8 node')
  })

  test('the single-benchmark shortcut note shows the under-size, and disappears when it does not apply', async () => {
    await render()
    expect(card('nodes').querySelector('.calc-compare')!.textContent).toBe(
      'A single-benchmark shortcut would say 6 node(s): about 45% too small against 11 for this load.',
    )
    await edit('peakWriteQps', '100')
    await edit('replicationFactor', '1')
    expect(card('nodes').querySelector('.calc-compare')).toBeNull()
  })

  test('"load from benchmark" is fed by /api/benchmarks, fills both capacities and shows the citation', async () => {
    await render()
    expect(calls.map((call) => call.url)).toEqual(['/api/benchmarks'])
    const select = $<HTMLSelectElement>('#sizing-benchmark')!
    const labels = Array.from(select.options).map((option) => option.textContent)
    expect(labels).toContain('Message queue · generic planning baseline (20000 / 10000 qps)')
    await act(async () => {
      select.value = 'queue|generic planning baseline'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(input('readQpsPerNode').value).toBe('20000')
    expect(input('writeQpsPerNode').value).toBe('10000')
    expect(big('nodes')).toBe('3 node')
    expect($('#sizing-benchmark-note')!.textContent).toContain('not a vendor benchmark')

    // Hand-editing a capacity turns the selection back into "Custom".
    await edit('writeQpsPerNode', '9000')
    expect(select.value).toBe('')
  })

  test('benchmarks unreachable: built-in defaults, and the screen says so', async () => {
    await render(en, 'down')
    expect($('#sizing-benchmark-note')!.textContent).toContain('Could not load benchmarks from the server')
    expect($<HTMLSelectElement>('#sizing-benchmark')!.options.length).toBeGreaterThan(1)
    expect(big('nodes')).toBe('11 node')
  })

  test('the measured toggle narrows the range and raises the missing-citation hint', async () => {
    await render()
    await act(async () => { input('measured').click() })
    expect(card('nodes').querySelector('.calc-range')!.textContent).toBe('range 10–12')
    expect(card('nodes').querySelector('.calc-tag')!.textContent).toBe('measured ±10%')
    expect(hintIds()).toContain('measured-without-citation')
  })

  test('review hints are the deterministic rules, and say so', async () => {
    await render()
    await edit('compressionRatio', '1')
    await edit('retentionMonths', '36')
    await edit('peakFactor', '1')
    expect(hintIds()).toEqual(expect.arrayContaining(['compression-not-modelled', 'long-retention-uncompressed', 'no-peak-factor']))
    expect($('.calc-hints')!.textContent).toContain('Deterministic rules only. No AI in this version.')
  })

  test('invalid input: the field is marked, the error is announced by id, and results pause', async () => {
    await render()
    await edit('peakWriteQps', '0')
    const field = input('peakWriteQps')
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(field.getAttribute('aria-describedby')).toBe('sizing-peakWriteQps-error')
    expect($('#sizing-peakWriteQps-error')!.textContent).toBe('Must be greater than 0: the model needs some writes.')
    expect(container.querySelector('[data-card]')).toBeNull()
    expect($('.calc-paused')!.textContent).toContain('fix the 1 highlighted input')
    await edit('peakWriteQps', '')
    expect($('#sizing-peakWriteQps-error')!.textContent).toBe('Enter a number.')
    await edit('peakWriteQps', '5000')
    expect(big('nodes')).toBe('11 node')
  })

  test('every input has a programmatic label', async () => {
    await render()
    const inputs = Array.from(container.querySelectorAll<HTMLInputElement | HTMLSelectElement>('.calc-form input, .calc-form select'))
    expect(inputs.length).toBe(12)
    for (const element of inputs) {
      expect(element.labels?.length, element.id).toBe(1)
      expect(element.labels![0].textContent!.trim().length, element.id).toBeGreaterThan(0)
    }
  })

  test('Vietnamese copy', async () => {
    await render(vi_)
    expect($('label[for="sizing-peakReadQps"]')!.textContent).toContain('QPS đọc lúc cao điểm')
    expect(card('nodes').querySelector('h3')!.textContent).toBe('Số node cần')
    expect(card('nodes').querySelector('.calc-tag')!.textContent).toBe('ước lượng ±50%')
    expect(card('nodes').querySelector('.calc-compare')!.textContent).toContain('thiếu khoảng 45%')
  })

  test('reset restores the defaults', async () => {
    await render()
    await edit('peakReadQps', '99999')
    await act(async () => { $<HTMLButtonElement>('.page-header .secondary-button')!.click() })
    expect(input('peakReadQps').value).toBe('20000')
    expect(big('nodes')).toBe('11 node')
  })
})

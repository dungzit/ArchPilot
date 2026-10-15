// @vitest-environment jsdom
/**
 * ExcelPanel end to end in jsdom: template download, import preview with the
 * Excel -> DSL table, "engine not available" with the scaffold engine, save as
 * draft through the API, and an import error with its cell address.
 */
import ExcelJS from 'exceljs'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { RulePack } from '../../../contracts/pilot'
import { isEngineReady } from '../../../domain/rules/excel/engineGuard'
import { buildTemplateWorkbook } from '../../../domain/rules/excel/template'
import { installFakeFetch, jsonResponse, waitFor, type RecordedRequest } from '../../../test/fakeFetch'
import { copy } from '../../../ui/copy'
import { ExcelPanel } from './ExcelPanel'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
let calls: RecordedRequest[]
let stored: RulePack[]
const text = (c: ReturnType<typeof copy>) => c.en
const $ = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector)
const click = (element: Element | null) => act(async () => { element!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

async function upload(data: Uint8Array, name: string) {
  const input = $<HTMLInputElement>('[data-input="xlsx"]')!
  const file = new File([data.slice().buffer], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  stored = []
  ;({ calls } = installFakeFetch(async (req) => {
    if (req.url === '/api/rule-packs' && req.method === 'GET') return jsonResponse(200, { items: stored, total: stored.length })
    if (req.url === '/api/rule-packs' && req.method === 'POST') {
      const pack = { ...JSON.parse(req.body!), id: `rp_${stored.length + 1}`, builtIn: false } as RulePack
      stored.push(pack)
      return jsonResponse(201, pack)
    }
    return jsonResponse(404, { detail: 'not found' })
  }))
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }))
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ExcelPanel', () => {
  test('download template, import, preview, check, save as draft', async () => {
    const onImported = vi.fn()
    await act(async () => { root.render(<ExcelPanel text={text} language="en" onImported={onImported} />) })

    await click($('[data-action="download-template"]'))
    await waitFor(() => (URL.createObjectURL as unknown as { mock: { calls: unknown[] } }).mock.calls.length === 1, 'template download')
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled()

    const { data } = await buildTemplateWorkbook()
    await upload(data, 'archpilot-rule-template.xlsx')
    await waitFor(() => $('[data-table="translation"]') !== null, 'translation table')
    const table = $('[data-table="translation"]')!.textContent!
    expect(table).toContain('=CEILING(ingress*rf/broker_write/target_util,1)')
    expect(table).toContain('ceil(ingress * rf / broker_write / target_util)')
    expect(table).toContain('116.64')
    expect($('[data-table="tests"]')!.textContent).toContain('T1')

    await click($('[data-action="check"]'))
    if (!isEngineReady()) expect($('[data-check="unavailable"]')!.textContent).toContain('Rule engine not available')

    await click($('[data-action="save"]'))
    await waitFor(() => $('[data-saved]') !== null, 'saved')
    const post = calls.find((c) => c.method === 'POST')!
    const body = JSON.parse(post.body!)
    expect(body.name).toBe('Kafka sizing (template)')
    expect(body.models[0].calc).toHaveLength(4)
    expect(body.status).toBe(isEngineReady() ? $('[data-saved]')!.getAttribute('data-saved') : 'draft')
    expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ id: 'rp_1' }))
  })

  test('an import error shows the cell address and offers no save', async () => {
    await act(async () => { root.render(<ExcelPanel text={text} language="en" />) })
    const { data } = await buildTemplateWorkbook()
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(data.slice().buffer as unknown as Parameters<typeof wb.xlsx.load>[0])
    wb.getWorksheet('Calc')!.getCell('C3').value = { formula: 'INDIRECT("Inputs!F2")', result: 0 }
    const bad = new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer)
    await upload(bad, '<img src=x onerror=alert(1)>.xlsx')
    await waitFor(() => $('[data-import="error"]') !== null, 'import error')
    expect($('[data-list="issues"]')!.textContent).toContain('Calc!C3')
    expect($('[data-list="issues"]')!.textContent).toContain('Unsupported function INDIRECT.')
    expect($('[data-action="save"]')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
  })

  test('rejects a .xlsm file name', async () => {
    await act(async () => { root.render(<ExcelPanel text={text} language="en" />) })
    await upload(new Uint8Array([1, 2, 3]), 'macro.xlsm')
    await waitFor(() => $('[data-import="error"]') !== null, 'xlsm rejection')
    expect($('[data-list="issues"]')!.textContent).toContain('Only .xlsx is accepted')
  })
})

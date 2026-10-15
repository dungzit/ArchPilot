// @vitest-environment jsdom
/**
 * Rule editor in jsdom. The engine is mocked so the per-row compile error
 * mapping and the publish rule can be tested deterministically; one test makes
 * the engine throw to prove the "engine not available" path.
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { RulePack, SizingModelDef } from '../../../contracts/pilot'
import { KAFKA_TEMPLATE_MODEL } from '../../../domain/rules/excel/template'
import { installFakeFetch, jsonResponse, waitFor, type RecordedRequest } from '../../../test/fakeFetch'
import { copy } from '../../../ui/copy'
import { RuleEditorPanel } from './RuleEditorPanel'

const engine = vi.hoisted(() => ({ mode: 'throw' as 'throw' | 'mock' }))

vi.mock('../../../domain/rules/engine', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../domain/rules/engine')>()
  return {
    ...real,
    compileModel: (model: SizingModelDef) => {
      if (engine.mode === 'throw') throw new Error('rules engine: unavailable (test)')
      const bad = model.calc.filter((c) => c.formula.includes('??'))
      return bad.length === 0 ? { ok: true } : { ok: false, errors: bad.map((c) => ({ where: `calc.${c.name}`, message: `syntax error in ${c.name}` })) }
    },
    runModelTests: (model: SizingModelDef) => {
      if (engine.mode === 'throw') throw new Error('rules engine: unavailable (test)')
      return model.tests.map((t) => ({ testId: t.id, passed: true, failures: [] }))
    },
  }
})

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
const $$ = (selector: string) => [...container.querySelectorAll<HTMLElement>(selector)]
const click = (element: Element | null) => act(async () => { element!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value)
  act(() => { input.dispatchEvent(new Event('input', { bubbles: true })) })
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  engine.mode = 'mock'
  stored = []
  ;({ calls } = installFakeFetch(async (req) => {
    if (req.url === '/api/rule-packs' && req.method === 'GET') return jsonResponse(200, { items: stored, total: stored.length })
    if (req.url === '/api/rule-packs' && req.method === 'POST') {
      const pack = { ...JSON.parse(req.body!), id: `rp_${stored.length + 1}`, builtIn: false } as RulePack
      stored.push(pack)
      return jsonResponse(201, pack)
    }
    const put = /^\/api\/rule-packs\/(.+)$/.exec(req.url)
    if (put && req.method === 'PUT') {
      const pack = { ...JSON.parse(req.body!), id: decodeURIComponent(put[1]), builtIn: false } as RulePack
      stored = stored.map((p) => (p.id === pack.id ? pack : p))
      return jsonResponse(200, pack)
    }
    return jsonResponse(404, { detail: 'not found' })
  }))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('RuleEditorPanel', () => {
  test('shows compile errors on the right row, runs tests and saves as published', async () => {
    const onSaved = vi.fn()
    await act(async () => { root.render(<RuleEditorPanel text={text} language="en" onSaved={onSaved} />) })
    expect($('[data-compile]')!.getAttribute('data-compile')).toBe('ok')

    const formula = $('[data-row="calc-0"] .re-formula input') as HTMLInputElement
    type(formula, 'x * ??')
    expect($('[data-compile]')!.getAttribute('data-compile')).toBe('error')
    expect($('[data-row-error="calc-0"]')!.textContent).toContain('syntax error in y')
    type(formula, 'x * 2')
    expect($('[data-row-error="calc-0"]')).toBeNull()

    await click($('[data-action="add-inputs"]'))
    expect($$('[data-section="inputs"] tbody tr[data-row]')).toHaveLength(2)

    type($('[data-field="pack-name"]') as HTMLInputElement, 'My pack')
    await click($('[data-action="save"]'))
    await waitFor(() => $('[data-saved]') !== null, 'saved')
    expect($('[data-saved]')!.getAttribute('data-saved')).toBe('published')
    const body = JSON.parse(calls.find((c) => c.method === 'POST')!.body!)
    expect(body).toMatchObject({ name: 'My pack', status: 'published' })
    expect(body.models[0].inputs).toHaveLength(2)
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'rp_1' }))

    // Saving again updates the stored pack as a new version.
    await click($('[data-action="save"]'))
    await waitFor(() => calls.some((c) => c.method === 'PUT'), 'update')
    expect(JSON.parse(calls.find((c) => c.method === 'PUT')!.body!).version).toBe(2)
  })

  test('edits an initial pack, drops stale Excel text on formula edit, and pastes JSON', async () => {
    const initial: RulePack = { id: 'rp_7', name: 'Kafka', version: 3, status: 'published', builtIn: false, models: [KAFKA_TEMPLATE_MODEL] }
    await act(async () => { root.render(<RuleEditorPanel text={text} language="en" initial={initial} />) })
    expect(($('[data-field="pack-name"]') as HTMLInputElement).value).toBe('Kafka')
    expect($('[data-row="calc-0"] .re-excel')!.textContent).toBe('=CEILING(ingress*rf/broker_write/target_util,1)')
    type($('[data-row="calc-0"] .re-formula input') as HTMLInputElement, 'ceil(ingress * rf / broker_write)')
    expect($('[data-row="calc-0"] .re-excel')).toBeNull()

    await click($('[data-action="toggle-json"]'))
    type($('[data-field="json"]') as HTMLTextAreaElement, JSON.stringify({ name: 'Pasted', models: [{ ...KAFKA_TEMPLATE_MODEL, id: 'k2' }] }))
    await click($('[data-action="load-json"]'))
    expect(($('[data-field="pack-name"]') as HTMLInputElement).value).toBe('Pasted')
    expect(($('[data-field="model-id"]') as HTMLInputElement).value).toBe('k2')

    // A successful load closes the JSON box; reopen it for the invalid case.
    await click($('[data-action="toggle-json"]'))
    type($('[data-field="json"]') as HTMLTextAreaElement, '{"models": [{"id": 1}]}')
    await click($('[data-action="load-json"]'))
    expect($('[data-error="json"]')!.textContent).toContain('models[0].id')
  })

  test('engine not available: no crash, saved as draft', async () => {
    engine.mode = 'throw'
    await act(async () => { root.render(<RuleEditorPanel text={text} language="en" />) })
    expect($('[data-compile]')!.getAttribute('data-compile')).toBe('unavailable')
    await click($('[data-action="run-tests"]'))
    expect($('[data-check="unavailable"]')).not.toBeNull()
    await click($('[data-action="save"]'))
    await waitFor(() => $('[data-saved]') !== null, 'saved')
    expect($('[data-saved]')!.getAttribute('data-saved')).toBe('draft')
  })

  test('a duplicate name asks before creating a second pack', async () => {
    stored = [{ id: 'rp_1', name: 'Rule pack mới / New rule pack', version: 1, status: 'draft', builtIn: false, models: [] }]
    await act(async () => { root.render(<RuleEditorPanel text={text} language="en" />) })
    await click($('[data-action="save"]'))
    await waitFor(() => $('[data-dialog="duplicate"]') !== null, 'duplicate prompt')
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })
})

// @vitest-environment jsdom
/**
 * Pilot WP-A: the Rules screen against a scripted API. Run tab: pack/model
 * pickers, live recompute, validation, binding note, trace, warnings, model
 * tests, save/list/delete runs; API failure tolerance; tab switching; VI/EN.
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { User } from '../../api/auth'
import type { RulePack, SizingRun } from '../../contracts/pilot'
import { installFakeFetch, jsonResponse, waitFor, type RecordedRequest } from '../../test/fakeFetch'
import type { Copy } from '../../ui/copy'
import { parseInputs } from './inputValues'
import { RulesScreen } from './RulesScreen'
import { kafkaModel } from '../../domain/rules/packs/kafka'
import { rdbmsModel } from '../../domain/rules/packs/rdbms'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

const en = (value: Copy) => value.en
const vi_ = (value: Copy) => value.vi

const TEAM_PACK: RulePack = {
  id: 'rpk_team1',
  name: 'Team pack',
  version: 2,
  status: 'draft',
  builtIn: false,
  owner: 'usr_other',
  models: [{
    id: 'double',
    nameVi: 'Nhân đôi',
    nameEn: 'Doubler',
    componentType: 'test',
    inputs: [{ name: 'a', labelVi: 'A', labelEn: 'A', unit: 'GB', default: 21 }],
    params: [],
    calc: [{ name: 'b', formula: 'a * 2', unit: 'GB' }],
    outputs: [{ name: 'b', from: 'b', unit: 'GB', labelEn: 'Doubled' }],
    warnings: [],
    lookups: [],
    tests: [{ id: 'T1', inputs: {}, expected: { b: 42 }, tolerance: 0 }],
  }],
}

const DESIGN = { id: 'dsg_1', workspaceId: 'wsp_1', name: 'Checkout', schemaVersion: '2.0', visibility: 'private', revision: 1, createdAt: '2026-10-14T00:00:00+00:00', updatedAt: '2026-10-14T00:00:00+00:00' }

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
let calls: RecordedRequest[]
let savedRuns: SizingRun[]

const $ = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector)
const $$ = (selector: string) => Array.from(container.querySelectorAll(selector))
const big = (name: string) => $(`[data-output="${name}"] .calc-big`)!.textContent!.replace(/\s+/g, ' ').trim()

function setValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value)
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
}
const edit = (name: string, value: string) => act(async () => { setValue($<HTMLInputElement>(`#rule-input-${name}`)!, value) })
const choose = (selector: string, value: string) => act(async () => { setValue($<HTMLSelectElement>(selector)!, value) })
const click = (element: Element) => act(async () => { (element as HTMLElement).click() })

let serverPacks: RulePack[]

async function render(options: { text?: (value: Copy) => string; packs?: 'ok' | 'down'; user?: User } = {}) {
  savedRuns = []
  serverPacks = [TEAM_PACK]
  calls = installFakeFetch(async (request) => {
    const url = new URL(request.url, 'http://localhost')
    if (url.pathname === '/api/rule-packs' && request.method === 'POST') {
      const pack = { ...JSON.parse(request.body!), id: `rpk_new${serverPacks.length}`, version: 1, builtIn: false, owner: options.user?.username } as RulePack
      serverPacks = [...serverPacks, pack]
      return jsonResponse(201, pack)
    }
    if (url.pathname === '/api/rule-packs') {
      return options.packs === 'down' ? jsonResponse(500, { detail: 'internal server error' }) : jsonResponse(200, { items: serverPacks, total: serverPacks.length })
    }
    if (url.pathname === '/api/designs') return jsonResponse(200, { items: [DESIGN], total: 1, limit: 100, offset: 0 })
    if (url.pathname === '/api/sizing-runs' && request.method === 'GET') {
      const designId = url.searchParams.get('designId')
      const items = savedRuns.filter((run) => !designId || run.designId === designId)
      return jsonResponse(200, { items, total: items.length })
    }
    if (url.pathname === '/api/sizing-runs' && request.method === 'POST') {
      const run = { ...JSON.parse(request.body!), id: `run_${savedRuns.length + 1}`, createdAt: '2026-10-15T01:02:03+00:00' } as SizingRun
      savedRuns.push(run)
      return jsonResponse(201, run)
    }
    if (url.pathname.startsWith('/api/sizing-runs/') && request.method === 'DELETE') {
      savedRuns = savedRuns.filter((run) => `/api/sizing-runs/${run.id}` !== url.pathname)
      return new Response(null, { status: 204 })
    }
    return jsonResponse(404, { detail: 'not found' })
  }).calls
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<RulesScreen text={options.text ?? en} language={options.text === vi_ ? 'vi' : 'en'} user={options.user} />) })
  await waitFor(() => calls.some((call) => call.url.startsWith('/api/rule-packs')), 'rule packs requested')
  await waitFor(() => $('#rules-design option[value="dsg_1"]') !== null, 'designs loaded')
}

async function openKafka() {
  await choose('#rules-model', 'kafka')
  await waitFor(() => $('[data-output="brokers"]') !== null, 'kafka outputs')
}

beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true })
afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
})

describe('Rules screen: run sizing', () => {
  test('lists the built-in pack and the team pack; app-tier is the default model', async () => {
    await render()
    await waitFor(() => $$('#rules-pack option').length === 2, 'team pack listed')
    expect($$('#rules-pack option').map((option) => option.textContent)).toEqual(['ArchPilot core sizing · v1 · built-in', 'Team pack · v2 · draft'])
    expect($$('#rules-model option').map((option) => (option as HTMLOptionElement).value)).toEqual(['app-tier', 'redis', 'vmware-host', 'kafka', 'rdbms', 'san-storage'])
    expect(big('instances')).toBe('6 instance')
    expect(big('rps')).toBe('500 req/s')
  })

  test('kafka golden: 14 brokers, binding note, 4 core trace steps with substituted values', async () => {
    await render()
    await openKafka()
    expect(big('brokers')).toBe('14 broker')
    expect(big('storage')).toBe('116.64 TB')
    expect($('[data-binding]')!.getAttribute('data-binding')).toBe('storage_brokers')
    expect($('[data-binding]')!.textContent).toBe('Binding constraint: storage_brokers = 14 broker (Storage)')
    expect($$('.rules-trace tbody tr').map((row) => row.getAttribute('data-step'))).toEqual(kafkaModel.calc.map((step) => step.name))
    expect($('[data-step="tp_brokers"]')!.textContent).toContain('ceil(150 MB/s × 3 / 100 MB/s / 0.6) = ceil(7.5)')
    expect($('[data-step="brokers"]')!.textContent).toContain('max(8, 14, 3)')
    expect($('[data-step="storage_brokers"]')!.classList.contains('is-binding')).toBe(true)
    expect($('[data-section="warnings"]')).toBeNull()
  })

  test('live recompute: the QA K2 float trap gives 27 brokers; rf 2 in Prod shows the high warning', async () => {
    await render()
    await openKafka()
    await edit('ingress', '175')
    await edit('retention', '5')
    expect(big('brokers')).toBe('27 broker')
    await edit('rf', '2')
    expect($('[data-section="warnings"] li')!.getAttribute('data-severity')).toBe('high')
    expect($('[data-section="warnings"]')!.textContent).toContain('Replication factor below 3 in Prod.')
  })

  test('an out-of-range input is blocked with the allowed range, and results are hidden until fixed', async () => {
    await render()
    await openKafka()
    await edit('rf', '0')
    expect($('#rule-input-rf-error')!.textContent).toBe('Outside the allowed range 1 – 5.')
    expect($('#rule-input-rf')!.getAttribute('aria-invalid')).toBe('true')
    expect($('[data-output="brokers"]')).toBeNull()
    await edit('rf', '3')
    expect(big('brokers')).toBe('14 broker')
  })

  test('"Run tests" reports every embedded test as passed', async () => {
    await render()
    await openKafka()
    await click($('[data-action="run-tests"]')!)
    expect($('[data-tests-summary]')!.textContent).toBe(`${kafkaModel.tests.length}/${kafkaModel.tests.length} tests passed`)
    expect($$('[data-test]').every((item) => item.getAttribute('data-passed') === 'true')).toBe(true)
  })

  test('a team pack from the API runs too', async () => {
    await render()
    await waitFor(() => $$('#rules-pack option').length === 2, 'team pack listed')
    await choose('#rules-pack', 'rpk_team1')
    expect(big('b')).toBe('42 GB')
    expect($('[data-output="b"] h3')!.textContent).toBe('Doubled')
  })

  test('a failing /api/rule-packs keeps the built-in pack usable and says so', async () => {
    await render({ packs: 'down' })
    await waitFor(() => $('[data-packs-error]') !== null, 'error shown')
    expect($('[data-packs-error]')!.textContent).toContain('built-in packs still work')
    expect(big('instances')).toBe('6 instance')
  })
})

describe('Rules screen: saved runs', () => {
  test('save against a design with a label, list it for that design, delete it', async () => {
    await render()
    await openKafka()
    await choose('#rules-design', 'dsg_1')
    await act(async () => { setValue($<HTMLInputElement>('#rules-label')!, 'Kafka cluster (Prod)') })
    await click($('[data-action="save-run"]')!)
    await waitFor(() => $('[data-run="run_1"]') !== null, 'saved run listed')

    const post = calls.find((call) => call.method === 'POST')!
    expect(post.url).toBe('/api/sizing-runs')
    const body = JSON.parse(post.body!) as SizingRun
    expect(body).toMatchObject({ designId: 'dsg_1', componentLabel: 'Kafka cluster (Prod)', rulePackId: 'archpilot-core', rulePackVersion: 1, modelId: 'kafka', binding: 'storage_brokers' })
    expect(body.outputs[0]).toMatchObject({ name: 'brokers', value: 14 })
    expect(calls.some((call) => call.method === 'GET' && call.url === '/api/sizing-runs?designId=dsg_1')).toBe(true)
    expect($('[data-run="run_1"]')!.textContent).toContain('Kafka cluster (Prod)')
    expect($('[data-run="run_1"]')!.textContent).toContain('Brokers: 14 broker')

    await click($('[data-run="run_1"] button')!)
    await waitFor(() => $('[data-run="run_1"]') === null, 'run deleted')
    expect(calls.some((call) => call.method === 'DELETE' && call.url === '/api/sizing-runs/run_1')).toBe(true)
  })
})

describe('Rules screen: tabs and language', () => {
  test('Excel and editor tabs mount their panels on first visit and keep the run tab state', async () => {
    await render()
    await openKafka()
    expect($('[data-panel="rules-excel"]')).toBeNull()
    await click($('#rules-tab-excel')!)
    expect($('[data-panel="rules-excel"]')).not.toBeNull()
    expect($<HTMLElement>('#rules-panel-run')!.hidden).toBe(true)
    await click($('#rules-tab-editor')!)
    expect($('[data-panel="rules-editor"]')).not.toBeNull()
    await click($('#rules-tab-run')!)
    expect($<HTMLSelectElement>('#rules-model')!.value).toBe('kafka')
  })

  test('Vietnamese labels and messages', async () => {
    await render({ text: vi_ })
    expect($$('.rules-tab').map((tab) => tab.textContent)).toEqual(['Chạy sizing', 'Import/Export Excel', 'Soạn rule'])
    expect($('[data-output="instances"] h3')!.textContent).toBe('Số instance')
    await edit('ccu', '-1')
    expect($('#rule-input-ccu-error')!.textContent).toBe('Tối thiểu 0.')
  })
})

describe('Rules screen: rule editor', () => {
  const MEMBER: User = { id: 'usr_m', username: 'minh', displayName: 'Minh', role: 'member' }
  const packName = () => $<HTMLInputElement>('[data-panel="rules-editor"] [data-field="pack-name"]')!

  async function openInEditor(pack: string) {
    await waitFor(() => $$('#rules-pack option').length === 2, 'team pack listed')
    await choose('#rules-pack', pack)
    await click($('[data-action="open-in-editor"]')!)
    await waitFor(() => $('[data-panel="rules-editor"]') !== null, 'editor mounted')
  }

  test('the Run tab picker never resets the editor; only "Open in editor" does', async () => {
    await render({ user: MEMBER })
    await click($('#rules-tab-editor')!)
    expect($('[data-hint="open-in-editor"]')).not.toBeNull()
    await act(async () => { setValue(packName(), 'Half-done pack') })

    await click($('#rules-tab-run')!)
    await choose('#rules-pack', 'rpk_team1')
    await choose('#rules-pack', 'archpilot-core')
    await click($('#rules-tab-editor')!)
    expect(packName().value).toBe('Half-done pack')

    // Unsaved edits: "Open in editor" asks first, and Cancel keeps them.
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    await click($('#rules-tab-run')!)
    await openInEditor('rpk_team1')
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(packName().value).toBe('Half-done pack')
    confirm.mockReturnValue(true)
    await click($('#rules-tab-run')!)
    await click($('[data-action="open-in-editor"]')!)
    expect($<HTMLElement>('#rules-panel-editor')!.hidden).toBe(false)
    expect(packName().value).toBe('Team pack (bản sao)')
  })

  test('a member opens someone else\'s pack as a copy, can only save it as a new pack, and keeps the "Saved v1" note', async () => {
    await render({ user: MEMBER })
    await openInEditor('rpk_team1')
    expect(packName().value).toBe('Team pack (bản sao)')
    expect($('[data-meta]')!.getAttribute('data-meta')).toBe('copy')
    expect($('[data-copy-of]')!.textContent).toContain('owned by usr_other')
    const saveButton = $('[data-panel="rules-editor"] [data-action="save"]')!
    expect(saveButton.textContent).toBe('Save as a new pack')

    await click(saveButton)
    await waitFor(() => $('[data-panel="rules-editor"] [data-saved]') !== null, 'saved')
    const writes = calls.filter((call) => call.url.startsWith('/api/rule-packs') && call.method !== 'GET')
    expect(writes.map((call) => call.method)).toEqual(['POST'])
    expect(JSON.parse(writes[0].body!)).toMatchObject({ name: 'Team pack (bản sao)' })

    // The list reloads and the Run tab picks the new pack; the editor keeps its confirmation.
    await waitFor(() => $$('#rules-pack option').length === 3, 'list reloaded')
    expect($<HTMLSelectElement>('#rules-pack')!.value).toBe('rpk_new1')
    expect($('[data-panel="rules-editor"] [data-saved]')!.textContent).toContain('Saved "Team pack (bản sao)" v1')
    // Now the member owns the copy: the next save is an update.
    expect($('[data-meta]')!.getAttribute('data-meta')).toBe('editing')
  })

  test('the owner and an admin edit the pack in place', async () => {
    await render({ user: { ...MEMBER, username: 'usr_other' } })
    await openInEditor('rpk_team1')
    expect(packName().value).toBe('Team pack')
    expect($('[data-meta]')!.getAttribute('data-meta')).toBe('editing')
    await act(async () => { root.unmount() })
    container.remove()
    await render({ user: { ...MEMBER, role: 'admin' } })
    await openInEditor('rpk_team1')
    expect(packName().value).toBe('Team pack')
  })
})

describe('parseInputs', () => {
  test('rdbms growth_rate typed as a percentage (30) is rejected with the 0 – 2 range', () => {
    const { errors } = parseInputs(rdbmsModel, { growth_rate: '30' })
    expect(errors.growth_rate?.en).toBe('Outside the allowed range 0 – 2.')
    expect(parseInputs(rdbmsModel, { growth_rate: '0.3' }).errors.growth_rate).toBeUndefined()
  })

  test('required, not a number, min, max and range messages', () => {
    const { values, errors } = parseInputs(kafkaModel, { ingress: '', rf: 'abc', retention: '-1', fanout: '2', is_prod: '2' })
    expect(values).toEqual({ fanout: 2 })
    expect(Object.fromEntries(Object.entries(errors).map(([name, message]) => [name, message.en]))).toEqual({
      ingress: 'Required.',
      rf: 'Not a number.',
      retention: 'Minimum 0.',
      is_prod: 'Outside the allowed range 0 – 1.',
    })
  })
})

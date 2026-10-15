// @vitest-environment jsdom
/**
 * Pilot WP-B: the SysDesAi reference screen against a scripted /api/reference.
 * Covers: status line, debounce + Enter, result card (link target/rel, step
 * line, attribution on every card, article link, unsafe URL dropped), empty
 * and error states, phase filter, and the pin-to-design flow.
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ReferenceScreen, SEARCH_DEBOUNCE_MS, highlight } from './ReferenceScreen'
import type { Copy } from '../../ui/copy'
import type { ReferenceHit, ReferenceSearchResponse } from '../../contracts/pilot'
import { installFakeFetch, jsonResponse, waitFor, type RecordedRequest } from '../../test/fakeFetch'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

const en = (value: Copy) => value.en
const vi_ = (value: Copy) => value.vi

const URL_SHORTENER: ReferenceHit = {
  shareId: 'ExMwREO',
  url: 'https://www.sysdesai.com/share/ExMwREO',
  title: 'URL Shortener',
  prompt: 'Design a URL shortener like Bitly',
  categories: ['Other'],
  tab: 'featured',
  designSource: 'user',
  sourceBlogName: null,
  sourceArticleUrl: null,
  upvoteCount: 1148,
  updatedAt: '2026-09-23T10:00:00.000Z',
  score: 11.29,
  steps: [
    { position: 8, title: 'Add Cache Layer for Redirects', phase: 'build', snippet: 'we are introducing a dedicated Cache layer, specifically Redis.' },
    { position: 12, title: 'Short URL Redirection Flow', phase: 'flows', snippet: 'leverage the Cache (Redis) to quickly resolve short URLs' },
  ],
}

const STRIPE: ReferenceHit = {
  ...URL_SHORTENER,
  shareId: 'StripePay05',
  url: 'https://www.sysdesai.com/share/StripePay05',
  title: 'Idempotent Payment Processing',
  tab: 'real-world',
  designSource: 'article',
  sourceBlogName: 'Stripe Engineering',
  sourceArticleUrl: 'https://stripe.com/blog/idempotency',
  steps: [{ position: 1, title: 'Exactly-once payment charges', phase: 'problem', snippet: 'every payment request carries an idempotency key' }],
}

const EVIL: ReferenceHit = { ...STRIPE, shareId: 'EvilUrl06', url: 'https://www.sysdesai.com/share/EvilUrl06', title: 'Evil', sourceBlogName: 'Bad Blog', sourceArticleUrl: 'javascript:alert(1)' }

function searchBody(items: ReferenceHit[], expandedQuery = 'cache redirect "url shortener"'): ReferenceSearchResponse {
  return { query: 'q', expandedQuery, total: items.length, items }
}

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
let calls: RecordedRequest[]

const $ = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector)
const $$ = (selector: string) => Array.from(container.querySelectorAll<HTMLElement>(selector))
const searchCalls = () => calls.filter((call) => call.url.startsWith('/api/reference/search'))

function setValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value)
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
}

async function typeQuery(value: string) {
  await act(async () => { setValue($<HTMLInputElement>('#reference-query')!, value) })
}

async function submit() {
  await act(async () => { $<HTMLFormElement>('form.ref-search')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
}

type Handler = (request: RecordedRequest) => Response | Promise<Response>

async function render(handler: Handler, text = en) {
  calls = installFakeFetch(handler).calls
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<ReferenceScreen text={text} language={text === en ? 'en' : 'vi'} />) })
}

const defaultHandler = (items: ReferenceHit[] = [URL_SHORTENER, STRIPE, EVIL]): Handler => (request) => {
  if (request.url === '/api/reference/status') return jsonResponse(200, { indexedDesigns: 784, indexedSteps: 12000, lastCrawlAt: '2026-10-14T08:00:00+00:00' })
  if (request.url.startsWith('/api/reference/search')) return jsonResponse(200, searchBody(items))
  if (request.url.startsWith('/api/designs')) return jsonResponse(200, { items: [{ id: 'dsg_1', workspaceId: 'ws', name: 'Checkout', schemaVersion: '2.0', visibility: 'private', revision: 1, createdAt: '', updatedAt: '' }], total: 1, limit: 100, offset: 0 })
  if (request.url === '/api/reference/pins' && request.method === 'POST') return jsonResponse(201, { id: 'rpin_1', designId: 'dsg_1', shareId: 'ExMwREO', url: URL_SHORTENER.url, title: 'URL Shortener', stepPosition: 8, stepTitle: 'Add Cache Layer for Redirects', note: null, createdAt: '2026-10-14T09:00:00+00:00' })
  return jsonResponse(404, { detail: 'not found' })
}

beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true })
afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
})

describe('ReferenceScreen', () => {
  test('shows the index status line in Vietnamese', async () => {
    await render(defaultHandler(), vi_)
    await waitFor(() => $('[data-testid="reference-status"]')!.textContent!.includes('784'), 'status')
    expect($('[data-testid="reference-status"]')!.textContent).toMatch(/^Đã index 784 thiết kế · cập nhật 14\/10\/2026$/)
  })

  test('says so when the index is empty', async () => {
    await render((request) => request.url === '/api/reference/status'
      ? jsonResponse(200, { indexedDesigns: 0, indexedSteps: 0, lastCrawlAt: null })
      : jsonResponse(404, { detail: 'x' }))
    await waitFor(() => $('[data-testid="reference-status"]')!.textContent!.includes('No reference data yet'), 'empty status')
  })

  test('searches after the debounce, not on every keystroke', async () => {
    await render(defaultHandler())
    await typeQuery('bộ')
    await typeQuery('bộ nhớ đệm')
    expect(searchCalls()).toHaveLength(0)
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, SEARCH_DEBOUNCE_MS + 60)) })
    await waitFor(() => $$('.ref-card').length === 3, 'results')
    expect(searchCalls()).toHaveLength(1)
    expect(decodeURIComponent(searchCalls()[0].url.replace(/\+/g, ' '))).toContain('q=bộ nhớ đệm')
  })

  test('Enter searches immediately and renders the result card', async () => {
    await render(defaultHandler())
    await typeQuery('cache cho chuyển hướng link rút gọn')
    await submit()
    await waitFor(() => $$('.ref-card').length === 3, 'results')
    expect(searchCalls()).toHaveLength(1)

    const card = $('[data-share-id="ExMwREO"]')!
    const link = card.querySelector<HTMLAnchorElement>('h2 a')!
    expect(link.href).toBe('https://www.sysdesai.com/share/ExMwREO')
    expect(link.target).toBe('_blank')
    expect(link.rel).toBe('noopener noreferrer')
    expect(card.querySelector('.ref-tab')!.textContent).toBe('Featured')
    expect(card.querySelector('.ref-upvotes')!.textContent).toContain('1148')
    expect(card.querySelector('.ref-step-title')!.textContent).toBe('Step 8: Add Cache Layer for Redirects (Build-up)')
    expect(card.querySelector('.ref-snippet mark')!.textContent).toBe('Cache')
    expect($('.ref-expanded')!.textContent).toBe('cache redirect "url shortener"')

    // KH-P1-15: attribution on EVERY card.
    for (const each of $$('.ref-card')) {
      expect(each.querySelector('.ref-attribution')!.textContent).toContain('Source: SysDesAi · AI-generated content, for reference only')
    }
  })

  test('article designs link the original blog post; unsafe URLs are not links', async () => {
    await render(defaultHandler())
    await typeQuery('payment')
    await submit()
    await waitFor(() => $$('.ref-card').length === 3, 'results')
    const article = $('[data-share-id="StripePay05"] .ref-article a') as HTMLAnchorElement
    expect(article.href).toBe('https://stripe.com/blog/idempotency')
    expect(article.textContent).toBe('Stripe Engineering')
    expect(article.rel).toBe('noopener noreferrer')
    expect($('[data-share-id="EvilUrl06"] .ref-article')).toBeNull()
    expect(container.innerHTML).not.toContain('javascript:')
  })

  test('Vietnamese labels for steps and attribution', async () => {
    await render(defaultHandler(), vi_)
    await typeQuery('bộ nhớ đệm')
    await submit()
    await waitFor(() => $$('.ref-card').length === 3, 'results')
    expect($('[data-share-id="ExMwREO"] .ref-step-title')!.textContent).toBe('Bước 8: Add Cache Layer for Redirects (Xây dựng kiến trúc)')
    expect($('[data-share-id="ExMwREO"] .ref-attribution')!.textContent).toContain('Nguồn: SysDesAi · Nội dung AI-generated, chỉ để tham khảo')
    expect($('[data-share-id="ExMwREO"] .ref-tab')!.textContent).toBe('Nổi bật')
  })

  test('empty result and error states', async () => {
    await render(defaultHandler([]))
    await typeQuery('zzzz')
    await submit()
    await waitFor(() => $('.ref-empty') !== null, 'empty')
    expect($('.ref-empty')!.textContent).toContain('No matching reference found')

    await act(async () => { root.unmount() })
    container.remove()
    await render((request) => request.url.startsWith('/api/reference/search')
      ? jsonResponse(500, { detail: 'boom', requestId: 'r1' })
      : jsonResponse(200, { indexedDesigns: 1, indexedSteps: 1, lastCrawlAt: null }))
    await typeQuery('cache')
    await submit()
    await waitFor(() => $('.ref-error') !== null, 'error')
    expect($('.ref-error')!.textContent).toContain('boom')
  })

  test('phase filter is sent to the API', async () => {
    await render(defaultHandler())
    await typeQuery('redirect')
    await act(async () => { setValue($<HTMLSelectElement>('#reference-phase')!, 'flows') })
    await submit()
    await waitFor(() => searchCalls().some((call) => call.url.includes('phase=flows')), 'phase param')
    expect(searchCalls().at(-1)!.url).toContain('phase=flows')
  })

  test('pin to design: pick a design and a step, POST the pin', async () => {
    await render(defaultHandler())
    await typeQuery('cache')
    await submit()
    await waitFor(() => $$('.ref-card').length === 3, 'results')
    const card = $('[data-share-id="ExMwREO"]')!
    await act(async () => { card.querySelector<HTMLButtonElement>('.ref-pin-button')!.click() })
    await waitFor(() => card.querySelector('.ref-pin-form select') !== null, 'pin form')
    const [designSelect, stepSelect] = Array.from(card.querySelectorAll<HTMLSelectElement>('.ref-pin-form select'))
    expect(designSelect.value).toBe('dsg_1')
    await act(async () => { setValue(stepSelect, '8') })
    await act(async () => { card.querySelector<HTMLFormElement>('.ref-pin-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    await waitFor(() => card.querySelector('.ref-pin-ok') !== null, 'pinned')
    const post = calls.find((call) => call.url === '/api/reference/pins' && call.method === 'POST')!
    expect(JSON.parse(post.body!)).toEqual({ designId: 'dsg_1', shareId: 'ExMwREO', stepPosition: 8, note: null })
    expect(card.querySelector('.ref-pin-ok')!.textContent).toBe('Pinned to “Checkout”.')
  })
})

describe('highlight', () => {
  test('marks query words and keeps everything else as text', () => {
    const nodes = highlight('<b>Redis</b> caching for redirects', ['cache', 'redirect'])
    const text = nodes.map((node) => (typeof node === 'string' ? node : '[' + String((node as { props: { children: string } }).props.children) + ']')).join('')
    expect(text).toBe('<b>Redis</b> [caching] for [redirects]')
  })
})

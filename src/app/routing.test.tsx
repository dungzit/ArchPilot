// @vitest-environment jsdom
/**
 * Task 0.5: react-router, the Studio navigation shell and deep links.
 *
 * Renders the real AppRoot inside a MemoryRouter at a chosen URL, against the
 * same fake backend the shell tests use, and checks what a user sees: the
 * three sidebar groups, planned Studio screens that already answer their deep
 * links, the legacy modules at /m/<key>, 404s for unknown paths, role-gated
 * editorial, and a deep link that survives signing in.
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { AppRoot } from './App'
import { navItems, studioItems } from './navigation'
import { installFakeFetch, jsonResponse, TEST_USER, waitFor } from '../test/fakeFetch'
import type { User } from '../api/auth'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}</output>
}

const $ = (selector: string) => container.querySelector(selector)
const $$ = (selector: string) => Array.from(container.querySelectorAll(selector))
const where = () => $('[data-testid="location"]')?.textContent
const heading = () => $('.main-area h1')?.textContent
const breadcrumb = () => $('.breadcrumbs strong')?.textContent

function click(element: Element | null | undefined) {
  if (!element) throw new Error('element not found')
  return act(async () => { element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, button: 0 })) })
}

async function open(path: string, user: User | null = TEST_USER) {
  window.localStorage.clear()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  let signedIn = user !== null
  installFakeFetch((request) => {
    if (request.url === '/api/auth/me') return signedIn ? jsonResponse(200, user ?? TEST_USER) : jsonResponse(401, { detail: 'authentication required' })
    if (request.url === '/api/auth/login') {
      signedIn = true
      return jsonResponse(200, { user: TEST_USER, expiresAt: '2026-09-24T00:00:00+00:00', csrfToken: 'csrf' })
    }
    return jsonResponse(404, { detail: 'not found' })
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<MemoryRouter initialEntries={[path]}><AppRoot /><LocationProbe /></MemoryRouter>)
  })
  if (user) await waitFor(() => $('.app-shell') !== null, 'the signed-in shell')
}

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
})

describe('sidebar groups (design-v2 4.2.1)', () => {
  test('STUDIO lists the seven v1 surfaces in order; unbuilt ones say so', async () => {
    await open('/')
    const items = $$('.studio-nav .nav-item')
    expect(items.map((item) => item.getAttribute('data-studio'))).toEqual(studioItems.map((item) => item.key))
    expect(items.map((item) => item.getAttribute('href'))).toEqual(['/', '/designs', '/wizard', '/templates', '/hub', '/sizing', '/learn'])
    expect(items.filter((item) => item.querySelector('.nav-soon')).map((item) => item.getAttribute('data-studio'))).toEqual(['designs', 'wizard', 'templates', 'hub', 'learn'])
  })

  test('ARCHPILOT MODULES is collapsed by default and opens with its toggle', async () => {
    await open('/')
    const toggle = $('.nav-group-toggle')!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect($$('.main-nav .nav-item')).toHaveLength(0)
    await click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect($$('.main-nav .nav-item')).toHaveLength(navItems.length)
    expect($('.main-nav [data-module="sizing"]')?.getAttribute('href')).toBe('/sizing')
    expect($('.main-nav [data-module="decisions"]')?.getAttribute('href')).toBe('/m/decisions')
  })

  test('landing on a module route opens the group and marks the module active', async () => {
    await open('/m/decisions')
    expect($('.nav-group-toggle')?.getAttribute('aria-expanded')).toBe('true')
    expect($('.main-nav .nav-item.active')?.getAttribute('data-module')).toBe('decisions')
    expect($('.main-area')?.innerHTML).toContain('ADR &amp; SELF-REVIEW')
    expect(breadcrumb()).toBe('ADR & review')
  })

  test('EDITORIAL shows for an admin and not for a member', async () => {
    await open('/')
    expect($('.editorial-nav [data-studio="editorial"]')?.getAttribute('href')).toBe('/editorial')
    await act(async () => { root.unmount() })
    container.remove()
    await open('/', { ...TEST_USER, role: 'member' })
    expect($('.editorial-nav')).toBeNull()
  })
})

describe('deep links', () => {
  test('/ is the overview (home)', async () => {
    await open('/')
    expect(heading()).toBe('Từ quyết định đến giá trị.')
    expect(breadcrumb()).toBe('Tổng quan')
    expect($('.studio-nav .nav-item.active')?.getAttribute('data-studio')).toBe('home')
  })

  test.each([
    ['/hub/netflix-streaming', 'hub', 'Thư viện tri thức', 'slug: netflix-streaming'],
    ['/designs/dsg_123', 'designs', 'Thiết kế', 'designId: dsg_123'],
    ['/designs/dsg_123/brief/3', 'wizard', 'Thiết kế có hướng dẫn', 'designId: dsg_123 · step: 3'],
    ['/templates/three-tier-web', 'templates', 'Mẫu thiết kế', 'slug: three-tier-web'],
    ['/learn/l3-first-design', 'learn', 'Học tập', 'slug: l3-first-design'],
  ])('%s answers with the planned %s screen and echoes its parameters', async (path, key, label, params) => {
    await open(path)
    expect($('.planned-screen')?.getAttribute('data-studio')).toBe(key)
    expect(heading()).toBe(label)
    expect($('.planned-params')?.textContent).toBe(params)
    expect(where()).toBe(path)
  })

  test('route parameters are rendered as text, never as markup', async () => {
    await open('/hub/%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E')
    expect($('.planned-params img')).toBeNull()
    expect($('.planned-params')?.textContent).toBe('slug: <img src=x onerror=alert(1)>')
  })

  test('/sizing is the real calculator, and /m/sizing redirects there', async () => {
    await open('/m/sizing')
    expect(where()).toBe('/sizing')
    expect($('.main-area')?.innerHTML).toContain('SIZING STUDIO')
    expect($('.studio-nav .nav-item.active')?.getAttribute('data-studio')).toBe('sizing')
  })

  test('the architecture module still renders the canvas screen and the editor', async () => {
    await open('/m/architecture')
    expect($('.architecture-layout')).not.toBeNull()
    expect($('.architecture-editor-page')).not.toBeNull()
  })

  test.each(['/m/not-a-module', '/nope', '/designs/dsg_1/extra/deep'])('%s is a 404 page that names the path', async (path) => {
    await open(path)
    expect($('.not-found-screen')).not.toBeNull()
    expect($('.not-found-screen code')?.textContent).toBe(path)
    expect(breadcrumb()).toBe('Không tìm thấy')
  })

  test('/editorial is a 404 for a member and a planned screen for an admin', async () => {
    await open('/editorial/queue', { ...TEST_USER, role: 'member' })
    expect($('.not-found-screen')).not.toBeNull()
    await act(async () => { root.unmount() })
    container.remove()
    await open('/editorial/queue')
    expect($('.planned-screen')?.getAttribute('data-studio')).toBe('editorial')
  })
})

describe('navigation', () => {
  test('clicking a Studio item changes the URL and the screen', async () => {
    await open('/')
    await click($('.studio-nav [data-studio="hub"]'))
    expect(where()).toBe('/hub')
    expect(heading()).toBe('Thư viện tri thức')
    expect(breadcrumb()).toBe('Thư viện tri thức')
  })

  test("the overview's links go to module URLs", async () => {
    await open('/')
    await click($$('.hero-links button')[0])
    expect(where()).toBe('/m/architecture')
  })

  test('a deep link survives signing in', async () => {
    await open('/hub/some-pattern', null)
    await waitFor(() => $('form.auth-form') !== null, 'the login screen')
    expect(where()).toBe('/hub/some-pattern')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      for (const [id, value] of [['#login-username', 'architect'], ['#login-password', 'secret-password']]) {
        const input = $(id) as HTMLInputElement
        setter.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })
    await act(async () => { ($('form.auth-form') as HTMLFormElement).requestSubmit() })
    await waitFor(() => $('.app-shell') !== null, 'the shell after sign-in')
    expect(where()).toBe('/hub/some-pattern')
    expect($('.planned-screen')?.getAttribute('data-studio')).toBe('hub')
  })
})

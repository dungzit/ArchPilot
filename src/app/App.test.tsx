// @vitest-environment jsdom
/**
 * Shell regression test, added with task 1.1 (the `main.tsx` split).
 *
 * The split was proved byte-identical by a throwaway before/after DOM diff of
 * all 36 states; this file is the part worth keeping. It renders the real shell
 * and walks every nav item so that a future screen extraction cannot silently
 * drop a module, mis-wire the module switch, or break the VI/EN toggle.
 *
 * It asserts structure and headings, not full markup: a snapshot of ~600 KB of
 * HTML would fail on every legitimate copy edit and teach the team to run
 * `-u` without reading the diff.
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { App } from './App'
import { navItems, type ModuleKey } from './navigation'
import { installFakeFetch, jsonResponse, TEST_USER, waitFor } from '../test/fakeFetch'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

/** eyebrow + English <h1> for each module, in `navItems` order. */
const SCREEN_MARKERS: { key: ModuleKey; eyebrow: string; heading: string }[] = [
  { key: 'overview', eyebrow: 'PERSONAL ARCHITECT WORKSPACE', heading: 'From decisions to value.' },
  { key: 'lifecycle', eyebrow: '6R SOLUTION LIFECYCLE', heading: 'One decision, six stages.' },
  { key: 'user', eyebrow: '6U USER & BUSINESS', heading: 'Start with the user.' },
  { key: 'requirements', eyebrow: 'REQUIREMENTS & NFR', heading: 'Specify before you design.' },
  { key: 'architecture', eyebrow: 'ARCHITECTURE WORKSPACE', heading: 'Design with evidence.' },
  { key: 'decisions', eyebrow: 'ADR & SELF-REVIEW', heading: 'Decisions that can be revisited.' },
  { key: 'platform', eyebrow: 'PLATFORM WORKFLOW', heading: 'See technology by capability.' },
  { key: 'ucrops', eyebrow: 'UCROPS QUALITY GATE', heading: 'Six qualities of a sound design.' },
  { key: 'patterns', eyebrow: 'DESIGN FUNNEL', heading: 'Choose complexity with a reason.' },
  { key: 'data-model', eyebrow: 'DATA MODEL WORKFLOW', heading: 'From use case to access pattern.' },
  { key: 'knowledge', eyebrow: 'KNOWLEDGE & PATTERNS', heading: 'Search knowledge, not just keywords.' },
  { key: 'sizing', eyebrow: 'SIZING STUDIO', heading: 'Estimate before you build.' },
  { key: 'deployment', eyebrow: 'DEPLOYMENT BLUEPRINT', heading: 'Design for delivery.' },
  { key: 'operations', eyebrow: 'OPERATING SIGNALS', heading: 'Optimize with evidence.' },
  { key: 'innovation', eyebrow: 'TECHNOLOGY RADAR', heading: 'Track what is worth trying.' },
  { key: 'investment', eyebrow: 'INVESTMENT & TECHNOLOGY VALUE', heading: 'Invest with a reason.' },
]

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

function click(element: Element | null | undefined) {
  if (!element) throw new Error('element not found')
  return act(async () => {
    element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
}

const navButtons = () => Array.from(container.querySelectorAll('.main-nav .nav-item'))
const mainArea = () => container.querySelector('.main-area') as HTMLElement
const toEnglish = () => click(container.querySelector('.language-toggle'))

beforeEach(async () => {
  window.localStorage.clear()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  // Task 1.2: the shell only renders for a signed-in user. These tests are
  // about the shell, so the fake backend answers /api/auth/me with a user.
  // The login flow itself is covered by src/features/auth/LoginScreen.test.tsx.
  installFakeFetch((request) =>
    request.url === '/api/auth/me' ? jsonResponse(200, TEST_USER) : jsonResponse(404, { detail: 'not found' }))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<App />) })
  await waitFor(() => container.querySelector('.app-shell') !== null, 'the signed-in shell')
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
})

describe('App shell', () => {
  test('renders one nav item per module, in navItems order', () => {
    const labels = navButtons().map((button) => button.textContent)
    expect(labels).toHaveLength(navItems.length)
    expect(labels).toHaveLength(SCREEN_MARKERS.length)
    expect(SCREEN_MARKERS.map((marker) => marker.key)).toEqual(navItems.map((item) => item.key))
    labels.forEach((label, index) => expect(label).toContain(navItems[index].label.vi))
  })

  test('every module renders its own screen', async () => {
    await toEnglish()
    for (const [index, marker] of SCREEN_MARKERS.entries()) {
      await click(navButtons()[index])
      const html = mainArea().innerHTML
      expect(html, `module ${marker.key} eyebrow`).toContain(marker.eyebrow.replace('&', '&amp;'))
      expect(mainArea().querySelector('h1')?.textContent, `module ${marker.key} heading`).toBe(marker.heading)
    }
  })

  test('the architecture module renders both the canvas screen and the editor', async () => {
    const index = navItems.findIndex((item) => item.key === 'architecture')
    await click(navButtons()[index])
    expect(mainArea().querySelector('.architecture-layout')).not.toBeNull()
    expect(mainArea().querySelector('.architecture-editor-page')).not.toBeNull()
  })

  test('the language toggle swaps VI and EN copy in the shell and the screen', async () => {
    expect(mainArea().querySelector('h1')?.textContent).toBe('Từ quyết định đến giá trị.')
    expect(container.querySelector('.breadcrumbs strong')?.textContent).toBe('Tổng quan')
    await toEnglish()
    expect(mainArea().querySelector('h1')?.textContent).toBe('From decisions to value.')
    expect(container.querySelector('.breadcrumbs strong')?.textContent).toBe('Overview')
  })

  test('the workspace modal opens from the switcher and closes on cancel', async () => {
    await click(container.querySelector('.workspace-switcher'))
    expect(container.querySelector('.modal.workspace-modal')).not.toBeNull()
    await click(container.querySelector('.modal-footer .secondary-button'))
    expect(container.querySelector('.modal.workspace-modal')).toBeNull()
  })

  test('the investment modal opens from the overview action and closes on cancel', async () => {
    await click(container.querySelector('.page-header .primary-button'))
    expect(container.querySelector('.modal')).not.toBeNull()
    expect(container.querySelector('.calculation-column .primary-result strong')?.textContent).toBe('-12.9%')
    await click(container.querySelector('.modal-footer .secondary-button'))
    expect(container.querySelector('.modal')).toBeNull()
  })
})

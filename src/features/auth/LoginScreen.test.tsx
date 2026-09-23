// @vitest-environment jsdom
/**
 * Task 1.2 end-to-end in jsdom: the real <App/> against a scripted backend.
 * Covers the gate (401 on /me -> login), every error state the login screen
 * promises (wrong password, throttled, server unreachable), sign-in, logout
 * with the CSRF header, session expiry routing back to login, VI/EN, and the
 * accessibility basics (labels, focus, form submit = Enter).
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { App } from '../../app/App'
import { ApiError, apiRequest } from '../../api/client'
import { installFakeFetch, jsonResponse, TEST_USER, waitFor, type FakeHandler, type RecordedRequest } from '../../test/fakeFetch'
import { loginErrorMessage } from './LoginScreen'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
let calls: RecordedRequest[]

const $ = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector)
const loginForm = () => $<HTMLFormElement>('form.auth-form')
const usernameInput = () => $<HTMLInputElement>('#login-username')!
const passwordInput = () => $<HTMLInputElement>('#login-password')!
const alertText = () => $('[role="alert"]')?.textContent ?? ''

/** React tracks input values itself; set through the native setter so onChange fires. */
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

async function boot(handler: FakeHandler) {
  calls = installFakeFetch(handler).calls
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<App />) })
}

/** Fill both fields and submit the way Enter does: an implicit form submission. */
async function signIn(username: string, password: string) {
  await act(async () => {
    type(usernameInput(), username)
    type(passwordInput(), password)
  })
  await act(async () => { loginForm()!.requestSubmit() })
}

/** A backend with no session until a successful login with `secret-password`. */
function backend(overrides: { login?: (request: RecordedRequest) => Response } = {}): FakeHandler {
  let signedIn = false
  return (request) => {
    if (request.url === '/api/auth/me') {
      return signedIn ? jsonResponse(200, TEST_USER) : jsonResponse(401, { detail: 'authentication required' })
    }
    if (request.url === '/api/auth/login') {
      if (overrides.login) return overrides.login(request)
      const { password } = JSON.parse(request.body ?? '{}')
      if (password !== 'secret-password') return jsonResponse(401, { detail: 'invalid username or password' })
      signedIn = true
      document.cookie = 'archpilot_csrf=csrf-from-login; path=/'
      return jsonResponse(200, { user: TEST_USER, expiresAt: '2026-09-24T00:00:00+00:00', csrfToken: 'csrf-from-login' })
    }
    if (request.url === '/api/auth/logout') {
      signedIn = false
      return jsonResponse(200, { message: 'logged out' })
    }
    return jsonResponse(401, { detail: 'session invalid or expired' })
  }
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.localStorage.clear()
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
  document.cookie = 'archpilot_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
})

describe('auth gate', () => {
  test('no session: /api/auth/me 401 shows the login screen, not the app', async () => {
    await boot(backend())
    await waitFor(() => loginForm() !== null, 'login form')
    expect($('.app-shell')).toBeNull()
    expect(calls[0]).toMatchObject({ url: '/api/auth/me', method: 'GET', credentials: 'include' })
  })

  test('a live session skips the login screen (a refresh keeps you signed in)', async () => {
    await boot((request) => (request.url === '/api/auth/me' ? jsonResponse(200, TEST_USER) : jsonResponse(404, { detail: 'x' })))
    await waitFor(() => $('.app-shell') !== null, 'shell')
    expect(loginForm()).toBeNull()
    expect($('.user-card strong')?.textContent).toBe('Test Architect')
  })

  test('backend down on load: the login screen says so up front', async () => {
    await boot(() => new Response('', { status: 500, headers: { 'content-type': 'text/plain' } }))
    await waitFor(() => loginForm() !== null, 'login form')
    expect(alertText()).toContain('Không kết nối được máy chủ ArchPilot')
  })
})

describe('login screen', () => {
  test('accessibility basics: labelled fields, autocomplete hints, focus on username, a real form', async () => {
    await boot(backend())
    await waitFor(() => loginForm() !== null, 'login form')
    expect($('label[for="login-username"]')?.textContent).toContain('Tên đăng nhập')
    expect($('label[for="login-password"]')?.textContent).toContain('Mật khẩu')
    expect(usernameInput().autocomplete).toBe('username')
    expect(passwordInput().type).toBe('password')
    expect(passwordInput().autocomplete).toBe('current-password')
    expect(document.activeElement).toBe(usernameInput())
    expect($('form.auth-form button[type="submit"]')).not.toBeNull()
    expect($('section.auth-card')?.getAttribute('aria-labelledby')).toBe('login-title')
  })

  test('wrong password: clear message, password cleared and focused, username kept, no "session expired"', async () => {
    await boot(backend())
    await waitFor(() => loginForm() !== null, 'login form')
    await signIn('architect', 'nope-nope-nope')
    await waitFor(() => alertText() !== '', 'error')
    expect(alertText()).toContain('Sai tên đăng nhập hoặc mật khẩu.')
    expect(passwordInput().value).toBe('')
    expect(usernameInput().value).toBe('architect')
    expect(document.activeElement).toBe(passwordInput())
    expect(passwordInput().getAttribute('aria-invalid')).toBe('true')
    expect(passwordInput().getAttribute('aria-describedby')).toBe('login-error')
    expect($('.auth-notice')).toBeNull()
  })

  test('throttled (429): tells the user to wait', async () => {
    await boot(backend({ login: () => jsonResponse(429, { detail: 'too many failed attempts; try again later' }) }))
    await waitFor(() => loginForm() !== null, 'login form')
    await signIn('architect', 'whatever-password')
    await waitFor(() => alertText() !== '', 'error')
    expect(alertText()).toContain('Bạn đã nhập sai quá nhiều lần')
  })

  test('server unreachable during sign-in: says so, keeps what was typed', async () => {
    await boot(backend())
    await waitFor(() => loginForm() !== null, 'login form')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await signIn('architect', 'secret-password')
    await waitFor(() => alertText() !== '', 'error')
    expect(alertText()).toContain('Không kết nối được máy chủ ArchPilot')
    expect(passwordInput().value).toBe('secret-password')
  })

  test('empty fields are caught before any request', async () => {
    await boot(backend())
    await waitFor(() => loginForm() !== null, 'login form')
    const before = calls.length
    await act(async () => { loginForm()!.requestSubmit() })
    expect(alertText()).toContain('Nhập tên đăng nhập và mật khẩu.')
    expect(calls.length).toBe(before)
    expect(document.activeElement).toBe(usernameInput())
  })

  test('the VI/EN toggle works on the login screen and carries into the app', async () => {
    await boot(backend())
    await waitFor(() => loginForm() !== null, 'login form')
    await act(async () => { $('.auth-card .language-toggle')!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect($('#login-title')?.textContent).toBe('Sign in')
    expect($('label[for="login-password"]')?.textContent).toContain('Password')
    expect(document.documentElement.lang).toBe('en')
    await signIn('architect', 'secret-password')
    await waitFor(() => $('.app-shell') !== null, 'shell')
    expect($('.logout-button')?.textContent).toBe('Log out')
  })
})

describe('sign in, sign out, expiry', () => {
  test('success shows the app; Log out POSTs with the CSRF header and returns to login', async () => {
    await boot(backend())
    await waitFor(() => loginForm() !== null, 'login form')
    await signIn('  architect ', 'secret-password')
    await waitFor(() => $('.app-shell') !== null, 'shell')
    const loginCall = calls.find((call) => call.url === '/api/auth/login')!
    expect(JSON.parse(loginCall.body!)).toEqual({ username: 'architect', password: 'secret-password' })
    expect($('.user-card strong')?.textContent).toBe('Test Architect')

    await act(async () => { $('.logout-button')!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await waitFor(() => loginForm() !== null, 'login form after logout')
    const logoutCall = calls.find((call) => call.url === '/api/auth/logout')!
    expect(logoutCall.method).toBe('POST')
    expect(logoutCall.headers['x-csrf-token']).toBe('csrf-from-login')
    expect($('.auth-notice')?.textContent).toContain('Bạn đã đăng xuất.')
  })

  test('logout still leaves the app when the server cannot be reached', async () => {
    await boot(backend())
    await waitFor(() => loginForm() !== null, 'login form')
    await signIn('architect', 'secret-password')
    await waitFor(() => $('.app-shell') !== null, 'shell')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await act(async () => { $('.logout-button')!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await waitFor(() => loginForm() !== null, 'login form')
  })

  test('any later 401 (expired or revoked session) routes back to login with a notice', async () => {
    await boot(backend())
    await waitFor(() => loginForm() !== null, 'login form')
    await signIn('architect', 'secret-password')
    await waitFor(() => $('.app-shell') !== null, 'shell')
    // The fake backend answers every non-auth URL with 401, like an expired session.
    await act(async () => { await apiRequest('/api/designs').catch(() => undefined) })
    await waitFor(() => loginForm() !== null, 'login form after expiry')
    expect($('.auth-notice')?.textContent).toContain('Phiên đăng nhập đã hết hạn')
  })
})

describe('loginErrorMessage', () => {
  test('an unexpected server error shows its detail and reference, in both languages', () => {
    const message = loginErrorMessage(new ApiError({ status: 500, kind: 'http', detail: 'internal server error', requestId: 'r-1' }))
    expect(message.en).toBe('Sign-in failed: internal server error (ref r-1)')
    expect(message.vi).toContain('Đăng nhập thất bại')
  })
})

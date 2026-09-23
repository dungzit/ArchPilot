// @vitest-environment jsdom
/**
 * src/api/client.ts (task 1.2): credentials, CSRF from the cookie, JSON,
 * the typed ApiError built from the {detail, requestId?} envelope, "unreachable"
 * detection, and the 401 -> login hand-off.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ApiError, apiRequest, readCookie, setUnauthorizedHandler } from './client'
import { installFakeFetch, jsonResponse } from '../test/fakeFetch'

function setCookie(value: string) {
  document.cookie = value
}

function clearCookies() {
  for (const part of document.cookie.split(';')) {
    const name = part.split('=')[0].trim()
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
  }
}

async function caught(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError)
    return error as ApiError
  }
  throw new Error('expected the request to fail')
}

beforeEach(() => clearCookies())
afterEach(() => {
  vi.unstubAllGlobals()
  clearCookies()
})

describe('request shape', () => {
  test('GET sends credentials, accepts JSON, carries a request id, and no CSRF header or body', async () => {
    setCookie('archpilot_csrf=tok-123')
    const { calls } = installFakeFetch(() => jsonResponse(200, { ok: true }))
    await expect(apiRequest('/api/designs')).resolves.toEqual({ ok: true })
    const [request] = calls
    expect(request.credentials).toBe('include')
    expect(request.headers.accept).toBe('application/json')
    expect(request.headers['x-request-id']).toMatch(/^[0-9a-f]{8,}$/)
    expect(request.headers['x-csrf-token']).toBeUndefined()
    expect(request.headers['content-type']).toBeUndefined()
    expect(request.body).toBeUndefined()
  })

  test.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)('%s echoes the archpilot_csrf cookie in x-csrf-token', async (method) => {
    setCookie('archpilot_csrf=tok%2B123') // cookie values may be URL-encoded
    const { calls } = installFakeFetch(() => jsonResponse(200, {}))
    await apiRequest('/api/designs/x', { method, body: { name: 'n' } })
    expect(calls[0].headers['x-csrf-token']).toBe('tok+123')
  })

  test('a JSON body is serialised as-is: camelCase in, camelCase out, no case conversion', async () => {
    const { calls } = installFakeFetch(() => jsonResponse(201, { schemaVersion: '1.0', updatedAt: 'x' }))
    const result = await apiRequest('/api/designs', { method: 'POST', body: { name: 'n', graph: { schemaVersion: '1.0' } } })
    expect(calls[0].headers['content-type']).toBe('application/json')
    expect(JSON.parse(calls[0].body!)).toEqual({ name: 'n', graph: { schemaVersion: '1.0' } })
    expect(result).toEqual({ schemaVersion: '1.0', updatedAt: 'x' })
  })

  test('204 No Content resolves to undefined', async () => {
    installFakeFetch(() => new Response(null, { status: 204 }))
    await expect(apiRequest('/api/designs/x', { method: 'DELETE' })).resolves.toBeUndefined()
  })
})

describe('readCookie', () => {
  test('matches the exact name, not a prefix', () => {
    setCookie('archpilot_csrf_old=stale')
    expect(readCookie('archpilot_csrf')).toBeNull()
    setCookie('archpilot_csrf=fresh')
    expect(readCookie('archpilot_csrf')).toBe('fresh')
  })
})

describe('errors', () => {
  test('the error envelope becomes a typed ApiError', async () => {
    installFakeFetch(() => jsonResponse(409, { detail: 'revision conflict: current revision is 2', requestId: 'req-1' }))
    const error = await caught(apiRequest('/api/designs/x', { method: 'PUT', body: {} }))
    expect(error).toMatchObject({ status: 409, kind: 'http', detail: 'revision conflict: current revision is 2', requestId: 'req-1' })
    expect(error.message).toBe(error.detail)
  })

  test('requestId falls back to the response header', async () => {
    installFakeFetch(() => jsonResponse(404, { detail: 'design not found' }, { 'x-request-id': 'hdr-9' }))
    expect((await caught(apiRequest('/api/designs/x'))).requestId).toBe('hdr-9')
  })

  test('a network failure is "unreachable" with status 0', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    expect(await caught(apiRequest('/api/auth/me'))).toMatchObject({ status: 0, kind: 'unreachable' })
  })

  test('the Vite proxy answer when uvicorn is down (observed: 502, empty body) is "unreachable"', async () => {
    installFakeFetch(() => new Response(null, { status: 502 }))
    expect(await caught(apiRequest('/api/auth/me'))).toMatchObject({ status: 502, kind: 'unreachable', detail: 'HTTP 502' })
  })

  test('an older Vite proxy answer (500, empty text/plain) is also "unreachable", not a server bug', async () => {
    installFakeFetch(() => new Response('', { status: 500, headers: { 'content-type': 'text/plain' } }))
    expect(await caught(apiRequest('/api/auth/me'))).toMatchObject({ status: 500, kind: 'unreachable', detail: 'HTTP 500' })
  })

  test.each([502, 503, 504])('gateway status %i is "unreachable"', async (status) => {
    installFakeFetch(() => jsonResponse(status, { detail: 'bad gateway' }))
    expect((await caught(apiRequest('/api/auth/me'))).kind).toBe('unreachable')
  })

  test('our own 500 (with the envelope) is an http error that keeps its requestId', async () => {
    installFakeFetch(() => jsonResponse(500, { detail: 'internal server error', requestId: 'abc' }))
    expect(await caught(apiRequest('/api/designs'))).toMatchObject({ status: 500, kind: 'http', requestId: 'abc' })
  })

  test('an aborted request rethrows the AbortError untouched', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('aborted', 'AbortError') }))
    await expect(apiRequest('/api/auth/me')).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('401 handling', () => {
  test('a 401 on an ordinary call hands off to the unauthorized handler', async () => {
    const handler = vi.fn()
    const unregister = setUnauthorizedHandler(handler)
    installFakeFetch(() => jsonResponse(401, { detail: 'session invalid or expired' }))
    await caught(apiRequest('/api/designs'))
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0]).toMatchObject({ status: 401 })
    unregister()
  })

  test('allowUnauthorized (login, /me) does not trigger it', async () => {
    const handler = vi.fn()
    const unregister = setUnauthorizedHandler(handler)
    installFakeFetch(() => jsonResponse(401, { detail: 'invalid username or password' }))
    await caught(apiRequest('/api/auth/login', { method: 'POST', body: {}, allowUnauthorized: true }))
    expect(handler).not.toHaveBeenCalled()
    unregister()
  })

  test('unregistering stops the hand-off', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)()
    installFakeFetch(() => jsonResponse(401, { detail: 'authentication required' }))
    await caught(apiRequest('/api/designs'))
    expect(handler).not.toHaveBeenCalled()
  })
})

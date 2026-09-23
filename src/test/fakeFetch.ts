/**
 * Test-only helpers: a scriptable `fetch` stub plus a React `act`-aware wait.
 * Not imported by application code, so it never reaches the bundle.
 */
import { act } from 'react'
import { vi } from 'vitest'
import type { User } from '../api/auth'

export interface RecordedRequest {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
  credentials?: RequestCredentials
}

export type FakeHandler = (request: RecordedRequest) => Response | Promise<Response>

export const TEST_USER: User = { id: 'usr_test', username: 'architect', displayName: 'Test Architect', role: 'admin' }

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

/** Replace global fetch. Every call is recorded; `handler` decides the answer. */
export function installFakeFetch(handler: FakeHandler): { calls: RecordedRequest[] } {
  const calls: RecordedRequest[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const request: RecordedRequest = {
      url: String(input),
      method: init.method ?? 'GET',
      headers: { ...(init.headers as Record<string, string> | undefined) },
      body: typeof init.body === 'string' ? init.body : undefined,
      credentials: init.credentials,
    }
    calls.push(request)
    return handler(request)
  }))
  return { calls }
}

/** Let promises and React updates settle until `predicate` holds (or fail loudly). */
export async function waitFor(predicate: () => boolean, what = 'condition'): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  }
  throw new Error(`timed out waiting for ${what}`)
}

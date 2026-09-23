/**
 * The one HTTP client (build-scope §3.5.1, task 1.2). `fetch`, no HTTP library.
 *
 * What every call gets, so no resource module has to remember it:
 *  - `credentials: 'include'`: the session is an httpOnly cookie.
 *  - `x-csrf-token` on POST/PUT/PATCH/DELETE, read from the `archpilot_csrf`
 *    cookie (double-submit; the backend enforces it centrally in app/csrf.py).
 *    Read from the cookie rather than kept in memory, so it survives a reload.
 *  - `x-request-id`: the backend echoes it in logs and in every error body,
 *    so a user can quote one token in a bug report.
 *  - JSON in, JSON out. The wire is camelCase by contract
 *    (contracts/archgraph.schema.json, envelope rule a), identical to the
 *    SPA's own types, so there is deliberately NO case-conversion layer here.
 *  - Non-2xx becomes a typed `ApiError` built from the `{detail, requestId?}`
 *    error envelope (envelope rule b).
 *  - A 401 on any ordinary call hands control to the registered unauthorized
 *    handler (App.tsx: show the login screen). Calls whose 401 *is* the answer
 *    (`/api/auth/login`, `/api/auth/me`) opt out with `allowUnauthorized`.
 *
 * URLs are same-origin: the production container serves the SPA and the API
 * together, and in development vite.config.ts proxies `/api` to uvicorn.
 */

export const CSRF_COOKIE = 'archpilot_csrf'
export const CSRF_HEADER = 'x-csrf-token'
export const REQUEST_ID_HEADER = 'x-request-id'

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
/** Statuses a reverse proxy or gateway produces when the backend is not there. */
const GATEWAY_STATUSES = new Set([502, 503, 504])

/**
 * `http`        - the backend answered with an error envelope (401, 404, 409, 422, 429, ...).
 * `unreachable` - no usable answer: the network failed, or something in front of
 *                 the backend (the Vite proxy, a gateway) answered instead of it.
 */
export type ApiErrorKind = 'http' | 'unreachable'

export class ApiError extends Error {
  /** HTTP status, or 0 when no response arrived at all. */
  readonly status: number
  /** Always a string (envelope rule b), safe to render. */
  readonly detail: string
  readonly requestId?: string
  readonly kind: ApiErrorKind

  constructor(init: { status: number; detail: string; kind: ApiErrorKind; requestId?: string }) {
    super(init.detail)
    this.name = 'ApiError'
    this.status = init.status
    this.detail = init.detail
    this.kind = init.kind
    this.requestId = init.requestId
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError
}

type UnauthorizedHandler = (error: ApiError) => void
let unauthorizedHandler: UnauthorizedHandler | null = null

/** Register the "session is gone, show login" reaction. Returns an unregister function. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler): () => void {
  unauthorizedHandler = handler
  return () => {
    if (unauthorizedHandler === handler) unauthorizedHandler = null
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Serialised as JSON. Omit for no body. */
  body?: unknown
  signal?: AbortSignal
  /** Do not treat a 401 as "session expired". For login and `/me`, where 401 is a normal answer. */
  allowUnauthorized?: boolean
}

export function readCookie(name: string): string | null {
  if (typeof document === 'undefined' || !document.cookie) return null
  for (const part of document.cookie.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim())
    }
  }
  return null
}

function newRequestId(): string {
  // crypto.randomUUID only exists in secure contexts; an on-prem host served
  // over plain http on a LAN address is not one. Fall back rather than throw.
  const uuid = globalThis.crypto?.randomUUID?.()
  return (uuid ?? `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`).replace(/-/g, '')
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  const body = await readJson(response)
  const headerRequestId = response.headers.get(REQUEST_ID_HEADER) ?? undefined
  const envelope =
    body && typeof body === 'object' && typeof (body as { detail?: unknown }).detail === 'string'
      ? (body as { detail: string; requestId?: string })
      : null

  if (envelope && !GATEWAY_STATUSES.has(response.status)) {
    return new ApiError({
      status: response.status,
      detail: envelope.detail,
      requestId: envelope.requestId ?? headerRequestId,
      kind: 'http',
    })
  }
  // No error envelope means the answer did not come from our backend. The Vite
  // dev proxy answers `502` with an empty body when uvicorn is down (observed
  // 2026-09-23; older Vite versions answered `500 text/plain`). Report either
  // as "unreachable", not as a server bug.
  const unreachable = response.status >= 500
  return new ApiError({
    status: response.status,
    detail: envelope?.detail ?? `HTTP ${response.status}`,
    requestId: headerRequestId,
    kind: unreachable ? 'unreachable' : 'http',
  })
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'
  const headers: Record<string, string> = {
    accept: 'application/json',
    [REQUEST_ID_HEADER]: newRequestId(),
  }
  let body: string | undefined
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(options.body)
  }
  if (UNSAFE_METHODS.has(method)) {
    const token = readCookie(CSRF_COOKIE)
    if (token) headers[CSRF_HEADER] = token
  }

  let response: Response
  try {
    response = await fetch(path, { method, headers, body, credentials: 'include', signal: options.signal })
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    throw new ApiError({ status: 0, detail: 'network error: the server could not be reached', kind: 'unreachable' })
  }

  if (response.ok) {
    return (await readJson(response)) as T
  }

  const error = await toApiError(response)
  if (error.status === 401 && !options.allowUnauthorized) unauthorizedHandler?.(error)
  throw error
}

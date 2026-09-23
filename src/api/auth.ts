/**
 * `/api/auth/*` - local username/password (Product Owner decision 4; no SSO).
 * The only module that knows these URLs.
 */
import { apiRequest, isApiError } from './client'

export type Role = 'member' | 'editor' | 'admin'

/** Wire shape of `UserOut` in backend/app/schemas.py. */
export interface User {
  id: string
  username: string
  displayName: string
  role: Role
}

/** Wire shape of `LoginResponse`. The CSRF token is also set as a readable cookie; client.ts reads that. */
export interface LoginResponse {
  user: User
  expiresAt: string
  csrfToken: string
}

export function login(username: string, password: string): Promise<LoginResponse> {
  return apiRequest<LoginResponse>('/api/auth/login', {
    method: 'POST',
    body: { username, password },
    // 401 here means "wrong password", not "session expired".
    allowUnauthorized: true,
  })
}

/** The signed-in user, or `null` when there is no valid session. Other failures throw. */
export async function currentUser(signal?: AbortSignal): Promise<User | null> {
  try {
    return await apiRequest<User>('/api/auth/me', { signal, allowUnauthorized: true })
  } catch (error) {
    if (isApiError(error) && error.status === 401) return null
    throw error
  }
}

export async function logout(): Promise<void> {
  await apiRequest<unknown>('/api/auth/logout', { method: 'POST', allowUnauthorized: true })
}

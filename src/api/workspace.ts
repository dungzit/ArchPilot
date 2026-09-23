/**
 * `/api/workspaces/current` (task 1.3 server, task 1.4 client). The only module
 * that knows this URL. Wire shape = `WorkspaceRecord` in src/domain/store.ts.
 */
import { apiRequest, isApiError } from './client'
import type { WorkspaceRecord } from '../domain/store'

/** What PUT accepts. `id` and `updatedAt` are server-owned; `revision` is the one the client last saw (0 creates). */
export interface WorkspacePutBody {
  name: string
  projectName: string
  systemName: string
  deploymentTarget: string
  revision: number
}

/** The caller's workspace, or `null` before the first save (the server answers 404). Other failures throw. */
export async function getCurrentWorkspace(signal?: AbortSignal): Promise<WorkspaceRecord | null> {
  try {
    return await apiRequest<WorkspaceRecord>('/api/workspaces/current', { signal })
  } catch (error) {
    if (isApiError(error) && error.status === 404) return null
    throw error
  }
}

/** Create (`revision: 0`) or update. A stale revision rejects with an `ApiError` of status 409. */
export function putCurrentWorkspace(body: WorkspacePutBody, signal?: AbortSignal): Promise<WorkspaceRecord> {
  return apiRequest<WorkspaceRecord>('/api/workspaces/current', { method: 'PUT', body, signal })
}

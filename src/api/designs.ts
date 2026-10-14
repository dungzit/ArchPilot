/**
 * `/api/designs` (backend task 1.6; client for Phase 2 task 2.1/2.6). The only
 * module that knows these URLs. Wire shape = backend `DesignSummary` /
 * `DesignOut` (camelCase by contract; no case conversion).
 *
 * - The list omits graphs and is paginated (limit <= 100).
 * - PUT carries the revision the client last saw; a stale one rejects with an
 *   `ApiError` of status 409 (REQ-DES-009: a stale save is refused).
 * - Someone else's design answers 404, never 403.
 */
import { apiRequest } from './client'

export interface DesignSummary {
  id: string
  workspaceId: string
  name: string
  schemaVersion: string
  visibility: 'private' | 'workspace'
  seededFromPatternId?: string | null
  revision: number
  createdAt: string
  updatedAt: string
}

export interface DesignRecord extends DesignSummary {
  /** An ArchGraph document (1.0 or 2.0); the SPA migrates 1.0 on open. */
  graph: unknown
}

export interface DesignList {
  items: DesignSummary[]
  total: number
  limit: number
  offset: number
}

export interface DesignWrite {
  name: string
  graph: unknown
}

export interface DesignPut extends DesignWrite {
  revision: number
}

export function listDesigns(options: { limit?: number; offset?: number; signal?: AbortSignal } = {}): Promise<DesignList> {
  const limit = options.limit ?? 50
  const offset = options.offset ?? 0
  return apiRequest<DesignList>(`/api/designs?limit=${limit}&offset=${offset}`, { signal: options.signal })
}

export function getDesign(id: string, signal?: AbortSignal): Promise<DesignRecord> {
  return apiRequest<DesignRecord>(`/api/designs/${encodeURIComponent(id)}`, { signal })
}

export function createDesign(body: DesignWrite, signal?: AbortSignal): Promise<DesignRecord> {
  return apiRequest<DesignRecord>('/api/designs', { method: 'POST', body, signal })
}

export function putDesign(id: string, body: DesignPut, signal?: AbortSignal): Promise<DesignRecord> {
  return apiRequest<DesignRecord>(`/api/designs/${encodeURIComponent(id)}`, { method: 'PUT', body, signal })
}

export function deleteDesign(id: string, signal?: AbortSignal): Promise<void> {
  return apiRequest<void>(`/api/designs/${encodeURIComponent(id)}`, { method: 'DELETE', signal })
}

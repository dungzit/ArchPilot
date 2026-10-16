/**
 * `/api/reference` (pilot WP-B): search over the SysDesAi gallery index and
 * per-design reference pins. Contract: src/contracts/pilot.ts.
 */
import { apiRequest } from './client'
import type { ReferencePin, ReferencePinList, ReferenceSearchResponse, ReferenceStatus } from '../contracts/pilot'

export interface ReferenceSearchOptions {
  limit?: number
  phase?: string
  category?: string
  signal?: AbortSignal
}

export function searchReferences(q: string, options: ReferenceSearchOptions = {}): Promise<ReferenceSearchResponse> {
  const params = new URLSearchParams({ q })
  if (options.limit) params.set('limit', String(options.limit))
  if (options.phase) params.set('phase', options.phase)
  if (options.category) params.set('category', options.category)
  return apiRequest<ReferenceSearchResponse>(`/api/reference/search?${params.toString()}`, { signal: options.signal })
}

export function referenceStatus(signal?: AbortSignal): Promise<ReferenceStatus> {
  return apiRequest<ReferenceStatus>('/api/reference/status', { signal })
}

export function listReferencePins(designId: string, signal?: AbortSignal): Promise<ReferencePinList> {
  return apiRequest<ReferencePinList>(`/api/reference/pins?designId=${encodeURIComponent(designId)}`, { signal })
}

export function addReferencePin(pin: { designId: string; shareId: string; stepPosition?: number | null; note?: string | null }): Promise<ReferencePin> {
  return apiRequest<ReferencePin>('/api/reference/pins', { method: 'POST', body: pin })
}

export function deleteReferencePin(id: string): Promise<void> {
  return apiRequest<void>(`/api/reference/pins/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

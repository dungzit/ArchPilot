/**
 * `/api/sizing-runs` (pilot WP-A). Saved rule evaluations, optionally tied to a
 * design, so the HLD export (WP-C) can cite them. Contract: src/contracts/pilot.ts.
 */
import { apiRequest } from './client'
import type { SizingRun, SizingRunList } from '../contracts/pilot'

export function listSizingRuns(designId?: string | null, signal?: AbortSignal): Promise<SizingRunList> {
  const query = designId ? `?designId=${encodeURIComponent(designId)}` : ''
  return apiRequest<SizingRunList>(`/api/sizing-runs${query}`, { signal })
}

export function saveSizingRun(run: SizingRun): Promise<SizingRun> {
  return apiRequest<SizingRun>('/api/sizing-runs', { method: 'POST', body: run })
}

export function deleteSizingRun(id: string): Promise<void> {
  return apiRequest<void>(`/api/sizing-runs/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/**
 * `/api/rule-packs` (pilot WP-A). User-created and Excel-imported rule packs.
 * Built-in packs are not served here; they live in src/domain/rules.
 * Contract: src/contracts/pilot.ts.
 */
import { apiRequest } from './client'
import type { RulePack, RulePackList } from '../contracts/pilot'

export type RulePackDraft = Omit<RulePack, 'id' | 'builtIn' | 'createdAt' | 'updatedAt'>

export function listRulePacks(signal?: AbortSignal): Promise<RulePackList> {
  return apiRequest<RulePackList>('/api/rule-packs', { signal })
}

export function getRulePack(id: string, signal?: AbortSignal): Promise<RulePack> {
  return apiRequest<RulePack>(`/api/rule-packs/${encodeURIComponent(id)}`, { signal })
}

export function createRulePack(draft: RulePackDraft): Promise<RulePack> {
  return apiRequest<RulePack>('/api/rule-packs', { method: 'POST', body: draft })
}

export function updateRulePack(id: string, draft: RulePackDraft): Promise<RulePack> {
  return apiRequest<RulePack>(`/api/rule-packs/${encodeURIComponent(id)}`, { method: 'PUT', body: draft })
}

export function deleteRulePack(id: string): Promise<void> {
  return apiRequest<void>(`/api/rule-packs/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

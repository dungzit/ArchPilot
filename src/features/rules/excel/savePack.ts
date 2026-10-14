import { createRulePack, listRulePacks, updateRulePack, type RulePackDraft } from '../../../api/rulePacks'
import type { RulePack } from '../../../contracts/pilot'

/** A user pack with the same name (case-insensitive), or null. Network errors count as "none found". */
export async function findPackByName(name: string, excludeId?: string): Promise<RulePack | null> {
  try {
    const list = await listRulePacks()
    const key = name.trim().toLowerCase()
    return list.items.find((p) => !p.builtIn && p.id !== excludeId && p.name.trim().toLowerCase() === key) ?? null
  } catch {
    return null
  }
}

/** Create a new pack, or store `draft` as the next version of `existing`. */
export async function persistPack(draft: RulePackDraft, existing: RulePack | null): Promise<RulePack> {
  if (existing) return updateRulePack(existing.id, { ...draft, version: Math.max(existing.version, draft.version) + 1 })
  return createRulePack(draft)
}

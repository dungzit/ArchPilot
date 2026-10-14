/**
 * Per-design HLD settings in localStorage (TP-05: manual text survives
 * regeneration). Key `archpilot.hld.<designId>`. Every access is wrapped:
 * private mode, a full quota or a corrupt value must never break the screen.
 *
 * Only what the user changed is stored. A manual field that is absent means
 * "use the skeleton", so skeletons keep following the design until edited.
 */
import { MANUAL_FIELDS, SECTION_IDS, type HldLanguage, type HldManual, type HldMeta, type SectionToggles } from '../../domain/hld/types'

export const STORAGE_PREFIX = 'archpilot.hld.'
export const LAST_DESIGN_KEY = 'archpilot.hld-last-design'
const META_KEYS = ['customer', 'projectName', 'version', 'author', 'reviewer', 'date', 'changeNote'] as const
/** Guard against a runaway paste filling the quota. */
const MAX_FIELD = 50_000

export interface StoredHld {
  meta: Partial<HldMeta>
  language?: HldLanguage
  manual: Partial<HldManual>
  sections: SectionToggles
  excludedRuns: string[]
  excludedPins: string[]
}

export const emptyStored = (): StoredHld => ({ meta: {}, manual: {}, sections: {}, excludedRuns: [], excludedPins: [] })

export function storageKey(designId: string): string {
  return `${STORAGE_PREFIX}${designId}`
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
  } catch {
    return null
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const clip = (value: string) => value.slice(0, MAX_FIELD)

/** Keep only well-typed, known fields from whatever is in storage. */
export function sanitiseStored(raw: unknown): StoredHld {
  const out = emptyStored()
  if (!isObject(raw)) return out
  if (isObject(raw.meta)) {
    for (const key of META_KEYS) {
      const value = raw.meta[key]
      if (typeof value === 'string') out.meta[key] = clip(value)
    }
  }
  if (raw.language === 'vi' || raw.language === 'en') out.language = raw.language
  if (isObject(raw.manual)) {
    for (const key of MANUAL_FIELDS) {
      const value = raw.manual[key]
      if (typeof value === 'string') out.manual[key] = clip(value)
    }
  }
  if (isObject(raw.sections)) {
    for (const key of SECTION_IDS) {
      const value = raw.sections[key]
      if (typeof value === 'boolean') out.sections[key] = value
    }
  }
  const ids = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 1000) : [])
  out.excludedRuns = ids(raw.excludedRuns)
  out.excludedPins = ids(raw.excludedPins)
  return out
}

export function loadHldState(designId: string): StoredHld {
  try {
    const text = storage()?.getItem(storageKey(designId))
    return text ? sanitiseStored(JSON.parse(text)) : emptyStored()
  } catch {
    return emptyStored()
  }
}

/** false when the browser refused to store (quota, private mode). */
export function saveHldState(designId: string, state: StoredHld): boolean {
  try {
    const target = storage()
    if (!target) return false
    target.setItem(storageKey(designId), JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

export function loadLastDesign(): string | null {
  try {
    return storage()?.getItem(LAST_DESIGN_KEY) ?? null
  } catch {
    return null
  }
}

export function saveLastDesign(designId: string): void {
  try {
    storage()?.setItem(LAST_DESIGN_KEY, designId)
  } catch {
    // Not worth a message: the screen just opens on the first design next time.
  }
}

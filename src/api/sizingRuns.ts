/**
 * `/api/sizing-runs` (pilot WP-A). Saved rule evaluations, optionally tied to a
 * design, so the HLD export (WP-C) can cite them. Contract: src/contracts/pilot.ts.
 */
import { apiRequest } from './client'
import type { SizingRun, SizingRunList } from '../contracts/pilot'

/**
 * String caps of `SizingRunWrite` (backend/app/schemas_pilot_rules.py:
 * ShortText 200, LongText 4000). The engine can legitimately exceed them: a
 * param `source` of 200 characters becomes `param: <source>`, a long formula
 * grows when values are substituted, and a binding may be a printed
 * expression. Clipping here keeps "Save run" from failing with a 422.
 */
export const RUN_TEXT_CAPS = { short: 200, long: 4000 } as const

const ELLIPSIS = '…'

/** `text` cut to at most `max` UTF-16 units with a trailing ellipsis, never splitting a surrogate pair. */
export function clipText(text: string, max: number): string {
  if (text.length <= max) return text
  let end = max - ELLIPSIS.length
  const last = text.charCodeAt(end - 1)
  if (last >= 0xd800 && last <= 0xdbff) end -= 1
  return `${text.slice(0, end)}${ELLIPSIS}`
}

const clipOptional = <T extends string | null | undefined>(text: T, max: number): T => (typeof text === 'string' ? (clipText(text, max) as T) : text)

/** A copy of `run` whose free-text fields fit the server caps. Numbers and names are untouched. */
export function fitRunToServerCaps(run: SizingRun): SizingRun {
  const { short, long } = RUN_TEXT_CAPS
  return {
    ...run,
    componentLabel: clipOptional(run.componentLabel, short),
    rulePackName: clipOptional(run.rulePackName, short),
    modelName: clipText(run.modelName, short),
    inputs: run.inputs.map((input) => ({ ...input, source: clipOptional(input.source, short) })),
    steps: run.steps.map((step) => ({ ...step, formula: clipText(step.formula, long), substituted: clipText(step.substituted, long) })),
    outputs: run.outputs.map((output) => ({ ...output, label: clipOptional(output.label, short) })),
    binding: clipOptional(run.binding, short),
    warnings: run.warnings.map((warning) => ({ ...warning, messageVi: clipText(warning.messageVi, long), messageEn: clipText(warning.messageEn, long) })),
  }
}

export function listSizingRuns(designId?: string | null, signal?: AbortSignal): Promise<SizingRunList> {
  const query = designId ? `?designId=${encodeURIComponent(designId)}` : ''
  return apiRequest<SizingRunList>(`/api/sizing-runs${query}`, { signal })
}

export function saveSizingRun(run: SizingRun): Promise<SizingRun> {
  return apiRequest<SizingRun>('/api/sizing-runs', { method: 'POST', body: fitRunToServerCaps(run) })
}

export function deleteSizingRun(id: string): Promise<void> {
  return apiRequest<void>(`/api/sizing-runs/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export type ReviewState = 'pass' | 'fail' | 'not_applicable' | 'open'

export interface ReviewItem {
  id: string
  category: 'requirements' | 'architecture' | 'sizing' | 'evidence' | 'decision'
  label: string
  mandatory: boolean
  state: ReviewState
  note?: string
}

export function canMarkReviewed(items: ReviewItem[]): boolean {
  return items.every((item) => !item.mandatory || item.state === 'pass' || item.state === 'not_applicable')
}

export const defaultReviewChecklist: ReviewItem[] = [
  { id: 'requirements.scope', category: 'requirements', label: 'Requirements and NFRs are recorded', mandatory: true, state: 'open' },
  { id: 'architecture.target', category: 'architecture', label: 'Deployment target and boundaries are explicit', mandatory: true, state: 'open' },
  { id: 'sizing.evidence', category: 'sizing', label: 'Sizing assumptions have confidence and evidence', mandatory: true, state: 'open' },
  { id: 'evidence.provenance', category: 'evidence', label: 'Material outputs have provenance', mandatory: true, state: 'open' },
  { id: 'decision.tradeoffs', category: 'decision', label: 'Trade-offs and rejected options are documented', mandatory: true, state: 'open' },
]

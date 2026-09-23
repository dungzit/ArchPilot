export type RequirementType = 'functional' | 'nfr' | 'constraint' | 'assumption'
export type RequirementPriority = 'must' | 'should' | 'could' | 'wont'
export type RequirementConfidence = 'measured' | 'declared' | 'estimated' | 'unverified'

export interface LocalRequirement {
  id: string
  type: RequirementType
  title: string
  statement: string
  priority: RequirementPriority
  category: string
  metric: string
  targetValue: string
  unit: string
  confidence: RequirementConfidence
  status: 'proposed' | 'accepted' | 'rejected' | 'superseded'
  updatedAt: string
}

const STORAGE_KEY = 'archpilot.requirements.v1'

export const seedRequirements: LocalRequirement[] = [
  {
    id: 'NFR-001',
    type: 'nfr',
    title: 'Peak API throughput',
    statement: 'The system must sustain 2,000 requests per second during peak traffic.',
    priority: 'must',
    category: 'performance',
    metric: 'throughput',
    targetValue: '2000',
    unit: 'requests_per_second',
    confidence: 'declared',
    status: 'accepted',
    updatedAt: '2026-09-19T00:00:00.000Z',
  },
  {
    id: 'NFR-002',
    type: 'nfr',
    title: 'Submission latency',
    statement: 'P95 order submission latency must remain below 200 ms.',
    priority: 'must',
    category: 'performance',
    metric: 'p95_latency',
    targetValue: '200',
    unit: 'milliseconds',
    confidence: 'declared',
    status: 'proposed',
    updatedAt: '2026-09-19T00:00:00.000Z',
  },
]

export function loadRequirements(): LocalRequirement[] {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return seedRequirements
  try {
    const parsed = JSON.parse(raw) as LocalRequirement[]
    return Array.isArray(parsed) ? parsed : seedRequirements
  } catch {
    return seedRequirements
  }
}

export function saveRequirements(requirements: LocalRequirement[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(requirements))
}

export function upsertRequirement(requirements: LocalRequirement[], requirement: LocalRequirement): LocalRequirement[] {
  const existingIndex = requirements.findIndex((item) => item.id === requirement.id)
  if (existingIndex === -1) return [...requirements, requirement]
  return requirements.map((item, index) => index === existingIndex ? requirement : item)
}

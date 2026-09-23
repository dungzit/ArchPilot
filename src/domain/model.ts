export type Status = 'draft' | 'proposed' | 'under_review' | 'reviewed' | 'rejected' | 'stale' | 'superseded'
export type Confidence = 'measured' | 'declared' | 'estimated' | 'unverified'
export type DeploymentTarget = 'aws' | 'azure' | 'gcp' | 'vmware' | 'kubernetes' | 'on_premises' | 'bare_metal' | 'hybrid'

export interface Provenance {
  sourceIds: string[]
  confidence: Confidence
  recordedAt: string
  freshness: 'current' | 'stale' | 'unknown'
}

export interface EntityEnvelope {
  id: string
  entityType: string
  schemaVersion: string
  projectId: string
  revision: number
  status: Status
  ownerId: string
  createdAt: string
  updatedAt: string
  provenance: Provenance
}

export interface Requirement extends EntityEnvelope {
  entityType: 'requirement'
  type: 'functional' | 'nfr' | 'constraint' | 'assumption'
  title: string
  statement: string
  priority: 'must' | 'should' | 'could' | 'wont'
  category: string
  target?: { metric: string; operator: string; value: number; unit: string }
  acceptanceCriteria: string[]
}

export interface ArchitectureComponent {
  id: string
  name: string
  type: 'service' | 'database' | 'cache' | 'queue' | 'storage' | 'network' | 'security' | 'other'
  target: DeploymentTarget
  environment: string
}

export interface ArchitectureConnection {
  sourceId: string
  destinationId: string
  protocol?: string
  port?: number
  direction?: 'inbound' | 'outbound' | 'bidirectional'
}

export interface ArchitectureOption extends EntityEnvelope {
  entityType: 'architecture_option'
  name: string
  summary: string
  components: ArchitectureComponent[]
  connections: ArchitectureConnection[]
  requirementIds: string[]
  assumptions: string[]
  risks: string[]
}

export interface Decision extends EntityEnvelope {
  entityType: 'decision'
  title: string
  context: string
  optionIds: string[]
  selectedOptionId?: string
  rationale: string
  criteria: Array<{ name: string; weight: number }>
  evidenceIds: string[]
}

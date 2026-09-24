/**
 * ArchGraph design document types (task 0.3).
 *
 * The wire shape is `contracts/archgraph.schema.json` (contract 1.1.0). These
 * types mirror it by hand - there is no codegen (contracts/README.md) - and
 * `src/contracts/contract.test.ts` proves every fixture in the shared manifest
 * type-checks against them by running it through `migrateGraph` and
 * `validateGraph`.
 *
 * Two deliberate differences from design-v2 section 4.3.2, both from the
 * red-team review (docs/reviews/review-design-v2.md):
 * - B1: role ids and attribute names follow requirements v2.1 (statefulness,
 *   failureDomainLevel, failureDomainLabel; relational_db, network_segment...).
 * - B2: nothing target-specific sits on a node, and no data is ever a map key.
 *   Realisations are `deployment.bindings[]`, placements are arrays, and
 *   derivations are an array of {artifact, upstream, hash}.
 */

// ---------------------------------------------------------------- schema 1.0 (frozen)

export type LegacyNodeType =
  | 'client' | 'cdn' | 'load_balancer' | 'service' | 'database'
  | 'cache' | 'queue' | 'object_store' | 'external_api' | 'note'

export interface Position { x: number; y: number }

export interface ArchNodeV1 {
  id: string
  type: LegacyNodeType
  label: string
  position: Position
  rationale?: string
  sizingScenarioId?: string
  props?: Record<string, string | number>
}

export interface ArchEdgeV1 {
  id: string
  source: string
  target: string
  label: string
  direction: EdgeDirection
  rationale?: string
}

export interface ArchGraphV1 {
  schemaVersion: '1.0'
  nodes: ArchNodeV1[]
  edges: ArchEdgeV1[]
}

// ---------------------------------------------------------------- schema 2.0

/** A role id from contracts/catalog/components.json. Membership is checked by validateGraph. */
export type RoleId = string
/** A target kind (aws, vsphere, bare_metal, ...) or a target profile id. Data, not an enum. */
export type TargetId = string
export type ConfigValue = string | number | boolean | string[]
export type ConfigMap = Record<string, ConfigValue>

export type EdgeDirection = 'forward' | 'bidirectional'
export type EdgeKind = 'flow' | 'access'
export type EdgeMode =
  | 'connect' | 'read' | 'write' | 'read_write' | 'send'
  | 'consume' | 'send_consume' | 'publish' | 'deliver' | 'replicate'
export type EdgeProtocol =
  | 'tcp' | 'udp' | 'http' | 'https' | 'grpc' | 'amqp' | 'mqtt' | 'sql' | 'nfs' | 'smb' | 'iscsi' | 'other'

export type Statefulness = 'stateless' | 'stateful'
export type FailureDomainLevel = 'host' | 'rack' | 'zone' | 'site' | 'region'
export type Tier = 'edge' | 'web' | 'app' | 'data' | 'mgmt'
export type Criticality = 'low' | 'medium' | 'high'
export type DataClassification = 'public' | 'internal' | 'confidential' | 'restricted'
export type SizeClass = 'XS' | 'S' | 'M' | 'L' | 'XL'
export type Confidence = 'measured' | 'declared' | 'estimated' | 'unverified'

/** REQ-DES-024 / REQ-DES-025. Absent = the role default from the catalogue. */
export interface NodeAttributes {
  replicas?: number
  statefulness?: Statefulness
  failureDomainLevel?: FailureDomainLevel
  failureDomainLabel?: string
  tier?: Tier
  criticality?: Criticality
  dataClassification?: DataClassification
  sizeClass?: SizeClass
  owner?: string
}

export interface SizingAttachment {
  scenarioId: string
  formulaVersion?: string
  confidence?: Confidence
  summary?: Record<string, number>
  stale?: boolean
}

export interface ArchNodeV2 {
  id: string
  type: RoleId
  variant?: string
  label: string
  codeName: string
  /** Relative to the parent container when parentId is set. */
  position: Position
  size?: { width: number; height: number }
  parentId?: string
  attributes?: NodeAttributes
  /** Neutral, role-specific configuration. Never provider-specific. */
  config?: ConfigMap
  rationale?: string
  sizing?: SizingAttachment
  annotation?: { text?: string; shape?: 'rect' | 'ellipse' }
}

export interface ArchEdgeV2 {
  id: string
  source: string
  target: string
  label: string
  direction: EdgeDirection
  kind: EdgeKind
  mode?: EdgeMode
  protocol?: EdgeProtocol
  port?: number
  rationale?: string
}

export interface TargetProfile {
  id: TargetId
  target: TargetId
  label: string
  options?: ConfigMap
  iacAdapter?: string
}

/** A node's realisation on one target. Kept for every target, so re-targeting is lossless. */
export interface Binding {
  nodeId: string
  target: TargetId
  realisation: string
  config?: ConfigMap
}

export interface Placement { nodeId: string; profileId: TargetId }

export interface Scenario {
  id: string
  label: string
  defaultProfileId: TargetId
  placements?: Placement[]
}

export interface DeploymentModel {
  profiles: TargetProfile[]
  bindings?: Binding[]
  scenarios: Scenario[]
  activeScenarioId?: string
}

export interface Assumption { key: string; value: ConfigValue; reason?: string }

export interface BilingualText { en?: string; vi?: string }

export interface Suggestion {
  ruleId: string
  role?: RoleId
  variant?: string
  state: 'pending' | 'accepted' | 'dismissed'
  nodeId?: string
  because?: BilingualText
}

export interface CapacityTier {
  tier: string
  inputs?: Record<string, number>
  results?: Record<string, number>
  confidence?: Confidence
}

export interface DesignBrief {
  context?: ConfigMap
  answers?: ConfigMap
  assumptions?: Assumption[]
  capacity?: { formulaVersion: string; tiers: CapacityTier[] }
  suggestions?: Suggestion[]
  ruleSetVersion?: string
}

export type DecisionStatus = 'proposed' | 'accepted' | 'superseded' | 'rejected'

export interface DecisionRecord {
  id: string
  number: number
  title: string
  status: DecisionStatus
  context?: string
  options?: { name: string; pros?: string; cons?: string }[]
  decision?: string
  consequences?: string
  linkedNodeIds?: string[]
  source?: { kind: 'manual' | 'suggestion' | 'realisation' | 'template'; ref?: string }
  supersedes?: string
  author?: string
  /** A calendar date (YYYY-MM-DD), not a timestamp. */
  date?: string
}

export interface Derivation {
  artifact: string
  upstream: string
  /** sha256 hex of the upstream's canonical JSON (see hash.ts). */
  hash: string
  hashVersion?: number
}

export interface DesignSettings {
  codeName: string
  environment: string
  catalogueVersion?: string
  readmeMd?: string
}

export interface ArchGraphV2 {
  schemaVersion: '2.0'
  settings: DesignSettings
  nodes: ArchNodeV2[]
  edges: ArchEdgeV2[]
  deployment?: DeploymentModel
  brief?: DesignBrief
  decisions?: DecisionRecord[]
  derivations?: Derivation[]
}

export type ArchGraph = ArchGraphV1 | ArchGraphV2

export const CURRENT_SCHEMA_VERSION = '2.0' as const

/** Contract limits (archGraphV2), mirrored for the command layer. */
export const LIMITS = {
  nodes: 500,
  edges: 1000,
  decisions: 100,
  derivations: 500,
  profiles: 10,
  scenarios: 10,
  bindings: 5000,
  placementsPerScenario: 500,
} as const

export type Bilingual = { en: string; vi: string }

export type Severity = 'error' | 'warning' | 'info'

/**
 * One validation finding. `error` findings are the L1 integrity rules the
 * backend also enforces (the save is refused); `warning` and `info` never
 * block a save (REQ-DES-011).
 */
export interface Problem {
  severity: Severity
  ruleId: string
  path: string
  message: Bilingual
  nodeId?: string
  edgeId?: string
}

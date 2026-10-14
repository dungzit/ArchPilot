/**
 * Tool-agnostic IaC types (design-v2 4.3.6, 4.3.7, 4.4.3; REQ-ADP-001..011).
 *
 * Nothing here names a cloud or a tool. Terraform, Ansible or anything else
 * plugs in through `IacAdapter` (adapter.ts); the coverage report, the gate
 * runner, the Markdown files, the manifest and the zip only see these types.
 */
import type { FieldDescriptor } from '../../graph/catalog'
import type { ArchGraphV2, ArchNodeV2, Bilingual, ConfigMap, ConfigValue, FailureDomainLevel, Problem, TargetProfile } from '../../graph/types'

export type Badge = 'generatable' | 'manual' | 'unsupported'
/** Sub-kind shown in tooltips and COVERAGE.md (review A3). */
export type BadgeDetail = 'partial' | 'implicit' | 'reference'
export type NodeClass = Badge | 'annotation' | 'assignedToOtherTarget'
export type EdgeClass = 'generatable' | 'manual' | 'noCode' | 'assignedToOtherTarget'

/** A gate finding. `fix` is the one-line remedy REQ-IAC-008 asks for. */
export interface IacProblem extends Problem {
  fix?: Bilingual
}

// ---------------------------------------------------------------- realisation catalogue

/** Selects a realisation for a node: every listed condition must hold. */
export interface RealisationWhen {
  variant?: string[]
  configKey?: string
  in?: ConfigValue[]
}

export interface ManualStepTemplate {
  id: string
  /** `{codeName}`, `{role}`, `{target}` and `{<configKey>}` placeholders are filled from the node. */
  text: Bilingual
}

export interface Realisation {
  id: string
  role: string
  when?: RealisationWhen
  label: Bilingual
  badge: Badge
  detail?: BadgeDetail
  /** Why the badge is what it is (tooltip, COVERAGE.md "note"). */
  note: Bilingual
  /** Neutral config keys (and `replicas`) this realisation expresses; others become attribute rows (review M7). */
  consumes: string[]
  /** Neutral config keys that must be set for generation (IAC-E01). */
  requires?: string[]
  /** Target-specific binding fields (REQ-ADP-011). */
  fields?: FieldDescriptor[]
  manualSteps?: ManualStepTemplate[]
}

/** Access-edge mapping row (design-v2 4.4.8 access-edge matrix). Unlisted pairs raise IAC-E05. */
export interface AccessPair {
  source: string
  target: string
  modes: string[]
  note: Bilingual
}

export interface RealisationCatalogue {
  target: string
  version: string
  realisations: Realisation[]
  /** Renamed realisation ids: old -> new (review M7). Never a silent fallback. */
  aliases: { from: string; to: string }[]
  accessPairs: AccessPair[]
  /**
   * An access edge between two generated nodes with no row in accessPairs:
   * 'error' = IAC-E05 (aws: every edge must become rules or IAM), 'manual' =
   * listed in MANUAL-STEPS.md as a firewall request (vsphere, design-v2 4.3.7).
   */
  unmappedAccess: 'error' | 'manual'
}

// ---------------------------------------------------------------- coverage report (4.3.7)

export interface NodeCoverage {
  nodeId: string
  codeName: string
  role: string
  class: NodeClass
  detail?: BadgeDetail
  realisation?: string
  /** True when no binding existed and the catalogue default was used (REQ-TGT-006). */
  assumed?: boolean
  note: string
  reason?: string
}

export interface EdgeCoverage {
  edgeId: string
  source: string
  target: string
  kind: string
  mode?: string
  class: EdgeClass
  note: string
}

export interface AttributeRow {
  nodeId: string
  codeName: string
  key: string
  value: string
  note: string
}

export interface CoverageTotals {
  generatable: number
  manual: number
  unsupported: number
  annotation: number
  other: number
}

export interface CoverageReport {
  profileId: string
  target: string
  adapterId?: string
  nodes: NodeCoverage[]
  edges: EdgeCoverage[]
  attributes: AttributeRow[]
  totals: CoverageTotals
  /** TGT-E01 and friends, found while resolving. */
  problems: IacProblem[]
}

// ---------------------------------------------------------------- generation

export interface ManualStep {
  nodeId?: string
  codeName: string
  role: string
  realisation?: string
  items: string[]
}

export type PipelineChoice = 'none' | 'github' | 'gitlab'

export interface ExportOptions {
  pipeline: PipelineChoice
  /** Server-side design id, recorded in the manifest when known. */
  designId?: string
}

/** Everything an adapter needs about one design on one target profile. */
export interface TargetContext {
  doc: ArchGraphV2
  profile: TargetProfile
  scenarioId?: string
  /** Node ids whose effective profile is this one. */
  onTarget: ReadonlySet<string>
  byId: ReadonlyMap<string, ArchNodeV2>
  coverage: CoverageReport
  /** Profile options merged over the adapter's variable-schema defaults. */
  options: ConfigMap
}

/** The tool IR an adapter plans. Each adapter narrows it (`TerraformIr`, the Ansible stub's own shape). */
export interface ToolIr {
  readonly tool: string
  /** Problems found only while planning (for example generated-address collisions, IAC-E04). */
  readonly problems?: IacProblem[]
}

export interface GeneratedFile {
  /** Relative path inside the package root, `/`-separated. */
  path: string
  content: string
}

export type { FailureDomainLevel, FieldDescriptor }

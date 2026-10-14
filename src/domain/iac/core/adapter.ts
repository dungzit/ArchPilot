/**
 * The adapter interface (design-v2 4.4.3; REQ-ADP-001, 002, 005, 006, 009,
 * 010, 011; review m9).
 *
 * `tool` is free text on purpose: Terraform and Ansible are two values, not
 * two code paths. The core (coverage, gate runner, packaging, zip) never
 * branches on it; `stubs.test.ts` registers a YAML-emitting Ansible stub and
 * a second Terraform stub and runs them through the unchanged core.
 */
import type { ArchGraphV2 } from '../../graph/types'
import type {
  CoverageReport, ExportOptions, FailureDomainLevel, FieldDescriptor, GeneratedFile, IacProblem,
  ManualStep, RealisationCatalogue, TargetContext, ToolIr,
} from './types'

export interface IacAdapter {
  /** 'aws-terraform', 'vsphere-terraform', ... */
  readonly id: string
  /** semver; a change in output needs a bump (golden VERSION check). */
  readonly version: string
  /** 'terraform' | 'ansible' | ... */
  readonly tool: string
  /** Target kinds served: ['aws'] | ['vsphere']. */
  readonly targetKinds: string[]
  /** The tool version range the output needs, for example '>= 1.11.0, < 2.0.0'. */
  readonly toolConstraint: string
  readonly providerPins: { source: string; constraint: string }[]
  /** REQ-ADP-010. A node using another level gets IAC-W08. */
  readonly supportedFailureDomainLevels: FailureDomainLevel[]
  /** Target options the UI collects without adapter-specific code (REQ-ADP-011). */
  readonly variableSchema: FieldDescriptor[]
  /** Every path the adapter may emit (package-relative); the zip path guard allows nothing else. */
  readonly emittedFiles: string[]
  readonly pipelineTemplates: ('github' | 'gitlab')[]
  /** Run by the CI harness in every golden folder (REQ-ADP-006, NFR2-COR-001). */
  readonly validationCommands: string[][]
  /** Golden fixture names under `src/domain/iac/__fixtures__/` (REQ-ADP-006). */
  readonly goldenFixtures: string[]
  /** Bundled and versioned with the adapter (C-v2-8, review M11). */
  readonly catalogue: RealisationCatalogue

  /** Per-node and per-edge coverage without emitting files (REQ-ADP-002). Optional: the core default is used when absent. */
  coverage?(doc: ArchGraphV2, profileId: string): CoverageReport
  /** Adapter-specific rules (AWS-*, VSP-*), run after the neutral rules (REQ-ADP-008). */
  gate(ctx: TargetContext): IacProblem[]
  plan(ctx: TargetContext): ToolIr
  manualSteps(ctx: TargetContext): ManualStep[]
  /** The adapter's own files. The core adds COVERAGE.md, MANUAL-STEPS.md, the manifest and README.md. */
  files(ir: ToolIr, ctx: TargetContext, options: ExportOptions): GeneratedFile[]
  /** Adapter-specific README sections (run book). Optional. */
  readme?(ir: ToolIr, ctx: TargetContext, options: ExportOptions): string[]
}

export type AdapterStatus = 'shipped' | 'test'

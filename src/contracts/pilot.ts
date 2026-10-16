/**
 * Pilot v1 shared contracts (docs/v3). Owned by the lead: three work packages
 * build against these types in parallel, so change them only by agreement.
 *
 * - Rule packs and sizing runs: docs/v3/05-sizing-rule-builder.md (WP-A).
 * - SysDesAi reference search and pins: docs/v3/03-kh-phase1-sysdesai-reference-search.md (WP-B).
 * - HLD export consumes both: docs/v3/06-hld-template-proposal.md (WP-C).
 *
 * Wire format is camelCase JSON, same as the rest of /api.
 */

// ---------------------------------------------------------------------------
// Sizing rules (05 §2). Built-in packs live in TypeScript (src/domain/rules);
// user-created or Excel-imported packs are stored by the backend.
// ---------------------------------------------------------------------------

export type RuleStatus = 'draft' | 'published' | 'deprecated'
export type RuleSeverity = 'info' | 'low' | 'medium' | 'high'
export type RuleRounding = 'none' | 'ceil' | 'floor' | 'round'

export interface RuleInput {
  name: string
  labelVi: string
  labelEn: string
  /** Unit symbol understood by the rule engine, e.g. "MB/s", "day", "GB", "count". */
  unit: string
  default: number
  min?: number
  max?: number
  /** Where the default comes from (customer, catalog, expert...). */
  source?: string
}

export interface RuleParam {
  name: string
  value: number
  unit: string
  /** Citation or "catalog:<path>" note. */
  source?: string
}

export interface RuleCalc {
  name: string
  /** Rule DSL expression (05 §3). Excel formulas are translated to this on import. */
  formula: string
  unit: string
  description?: string
  /** The original Excel formula when the model was imported from Excel; used to export it back. */
  excelFormula?: string
}

export interface RuleOutput {
  name: string
  /** Name of the calc step (or input) that holds the value. */
  from: string
  unit: string
  rounding?: RuleRounding
  labelVi?: string
  labelEn?: string
}

export interface RuleWarning {
  /** Rule DSL boolean expression over inputs, params and calc names. */
  condition: string
  severity: RuleSeverity
  messageVi: string
  messageEn: string
}

export interface RuleLookup {
  name: string
  columns: string[]
  rows: (string | number)[][]
}

export interface RuleTest {
  id: string
  inputs: Record<string, number>
  expected: Record<string, number>
  /** Relative tolerance, e.g. 0.0001. */
  tolerance: number
}

export interface SizingModelDef {
  id: string
  nameVi: string
  nameEn: string
  /** Neutral component type it sizes, e.g. "kafka", "redis", "vmware-host". */
  componentType: string
  description?: string
  /**
   * 'units' (default): unit-aware DSL. Every value is converted to base units
   * (bytes, seconds), dimensions are checked, and each calc is expressed in its
   * declared unit. 'excel': models imported from Excel. Every identifier is its
   * raw number in its declared unit and no conversion happens, exactly like
   * the spreadsheet; correctness is proven by the imported tests instead.
   */
  formulaMode?: 'units' | 'excel'
  inputs: RuleInput[]
  params: RuleParam[]
  calc: RuleCalc[]
  outputs: RuleOutput[]
  warnings: RuleWarning[]
  lookups: RuleLookup[]
  tests: RuleTest[]
}

export interface RulePack {
  id: string
  name: string
  version: number
  status: RuleStatus
  builtIn: boolean
  owner?: string | null
  description?: string | null
  models: SizingModelDef[]
  createdAt?: string
  updatedAt?: string
}

export interface RulePackList {
  items: RulePack[]
  total: number
}

/** One evaluated calc step, shown as the trace (02 §10). */
export interface SizingStep {
  name: string
  formula: string
  /** The formula with the actual numbers and units substituted in. */
  substituted: string
  value: number
  unit: string
}

export interface SizingRunWarning {
  severity: RuleSeverity
  messageVi: string
  messageEn: string
}

/** The result of evaluating one model once. Saved so the HLD can cite it. */
export interface SizingRun {
  id?: string
  designId?: string | null
  /** Free label for the sized component, e.g. "Kafka cluster (Prod)". */
  componentLabel?: string | null
  rulePackId: string
  rulePackVersion: number
  /** The pack's display name when it was run (optional; older runs only have the id). */
  rulePackName?: string | null
  modelId: string
  modelName: string
  inputs: { name: string; value: number; unit: string; source?: string }[]
  steps: SizingStep[]
  /** `from`: the calc step (or input/param) the output reads; optional, older runs lack it. */
  outputs: { name: string; value: number; unit: string; label?: string; from?: string }[]
  /** Which constraint decided the result, when the model takes a max/min. */
  binding?: string | null
  warnings: SizingRunWarning[]
  createdAt?: string
}

export interface SizingRunList {
  items: SizingRun[]
  total: number
}

// ---------------------------------------------------------------------------
// SysDesAi reference search (03). Read-only index built by the crawler.
// ---------------------------------------------------------------------------

export type ReferenceTab = 'featured' | 'real-world' | 'community'

export interface ReferenceStepHit {
  /** 1-based position as shown on SysDesAi ("Bước 8"), not the internal step id. */
  position: number
  title: string
  phase: string
  /** Plain-text excerpt, at most ~300 characters. Never HTML. */
  snippet: string
}

export interface ReferenceHit {
  shareId: string
  /** Always https://www.sysdesai.com/share/<shareId>. */
  url: string
  title: string
  prompt: string
  categories: string[]
  tab: ReferenceTab | null
  designSource: 'user' | 'article' | null
  sourceBlogName: string | null
  sourceArticleUrl: string | null
  upvoteCount: number | null
  updatedAt: string | null
  score: number
  /** Up to 3 best-matching steps. */
  steps: ReferenceStepHit[]
}

export interface ReferenceSearchResponse {
  query: string
  /** The query after diacritic folding and the VI->EN glossary expansion. */
  expandedQuery: string
  total: number
  items: ReferenceHit[]
}

export interface ReferenceStatus {
  indexedDesigns: number
  indexedSteps: number
  lastCrawlAt: string | null
}

export interface ReferencePin {
  id: string
  designId: string
  shareId: string
  url: string
  title: string
  stepPosition?: number | null
  stepTitle?: string | null
  note?: string | null
  createdAt: string
}

export interface ReferencePinList {
  items: ReferencePin[]
  total: number
}

/**
 * Rule engine public interface (pilot WP-A, docs/v3/05). The lead fixed these
 * signatures so WP-A2 (Excel import, rule editor) and WP-C (HLD) can build in
 * parallel. WP-A owns the implementation and must keep the signatures.
 *
 * Pure: no React, no fetch, deterministic (decision D3: sizing arithmetic
 * lives in TypeScript only).
 */
import type { SizingModelDef, SizingRun } from '../../contracts/pilot'

export interface RuleError {
  /** Where the problem is, e.g. "calc.storage", "warnings[0]", "outputs.brokers". */
  where: string
  message: string
}

export type CompileResult = { ok: true } | { ok: false; errors: RuleError[] }

export interface ModelTestResult {
  testId: string
  passed: boolean
  failures: { output: string; expected: number; actual: number | null }[]
  error?: string
}

export interface EvaluateMeta {
  rulePackId: string
  rulePackVersion: number
  designId?: string | null
  componentLabel?: string | null
}

/** Parse and type-check every formula and warning condition of a model. Never throws. */
export function compileModel(model: SizingModelDef): CompileResult {
  void model
  throw new Error('rules engine: not implemented yet (WP-A)')
}

/**
 * Evaluate a model. Inputs missing from `inputs` take their defaults.
 * Throws an Error whose message names the failing step when evaluation fails.
 */
export function evaluateModel(model: SizingModelDef, inputs: Record<string, number>, meta: EvaluateMeta): SizingRun {
  void model
  void inputs
  void meta
  throw new Error('rules engine: not implemented yet (WP-A)')
}

/** Run every test case of a model. Never throws; failures are reported per test. */
export function runModelTests(model: SizingModelDef): ModelTestResult[] {
  void model
  throw new Error('rules engine: not implemented yet (WP-A)')
}

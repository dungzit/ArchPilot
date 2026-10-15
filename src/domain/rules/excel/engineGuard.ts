/**
 * Defensive wrappers around the WP-A rule engine (src/domain/rules/engine.ts).
 *
 * compileModel and runModelTests are specified as "never throws". If they do
 * throw (the pilot scaffold stub does, and a half-built engine might), the
 * Excel panel and the rule editor show "engine not available" instead of
 * crashing. evaluateModel may legitimately throw for a bad step; that is
 * reported as an evaluation error, not as a missing engine.
 */
import type { SizingModelDef } from '../../../contracts/pilot'
import { compileModel, evaluateModel, runModelTests, type CompileResult, type EvaluateMeta, type ModelTestResult } from '../engine'

export type EngineOutcome<T> = { available: true; value: T } | { available: false; message: string }

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function safeCompile(model: SizingModelDef): EngineOutcome<CompileResult> {
  try {
    return { available: true, value: compileModel(model) }
  } catch (e) {
    return { available: false, message: describe(e) }
  }
}

export function safeRunTests(model: SizingModelDef): EngineOutcome<ModelTestResult[]> {
  try {
    return { available: true, value: runModelTests(model) }
  } catch (e) {
    return { available: false, message: describe(e) }
  }
}

export interface ModelCheck {
  modelId: string
  compile: CompileResult
  /** Empty when the model does not compile (tests are not run then). */
  tests: ModelTestResult[]
}

export type PackCheck =
  | { available: false; message: string }
  | {
      available: true
      models: ModelCheck[]
      /**
       * True when every model compiles, has at least one test and every test
       * passes: the pilot's rule for saving as `published` (05 §7, AC-RB-06).
       */
      publishable: boolean
    }

/** Compile and test every model of a pack. Never throws. */
export function checkModels(models: SizingModelDef[]): PackCheck {
  const checks: ModelCheck[] = []
  for (const model of models) {
    const compiled = safeCompile(model)
    if (!compiled.available) return { available: false, message: compiled.message }
    if (!compiled.value.ok) {
      checks.push({ modelId: model.id, compile: compiled.value, tests: [] })
      continue
    }
    const tests = safeRunTests(model)
    if (!tests.available) return { available: false, message: tests.message }
    checks.push({ modelId: model.id, compile: compiled.value, tests: tests.value })
  }
  const publishable = models.length > 0 && checks.every((c) => c.compile.ok && c.tests.length > 0 && c.tests.every((t) => t.passed))
  return { available: true, models: checks, publishable }
}

/** A tiny excel-mode model used to probe whether the engine is implemented. */
export const PROBE_MODEL: SizingModelDef = {
  id: 'probe',
  nameVi: 'probe',
  nameEn: 'probe',
  componentType: 'probe',
  formulaMode: 'excel',
  inputs: [{ name: 'a', labelVi: 'a', labelEn: 'a', unit: 'count', default: 2 }],
  params: [],
  calc: [{ name: 'b', formula: 'a * 2', unit: 'count' }],
  outputs: [{ name: 'b', from: 'b', unit: 'count' }],
  warnings: [],
  lookups: [],
  tests: [{ id: 't', inputs: { a: 2 }, expected: { b: 4 }, tolerance: 0.0001 }],
}

export function isEngineReady(): boolean {
  return safeCompile(PROBE_MODEL).available
}

/**
 * Calc results of a model on its default inputs, for the cached values the
 * exporter writes next to each formula. Null when the engine is missing or
 * the evaluation fails.
 */
export function engineCachedResults(model: SizingModelDef, meta: EvaluateMeta): Record<string, number> | null {
  try {
    const run = evaluateModel(model, {}, meta)
    const out: Record<string, number> = {}
    for (const step of run.steps) if (Number.isFinite(step.value)) out[step.name] = step.value
    return out
  } catch {
    return null
  }
}

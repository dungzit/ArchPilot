/**
 * Integration with the WP-A rule engine: the generated template must import
 * into models whose tests pass in the real engine (AC-RB-01), and export
 * cached values must agree with the template. Skipped while engine.ts is the
 * scaffold stub that throws "not implemented".
 */
import { describe, expect, it } from 'vitest'
import { compileModel, evaluateModel, runModelTests } from '../engine'
import { PROBE_MODEL } from './engineGuard'
import { importRulePackXlsx } from './importer'
import { buildTemplateWorkbook, KAFKA_TEMPLATE_RESULTS } from './template'

let engineReady = false
try {
  compileModel(PROBE_MODEL)
  engineReady = true
} catch {
  engineReady = false
}

describe.skipIf(!engineReady)('Excel template x rule engine', () => {
  it('imports the template and every model test passes', async () => {
    const { data, fileName } = await buildTemplateWorkbook()
    const result = await importRulePackXlsx(data, fileName)
    expect(result.issues.filter((i) => i.severity === 'error')).toEqual([])
    for (const model of result.pack!.models) {
      expect(compileModel(model)).toEqual({ ok: true })
      const tests = runModelTests(model)
      expect(tests.length).toBeGreaterThan(0)
      for (const t of tests) expect(t, `${model.id}/${t.testId}`).toMatchObject({ passed: true })
    }
  })

  it('evaluates the imported Kafka model to the cached results written in the template', async () => {
    const { data, fileName } = await buildTemplateWorkbook()
    const model = (await importRulePackXlsx(data, fileName)).pack!.models[0]
    const run = evaluateModel(model, {}, { rulePackId: 'template', rulePackVersion: 1 })
    for (const step of run.steps) expect(step.value).toBeCloseTo(KAFKA_TEMPLATE_RESULTS[step.name], 9)
  })
})

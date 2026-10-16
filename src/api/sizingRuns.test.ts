// @vitest-environment jsdom
/**
 * src/api/sizingRuns.ts: a run is clipped to the server's string caps before
 * POST, so a param `source` near 200 characters (the engine prefixes
 * "param: ") or a long substituted trace no longer fails with a 422.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { SizingRun } from '../contracts/pilot'
import { evaluateModel } from '../domain/rules/engine'
import { installFakeFetch, jsonResponse } from '../test/fakeFetch'
import { clipText, fitRunToServerCaps, RUN_TEXT_CAPS, saveSizingRun } from './sizingRuns'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** A model whose param source is 195 characters: the run carries "param: " + 195 = 202. */
function runWithLongSource(): SizingRun {
  return evaluateModel(
    {
      id: 'm',
      nameVi: 'm',
      nameEn: 'm',
      componentType: 'test',
      inputs: [{ name: 'a', labelVi: 'a', labelEn: 'a', unit: '', default: 2 }],
      params: [{ name: 'p', value: 3, unit: '', source: 's'.repeat(195) }],
      calc: [{ name: 'x', formula: 'max(a, p)', unit: '' }],
      outputs: [{ name: 'x', from: 'x', unit: '' }],
      warnings: [],
      lookups: [],
      tests: [],
    },
    {},
    { rulePackId: 'rp', rulePackVersion: 1 },
  )
}

describe('clipText', () => {
  test('leaves short text alone and cuts long text to the cap with an ellipsis', () => {
    expect(clipText('abc', 3)).toBe('abc')
    expect(clipText('abcdef', 4)).toBe('abc…')
    expect(clipText('x'.repeat(5000), 4000)).toHaveLength(4000)
  })

  test('never splits a surrogate pair', () => {
    // Cap 4 would end on the high half of the emoji: cut before it instead.
    expect(clipText(`ab${'😀'.repeat(3)}`, 4)).toBe('ab…')
    expect(clipText(`ab${'😀'.repeat(3)}`, 5)).toBe('ab😀…')
  })
})

describe('fitRunToServerCaps / saveSizingRun', () => {
  test('a param source near the cap is clipped to 200 characters, other fields keep their values', () => {
    const run = runWithLongSource()
    const source = run.inputs.find((input) => input.name === 'p')!.source!
    expect(source).toHaveLength(202)
    const fitted = fitRunToServerCaps(run)
    const clipped = fitted.inputs.find((input) => input.name === 'p')!.source!
    expect(clipped).toHaveLength(RUN_TEXT_CAPS.short)
    expect(clipped.startsWith('param: sss')).toBe(true)
    expect(clipped.endsWith('…')).toBe(true)
    expect(fitted.outputs).toEqual(run.outputs)
    expect(fitted.inputs.find((input) => input.name === 'a')).toEqual(run.inputs.find((input) => input.name === 'a'))
  })

  test('substituted traces, binding, labels and messages are clipped to their caps', () => {
    const run: SizingRun = {
      ...runWithLongSource(),
      rulePackName: 'n'.repeat(250),
      steps: [{ name: 'x', formula: 'f'.repeat(4001), substituted: 's'.repeat(5000), value: 1, unit: '' }],
      binding: 'b × '.repeat(80),
      warnings: [{ severity: 'low', messageVi: 'v'.repeat(4500), messageEn: 'ok' }],
    }
    const fitted = fitRunToServerCaps(run)
    expect(fitted.steps[0].formula).toHaveLength(4000)
    expect(fitted.steps[0].substituted).toHaveLength(4000)
    expect(fitted.binding).toHaveLength(200)
    expect(fitted.rulePackName).toHaveLength(200)
    expect(fitted.warnings[0]).toEqual({ severity: 'low', messageVi: `${'v'.repeat(3999)}…`, messageEn: 'ok' })
    expect(fitRunToServerCaps({ ...run, binding: null, rulePackName: undefined })).toMatchObject({ binding: null, rulePackName: undefined })
  })

  test('saveSizingRun posts the clipped run', async () => {
    const { calls } = installFakeFetch(async (request) => jsonResponse(201, { ...JSON.parse(request.body!), id: 'srn_1' }))
    await saveSizingRun(runWithLongSource())
    const body = JSON.parse(calls[0].body!) as SizingRun
    expect(body.inputs.find((input) => input.name === 'p')!.source).toHaveLength(200)
  })
})

import { describe, expect, it } from 'vitest'
import type { RulePack } from '../../../contracts/pilot'
import { KAFKA_TEMPLATE_MODEL } from '../../../domain/rules/excel/template'
import { blankModel, editableFrom, errorMatchesRow, formatKv, nextModelId, packFromJson, parseKv, rowErrors, unmatchedErrors } from './editorModel'

describe('editor model helpers', () => {
  it('parses and formats key=value test fields', () => {
    expect(parseKv('ingress=150, rf = 3; retention_days=1e1')).toEqual({ ingress: 150, rf: 3, retention_days: 10 })
    expect(parseKv('')).toEqual({})
    expect(parseKv('a=1, b=x')).toBe('"b=x"')
    expect(formatKv({ a: 1, b: 2.5 })).toBe('a=1, b=2.5')
  })

  it('maps engine error locations to rows', () => {
    expect(errorMatchesRow('calc.storage', 'calc', 'storage', 1)).toBe(true)
    expect(errorMatchesRow('calc.storage.formula', 'calc', 'storage', 1)).toBe(true)
    expect(errorMatchesRow('calc.storage_tb', 'calc', 'storage', 1)).toBe(false)
    expect(errorMatchesRow('warnings[0]', 'warnings', null, 0)).toBe(true)
    expect(errorMatchesRow('warnings[1]', 'warnings', null, 0)).toBe(false)
    expect(errorMatchesRow('calc[2]', 'calc', 'x', 2)).toBe(true)
    const errors = [
      { where: 'calc.brokers', message: 'bad' },
      { where: 'model', message: 'model-level' },
    ]
    expect(rowErrors(errors, 'calc', 'brokers', 3)).toHaveLength(1)
    expect(unmatchedErrors(errors, KAFKA_TEMPLATE_MODEL)).toEqual([{ where: 'model', message: 'model-level' }])
  })

  it('loads pasted JSON as a new pack (pack, single model or model array)', () => {
    const pack: RulePack = { id: 'rp_9', name: 'Kafka', version: 4, status: 'published', builtIn: false, models: [KAFKA_TEMPLATE_MODEL] }
    const fromPack = packFromJson(JSON.stringify(pack))
    expect(fromPack.ok && fromPack.pack).toMatchObject({ name: 'Kafka', version: 1, status: 'draft', models: [KAFKA_TEMPLATE_MODEL] })
    expect(fromPack.ok && fromPack.pack.id).toBeUndefined()
    const single = packFromJson(JSON.stringify({ ...blankModel('m'), warnings: undefined, lookups: undefined }))
    expect(single.ok && single.pack.models[0]).toMatchObject({ id: 'm', warnings: [], lookups: [] })
    const arr = packFromJson(JSON.stringify([blankModel('a'), blankModel('b')]))
    expect(arr.ok && arr.pack.models.map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('rejects malformed JSON with a precise path', () => {
    expect(packFromJson('{').ok).toBe(false)
    expect(packFromJson('{"x":1}')).toMatchObject({ ok: false })
    const badInput = { ...blankModel(), inputs: [{ name: 'x', unit: 'count', default: 'one' }] }
    expect(packFromJson(JSON.stringify(badInput))).toEqual({ ok: false, error: 'models[0].inputs[0]: name, unit and numeric default expected' })
    const badTest = { ...blankModel(), tests: [{ id: 'T', inputs: { x: '1' }, expected: {} }] }
    expect(packFromJson(JSON.stringify(badTest))).toEqual({ ok: false, error: 'models[0].tests[0]: numeric values expected' })
    expect(packFromJson(JSON.stringify([blankModel('a'), blankModel('a')]))).toEqual({ ok: false, error: 'Duplicate model id.' })
  })

  it('edits a built-in pack as a copy and picks free model ids', () => {
    const builtIn: RulePack = { id: 'archpilot-core', name: 'Core', version: 2, status: 'published', builtIn: true, models: [KAFKA_TEMPLATE_MODEL] }
    const editable = editableFrom(builtIn)
    expect(editable).toMatchObject({ id: undefined, name: 'Core (copy)', version: 1 })
    expect(editable.models[0]).not.toBe(KAFKA_TEMPLATE_MODEL)
    expect(nextModelId([blankModel('model_2')])).toBe('model_3')
    expect(nextModelId([blankModel('model_1'), blankModel('model_3')])).toBe('model_4')
  })
})

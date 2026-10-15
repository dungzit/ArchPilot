/**
 * Rule engine (pilot WP-A, docs/v3/05 §3): parser precedence, unit checking,
 * excel mode, lookup, binding, warnings, tests runner, error contracts
 * (compileModel / runModelTests never throw; evaluateModel names the step).
 */
import { describe, expect, test } from 'vitest'
import type { SizingModelDef } from '../../contracts/pilot'
import { compileModel, evaluateModel, runModelTests, type CompileResult } from './engine'
import { parseFormula, printExpr } from './parser'
import { formatDim, parseUnit } from './units'

const META = { rulePackId: 'test-pack', rulePackVersion: 3 }

function makeModel(overrides: Partial<SizingModelDef>): SizingModelDef {
  return {
    id: 'm',
    nameVi: 'Mô hình',
    nameEn: 'Model',
    componentType: 'test',
    inputs: [],
    params: [],
    calc: [],
    outputs: [],
    warnings: [],
    lookups: [],
    tests: [],
    ...overrides,
  }
}

const errorsOf = (result: CompileResult) => (result.ok ? [] : result.errors)
const messages = (model: SizingModelDef) => errorsOf(compileModel(model)).map((error) => error.message)

/** One calc step `x` from a formula over inputs a (unit ua) and b (unit ub). */
function oneStep(formula: string, unit: string, a = { unit: '', value: 2 }, b = { unit: '', value: 3 }, mode?: 'units' | 'excel') {
  return makeModel({
    formulaMode: mode,
    inputs: [
      { name: 'a', labelVi: 'a', labelEn: 'a', unit: a.unit, default: a.value },
      { name: 'b', labelVi: 'b', labelEn: 'b', unit: b.unit, default: b.value },
    ],
    calc: [{ name: 'x', formula, unit }],
    outputs: [{ name: 'x', from: 'x', unit }],
  })
}

const valueOf = (model: SizingModelDef, inputs: Record<string, number> = {}) => evaluateModel(model, inputs, META).outputs[0].value

/** The 05 §9 Kafka template model, verbatim (4 calc steps). */
const KAFKA_TEMPLATE = makeModel({
  id: 'kafka-template',
  inputs: [
    { name: 'ingress', labelVi: 'Ingress', labelEn: 'Ingress', unit: 'MB/s', default: 150 },
    { name: 'rf', labelVi: 'RF', labelEn: 'RF', unit: 'count', default: 3 },
    { name: 'retention', labelVi: 'Retention', labelEn: 'Retention', unit: 'day', default: 3 },
    { name: 'is_prod', labelVi: 'Prod', labelEn: 'Prod', unit: 'count', default: 1 },
  ],
  params: [
    { name: 'broker_write', value: 100, unit: 'MB/s' },
    { name: 'target_util', value: 0.6, unit: 'ratio' },
    { name: 'disk_per_broker', value: 12, unit: 'TB' },
    { name: 'disk_fill', value: 0.7, unit: 'ratio' },
  ],
  calc: [
    { name: 'tp_brokers', formula: 'ceil(ingress * rf / broker_write / target_util)', unit: 'broker' },
    { name: 'storage', formula: 'convert(ingress * retention * rf, "TB")', unit: 'TB' },
    { name: 'storage_brokers', formula: 'ceil(storage / (disk_per_broker * disk_fill))', unit: 'broker' },
    { name: 'brokers', formula: 'max(tp_brokers, storage_brokers, rf)', unit: 'broker' },
  ],
  outputs: [
    { name: 'brokers', from: 'brokers', unit: 'broker', rounding: 'ceil' },
    { name: 'storage', from: 'storage', unit: 'TB' },
  ],
  warnings: [{ condition: 'rf < 3 and is_prod == 1', severity: 'high', messageVi: 'RF < 3 ở Prod ({rf})', messageEn: 'RF < 3 in Prod ({rf})' }],
  tests: [{ id: 'T1', inputs: { ingress: 150, rf: 3, retention: 3 }, expected: { brokers: 14, storage: 116.64 }, tolerance: 0.01 }],
})

describe('units', () => {
  test.each([
    ['MB/s', 1e6, 'byte/second'],
    ['GB/day', 1e9 / 86_400, 'byte/second'],
    ['Mbps', 1e6 / 8, 'byte/second'],
    ['GiB', 1024 ** 3, 'byte'],
    ['month', 30 * 86_400, 'second'],
    ['year', 365 * 86_400, 'second'],
    ['IOPS', 1, '1/second'],
    ['req/s', 1, '1/second'],
    ['B/key', 1, 'byte'],
    ['%', 0.01, 'dimensionless'],
    ['vCPU/instance', 1, 'dimensionless'],
    ['', 1, 'dimensionless'],
  ])('%s', (unit, factor, dim) => {
    const parsed = parseUnit(unit)!
    expect(parsed.factor).toBeCloseTo(factor, 12)
    expect(formatDim(parsed.dim)).toBe(dim)
  })

  test('MB and Mb are different units; unknown units are null', () => {
    expect(parseUnit('MB')!.factor).toBe(1e6)
    expect(parseUnit('Mb')!.factor).toBe(1e6 / 8)
    expect(parseUnit('MBps')).toBeNull()
    expect(parseUnit('MB/')).toBeNull()
  })
})

describe('parser', () => {
  test.each([
    ['-2^2', -4],
    ['2^3^2', 512],
    ['2^-1', 0.5],
    ['1 + 2 * 3', 7],
    ['(1 + 2) * 3', 9],
    ['10 - 4 - 3', 3],
    ['12 / 3 / 2', 2],
    ['not 1 < 2', 0],
    ['1 < 2 and 3 < 2 or 1', 1],
    ['1e3 + .5', 1000.5],
  ])('%s = %d (precedence and associativity per spec)', (formula, expected) => {
    expect(valueOf(oneStep(formula, ''))).toBeCloseTo(expected, 12)
  })

  test('keeps the author\'s parentheses when printing', () => {
    expect(printExpr(parseFormula('ceil((a + b) * 2)'))).toBe('ceil((a + b) × 2)')
  })

  test('syntax errors carry the step and the column', () => {
    expect(messages(oneStep('a + * b', ''))).toEqual(["syntax error at calc.x: unexpected '*' (column 5)"])
    expect(messages(oneStep('ceil(a', ''))).toEqual(["syntax error at calc.x: expected ')' but found end of formula (column 7)"])
    expect(messages(oneStep('a = b', ''))[0]).toContain('use == to compare')
    expect(messages(oneStep('150 MB', ''))[0]).toContain('unit literals')
  })
})

describe('compile: unit checking (units mode)', () => {
  test('AC-RB-02: adding MB/s to TB is a compile error naming the step', () => {
    const result = compileModel(oneStep('a + b', 'TB', { unit: 'MB/s', value: 1 }, { unit: 'TB', value: 1 }))
    expect(result).toEqual({ ok: false, errors: [{ where: 'calc.x', message: 'unit error at calc.x: cannot add byte/second and byte (column 3)' }] })
  })

  test('a calc whose inferred unit differs from the declared one: "unit mismatch at calc.storage: got byte/second, declared TB"', () => {
    const model = makeModel({
      inputs: [{ name: 'ingress', labelVi: 'i', labelEn: 'i', unit: 'MB/s', default: 1 }, { name: 'rf', labelVi: 'r', labelEn: 'r', unit: 'count', default: 3 }],
      calc: [{ name: 'storage', formula: 'ingress * rf', unit: 'TB' }],
      outputs: [{ name: 'storage', from: 'storage', unit: 'TB' }],
    })
    expect(errorsOf(compileModel(model))).toEqual([{ where: 'calc.storage', message: 'unit mismatch at calc.storage: got byte/second, declared TB' }])
  })

  test('ceil() of a quantity with a unit tells the author to divide by a unit quantity', () => {
    const [message] = messages(oneStep('ceil(a)', 'count', { unit: 'TB', value: 1 }))
    expect(message).toMatch(/^unit error at calc\.x: ceil\(\) needs a dimensionless number but got byte; divide by a quantity in the same unit first/)
  })

  test('comparisons, min/max and if() branches need equal units; zero matches anything', () => {
    expect(messages(oneStep('if(a > b, 1, 0)', 'count', { unit: 'GB', value: 1 }, { unit: 's', value: 1 }))[0]).toContain('cannot compare byte with second')
    expect(messages(oneStep('max(a, b)', 'GB', { unit: 'GB', value: 1 }, { unit: 'GB/s', value: 1 }))[0]).toContain('max() arguments need the same unit')
    expect(messages(oneStep('if(a > 0, a, 0)', 'GB', { unit: 'GB', value: 1 }))).toEqual([])
  })

  test('convert() checks the target dimension; ^ with a unit needs a constant exponent', () => {
    expect(messages(oneStep('convert(a, "MB/s")', 'GB', { unit: 'GB', value: 1 }))[0]).toContain('cannot convert byte to "MB/s"')
    expect(messages(oneStep('convert(a, "XB")', 'GB', { unit: 'GB', value: 1 }))[0]).toContain('unknown unit at calc.x: "XB" in convert()')
    expect(messages(oneStep('a ^ b', 'GB', { unit: 'GB', value: 1 }))[0]).toContain('can only be raised to a constant number')
    expect(messages(oneStep('a ^ 2 / a', 'GB', { unit: 'GB', value: 1 }))).toEqual([])
  })

  test('units convert to base and back: GB + MB expressed in TB', () => {
    expect(valueOf(oneStep('a + b', 'TB', { unit: 'GB', value: 500 }, { unit: 'MB', value: 500_000 }))).toBeCloseTo(1, 12)
    expect(valueOf(oneStep('a * b', '%', { unit: '%', value: 50 }, { unit: 'ratio', value: 0.5 }))).toBeCloseTo(25, 12)
  })

  test('names: unknown, forward, self, duplicates, unknown function, arity', () => {
    expect(messages(oneStep('a + zz', ''))).toEqual(['unknown name at calc.x: "zz" is not an input, param or calc step (column 5)'])
    expect(messages(oneStep('x + 1', ''))).toEqual(['circular reference at calc.x: "x" refers to itself (column 1)'])
    const forward = makeModel({ calc: [{ name: 'p', formula: 'q + 1', unit: '' }, { name: 'q', formula: '1', unit: '' }], outputs: [] })
    expect(messages(forward)[0]).toBe('forward reference at calc.p: "q" is defined in a later step; a calc step can only use earlier ones (column 1)')
    const duplicate = makeModel({ inputs: [{ name: 'a', labelVi: '', labelEn: '', unit: '', default: 1 }], calc: [{ name: 'a', formula: '1', unit: '' }] })
    expect(messages(duplicate)).toEqual(['duplicate name at calc.a: "a" is already used by inputs.a'])
    expect(messages(oneStep('sqrt(a)', ''))[0]).toContain('unknown function at calc.x: "sqrt()"')
    expect(messages(oneStep('ceil(a, b)', ''))[0]).toBe('wrong argument count at calc.x: ceil() takes 1 argument, got 2 (column 1)')
    expect(messages(oneStep('a', 'MBps'))[0]).toContain('unknown unit at calc.x: "MBps"')
  })

  test('warnings, outputs and tests are checked too', () => {
    const model = oneStep('a + b', '')
    model.warnings = [{ condition: 'nope > 1', severity: 'high', messageVi: '', messageEn: '' }]
    model.outputs = [{ name: 'y', from: 'missing', unit: '' }]
    model.tests = [{ id: 'T1', inputs: { c: 1 }, expected: { y: 1 }, tolerance: 0 }]
    expect(messages(model)).toEqual([
      'unknown name at outputs.y: "missing" is not a calc step, input or param',
      'unknown name at warnings[0]: "nope" is not an input, param or calc step (column 1)',
      'invalid test at tests.T1: "c" is not an input of this model',
    ])
  })

  test('compileModel never throws, even on garbage', () => {
    expect(compileModel(null as unknown as SizingModelDef).ok).toBe(false)
    expect(compileModel({ id: 'x' } as unknown as SizingModelDef).ok).toBe(false)
    expect(compileModel(makeModel({ calc: [{ name: 'x', formula: undefined as unknown as string, unit: '' }] })).ok).toBe(false)
  })
})

describe('excel mode', () => {
  const excel = (formula: string) => oneStep(formula, 'GB', { unit: 'MB/s', value: 150 }, { unit: 'TB', value: 2 }, 'excel')

  test('identifiers are raw numbers: no conversion and no dimension checks', () => {
    expect(compileModel(excel('a + b'))).toEqual({ ok: true })
    expect(valueOf(excel('a + b'))).toBe(152)
    expect(valueOf(excel('ceil(a / 7)'))).toBe(22)
    expect(valueOf(excel('convert(a, "TB")'))).toBe(150)
  })

  test('the same formula in units mode is rejected', () => {
    expect(compileModel(oneStep('a + b', 'GB', { unit: 'MB/s', value: 150 }, { unit: 'TB', value: 2 })).ok).toBe(false)
  })

  test('free-text units are accepted in excel mode and printed in the trace', () => {
    const model = oneStep('a * 2', 'GB (usable)', { unit: 'GB (usable)', value: 10 }, { unit: '', value: 0 }, 'excel')
    const run = evaluateModel(model, {}, META)
    expect(run.steps[0]).toMatchObject({ value: 20, unit: 'GB (usable)', substituted: '10 GB (usable) × 2' })
  })
})

describe('lookup', () => {
  const tableModel = (formula: string, mode?: 'units' | 'excel') =>
    makeModel({
      formulaMode: mode,
      inputs: [{ name: 'level', labelVi: '', labelEn: '', unit: 'count', default: 6 }],
      lookups: [{ name: 'raid', columns: ['level', 'factor', 'name'], rows: [[10, 2, 'RAID10'], [6, 1.25, 'RAID6'], ['RAID5', 1.25, 'five']] }],
      calc: [{ name: 'x', formula, unit: 'ratio' }],
      outputs: [{ name: 'x', from: 'x', unit: 'ratio' }],
    })

  test('numeric and string keys match the first column', () => {
    expect(valueOf(tableModel('lookup(raid, level, "factor")'))).toBe(1.25)
    expect(valueOf(tableModel('lookup(raid, level, "factor")'), { level: 10 })).toBe(2)
    expect(valueOf(tableModel('lookup(raid, "raid5", "factor")'))).toBe(1.25)
    expect(valueOf(tableModel('lookup(raid, level, "Factor") * 2'))).toBe(2.5)
  })

  test('unknown table, column and literal key are compile errors; a computed missing key fails at run time', () => {
    expect(messages(tableModel('lookup(nope, level, "factor")'))[0]).toContain('unknown lookup table at calc.x: "nope"')
    expect(messages(tableModel('lookup(raid, level, "speed")'))[0]).toContain('"speed" is not a column of lookup table "raid"')
    expect(messages(tableModel('lookup(raid, 7, "factor")'))[0]).toContain('table "raid" has no row with key 7')
    expect(messages(tableModel('raid * 2'))[0]).toContain('can only be used as lookup(raid, key, "column")')
    expect(() => evaluateModel(tableModel('lookup(raid, level, "factor")'), { level: 7 }, META)).toThrow('evaluation error at calc.x: lookup table "raid" has no row with key 7 (keys: 10, 6, RAID5)')
    expect(() => evaluateModel(tableModel('lookup(raid, level, "name")'), {}, META)).toThrow(/column "name" for key 6 is "RAID6", not a number/)
  })
})

describe('evaluation', () => {
  test('if() is lazy, so a guarded division never fails', () => {
    expect(valueOf(oneStep('if(b == 0, 0, a / b)', ''), { b: 0 })).toBe(0)
  })

  test('division by zero names the step', () => {
    expect(() => evaluateModel(oneStep('a / b', ''), { b: 0 }, META)).toThrow('evaluation error at calc.x: division by zero (column 3)')
  })

  test('a non-finite input is rejected with its name', () => {
    expect(() => evaluateModel(oneStep('a', ''), { a: Number.NaN }, META)).toThrow('invalid input at inputs.a')
  })

  test('evaluateModel on a model that does not compile throws the first compile error', () => {
    expect(() => evaluateModel(oneStep('a +', ''), {}, META)).toThrow(/^syntax error at calc\.x/)
  })

  test.each([
    ['round(a, 2)', 1.005, 1.01],
    ['round(a)', -2.5, -3],
    ['roundup_to(a, 0.5)', 1.2, 1.5],
    ['floor(a)', 2.9999999999999996, 3],
    ['min(a, 1, 5)', 3, 1],
    ['sum(a, 1, 5)', 3, 9],
    ['avg(a, 1, 5)', 3, 3],
    ['abs(a - 10)', 3, 7],
  ])('%s with a = %d gives %d', (formula, a, expected) => {
    expect(valueOf(oneStep(formula, ''), { a })).toBeCloseTo(expected, 12)
  })

  test('output rounding applies in the output unit, which may differ from the calc unit', () => {
    const model = oneStep('a * 1000', 'GB', { unit: 'GB', value: 1.5 })
    model.outputs = [{ name: 'tb', from: 'x', unit: 'TB', rounding: 'ceil' }, { name: 'gb', from: 'x', unit: 'GB', rounding: 'none' }]
    const run = evaluateModel(model, {}, META)
    expect(run.outputs.map((o) => [o.name, o.value, o.unit])).toEqual([['tb', 2, 'TB'], ['gb', 1500, 'GB']])
  })
})

describe('the 05 §9 Kafka template (AC-RB-01)', () => {
  test('4 steps with substituted values, binding storage, T1 passes', () => {
    const run = evaluateModel(KAFKA_TEMPLATE, {}, META)
    expect(run.steps.map((s) => [s.name, Number(s.value.toFixed(4)), s.unit])).toEqual([
      ['tp_brokers', 8, 'broker'],
      ['storage', 116.64, 'TB'],
      ['storage_brokers', 14, 'broker'],
      ['brokers', 14, 'broker'],
    ])
    expect(run.binding).toBe('storage_brokers')
    expect(run.steps[0].substituted).toBe('ceil(150 MB/s × 3 / 100 MB/s / 0.6) = ceil(7.5)')
    expect(runModelTests(KAFKA_TEMPLATE)).toEqual([{ testId: 'T1', passed: true, failures: [] }])
  })

  test('warnings: rf < 3 in Prod fires with the value interpolated', () => {
    expect(evaluateModel(KAFKA_TEMPLATE, { rf: 2 }, META).warnings).toEqual([{ severity: 'high', messageVi: 'RF < 3 ở Prod (2)', messageEn: 'RF < 3 in Prod (2)' }])
    expect(evaluateModel(KAFKA_TEMPLATE, { rf: 2, is_prod: 0 }, META).warnings).toEqual([])
  })
})

describe('float noise: near-integer snap before ceil/floor/compare', () => {
  const rate = (value: number) => ({ unit: 'req/s', value })

  test('subtraction noise: ceil(200 req/s × 1.1 / 110 req/s - 2) is 0, not 1, and the trace says ceil(0)', () => {
    const model = oneStep('ceil(a * 1.1 / b - 2)', 'count', rate(200), rate(110))
    const run = evaluateModel(model, {}, META)
    expect(run.outputs[0].value).toBe(0)
    expect(run.steps[0].substituted).toBe('ceil(200 req/s × 1.1 / 110 req/s - 2) = ceil(0)')
    expect(valueOf(oneStep('floor(a * 1.1 / b - 2)', 'count', rate(200), rate(110)))).toBe(0)
  })

  test('comparisons ignore the same noise; real differences still count', () => {
    expect(valueOf(oneStep('if(a * 1.1 / b - 2 > 0, 1, 0)', 'count', rate(200), rate(110)))).toBe(0)
    expect(valueOf(oneStep('if(a + b == 0.3, 1, 0)', ''), { a: 0.1, b: 0.2 })).toBe(1)
    expect(valueOf(oneStep('if(a + b != 0.3, 1, 0)', ''), { a: 0.1, b: 0.2 })).toBe(0)
    expect(valueOf(oneStep('if(a < b, 1, 0)', ''), { a: 0.3, b: 0.30001 })).toBe(1)
    expect(valueOf(oneStep('if(a >= b, 1, 0)', ''), { a: 0.1 + 0.2, b: 0.3 })).toBe(1)
  })

  test('exact integers of 13+ digits are not altered by ceil, floor or output rounding', () => {
    const big = 1234567890123
    expect(valueOf(oneStep('ceil(a)', ''), { a: big })).toBe(big)
    expect(valueOf(oneStep('floor(a)', ''), { a: big })).toBe(big)
    const model = oneStep('a', '')
    model.outputs = [{ name: 'x', from: 'x', unit: '', rounding: 'ceil' }]
    expect(valueOf(model, { a: big })).toBe(big)
    expect(valueOf(oneStep('ceil(a)', ''), { a: big + 0.5 })).toBe(big + 1)
  })

  test('QA K2: 226.8 TB / (12 TB × 0.7) is 27 brokers, not 28', () => {
    const run = evaluateModel(KAFKA_TEMPLATE, { ingress: 175, rf: 3, retention: 5 }, META)
    expect(run.steps.find((step) => step.name === 'storage_brokers')?.value).toBe(27)
    expect(run.outputs[0].value).toBe(27)
  })
})

describe('binding detection', () => {
  const bindingOf = (formula: string, inputs: Record<string, number> = {}) => {
    const model = oneStep(formula, '')
    return evaluateModel(model, inputs, META).binding
  }

  test('max/min of identifiers reports the deciding argument; ties go to the first', () => {
    expect(bindingOf('max(a, b)')).toBe('b')
    expect(bindingOf('min(a, b)')).toBe('a')
    expect(bindingOf('max(a, b)', { a: 3 })).toBe('a')
  })

  test('max nested in an expression, and max in an earlier step, are found', () => {
    expect(bindingOf('max(a, b) + 1')).toBe('b')
    const model = makeModel({
      inputs: [{ name: 'a', labelVi: '', labelEn: '', unit: '', default: 5 }, { name: 'b', labelVi: '', labelEn: '', unit: '', default: 3 }],
      calc: [{ name: 'base', formula: 'max(a, b * 2)', unit: '' }, { name: 'total', formula: 'base + 1', unit: '' }],
      outputs: [{ name: 'total', from: 'total', unit: '' }],
    })
    expect(evaluateModel(model, {}, META).binding).toBe('b × 2')
  })

  test('no max/min means no binding', () => {
    expect(bindingOf('a + b')).toBeNull()
  })
})

describe('runModelTests', () => {
  test('reports actual values for a failing expectation and honours tolerance', () => {
    const model = oneStep('a * b', '')
    model.tests = [
      { id: 'ok', inputs: { a: 2, b: 3 }, expected: { x: 6.0001 }, tolerance: 0.001 },
      { id: 'bad', inputs: { a: 2, b: 3 }, expected: { x: 7 }, tolerance: 0.01 },
      { id: 'zero', inputs: { a: 0 }, expected: { x: 0 }, tolerance: 0 },
    ]
    expect(runModelTests(model)).toEqual([
      { testId: 'ok', passed: true, failures: [] },
      { testId: 'bad', passed: false, failures: [{ output: 'x', expected: 7, actual: 6 }] },
      { testId: 'zero', passed: true, failures: [] },
    ])
  })

  test('an evaluation error fails the test with the message', () => {
    const model = oneStep('a / b', '')
    model.tests = [{ id: 'div0', inputs: { b: 0 }, expected: { x: 1 }, tolerance: 0 }]
    expect(runModelTests(model)).toEqual([{ testId: 'div0', passed: false, failures: [{ output: 'x', expected: 1, actual: null }], error: 'evaluation error at calc.x: division by zero (column 3)' }])
  })

  test('a model that does not compile fails every test and never throws', () => {
    const model = oneStep('a +', '')
    model.tests = [{ id: 'T1', inputs: {}, expected: { x: 1 }, tolerance: 0 }]
    const [result] = runModelTests(model)
    expect(result.passed).toBe(false)
    expect(result.error).toMatch(/^the model does not compile: syntax error at calc\.x/)
    expect(runModelTests(null as unknown as SizingModelDef)).toEqual([])
  })

  test('expectations may name a calc step as well as an output', () => {
    const model = oneStep('a * b', '')
    model.calc.unshift({ name: 'half', formula: 'a / 2', unit: '' })
    model.tests = [{ id: 'T1', inputs: {}, expected: { half: 1, x: 6 }, tolerance: 0 }]
    expect(runModelTests(model)).toEqual([{ testId: 'T1', passed: true, failures: [] }])
  })
})

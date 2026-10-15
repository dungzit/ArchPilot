import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import type { SizingModelDef } from '../../../contracts/pilot'
import { dslToExcel } from './dslToExcel'
import { exportRulePackToXlsx, safeFileName, type PackForExcel } from './exporter'
import { importRulePackXlsx } from './importer'
import { KAFKA_TEMPLATE_MODEL } from './template'

async function load(data: Uint8Array): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(data.slice().buffer as unknown as Parameters<typeof wb.xlsx.load>[0])
  return wb
}

async function roundTrip(pack: PackForExcel) {
  const exported = await exportRulePackToXlsx(pack)
  const imported = await importRulePackXlsx(exported.data, exported.fileName)
  return { exported, imported }
}

const SAN_MODEL: SizingModelDef = {
  id: 'san',
  nameVi: 'SAN',
  nameEn: 'SAN',
  componentType: 'san',
  formulaMode: 'excel',
  inputs: [
    { name: 'usable_tb', labelVi: 'Dung lượng dùng', labelEn: 'Usable', unit: 'TB', default: 100 },
    { name: 'raid_level', labelVi: 'RAID', labelEn: 'RAID', unit: 'count', default: 5 },
    { name: 'rf', labelVi: 'Bản sao', labelEn: 'Copies', unit: 'count', default: 1 },
  ],
  params: [],
  calc: [
    { name: 'raw_tb', formula: 'usable_tb * lookup(raid, raid_level, "factor") * rf', excelFormula: '=usable_tb*VLOOKUP(raid_level,raid,2,FALSE)*rf', unit: 'TB' },
    // Typed in the rule editor: no Excel text yet, back-translated on export.
    { name: 'shelves', formula: 'ceil(raw_tb / 24)', unit: 'count' },
  ],
  outputs: [{ name: 'shelves', from: 'shelves', unit: 'count', rounding: 'ceil' }],
  warnings: [{ condition: 'not (raw_tb > 1000) or rf >= 2', severity: 'info', messageVi: 'x', messageEn: 'x' }],
  lookups: [{ name: 'raid', columns: ['level', 'factor'], rows: [[1, 2], [5, 1.25], [10, 2]] }],
  tests: [{ id: 'T1', inputs: { usable_tb: 100 }, expected: { shelves: 6 }, tolerance: 0.000001 }],
}

const UNITS_MODEL: SizingModelDef = {
  id: 'redis-cache',
  nameVi: 'Redis',
  nameEn: 'Redis',
  componentType: 'redis',
  formulaMode: 'units',
  inputs: [{ name: 'keys', labelVi: 'Số key', labelEn: 'Keys', unit: 'count', default: 1000000 }],
  params: [{ name: 'key_size', value: 1, unit: 'KB' }],
  calc: [{ name: 'memory', formula: 'convert(keys * key_size, "GB")', unit: 'GB' }],
  outputs: [{ name: 'memory', from: 'memory', unit: 'GB' }],
  warnings: [{ condition: 'memory > 64 GB', severity: 'medium', messageVi: 'Lớn', messageEn: 'Large' }],
  lookups: [],
  tests: [{ id: 'T1', inputs: { keys: 1000000 }, expected: { memory: 1 }, tolerance: 0.000001 }],
}

describe('exportRulePackToXlsx', () => {
  it('round-trips excel and units models, lookups and shared names without loss', async () => {
    const pack: PackForExcel = { name: 'Mixed pack', description: 'd', version: 3, models: [KAFKA_TEMPLATE_MODEL, SAN_MODEL, UNITS_MODEL] }
    const { exported, imported } = await roundTrip(pack)
    expect(imported.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(imported.pack!.name).toBe('Mixed pack')
    expect(imported.pack!.version).toBe(3)
    const [kafka, san, redis] = imported.pack!.models
    expect(kafka).toEqual(KAFKA_TEMPLATE_MODEL)
    expect(redis).toEqual(UNITS_MODEL)
    expect(san.calc[0]).toEqual(SAN_MODEL.calc[0])
    expect(san.calc[1]).toMatchObject({ name: 'shelves', formula: 'ceil(raw_tb / 24)', excelFormula: '=CEILING(raw_tb/24,1)' })
    expect(san.lookups).toEqual(SAN_MODEL.lookups)
    expect(san.warnings[0].condition).toBe('(not (raw_tb > 1000) or rf >= 2)')

    const wb = await load(exported.data)
    const names = Object.fromEntries((wb.definedNames.model as { name: string; ranges: string[] }[]).map((d) => [d.name, d.ranges[0]]))
    // "rf" exists in two models, so both copies are prefixed with the model id.
    expect(names.kafka_rf).toBe('Inputs!$F$3')
    expect(names.san_rf).toBeDefined()
    expect(names.rf).toBeUndefined()
    expect(names.raid).toBe('Lookups!$A$3:$B$5')
    expect(names['raid.factor']).toBe('Lookups!$B$3:$B$5')
    const calc = wb.getWorksheet('Calc')!
    expect(calc.getCell('A1').value).toMatch(/units/) // note row for units-mode models
    expect(calc.getCell('C4').formula).toBe('CEILING(ingress*kafka_rf/broker_write/target_util,1)')
    const redisRow = calc.getRow(10)
    expect(redisRow.getCell(2).value).toBe('memory')
    expect(redisRow.getCell(3).value).toBeNull()
    expect(redisRow.getCell(6).value).toBe('convert(keys * key_size, "GB")')
  })

  it('writes cached results only when supplied', async () => {
    const withCache = await exportRulePackToXlsx({ name: 'k', version: 1, models: [KAFKA_TEMPLATE_MODEL] }, { cachedResults: () => ({ brokers: 14 }) })
    const calc = (await load(withCache.data)).getWorksheet('Calc')!
    expect(calc.getCell('C5').result).toBe(14)
    expect(calc.getCell('C2').result).toBeUndefined()
    const failing = await exportRulePackToXlsx({ name: 'k', version: 1, models: [KAFKA_TEMPLATE_MODEL] }, {
      cachedResults: () => {
        throw new Error('engine not implemented')
      },
    })
    expect((await load(failing.data)).getWorksheet('Calc')!.getCell('C5').formula).toBe('MAX(tp_brokers,storage_brokers,rf)')
  })

  it('guards text cells against formula injection and re-imports the original text', async () => {
    const payloads = ['=HYPERLINK("https://example.invalid/x","Click")', '+1+1', '-2+3', '@SUM(1+1)', "=cmd|' /C calc'!A0", '\t=1+1']
    const model: SizingModelDef = {
      ...KAFKA_TEMPLATE_MODEL,
      nameVi: payloads[0],
      nameEn: payloads[1],
      description: payloads[2],
      inputs: KAFKA_TEMPLATE_MODEL.inputs.map((i, n) => ({ ...i, labelVi: payloads[n % payloads.length], source: payloads[3] })),
      warnings: [{ ...KAFKA_TEMPLATE_MODEL.warnings[0], messageVi: payloads[4], messageEn: payloads[5] }],
      tests: [{ ...KAFKA_TEMPLATE_MODEL.tests[0], id: payloads[1] }],
    }
    const pack: PackForExcel = { name: payloads[4], version: 1, models: [model] }
    const { exported, imported } = await roundTrip(pack)
    const wb = await load(exported.data)
    for (const ws of wb.worksheets) {
      ws.eachRow((row) => {
        row.eachCell((cell) => {
          if (ws.name !== 'Calc' || !/^C\d+$/.test(cell.address)) expect(cell.formula, `${ws.name}!${cell.address}`).toBeFalsy()
          if (typeof cell.value === 'string') expect(cell.value, `${ws.name}!${cell.address}`).not.toMatch(/^[=+\-@\t]/)
        })
      })
    }
    expect(wb.getWorksheet('Model')!.getCell('B6').value).toBe(`'${payloads[0]}`)
    expect(imported.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(imported.pack!.name).toBe(payloads[4])
    const back = imported.pack!.models[0]
    expect([back.nameVi, back.nameEn, back.description]).toEqual([payloads[0], payloads[1], payloads[2]])
    expect(back.warnings[0].messageVi).toBe(payloads[4])
    expect(back.tests[0].id).toBe(payloads[1])
  })

  it('makes a safe file name', () => {
    expect(safeFileName('Gói rule: Kafka/Prod')).toBe('Goi-rule-Kafka-Prod.xlsx')
    expect(safeFileName('<img src=x>')).toBe('img-src-x.xlsx')
    expect(safeFileName('')).toBe('rule-pack.xlsx')
  })
})

describe('dslToExcel', () => {
  const env = { nameFor: (n: string) => n, lookupNames: (t: string, c: string) => ({ keyColumn: `${t}.level`, valueColumn: `${t}.${c}` }) }
  it('back-translates the DSL subset with Excel precedence', () => {
    expect(dslToExcel('ceil(ingress * rf / broker_write / target_util)', env)).toBe('=CEILING(ingress*rf/broker_write/target_util,1)')
    expect(dslToExcel('-x^2', env)).toBe('=-(x^2)')
    expect(dslToExcel('(-x)^2', env)).toBe('=-x^2')
    expect(dslToExcel('a^b^c', env)).toBe('=a^(b^c)')
    expect(dslToExcel('a - (b - c)', env)).toBe('=a-(b-c)')
    expect(dslToExcel('if(a > 1 and not (b == 2), round(a, 2), roundup_to(b, 4))', env)).toBe('=IF(AND(a>1,NOT(b=2)),ROUND(a,2),CEILING(b,4))')
    expect(dslToExcel('lookup(raid, k, "factor")', env)).toBe('=INDEX(raid.factor,MATCH(k,raid.level,0))')
    expect(dslToExcel('avg(a, b) != 0', env)).toBe('=AVERAGE(a,b)<>0')
  })
  it('returns null when Excel has no equivalent', () => {
    expect(dslToExcel('convert(x, "GB")', env)).toBeNull()
    expect(dslToExcel('3 day + x', env)).toBeNull()
    expect(dslToExcel('x +', env)).toBeNull()
    expect(dslToExcel('y', { ...env, nameFor: () => null })).toBeNull()
  })
})

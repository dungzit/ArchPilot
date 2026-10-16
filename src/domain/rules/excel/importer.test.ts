import ExcelJS from 'exceljs'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { CACHED_TEST_TOLERANCE, importRulePackXlsx, type ImportResult } from './importer'
import { buildTemplateWorkbook } from './template'
import { inspectXlsxPackage } from './zipGuard'

type Wb = ExcelJS.Workbook

async function templateWorkbook(): Promise<Wb> {
  const { data } = await buildTemplateWorkbook()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(data.slice().buffer as unknown as Parameters<typeof wb.xlsx.load>[0])
  return wb
}

async function importEdited(edit: (wb: Wb) => void, fileName = 'edited.xlsx'): Promise<ImportResult> {
  const wb = await templateWorkbook()
  edit(wb)
  const buffer = await wb.xlsx.writeBuffer()
  return importRulePackXlsx(new Uint8Array(buffer as ArrayBuffer), fileName)
}

const errors = (r: ImportResult) => r.issues.filter((i) => i.severity === 'error')
const warnings = (r: ImportResult) => r.issues.filter((i) => i.severity === 'warning')

describe('importRulePackXlsx: file safety', () => {
  it('rejects macro-enabled and legacy extensions before reading', async () => {
    const { data } = await buildTemplateWorkbook()
    for (const name of ['rules.xlsm', 'rules.xls', 'rules.csv']) {
      const r = await importRulePackXlsx(data, name)
      expect(r.pack).toBeNull()
      expect(errors(r)[0].where).toBe(name)
    }
  })

  it('rejects files over 5 MiB (5,242,880 bytes) and lets exactly 5 MiB through the size check', async () => {
    const r = await importRulePackXlsx(new Uint8Array(5 * 1024 * 1024 + 1), 'big.xlsx')
    expect(r.pack).toBeNull()
    expect(errors(r)[0].message.en).toMatch(/5 MB/)
    const boundary = await importRulePackXlsx(new Uint8Array(5 * 1024 * 1024), 'boundary.xlsx')
    expect(errors(boundary)[0].message.en).toMatch(/Not a valid .xlsx/) // passed the size check, failed later
  })

  it('rejects non-zip data and macro packages renamed to .xlsx', async () => {
    expect(inspectXlsxPackage(strToU8('not a zip')).ok).toBe(false)
    const macro = zipSync({
      '[Content_Types].xml': strToU8('<Types><Override ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/></Types>'),
      'xl/workbook.xml': strToU8('<workbook/>'),
      'xl/vbaProject.bin': new Uint8Array([1, 2, 3]),
    })
    const check = inspectXlsxPackage(macro)
    expect(check.ok).toBe(false)
    expect(!check.ok && check.message.en).toMatch(/Macro/)
    const r = await importRulePackXlsx(macro, 'renamed.xlsx')
    expect(r.pack).toBeNull()
  })

  it('rejects defined names that cover huge ranges (exceljs would expand them)', () => {
    const pkg = zipSync({
      '[Content_Types].xml': strToU8('<Types><Override ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'),
      'xl/workbook.xml': strToU8('<workbook><definedNames><definedName name="x">Inputs!$A$1:$Z$100000</definedName></definedNames></workbook>'),
    })
    const check = inspectXlsxPackage(pkg)
    expect(!check.ok && check.message.en).toMatch(/too many cells/)
  })

  it('rejects sheets with more than 2,000 rows', async () => {
    const r = await importEdited((wb) => {
      const ws = wb.getWorksheet('Lookups')!
      for (let i = 1; i <= 2001; i++) ws.getCell(i, 5).value = i
    })
    expect(r.pack).toBeNull()
    expect(errors(r)[0].message.en).toMatch(/more than 2000 rows/)
  })

  it('rejects more than 50 models', async () => {
    const r = await importEdited((wb) => {
      const ws = wb.getWorksheet('Model')!
      for (let i = 0; i < 50; i++) ws.getRow(7 + i).values = [`m${i}`, 'x', 'x', 'x', 'excel']
    })
    expect(r.pack).toBeNull()
    expect(errors(r).some((e) => /At most 50 models/.test(e.message.en))).toBe(true)
  })
})

describe('importRulePackXlsx: translation errors (AC-RB-03)', () => {
  it('reports an unsupported function with its cell address and creates no pack', async () => {
    const r = await importEdited((wb) => {
      wb.getWorksheet('Calc')!.getCell('C3').value = { formula: 'INDIRECT("Inputs!F2")*86400', result: 0 }
    })
    expect(r.pack).toBeNull()
    expect(errors(r)).toHaveLength(1)
    expect(errors(r)[0].where).toBe('Calc!C3')
    expect(errors(r)[0].message.en).toBe('Unsupported function INDIRECT.')
    expect(r.preview!.models[0].calcRows[1]).toMatchObject({ name: 'storage_tb', failed: true, excelFormula: '=INDIRECT("Inputs!F2")*86400' })
  })

  it('rejects direct cell references and names the defined name to use', async () => {
    const r = await importEdited((wb) => {
      wb.getWorksheet('Calc')!.getCell('C2').value = { formula: 'CEILING(Inputs!$F$2*rf/broker_write/target_util,1)', result: 8 }
    })
    expect(r.pack).toBeNull()
    expect(errors(r)[0]).toMatchObject({ where: 'Calc!C2' })
    expect(errors(r)[0].message.en).toMatch(/use the name "ingress"/)
  })

  it('rejects unknown names and circular references', async () => {
    const unknown = await importEdited((wb) => {
      wb.getWorksheet('Calc')!.getCell('C2').value = { formula: 'ingress*nope', result: 1 }
    })
    expect(errors(unknown)[0].message.en).toMatch(/Unknown name "nope"/)
    const cycle = await importEdited((wb) => {
      wb.getWorksheet('Calc')!.getCell('C2').value = { formula: 'brokers+1', result: 1 }
    })
    expect(errors(cycle).some((e) => /circular reference/.test(e.message.en))).toBe(true)
  })

  it('reports invalid cells in Inputs, Outputs, Warnings and Tests', async () => {
    const r = await importEdited((wb) => {
      wb.getWorksheet('Inputs')!.getCell('F2').value = 'abc'
      wb.getWorksheet('Outputs')!.getCell('C2').value = 'nothing'
      wb.getWorksheet('Warnings')!.getCell('C2').value = 'critical'
      wb.getWorksheet('Tests')!.getCell('F2').value = 'x'
    })
    expect(r.pack).toBeNull()
    expect(errors(r).map((e) => e.where)).toEqual(expect.arrayContaining(['Inputs!F2', 'Outputs!C2', 'Warnings!C2', 'Tests!F2']))
  })

  it('requires the Tests sheet and rejects empty or non-zip files', async () => {
    const r = await importEdited((wb) => {
      wb.removeWorksheet(wb.getWorksheet('Tests')!.id)
    })
    expect(r.pack).toBeNull()
    expect(errors(r)[0].message.en).toBe('Missing sheet Tests.')
    const empty = await importRulePackXlsx(new Uint8Array(0), 'empty.xlsx')
    expect(errors(empty)[0].message.en).toMatch(/Not a valid .xlsx/)
  })

  it('rejects external workbook references', async () => {
    const r = await importEdited((wb) => {
      wb.getWorksheet('Calc')!.getCell('C2').value = { formula: "'[other.xlsx]Sheet1'!A1*2", result: 1 }
    })
    expect(errors(r)[0]).toMatchObject({ where: 'Calc!C2' })
    expect(errors(r)[0].message.en).toMatch(/External/)
  })

  it('rejects a reference to another model', async () => {
    const r = await importEdited((wb) => {
      wb.getWorksheet('Model')!.getRow(7).values = ['other', 'Khác', 'Other', 'other', 'excel']
      const inputs = wb.getWorksheet('Inputs')!
      inputs.getRow(6).values = ['other', 'qps', 'qps', 'qps', 'count', 10]
      wb.definedNames.add('Inputs!$F$6', 'qps')
      wb.getWorksheet('Calc')!.getRow(6).values = ['other', 'nodes', { formula: 'qps*ingress', result: 1500 }, 'count']
      wb.getWorksheet('Outputs')!.getRow(4).values = ['other', 'nodes', 'nodes', 'count']
    })
    expect(r.pack).toBeNull()
    expect(errors(r)[0]).toMatchObject({ where: 'Calc!C6' })
    expect(errors(r)[0].message.en).toMatch(/belongs to model kafka/)
  })
})

describe('importRulePackXlsx: auto-generated tests (05 §5 mode B)', () => {
  it('builds a "cached" test from defaults and saved results when the Tests sheet has no rows', async () => {
    const r = await importEdited((wb) => {
      wb.getWorksheet('Tests')!.spliceRows(2, 1)
    })
    expect(errors(r)).toEqual([])
    const model = r.pack!.models[0]
    expect(model.tests).toEqual([
      { id: 'cached', inputs: { ingress: 150, rf: 3, retention_days: 3, is_prod: 1 }, expected: { brokers: 14, storage_tb: 116.64 }, tolerance: CACHED_TEST_TOLERANCE },
    ])
    expect(r.preview!.models[0].autoTestIds).toEqual(['cached'])
  })

  it('imports a workbook without tests or cached values as a model with no tests (draft only), with the F9 hint', async () => {
    const r = await importEdited((wb) => {
      wb.getWorksheet('Tests')!.spliceRows(2, 1)
      const calc = wb.getWorksheet('Calc')!
      for (const address of ['C2', 'C3', 'C4', 'C5']) calc.getCell(address).value = { formula: calc.getCell(address).formula }
    })
    expect(errors(r)).toEqual([])
    expect(r.pack!.models[0].tests).toEqual([])
    expect(warnings(r).some((w) => /can only be saved as draft/.test(w.message.en) && /F9/.test(w.message.en))).toBe(true)
  })

  it('warns and skips an output whose cached result is missing', async () => {
    const r = await importEdited((wb) => {
      wb.getWorksheet('Tests')!.spliceRows(2, 1)
      wb.getWorksheet('Calc')!.getCell('C5').value = { formula: 'MAX(tp_brokers,storage_brokers,rf)' }
    })
    expect(errors(r)).toEqual([])
    expect(r.pack!.models[0].tests[0].expected).toEqual({ storage_tb: 116.64 })
    expect(warnings(r).some((w) => /no saved Excel result/.test(w.message.en))).toBe(true)
  })
})

describe('importRulePackXlsx: tolerant reading', () => {
  it('accepts names without a defined name (with a warning) and reorders steps by dependency', async () => {
    const r = await importEdited((wb) => {
      const calc = wb.getWorksheet('Calc')!
      // Move "brokers" above its inputs.
      calc.getRow(2).values = ['kafka', 'brokers', { formula: 'MAX(tp_brokers,storage_brokers,rf)', result: 14 }, 'count']
      calc.getRow(5).values = ['kafka', 'tp_brokers', { formula: 'CEILING(ingress*rf/broker_write/target_util,1)', result: 8 }, 'count']
      wb.definedNames.remove('Calc!$C$2', 'tp_brokers')
      wb.definedNames.remove('Calc!$C$5', 'brokers')
      wb.definedNames.add('Calc!$C$2', 'brokers')
    })
    expect(errors(r)).toEqual([])
    expect(r.pack!.models[0].calc.map((c) => c.name)).toEqual(['storage_tb', 'storage_brokers', 'tp_brokers', 'brokers'])
    expect(warnings(r).some((w) => /reordered/.test(w.message.en))).toBe(true)
    expect(warnings(r).some((w) => /"tp_brokers" is not a defined name/.test(w.message.en))).toBe(true)
  })

  it('reads percent literals and IFS from edited formulas', async () => {
    const r = await importEdited((wb) => {
      wb.getWorksheet('Calc')!.getCell('C4').value = { formula: '_xlfn.IFS(storage_tb>100,CEILING(storage_tb/(disk_per_broker*70%),1),TRUE,1)', result: 14 }
    })
    expect(errors(r)).toEqual([])
    expect(r.pack!.models[0].calc[2].formula).toBe('if(storage_tb > 100, ceil(storage_tb / (disk_per_broker * 0.7)), 1)')
    expect(r.pack!.models[0].calc[2].excelFormula).toBe('=IFS(storage_tb>100,CEILING(storage_tb/(disk_per_broker*70%),1),TRUE,1)')
  })
})

import ExcelJS from 'exceljs'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { importRulePackXlsx } from './importer'
import { buildTemplateWorkbook, KAFKA_TEMPLATE_MODEL, KAFKA_TEMPLATE_RESULTS } from './template'

async function load(data: Uint8Array): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(data.slice().buffer as unknown as Parameters<typeof wb.xlsx.load>[0])
  return wb
}

describe('Excel template (05 §9 Kafka example)', () => {
  it('cached results match a plain recomputation of the formulas', () => {
    const ingress = 150
    const rf = 3
    const retention = 3
    const tp = Math.ceil((ingress * rf) / 100 / 0.6)
    const storage = (ingress * 86400 * retention * rf) / 1000000
    const storageBrokers = Math.ceil(storage / (12 * 0.7))
    expect(tp).toBe(KAFKA_TEMPLATE_RESULTS.tp_brokers)
    expect(storage).toBeCloseTo(KAFKA_TEMPLATE_RESULTS.storage_tb, 9)
    expect(storageBrokers).toBe(KAFKA_TEMPLATE_RESULTS.storage_brokers)
    expect(Math.max(tp, storageBrokers, rf)).toBe(KAFKA_TEMPLATE_RESULTS.brokers)
  })

  it('writes every sheet, defined names and formulas with cached results', async () => {
    const { data, fileName, issues } = await buildTemplateWorkbook()
    expect(fileName).toBe('archpilot-rule-template.xlsx')
    expect(issues).toEqual([])
    const wb = await load(data)
    expect(wb.worksheets.map((w) => w.name)).toEqual(['HuongDan', 'Model', 'Inputs', 'Params', 'Calc', 'Outputs', 'Warnings', 'Lookups', 'Tests'])
    const names = Object.fromEntries((wb.definedNames.model as { name: string; ranges: string[] }[]).map((d) => [d.name, d.ranges[0]]))
    expect(names.ingress).toBe('Inputs!$F$2')
    expect(names.rf).toBe('Inputs!$F$3')
    expect(names.broker_write).toBe('Params!$C$2')
    expect(names.tp_brokers).toBe('Calc!$C$2')
    expect(names.brokers).toBe('Calc!$C$5')
    const calc = wb.getWorksheet('Calc')!
    expect(calc.getCell('C2').formula).toBe('CEILING(ingress*rf/broker_write/target_util,1)')
    expect(calc.getCell('C2').result).toBe(8)
    expect(calc.getCell('C3').result).toBe(116.64)
    expect(calc.getCell('C4').result).toBe(14)
    expect(calc.getCell('C5').formula).toBe('MAX(tp_brokers,storage_brokers,rf)')
    expect(calc.getCell('C5').result).toBe(14)
    expect(wb.getWorksheet('Warnings')!.getCell('B2').value).toBe('rf<3')
    expect(wb.getWorksheet('Tests')!.getRow(1).values).toEqual([undefined, 'model_id', 'test_id', 'in:ingress', 'in:rf', 'in:retention_days', 'out:brokers', 'out:storage_tb', 'tolerance'])
    // Excel recalculates on open; the cached values are what it shows first.
    const workbookXml = strFromU8(unzipSync(data)['xl/workbook.xml'])
    expect(workbookXml).toContain('fullCalcOnLoad="1"')
    expect(workbookXml).toContain('<definedName name="ingress">Inputs!$F$2</definedName>')
  })

  it('imports back into the Kafka model with the expected DSL (AC-RB-01 translation part)', async () => {
    const { data } = await buildTemplateWorkbook()
    const result = await importRulePackXlsx(data, 'archpilot-rule-template.xlsx')
    expect(result.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(result.pack).not.toBeNull()
    const model = result.pack!.models[0]
    expect(model.id).toBe('kafka')
    expect(model.formulaMode).toBe('excel')
    expect(model.calc.map((c) => [c.name, c.formula])).toEqual([
      ['tp_brokers', 'ceil(ingress * rf / broker_write / target_util)'],
      ['storage_tb', 'ingress * 86400 * retention_days * rf / 1000000'],
      ['storage_brokers', 'ceil(storage_tb / (disk_per_broker * disk_fill))'],
      ['brokers', 'max(tp_brokers, storage_brokers, rf)'],
    ])
    expect(model.calc[0].excelFormula).toBe('=CEILING(ingress*rf/broker_write/target_util,1)')
    expect(model.warnings).toEqual(KAFKA_TEMPLATE_MODEL.warnings)
    expect(model.tests).toEqual(KAFKA_TEMPLATE_MODEL.tests)
    // Everything round-trips except optional fields the template leaves out.
    expect(model).toEqual(KAFKA_TEMPLATE_MODEL)
    expect(result.preview!.models[0].calcRows.map((r) => r.cached)).toEqual([8, 116.64, 14, 14])
  })
})

/**
 * RulePack -> .xlsx writer (WP-A2, docs/v3/05 §4, RB-05). Also builds the
 * downloadable template (template.ts passes the Kafka example through here).
 *
 * - excel-mode models: Calc formulas are written back as real formulas over
 *   defined names, with a cached result when one is supplied, so Excel shows
 *   numbers at once and recomputes them on open (fullCalcOnLoad).
 * - units-mode models: Excel cannot compute unit-aware DSL, so the DSL goes
 *   to the `dsl_formula` column and the `formula` cell stays empty.
 * - Every text cell passes through guardText (formula-injection guard).
 *
 * Runs in the browser and in Node (vitest); no DOM access here.
 */
import ExcelJS from 'exceljs'
import type { RuleLookup, RulePack, SizingModelDef } from '../../../contracts/pilot'
import { FormulaSyntaxError, rewriteExcelFormula } from './excelFormula'
import { dslToExcel } from './dslToExcel'
import { isSafeStoredExcelFormula } from './formulaSafety'
import { COLUMNS, LOOKUP_TABLE_MARKER, PACK_KEYS, SHEET, excelModelPrefix, excelSafeName, guardText } from './layout'
import { issueWarning, msg, type ExcelIssue } from './messages'

export type PackForExcel = Pick<RulePack, 'name' | 'version' | 'models'> & { description?: string | null }

export interface ExportOptions {
  /** Cached result per calc name for a model (raw numbers), e.g. from evaluateModel. */
  cachedResults?: (model: SizingModelDef) => Record<string, number> | null
}

export interface ExportResult {
  data: Uint8Array
  fileName: string
  issues: ExcelIssue[]
}

type CellValue = string | number | null | undefined | { formula: string; result?: number }

interface NamePlan {
  /** modelId -> lower-case identifier -> Excel defined name */
  values: Map<string, Map<string, string>>
  /** modelId -> lower-case table name -> exported table name */
  tables: Map<string, Map<string, string>>
  /** exported table name -> table */
  uniqueTables: Map<string, RuleLookup>
}

function modelNames(model: SizingModelDef): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const name of [...model.inputs.map((i) => i.name), ...model.params.map((p) => p.name), ...model.calc.map((c) => c.name)]) {
    const lower = name.toLowerCase()
    if (!seen.has(lower)) {
      seen.add(lower)
      out.push(name)
    }
  }
  return out
}

/** Decide every defined name of the workbook (rule documented in layout.ts). */
export function planNames(models: SizingModelDef[]): NamePlan {
  const count = new Map<string, number>()
  for (const m of models) for (const n of modelNames(m)) count.set(n.toLowerCase(), (count.get(n.toLowerCase()) ?? 0) + 1)
  const used = new Set<string>()
  const claim = (candidate: string) => {
    let name = excelSafeName(candidate)
    for (let i = 2; used.has(name.toLowerCase()); i++) name = excelSafeName(`${candidate}_${i}`)
    used.add(name.toLowerCase())
    return name
  }
  const values = new Map<string, Map<string, string>>()
  for (const m of models) {
    const map = new Map<string, string>()
    for (const n of modelNames(m)) {
      const shared = (count.get(n.toLowerCase()) ?? 0) > 1
      map.set(n.toLowerCase(), claim(shared ? `${excelModelPrefix(m.id)}_${n}` : n))
    }
    values.set(m.id, map)
  }
  const tables = new Map<string, Map<string, string>>()
  const uniqueTables = new Map<string, RuleLookup>()
  const byContent = new Map<string, string>()
  for (const m of models) {
    const map = new Map<string, string>()
    for (const t of m.lookups) {
      const key = JSON.stringify([t.name.toLowerCase(), t.columns, t.rows])
      let exported = byContent.get(key)
      if (!exported) {
        exported = claim([...uniqueTables.keys()].some((k) => k.toLowerCase() === t.name.toLowerCase()) ? `${excelModelPrefix(m.id)}_${t.name}` : t.name)
        byContent.set(key, exported)
        uniqueTables.set(exported, t)
      }
      map.set(t.name.toLowerCase(), exported)
    }
    tables.set(m.id, map)
  }
  return { values, tables, uniqueTables }
}

/** Excel name of one lookup column: `<table>.<column>`. */
export function lookupColumnName(table: string, column: string): string {
  return excelSafeName(`${table}.${column}`)
}

function textCell(v: string | null | undefined): string | null {
  return v === null || v === undefined || v === '' ? null : guardText(v)
}

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } }

function writeHeader(ws: ExcelJS.Worksheet, rowNumber: number, headers: readonly string[]) {
  const row = ws.getRow(rowNumber)
  headers.forEach((h, i) => {
    const cell = row.getCell(i + 1)
    cell.value = h
    cell.font = { bold: true }
    cell.fill = HEADER_FILL
  })
}

function setWidths(ws: ExcelJS.Worksheet, widths: number[]) {
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w
  })
}

function putRow(ws: ExcelJS.Worksheet, rowNumber: number, values: CellValue[]) {
  const row = ws.getRow(rowNumber)
  values.forEach((v, i) => {
    if (v === null || v === undefined) return
    row.getCell(i + 1).value = v as ExcelJS.CellValue
  })
}

const colLetter = (index1: number) => {
  let n = index1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function addName(wb: ExcelJS.Workbook, sheet: string, col1: number, row: number, name: string, col2?: number, row2?: number) {
  const a = `$${colLetter(col1)}$${row}`
  const range = col2 !== undefined && row2 !== undefined ? `${a}:$${colLetter(col2)}$${row2}` : a
  wb.definedNames.add(`${sheet}!${range}`, name)
}

export const GUIDE_LINES: [string, string][] = [
  ['HƯỚNG DẪN / INSTRUCTIONS', ''],
  ['Mỗi file = một rule pack. Mỗi dòng dữ liệu gắn với một model qua cột model_id.', 'One workbook = one rule pack. Every data row belongs to a model through its model_id column.'],
  ['Model: khối đầu là pack_name, pack_description, pack_version; bảng bên dưới có một dòng cho mỗi model.', 'Model: the header block holds pack_name, pack_description, pack_version; the table below has one row per model.'],
  ['Inputs: biến đầu vào. Cột value là giá trị mặc định; ô đó có defined name trùng cột name.', 'Inputs: input variables. The value column is the default; that cell has a defined name equal to the name column.'],
  ['Params: hằng số (value, unit, nguồn trích dẫn). Ô value cũng có defined name.', 'Params: constants (value, unit, source). The value cell also has a defined name.'],
  ['Calc: mỗi dòng một bước tính. Cột formula là công thức Excel thật dùng defined name, ví dụ =CEILING(ingress*rf/broker_write/target_util,1).', 'Calc: one step per row. The formula column is a real Excel formula over defined names, e.g. =CEILING(ingress*rf/broker_write/target_util,1).'],
  ['Ô công thức Calc cũng có defined name = name, để bước sau dùng kết quả bước trước.', 'Each Calc formula cell also has a defined name = name, so later steps can use earlier results.'],
  ['Tên trùng giữa nhiều model: defined name có tiền tố <model_id>_, ví dụ kafka_ingress. Tên giống địa chỉ ô (rf1, R2C3) có tiền tố _.', 'Names shared by several models get a <model_id>_ prefix, e.g. kafka_ingress. Names that look like a cell (rf1, R2C3) get a _ prefix.'],
  ['Thêm biến/bước mới: thêm dòng, rồi Formulas > Define Name cho ô value/formula.', 'To add a variable or step: add a row, then Formulas > Define Name on its value/formula cell.'],
  ['Outputs: from_calc là tên bước Calc (hoặc input); rounding = none | ceil | floor | round.', 'Outputs: from_calc names a Calc step (or input); rounding = none | ceil | floor | round.'],
  ['Warnings: condition là biểu thức Excel dạng chữ, ví dụ rf<3 hoặc AND(rf<3,ingress>100); severity = info | low | medium | high.', 'Warnings: condition is Excel-style text, e.g. rf<3 or AND(rf<3,ingress>100); severity = info | low | medium | high.'],
  ['Lookups: dòng "table | <tên bảng>", dòng tiêu đề, rồi các dòng dữ liệu; cột đầu là khóa. Defined name <bảng> = vùng dữ liệu, <bảng>.<cột> = một cột.', 'Lookups: a "table | <name>" row, a header row, then data rows; the first column is the key. Defined name <table> = data rows, <table>.<column> = one column.'],
  ['Tra cứu: VLOOKUP(khóa,bảng,n,FALSE), XLOOKUP(khóa,bảng.khóa,bảng.cột), INDEX(bảng.cột,MATCH(khóa,bảng.khóa,0)).', 'Lookups in formulas: VLOOKUP(key,table,n,FALSE), XLOOKUP(key,table.key,table.col), INDEX(table.col,MATCH(key,table.key,0)).'],
  ['Tests: mỗi dòng một test; cột in:<tên> là input, out:<tên> là output kỳ vọng, tolerance là sai số tương đối (0.0001 = 0.01%).', 'Tests: one row per test; in:<name> columns are inputs, out:<name> columns are expected outputs, tolerance is relative (0.0001 = 0.01%).'],
  ['Nếu một model không có test, ArchPilot tự tạo test "cached" từ giá trị mặc định và kết quả Excel đã tính sẵn: hãy mở và lưu file trong Excel trước khi import.', 'If a model has no tests, ArchPilot creates a "cached" test from the defaults and the results Excel saved: open and save the file in Excel before importing.'],
  ['Hàm hỗ trợ: + - * / ^ %, = <> < > <= >=, ROUND, ROUNDUP, ROUNDDOWN, CEILING, FLOOR, MAX, MIN, SUM, AVERAGE, ABS, IF, IFS, AND, OR, NOT, VLOOKUP, XLOOKUP, INDEX/MATCH.', 'Supported: + - * / ^ %, = <> < > <= >=, ROUND, ROUNDUP, ROUNDDOWN, CEILING, FLOOR, MAX, MIN, SUM, AVERAGE, ABS, IF, IFS, AND, OR, NOT, VLOOKUP, XLOOKUP, INDEX/MATCH.'],
  ['Không hỗ trợ: địa chỉ ô trực tiếp (A1, Sheet!B2), tham chiếu file khác, công thức mảng, hàm khác (INDIRECT, OFFSET...). Gặp là báo lỗi kèm địa chỉ ô.', 'Not supported: direct cell addresses (A1, Sheet!B2), external links, array formulas, other functions (INDIRECT, OFFSET...). They are reported with the cell address.'],
  ['Model formula_mode = units: công thức ở cột dsl_formula (DSL có đơn vị), Excel không tính các dòng này.', 'Models with formula_mode = units keep their rule DSL in dsl_formula; Excel does not compute those rows.'],
  ['Giới hạn: chỉ .xlsx, tối đa 5 MB, 2.000 dòng mỗi sheet, 50 model.', 'Limits: .xlsx only, at most 5 MB, 2,000 rows per sheet, 50 models.'],
  ["Ô chữ bắt đầu bằng = + - @ được thêm dấu ' phía trước để không bị chạy như công thức.", "Text cells starting with = + - @ get a leading ' so they are never run as formulas."],
]

function writeGuide(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet(SHEET.guide)
  setWidths(ws, [100, 100])
  GUIDE_LINES.forEach(([vi, en], i) => {
    const row = ws.getRow(i + 1)
    row.getCell(1).value = guardText(vi)
    row.getCell(2).value = en === '' ? null : guardText(en)
    row.getCell(1).alignment = { wrapText: true, vertical: 'top' }
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' }
    if (i === 0) row.font = { bold: true, size: 13 }
  })
}

export function safeFileName(name: string): string {
  const base = name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
  return `${base || 'rule-pack'}.xlsx`
}

/** Build the workbook for a pack. Never throws for content problems; they become warnings. */
export async function exportRulePackToXlsx(pack: PackForExcel, options: ExportOptions = {}): Promise<ExportResult> {
  const issues: ExcelIssue[] = []
  const wb = new ExcelJS.Workbook()
  wb.creator = 'ArchPilot'
  wb.calcProperties.fullCalcOnLoad = true
  const plan = planNames(pack.models)

  writeGuide(wb)

  // Model
  const wsModel = wb.addWorksheet(SHEET.model)
  setWidths(wsModel, [20, 28, 28, 18, 14, 50])
  putRow(wsModel, 1, [PACK_KEYS.name, textCell(pack.name)])
  putRow(wsModel, 2, [PACK_KEYS.description, textCell(pack.description ?? '')])
  putRow(wsModel, 3, [PACK_KEYS.version, pack.version])
  wsModel.getColumn(1).font = { bold: true }
  writeHeader(wsModel, 5, COLUMNS.model)
  pack.models.forEach((m, i) => {
    putRow(wsModel, 6 + i, [textCell(m.id), textCell(m.nameVi), textCell(m.nameEn), textCell(m.componentType), m.formulaMode ?? 'units', textCell(m.description)])
  })

  // Inputs
  const wsIn = wb.addWorksheet(SHEET.inputs)
  setWidths(wsIn, [14, 20, 26, 26, 10, 12, 10, 10, 24])
  writeHeader(wsIn, 1, COLUMNS.inputs)
  let r = 2
  for (const m of pack.models) {
    for (const inp of m.inputs) {
      putRow(wsIn, r, [textCell(m.id), textCell(inp.name), textCell(inp.labelVi), textCell(inp.labelEn), textCell(inp.unit), inp.default, inp.min, inp.max, textCell(inp.source)])
      addName(wb, SHEET.inputs, 6, r, plan.values.get(m.id)!.get(inp.name.toLowerCase())!)
      r++
    }
  }

  // Params
  const wsPar = wb.addWorksheet(SHEET.params)
  setWidths(wsPar, [14, 20, 12, 10, 36])
  writeHeader(wsPar, 1, COLUMNS.params)
  r = 2
  for (const m of pack.models) {
    for (const par of m.params) {
      putRow(wsPar, r, [textCell(m.id), textCell(par.name), par.value, textCell(par.unit), textCell(par.source)])
      addName(wb, SHEET.params, 3, r, plan.values.get(m.id)!.get(par.name.toLowerCase())!)
      r++
    }
  }

  // Calc
  const wsCalc = wb.addWorksheet(SHEET.calc)
  setWidths(wsCalc, [14, 20, 60, 10, 36, 60])
  const hasUnits = pack.models.some((m) => (m.formulaMode ?? 'units') === 'units')
  let calcHeader = 1
  if (hasUnits) {
    wsCalc.getCell('A1').value = 'Ghi chú: model formula_mode = units chỉ có dsl_formula (DSL có đơn vị); Excel không tính các dòng đó. / Note: rows of formula_mode = units models carry the rule DSL in dsl_formula; Excel does not compute them.'
    wsCalc.getCell('A1').font = { italic: true }
    calcHeader = 3
  }
  writeHeader(wsCalc, calcHeader, COLUMNS.calc)
  r = calcHeader + 1
  for (const m of pack.models) {
    const excelMode = m.formulaMode === 'excel'
    const names = plan.values.get(m.id)!
    const tables = plan.tables.get(m.id)!
    const cached = excelMode ? safeCached(options, m) : null
    const rename = (name: string): string | null => resolveExportName(m, names, tables, name)
    for (const c of m.calc) {
      const where = `${SHEET.calc}!C${r}`
      let formulaCell: CellValue = null
      if (excelMode) {
        let excelText: string | null = null
        if (c.excelFormula && c.excelFormula.trim() !== '' && !isSafeStoredExcelFormula(c.excelFormula)) {
          // Never re-emit a stored formula outside the import allow-list (e.g. WEBSERVICE, cell refs).
          issues.push(issueWarning(where, msg(`Bước ${c.name}: công thức Excel đã lưu dùng hàm hoặc tham chiếu không được phép; dùng bản dịch từ DSL.`, `Step ${c.name}: the stored Excel formula uses a function or reference that is not allowed; using the DSL translation.`)))
        } else if (c.excelFormula && c.excelFormula.trim() !== '') {
          try {
            const rewritten = rewriteExcelFormula(c.excelFormula, rename)
            if (rewritten.unknown.length > 0) {
              issues.push(issueWarning(where, msg(`Bước ${c.name}: tên không rõ ${rewritten.unknown.join(', ')}.`, `Step ${c.name}: unknown name(s) ${rewritten.unknown.join(', ')}.`)))
            }
            excelText = rewritten.formula
          } catch (e) {
            if (!(e instanceof FormulaSyntaxError)) throw e
            issues.push(issueWarning(where, msg(`Bước ${c.name}: công thức Excel gốc không đọc được, dùng bản dịch từ DSL.`, `Step ${c.name}: the stored Excel formula does not parse; using the DSL translation.`)))
          }
        }
        if (excelText === null) {
          const back = dslToExcel(c.formula, dslEnv(m, names, tables))
          if (back) excelText = back.slice(1)
          else issues.push(issueWarning(where, msg(`Bước ${c.name}: không có công thức Excel tương đương; Excel sẽ không tính bước này.`, `Step ${c.name}: no Excel equivalent; Excel will not compute this step.`)))
        }
        if (excelText !== null) {
          const result = cached?.[c.name]
          formulaCell = typeof result === 'number' && Number.isFinite(result) ? { formula: excelText, result } : { formula: excelText }
        }
      }
      putRow(wsCalc, r, [textCell(m.id), textCell(c.name), formulaCell, textCell(c.unit), textCell(c.description), textCell(c.formula)])
      if (formulaCell !== null) addName(wb, SHEET.calc, 3, r, names.get(c.name.toLowerCase())!)
      r++
    }
  }

  // Outputs
  const wsOut = wb.addWorksheet(SHEET.outputs)
  setWidths(wsOut, [14, 20, 20, 10, 10, 26, 26])
  writeHeader(wsOut, 1, COLUMNS.outputs)
  r = 2
  for (const m of pack.models) {
    for (const o of m.outputs) {
      putRow(wsOut, r, [textCell(m.id), textCell(o.name), textCell(o.from), textCell(o.unit), o.rounding ?? null, textCell(o.labelVi), textCell(o.labelEn)])
      r++
    }
  }

  // Warnings
  const wsWarn = wb.addWorksheet(SHEET.warnings)
  setWidths(wsWarn, [14, 40, 10, 44, 44, 40])
  writeHeader(wsWarn, 1, COLUMNS.warnings)
  r = 2
  for (const m of pack.models) {
    const names = plan.values.get(m.id)!
    const tables = plan.tables.get(m.id)!
    for (const w of m.warnings) {
      const excel = m.formulaMode === 'excel' ? dslToExcel(w.condition, dslEnv(m, names, tables)) : null
      putRow(wsWarn, r, [textCell(m.id), excel ? textCell(excel.slice(1)) : null, w.severity, textCell(w.messageVi), textCell(w.messageEn), textCell(w.condition)])
      r++
    }
  }

  // Lookups
  const wsLook = wb.addWorksheet(SHEET.lookups)
  setWidths(wsLook, [18, 16, 16, 16, 16, 16])
  r = 1
  for (const [exported, table] of plan.uniqueTables) {
    putRow(wsLook, r, [LOOKUP_TABLE_MARKER, textCell(exported)])
    wsLook.getRow(r).font = { bold: true }
    writeHeader(wsLook, r + 1, table.columns.map((c) => guardText(c)))
    const first = r + 2
    table.rows.forEach((row, i) => putRow(wsLook, first + i, row.map((v) => (typeof v === 'number' ? v : textCell(v)))))
    const last = first + table.rows.length - 1
    if (table.rows.length > 0 && table.columns.length > 0) {
      addName(wb, SHEET.lookups, 1, first, exported, table.columns.length, last)
      table.columns.forEach((col, ci) => addName(wb, SHEET.lookups, ci + 1, first, lookupColumnName(exported, col), ci + 1, last))
    }
    r = last + 2
  }

  // Tests
  const wsTests = wb.addWorksheet(SHEET.tests)
  const inCols: string[] = []
  const outCols: string[] = []
  for (const m of pack.models) {
    for (const t of m.tests) {
      for (const k of Object.keys(t.inputs)) if (!inCols.includes(k)) inCols.push(k)
      for (const k of Object.keys(t.expected)) if (!outCols.includes(k)) outCols.push(k)
    }
  }
  const testHeaders = ['model_id', 'test_id', ...inCols.map((c) => `in:${c}`), ...outCols.map((c) => `out:${c}`), 'tolerance']
  writeHeader(wsTests, 1, testHeaders)
  setWidths(wsTests, testHeaders.map((h) => Math.max(10, h.length + 2)))
  r = 2
  for (const m of pack.models) {
    for (const t of m.tests) {
      putRow(wsTests, r, [textCell(m.id), textCell(t.id), ...inCols.map((c) => t.inputs[c]), ...outCols.map((c) => t.expected[c]), t.tolerance])
      r++
    }
  }

  for (const ws of [wsModel, wsIn, wsPar, wsOut, wsWarn, wsTests]) {
    const headerRow = ws === wsModel ? 5 : 1
    ws.views = [{ state: 'frozen', ySplit: headerRow }]
  }
  wsCalc.views = [{ state: 'frozen', ySplit: calcHeader }]

  const buffer = await wb.xlsx.writeBuffer()
  return { data: new Uint8Array(buffer as ArrayBuffer), fileName: safeFileName(pack.name), issues }
}

function safeCached(options: ExportOptions, model: SizingModelDef): Record<string, number> | null {
  try {
    return options.cachedResults?.(model) ?? null
  } catch {
    return null
  }
}

/** Map a name used in a stored Excel formula (any prefix style) to this export's defined name. */
function resolveExportName(model: SizingModelDef, names: Map<string, string>, tables: Map<string, string>, name: string): string | null {
  const lower = name.toLowerCase()
  const prefixes = [`${model.id.toLowerCase()}_`, `${excelModelPrefix(model.id).toLowerCase()}_`, `${model.id.toLowerCase()}.`, '_']
  const candidates = [lower, ...prefixes.filter((p) => lower.startsWith(p)).map((p) => lower.slice(p.length))]
  for (const c of candidates) {
    const v = names.get(c)
    if (v) return v
  }
  for (const c of candidates) {
    const t = tables.get(c)
    if (t) return t
    const dot = c.indexOf('.')
    if (dot > 0) {
      const table = tables.get(c.slice(0, dot))
      const lookup = model.lookups.find((l) => l.name.toLowerCase() === c.slice(0, dot))
      const column = lookup?.columns.find((col) => col.toLowerCase() === c.slice(dot + 1) || excelSafeName(col).toLowerCase() === c.slice(dot + 1))
      if (table && column !== undefined) return lookupColumnName(table, column)
    }
  }
  return null
}

function dslEnv(model: SizingModelDef, names: Map<string, string>, tables: Map<string, string>) {
  return {
    nameFor: (ident: string) => names.get(ident.toLowerCase()) ?? null,
    lookupNames: (table: string, column: string) => {
      const exported = tables.get(table.toLowerCase())
      const def = model.lookups.find((l) => l.name.toLowerCase() === table.toLowerCase())
      if (!exported || !def || def.columns.length === 0 || !def.columns.includes(column)) return null
      return { keyColumn: lookupColumnName(exported, def.columns[0]), valueColumn: lookupColumnName(exported, column) }
    },
  }
}

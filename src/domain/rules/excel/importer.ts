/**
 * .xlsx -> RulePack importer (WP-A2, docs/v3/05 §4-5, RB-03/RB-04).
 *
 * All-or-nothing: any error (with its Sheet!A1 address) means no pack is
 * produced. A best-effort preview is still returned so the UI can show the
 * translation table next to the errors.
 *
 * Names in formulas are resolved through the workbook's defined names: a
 * name is followed to its cell, and the identifier is that row's `name`
 * column (so `kafka_ingress` -> `ingress`). Names missing from the workbook
 * fall back to the model's own names, with a warning.
 */
import ExcelJS from 'exceljs'
import type {
  RuleInput,
  RuleLookup,
  RuleOutput,
  RuleParam,
  RulePack,
  RuleRounding,
  RuleSeverity,
  RuleTest,
  RuleWarning,
  SizingModelDef,
} from '../../../contracts/pilot'
import { formatNumber } from './dsl'
import { displayExcelFormula, rewriteExcelFormula } from './excelFormula'
import {
  COLUMNS,
  IDENT_RE,
  LIMITS,
  LOOKUP_TABLE_MARKER,
  MODEL_ID_RE,
  PACK_KEYS,
  RESERVED_IDENTS,
  ROUNDINGS,
  SEVERITIES,
  SHEET,
  excelModelPrefix,
  excelSafeName,
  unguardText,
} from './layout'
import { issueError, issueWarning, msg, type ExcelIssue, type Msg } from './messages'
import { translateExcelFormula, type Resolved, type TranslateEnv } from './translate'
import { inspectXlsxPackage } from './zipGuard'

export type ImportedPackDraft = Omit<RulePack, 'id' | 'builtIn' | 'createdAt' | 'updatedAt'>

export interface CalcPreviewRow {
  name: string
  where: string
  excelFormula: string | null
  dsl: string | null
  /** Value Excel saved with the formula, when it is a number. */
  cached: number | null
  /** Non-numeric cached value (e.g. "#NAME?") or null. */
  cachedText: string | null
  unit: string
  failed: boolean
}

export interface WarningPreviewRow {
  where: string
  condition: string
  dsl: string | null
  severity: string
  failed: boolean
}

export interface ModelPreview {
  model: SizingModelDef
  calcRows: CalcPreviewRow[]
  warningRows: WarningPreviewRow[]
  autoTestIds: string[]
}

export interface ImportPreview {
  packName: string
  description: string
  version: number
  models: ModelPreview[]
}

export interface ImportResult {
  /** Null whenever `issues` contains an error. */
  pack: ImportedPackDraft | null
  preview: ImportPreview | null
  issues: ExcelIssue[]
}

/** Relative tolerance of the auto-generated "cached" test (05 AC-RB-04). */
export const CACHED_TEST_TOLERANCE = 1e-9
export const DEFAULT_TEST_TOLERANCE = 0.0001

interface Area {
  sheet: string
  top: number
  left: number
  bottom: number
  right: number
}

interface Owner {
  modelId: string
  name: string
}

interface LookupTableArea extends Area {
  table: RuleLookup
  headerRow: number
}

interface Header {
  row: number
  cols: Map<string, number>
}

function colLetter(index1: number): string {
  let n = index1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function colNumber(letters: string): number {
  let n = 0
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n
}

const at = (sheet: string, row: number, col: number) => `${sheet}!${colLetter(col)}${row}`
const ownerKey = (sheet: string, row: number, col: number) => `${sheet.toLowerCase()}|${row}|${col}`

/** "Inputs!$F$2", "'My sheet'!$A$1:$C$4" or "$F$2" -> area (sheet defaults to `currentSheet`). */
function parseArea(text: string, currentSheet: string): Area | null {
  const bang = text.lastIndexOf('!')
  let sheet = currentSheet
  let ref = text
  if (bang >= 0) {
    sheet = text.slice(0, bang)
    if (sheet.startsWith("'") && sheet.endsWith("'")) sheet = sheet.slice(1, -1).replace(/''/g, "'")
    ref = text.slice(bang + 1)
  }
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?$/.exec(ref)
  if (!m) return null
  const c1 = colNumber(m[1])
  const r1 = Number(m[2])
  const c2 = m[3] ? colNumber(m[3]) : c1
  const r2 = m[4] ? Number(m[4]) : r1
  return { sheet, top: Math.min(r1, r2), bottom: Math.max(r1, r2), left: Math.min(c1, c2), right: Math.max(c1, c2) }
}

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value as unknown
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return unguardText(v.trim())
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (Array.isArray(o.richText)) return unguardText((o.richText as { text: string }[]).map((t) => t.text).join('').trim())
    if (typeof o.text === 'string') return unguardText(o.text.trim())
    if ('formula' in o || 'sharedFormula' in o) {
      const res = o.result as unknown
      if (res === null || res === undefined) return ''
      if (typeof res === 'object') return String((res as { error?: string }).error ?? '')
      return String(res)
    }
    if (typeof o.error === 'string') return o.error
  }
  return String(v)
}

function isFormulaCell(cell: ExcelJS.Cell): boolean {
  const v = cell.value as unknown
  return typeof v === 'object' && v !== null && ('formula' in v || 'sharedFormula' in v)
}

type NumberRead = { ok: true; value: number | null; fromFormula: boolean } | { ok: false }

function cellNumber(cell: ExcelJS.Cell): NumberRead {
  const v = cell.value as unknown
  if (v === null || v === undefined) return { ok: true, value: null, fromFormula: false }
  if (typeof v === 'number') return Number.isFinite(v) ? { ok: true, value: v, fromFormula: false } : { ok: false }
  if (isFormulaCell(cell)) {
    const res = (v as { result?: unknown }).result
    return typeof res === 'number' && Number.isFinite(res) ? { ok: true, value: res, fromFormula: true } : { ok: false }
  }
  const text = cellText(cell)
  if (text === '') return { ok: true, value: null, fromFormula: false }
  if (/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(text)) return { ok: true, value: Number(text), fromFormula: false }
  return { ok: false }
}

function findSheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet | undefined {
  return wb.worksheets.find((ws) => ws.name.trim().toLowerCase() === name.toLowerCase())
}

function findHeader(ws: ExcelJS.Worksheet): Header | null {
  const last = Math.min(ws.rowCount, 30)
  for (let r = 1; r <= last; r++) {
    const row = ws.getRow(r)
    const cols = new Map<string, number>()
    for (let c = 1; c <= Math.min(ws.columnCount, 200); c++) {
      const t = cellText(row.getCell(c)).toLowerCase()
      if (t !== '' && !cols.has(t)) cols.set(t, c)
    }
    if (cols.has('model_id')) return { row: r, cols }
  }
  return null
}

const NOT_A_NUMBER = (sheet: string, row: number, col: number, field: string): ExcelIssue =>
  issueError(at(sheet, row, col), msg(`${field} phải là số.`, `${field} must be a number.`))

/** Import a workbook. Never throws; every problem is an issue with an address. */
export async function importRulePackXlsx(data: Uint8Array | ArrayBuffer, fileName: string): Promise<ImportResult> {
  const issues: ExcelIssue[] = []
  const fail = (where: string, vi: string, en: string): ImportResult => ({ pack: null, preview: null, issues: [...issues, issueError(where, msg(vi, en))] })
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)

  const lowerName = fileName.toLowerCase()
  if (lowerName.endsWith('.xlsm') || lowerName.endsWith('.xls') || lowerName.endsWith('.xlsb')) {
    return fail(fileName, 'Chỉ nhận file .xlsx (không nhận .xlsm/.xls/.xlsb). Hãy Save As .xlsx.', 'Only .xlsx is accepted (not .xlsm/.xls/.xlsb). Save as .xlsx.')
  }
  if (!lowerName.endsWith('.xlsx')) return fail(fileName, 'Chỉ nhận file .xlsx.', 'Only .xlsx files are accepted.')
  if (bytes.byteLength > LIMITS.maxFileBytes) return fail(fileName, 'File lớn hơn 5 MB.', 'The file is larger than 5 MB.')
  const check = inspectXlsxPackage(bytes)
  if (!check.ok) return { pack: null, preview: null, issues: [issueError(fileName, check.message)] }

  const wb = new ExcelJS.Workbook()
  try {
    const copy = bytes.slice().buffer
    await wb.xlsx.load(copy as unknown as Parameters<typeof wb.xlsx.load>[0])
  } catch (e) {
    return fail(fileName, `Không đọc được file Excel: ${String(e)}`, `Could not read the Excel file: ${String(e)}`)
  }
  return importWorkbook(wb, fileName)
}

export function importWorkbook(wb: ExcelJS.Workbook, fileName: string): ImportResult {
  const issues: ExcelIssue[] = []
  const err = (where: string, vi: string, en: string) => issues.push(issueError(where, msg(vi, en)))
  const warn = (where: string, vi: string, en: string) => issues.push(issueWarning(where, msg(vi, en)))

  for (const ws of wb.worksheets) {
    if (ws.actualRowCount > LIMITS.maxRowsPerSheet) err(ws.name, `Sheet ${ws.name} có hơn ${LIMITS.maxRowsPerSheet} dòng.`, `Sheet ${ws.name} has more than ${LIMITS.maxRowsPerSheet} rows.`)
  }
  if (issues.length > 0) return { pack: null, preview: null, issues }

  // Warnings and Lookups may be absent; the Tests sheet must exist even when empty (QA XLS-NEG-11).
  const required = [SHEET.model, SHEET.inputs, SHEET.params, SHEET.calc, SHEET.outputs, SHEET.tests]
  for (const s of required) if (!findSheet(wb, s)) err(fileName, `Thiếu sheet ${s}.`, `Missing sheet ${s}.`)
  if (issues.length > 0) return { pack: null, preview: null, issues }

  // ---- Model sheet ------------------------------------------------------
  const wsModel = findSheet(wb, SHEET.model)!
  const modelHeader = findHeader(wsModel)
  if (!modelHeader) {
    err(SHEET.model, 'Sheet Model thiếu dòng tiêu đề có cột model_id.', 'Sheet Model has no header row with a model_id column.')
    return { pack: null, preview: null, issues }
  }
  let packName = ''
  let description = ''
  let version = 1
  for (let r = 1; r < modelHeader.row; r++) {
    const key = cellText(wsModel.getCell(r, 1)).toLowerCase()
    const valueCell = wsModel.getCell(r, 2)
    if (key === PACK_KEYS.name) packName = cellText(valueCell)
    else if (key === PACK_KEYS.description) description = cellText(valueCell)
    else if (key === PACK_KEYS.version) {
      const n = cellNumber(valueCell)
      if (n.ok && n.value !== null && Number.isInteger(n.value) && n.value >= 1) version = n.value
      else if (cellText(valueCell) !== '') warn(at(SHEET.model, r, 2), 'pack_version không hợp lệ, dùng 1.', 'Invalid pack_version; using 1.')
    }
  }
  if (packName === '') {
    packName = fileName.replace(/\.xlsx$/i, '')
    warn(SHEET.model, 'Thiếu pack_name, dùng tên file.', 'pack_name is missing; using the file name.')
  }

  const models: SizingModelDef[] = []
  const modelById = new Map<string, SizingModelDef>()
  const mc = (name: string) => modelHeader.cols.get(name)
  for (let r = modelHeader.row + 1; r <= wsModel.rowCount; r++) {
    const get = (col: string) => (mc(col) ? cellText(wsModel.getCell(r, mc(col)!)) : '')
    const id = get('model_id')
    if (id === '' && COLUMNS.model.every((c) => get(c) === '')) continue
    const where = at(SHEET.model, r, mc('model_id')!)
    if (!MODEL_ID_RE.test(id)) {
      err(where, `model_id "${id}" không hợp lệ (chữ, số, _ và -, bắt đầu bằng chữ).`, `Invalid model_id "${id}" (letters, digits, _ and -, starting with a letter).`)
      continue
    }
    if ([...modelById.keys()].some((k) => k.toLowerCase() === id.toLowerCase())) {
      err(where, `model_id "${id}" bị trùng.`, `Duplicate model_id "${id}".`)
      continue
    }
    const modeText = get('formula_mode').toLowerCase()
    if (modeText !== '' && modeText !== 'excel' && modeText !== 'units') {
      err(at(SHEET.model, r, mc('formula_mode')!), 'formula_mode phải là excel hoặc units.', 'formula_mode must be excel or units.')
    }
    const nameVi = get('name_vi')
    const nameEn = get('name_en')
    let componentType = get('component_type')
    if (componentType === '') {
      componentType = id
      warn(where, `Model ${id}: thiếu component_type, dùng "${id}".`, `Model ${id}: component_type is missing; using "${id}".`)
    }
    const model: SizingModelDef = {
      id,
      nameVi: nameVi || nameEn || id,
      nameEn: nameEn || nameVi || id,
      componentType,
      description: get('description') || undefined,
      formulaMode: modeText === 'units' ? 'units' : 'excel',
      inputs: [],
      params: [],
      calc: [],
      outputs: [],
      warnings: [],
      lookups: [],
      tests: [],
    }
    models.push(model)
    modelById.set(id, model)
  }
  if (models.length === 0 && !issues.some((i) => i.severity === 'error')) err(SHEET.model, 'Không có model nào.', 'No models found.')
  if (models.length > LIMITS.maxModels) err(SHEET.model, `Tối đa ${LIMITS.maxModels} model.`, `At most ${LIMITS.maxModels} models.`)
  if (issues.some((i) => i.severity === 'error')) return { pack: null, preview: null, issues }

  const owners = new Map<string, Owner>()
  /** modelId -> lower-case name -> exact name (inputs, params and calc share one namespace). */
  const namesByModel = new Map<string, Map<string, string>>(models.map((m) => [m.id, new Map()]))

  /** Read the data rows of a model-linked sheet. */
  const eachRow = (sheetName: string, fn: (r: number, get: (col: string) => string, col: (name: string) => number | undefined, ws: ExcelJS.Worksheet, model: SizingModelDef) => void) => {
    const ws = findSheet(wb, sheetName)
    if (!ws) return
    const header = findHeader(ws)
    if (!header) {
      err(sheetName, `Sheet ${sheetName} thiếu dòng tiêu đề có cột model_id.`, `Sheet ${sheetName} has no header row with a model_id column.`)
      return
    }
    const col = (name: string) => header.cols.get(name)
    for (let r = header.row + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r)
      let empty = true
      for (const c of header.cols.values()) {
        if (cellText(row.getCell(c)) !== '' || isFormulaCell(row.getCell(c))) {
          empty = false
          break
        }
      }
      if (empty) continue
      const get = (name: string) => (col(name) ? cellText(row.getCell(col(name)!)) : '')
      const id = get('model_id')
      const model = modelById.get(id) ?? models.find((m) => m.id.toLowerCase() === id.toLowerCase())
      if (!model) {
        err(at(ws.name, r, col('model_id')!), `model_id "${id}" không có trong sheet Model.`, `model_id "${id}" is not on the Model sheet.`)
        continue
      }
      fn(r, get, col, ws, model)
    }
  }

  const checkName = (model: SizingModelDef, name: string, where: string, register: boolean): boolean => {
    if (!IDENT_RE.test(name)) {
      err(where, `Tên "${name}" không hợp lệ (chữ, số, _; không bắt đầu bằng số).`, `Invalid name "${name}" (letters, digits, _; not starting with a digit).`)
      return false
    }
    if (RESERVED_IDENTS.has(name.toLowerCase())) {
      err(where, `Tên "${name}" trùng từ khóa/hàm của DSL.`, `Name "${name}" is a DSL keyword or function.`)
      return false
    }
    if (register) {
      const names = namesByModel.get(model.id)!
      if (names.has(name.toLowerCase())) {
        err(where, `Model ${model.id}: tên "${name}" bị trùng (Inputs/Params/Calc dùng chung tên).`, `Model ${model.id}: duplicate name "${name}" (Inputs/Params/Calc share one namespace).`)
        return false
      }
      names.set(name.toLowerCase(), name)
    }
    return true
  }

  const optionalNumber = (ws: ExcelJS.Worksheet, r: number, c: number | undefined, field: string): number | undefined => {
    if (!c) return undefined
    const n = cellNumber(ws.getCell(r, c))
    if (!n.ok) {
      issues.push(NOT_A_NUMBER(ws.name, r, c, field))
      return undefined
    }
    return n.value ?? undefined
  }

  const requiredNumber = (ws: ExcelJS.Worksheet, r: number, c: number | undefined, field: string): number | null => {
    if (!c) {
      err(ws.name, `Sheet ${ws.name} thiếu cột ${field}.`, `Sheet ${ws.name} is missing the ${field} column.`)
      return null
    }
    const n = cellNumber(ws.getCell(r, c))
    if (!n.ok || n.value === null) {
      issues.push(NOT_A_NUMBER(ws.name, r, c, field))
      return null
    }
    if (n.fromFormula) warn(at(ws.name, r, c), `${field} là công thức; dùng giá trị đã tính sẵn ${n.value}.`, `${field} is a formula; using its cached value ${n.value}.`)
    return n.value
  }

  // ---- Inputs / Params ----------------------------------------------------
  eachRow(SHEET.inputs, (r, get, col, ws, model) => {
    const name = get('name')
    if (!checkName(model, name, at(ws.name, r, col('name') ?? 2), true)) return
    const value = requiredNumber(ws, r, col('value') ?? col('default'), 'value')
    if (value === null) return
    const input: RuleInput = {
      name,
      labelVi: get('label_vi') || get('label_en') || name,
      labelEn: get('label_en') || get('label_vi') || name,
      unit: get('unit'),
      default: value,
    }
    const min = optionalNumber(ws, r, col('min'), 'min')
    const max = optionalNumber(ws, r, col('max'), 'max')
    if (min !== undefined) input.min = min
    if (max !== undefined) input.max = max
    if (get('source') !== '') input.source = get('source')
    model.inputs.push(input)
    owners.set(ownerKey(ws.name, r, (col('value') ?? col('default'))!), { modelId: model.id, name })
  })

  eachRow(SHEET.params, (r, get, col, ws, model) => {
    const name = get('name')
    if (!checkName(model, name, at(ws.name, r, col('name') ?? 2), true)) return
    const valueText = get('value')
    if (/^catalog:/i.test(valueText)) {
      err(at(ws.name, r, col('value')!), 'Giá trị catalog: chưa được hỗ trợ trong pilot; hãy nhập số.', 'catalog: values are not supported in the pilot; enter a number.')
      return
    }
    const value = requiredNumber(ws, r, col('value'), 'value')
    if (value === null) return
    const param: RuleParam = { name, value, unit: get('unit') }
    if (get('source') !== '') param.source = get('source')
    model.params.push(param)
    owners.set(ownerKey(ws.name, r, col('value')!), { modelId: model.id, name })
  })

  // ---- Calc (collect first; translate once every name is known) ----------
  interface PendingCalc {
    model: SizingModelDef
    name: string
    unit: string
    description: string
    cell: ExcelJS.Cell
    where: string
    dslText: string
    row: number
  }
  const pendingCalc: PendingCalc[] = []
  const calcSheet = findSheet(wb, SHEET.calc)!
  eachRow(SHEET.calc, (r, get, col, ws, model) => {
    const name = get('name')
    if (!checkName(model, name, at(ws.name, r, col('name') ?? 2), true)) return
    const fc = col('formula')
    if (!fc) {
      err(ws.name, 'Sheet Calc thiếu cột formula.', 'Sheet Calc is missing the formula column.')
      return
    }
    pendingCalc.push({ model, name, unit: get('unit'), description: get('description'), cell: ws.getCell(r, fc), where: at(ws.name, r, fc), dslText: get('dsl_formula'), row: r })
    owners.set(ownerKey(ws.name, r, fc), { modelId: model.id, name })
  })

  // ---- Lookups --------------------------------------------------------------
  const tables: LookupTableArea[] = []
  const wsLook = findSheet(wb, SHEET.lookups)
  if (wsLook) {
    let r = 1
    while (r <= wsLook.rowCount) {
      if (cellText(wsLook.getCell(r, 1)).toLowerCase() !== LOOKUP_TABLE_MARKER) {
        r++
        continue
      }
      const name = cellText(wsLook.getCell(r, 2))
      const where = at(wsLook.name, r, 2)
      const headerRow = r + 1
      const columns: string[] = []
      for (let c = 1; c <= 200; c++) {
        const t = cellText(wsLook.getCell(headerRow, c))
        if (t === '') break
        columns.push(t)
      }
      const rows: (string | number)[][] = []
      let rr = headerRow + 1
      for (; rr <= wsLook.rowCount; rr++) {
        const first = cellText(wsLook.getCell(rr, 1))
        if (first.toLowerCase() === LOOKUP_TABLE_MARKER) break
        const cells = columns.map((_, ci) => wsLook.getCell(rr, ci + 1))
        if (cells.every((c) => cellText(c) === '')) break
        rows.push(cells.map((c) => {
          const n = cellNumber(c)
          return n.ok && n.value !== null ? n.value : cellText(c)
        }))
      }
      if (!IDENT_RE.test(name) || RESERVED_IDENTS.has(name.toLowerCase())) err(where, `Tên bảng "${name}" không hợp lệ.`, `Invalid table name "${name}".`)
      else if (columns.length < 2) err(at(wsLook.name, headerRow, 1), `Bảng ${name} cần ít nhất 2 cột (khóa và giá trị).`, `Table ${name} needs at least 2 columns (key and value).`)
      else if (rows.length === 0) err(at(wsLook.name, headerRow, 1), `Bảng ${name} không có dữ liệu.`, `Table ${name} has no data rows.`)
      else if (tables.some((t) => t.table.name.toLowerCase() === name.toLowerCase())) err(where, `Bảng "${name}" bị trùng.`, `Duplicate table "${name}".`)
      else {
        tables.push({ table: { name, columns, rows }, sheet: wsLook.name, headerRow, top: headerRow + 1, bottom: headerRow + rows.length, left: 1, right: columns.length })
      }
      r = rr
    }
  }

  // ---- Defined names --------------------------------------------------------
  const definedNames = new Map<string, Area[]>()
  for (const dn of wb.definedNames.model as { name: string; ranges: string[] }[]) {
    if (dn.name.startsWith('_xlnm.')) continue
    const areas = dn.ranges.map((t) => parseArea(t, '')).filter((a): a is Area => a !== null)
    if (areas.length > 0) definedNames.set(dn.name.toLowerCase(), areas)
  }

  const classifyTable = (a: Area): Resolved | null => {
    for (const t of tables) {
      if (t.sheet.toLowerCase() !== a.sheet.toLowerCase()) continue
      const rowsMatch = (a.top === t.top || a.top === t.headerRow) && a.bottom === t.bottom
      if (!rowsMatch) continue
      if (a.left === t.left && a.right === t.right && t.right > t.left) return { kind: 'table', table: t.table.name, columns: t.table.columns }
      if (a.left === a.right && a.left >= t.left && a.left <= t.right) return { kind: 'column', table: t.table.name, columns: t.table.columns, index: a.left - t.left }
    }
    return null
  }

  const envFor = (model: SizingModelDef, currentSheet: string): TranslateEnv => ({
    resolveName(name: string): Resolved {
      const areas = definedNames.get(name.toLowerCase())
      if (areas) {
        if (areas.length !== 1) return { kind: 'error', message: msg(`Defined name "${name}" có nhiều vùng.`, `Defined name "${name}" has several areas.`) }
        const a = areas[0]
        if (a.top === a.bottom && a.left === a.right) {
          const o = owners.get(ownerKey(a.sheet, a.top, a.left))
          if (o) {
            if (o.modelId !== model.id) {
              return { kind: 'error', message: msg(`"${name}" thuộc model ${o.modelId}; không tham chiếu chéo model.`, `"${name}" belongs to model ${o.modelId}; cross-model references are not supported.`) }
            }
            return { kind: 'value', ident: o.name }
          }
        }
        const t = classifyTable(a)
        if (t) return t
        return {
          kind: 'error',
          message: msg(
            `Defined name "${name}" trỏ tới ${at(a.sheet, a.top, a.left)}, không phải ô value của Inputs/Params, ô formula của Calc hay bảng Lookups.`,
            `Defined name "${name}" points to ${at(a.sheet, a.top, a.left)}, which is not an Inputs/Params value cell, a Calc formula cell or a Lookups table.`,
          ),
        }
      }
      const names = namesByModel.get(model.id)!
      const lower = name.toLowerCase()
      const prefix = `${excelModelPrefix(model.id).toLowerCase()}_`
      const local = names.get(lower) ?? (lower.startsWith(prefix) ? names.get(lower.slice(prefix.length)) : undefined)
      if (local) {
        return {
          kind: 'value',
          ident: local,
          warning: msg(`"${name}" chưa có defined name trong workbook; Excel sẽ hiện #NAME?.`, `"${name}" is not a defined name in the workbook; Excel shows #NAME?.`),
        }
      }
      const dot = lower.indexOf('.')
      const tableName = dot > 0 ? lower.slice(0, dot) : lower
      const table = tables.find((t) => t.table.name.toLowerCase() === tableName)
      if (table) {
        if (dot < 0) return { kind: 'table', table: table.table.name, columns: table.table.columns }
        const index = table.table.columns.findIndex((c) => c.toLowerCase() === lower.slice(dot + 1))
        if (index >= 0) return { kind: 'column', table: table.table.name, columns: table.table.columns, index }
      }
      return { kind: 'error', message: msg(`Không tìm thấy tên "${name}" (không phải defined name hay biến của model ${model.id}).`, `Unknown name "${name}" (not a defined name nor a variable of model ${model.id}).`) }
    },
    describeRef(refText: string): Msg | null {
      const a = parseArea(refText, currentSheet)
      const o = a && a.top === a.bottom && a.left === a.right ? owners.get(ownerKey(a.sheet, a.top, a.left)) : undefined
      if (!o) return null
      return msg(`Tham chiếu ô "${refText}" không được hỗ trợ; hãy dùng tên "${o.name}".`, `Cell reference "${refText}" is not supported; use the name "${o.name}".`)
    },
  })

  // ---- Translate Calc -------------------------------------------------------
  const preview = new Map<string, ModelPreview>(models.map((m) => [m.id, { model: m, calcRows: [], warningRows: [], autoTestIds: [] }]))
  const deps = new Map<string, Set<string>>() // `${modelId}|${calc}` -> calc/inputs it uses
  const usedTables = new Map<string, Set<string>>(models.map((m) => [m.id, new Set()]))
  const cachedByModel = new Map<string, Map<string, number>>(models.map((m) => [m.id, new Map()]))

  for (const p of pendingCalc) {
    const row: CalcPreviewRow = { name: p.name, where: p.where, excelFormula: null, dsl: null, cached: null, cachedText: null, unit: p.unit, failed: false }
    preview.get(p.model.id)!.calcRows.push(row)
    const value = p.cell.value as unknown
    const isFormula = isFormulaCell(p.cell)
    if (isFormula) {
      const res = (value as { result?: unknown }).result
      if (typeof res === 'number' && Number.isFinite(res)) {
        row.cached = res
        cachedByModel.get(p.model.id)!.set(p.name, res)
      } else if (res !== undefined && res !== null) {
        row.cachedText = typeof res === 'object' ? String((res as { error?: string }).error ?? 'error') : String(res)
      }
    }
    let formulaText: string | null = null
    if (p.model.formulaMode === 'units') {
      if (p.dslText === '') {
        err(p.where, `Bước ${p.name}: model dạng units cần dsl_formula.`, `Step ${p.name}: a units-mode model needs dsl_formula.`)
        row.failed = true
        continue
      }
      row.dsl = p.dslText
      p.model.calc.push({ name: p.name, formula: p.dslText, unit: p.unit, ...(p.description ? { description: p.description } : {}) })
      continue
    }
    if (isFormula) {
      if ((value as { shareType?: string }).shareType === 'array') {
        err(p.where, 'Công thức mảng (array formula) không được hỗ trợ.', 'Array formulas are not supported.')
        row.failed = true
        continue
      }
      formulaText = p.cell.formula
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      formulaText = formatNumber(value)
      row.cached = value
      cachedByModel.get(p.model.id)!.set(p.name, value)
    } else {
      const text = cellText(p.cell)
      if (text.startsWith('=')) {
        formulaText = text
        warn(p.where, `Bước ${p.name}: công thức được lưu dạng chữ nên Excel không tính.`, `Step ${p.name}: the formula is stored as text, so Excel does not compute it.`)
      } else if (text === '' && p.dslText !== '') {
        row.dsl = p.dslText
        p.model.calc.push({ name: p.name, formula: p.dslText, unit: p.unit, ...(p.description ? { description: p.description } : {}) })
        warn(p.where, `Bước ${p.name}: không có công thức Excel, dùng dsl_formula.`, `Step ${p.name}: no Excel formula; using dsl_formula.`)
        continue
      } else {
        err(p.where, `Bước ${p.name}: ô formula phải chứa công thức Excel.`, `Step ${p.name}: the formula cell must contain an Excel formula.`)
        row.failed = true
        continue
      }
    }
    row.excelFormula = displayExcelFormula(formulaText)
    const tr = translateExcelFormula(formulaText, envFor(p.model, calcSheet.name))
    if (!tr.ok) {
      issues.push(issueError(p.where, tr.error))
      row.failed = true
      continue
    }
    row.dsl = tr.dsl
    tr.warnings.forEach((w) => issues.push(issueWarning(p.where, w)))
    tr.tables.forEach((t) => usedTables.get(p.model.id)!.add(t))
    deps.set(`${p.model.id}|${p.name}`, new Set(tr.idents))
    // Store the Excel text with canonical names (kafka_rf -> rf); the exporter re-applies its own naming.
    const env = envFor(p.model, calcSheet.name)
    const canonical = rewriteExcelFormula(formulaText, (name) => {
      const r = env.resolveName(name, null)
      if (r.kind === 'value') return r.ident
      if (r.kind === 'table') return r.table
      if (r.kind === 'column') return excelSafeName(`${r.table}.${r.columns[r.index]}`)
      return null
    })
    const excelFormula = displayExcelFormula(canonical.formula)
    p.model.calc.push({ name: p.name, formula: tr.dsl, unit: p.unit, ...(p.description ? { description: p.description } : {}), excelFormula })
  }

  // Dependency order (Excel does not care about row order; the rule engine may).
  for (const model of models) {
    const calcNames = new Set(model.calc.map((c) => c.name))
    const done = new Set<string>()
    const ordered: typeof model.calc = []
    const remaining = [...model.calc]
    while (remaining.length > 0) {
      const idx = remaining.findIndex((c) => [...(deps.get(`${model.id}|${c.name}`) ?? [])].every((d) => !calcNames.has(d) || done.has(d)))
      if (idx < 0) {
        err(SHEET.calc, `Model ${model.id}: vòng lặp tham chiếu giữa các bước ${remaining.map((c) => c.name).join(', ')}.`, `Model ${model.id}: circular reference between steps ${remaining.map((c) => c.name).join(', ')}.`)
        break
      }
      const [step] = remaining.splice(idx, 1)
      done.add(step.name)
      ordered.push(step)
    }
    if (ordered.length === model.calc.length && ordered.some((c, i) => c !== model.calc[i])) {
      warn(SHEET.calc, `Model ${model.id}: các bước Calc được sắp lại theo thứ tự phụ thuộc.`, `Model ${model.id}: Calc steps were reordered to dependency order.`)
      model.calc = ordered
    }
  }

  // ---- Outputs ----------------------------------------------------------------
  eachRow(SHEET.outputs, (r, get, col, ws, model) => {
    const name = get('name')
    const where = at(ws.name, r, col('name') ?? 2)
    if (!checkName(model, name, where, false)) return
    if (model.outputs.some((o) => o.name.toLowerCase() === name.toLowerCase())) {
      err(where, `Model ${model.id}: output "${name}" bị trùng.`, `Model ${model.id}: duplicate output "${name}".`)
      return
    }
    const fromText = get('from_calc') || name
    const from = namesByModel.get(model.id)!.get(fromText.toLowerCase())
    const fromWhere = at(ws.name, r, col('from_calc') ?? 3)
    if (!from || model.params.some((p) => p.name === from)) {
      err(fromWhere, `from_calc "${fromText}" không phải bước Calc hay input của model ${model.id}.`, `from_calc "${fromText}" is not a Calc step or input of model ${model.id}.`)
      return
    }
    const roundingText = get('rounding').toLowerCase()
    if (roundingText !== '' && !(ROUNDINGS as readonly string[]).includes(roundingText)) {
      err(at(ws.name, r, col('rounding') ?? 5), 'rounding phải là none, ceil, floor hoặc round.', 'rounding must be none, ceil, floor or round.')
      return
    }
    const calc = model.calc.find((c) => c.name === from)
    const input = model.inputs.find((i) => i.name === from)
    const out: RuleOutput = { name, from, unit: get('unit') || calc?.unit || input?.unit || '' }
    if (roundingText !== '') out.rounding = roundingText as RuleRounding
    if (get('label_vi') !== '') out.labelVi = get('label_vi')
    if (get('label_en') !== '') out.labelEn = get('label_en')
    model.outputs.push(out)
  })

  // ---- Warnings ---------------------------------------------------------------
  const warnSheet = findSheet(wb, SHEET.warnings)
  eachRow(SHEET.warnings, (r, get, col, ws, model) => {
    const cc = col('condition')
    const where = at(ws.name, r, cc ?? 2)
    const conditionCell = cc ? ws.getCell(r, cc) : null
    const excelText = conditionCell ? (isFormulaCell(conditionCell) ? `=${conditionCell.formula}` : cellText(conditionCell)) : ''
    const dslText = get('dsl_condition')
    const severityText = get('severity').toLowerCase() || 'medium'
    const row: WarningPreviewRow = { where, condition: excelText || dslText, dsl: null, severity: severityText, failed: false }
    preview.get(model.id)!.warningRows.push(row)
    if (!(SEVERITIES as readonly string[]).includes(severityText)) {
      err(at(ws.name, r, col('severity') ?? 3), 'severity phải là info, low, medium hoặc high.', 'severity must be info, low, medium or high.')
      row.failed = true
      return
    }
    let dsl: string
    if (model.formulaMode === 'excel' && excelText !== '') {
      const tr = translateExcelFormula(excelText, envFor(model, warnSheet?.name ?? SHEET.warnings))
      if (!tr.ok) {
        issues.push(issueError(where, tr.error))
        row.failed = true
        return
      }
      tr.warnings.forEach((w) => issues.push(issueWarning(where, w)))
      tr.tables.forEach((t) => usedTables.get(model.id)!.add(t))
      dsl = tr.dsl
    } else if (dslText !== '') {
      dsl = dslText
    } else {
      err(where, 'Thiếu condition.', 'Missing condition.')
      row.failed = true
      return
    }
    row.dsl = dsl
    const messageVi = get('message_vi') || get('message_en')
    const messageEn = get('message_en') || get('message_vi')
    if (messageVi === '') {
      err(at(ws.name, r, col('message_vi') ?? 4), 'Thiếu message_vi/message_en.', 'Missing message_vi/message_en.')
      row.failed = true
      return
    }
    const warning: RuleWarning = { condition: dsl, severity: severityText as RuleSeverity, messageVi, messageEn }
    model.warnings.push(warning)
  })

  // Attach the lookup tables each model uses.
  for (const model of models) {
    model.lookups = tables.filter((t) => usedTables.get(model.id)!.has(t.table.name)).map((t) => t.table)
  }

  // ---- Tests --------------------------------------------------------------------
  const testRowsByModel = new Map<string, number>()
  eachRow(SHEET.tests, (r, get, col, ws, model) => {
    testRowsByModel.set(model.id, (testRowsByModel.get(model.id) ?? 0) + 1)
    const header = findHeader(ws)!
    const idCol = col('test_id')
    const id = get('test_id') || `row${r}`
    const where = at(ws.name, r, idCol ?? 2)
    if (model.tests.some((t) => t.id === id)) {
      err(where, `Model ${model.id}: test_id "${id}" bị trùng.`, `Model ${model.id}: duplicate test_id "${id}".`)
      return
    }
    const test: RuleTest = { id, inputs: {}, expected: {}, tolerance: DEFAULT_TEST_TOLERANCE }
    let ok = true
    for (const [h, c] of header.cols) {
      const isIn = h.startsWith('in:')
      const isOut = h.startsWith('out:')
      if (!isIn && !isOut) continue
      const n = cellNumber(ws.getCell(r, c))
      if (!n.ok) {
        issues.push(NOT_A_NUMBER(ws.name, r, c, h))
        ok = false
        continue
      }
      if (n.value === null) continue
      const key = h.slice(isIn ? 3 : 4).trim()
      if (isIn) {
        const input = model.inputs.find((i) => i.name.toLowerCase() === key)
        if (!input) {
          err(at(ws.name, r, c), `Model ${model.id} không có input "${key}".`, `Model ${model.id} has no input "${key}".`)
          ok = false
          continue
        }
        test.inputs[input.name] = n.value
      } else {
        const out = model.outputs.find((o) => o.name.toLowerCase() === key)
        if (!out) {
          err(at(ws.name, r, c), `Model ${model.id} không có output "${key}".`, `Model ${model.id} has no output "${key}".`)
          ok = false
          continue
        }
        test.expected[out.name] = n.value
      }
    }
    const tolCol = col('tolerance')
    if (tolCol) {
      const t = cellNumber(ws.getCell(r, tolCol))
      if (!t.ok || (t.value !== null && t.value < 0)) {
        err(at(ws.name, r, tolCol), 'tolerance phải là số >= 0.', 'tolerance must be a number >= 0.')
        ok = false
      } else if (t.value !== null) test.tolerance = t.value
    }
    if (ok && Object.keys(test.expected).length === 0) {
      err(where, `Test "${id}" không có cột out: nào có giá trị.`, `Test "${id}" has no out: value.`)
      ok = false
    }
    if (ok) model.tests.push(test)
  })

  // Auto "cached" test for models without test rows (05 §5 mode B).
  for (const model of models) {
    if ((testRowsByModel.get(model.id) ?? 0) > 0) continue
    const cached = cachedByModel.get(model.id)!
    const expected: Record<string, number> = {}
    for (const o of model.outputs) {
      const input = model.inputs.find((i) => i.name === o.from)
      let v = input ? input.default : cached.get(o.from)
      if (v === undefined) {
        warn(SHEET.calc, `Model ${model.id}: bước ${o.from} không có kết quả Excel đã lưu; test "cached" bỏ qua output ${o.name}. Hãy mở bằng Excel, tính lại (F9), lưu rồi import lại.`, `Model ${model.id}: step ${o.from} has no saved Excel result; the "cached" test skips output ${o.name}. Open the file in Excel, recalculate (F9), save and import again.`)
        continue
      }
      if (o.rounding === 'ceil') v = Math.ceil(v)
      else if (o.rounding === 'floor') v = Math.floor(v)
      else if (o.rounding === 'round') v = Math.round(v)
      expected[o.name] = v
    }
    if (Object.keys(expected).length === 0) {
      warn(
        SHEET.tests,
        `Model ${model.id}: chưa có test và không có kết quả Excel đã lưu để tự tạo test; chỉ lưu được dạng draft. Hãy mở bằng Excel, tính lại (F9), lưu rồi import lại.`,
        `Model ${model.id}: no tests and no saved Excel results to build one from; it can only be saved as draft. Open the file in Excel, recalculate (F9), save and import again.`,
      )
      continue
    }
    model.tests.push({
      id: 'cached',
      inputs: Object.fromEntries(model.inputs.map((i) => [i.name, i.default])),
      expected,
      tolerance: CACHED_TEST_TOLERANCE,
    })
    preview.get(model.id)!.autoTestIds.push('cached')
  }

  for (const model of models) {
    if (model.outputs.length === 0) err(SHEET.outputs, `Model ${model.id} không có output.`, `Model ${model.id} has no outputs.`)
    if (model.calc.length === 0 && !issues.some((i) => i.severity === 'error' && i.where.startsWith(SHEET.calc))) {
      err(SHEET.calc, `Model ${model.id} không có bước Calc.`, `Model ${model.id} has no Calc steps.`)
    }
  }

  const previewResult: ImportPreview = { packName, description, version, models: models.map((m) => preview.get(m.id)!) }
  const hasError = issues.some((i) => i.severity === 'error')
  const pack: ImportedPackDraft | null = hasError
    ? null
    : { name: packName, description: description || null, version, status: 'draft', models }
  return { pack, preview: previewResult, issues }
}

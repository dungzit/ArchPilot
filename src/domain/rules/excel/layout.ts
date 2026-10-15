/**
 * Workbook layout shared by the template generator, exporter and importer
 * (WP-A2, docs/v3/05 §4). One workbook = one RulePack; every data row is tied
 * to a model by its `model_id` column.
 *
 * Defined-name rule (documented in the HuongDan sheet):
 *   - Each input/param value cell and each calc formula cell gets a
 *     workbook-scoped defined name, so Excel computes the Calc formulas.
 *   - The name is the row's `name`, e.g. `ingress`.
 *   - When two or more models in the workbook use the same name, each copy is
 *     prefixed with its model id: `<model_id>_<name>`, e.g. `kafka_ingress`.
 *   - A name Excel would read as a cell (rf1, R2C3, c) is prefixed with "_".
 *   - Lookup tables: `<table>` names the data rows (header excluded) and
 *     `<table>.<column>` names one data column.
 * The importer does not rely on this convention: it follows each defined name
 * to its cell and takes the identifier from that row's `name` column.
 */
import { isA1Cell, isR1C1Like } from './excelFormula'

export const SHEET = {
  guide: 'HuongDan',
  model: 'Model',
  inputs: 'Inputs',
  params: 'Params',
  calc: 'Calc',
  outputs: 'Outputs',
  warnings: 'Warnings',
  lookups: 'Lookups',
  tests: 'Tests',
} as const

export const COLUMNS = {
  model: ['model_id', 'name_vi', 'name_en', 'component_type', 'formula_mode', 'description'],
  inputs: ['model_id', 'name', 'label_vi', 'label_en', 'unit', 'value', 'min', 'max', 'source'],
  params: ['model_id', 'name', 'value', 'unit', 'source'],
  calc: ['model_id', 'name', 'formula', 'unit', 'description', 'dsl_formula'],
  outputs: ['model_id', 'name', 'from_calc', 'unit', 'rounding', 'label_vi', 'label_en'],
  warnings: ['model_id', 'condition', 'severity', 'message_vi', 'message_en', 'dsl_condition'],
} as const

/** Keys of the pack header block above the Model table. */
export const PACK_KEYS = { name: 'pack_name', description: 'pack_description', version: 'pack_version' } as const

/** Lookups sheet: a row whose first cell is this marker starts a table; its second cell is the table name. */
export const LOOKUP_TABLE_MARKER = 'table'

export const LIMITS = {
  maxFileBytes: 5 * 1024 * 1024,
  maxRowsPerSheet: 2000,
  maxModels: 50,
  /** Zip-bomb guard: total declared uncompressed size of the package. */
  maxUncompressedBytes: 60 * 1024 * 1024,
  /** exceljs expands every defined-name range into cells; cap it. */
  maxDefinedNameCells: 100_000,
} as const

export const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
export const MODEL_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/

/** DSL keywords and function names that cannot be used as identifiers. */
export const RESERVED_IDENTS = new Set([
  'and', 'or', 'not', 'if', 'ceil', 'floor', 'round', 'roundup_to', 'min', 'max', 'sum', 'avg', 'abs',
  'lookup', 'convert', 'catalog', 'switch', 'true', 'false',
])

export const SEVERITIES = ['info', 'low', 'medium', 'high'] as const
export const ROUNDINGS = ['none', 'ceil', 'floor', 'round'] as const

/** Model id as used inside an Excel name: letters, digits and "_" only. */
export function excelModelPrefix(modelId: string): string {
  return modelId.replace(/[^A-Za-z0-9_]/g, '_')
}

/** Make a candidate name acceptable to Excel's defined-name rules. */
export function excelSafeName(name: string): string {
  let n = name.replace(/[^A-Za-z0-9_.\\]/g, '_')
  if (!/^[A-Za-z_\\]/.test(n)) n = `_${n}`
  const upper = n.toUpperCase()
  if (isA1Cell(n) || isR1C1Like(n) || upper === 'TRUE' || upper === 'FALSE') n = `_${n}`
  return n.slice(0, 255)
}

const INJECTION_START = /^[=+\-@\t\r]/

/**
 * Formula-injection guard for text cells: a value that starts with = + - @
 * gets a leading apostrophe so no spreadsheet tool runs it as a formula.
 * exceljs cannot set Excel's hidden quotePrefix flag, so the apostrophe is
 * visible; the importer strips it again (unguardText).
 */
export function guardText(value: string): string {
  return INJECTION_START.test(value) ? `'${value}` : value
}

export function unguardText(value: string): string {
  return value.startsWith("'") && INJECTION_START.test(value.slice(1)) ? value.slice(1) : value
}

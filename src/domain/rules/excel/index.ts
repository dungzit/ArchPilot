/**
 * WP-A2 Excel import/export (docs/v3/05 §4-5). This barrel pulls in exceljs
 * (~1 MB), so UI code loads it with a dynamic import().
 */
export { buildTemplateWorkbook, KAFKA_TEMPLATE_MODEL, KAFKA_TEMPLATE_PACK, KAFKA_TEMPLATE_RESULTS, TEMPLATE_FILE_NAME } from './template'
export { exportRulePackToXlsx, safeFileName, type ExportOptions, type ExportResult, type PackForExcel } from './exporter'
export {
  importRulePackXlsx,
  CACHED_TEST_TOLERANCE,
  type CalcPreviewRow,
  type ImportPreview,
  type ImportResult,
  type ImportedPackDraft,
  type ModelPreview,
  type WarningPreviewRow,
} from './importer'
export { translateExcelFormula, SUPPORTED_EXCEL_FUNCTIONS, type Resolved, type TranslateEnv, type TranslateResult } from './translate'
export { dslToExcel } from './dslToExcel'
export { LIMITS, SHEET } from './layout'
export type { ExcelIssue, Msg } from './messages'

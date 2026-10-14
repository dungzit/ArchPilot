import type { RulePack } from '../../../contracts/pilot'
import { copy, type TextFn } from '../../../ui/copy'

/**
 * Pilot WP-A2: Excel template download, rule import and export (docs/v3/05 §4-5).
 * Placeholder wired by the lead; RulesScreen (WP-A) renders it in a tab.
 */
export function ExcelPanel({ text }: { text: TextFn; language: 'vi' | 'en'; onImported?: (pack: RulePack) => void }) {
  return <section className="panel" data-panel="rules-excel">{text(copy('Import/Export Excel: đang xây dựng.', 'Excel import/export: being built.'))}</section>
}

import type { RulePack } from '../../../contracts/pilot'
import { copy, type TextFn } from '../../../ui/copy'

/**
 * Pilot WP-A2: create or edit a rule pack in the browser (docs/v3/05 §6).
 * Placeholder wired by the lead; RulesScreen (WP-A) renders it in a tab.
 */
export function RuleEditorPanel({ text }: { text: TextFn; language: 'vi' | 'en'; initial?: RulePack | null; onSaved?: (pack: RulePack) => void }) {
  return <section className="panel" data-panel="rules-editor">{text(copy('Trình soạn rule: đang xây dựng.', 'Rule editor: being built.'))}</section>
}

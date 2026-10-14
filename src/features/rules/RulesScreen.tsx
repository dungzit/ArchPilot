import { copy, type TextFn } from '../../ui/copy'
import { PageHeader } from '../../ui/PageHeader'

/**
 * Pilot WP-A: Sizing Studio rule packs, rule evaluation and Excel import
 * (docs/v3/05). Placeholder wired by the lead.
 */
export function RulesScreen({ text }: { text: TextFn; language: 'vi' | 'en' }) {
  return (
    <div className="page-content" data-studio="rules">
      <PageHeader
        eyebrow="SIZING STUDIO"
        title={text(copy('Sizing theo rule', 'Rule-based sizing'))}
        description={text(copy('Chạy rule pack, xem công thức từng bước, import rule từ Excel.', 'Run rule packs, see every step of the formula, import rules from Excel.'))}
        text={text}
        action={<span />}
      />
    </div>
  )
}

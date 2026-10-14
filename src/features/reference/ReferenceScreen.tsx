import { copy, type TextFn } from '../../ui/copy'
import { PageHeader } from '../../ui/PageHeader'

/**
 * Pilot WP-B: SysDesAi reference search (docs/v3/03). Placeholder wired by the
 * lead so routing and navigation exist before the feature lands.
 */
export function ReferenceScreen({ text }: { text: TextFn; language: 'vi' | 'en' }) {
  return (
    <div className="page-content" data-studio="reference">
      <PageHeader
        eyebrow="REFERENCE"
        title={text(copy('Tra cứu tham chiếu SysDesAi', 'SysDesAi reference search'))}
        description={text(copy('Tìm thiết kế tham chiếu theo từ khóa, trả về link và bước cụ thể.', 'Find reference designs by keyword, with links to the matching steps.'))}
        text={text}
        action={<span />}
      />
    </div>
  )
}

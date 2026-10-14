import { copy, type TextFn } from '../../ui/copy'
import { PageHeader } from '../../ui/PageHeader'

/**
 * Pilot WP-C: HLD DOCX export from a design, its sizing runs and reference
 * pins (docs/v3/06). Placeholder wired by the lead.
 */
export function HldScreen({ text }: { text: TextFn; language: 'vi' | 'en' }) {
  return (
    <div className="page-content" data-studio="hld">
      <PageHeader
        eyebrow="HLD EXPORT"
        title={text(copy('Xuất tài liệu HLD', 'HLD export'))}
        description={text(copy('Sinh HLD dạng DOCX từ thiết kế, kết quả sizing và tham chiếu.', 'Generate a DOCX HLD from a design, its sizing runs and references.'))}
        text={text}
        action={<span />}
      />
    </div>
  )
}

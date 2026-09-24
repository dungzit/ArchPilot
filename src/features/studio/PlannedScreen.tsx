import { Construction } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { copy, type TextFn } from '../../ui/copy'
import { PageHeader } from '../../ui/PageHeader'
import type { StudioItem } from '../../app/navigation'

/**
 * A Studio route whose screen is not built yet (task 0.5). The route, the
 * sidebar entry and the deep link work today, so bookmarks, "Open in canvas"
 * links and the SPA fallback can be tested end to end before the feature
 * lands. Route params are shown as text (React escapes them).
 */
export function PlannedScreen({ item, text }: { item: StudioItem; text: TextFn }) {
  const params = useParams()
  const detail = Object.entries(params)
    .filter(([key, value]) => key !== '*' && value)
    .map(([key, value]) => `${key}: ${value}`)
  return (
    <div className="page-content planned-screen" data-studio={item.key}>
      <PageHeader
        eyebrow={item.eyebrow}
        title={text(item.label)}
        description={text(item.purpose)}
        text={text}
        action={<Link className="secondary-button" to="/">{text(copy('Về trang chủ', 'Back to home'))}</Link>}
      />
      <section className="panel planned-panel" role="status">
        <Construction size={20} aria-hidden="true" />
        <div>
          <strong>{text(copy('Màn hình này đang được xây dựng', 'This screen is being built'))}</strong>
          <p>
            {text(copy('Kế hoạch: giai đoạn ', 'Planned in phase '))}
            {item.phase}
            {text(copy(' của design-v2 (mục 5.2). Liên kết này đã hoạt động và sẽ mở đúng màn hình khi hoàn tất.', ' of design-v2 (section 5.2). This link already works and will open the real screen when it ships.'))}
          </p>
          {detail.length > 0 && <p className="planned-params"><code>{detail.join(' · ')}</code></p>}
        </div>
      </section>
    </div>
  )
}

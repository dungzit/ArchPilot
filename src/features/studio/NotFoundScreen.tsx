import { SearchX } from 'lucide-react'
import { Link, useLocation } from 'react-router'
import { copy, type TextFn } from '../../ui/copy'
import { PageHeader } from '../../ui/PageHeader'

/** Any path the router does not know (task 0.5). The server already returned index.html for it. */
export function NotFoundScreen({ text }: { text: TextFn }) {
  const { pathname } = useLocation()
  return (
    <div className="page-content not-found-screen">
      <PageHeader
        eyebrow="404"
        title={text(copy('Không tìm thấy trang', 'Page not found'))}
        description={text(copy('Đường dẫn này không có trong ArchPilot.', 'This address is not part of ArchPilot.'))}
        text={text}
        action={<Link className="primary-button" to="/">{text(copy('Về trang chủ', 'Back to home'))}</Link>}
      />
      <section className="panel planned-panel" role="status">
        <SearchX size={20} aria-hidden="true" />
        <p><code>{pathname}</code></p>
      </section>
    </div>
  )
}

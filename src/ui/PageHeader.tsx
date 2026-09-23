import { Upload } from 'lucide-react'
import { copy, type TextFn } from './copy'

export function PageHeader({ eyebrow, title, description, action, text }: { eyebrow: string; title: string; description: string; action?: React.ReactNode; text: TextFn }) {
  return <div className="page-header"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action ?? <button className="secondary-button"><Upload size={16} /> {text(copy('Xuất báo cáo', 'Export report'))}</button>}</div>
}

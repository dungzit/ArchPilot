import { FileCheck2 } from 'lucide-react'

export function ModulePanel({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children: React.ReactNode }) {
  return <div className="page-content"><div className="page-header"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div><button className="secondary-button"><FileCheck2 size={16} /> Export view</button></div>{children}</div>
}

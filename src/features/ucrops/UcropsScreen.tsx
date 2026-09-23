import { ArrowUpRight } from 'lucide-react'
import { ModulePanel } from '../../ui/ModulePanel'
import { copy, type TextFn } from '../../ui/copy'

const ucropsRows = [
  { code: 'U', name: 'Usability', score: 4, evidence: '6 / 7', note: 'User roles and operator journey documented', tone: 'teal' },
  { code: 'C', name: 'Cost', score: 3, evidence: '4 / 6', note: '5-year TCO has one unverified labor input', tone: 'amber' },
  { code: 'R', name: 'Reliability', score: 4, evidence: '7 / 8', note: 'RPO/RTO and failure domains reviewed', tone: 'teal' },
  { code: 'O', name: 'Operations', score: 3, evidence: '3 / 6', note: 'Backup restore drill still open', tone: 'amber' },
  { code: 'P', name: 'Performance', score: 2, evidence: '2 / 5', note: 'Aurora capacity needs a load test', tone: 'coral' },
  { code: 'S', name: 'Security', score: 4, evidence: '8 / 9', note: 'IAM and network boundaries reviewed', tone: 'teal' },
]

export function Ucrops({ text }: { text: TextFn }) { return <ModulePanel eyebrow="UCROPS QUALITY GATE" title={text(copy('Sáu tính chất của một thiết kế tốt.', 'Six qualities of a sound design.'))} description={text(copy('Mỗi điểm số phải đi cùng bằng chứng hoặc giả định rõ ràng.', 'Every score must carry evidence or an explicit assumption.'))}><div className="ucrops-summary"><div className="ucrops-score"><strong>3.3</strong><span>/ 5 weighted score</span></div><div><strong>Evidence coverage 68%</strong><p>Performance and operations are the next decision gates.</p></div><span className="status-pill amber">Needs evidence</span></div><div className="ucrops-grid">{ucropsRows.map((row) => <div className="ucrops-row" key={row.code}><div className={`quality-code ${row.tone}`}>{row.code}</div><div className="ucrops-copy"><strong>{row.name}</strong><small>{row.note}</small></div><div className="ucrops-evidence"><span>{row.evidence}</span><div className="mini-meter"><i style={{ width: `${parseInt(row.evidence) / parseInt(row.evidence.split('/')[1]) * 100}%` }} /></div></div><strong className="ucrops-number">{row.score}/5</strong><ArrowUpRight size={15} /></div>)}</div></ModulePanel> }

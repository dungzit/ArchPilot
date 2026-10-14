/**
 * Issues (task 2.8; REQ-DES-011, design-v2 4.2.8): validateGraph() L1 + L2
 * findings, sorted error / warning / info, then rule id, then code name.
 * Each row has a severity glyph AND word (never colour alone), the rule id,
 * the subject and the message; activating it selects the node or edge.
 * Nothing here blocks saving.
 */
import { copy, type TextFn } from '../../ui/copy'
import type { Severity } from '../../domain/graph'
import type { Issue } from './model/document'
import type { Selection } from './model/editor'

const SEVERITY: Record<Severity, { glyph: string; word: { vi: string; en: string } }> = {
  error: { glyph: '✖', word: copy('Lỗi', 'Error') },
  warning: { glyph: '▲', word: copy('Cảnh báo', 'Warning') },
  info: { glyph: 'ℹ', word: copy('Thông tin', 'Info') },
}

export function severityWord(severity: Severity, text: TextFn): string {
  return text(SEVERITY[severity].word)
}

export function IssuesPanel({ issues, selection, text, onGoTo }: { issues: Issue[]; selection: Selection; text: TextFn; onGoTo: (selection: Selection) => void }) {
  const counts = { error: 0, warning: 0, info: 0 }
  for (const issue of issues) counts[issue.severity] += 1
  return (
    <div className="dw-issues">
      <p className="dw-issues-summary" role="status">
        {text(copy(
          `${counts.error} lỗi · ${counts.warning} cảnh báo · ${counts.info} thông tin. Không vấn đề nào chặn việc lưu.`,
          `${counts.error} error${counts.error === 1 ? '' : 's'} · ${counts.warning} warning${counts.warning === 1 ? '' : 's'} · ${counts.info} info. Nothing here blocks saving.`,
        ))}
        {' '}<span className="dw-hint">{text(copy('F8 / Shift+F8: vấn đề kế / trước.', 'F8 / Shift+F8: next / previous issue.'))}</span>
      </p>
      {issues.length === 0 ? (
        <p className="dw-empty">{text(copy('Không có vấn đề nào.', 'No issues.'))}</p>
      ) : (
        <ul className="dw-issue-list">
          {issues.map((issue, index) => {
            const target: Selection = issue.nodeId ? { kind: 'node', id: issue.nodeId } : issue.edgeId ? { kind: 'edge', id: issue.edgeId } : null
            const active = target !== null && selection?.kind === target.kind && selection.id === target.id
            return (
              <li key={`${issue.ruleId}-${issue.path}-${index}`}>
                <button type="button" className={`dw-issue ${issue.severity}${active ? ' active' : ''}`} disabled={!target} onClick={() => onGoTo(target)}>
                  <span className="dw-sev"><span aria-hidden="true">{SEVERITY[issue.severity].glyph} </span>{severityWord(issue.severity, text)}</span>
                  <span className="dw-issue-body">
                    <span className="dw-issue-head"><code>{issue.ruleId}</code>{issue.subject && <> · <code>{issue.subject}</code></>}</span>
                    <span>{text(issue.message)}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/**
 * Common Markdown files (design-v2 4.4.7; REQ-IAC-003, 017, 023, 026;
 * REQ-ADP-004 "no silent drops").
 *
 * User text (decision titles, config values) is escaped with `mdText`;
 * identifiers (code names, ids, realisation ids) go into code spans. Labels
 * are never printed: code names identify nodes.
 */
import type { ArchGraphV2 } from '../../graph/types'
import { mdCode, mdText } from './text'
import type { CoverageReport, IacProblem, ManualStep } from './types'

export interface PackageHeader {
  designCodeName: string
  profileId: string
  target: string
  adapterId: string
  adapterVersion: string
  generatorVersion: string
}

const CLASS_LABEL: Record<string, string> = {
  generatable: 'generatable', manual: 'manual', unsupported: 'unsupported', annotation: 'annotation',
  assignedToOtherTarget: 'other target', noCode: 'no code',
}

function table(head: string[], rows: string[][]): string[] {
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((row) => `| ${row.join(' | ')} |`)]
}

function lines(parts: string[]): string {
  return `${parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`
}

export function coverageMarkdown(header: PackageHeader, report: CoverageReport): string {
  const codeNameOf = new Map(report.nodes.map((row) => [row.nodeId, row.codeName]))
  const t = report.totals
  const out: string[] = [
    `# Coverage: ${mdCode(header.designCodeName)} on ${mdCode(header.profileId)} (${mdCode(header.target)})`,
    '',
    `Adapter ${mdCode(header.adapterId)} ${header.adapterVersion}, generator ${header.generatorVersion}.`,
    'Every node and every edge of the design is listed exactly once.',
    '',
    '## Totals',
    '',
    ...table(['Generatable', 'Manual', 'Unsupported', 'Annotation', 'Other target'], [[t.generatable, t.manual, t.unsupported, t.annotation, t.other].map(String)]),
    '',
    '## Nodes',
    '',
    ...table(['Code name', 'Role', 'Badge', 'Detail', 'Realisation', 'Note', 'Reason'], report.nodes.map((row) => [
      mdCode(row.codeName), mdCode(row.role), CLASS_LABEL[row.class], row.detail ?? '',
      row.realisation ? `${mdCode(row.realisation)}${row.assumed ? ' (default)' : ''}` : '',
      mdText(row.note), row.reason ? mdText(row.reason) : '',
    ])),
    '',
    '## Edges',
    '',
    ...(report.edges.length === 0
      ? ['None.']
      : table(['Edge', 'From', 'To', 'Kind', 'Mode', 'Class', 'Note'], report.edges.map((row) => [
          mdCode(row.edgeId), mdCode(codeNameOf.get(row.source) ?? row.source), mdCode(codeNameOf.get(row.target) ?? row.target),
          row.kind, row.mode ?? '', CLASS_LABEL[row.class], mdText(row.note),
        ]))),
    '',
    '## Attributes not expressed',
    '',
    ...(report.attributes.length === 0
      ? ['None.']
      : table(['Code name', 'Key', 'Value', 'Note'], report.attributes.map((row) => [mdCode(row.codeName), mdCode(row.key), mdText(row.value), mdText(row.note)]))),
  ]
  return lines(out)
}

export function manualStepsMarkdown(header: PackageHeader, doc: ArchGraphV2, report: CoverageReport, steps: ManualStep[]): string {
  const out: string[] = [
    `# Manual steps: ${mdCode(header.designCodeName)} on ${mdCode(header.profileId)} (${mdCode(header.target)})`,
    '',
    'ArchPilot generated no code for the items below. Each one is still part of the design.',
    '',
  ]
  const decisions = doc.decisions ?? []
  if (steps.length === 0) out.push('No manual steps.')
  for (const step of steps) {
    out.push(`## ${mdCode(step.codeName)} (${mdCode(step.role)})`, '')
    out.push(`- Target: ${mdCode(header.target)}`)
    out.push(`- Realisation: ${step.realisation ? mdCode(step.realisation) : 'none'}`)
    const linked = step.nodeId ? decisions.filter((decision) => (decision.linkedNodeIds ?? []).includes(step.nodeId!)) : []
    for (const decision of [...linked].sort((a, b) => a.number - b.number)) {
      out.push(`- Linked decision: ADR-${decision.number} ${mdText(decision.title, 120)} (${decision.status})`)
    }
    out.push('')
    for (const item of step.items) out.push(`- [ ] ${item}`)
    out.push('')
  }
  return lines(out)
}

export function problemLines(problems: IacProblem[]): string[] {
  return problems.map((problem) => `- ${problem.severity === 'warning' ? 'Warning' : 'Info'} ${mdCode(problem.ruleId)}: ${mdText(problem.message.en, 400)}`)
}

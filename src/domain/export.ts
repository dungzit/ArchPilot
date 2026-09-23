import type { ArchitectureOption, Decision, Requirement } from './model'
import type { SizingResult } from './sizing'

function escapeCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value
  return `"${safe.replaceAll('"', '""')}"`
}

export function exportRequirementsCsv(requirements: Requirement[]): string {
  const rows = ['id,type,title,priority,status,confidence']
  for (const requirement of requirements) rows.push([requirement.id, requirement.type, requirement.title, requirement.priority, requirement.status, requirement.provenance.confidence].map(escapeCell).join(','))
  return `${rows.join('\n')}\n`
}

export function exportArchitectureMarkdown(option: ArchitectureOption, decision: Decision, sizing: SizingResult[]): string {
  const components = option.components.map((component) => `- ${component.name} (${component.type}, ${component.target})`).join('\n')
  const sizingRows = sizing.map((result) => `| ${result.domain} | ${result.range.low.toFixed(1)} - ${result.range.high.toFixed(1)} ${result.unit} | ${result.confidence} | ${result.formulaId}@${result.formulaVersion} |`).join('\n')
  return `# ${decision.title}\n\n## Decision\n\n${decision.rationale}\n\n## Selected option\n\n${option.name}\n\n## Components\n\n${components}\n\n## Sizing evidence\n\n| Domain | Range | Confidence | Formula |\n|---|---:|---|---|\n${sizingRows}\n\n## Provenance\n\n- Option revision: ${option.revision}\n- Decision revision: ${decision.revision}\n- Source IDs: ${decision.evidenceIds.join(', ') || 'none'}\n`
}

/**
 * MANUAL-STEPS.md content (REQ-IAC-026, REQ-IAC-023): one section per manual
 * or unsupported node, one for cross-target and manual access edges, plus
 * whatever the adapter adds (certificates, firewall requests, ...).
 *
 * Placeholders in catalogue step text: `{codeName}`, `{role}`, `{target}` and
 * `{<configKey>}`. Filled values are Markdown-escaped; unknown placeholders
 * are left visible so a catalogue author sees the mistake.
 */
import type { ArchNodeV2 } from '../../graph/types'
import { resolveRealisation } from './coverage'
import { configText, mdCode, mdText } from './text'
import type { ManualStep, RealisationCatalogue, TargetContext } from './types'

export function fillStep(template: string, node: ArchNodeV2, target: string): string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (whole, key: string) => {
    if (key === 'codeName') return mdCode(node.codeName)
    if (key === 'role') return mdCode(node.type)
    if (key === 'target') return mdCode(target)
    const value = node.config?.[key]
    return value === undefined ? whole : mdText(configText(value), 80)
  })
}

export function coreManualSteps(ctx: TargetContext, catalogue: RealisationCatalogue): ManualStep[] {
  const out: ManualStep[] = []
  for (const row of ctx.coverage.nodes) {
    if (row.class !== 'manual' && row.class !== 'unsupported') continue
    const node = ctx.byId.get(row.nodeId)!
    const realisation = row.class === 'manual' ? resolveRealisation(node, ctx.doc, ctx.profile.target, catalogue).realisation : undefined
    const items = (realisation?.manualSteps ?? []).map((step) => fillStep(step.text.en, node, ctx.profile.target))
    if (items.length === 0) {
      items.push(row.class === 'unsupported'
        ? `${mdCode(node.codeName)} has no ${mdCode(ctx.profile.target)} realisation. Provide it outside this package, or move it to another target.`
        : `Provision ${mdCode(node.codeName)} (${mdCode(node.type)}) by hand; this adapter version generates no code for it.`)
    }
    if (row.reason) items.push(`Reason: ${mdText(row.reason)}`)
    out.push({ nodeId: node.id, codeName: node.codeName, role: node.type, ...(row.realisation ? { realisation: row.realisation } : {}), items })
  }
  const codeName = (id: string) => ctx.byId.get(id)?.codeName ?? id
  const connectivity = ctx.coverage.edges
    .filter((row) => row.class === 'manual')
    .map((row) => `Edge ${mdCode(row.edgeId)}: ${mdCode(codeName(row.source))} -> ${mdCode(codeName(row.target))}${row.mode ? ` (${row.mode})` : ''}. ${mdText(row.note)}`)
  if (connectivity.length > 0) out.push({ codeName: 'connectivity', role: 'edges', items: connectivity })
  return out
}

/**
 * buildHldModel (pilot WP-C, docs/v3/06 §1): design + sizing runs + reference
 * pins + project meta + manual text -> a language-resolved HldModel.
 *
 * Pure and deterministic: no I/O, no clock, explicit locale. Missing data
 * (runs or pins service down, unreadable graph) becomes a notice and a
 * sentence in the document, never an exception.
 *
 * Numbering: enabled main sections are numbered 1..n in template order and
 * enabled appendices lettered A.. in order, so switching a section off
 * (TP-03) never leaves a gap. Section 0 (document information) is unnumbered
 * and always present.
 */
import type { ReferencePin, SizingRun, SizingRunWarning } from '../../contracts/pilot'
import { catalog, getRole } from '../graph/catalog'
import { ancestors, effectiveFailureDomain, nodeMap } from '../graph/containment'
import type { ArchEdgeV2, ArchGraphV2, ArchNodeV2, Problem } from '../graph/types'
import { validateGraph } from '../graph/validate'
import { cleanText, formatNumber, formatValue, hldFileName, localeOf, manualLines, orDash, parseManualText, safeUrl } from './format'
import { DECISION_STATUS, SEVERITY_LABELS, sectionTitle, t, type LabelKey } from './i18n'
import { isAnnotation } from './skeleton'
import {
  ALWAYS_ON,
  APPENDIX_IDS,
  SECTION_IDS,
  type HldBlock,
  type HldInput,
  type HldLanguage,
  type HldLink,
  type HldManual,
  type HldMeta,
  type HldModel,
  type HldSection,
  type HldStats,
  type ManualField,
  type SectionId,
  type SectionSource,
} from './types'

const SOURCES: Record<SectionId, SectionSource> = {
  info: 'auto',
  intro: 'manual',
  requirements: 'mixed',
  architecture: 'mixed',
  deployment: 'mixed',
  availability: 'manual',
  sizing: 'auto',
  infrastructure: 'auto',
  security: 'manual',
  operations: 'manual',
  risks: 'mixed',
  rollout: 'manual',
  traceAppendix: 'auto',
  questionsAppendix: 'manual',
  referencesAppendix: 'auto',
}

/** Which sections end up in the document, in order. */
export function enabledSections(toggles: HldInput['sections'] = {}): SectionId[] {
  return SECTION_IDS.filter((id) => ALWAYS_ON.has(id) || toggles?.[id] !== false)
}

/** Section number/letter for every enabled section. */
export function sectionNumbers(enabled: SectionId[]): Map<SectionId, string | null> {
  const out = new Map<SectionId, string | null>()
  let main = 0
  let appendix = 0
  for (const id of enabled) {
    if (id === 'info') out.set(id, null)
    else if (APPENDIX_IDS.has(id)) out.set(id, String.fromCharCode(65 + appendix++))
    else out.set(id, String(++main))
  }
  return out
}

const SEVERITY_RANK: Record<string, number> = { error: 0, high: 1, warning: 2, medium: 2, low: 3, info: 4 }

interface RiskRow {
  source: 'sizing' | 'design' | 'manual'
  severity: string | null
  description: string
  subject: string
  order: number
}

export function runLabel(run: SizingRun): string {
  return cleanText(run.componentLabel ?? '').trim() || cleanText(run.modelName).trim() || run.modelId
}

/** `Kafka sizing v3` when the run carries the pack name; older runs only have the id (`builtin-kafka v3`). */
export function packText(run: SizingRun, withId = false): string {
  const name = cleanText(run.rulePackName ?? '').trim()
  const id = cleanText(run.rulePackId)
  if (!name) return `${id} v${run.rulePackVersion}`
  return withId && id ? `${name} v${run.rulePackVersion} (${id})` : `${name} v${run.rulePackVersion}`
}

/**
 * The output the binding constraint decided. `binding` is a calc step name,
 * so the output whose `from` is that step is marked; runs saved before
 * outputs carried `from` fall back to an output with the same name.
 */
export function isBindingOutput(run: SizingRun, output: SizingRun['outputs'][number]): boolean {
  if (!run.binding) return false
  return (output.from ?? output.name) === run.binding
}

function roleLabel(node: ArchNodeV2, language: HldLanguage): string {
  const role = getRole(node.type)
  const base = role?.label[language] ?? node.type
  const variant = node.variant ? role?.variants?.find((candidate) => candidate.id === node.variant)?.label[language] ?? node.variant : null
  return variant ? `${base} (${variant})` : base
}

const ATTRIBUTE_ORDER = ['replicas', 'tier', 'statefulness', 'criticality', 'failureDomainLevel', 'failureDomainLabel', 'dataClassification', 'sizeClass', 'owner'] as const

function keyAttributes(node: ArchNodeV2, language: HldLanguage): string {
  const parts: string[] = []
  const attributes = node.attributes ?? {}
  for (const key of ATTRIBUTE_ORDER) {
    const value = attributes[key]
    if (value === undefined || value === '') continue
    const label = catalog.attributes.find((field) => field.key === key)?.label[language] ?? key
    parts.push(`${label}: ${formatValue(value, language)}`)
  }
  const fields = getRole(node.type)?.fields ?? []
  const config = Object.entries(node.config ?? {})
  for (const [key, value] of config.slice(0, 4)) {
    const label = fields.find((field) => field.key === key)?.label[language] ?? key
    parts.push(`${label}: ${formatValue(value, language)}`)
  }
  if (config.length > 4) parts.push('…')
  return parts.length > 0 ? parts.join('; ') : '—'
}

function edgeKind(edge: ArchEdgeV2, language: HldLanguage): string {
  const parts = [t(edge.kind === 'flow' ? 'flowKind' : 'accessKind', language)]
  if (edge.mode) parts.push(catalog.edgeModes.find((mode) => mode.id === edge.mode)?.label[language] ?? edge.mode)
  if (edge.protocol) parts.push(edge.port !== undefined ? `${edge.protocol.toUpperCase()}:${edge.port}` : edge.protocol.toUpperCase())
  else if (edge.port !== undefined) parts.push(`:${edge.port}`)
  if (edge.direction === 'bidirectional') parts.push(t('bidirectional', language))
  return parts.join(' · ')
}

function manualBlocks(text: string | undefined, language: HldLanguage): HldBlock[] {
  const parsed = parseManualText(text ?? '')
  if (parsed.length === 0) return [{ kind: 'paragraph', text: t('placeholder', language), tone: 'placeholder' }]
  return parsed
}

function table(columns: string[], rows: string[][], options: { widths?: number[]; numeric?: number[]; empty: string }): HldBlock {
  if (rows.length === 0) return { kind: 'paragraph', text: options.empty, tone: 'note' }
  return { kind: 'table', columns, rows, widths: options.widths, numeric: options.numeric }
}

function severityLabel(severity: string | null, language: HldLanguage): string {
  if (!severity) return '—'
  return SEVERITY_LABELS[severity]?.[language] ?? severity
}

function warningText(warning: SizingRunWarning, language: HldLanguage): string {
  return cleanText(language === 'vi' ? warning.messageVi || warning.messageEn : warning.messageEn || warning.messageVi)
}

export function buildHldModel(input: HldInput): HldModel {
  const { design, language } = input
  const runs: SizingRun[] = input.runs ?? []
  const pins: ReferencePin[] = input.pins ?? []
  const graph: ArchGraphV2 | null = design.graph
  const lbl = (key: LabelKey) => t(key, language)
  const num = (value: number) => formatNumber(value, language)
  const manual = (field: ManualField) => input.manual[field]

  const meta: HldMeta = {
    customer: cleanText(input.meta.customer).trim(),
    projectName: cleanText(input.meta.projectName).trim() || cleanText(design.name).trim(),
    version: cleanText(input.meta.version).trim() || '1.0',
    author: cleanText(input.meta.author).trim(),
    reviewer: cleanText(input.meta.reviewer).trim(),
    date: cleanText(input.meta.date).trim(),
    changeNote: cleanText(input.meta.changeNote ?? '').trim() || lbl('initialDraft'),
  }
  const designUrl = design.url ?? `/designs/${encodeURIComponent(design.id)}`

  // ---------------------------------------------------------------- graph facts
  const allNodes = graph?.nodes ?? []
  const byId = graph ? nodeMap(graph) : new Map<string, ArchNodeV2>()
  const components = allNodes.filter((node) => !isAnnotation(node))
  const containers = components.filter((node) => getRole(node.type)?.container === true)
  const edges = graph?.edges ?? []
  const decisions = [...(graph?.decisions ?? [])].sort((a, b) => a.number - b.number)
  const nodeName = (id: string) => {
    const node = byId.get(id)
    return node ? cleanText(node.label) || node.codeName : id
  }
  let findings: Problem[] = []
  if (graph) {
    try {
      findings = validateGraph(graph)
    } catch {
      findings = []
    }
  }

  // ---------------------------------------------------------------- risks (10)
  const risks: RiskRow[] = []
  runs.forEach((run) => {
    for (const warning of run.warnings ?? []) {
      risks.push({ source: 'sizing', severity: warning.severity, description: warningText(warning, language), subject: runLabel(run), order: risks.length })
    }
  })
  for (const problem of findings) {
    const edge = problem.edgeId ? edges.find((candidate) => candidate.id === problem.edgeId) : undefined
    const subject = edge ? `${nodeName(edge.source)} → ${nodeName(edge.target)}` : problem.nodeId ? nodeName(problem.nodeId) : '—'
    risks.push({ source: 'design', severity: problem.severity, description: `[${problem.ruleId}] ${cleanText(problem.message[language])}`, subject, order: risks.length })
  }
  for (const line of manualLines(manual('risks') ?? '')) {
    risks.push({ source: 'manual', severity: null, description: line, subject: '—', order: risks.length })
  }
  risks.sort((a, b) => (SEVERITY_RANK[a.severity ?? ''] ?? 5) - (SEVERITY_RANK[b.severity ?? ''] ?? 5) || a.order - b.order)

  // ---------------------------------------------------------------- assumptions (2.5)
  const assumptionRows: string[][] = []
  for (const run of runs) {
    for (const item of run.inputs ?? []) {
      assumptionRows.push([runLabel(run), cleanText(item.name), num(item.value), orDash(item.unit), orDash(item.source)])
    }
  }
  for (const assumption of graph?.brief?.assumptions ?? []) {
    assumptionRows.push([lbl('designAssumption'), cleanText(assumption.key), formatValue(assumption.value, language), '—', orDash(assumption.reason)])
  }

  const questionLines = manualLines(manual('questions') ?? '')
  const linkPins = pins.map((pin): HldLink => {
    const details: string[] = []
    if (pin.stepPosition !== null && pin.stepPosition !== undefined) {
      details.push(`${lbl('stepRef')} ${pin.stepPosition}${pin.stepTitle ? `: ${cleanText(pin.stepTitle)}` : ''}`)
    }
    if (pin.note && pin.note.trim()) details.push(`${lbl('note')}: ${cleanText(pin.note).trim()}`)
    return { title: cleanText(pin.title).trim() || pin.shareId, url: safeUrl(pin.url), details, source: lbl('referenceSource') }
  })

  const stats: HldStats = {
    components: components.length,
    connections: edges.length,
    containers: containers.length,
    decisions: decisions.length,
    sizingRuns: runs.length,
    pins: pins.length,
    risks: risks.length,
    sizingWarnings: risks.filter((risk) => risk.source === 'sizing').length,
    designFindings: risks.filter((risk) => risk.source === 'design').length,
    manualRisks: risks.filter((risk) => risk.source === 'manual').length,
    assumptions: assumptionRows.length,
    questions: questionLines.length,
  }

  // ---------------------------------------------------------------- sections
  const enabled = enabledSections(input.sections)
  const numbers = sectionNumbers(enabled)
  const traceLetter = numbers.get('traceAppendix')

  const builders: Record<SectionId, (no: string) => HldBlock[]> = {
    info: () => [
      {
        kind: 'fields',
        rows: [
          { label: lbl('customer'), value: orDash(meta.customer) },
          { label: lbl('projectName'), value: orDash(meta.projectName) },
          { label: lbl('version'), value: orDash(meta.version) },
          { label: lbl('author'), value: orDash(meta.author) },
          { label: lbl('reviewer'), value: orDash(meta.reviewer) },
          { label: lbl('date'), value: orDash(meta.date) },
          { label: lbl('sourceDesign'), value: `${cleanText(design.name)}${design.revision !== undefined ? ` (${lbl('revision')} ${design.revision})` : ''}` },
        ],
      },
      { kind: 'heading', level: 2, text: lbl('changeHistory') },
      {
        kind: 'table',
        columns: [lbl('version'), lbl('date'), lbl('changedBy'), lbl('description')],
        rows: [[orDash(meta.version), orDash(meta.date), orDash(meta.author), orDash(meta.changeNote)]],
        widths: [1, 1.2, 1.6, 3.2],
      },
    ],

    intro: () => manualBlocks(manual('intro'), language),

    requirements: (no) => [
      { kind: 'heading', level: 2, text: `${no}.1 ${lbl('business')}` },
      ...manualBlocks(manual('business'), language),
      { kind: 'heading', level: 2, text: `${no}.2 ${lbl('functional')}` },
      ...manualBlocks(manual('functional'), language),
      { kind: 'heading', level: 2, text: `${no}.3 ${lbl('nonFunctional')}` },
      ...manualBlocks(manual('nonFunctional'), language),
      { kind: 'heading', level: 2, text: `${no}.4 ${lbl('constraints')}` },
      ...manualBlocks(manual('constraints'), language),
      { kind: 'heading', level: 2, text: `${no}.5 ${lbl('assumptions')}` },
      { kind: 'paragraph', text: lbl('assumptionsIntro'), tone: 'note' },
      table([lbl('runOrComponent'), lbl('input'), lbl('value'), lbl('unit'), lbl('source')], assumptionRows, {
        widths: [2, 2, 1.2, 1, 2],
        numeric: [2],
        empty: input.runs === null ? lbl('runsUnavailable') : lbl('noData'),
      }),
    ],

    architecture: (no) => {
      const blocks: HldBlock[] = [
        { kind: 'heading', level: 2, text: `${no}.1 ${lbl('principles')}` },
        ...manualBlocks(manual('principles'), language),
        { kind: 'heading', level: 2, text: `${no}.2 ${lbl('diagram')}` },
        { kind: 'diagram', designId: design.id, url: designUrl, caption: lbl('diagramCaption'), fallback: `${lbl('diagramFallback')} ${designUrl}` },
        { kind: 'heading', level: 2, text: `${no}.3 ${lbl('components')}` },
        table(
          ['#', lbl('name'), lbl('type'), lbl('parent'), lbl('keyAttributes')],
          components.map((node, index) => [
            String(index + 1),
            `${cleanText(node.label)} (${node.codeName})`,
            roleLabel(node, language),
            node.parentId ? nodeName(node.parentId) : '—',
            keyAttributes(node, language),
          ]),
          { widths: [0.5, 2.2, 1.6, 1.4, 3.6], empty: lbl('noComponents') },
        ),
        { kind: 'heading', level: 3, text: lbl('connections') },
        table(
          ['#', lbl('from'), lbl('to'), lbl('kindProtocol'), lbl('label')],
          edges.map((edge, index) => [String(index + 1), nodeName(edge.source), nodeName(edge.target), edgeKind(edge, language), orDash(edge.label)]),
          { widths: [0.5, 1.8, 1.8, 2.4, 2.6], empty: lbl('noConnections') },
        ),
      ]
      if (decisions.length > 0) {
        blocks.push(
          { kind: 'heading', level: 2, text: `${no}.4 ${lbl('decisions')}` },
          {
            kind: 'table',
            columns: ['ADR', lbl('decision'), lbl('status'), lbl('description')],
            rows: decisions.map((decision) => [
              `ADR-${String(decision.number).padStart(3, '0')}`,
              cleanText(decision.title),
              DECISION_STATUS[decision.status]?.[language] ?? decision.status,
              orDash(decision.decision),
            ]),
            widths: [1, 2.4, 1.2, 3.8],
          },
        )
        for (const decision of decisions) {
          const detail: HldBlock[] = []
          if (decision.context) detail.push({ kind: 'paragraph', text: `${lbl('context')}: ${cleanText(decision.context)}` })
          if (decision.options && decision.options.length > 0) {
            detail.push({ kind: 'paragraph', text: `${lbl('options')}:`, tone: 'strong' })
            detail.push({
              kind: 'bullets',
              items: decision.options.map((option) => {
                const extra = [option.pros ? `${lbl('pros')}: ${cleanText(option.pros)}` : '', option.cons ? `${lbl('cons')}: ${cleanText(option.cons)}` : ''].filter(Boolean)
                return extra.length > 0 ? `${cleanText(option.name)} — ${extra.join('; ')}` : cleanText(option.name)
              }),
            })
          }
          if (decision.decision) detail.push({ kind: 'paragraph', text: `${lbl('decision')}: ${cleanText(decision.decision)}` })
          if (decision.consequences) detail.push({ kind: 'paragraph', text: `${lbl('consequences')}: ${cleanText(decision.consequences)}` })
          if (decision.linkedNodeIds && decision.linkedNodeIds.length > 0) {
            detail.push({ kind: 'paragraph', text: `${lbl('linkedComponents')}: ${decision.linkedNodeIds.map(nodeName).join(', ')}` })
          }
          if (detail.length > 0) {
            blocks.push({ kind: 'heading', level: 3, text: `ADR-${String(decision.number).padStart(3, '0')} ${cleanText(decision.title)}` }, ...detail)
          }
        }
      }
      return blocks
    },

    deployment: (no) => {
      const blocks: HldBlock[] = []
      const deploymentModel = graph?.deployment
      let sub = 0
      if (graph && containers.length > 0) {
        blocks.push(
          { kind: 'heading', level: 2, text: `${no}.${++sub} ${lbl('containers')}` },
          {
            kind: 'table',
            columns: [lbl('container'), lbl('type'), lbl('parent'), lbl('failureDomain'), lbl('children')],
            rows: containers.map((node) => {
              const domain = effectiveFailureDomain(graph, node.id)
              const childCount = components.filter((child) => child.parentId === node.id).length
              return [
                cleanText(node.label),
                roleLabel(node, language),
                node.parentId ? nodeName(node.parentId) : '—',
                domain.level ? `${domain.level}${domain.label ? ` · ${domain.label}` : ''}` : '—',
                num(childCount),
              ]
            }),
            widths: [2, 1.8, 1.6, 1.8, 1],
            numeric: [4],
          },
        )
        const placed = components.filter((node) => node.parentId && getRole(node.type)?.container !== true)
        if (placed.length > 0) {
          blocks.push(
            { kind: 'heading', level: 2, text: `${no}.${++sub} ${lbl('placement')}` },
            {
              kind: 'table',
              columns: [lbl('component'), lbl('location'), lbl('failureDomain'), lbl('replicas')],
              rows: placed.map((node) => {
                const domain = effectiveFailureDomain(graph, node.id)
                const path = ancestors(graph, node.id, byId).reverse().map(nodeName).join(' › ')
                return [
                  cleanText(node.label),
                  path || '—',
                  domain.level ? `${domain.level}${domain.label ? ` · ${domain.label}` : ''}` : '—',
                  num(node.attributes?.replicas ?? getRole(node.type)?.defaultAttributes.replicas ?? 1),
                ]
              }),
              widths: [2, 3.4, 2, 1],
              numeric: [3],
            },
          )
        }
      }
      if (deploymentModel && (deploymentModel.profiles?.length ?? 0) > 0) {
        blocks.push(
          { kind: 'heading', level: 2, text: `${no}.${++sub} ${lbl('environments')}` },
          { kind: 'paragraph', text: `${lbl('environment')}: ${orDash(graph?.settings?.environment)}` },
          {
            kind: 'table',
            columns: [lbl('profile'), lbl('target'), lbl('label')],
            rows: deploymentModel.profiles.map((profile) => [profile.id, profile.target, cleanText(profile.label)]),
            widths: [2, 1.5, 3],
          },
        )
        if ((deploymentModel.scenarios?.length ?? 0) > 0) {
          blocks.push({
            kind: 'table',
            columns: [lbl('scenario'), lbl('defaultProfile'), lbl('placements')],
            rows: deploymentModel.scenarios.map((scenario) => [
              `${cleanText(scenario.label)}${scenario.id === deploymentModel.activeScenarioId ? ` (${lbl('active')})` : ''}`,
              scenario.defaultProfileId,
              num(scenario.placements?.length ?? 0),
            ]),
            widths: [3, 2, 1.5],
            numeric: [2],
          })
        }
      }
      if (blocks.length === 0) return manualBlocks(manual('deployment'), language)
      blocks.push({ kind: 'heading', level: 2, text: `${no}.${++sub} ${lbl('deploymentNotes')}` }, ...manualBlocks(manual('deployment'), language))
      return blocks
    },

    availability: () => manualBlocks(manual('availability'), language),

    sizing: (no) => {
      if (input.runs === null) return [{ kind: 'paragraph', text: lbl('runsUnavailable'), tone: 'note' }]
      if (runs.length === 0) return [{ kind: 'paragraph', text: lbl('noRuns'), tone: 'note' }]
      const blocks: HldBlock[] = [
        { kind: 'paragraph', text: traceLetter ? `${lbl('sizingIntro')} ${lbl('appendix')} ${traceLetter}.` : lbl('sizingIntroNoTrace') },
        { kind: 'heading', level: 2, text: `${no}.1 ${lbl('sizingMethod')}` },
        {
          kind: 'table',
          columns: ['#', lbl('component'), lbl('model'), lbl('rulePack'), lbl('createdAt')],
          rows: runs.map((run, index) => [String(index + 1), runLabel(run), cleanText(run.modelName), packText(run), orDash(run.createdAt?.slice(0, 16).replace('T', ' '))]),
          widths: [0.5, 2.2, 2.2, 2, 1.6],
        },
        { kind: 'heading', level: 2, text: `${no}.2 ${lbl('sizingResults')}` },
      ]
      runs.forEach((run, index) => {
        blocks.push(
          { kind: 'heading', level: 3, text: `${no}.2.${index + 1} ${runLabel(run)}` },
          {
            kind: 'fields',
            rows: [
              { label: lbl('model'), value: `${cleanText(run.modelName)} (${cleanText(run.modelId)})` },
              { label: lbl('rulePack'), value: packText(run, true) },
              { label: lbl('binding'), value: orDash(run.binding) },
            ],
          },
          { kind: 'paragraph', text: lbl('inputs'), tone: 'strong' },
          table([lbl('input'), lbl('value'), lbl('unit'), lbl('source')], (run.inputs ?? []).map((item) => [cleanText(item.name), num(item.value), orDash(item.unit), orDash(item.source)]), {
            widths: [2.4, 1.4, 1.2, 2.4],
            numeric: [1],
            empty: lbl('noData'),
          }),
          { kind: 'paragraph', text: lbl('outputs'), tone: 'strong' },
          table(
            [lbl('output'), lbl('value'), lbl('unit')],
            (run.outputs ?? []).map((item) => [
              `${cleanText(item.label || item.name)}${isBindingOutput(run, item) ? ` (${lbl('binding')})` : ''}`,
              num(item.value),
              orDash(item.unit),
            ]),
            { widths: [3.4, 1.6, 1.4], numeric: [1], empty: lbl('noData') },
          ),
        )
        if ((run.warnings ?? []).length > 0) {
          blocks.push(
            { kind: 'paragraph', text: lbl('warnings'), tone: 'strong' },
            { kind: 'bullets', items: run.warnings.map((warning) => `[${severityLabel(warning.severity, language)}] ${warningText(warning, language)}`) },
          )
        }
      })
      return blocks
    },

    infrastructure: (no) => {
      const blocks: HldBlock[] = [{ kind: 'heading', level: 2, text: `${no}.1 ${lbl('sizingSummary')}` }]
      const summary: string[][] = []
      for (const run of runs) {
        for (const item of run.outputs ?? []) summary.push([runLabel(run), cleanText(item.label || item.name), num(item.value), orDash(item.unit)])
      }
      blocks.push(table([lbl('component'), lbl('output'), lbl('value'), lbl('unit')], summary, {
        widths: [2.4, 2.6, 1.4, 1.2],
        numeric: [2],
        empty: input.runs === null ? lbl('runsUnavailable') : lbl('noRuns'),
      }))
      const sized = components.filter((node) => node.attributes?.sizeClass && catalog.sizeClasses[node.attributes.sizeClass])
      if (sized.length > 0) {
        let totalCpu = 0
        let totalRam = 0
        const rows = sized.map((node) => {
          const size = catalog.sizeClasses[node.attributes!.sizeClass!]
          const replicas = node.attributes?.replicas ?? getRole(node.type)?.defaultAttributes.replicas ?? 1
          totalCpu += size.vcpu * replicas
          totalRam += size.memoryGiB * replicas
          return [cleanText(node.label), node.attributes!.sizeClass!, num(replicas), num(size.vcpu), num(size.memoryGiB), num(size.vcpu * replicas), num(size.memoryGiB * replicas)]
        })
        rows.push([lbl('total'), '', '', '', '', num(totalCpu), num(totalRam)])
        blocks.push(
          { kind: 'heading', level: 2, text: `${no}.2 ${lbl('sizeClassEstimate')}` },
          {
            kind: 'table',
            columns: [lbl('component'), lbl('sizeClass'), lbl('replicas'), lbl('vcpuPerNode'), lbl('ramPerNode'), lbl('totalVcpu'), lbl('totalRam')],
            rows,
            widths: [2.4, 0.9, 1, 1, 1.1, 1, 1.1],
            numeric: [2, 3, 4, 5, 6],
          },
        )
      }
      blocks.push({ kind: 'paragraph', text: lbl('bomLater'), tone: 'note' })
      return blocks
    },

    security: () => manualBlocks(manual('security'), language),
    operations: () => manualBlocks(manual('operations'), language),

    risks: () => {
      const blocks: HldBlock[] = [{ kind: 'paragraph', text: lbl('riskIntro'), tone: 'note' }]
      const sourceLabel = { sizing: lbl('srcSizing'), design: lbl('srcDesign'), manual: lbl('srcManual') }
      blocks.push(table(
        ['#', lbl('source'), lbl('severity'), lbl('description'), lbl('subject')],
        risks.map((risk, index) => [String(index + 1), sourceLabel[risk.source], severityLabel(risk.severity, language), risk.description, risk.subject]),
        { widths: [0.5, 1.4, 1.1, 4.2, 2], empty: lbl('noRisks') },
      ))
      if (input.runs === null) blocks.push({ kind: 'paragraph', text: lbl('runsUnavailable'), tone: 'note' })
      return blocks
    },

    rollout: () => manualBlocks(manual('rollout'), language),

    traceAppendix: (no) => {
      if (input.runs === null) return [{ kind: 'paragraph', text: lbl('runsUnavailable'), tone: 'note' }]
      if (runs.length === 0) return [{ kind: 'paragraph', text: lbl('noRuns'), tone: 'note' }]
      const blocks: HldBlock[] = [{ kind: 'paragraph', text: lbl('traceIntro'), tone: 'note' }]
      runs.forEach((run, index) => {
        blocks.push(
          { kind: 'heading', level: 2, text: `${no}.${index + 1} ${runLabel(run)} — ${cleanText(run.modelName)} (${packText(run)})` },
          table(
            [lbl('step'), lbl('formula'), lbl('substituted'), lbl('value')],
            (run.steps ?? []).map((step) => [cleanText(step.name), cleanText(step.formula), cleanText(step.substituted), `${num(step.value)} ${cleanText(step.unit)}`.trim()]),
            { widths: [1.6, 2.6, 3, 1.6], numeric: [3], empty: lbl('noData') },
          ),
        )
      })
      return blocks
    },

    questionsAppendix: () => {
      const rows = questionLines.map((line, index) => {
        const split = line.indexOf('|')
        const question = split >= 0 ? line.slice(0, split).trim() : line
        const answer = split >= 0 ? line.slice(split + 1).trim() : ''
        return [String(index + 1), question, answer]
      })
      return [table(['#', lbl('question'), lbl('answer')], rows, { widths: [0.5, 4.5, 3], empty: lbl('noQuestions') })]
    },

    referencesAppendix: () => {
      if (input.pins === null) return [{ kind: 'paragraph', text: lbl('pinsUnavailable'), tone: 'note' }]
      if (linkPins.length === 0) return [{ kind: 'paragraph', text: lbl('noPins'), tone: 'note' }]
      return [{ kind: 'paragraph', text: `${lbl('referencesIntro')} ${lbl('referenceSource')}.`, tone: 'note' }, { kind: 'links', items: linkPins }]
    },
  }

  const sections: HldSection[] = enabled.map((id) => {
    const number = numbers.get(id) ?? null
    const title = sectionTitle(id, language)
    const heading = number === null ? title : APPENDIX_IDS.has(id) ? `${lbl('appendix')} ${number}. ${title}` : `${number}. ${title}`
    return { id, number, title, heading, source: SOURCES[id], blocks: builders[id](number ?? '0') }
  })

  const notices: string[] = []
  if (input.runs === null) notices.push(lbl('runsUnavailable'))
  if (input.pins === null) notices.push(lbl('pinsUnavailable'))
  if (!graph) notices.push(lbl('graphUnreadable'))

  return {
    language,
    locale: localeOf(language),
    meta,
    design: { id: design.id, name: cleanText(design.name), url: designUrl },
    chrome: {
      documentTitle: lbl('documentTitle'),
      documentSubtitle: meta.projectName,
      tocTitle: lbl('tocTitle'),
      tocNote: lbl('tocNote'),
      pageLabel: lbl('page'),
      ofLabel: lbl('of'),
      generatedBy: lbl('generatedBy'),
      titleFields: [
        { label: lbl('customer'), value: orDash(meta.customer) },
        { label: lbl('version'), value: orDash(meta.version) },
        { label: lbl('date'), value: orDash(meta.date) },
        { label: lbl('author'), value: orDash(meta.author) },
        { label: lbl('reviewer'), value: orDash(meta.reviewer) },
      ],
      headerText: `${meta.projectName} — HLD v${meta.version}`,
    },
    sections,
    stats,
    notices,
    fileName: hldFileName(meta.projectName, meta.version),
  }
}

/** Fill blank manual fields from a skeleton; edited fields win. */
export function mergeManual(skeleton: HldManual, edited: Partial<HldManual>): HldManual {
  const out = { ...skeleton }
  for (const key of Object.keys(skeleton) as ManualField[]) {
    const value = edited[key]
    if (typeof value === 'string') out[key] = value
  }
  return out
}

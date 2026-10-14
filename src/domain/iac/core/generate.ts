/**
 * The generation pipeline (design-v2 4.4.2):
 *
 *   profile -> coverage -> neutral gate -> adapter gate -> plan -> files
 *   -> common files -> secret lint (IAC-E12) -> manifest -> (zip)
 *
 * Pure function of (document, profile, adapter version, generator version,
 * options): no clock, randomness, locale or environment (REQ-ADP-003,
 * NFR2-DET-001). The same code runs in the browser (Code tab) and in vitest
 * (goldens, CI).
 */
import { nodeMap } from '../../graph/containment'
import type { ArchGraphV2 } from '../../graph/types'
import { GENERATOR_VERSION } from '../versions'
import type { IacAdapter } from './adapter'
import { isProblem, resolveAssignment } from './context'
import { resolveCoverage } from './coverage'
import { neutralGate, sortProblems } from './gate'
import { designFingerprint, manifestFile } from './manifest'
import { coverageMarkdown, manualStepsMarkdown, problemLines, type PackageHeader } from './markdown'
import { coreManualSteps } from './manualSteps'
import type { AdapterRegistry } from './registry'
import { lintFiles } from './secrets'
import { byCodeUnit, kebab, mdCode } from './text'
import type { CoverageReport, ExportOptions, GeneratedFile, IacProblem, TargetContext } from './types'
import { buildZip } from './zip'

export interface GenerateRequest {
  profileId: string
  /** Defaults to the profile's `iacAdapter` when registered, else the first adapter for the target kind. */
  adapterId?: string
  options: ExportOptions
  /** Allow adapters registered as `test` (stubs, spikes). Never set by the UI. */
  allowTestAdapters?: boolean
}

export interface PackageResult {
  ok: boolean
  problems: IacProblem[]
  coverage?: CoverageReport
  adapter?: { id: string; version: string; tool: string }
  /** Root folder inside the zip: one per target profile. */
  rootFolder?: string
  zipName?: string
  /** Sorted by path. Empty when `ok` is false. */
  files: GeneratedFile[]
  emittedFiles?: readonly string[]
}

function pickAdapter(doc: ArchGraphV2, request: GenerateRequest, registry: AdapterRegistry, targetKind: string, preferred?: string): IacAdapter | undefined {
  const usable = (id: string | undefined) => {
    if (!id) return undefined
    const entry = registry.get(id)
    if (!entry || !entry.adapter.targetKinds.includes(targetKind)) return undefined
    return entry.status === 'shipped' || request.allowTestAdapters ? entry.adapter : undefined
  }
  return usable(request.adapterId) ?? usable(preferred) ?? registry.forTarget(targetKind, request.allowTestAdapters)[0]?.adapter
}

/** Coverage without generation (REQ-ADP-002): what badges and the Target tab use. */
export function coverageFor(doc: ArchGraphV2, request: Omit<GenerateRequest, 'options'>, registry: AdapterRegistry): CoverageReport | IacProblem {
  const assignment = resolveAssignment(doc, request.profileId)
  if (isProblem(assignment)) return assignment
  const adapter = pickAdapter(doc, { ...request, options: { pipeline: 'none' } }, registry, assignment.profile.target, assignment.profile.iacAdapter)
  // A registered but not-shipped adapter still supplies its catalogue, so rows
  // resolve honestly; its generatable rows are downgraded to manual (design-v2 4.3.6 step 4).
  const any = adapter ?? pickAdapter(doc, { ...request, options: { pipeline: 'none' }, allowTestAdapters: true }, registry, assignment.profile.target, assignment.profile.iacAdapter)
  const catalogue = any?.catalogue ?? { target: assignment.profile.target, version: '0.0.0', realisations: [], aliases: [], accessPairs: [], unmappedAccess: 'manual' as const }
  return resolveCoverage({ doc, assignment, catalogue, adapterId: any?.id, canGenerate: adapter !== undefined })
}

export function buildContext(doc: ArchGraphV2, request: GenerateRequest, registry: AdapterRegistry): { ctx: TargetContext; adapter: IacAdapter } | IacProblem {
  const assignment = resolveAssignment(doc, request.profileId)
  if (isProblem(assignment)) return assignment
  const adapter = pickAdapter(doc, request, registry, assignment.profile.target, assignment.profile.iacAdapter)
  if (!adapter) {
    return {
      severity: 'error', ruleId: 'IAC-E08', path: 'deployment.profiles',
      message: {
        en: `No adapter can generate code for target ${assignment.profile.target}; every component is manual.`,
        vi: `Không có adapter sinh mã cho đích ${assignment.profile.target}; mọi thành phần là thủ công.`,
      },
      fix: { en: 'Download the manual checklist instead.', vi: 'Hãy tải danh sách việc thủ công.' },
    }
  }
  const coverage = resolveCoverage({ doc, assignment, catalogue: adapter.catalogue, adapterId: adapter.id, canGenerate: true })
  const options = { ...Object.fromEntries(adapter.variableSchema.filter((field) => field.default !== undefined).map((field) => [field.key, field.default!])), ...(assignment.profile.options ?? {}) }
  const ctx: TargetContext = {
    doc, profile: assignment.profile, ...(assignment.scenario ? { scenarioId: assignment.scenario.id } : {}),
    onTarget: assignment.onTarget, byId: nodeMap(doc), coverage, options,
  }
  return { ctx, adapter }
}

export function rootFolderFor(doc: ArchGraphV2, profileId: string): string {
  return `${kebab(doc.settings.codeName)}-${kebab(profileId)}`
}

export function generatePackage(doc: ArchGraphV2, request: GenerateRequest, registry: AdapterRegistry): PackageResult {
  const built = buildContext(doc, request, registry)
  if ('ruleId' in built) return { ok: false, problems: [built], files: [] }
  const { ctx, adapter } = built
  const adapterInfo = { id: adapter.id, version: adapter.version, tool: adapter.tool }
  const base = { coverage: ctx.coverage, adapter: adapterInfo, rootFolder: rootFolderFor(doc, ctx.profile.id), zipName: `${kebab(doc.settings.codeName)}-${adapter.id}.zip`, emittedFiles: adapter.emittedFiles }

  if (request.options.pipeline !== 'none' && !adapter.pipelineTemplates.includes(request.options.pipeline)) {
    return { ...base, ok: false, files: [], problems: [{ severity: 'error', ruleId: 'IAC-E07', path: 'options.pipeline',
      message: { en: `${adapter.id} ${adapter.version} has no ${request.options.pipeline} pipeline yet.`, vi: `${adapter.id} ${adapter.version} chưa có pipeline ${request.options.pipeline}.` } }] }
  }

  const problems = [...neutralGate(ctx, adapter)]
  if (!problems.some((problem) => problem.severity === 'error')) problems.push(...adapter.gate(ctx))
  if (problems.some((problem) => problem.severity === 'error')) return { ...base, ok: false, problems: sortProblems(problems), files: [] }

  const ir = adapter.plan(ctx)
  problems.push(...(ir.problems ?? []))
  if (problems.some((problem) => problem.severity === 'error')) return { ...base, ok: false, problems: sortProblems(problems), files: [] }

  const sorted = sortProblems(problems)
  const header: PackageHeader = {
    designCodeName: doc.settings.codeName, profileId: ctx.profile.id, target: ctx.profile.target,
    adapterId: adapter.id, adapterVersion: adapter.version, generatorVersion: GENERATOR_VERSION,
  }
  const steps = [...coreManualSteps(ctx, adapter.catalogue), ...adapter.manualSteps(ctx)]
  const files: GeneratedFile[] = [
    ...adapter.files(ir, ctx, request.options),
    { path: 'COVERAGE.md', content: coverageMarkdown(header, ctx.coverage) },
    { path: 'MANUAL-STEPS.md', content: manualStepsMarkdown(header, doc, ctx.coverage, steps) },
    { path: 'README.md', content: readme(header, ctx, sorted, adapter.readme?.(ir, ctx, request.options) ?? []) },
  ]
  const lint = lintFiles(files)
  if (lint.length > 0) return { ...base, ok: false, problems: sortProblems([...problems, ...lint]), files: [] }
  files.push(manifestFile({
    adapter: adapterInfo, generatorVersion: GENERATOR_VERSION, designCodeName: doc.settings.codeName, designId: request.options.designId,
    fingerprint: designFingerprint(doc, ctx.profile, ctx.onTarget), profileId: ctx.profile.id, target: ctx.profile.target, providerPins: adapter.providerPins,
    pipeline: request.options.pipeline, totals: ctx.coverage.totals, files,
  }))
  for (const file of files) {
    if (file.content.includes('\r') || file.content.includes('\t') || !file.content.endsWith('\n')) {
      throw new Error(`${file.path}: generated text must be LF-only, tab-free and end with a newline`)
    }
  }
  return { ...base, ok: true, problems: sorted, files: files.sort((a, b) => byCodeUnit(a.path, b.path)) }
}

function readme(header: PackageHeader, ctx: TargetContext, problems: IacProblem[], adapterSections: string[]): string {
  const t = ctx.coverage.totals
  const notes = problems.filter((problem) => problem.severity !== 'error')
  const parts = [
    `# ${mdCode(header.designCodeName)} on ${mdCode(header.profileId)}`,
    '',
    `Generated by ArchPilot: adapter ${mdCode(header.adapterId)} ${header.adapterVersion}, generator ${header.generatorVersion}.`,
    'This package is derived from the design. Edit the design and generate again rather than editing these files.',
    '',
    '> ArchPilot did not run this code against a real environment. Offline validation proves syntax and',
    '> schema only; a real run can still fail on quotas, permissions, names or versions.',
    '',
    '## Coverage',
    '',
    `${t.generatable} generatable, ${t.manual} manual, ${t.unsupported} unsupported, ${t.annotation} annotation, ${t.other} on another target.`,
    'See `COVERAGE.md` for every node and edge, and `MANUAL-STEPS.md` for what you must do by hand.',
    '',
    ...adapterSections,
    '',
    '## Warnings',
    '',
    ...(notes.length > 0 ? problemLines(notes) : ['None.']),
  ]
  return `${parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`
}

/** One zip, one root folder per successful package (REQ-IAC-009, REQ-IAC-027). */
export function packageZip(results: PackageResult[]): Uint8Array {
  const ok = results.filter((result) => result.ok)
  if (ok.length !== results.length || ok.length === 0) throw new Error('only successful packages can be zipped')
  return buildZip(ok.map((result) => ({ root: result.rootFolder!, files: result.files, allowed: result.emittedFiles ?? [] })))
}

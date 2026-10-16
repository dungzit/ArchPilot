/**
 * `archpilot-manifest.json` and the design fingerprint (design-v2 4.4.7;
 * REQ-IAC-020, REQ-ADP-007, C-v2-1).
 *
 * Sorted keys, two-space indent, LF, trailing newline. No timestamps,
 * revision numbers or user names. Files are listed with their SHA-256; the
 * manifest does not list itself.
 *
 * The fingerprint covers only what can change the output. Labels, positions,
 * sizes, rationale, array order and profile or scenario labels are left out,
 * so a label rename or a node move leaves every byte unchanged
 * (NFR2-DET-002/003).
 */
import { contentHash, sha256Hex } from '../../graph/hash'
import type { ArchGraphV2, TargetProfile } from '../../graph/types'
import { byCodeUnit } from './text'
import type { CoverageTotals, GeneratedFile, PipelineChoice } from './types'

export const MANIFEST_PATH = 'archpilot-manifest.json'

const byId = <T extends { id: string }>(a: T, b: T) => byCodeUnit(a.id, b.id)

export function generationProjection(doc: ArchGraphV2, profile: TargetProfile, onTarget: Iterable<string>): unknown {
  const deployment = doc.deployment
  return {
    settings: { codeName: doc.settings.codeName, environment: doc.settings.environment },
    nodes: [...doc.nodes].sort(byId).map((node) => ({
      id: node.id, type: node.type, variant: node.variant, codeName: node.codeName, parentId: node.parentId,
      attributes: node.attributes, config: node.config,
      sizing: node.sizing ? { scenarioId: node.sizing.scenarioId, formulaVersion: node.sizing.formulaVersion, summary: node.sizing.summary, stale: node.sizing.stale } : undefined,
    })),
    edges: [...doc.edges].sort(byId).map((edge) => ({
      id: edge.id, source: edge.source, target: edge.target, direction: edge.direction, kind: edge.kind, mode: edge.mode, protocol: edge.protocol, port: edge.port,
    })),
    // Only the generated profile's inputs: another target's profile, bindings or
    // scenarios never change this package (retarget away and back, NFR2-DET-002).
    target: {
      profile: { id: profile.id, target: profile.target, options: profile.options, iacAdapter: profile.iacAdapter },
      bindings: [...(deployment?.bindings ?? [])]
        .filter((binding) => binding.target === profile.target)
        .sort((a, b) => byCodeUnit(a.nodeId, b.nodeId))
        .map((binding) => ({ nodeId: binding.nodeId, realisation: binding.realisation, config: binding.config })),
      onTarget: [...onTarget].sort(byCodeUnit),
    },
  }
}

export function designFingerprint(doc: ArchGraphV2, profile: TargetProfile, onTarget: Iterable<string>): string {
  return contentHash(generationProjection(doc, profile, onTarget))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort(byCodeUnit)) {
      const item = (value as Record<string, unknown>)[key]
      if (item !== undefined) out[key] = sortKeys(item)
    }
    return out
  }
  return value
}

/** Pretty JSON with keys sorted by code unit at every depth, LF, trailing newline. */
export function stableJson(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`
}

export interface ManifestInput {
  adapter: { id: string; version: string; tool: string }
  generatorVersion: string
  designCodeName: string
  designId?: string
  fingerprint: string
  profileId: string
  target: string
  providerPins: { source: string; constraint: string }[]
  pipeline: PipelineChoice
  totals: CoverageTotals
  files: GeneratedFile[]
}

export function manifestFile(input: ManifestInput): GeneratedFile {
  const files = input.files
    .filter((file) => file.path !== MANIFEST_PATH)
    .map((file) => ({ path: file.path, sha256: sha256Hex(file.content) }))
    .sort((a, b) => byCodeUnit(a.path, b.path))
  const manifest = {
    manifestVersion: 1,
    adapter: input.adapter,
    generator: { version: input.generatorVersion },
    design: { codeName: input.designCodeName, id: input.designId, fingerprint: input.fingerprint },
    target: { profileId: input.profileId, kind: input.target },
    providerPins: [...input.providerPins].sort((a, b) => byCodeUnit(a.source, b.source)),
    pipeline: input.pipeline,
    coverage: input.totals,
    files,
  }
  return { path: MANIFEST_PATH, content: stableJson(manifest) }
}

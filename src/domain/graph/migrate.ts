/**
 * Schema migration (task 0.3; design-v2 4.3.4 as corrected by the red-team
 * review). Pure and deterministic: the same input always yields the same
 * output, byte for byte after JSON.stringify.
 *
 * 1.0 -> 2.0:
 * - types through the catalogue's `legacyTypes['1.0']` (database ->
 *   relational_db, object_store -> object_storage, external_api ->
 *   external_service); the map is data, shared with the Python suite;
 * - codeName from the label (Vietnamese folding, uniqueness suffix);
 * - `props` -> `config` (verbatim), `sizingScenarioId` -> a stale `sizing`;
 * - every edge becomes `kind: 'flow'` (1.0 had no access semantics, so no
 *   edge may silently start producing firewall rules or permissions);
 * - `settings` added; NO `deployment` is added. Requirements v2.1 REQ-TGT-003
 *   says the target starts unset; design v0.2's default AWS profile was
 *   dropped per review B1(g).
 *
 * The shared pair `contracts/fixtures/archgraph.migration-v1.*.valid.json`
 * pins the exact output (src/contracts/contract.test.ts).
 */
import { catalog } from './catalog'
import { toCodeName, uniqueCodeName } from './codeName'
import type { ArchEdgeV2, ArchGraph, ArchGraphV1, ArchGraphV2, ArchNodeV2, DesignSettings } from './types'

export interface MigrateOptions {
  /** The design's name; becomes settings.codeName. Default "design". */
  name?: string
  /** settings.environment. Default "dev". */
  environment?: string
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MigrationError'
  }
}

export function isGraphV2(document: ArchGraph): document is ArchGraphV2 {
  return document.schemaVersion === '2.0'
}

/** Bring any supported document to the current schema (2.0). A 2.0 document is returned unchanged. */
export function migrateGraph(document: ArchGraph, options: MigrateOptions = {}): ArchGraphV2 {
  if (document.schemaVersion === '2.0') return document
  if (document.schemaVersion === '1.0') return migrateV1(document, options)
  throw new MigrationError(`unsupported schemaVersion ${JSON.stringify((document as { schemaVersion?: unknown }).schemaVersion)}`)
}

function migrateV1(document: ArchGraphV1, options: MigrateOptions): ArchGraphV2 {
  const typeMap = catalog.legacyTypes['1.0']
  const taken = new Set<string>()

  const nodes = document.nodes.map((legacy): ArchNodeV2 => {
    const ref = Object.prototype.hasOwnProperty.call(typeMap, legacy.type) ? typeMap[legacy.type] : undefined
    if (!ref) throw new MigrationError(`node ${legacy.id}: 1.0 type ${JSON.stringify(legacy.type)} has no 2.0 role`)
    const codeName = uniqueCodeName(toCodeName(legacy.label, ref.role), taken)
    taken.add(codeName)
    const node: ArchNodeV2 = {
      id: legacy.id,
      type: ref.role,
      ...(ref.variant ? { variant: ref.variant } : {}),
      label: legacy.label,
      codeName,
      position: { x: legacy.position.x, y: legacy.position.y },
    }
    if (legacy.props && Object.keys(legacy.props).length > 0) node.config = { ...legacy.props }
    if (legacy.rationale !== undefined) node.rationale = legacy.rationale
    if (legacy.sizingScenarioId) node.sizing = { scenarioId: legacy.sizingScenarioId, stale: true }
    return node
  })

  const edges = document.edges.map((legacy): ArchEdgeV2 => {
    const edge: ArchEdgeV2 = {
      id: legacy.id,
      source: legacy.source,
      target: legacy.target,
      label: legacy.label,
      direction: legacy.direction,
      kind: 'flow',
    }
    if (legacy.rationale !== undefined) edge.rationale = legacy.rationale
    return edge
  })

  const settings: DesignSettings = {
    codeName: options.name ? toCodeName(options.name, 'design') : 'design',
    environment: options.environment ?? 'dev',
    catalogueVersion: catalog.version,
  }
  return { schemaVersion: '2.0', settings, nodes, edges }
}

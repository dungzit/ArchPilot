/**
 * Pair defaults for a new edge (task 2.4; REQ-DES-005, design-v2 4.2.6).
 *
 * kind:  `access` when the source role can use the target role in some mode
 *        (catalogue accessModes: asSource of the source intersected with
 *        asTarget of the target) and neither end is an annotation; otherwise
 *        `flow` (visual only, no code).
 * mode:  the first common mode in MODE_PREFERENCE.
 * port:  from the target role, neutral and optional: relational_db 5432 or
 *        3306 by engine family, cache 6379, a service's own port, https 443
 *        for the edge/entry roles.
 * label: the catalogue's wording of the mode ("reads and writes"), in the
 *        user's language, so the label is never empty (DES-I01).
 */
import { catalog, getRole, type ArchGraphV2, type Bilingual, type EdgeKind, type EdgeMode, type EdgeProtocol } from '../../../domain/graph'

export const MODE_PREFERENCE: EdgeMode[] = [
  'read_write', 'connect', 'send', 'publish', 'write', 'read', 'consume', 'send_consume', 'deliver', 'replicate',
]

const ANNOTATION_ROLES = new Set(['note', 'shape', 'text'])

export interface EdgeDefaults {
  kind: EdgeKind
  mode?: EdgeMode
  protocol?: EdgeProtocol
  port?: number
  label: string
}

/** Modes valid for an access edge from `sourceRole` to `targetRole`, in preference order. */
export function commonModes(sourceRole: string, targetRole: string): EdgeMode[] {
  const source = getRole(sourceRole)
  const target = getRole(targetRole)
  if (!source || !target || ANNOTATION_ROLES.has(source.id) || ANNOTATION_ROLES.has(target.id)) return []
  const asTarget = new Set(target.accessModes.asTarget)
  return MODE_PREFERENCE.filter((mode) => source.accessModes.asSource.includes(mode) && asTarget.has(mode))
}

export function modeLabel(mode: EdgeMode): Bilingual {
  return catalog.edgeModes.find((entry) => entry.id === mode)?.label ?? { en: mode, vi: mode }
}

function configValue(document: ArchGraphV2, nodeId: string, key: string): unknown {
  return document.nodes.find((node) => node.id === nodeId)?.config?.[key]
}

export function defaultPort(document: ArchGraphV2, targetId: string): { protocol: EdgeProtocol; port: number } | undefined {
  const target = document.nodes.find((node) => node.id === targetId)
  if (!target) return undefined
  switch (target.type) {
    case 'relational_db': {
      const engine = String(configValue(document, targetId, 'engine') ?? '').toLowerCase()
      return { protocol: 'tcp', port: engine.includes('mysql') || engine.includes('maria') ? 3306 : 5432 }
    }
    case 'cache':
      return { protocol: 'tcp', port: 6379 }
    case 'service': {
      const port = configValue(document, targetId, 'port')
      return { protocol: 'http', port: typeof port === 'number' ? port : 8080 }
    }
    case 'load_balancer':
    case 'api_gateway':
    case 'cdn':
    case 'reverse_proxy':
    case 'external_service':
      return { protocol: 'https', port: 443 }
    default:
      return undefined
  }
}

export function edgeDefaults(document: ArchGraphV2, sourceId: string, targetId: string, language: keyof Bilingual): EdgeDefaults {
  const source = document.nodes.find((node) => node.id === sourceId)
  const target = document.nodes.find((node) => node.id === targetId)
  if (!source || !target) return { kind: 'flow', label: '' }
  const modes = commonModes(source.type, target.type)
  if (modes.length === 0) {
    return { kind: 'flow', label: language === 'vi' ? 'luồng' : 'flow' }
  }
  const mode = modes[0]
  const port = defaultPort(document, targetId)
  return { kind: 'access', mode, label: modeLabel(mode)[language], ...(port ?? {}) }
}

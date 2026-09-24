/**
 * The logical component catalogue (task 0.6), TypeScript side.
 *
 * `contracts/catalog/components.json` is bundled at build time (it is data
 * coupled to this code's version, like the contract). The backend reads the
 * same file (`backend/app/catalog.py`) for catalogue membership only; every
 * meaning - palette groups, NEST rules, access modes, search - lives here.
 *
 * Pure: no I/O, no clock, no locale-dependent calls.
 */
import catalogJson from '../../../contracts/catalog/components.json'
import type { Bilingual, EdgeMode, NodeAttributes, SizeClass } from './types'
import { foldForSearch } from './codeName'

export type Priority = 'must' | 'should' | 'could'
export type FieldKind = 'text' | 'int' | 'number' | 'bool' | 'enum' | 'list'

export interface FieldDescriptor {
  key: string
  kind: FieldKind
  label: Bilingual
  values?: string[]
  min?: number
  max?: number
  maxLength?: number
  default?: string | number | boolean
  unit?: string
  required?: boolean
}

export interface CatalogRole {
  id: string
  layer: string
  priority: Priority
  label: Bilingual
  purpose: Bilingual
  synonyms: string[]
  variants?: { id: string; label: Bilingual }[]
  defaultVariant?: string
  container: boolean
  codeBearing: boolean
  defaultAttributes: Pick<NodeAttributes, 'statefulness' | 'tier' | 'criticality' | 'replicas' | 'failureDomainLevel'>
  accessModes: { asSource: EdgeMode[]; asTarget: EdgeMode[] }
  fields: FieldDescriptor[]
}

export interface NestRule {
  id: string
  kind: 'child' | 'container'
  roles: string[]
  /** kind=child: allowed parents; 'root' = top level, '*' = top level or any container. */
  parents?: string[]
  /** kind=container: the only roles this container accepts. */
  accepts?: string[]
  message: Bilingual
}

export interface RoleRef { role: string; variant?: string }

export interface ComponentCatalog {
  catalog: 'archpilot-components'
  version: string
  limits: { maxNestingDepth: number }
  layers: { id: string; order: number; label: Bilingual }[]
  attributes: FieldDescriptor[]
  sizeClasses: Record<SizeClass, { vcpu: number; memoryGiB: number }>
  edgeModes: { id: EdgeMode; label: Bilingual }[]
  roles: CatalogRole[]
  nestRules: NestRule[]
  legacyTypes: Record<string, Record<string, RoleRef>>
  aliases: Record<string, RoleRef>
}

/** The bundled catalogue. A structural check below fails fast on a bad build. */
export const catalog: ComponentCatalog = assertCatalogShape(catalogJson as unknown)

const roleIndex: ReadonlyMap<string, CatalogRole> = new Map(catalog.roles.map((role) => [role.id, role]))

export function getRole(id: string): CatalogRole | undefined {
  return roleIndex.get(id)
}

export function isRole(id: unknown): id is string {
  return typeof id === 'string' && roleIndex.has(id)
}

export function variantsOf(roleId: string): string[] {
  return getRole(roleId)?.variants?.map((variant) => variant.id) ?? []
}

/** The canonical role for an alias or a legacy id (used for migration and for hints). */
export function canonicalFor(name: string): RoleRef | undefined {
  if (Object.prototype.hasOwnProperty.call(catalog.aliases, name)) return catalog.aliases[name]
  for (const typeMap of Object.values(catalog.legacyTypes)) {
    if (Object.prototype.hasOwnProperty.call(typeMap, name)) return typeMap[name]
  }
  return undefined
}

export function describeRoleRef(ref: RoleRef): string {
  return ref.variant ? `${ref.role} (variant ${ref.variant})` : ref.role
}

/** Roles grouped by layer, layers in catalogue order, roles in catalogue order (the palette). */
export function rolesByLayer(): { layer: ComponentCatalog['layers'][number]; roles: CatalogRole[] }[] {
  return [...catalog.layers]
    .sort((a, b) => a.order - b.order)
    .map((layer) => ({ layer, roles: catalog.roles.filter((role) => role.layer === layer.id) }))
}

/**
 * Palette search (design-v2 4.2.4): folds Vietnamese diacritics and matches
 * the label in both languages, the id, the synonyms and alias names. Ranking:
 * exact label or id, then prefix, then substring; ties keep catalogue order,
 * so the result is deterministic.
 */
export function searchRoles(query: string): CatalogRole[] {
  const q = foldForSearch(query).trim()
  if (!q) return [...catalog.roles]
  const aliasNames = new Map<string, string[]>()
  for (const [name, ref] of Object.entries(catalog.aliases)) {
    aliasNames.set(ref.role, [...(aliasNames.get(ref.role) ?? []), name.replace(/_/g, ' ')])
  }
  const scored: { role: CatalogRole; score: number; order: number }[] = []
  catalog.roles.forEach((role, order) => {
    const primary = [role.label.en, role.label.vi, role.id.replace(/_/g, ' ')].map(foldForSearch)
    const secondary = [...role.synonyms, ...(aliasNames.get(role.id) ?? [])].map(foldForSearch)
    let score = 0
    if (primary.some((text) => text === q)) score = 4
    else if (secondary.some((text) => text === q)) score = 3
    else if ([...primary, ...secondary].some((text) => text.startsWith(q))) score = 2
    else if ([...primary, ...secondary].some((text) => text.includes(q))) score = 1
    if (score > 0) scored.push({ role, score, order })
  })
  return scored.sort((a, b) => b.score - a.score || a.order - b.order).map((entry) => entry.role)
}

/** The value an attribute takes when the node does not set it (catalogue default). */
export function roleDefaultAttributes(roleId: string): CatalogRole['defaultAttributes'] {
  return getRole(roleId)?.defaultAttributes ?? {}
}

function assertCatalogShape(value: unknown): ComponentCatalog {
  const candidate = value as Partial<ComponentCatalog> | null
  if (
    !candidate ||
    candidate.catalog !== 'archpilot-components' ||
    typeof candidate.version !== 'string' ||
    !Array.isArray(candidate.roles) ||
    !Array.isArray(candidate.nestRules) ||
    typeof candidate.limits?.maxNestingDepth !== 'number'
  ) {
    throw new Error('contracts/catalog/components.json is missing or malformed')
  }
  return candidate as ComponentCatalog
}

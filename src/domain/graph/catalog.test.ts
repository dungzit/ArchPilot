/**
 * The component catalogue (task 0.6) - the TypeScript half. Mirrors
 * backend/tests/test_catalog.py: schema, cross-references, agreement with the
 * wire contract, requirements v2.1 coverage (review B1), neutrality - plus the
 * TS-only behaviour: palette grouping and diacritic-folding search.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020'
import { describe, expect, it } from 'vitest'
import { catalog, canonicalFor, getRole, isRole, rolesByLayer, searchRoles, variantsOf } from './catalog'
import { neutralityHits } from '../../test/neutrality'

const contractsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../contracts')
const readJson = (path: string) => JSON.parse(readFileSync(resolve(contractsDir, path), 'utf-8'))
const schema = readJson('catalog/components.schema.json')
const contract = readJson('archgraph.schema.json')

const AjvCtor = ((Ajv2020 as unknown as { default?: typeof Ajv2020 }).default ?? Ajv2020) as typeof Ajv2020

const V21_MUST = ['dns', 'cdn', 'api_gateway', 'load_balancer', 'firewall', 'site', 'zone', 'network_segment', 'virtual_machine', 'container_platform', 'bare_metal_host', 'hypervisor_cluster', 'service', 'relational_db', 'key_value_store', 'cache', 'object_storage', 'block_storage', 'file_storage', 'san', 'backup_target', 'queue', 'identity_provider', 'secrets_vault', 'client', 'external_service', 'note', 'shape', 'text']
const V21_SHOULD = ['waf', 'reverse_proxy', 'ddos_protection', 'router', 'switch', 'vpn_link', 'function', 'document_db', 'search_index', 'pubsub_topic', 'event_stream', 'key_management', 'siem_log_store', 'certificate_authority', 'monitoring']

describe('catalogue data', () => {
  it('matches its own JSON Schema (same file the Python loader validates against)', () => {
    const validate = new AjvCtor({ strict: false, allErrors: true }).compile(schema)
    const ok = validate(catalog)
    expect(validate.errors ?? []).toEqual([])
    expect(ok).toBe(true)
  })

  it('has about forty roles in eleven layers, each layer used', () => {
    expect(catalog.roles.length).toBeGreaterThanOrEqual(38)
    expect(catalog.roles.length).toBeLessThanOrEqual(48)
    expect(catalog.layers).toHaveLength(11)
    expect(new Set(catalog.roles.map((role) => role.layer))).toEqual(new Set(catalog.layers.map((layer) => layer.id)))
  })

  it('covers requirements v2.1 Must and Should roles with the v2.1 ids and priorities', () => {
    for (const id of V21_MUST) expect(getRole(id)?.priority, id).toBe('must')
    for (const id of V21_SHOULD) expect(getRole(id)?.priority, id).toBe('should')
    expect(new Set(catalog.roles.map((role) => role.id))).toEqual(new Set([...V21_MUST, ...V21_SHOULD, 'artifact_registry']))
  })

  it('models on-prem equipment as first-class roles', () => {
    for (const id of ['bare_metal_host', 'hypervisor_cluster', 'san', 'file_storage', 'switch', 'router', 'firewall', 'load_balancer', 'backup_target']) {
      expect(isRole(id), id).toBe(true)
    }
    expect(catalog.roles.filter((role) => role.container).map((role) => role.id).sort()).toEqual(
      ['container_platform', 'hypervisor_cluster', 'network_segment', 'site', 'zone'],
    )
  })

  it('puts every role under exactly one child NEST rule and only containers as parents', () => {
    const childRules = catalog.nestRules.filter((rule) => rule.kind === 'child')
    for (const role of catalog.roles) {
      expect(childRules.filter((rule) => rule.roles.includes(role.id)).map((rule) => rule.id), role.id).toHaveLength(1)
    }
    const containers = new Set(catalog.roles.filter((role) => role.container).map((role) => role.id))
    for (const rule of catalog.nestRules) {
      for (const parent of rule.parents ?? []) expect(parent === 'root' || parent === '*' || containers.has(parent), `${rule.id} ${parent}`).toBe(true)
      for (const child of rule.accepts ?? []) expect(isRole(child), `${rule.id} ${child}`).toBe(true)
    }
  })

  it('resolves aliases and legacy ids to real roles and variants, and no alias shadows a role', () => {
    for (const [name, ref] of [...Object.entries(catalog.aliases), ...Object.entries(catalog.legacyTypes['1.0'])]) {
      expect(isRole(ref.role), name).toBe(true)
      if (ref.variant) expect(variantsOf(ref.role), name).toContain(ref.variant)
    }
    for (const alias of Object.keys(catalog.aliases)) expect(isRole(alias), alias).toBe(false)
    expect(canonicalFor('database')).toEqual({ role: 'relational_db' })
    expect(canonicalFor('subnet')).toEqual({ role: 'network_segment', variant: 'subnet' })
    expect(canonicalFor('nope')).toBeUndefined()
  })

  it('keeps field defaults inside their own ranges and value lists', () => {
    for (const role of catalog.roles) {
      for (const field of role.fields) {
        if (field.default === undefined) continue
        if (field.kind === 'enum') expect(field.values, `${role.id}.${field.key}`).toContain(field.default)
        if (field.kind === 'int' || field.kind === 'number') {
          expect(field.default as number, `${role.id}.${field.key}`).toBeGreaterThanOrEqual(field.min ?? -Infinity)
          expect(field.default as number, `${role.id}.${field.key}`).toBeLessThanOrEqual(field.max ?? Infinity)
        }
      }
      if (role.defaultVariant) expect(variantsOf(role.id)).toContain(role.defaultVariant)
    }
  })

  it('bears no code for annotations and external nodes (REQ-DES-016)', () => {
    for (const id of ['note', 'shape', 'text', 'client', 'external_service']) expect(getRole(id)?.codeBearing, id).toBe(false)
  })
})

describe('catalogue agrees with the wire contract', () => {
  it('legacy 1.0 types are exactly the frozen 1.0 enum', () => {
    expect(Object.keys(catalog.legacyTypes['1.0']).sort()).toEqual([...contract.$defs.nodeType.enum].sort())
  })

  it('attribute enums and edge modes are the contract enums', () => {
    const props = contract.$defs.nodeAttributes.properties
    expect(catalog.attributes.map((attribute) => attribute.key).sort()).toEqual(Object.keys(props).sort())
    for (const attribute of catalog.attributes.filter((a) => a.kind === 'enum')) {
      expect(attribute.values, attribute.key).toEqual(props[attribute.key].enum)
    }
    expect(catalog.edgeModes.map((mode) => mode.id)).toEqual(contract.$defs.edgeMode.enum)
  })

  it('every role id fits the contract role pattern', () => {
    const pattern = new RegExp(contract.$defs.roleId.pattern)
    for (const role of catalog.roles) expect(role.id).toMatch(pattern)
  })
})

describe('NFR2-NEUT-001', () => {
  it('the scanner finds tokens (negative control) and only whole words', () => {
    expect(neutralityHits({ label: 'Amazon RDS for PostgreSQL' })).toEqual([['$.label', 'amazon'], ['$.label', 'rds']])
    expect(neutralityHits({ vsphere: 1 })).toEqual([['$.vsphere', 'vsphere']])
    expect(neutralityHits({ label: 'cards' })).toEqual([])
  })

  it('the catalogue contains no provider or vendor term', () => {
    const { description: _description, ...content } = readJson('catalog/components.json')
    expect(neutralityHits(content)).toEqual([])
  })
})

describe('palette helpers', () => {
  it('groups roles by layer in catalogue order', () => {
    const groups = rolesByLayer()
    expect(groups.map((group) => group.layer.order)).toEqual([...groups.map((group) => group.layer.order)].sort((a, b) => a - b))
    expect(groups.flatMap((group) => group.roles)).toHaveLength(catalog.roles.length)
    expect(groups[0].roles.map((role) => role.id)).toContain('client')
  })

  it.each([
    ['VLAN', 'network_segment'],
    ['nas', 'file_storage'],
    ['cân bằng tải', 'load_balancer'],
    ['can bang tai', 'load_balancer'],
    ['máy chủ vật lý', 'bare_metal_host'],
    ['kubernetes', 'container_platform'],
    ['Cơ sở dữ liệu quan hệ', 'relational_db'],
    ['worker', 'service'],
    ['subnet', 'network_segment'],
  ])('search %s finds %s first', (query, expected) => {
    expect(searchRoles(query)[0]?.id).toBe(expected)
  })

  it('an empty query lists everything and nonsense finds nothing', () => {
    expect(searchRoles('  ')).toHaveLength(catalog.roles.length)
    expect(searchRoles('zzzz-no-such-thing')).toEqual([])
  })
})

/**
 * AWS target options and curated value lists (design-v2 4.4.8; IAC-E07).
 * Curated lists keep `validate`-green code from failing at `plan` on a
 * typo (NFR2-COR-003). A change here is an adapter version bump.
 */
import { getRole } from '../../../graph/catalog'
import type { ArchNodeV2, ConfigValue, SizeClass } from '../../../graph/types'
import type { FieldDescriptor } from '../../../graph/catalog'
import { kebab } from '../../core/text'
import type { TargetContext } from '../../core/types'
import type { NatMode } from './topology'

export const AWS_VARIABLE_SCHEMA: FieldDescriptor[] = [
  { key: 'region', kind: 'text', label: { en: 'AWS region', vi: 'Vùng AWS' }, default: 'ap-southeast-1', required: true },
  { key: 'nat', kind: 'enum', label: { en: 'NAT gateways', vi: 'Cổng NAT' }, values: ['none', 'single', 'perZone'], default: 'single' },
  { key: 'projectName', kind: 'text', label: { en: 'Project name (1-16 characters)', vi: 'Tên dự án (1-16 ký tự)' }, maxLength: 16 },
  { key: 'environment', kind: 'text', label: { en: 'Environment', vi: 'Môi trường' }, maxLength: 16 },
]

export const REGION_PATTERN = /^[a-z]{2}(-[a-z]+)+-[0-9]+$/
export const PROJECT_PATTERN = /^[a-z][a-z0-9-]{0,15}$/
export const ENVIRONMENT_PATTERN = /^[a-z][a-z0-9-]{0,15}$/

export interface AwsOptions {
  region: string
  nat: NatMode
  projectName: string
  environment: string
}

export function awsOptions(ctx: TargetContext): { options: AwsOptions; invalid: { key: string; value: string; expected: string }[] } {
  const invalid: { key: string; value: string; expected: string }[] = []
  const text = (value: ConfigValue | undefined) => (typeof value === 'string' ? value : value === undefined ? '' : String(value))
  const region = text(ctx.options.region)
  if (!REGION_PATTERN.test(region)) invalid.push({ key: 'region', value: region, expected: 'an AWS region id such as ap-southeast-1' })
  const nat = text(ctx.options.nat)
  if (!['none', 'single', 'perZone'].includes(nat)) invalid.push({ key: 'nat', value: nat, expected: 'none, single or perZone' })
  const projectName = ctx.options.projectName === undefined
    ? kebab(ctx.doc.settings.codeName).slice(0, 16).replace(/-+$/, '')
    : text(ctx.options.projectName)
  if (!PROJECT_PATTERN.test(projectName)) invalid.push({ key: 'projectName', value: projectName, expected: '1-16 lower-case letters, digits or hyphens, starting with a letter' })
  const environment = ctx.options.environment === undefined ? ctx.doc.settings.environment : text(ctx.options.environment)
  if (!ENVIRONMENT_PATTERN.test(environment)) invalid.push({ key: 'environment', value: environment, expected: '1-16 lower-case letters, digits or hyphens, starting with a letter' })
  return { options: { region, nat: (nat as NatMode), projectName, environment }, invalid }
}

// ---------------------------------------------------------------- databases

export interface EngineInfo { engine: 'postgres' | 'mysql' | 'mariadb'; majors: string[]; defaultMajor: string; port: number }

const POSTGRES: EngineInfo = { engine: 'postgres', majors: ['14', '15', '16', '17'], defaultMajor: '16', port: 5432 }
export const ENGINES: Record<string, EngineInfo> = {
  postgres: POSTGRES,
  postgresql: POSTGRES,
  mysql: { engine: 'mysql', majors: ['8.0', '8.4'], defaultMajor: '8.4', port: 3306 },
  mariadb: { engine: 'mariadb', majors: ['10.11', '11.4'], defaultMajor: '11.4', port: 3306 },
}

export const DB_INSTANCE_CLASSES = ['db.t4g.micro', 'db.t4g.small', 'db.t4g.medium', 'db.m7g.large', 'db.r7g.large']
const DB_CLASS_BY_SIZE: Record<SizeClass, string> = { XS: 'db.t4g.micro', S: 'db.t4g.small', M: 'db.t4g.medium', L: 'db.m7g.large', XL: 'db.r7g.large' }
export const DB_STORAGE_MIN = 20
export const DB_STORAGE_MAX = 65536

// ---------------------------------------------------------------- ECS

export const FARGATE_CPU = [256, 512, 1024, 2048, 4096]
export const FARGATE_MEMORY = [512, 1024, 2048, 3072, 4096, 8192, 16384]
const FARGATE_BY_SIZE: Record<SizeClass, [number, number]> = { XS: [256, 512], S: [512, 1024], M: [1024, 2048], L: [2048, 4096], XL: [4096, 8192] }
export const LOG_RETENTION_DAYS = [1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653]

export function bindingConfig(ctx: TargetContext, nodeId: string): Record<string, ConfigValue> {
  return (ctx.doc.deployment?.bindings ?? []).find((binding) => binding.nodeId === nodeId && binding.target === ctx.profile.target)?.config ?? {}
}

export function configOf(node: ArchNodeV2, key: string): ConfigValue | undefined {
  return node.config?.[key] ?? getRole(node.type)?.fields.find((field) => field.key === key)?.default
}

export interface DbSettings {
  engine: EngineInfo
  major: string
  instanceClass: string
  storageGiB: number
  storageClamped: boolean
  storageFromSizing?: { scenarioId: string; formulaVersion?: string }
  backupRetentionDays: number
  deletionProtection: boolean
  multiAz: boolean
}

export function dbSettings(ctx: TargetContext, node: ArchNodeV2): DbSettings {
  const engine = ENGINES[String(configOf(node, 'engine') ?? '')] ?? POSTGRES
  const major = String(configOf(node, 'engineMajor') ?? engine.defaultMajor)
  const size = node.attributes?.sizeClass
  const instanceClass = String(bindingConfig(ctx, node.id).instanceClass ?? (size ? DB_CLASS_BY_SIZE[size] : 'db.t4g.small'))
  const sizing = node.sizing && !node.sizing.stale ? node.sizing : undefined
  const fromSizing = sizing?.summary?.storageGiB
  const requested = typeof fromSizing === 'number' ? Math.ceil(fromSizing) : Number(configOf(node, 'storageGiB') ?? DB_STORAGE_MIN)
  const storageGiB = Math.min(DB_STORAGE_MAX, Math.max(DB_STORAGE_MIN, requested))
  return {
    engine, major, instanceClass, storageGiB, storageClamped: storageGiB !== requested,
    ...(typeof fromSizing === 'number' && sizing ? { storageFromSizing: { scenarioId: sizing.scenarioId, ...(sizing.formulaVersion ? { formulaVersion: sizing.formulaVersion } : {}) } } : {}),
    backupRetentionDays: Number(configOf(node, 'backupRetentionDays') ?? 7),
    deletionProtection: configOf(node, 'deletionProtection') !== false,
    multiAz: (node.attributes?.replicas ?? 1) >= 2,
  }
}

export interface ServiceSettings {
  cpu: number
  memoryMiB: number
  port: number
  desiredCount: number
  countFromSizing?: { scenarioId: string; formulaVersion?: string }
  logRetentionDays: number
  healthPath?: string
}

export function serviceSettings(ctx: TargetContext, node: ArchNodeV2): ServiceSettings {
  const binding = bindingConfig(ctx, node.id)
  const [cpu, memory] = FARGATE_BY_SIZE[node.attributes?.sizeClass ?? 'S']
  const sizing = node.sizing && !node.sizing.stale ? node.sizing : undefined
  const fromSizing = sizing?.summary?.nodeCount
  return {
    cpu: Number(binding.cpu ?? cpu),
    memoryMiB: Number(binding.memoryMiB ?? memory),
    port: Number(configOf(node, 'port') ?? 8080),
    desiredCount: typeof fromSizing === 'number' ? Math.ceil(fromSizing) : node.attributes?.replicas ?? 1,
    ...(typeof fromSizing === 'number' && sizing ? { countFromSizing: { scenarioId: sizing.scenarioId, ...(sizing.formulaVersion ? { formulaVersion: sizing.formulaVersion } : {}) } } : {}),
    logRetentionDays: Number(binding.logRetentionDays ?? 30),
    ...(node.config?.healthPath !== undefined ? { healthPath: String(node.config.healthPath) } : {}),
  }
}

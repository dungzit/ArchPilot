/**
 * The Terraform tool IR and its file emitters (design-v2 4.4.7, 4.4.8
 * "AWS files"; REQ-IAC-004..007). Shared by every Terraform adapter.
 *
 * Files: versions.tf (required_version + required_providers), providers.tf,
 * backend.tf (partial configuration), backend.hcl.example, locals.tf,
 * main.tf (grouped, a `# --- <codeName> (<role>) ---` header per group),
 * variables.tf, outputs.tf, terraform.tfvars, .gitignore and the static
 * .terraform.lock.hcl of the adapter version.
 */
import type { GeneratedFile, IacProblem, ToolIr } from '../core/types'
import type { ProviderPin } from '../versions'
import { attr, block, body, obj, str, type Attribute, type Block, type Expr, type HclType, type BodyItem, type HclFile } from './ir'
import { addressCollisions, blockAddresses, type NamedThing } from './naming'
import { printAttributeFile, printFile } from './printer'

export interface TfVariable {
  name: string
  type: HclType
  description: string
  default?: Expr
  sensitive?: boolean
  validations?: { condition: Expr; message: string }[]
  /** Written to terraform.tfvars (values a user must review or replace). */
  tfvars?: Expr
  comments?: string[]
  codeName?: string
}

export interface TfOutput {
  name: string
  value: Expr
  description: string
  sensitive?: boolean
  codeName?: string
}

export interface MainGroup {
  /** `orders_db (relational_db)`; printed as `# --- orders_db (relational_db) ---`. */
  title: string
  blocks: Block[]
  codeName?: string
}

export interface TerraformIr extends ToolIr {
  tool: 'terraform'
  groups: MainGroup[]
  variables: TfVariable[]
  outputs: TfOutput[]
  locals: Attribute[]
  providers: Block[]
  pins: ProviderPin[]
  requiredVersion: string
  backend: Block
  backendExample: Attribute[]
  lockFile: string
  problems: IacProblem[]
}

export function isTerraformIr(ir: ToolIr): ir is TerraformIr {
  return ir.tool === 'terraform'
}

export const TERRAFORM_FILES = [
  '.gitignore', '.terraform.lock.hcl', 'backend.hcl.example', 'backend.tf', 'locals.tf', 'main.tf',
  'outputs.tf', 'providers.tf', 'terraform.tfvars', 'variables.tf', 'versions.tf',
] as const

export const GITIGNORE = [
  '# Terraform working files. The lock file (.terraform.lock.hcl) is committed on purpose.',
  '.terraform/',
  '*.tfstate',
  '*.tfstate.*',
  '*.tfplan',
  'tfplan',
  'crash.log',
  'crash.*.log',
  '*.auto.tfvars',
  'override.tf',
  'override.tf.json',
  '*_override.tf',
  '*_override.tf.json',
  'backend.hcl',
  '',
].join('\n')

export function variableBlock(v: TfVariable): Block {
  const items: BodyItem[] = body(
    attr('type', { k: 'type', t: v.type }),
    attr('description', str(v.description)),
    v.default !== undefined && attr('default', v.default),
    v.sensitive === true && attr('sensitive', { k: 'bool', v: true }),
    ...(v.validations ?? []).map((validation) => block('validation', [], [
      attr('condition', validation.condition),
      attr('error_message', str(validation.message)),
    ])),
  )
  return block('variable', [v.name], items, { comments: v.comments })
}

export function outputBlock(o: TfOutput): Block {
  return block('output', [o.name], body(
    attr('description', str(o.description)),
    attr('value', o.value),
    o.sensitive === true && attr('sensitive', { k: 'bool', v: true }),
  ))
}

export function versionsBlock(requiredVersion: string, pins: ProviderPin[]): Block {
  return block('terraform', [], [
    attr('required_version', str(requiredVersion)),
    block('required_providers', [], pins.map((pin) => attr(pin.name, obj([['source', str(pin.source)], ['version', str(pin.constraint)]])))),
  ])
}

/** Every generated address, variable, output and local must be unique (IAC-E04). */
export function terraformAddressProblems(ir: Pick<TerraformIr, 'groups' | 'variables' | 'outputs' | 'locals'>): IacProblem[] {
  const things: NamedThing[] = [
    ...blockAddresses(ir.groups.flatMap((group) => group.blocks.map((b) => ({ block: b, codeName: group.codeName })))),
    ...ir.variables.map((v) => ({ address: `var.${v.name}`, ...(v.codeName ? { codeName: v.codeName } : {}) })),
    ...ir.outputs.map((o) => ({ address: `output.${o.name}`, ...(o.codeName ? { codeName: o.codeName } : {}) })),
    ...ir.locals.map((l) => ({ address: `local.${l.name}` })),
  ]
  return addressCollisions(things)
}

export function terraformFiles(ir: TerraformIr, header: string[]): GeneratedFile[] {
  const tf = (path: string, blocks: Block[]): GeneratedFile => ({ path, content: printFile({ header, blocks } satisfies HclFile) })
  const mainBlocks: Block[] = []
  for (const group of ir.groups) {
    group.blocks.forEach((b, index) => {
      mainBlocks.push(index === 0 ? { ...b, comments: [`--- ${group.title} ---`, ...(b.comments ?? [])] } : b)
    })
  }
  const tfvars = ir.variables.filter((v) => v.tfvars !== undefined).map((v) => attr(v.name, v.tfvars!))
  return [
    { path: '.gitignore', content: GITIGNORE },
    { path: '.terraform.lock.hcl', content: ir.lockFile.replace(/\r\n/g, '\n') },
    { path: 'backend.hcl.example', content: printAttributeFile([...header, 'Copy to backend.hcl, fill in, then: terraform init -backend-config=backend.hcl'], ir.backendExample) },
    tf('backend.tf', [block('terraform', [], [ir.backend], { comments: ['Partial configuration: values come from -backend-config=backend.hcl at init.'] })]),
    tf('locals.tf', [block('locals', [], ir.locals)]),
    tf('main.tf', mainBlocks),
    tf('outputs.tf', ir.outputs.map(outputBlock)),
    tf('providers.tf', ir.providers),
    { path: 'terraform.tfvars', content: printAttributeFile([...header, 'Review every value. CHANGE_ME values fail at plan until replaced.'], tfvars) },
    tf('variables.tf', ir.variables.map(variableBlock)),
    tf('versions.tf', [versionsBlock(ir.requiredVersion, ir.pins)]),
  ]
}

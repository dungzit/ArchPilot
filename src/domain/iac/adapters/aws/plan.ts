/**
 * AWS planning: neutral design -> Terraform IR (design-v2 4.4.8; tasks 1.3
 * and 1.4). Runs only after the gate found no error, so it may assume a
 * consistent topology.
 *
 * Security defaults (REQ-IAC-018/019, NFR2-SEC-002), all asserted by
 * security.test.ts over the IR:
 * - Security groups start empty (Terraform removes AWS's allow-all egress);
 *   every rule comes from an access edge, one port, the peer's security
 *   group. `0.0.0.0/0` appears only on an internet-facing listener ingress
 *   and on the service egress TCP 443 exception, both marked in the IR.
 * - The VPC default security group is emptied.
 * - IAM uses `aws_iam_policy_document`, one statement per purpose, no `*`
 *   in any action; `Resource "*"` only for ecr:GetAuthorizationToken, marked
 *   and commented.
 * - RDS: managed master secret, encrypted, not public, deletion protection,
 *   final snapshot. ECS: no public IP. ALB: invalid headers dropped, TLS 1.3
 *   policy.
 */
import type { ArchNodeV2 } from '../../../graph/types'
import { orderedNodes } from '../../core/context'
import { byCodeUnit, kebab, pascal, upperSnake } from '../../core/text'
import type { TargetContext } from '../../core/types'
import {
  attr, block, body, bool, call, data, list, num, obj, op, ref, resource, str, tmpl, type Block, type BodyItem, type Expr,
  type SecurityMark,
} from '../../terraform/ir'
import type { MainGroup, TerraformIr, TfOutput, TfVariable } from '../../terraform/module'
import { terraformAddressProblems } from '../../terraform/module'
import { label, resourceName } from '../../terraform/naming'
import { AWS_PROVIDER, TERRAFORM_REQUIRED_VERSION } from '../../versions'
import { generatableLinks, type AccessLink } from './gate'
import AWS_LOCK_FILE from './terraform.lock.hcl?raw'
import {
  awsOptions, configOf, dbSettings, DB_INSTANCE_CLASSES, DB_STORAGE_MAX, DB_STORAGE_MIN, FARGATE_CPU, FARGATE_MEMORY,
  LOG_RETENTION_DAYS, serviceSettings, type AwsOptions,
} from './options'
import { analyseTopology, subnetOf, type AwsSubnet, type AwsTopology, type AwsVpc } from './topology'

const SSL_POLICY = 'ELBSecurityPolicy-TLS13-1-2-2021-06'
const EXPOSURE_ORDER = { public: 0, private: 1, isolated: 2 }

// ---------------------------------------------------------------- small builders

const tags = (codeName: string | undefined, name: Expr): BodyItem =>
  attr('tags', obj(codeName ? [['Name', name], ['archpilot_node', str(codeName)]] : [['Name', name]]))

const subnetIds = (subnet: AwsSubnet): Expr =>
  subnet.stretched ? ref(`aws_subnet.${subnet.node.codeName}[*].id`) : list([ref(`aws_subnet.${subnet.node.codeName}.id`)])

const sg = (codeName: string) => ref(`aws_security_group.${codeName}_sg.id`)

function sgRule(direction: 'ingress' | 'egress', ruleLabel: string, owner: string, port: number, peer: { sg: string } | { cidr: string; mark: SecurityMark; comment: string }, description: string): Block {
  const peerAttr = 'sg' in peer ? attr('referenced_security_group_id', sg(peer.sg)) : attr('cidr_ipv4', str(peer.cidr))
  return resource(`aws_vpc_security_group_${direction}_rule`, label(ruleLabel), [
    attr('security_group_id', sg(owner)),
    attr('description', str(description)),
    attr('ip_protocol', str('tcp')),
    attr('from_port', num(port)),
    attr('to_port', num(port)),
    peerAttr,
  ], 'sg' in peer ? {} : { comments: [peer.comment], marks: [peer.mark] })
}

function securityGroup(codeName: string, vpc: AwsVpc, purpose: string): Block {
  return resource('aws_security_group', label(codeName, '_sg'), [
    attr('name', resourceName(codeName, '-sg')),
    attr('description', str(`ArchPilot: ${purpose} for ${codeName}. Rules come from access edges only.`)),
    attr('vpc_id', ref(`aws_vpc.${vpc.node.codeName}.id`)),
    tags(codeName, resourceName(codeName, '-sg')),
  ])
}

function statement(sid: string, actions: string[], resources: Expr[], extra: { comment?: string; mark?: SecurityMark } = {}): Block {
  return block('statement', [], [
    attr('sid', str(sid)),
    attr('actions', list([...actions].sort(byCodeUnit).map(str))),
    attr('resources', list(resources), extra.comment ? [extra.comment] : undefined),
  ], extra.mark ? { marks: [extra.mark] } : {})
}

const containsCheck = (values: (string | number)[], variable: string): Expr =>
  call('contains', list(values.map((value) => (typeof value === 'number' ? num(value) : str(value)))), ref(`var.${variable}`))

const rangeCheck = (variable: string, min: number, max: number): Expr =>
  op(op(ref(`var.${variable}`), '>=', num(min)), '&&', op(ref(`var.${variable}`), '<=', num(max)))

const regexCheck = (pattern: string, variable: string): Expr => call('can', call('regex', str(pattern), ref(`var.${variable}`)))

const cidrVariable = (codeName: string, cidr: string, what: string): TfVariable => ({
  name: `${codeName}_cidr`, type: 'string', description: `IPv4 CIDR block of ${what} ${codeName}.`, default: str(cidr), codeName,
  validations: [{ condition: call('can', call('cidrhost', ref(`var.${codeName}_cidr`), num(0))), message: `${codeName}_cidr must be a valid IPv4 CIDR block.` }],
})

// ---------------------------------------------------------------- per-service facts derived from edges

interface ServiceFacts {
  env: [string, Expr][]
  secrets: [string, Expr][]
  execStatements: Block[]
  targetGroup?: { tg: string; port: number; listeners: string[] }
}

export function awsPlan(ctx: TargetContext): TerraformIr {
  const topology = analyseTopology(ctx)
  const { options } = awsOptions(ctx)
  const links = generatableLinks(ctx)
  const realisation = (node: ArchNodeV2) => topology.realisationOf.get(node.id)
  const groups: MainGroup[] = []
  const groupByCodeName = new Map<string, MainGroup>()
  const variables: TfVariable[] = globalVariables(options)
  const outputs: TfOutput[] = []
  const rulesFor = new Map<string, Map<string, Block>>()
  const addRule = (owner: string, rule: Block) => {
    const byAddress = rulesFor.get(owner) ?? new Map<string, Block>()
    byAddress.set(`${rule.labels[0]}.${rule.labels[1]}`, rule)
    rulesFor.set(owner, byAddress)
  }
  const workloads = orderedNodes(ctx.doc, (node) => ['aws.ecs_cluster', 'aws.alb', 'aws.ecs_fargate', 'aws.rds'].includes(realisation(node) ?? ''))
  const services = workloads.filter((node) => realisation(node) === 'aws.ecs_fargate')

  // ---- facts from access edges (before any group is built, so task definitions can list env vars)
  const facts = new Map<string, ServiceFacts>(services.map((node) => [node.id, { env: [], secrets: [], execStatements: [] }]))
  const listenerPorts = (lb: ArchNodeV2) => (String(configOf(lb, 'protocol')) === 'https' ? [443, 80] : [80])
  const baseUrlVariables = new Map<string, TfVariable>()
  for (const link of links) {
    const { source, target } = link
    const sr = realisation(source)
    const tr = realisation(target)
    if (source.type === 'client' && tr === 'aws.alb') {
      for (const port of listenerPorts(target)) {
        addRule(target.codeName, sgRule('ingress', `internet_to_${target.codeName}_${port}`, target.codeName, port,
          { cidr: '0.0.0.0/0', mark: 'publicListenerIngress', comment: 'Internet-facing listener: the only public ingress (REQ-IAC-018).' }, `internet to ${target.codeName} ${port}`))
      }
    } else if (sr === 'aws.alb' && tr === 'aws.ecs_fargate') {
      const port = serviceSettings(ctx, target).port
      const ruleLabel = `${source.codeName}_to_${target.codeName}_${port}`
      addRule(source.codeName, sgRule('egress', ruleLabel, source.codeName, port, { sg: target.codeName }, `${source.codeName} to ${target.codeName}`))
      addRule(target.codeName, sgRule('ingress', ruleLabel, target.codeName, port, { sg: source.codeName }, `${source.codeName} to ${target.codeName}`))
      const https = String(configOf(source, 'protocol')) === 'https'
      facts.get(target.id)!.targetGroup = { tg: `${source.codeName}_tg`, port, listeners: [`aws_lb_listener.${source.codeName}_${https ? 'https' : 'http'}`] }
    } else if (sr === 'aws.ecs_fargate' && tr === 'aws.alb') {
      const https = String(configOf(target, 'protocol')) === 'https'
      const port = https ? 443 : 80
      const ruleLabel = `${source.codeName}_to_${target.codeName}_${port}`
      addRule(source.codeName, sgRule('egress', ruleLabel, source.codeName, port, { sg: target.codeName }, `${source.codeName} to ${target.codeName}`))
      addRule(target.codeName, sgRule('ingress', ruleLabel, target.codeName, port, { sg: source.codeName }, `${source.codeName} to ${target.codeName}`))
      facts.get(source.id)!.env.push([`${upperSnake(target.codeName)}_URL`, tmpl(https ? 'https://' : 'http://', ref(`aws_lb.${target.codeName}.dns_name`))])
    } else if (sr === 'aws.ecs_fargate' && tr === 'aws.rds') {
      const port = dbSettings(ctx, target).engine.port
      const ruleLabel = `${source.codeName}_to_${target.codeName}_${port}`
      addRule(source.codeName, sgRule('egress', ruleLabel, source.codeName, port, { sg: target.codeName }, `${source.codeName} to ${target.codeName}`))
      addRule(target.codeName, sgRule('ingress', ruleLabel, target.codeName, port, { sg: source.codeName }, `${source.codeName} to ${target.codeName}`))
      const f = facts.get(source.id)!
      const t = upperSnake(target.codeName)
      if (!f.env.some(([name]) => name === `${t}_HOST`)) {
        const db = `aws_db_instance.${target.codeName}`
        f.env.push([`${t}_HOST`, ref(`${db}.address`)], [`${t}_NAME`, ref(`${db}.db_name`)], [`${t}_PORT`, call('tostring', ref(`${db}.port`))])
        f.secrets.push([`${t}_SECRET`, ref(`${db}.master_user_secret[0].secret_arn`)])
        f.execStatements.push(statement(`Read${pascal(target.codeName)}Secret`, ['secretsmanager:GetSecretValue'], [ref(`${db}.master_user_secret[0].secret_arn`)]))
      }
    } else if (sr === 'aws.ecs_fargate' && target.type === 'external_service') {
      const variable = `${target.codeName}_base_url`
      baseUrlVariables.set(variable, {
        name: variable, type: 'string', description: `Base URL of the external service ${target.codeName}.`, tfvars: str('CHANGE_ME'), codeName: target.codeName,
        validations: [{ condition: regexCheck('^https?://', variable), message: `Set ${variable} to the service URL (http:// or https://).` }],
      })
      const f = facts.get(source.id)!
      const name = `${upperSnake(target.codeName)}_BASE_URL`
      if (!f.env.some(([existing]) => existing === name)) f.env.push([name, ref(`var.${variable}`)])
    }
  }

  // ---- shared data sources
  const shared: Block[] = []
  if (topology.vpcs.length > 0) shared.push(data('aws_availability_zones', 'available', [attr('state', str('available'))]))
  if (services.length > 0) {
    shared.push(data('aws_caller_identity', 'current', []), data('aws_partition', 'current', []), data('aws_region', 'current', []))
  }
  if (shared.length > 0) groups.push({ title: 'shared data sources', blocks: shared })

  // ---- network (task 1.3)
  for (const vpc of topology.vpcs) planNetwork(vpc, options, groups, groupByCodeName, variables, outputs)

  // ---- workloads (task 1.4)
  const needsSharedCluster = services.some((node) => !platformOf(ctx, topology, node))
  if (needsSharedCluster) {
    const group: MainGroup = { title: 'this (shared ECS cluster)', blocks: [clusterBlock('this', undefined)] }
    groups.push(group)
    outputs.push({ name: 'ecs_cluster_name', description: 'Name of the shared ECS cluster.', value: ref('aws_ecs_cluster.this.name') })
  }
  for (const node of workloads) {
    const group: MainGroup = { title: `${node.codeName} (${node.type})`, blocks: [], codeName: node.codeName }
    const subnet = subnetOf(ctx, topology, node.id)
    switch (realisation(node)) {
      case 'aws.ecs_cluster':
        group.blocks.push(clusterBlock(node.codeName, node.codeName))
        outputs.push({ name: `${node.codeName}_cluster_name`, description: `Name of the ECS cluster ${node.codeName}.`, value: ref(`aws_ecs_cluster.${node.codeName}.name`), codeName: node.codeName })
        break
      case 'aws.alb':
        planLoadBalancer(ctx, node, subnet!, links, group, variables, outputs)
        break
      case 'aws.ecs_fargate':
        planService(ctx, node, subnet!, platformOf(ctx, topology, node), facts.get(node.id)!, group, variables, outputs)
        break
      case 'aws.rds':
        planDatabase(ctx, node, subnet!, group, variables, outputs)
        break
    }
    groups.push(group)
    groupByCodeName.set(node.codeName, group)
  }
  for (const [owner, rules] of [...rulesFor.entries()].sort(([a], [b]) => byCodeUnit(a, b))) {
    groupByCodeName.get(owner)!.blocks.push(...[...rules.entries()].sort(([a], [b]) => byCodeUnit(a, b)).map(([, rule]) => rule))
  }
  variables.push(...[...baseUrlVariables.values()].sort((a, b) => byCodeUnit(a.name, b.name)))

  const locals = [attr('name_prefix', tmpl(ref('var.project_name'), '-', ref('var.environment')))]
  const ir: TerraformIr = {
    tool: 'terraform', groups, variables, outputs, locals,
    providers: [block('provider', ['aws'], [
      attr('region', ref('var.aws_region')),
      block('default_tags', [], [attr('tags', call('merge', ref('var.tags'), obj([
        ['project', ref('var.project_name')],
        ['environment', ref('var.environment')],
        ['managed_by', str('archpilot')],
        ['archpilot_design', str(ctx.doc.settings.codeName)],
      ])))]),
    ])],
    pins: [AWS_PROVIDER], requiredVersion: TERRAFORM_REQUIRED_VERSION,
    backend: block('backend', ['s3'], [attr('encrypt', bool(true)), attr('use_lockfile', bool(true))]),
    backendExample: [
      attr('bucket', str('REPLACE-with-state-bucket')),
      attr('key', str(`${ctx.doc.settings.codeName}/${options.environment}/terraform.tfstate`)),
      attr('region', str(options.region)),
    ],
    lockFile: AWS_LOCK_FILE,
    problems: [],
  }
  ir.problems.push(...terraformAddressProblems(ir))
  return ir
}

function platformOf(ctx: TargetContext, topology: AwsTopology, node: ArchNodeV2): string | undefined {
  let current = node.parentId !== undefined ? ctx.byId.get(node.parentId) : undefined
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    if (topology.realisationOf.get(current.id) === 'aws.ecs_cluster') return current.codeName
    current = current.parentId !== undefined ? ctx.byId.get(current.parentId) : undefined
  }
  return undefined
}

function clusterBlock(clusterLabel: string, codeName: string | undefined): Block {
  return resource('aws_ecs_cluster', clusterLabel, [
    attr('name', codeName ? resourceName(codeName) : ref('local.name_prefix')),
    block('setting', [], [attr('name', str('containerInsights')), attr('value', str('enabled'))]),
    tags(codeName, codeName ? resourceName(codeName) : ref('local.name_prefix')),
  ])
}

function globalVariables(options: AwsOptions): TfVariable[] {
  return [
    {
      name: 'project_name', type: 'string', description: 'Short project name used in resource names.', default: str(options.projectName), tfvars: str(options.projectName),
      validations: [{ condition: regexCheck('^[a-z][a-z0-9-]{0,15}$', 'project_name'), message: 'project_name must be 1-16 lower-case letters, digits or hyphens, starting with a letter.' }],
    },
    {
      name: 'environment', type: 'string', description: 'Environment name used in resource names and tags.', default: str(options.environment), tfvars: str(options.environment),
      validations: [{ condition: regexCheck('^[a-z][a-z0-9-]{0,15}$', 'environment'), message: 'environment must be 1-16 lower-case letters, digits or hyphens, starting with a letter.' }],
    },
    {
      name: 'aws_region', type: 'string', description: 'AWS region to deploy into.', default: str(options.region), tfvars: str(options.region),
      validations: [{ condition: regexCheck('^[a-z]{2}(-[a-z]+)+-[0-9]+$', 'aws_region'), message: 'aws_region must be an AWS region id such as ap-southeast-1.' }],
    },
    { name: 'tags', type: 'map(string)', description: 'Extra tags added to every resource.', default: obj([]) },
  ]
}

// ---------------------------------------------------------------- network (task 1.3)

function planNetwork(vpc: AwsVpc, options: AwsOptions, groups: MainGroup[], groupByCodeName: Map<string, MainGroup>, variables: TfVariable[], outputs: TfOutput[]): void {
  const cn = vpc.node.codeName
  const tiers = [...vpc.subnets].sort((a, b) => EXPOSURE_ORDER[a.exposure] - EXPOSURE_ORDER[b.exposure] || byCodeUnit(a.node.codeName, b.node.codeName))
  const publicTiers = tiers.filter((tier) => tier.exposure === 'public')
  const privateTiers = tiers.filter((tier) => tier.exposure === 'private')
  const nat = options.nat !== 'none' && privateTiers.length > 0 ? options.nat : 'none'
  const natTier = nat === 'perZone' ? publicTiers.find((tier) => tier.stretched)! : publicTiers[0]
  const natCount = nat === 'perZone' ? vpc.zoneCount : nat === 'single' ? 1 : 0

  const blocks: Block[] = [
    resource('aws_vpc', label(cn), [
      attr('cidr_block', ref(`var.${cn}_cidr`)),
      attr('enable_dns_support', bool(true)),
      attr('enable_dns_hostnames', bool(true)),
      tags(cn, resourceName(cn)),
    ]),
    resource('aws_default_security_group', label(cn), [
      attr('vpc_id', ref(`aws_vpc.${cn}.id`)),
      tags(cn, resourceName(cn, '-default-deny')),
    ], { comments: ['Empties the VPC default security group: nothing may use it.'] }),
  ]
  if (publicTiers.length > 0) {
    blocks.push(resource('aws_internet_gateway', label(cn), [attr('vpc_id', ref(`aws_vpc.${cn}.id`)), tags(cn, resourceName(cn))]))
  }
  if (natCount > 0) {
    const counted = nat === 'perZone'
    const name = counted ? tmpl(ref('local.name_prefix'), `-${kebab(cn)}-nat-`, op(ref('count.index'), '+', num(1))) : resourceName(cn, '-nat')
    blocks.push(resource('aws_eip', label(cn, '_nat'), body(
      counted && attr('count', num(natCount)),
      attr('domain', str('vpc')),
      tags(cn, name),
      attr('depends_on', list([ref(`aws_internet_gateway.${cn}`)])),
    )))
    blocks.push(resource('aws_nat_gateway', label(cn, '_nat'), body(
      counted && attr('count', num(natCount)),
      attr('allocation_id', ref(counted ? `aws_eip.${cn}_nat[count.index].id` : `aws_eip.${cn}_nat.id`)),
      attr('subnet_id', ref(natTier.stretched ? `aws_subnet.${natTier.node.codeName}[${counted ? 'count.index' : '0'}].id` : `aws_subnet.${natTier.node.codeName}.id`)),
      tags(cn, name),
      attr('depends_on', list([ref(`aws_internet_gateway.${cn}`)])),
    )))
  }
  const group: MainGroup = { title: `${cn} (network_segment, VPC)`, blocks, codeName: cn }
  groups.push(group)
  groupByCodeName.set(cn, group)
  variables.push(cidrVariable(cn, vpc.cidrText, 'the network'))
  outputs.push({ name: `${cn}_id`, description: `ID of the VPC ${cn}.`, value: ref(`aws_vpc.${cn}.id`), codeName: cn })

  for (const tier of tiers) {
    const tn = tier.node.codeName
    const az = tier.stretched ? 'count.index' : String(tier.zone!.index)
    const tierBlocks: Block[] = [
      resource('aws_subnet', label(tn), body(
        tier.stretched && attr('count', num(tier.count)),
        attr('vpc_id', ref(`aws_vpc.${cn}.id`)),
        attr('cidr_block', tier.stretched ? call('cidrsubnet', ref(`var.${tn}_cidr`), num(2), ref('count.index')) : ref(`var.${tn}_cidr`)),
        attr('availability_zone', ref(`data.aws_availability_zones.available.names[${az}]`)),
        attr('map_public_ip_on_launch', bool(false)),
        tags(tn, tier.stretched ? tmpl(ref('local.name_prefix'), `-${kebab(tn)}-`, op(ref('count.index'), '+', num(1))) : resourceName(tn)),
      )),
    ]
    // Private tiers with a NAT per zone get one route table per zone; everything else one table per tier.
    const perZoneTables = tier.exposure === 'private' && nat === 'perZone' && tier.stretched
    tierBlocks.push(resource('aws_route_table', label(tn), body(
      perZoneTables && attr('count', num(tier.count)),
      attr('vpc_id', ref(`aws_vpc.${cn}.id`)),
      tags(tn, perZoneTables ? tmpl(ref('local.name_prefix'), `-${kebab(tn)}-`, op(ref('count.index'), '+', num(1))) : resourceName(tn)),
    )))
    if (tier.exposure === 'public') {
      tierBlocks.push(resource('aws_route', label(tn), [
        attr('route_table_id', ref(`aws_route_table.${tn}.id`)),
        attr('destination_cidr_block', str('0.0.0.0/0')),
        attr('gateway_id', ref(`aws_internet_gateway.${cn}.id`)),
      ], { comments: ['Public tier: default route to the internet gateway.'] }))
    } else if (tier.exposure === 'private' && nat !== 'none') {
      const natRef = nat === 'single' ? `aws_nat_gateway.${cn}_nat.id` : perZoneTables ? `aws_nat_gateway.${cn}_nat[count.index].id` : `aws_nat_gateway.${cn}_nat[${tier.zone!.index}].id`
      tierBlocks.push(resource('aws_route', label(tn), body(
        perZoneTables && attr('count', num(tier.count)),
        attr('route_table_id', ref(perZoneTables ? `aws_route_table.${tn}[count.index].id` : `aws_route_table.${tn}.id`)),
        attr('destination_cidr_block', str('0.0.0.0/0')),
        attr('nat_gateway_id', ref(natRef)),
      ), { comments: ['Private tier: outbound only, through NAT.'] }))
    }
    tierBlocks.push(resource('aws_route_table_association', label(tn), body(
      tier.stretched && attr('count', num(tier.count)),
      attr('subnet_id', ref(tier.stretched ? `aws_subnet.${tn}[count.index].id` : `aws_subnet.${tn}.id`)),
      attr('route_table_id', ref(perZoneTables ? `aws_route_table.${tn}[count.index].id` : `aws_route_table.${tn}.id`)),
    )))
    const tierGroup: MainGroup = { title: `${tn} (network_segment, ${tier.exposure}${tier.stretched ? `, ${tier.count} zones` : `, zone ${tier.zone!.node.codeName}`})`, blocks: tierBlocks, codeName: tn }
    groups.push(tierGroup)
    groupByCodeName.set(tn, tierGroup)
    variables.push(cidrVariable(tn, tier.cidrText, `the ${tier.exposure} tier`))
    outputs.push({ name: `${tn}_subnet_ids`, description: `Subnet IDs of the tier ${tn}.`, value: subnetIds(tier), codeName: tn })
  }
}

// ---------------------------------------------------------------- load balancer (task 1.4)

function planLoadBalancer(ctx: TargetContext, node: ArchNodeV2, subnet: AwsSubnet, links: AccessLink[], group: MainGroup, variables: TfVariable[], outputs: TfOutput[]): void {
  const cn = node.codeName
  const https = String(configOf(node, 'protocol')) === 'https'
  const internal = String(configOf(node, 'scheme')) !== 'internet_facing'
  const target = links.find((link) => link.source.id === node.id && link.target.type === 'service')!.target
  const service = serviceSettings(ctx, target)
  const healthPath = service.healthPath ?? String(configOf(node, 'healthPath') ?? '/health')
  group.blocks.push(
    securityGroup(cn, subnet.vpc, 'load balancer'),
    resource('aws_lb', label(cn), [
      attr('name', resourceName(cn, '', 32)),
      attr('internal', bool(internal)),
      attr('load_balancer_type', str('application')),
      attr('security_groups', list([sg(cn)])),
      attr('subnets', subnetIds(subnet)),
      attr('drop_invalid_header_fields', bool(true)),
      tags(cn, resourceName(cn)),
    ]),
    resource('aws_lb_target_group', label(cn, '_tg'), [
      attr('port', num(service.port)),
      attr('protocol', str('HTTP')),
      attr('target_type', str('ip')),
      attr('vpc_id', ref(`aws_vpc.${subnet.vpc.node.codeName}.id`)),
      block('health_check', [], [attr('path', str(healthPath)), attr('matcher', str('200'))]),
      tags(cn, resourceName(cn, '-tg')),
    ], { comments: [`Targets: ${target.codeName} on port ${service.port}.`] }),
  )
  const forward = block('default_action', [], [attr('type', str('forward')), attr('target_group_arn', ref(`aws_lb_target_group.${cn}_tg.arn`))])
  if (https) {
    group.blocks.push(
      resource('aws_lb_listener', label(cn, '_https'), [
        attr('load_balancer_arn', ref(`aws_lb.${cn}.arn`)),
        attr('port', num(443)),
        attr('protocol', str('HTTPS')),
        attr('ssl_policy', str(SSL_POLICY)),
        attr('certificate_arn', ref(`var.${cn}_certificate_arn`)),
        forward,
        tags(cn, resourceName(cn, '-https')),
      ]),
      resource('aws_lb_listener', label(cn, '_http'), [
        attr('load_balancer_arn', ref(`aws_lb.${cn}.arn`)),
        attr('port', num(80)),
        attr('protocol', str('HTTP')),
        block('default_action', [], [
          attr('type', str('redirect')),
          block('redirect', [], [attr('port', str('443')), attr('protocol', str('HTTPS')), attr('status_code', str('HTTP_301'))]),
        ]),
        tags(cn, resourceName(cn, '-http')),
      ], { comments: ['HTTP only redirects to HTTPS.'] }),
    )
    variables.push({
      name: `${cn}_certificate_arn`, type: 'string', description: `ACM certificate ARN for the HTTPS listener of ${cn}.`, tfvars: str('CHANGE_ME'), codeName: cn,
      validations: [{ condition: regexCheck('^arn:aws[a-z-]*:acm:', `${cn}_certificate_arn`), message: `Set ${cn}_certificate_arn to an ACM certificate ARN.` }],
    })
  } else {
    group.blocks.push(resource('aws_lb_listener', label(cn, '_http'), [
      attr('load_balancer_arn', ref(`aws_lb.${cn}.arn`)),
      attr('port', num(80)),
      attr('protocol', str('HTTP')),
      forward,
      tags(cn, resourceName(cn, '-http')),
    ], { comments: ['HTTP only (IAC-W02): add a certificate and set protocol https.'] }))
  }
  outputs.push({ name: `${cn}_dns_name`, description: `DNS name of the load balancer ${cn}.`, value: ref(`aws_lb.${cn}.dns_name`), codeName: cn })
}

// ---------------------------------------------------------------- ECS service (task 1.4)

function planService(ctx: TargetContext, node: ArchNodeV2, subnet: AwsSubnet, platform: string | undefined, facts: ServiceFacts, group: MainGroup, variables: TfVariable[], outputs: TfOutput[]): void {
  const cn = node.codeName
  const s = serviceSettings(ctx, node)
  const cluster = platform ?? 'this'
  const withPort = facts.targetGroup !== undefined || node.variant !== 'worker'
  const execStatements = [
    statement('EcrAuthToken', ['ecr:GetAuthorizationToken'], [str('*')], { comment: 'AWS requires "*" for this action.', mark: 'iamWildcardResourceRequired' }),
    statement('EcrPull', ['ecr:BatchCheckLayerAvailability', 'ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer'], [
      tmpl('arn:', ref('data.aws_partition.current.partition'), ':ecr:', ref('data.aws_region.current.region'), ':', ref('data.aws_caller_identity.current.account_id'), ':repository/*'),
    ]),
    statement('WriteLogs', ['logs:CreateLogStream', 'logs:PutLogEvents'], [tmpl(ref(`aws_cloudwatch_log_group.${cn}_logs.arn`), ':*')]),
    ...facts.execStatements,
  ]
  const env = [...facts.env].sort(([a], [b]) => byCodeUnit(a, b))
  const secrets = [...facts.secrets].sort(([a], [b]) => byCodeUnit(a, b))
  const container = obj([
    ['name', str(cn)],
    ['image', ref(`var.${cn}_image`)],
    ['essential', bool(true)],
    ...(withPort ? [['portMappings', list([obj([['containerPort', num(s.port)], ['protocol', str('tcp')]])])] as [string, Expr]] : []),
    ...(env.length > 0 ? [['environment', list(env.map(([name, value]) => obj([['name', str(name)], ['value', value]])))] as [string, Expr]] : []),
    ...(secrets.length > 0 ? [['secrets', list(secrets.map(([name, value]) => obj([['name', str(name)], ['valueFrom', value]])))] as [string, Expr]] : []),
    ['logConfiguration', obj([
      ['logDriver', str('awslogs')],
      ['options', obj([
        ['awslogs-group', ref(`aws_cloudwatch_log_group.${cn}_logs.name`)],
        ['awslogs-region', ref('data.aws_region.current.region')],
        ['awslogs-stream-prefix', str(cn)],
      ])],
    ])],
  ])
  const assume = data('aws_iam_policy_document', label(cn, '_assume'), [
    block('statement', [], [
      attr('sid', str('EcsTasksAssumeRole')),
      attr('actions', list([str('sts:AssumeRole')])),
      block('principals', [], [attr('type', str('Service')), attr('identifiers', list([str('ecs-tasks.amazonaws.com')]))]),
    ]),
  ])
  group.blocks.push(
    securityGroup(cn, subnet.vpc, 'service'),
    sgRule('egress', `${cn}_to_internet_443`, cn, 443,
      { cidr: '0.0.0.0/0', mark: 'serviceEgress443', comment: 'Image pulls and AWS API calls through NAT; ArchPilot exception (IAC-I02, C-v2-2).' }, `${cn} to the internet 443 (image pulls, AWS APIs)`),
    resource('aws_cloudwatch_log_group', label(cn, '_logs'), [
      attr('name', tmpl('/ecs/', ref('local.name_prefix'), `/${kebab(cn)}`)),
      attr('retention_in_days', ref(`var.${cn}_log_retention_days`)),
      tags(cn, resourceName(cn, '-logs')),
    ]),
    assume,
    resource('aws_iam_role', label(cn, '_exec'), [
      attr('name', resourceName(cn, '-exec', 64)),
      attr('assume_role_policy', ref(`data.aws_iam_policy_document.${cn}_assume.json`)),
      tags(cn, resourceName(cn, '-exec')),
    ], { comments: ['Execution role: pull the image, write logs, read linked database secrets. No task role: no access edge needs one.'] }),
    data('aws_iam_policy_document', label(cn, '_exec'), execStatements),
    resource('aws_iam_role_policy', label(cn, '_exec'), [
      attr('name', str('archpilot-execution')),
      attr('role', ref(`aws_iam_role.${cn}_exec.id`)),
      attr('policy', ref(`data.aws_iam_policy_document.${cn}_exec.json`)),
    ]),
    resource('aws_ecs_task_definition', label(cn), [
      attr('family', resourceName(cn)),
      attr('requires_compatibilities', list([str('FARGATE')])),
      attr('network_mode', str('awsvpc')),
      attr('cpu', ref(`var.${cn}_cpu`)),
      attr('memory', ref(`var.${cn}_memory_mib`)),
      attr('execution_role_arn', ref(`aws_iam_role.${cn}_exec.arn`)),
      attr('container_definitions', call('jsonencode', list([container]))),
      block('runtime_platform', [], [attr('operating_system_family', str('LINUX')), attr('cpu_architecture', str('X86_64'))]),
      tags(cn, resourceName(cn)),
    ]),
    resource('aws_ecs_service', label(cn), body(
      attr('name', resourceName(cn)),
      attr('cluster', ref(`aws_ecs_cluster.${cluster}.id`)),
      attr('task_definition', ref(`aws_ecs_task_definition.${cn}.arn`)),
      attr('desired_count', ref(`var.${cn}_desired_count`)),
      attr('launch_type', str('FARGATE')),
      block('network_configuration', [], [
        attr('subnets', subnetIds(subnet)),
        attr('security_groups', list([sg(cn)])),
        attr('assign_public_ip', bool(false)),
      ]),
      facts.targetGroup && block('load_balancer', [], [
        attr('target_group_arn', ref(`aws_lb_target_group.${facts.targetGroup.tg}.arn`)),
        attr('container_name', str(cn)),
        attr('container_port', num(facts.targetGroup.port)),
      ]),
      block('deployment_circuit_breaker', [], [attr('enable', bool(true)), attr('rollback', bool(true))]),
      tags(cn, resourceName(cn)),
      facts.targetGroup && attr('depends_on', list(facts.targetGroup.listeners.map(ref))),
    )),
  )
  const sizingComment = s.countFromSizing ? [`Default from sizing scenario ${s.countFromSizing.scenarioId}${s.countFromSizing.formulaVersion ? ` (formula ${s.countFromSizing.formulaVersion})` : ''}.`] : undefined
  variables.push(
    {
      name: `${cn}_image`, type: 'string', description: `Container image for ${cn} (registry/repository:tag or @digest).`, tfvars: str('CHANGE_ME'), codeName: cn,
      validations: [{ condition: op(ref(`var.${cn}_image`), '!=', str('CHANGE_ME')), message: `Set ${cn}_image to a container image reference.` }],
    },
    { name: `${cn}_cpu`, type: 'number', description: `Fargate CPU units for ${cn}.`, default: num(s.cpu), codeName: cn,
      validations: [{ condition: containsCheck(FARGATE_CPU, `${cn}_cpu`), message: `${cn}_cpu must be one of ${FARGATE_CPU.join(', ')}.` }] },
    { name: `${cn}_memory_mib`, type: 'number', description: `Fargate memory (MiB) for ${cn}.`, default: num(s.memoryMiB), codeName: cn,
      validations: [{ condition: containsCheck(FARGATE_MEMORY, `${cn}_memory_mib`), message: `${cn}_memory_mib must be one of ${FARGATE_MEMORY.join(', ')}.` }] },
    { name: `${cn}_desired_count`, type: 'number', description: `Number of running tasks of ${cn}.`, default: num(s.desiredCount), codeName: cn, comments: sizingComment,
      validations: [{ condition: rangeCheck(`${cn}_desired_count`, 0, 100), message: `${cn}_desired_count must be between 0 and 100.` }] },
    { name: `${cn}_log_retention_days`, type: 'number', description: `Days to keep the logs of ${cn}.`, default: num(s.logRetentionDays), codeName: cn,
      validations: [{ condition: containsCheck(LOG_RETENTION_DAYS, `${cn}_log_retention_days`), message: `${cn}_log_retention_days must be a CloudWatch Logs retention value.` }] },
  )
  outputs.push({ name: `${cn}_service_name`, description: `Name of the ECS service ${cn}.`, value: ref(`aws_ecs_service.${cn}.name`), codeName: cn })
}

// ---------------------------------------------------------------- relational database (task 1.4)

function planDatabase(ctx: TargetContext, node: ArchNodeV2, subnet: AwsSubnet, group: MainGroup, variables: TfVariable[], outputs: TfOutput[]): void {
  const cn = node.codeName
  const db = dbSettings(ctx, node)
  group.blocks.push(
    securityGroup(cn, subnet.vpc, 'database'),
    resource('aws_db_subnet_group', label(cn, '_subnets'), [
      attr('name', resourceName(cn)),
      attr('subnet_ids', subnetIds(subnet)),
      tags(cn, resourceName(cn)),
    ]),
    resource('aws_db_instance', label(cn), [
      attr('identifier', resourceName(cn, '', 63)),
      attr('engine', str(db.engine.engine)),
      attr('engine_version', ref(`var.${cn}_engine_version`)),
      attr('instance_class', ref(`var.${cn}_instance_class`)),
      attr('allocated_storage', ref(`var.${cn}_allocated_storage_gib`)),
      attr('storage_type', str('gp3')),
      attr('storage_encrypted', bool(true)),
      attr('db_name', ref(`var.${cn}_db_name`)),
      attr('username', ref(`var.${cn}_master_username`)),
      attr('manage_master_user_password', bool(true), ['The master password lives in Secrets Manager; it never appears in code or state files.']),
      attr('multi_az', ref(`var.${cn}_multi_az`)),
      attr('db_subnet_group_name', ref(`aws_db_subnet_group.${cn}_subnets.name`)),
      attr('vpc_security_group_ids', list([sg(cn)])),
      attr('publicly_accessible', bool(false)),
      attr('deletion_protection', ref(`var.${cn}_deletion_protection`)),
      attr('backup_retention_period', ref(`var.${cn}_backup_retention_days`)),
      attr('copy_tags_to_snapshot', bool(true)),
      attr('skip_final_snapshot', bool(false)),
      attr('final_snapshot_identifier', resourceName(cn, '-final')),
      attr('auto_minor_version_upgrade', bool(true)),
      tags(cn, resourceName(cn)),
    ]),
  )
  const storageComment = db.storageFromSizing ? [`Default from sizing scenario ${db.storageFromSizing.scenarioId}${db.storageFromSizing.formulaVersion ? ` (formula ${db.storageFromSizing.formulaVersion})` : ''}, rounded up.`] : undefined
  variables.push(
    { name: `${cn}_engine_version`, type: 'string', description: `Major ${db.engine.engine} version of ${cn}.`, default: str(db.major), codeName: cn,
      validations: [{ condition: containsCheck(db.engine.majors, `${cn}_engine_version`), message: `${cn}_engine_version must be one of ${db.engine.majors.join(', ')}.` }] },
    { name: `${cn}_instance_class`, type: 'string', description: `RDS instance class of ${cn}.`, default: str(db.instanceClass), codeName: cn,
      validations: [{ condition: containsCheck(DB_INSTANCE_CLASSES, `${cn}_instance_class`), message: `${cn}_instance_class must be one of ${DB_INSTANCE_CLASSES.join(', ')}.` }] },
    { name: `${cn}_allocated_storage_gib`, type: 'number', description: `Allocated storage (GiB) of ${cn}.`, default: num(db.storageGiB), codeName: cn, comments: storageComment,
      validations: [{ condition: rangeCheck(`${cn}_allocated_storage_gib`, DB_STORAGE_MIN, DB_STORAGE_MAX), message: `${cn}_allocated_storage_gib must be between ${DB_STORAGE_MIN} and ${DB_STORAGE_MAX}.` }] },
    { name: `${cn}_multi_az`, type: 'bool', description: `Run ${cn} with a standby in a second zone.`, default: bool(db.multiAz), codeName: cn },
    { name: `${cn}_backup_retention_days`, type: 'number', description: `Days of automated backups kept for ${cn}.`, default: num(db.backupRetentionDays), codeName: cn,
      validations: [{ condition: rangeCheck(`${cn}_backup_retention_days`, 1, 35), message: `${cn}_backup_retention_days must be between 1 and 35.` }] },
    { name: `${cn}_deletion_protection`, type: 'bool', description: `Protect ${cn} from deletion. Turning it off raises IAC-W05.`, default: bool(db.deletionProtection), codeName: cn },
    { name: `${cn}_master_username`, type: 'string', description: `Master user name of ${cn} (the password is managed by RDS).`, default: str('dbadmin'), codeName: cn,
      validations: [{ condition: regexCheck('^[a-z][a-z0-9_]{0,15}$', `${cn}_master_username`), message: `${cn}_master_username must be 1-16 lower-case letters, digits or underscores.` }] },
    { name: `${cn}_db_name`, type: 'string', description: `Initial database name in ${cn}.`, default: str(cn), codeName: cn,
      validations: [{ condition: regexCheck('^[a-z][a-z0-9_]{0,62}$', `${cn}_db_name`), message: `${cn}_db_name must be lower-case letters, digits or underscores.` }] },
  )
  outputs.push(
    { name: `${cn}_endpoint`, description: `Host name of the database ${cn}.`, value: ref(`aws_db_instance.${cn}.address`), codeName: cn },
    { name: `${cn}_master_secret_arn`, description: `ARN of the Secrets Manager secret holding the master credentials of ${cn}.`, value: ref(`aws_db_instance.${cn}.master_user_secret[0].secret_arn`), sensitive: true, codeName: cn },
  )
}

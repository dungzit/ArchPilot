/**
 * AWS network topology from the neutral containers (design-v2 4.4.8 rows
 * site / zone / network_segment; task 1.3).
 *
 * - A `network_segment` of variant `network` is a VPC (`aws.vpc`). It may sit
 *   at the top level or in a site, never inside another segment or a zone.
 * - Every other segment is a subnet tier (`aws.subnets`) and must sit inside
 *   a VPC, directly or through one zone.
 * - The VPC's zones are the zones inside it; if there are none, the zones
 *   that are siblings of the VPC in its site; if still none, 2 zones are
 *   assumed (and said so in the README). Zone i (code-name order) is
 *   `data.aws_availability_zones.available.names[i]`.
 * - A subnet tier inside a zone is zone-local: one subnet in that zone, with
 *   the tier CIDR as is. Otherwise it is stretched: one subnet per zone,
 *   `cidrsubnet(var.<tier>_cidr, 2, count.index)`, so a stretched tier needs
 *   a prefix of /26 or shorter and at most 4 zones (IAC-E03).
 *
 * Shared by the gate (problems) and the planner (which assumes no errors).
 */
import { ancestors } from '../../../graph/containment'
import type { ArchNodeV2 } from '../../../graph/types'
import { byCodeUnit } from '../../core/text'
import type { IacProblem, TargetContext } from '../../core/types'
import { contains, overlaps, parseCidr, type Cidr } from '../../terraform/cidr'

export type Exposure = 'public' | 'private' | 'isolated'
export type NatMode = 'none' | 'single' | 'perZone'

export interface AwsZone { node: ArchNodeV2; index: number }

export interface AwsSubnet {
  node: ArchNodeV2
  vpc: AwsVpc
  exposure: Exposure
  /** Set for a zone-local tier. */
  zone?: AwsZone
  stretched: boolean
  /** Subnets this tier creates: zoneCount when stretched, else 1. */
  count: number
  cidrText: string
  cidr?: Cidr
}

export interface AwsVpc {
  node: ArchNodeV2
  cidrText: string
  cidr?: Cidr
  zones: AwsZone[]
  zoneCount: number
  zonesAssumed: boolean
  subnets: AwsSubnet[]
}

export interface AwsTopology {
  vpcs: AwsVpc[]
  subnetById: Map<string, AwsSubnet>
  realisationOf: Map<string, string>
  problems: IacProblem[]
}

export const DEFAULT_ZONE_COUNT = 2
export const STRETCH_NEWBITS = 2

function problem(ruleId: string, ctx: TargetContext, node: ArchNodeV2, en: string, vi: string, fixEn: string, fixVi: string, field = ''): IacProblem {
  const index = ctx.doc.nodes.findIndex((candidate) => candidate.id === node.id)
  return { severity: 'error', ruleId, path: `nodes[${index}]${field}`, nodeId: node.id, message: { en, vi }, fix: { en: fixEn, vi: fixVi } }
}

export function exposureOf(node: ArchNodeV2): Exposure {
  const value = node.config?.exposure
  return value === 'public' || value === 'isolated' ? value : 'private'
}

export function analyseTopology(ctx: TargetContext): AwsTopology {
  const realisationOf = new Map<string, string>()
  for (const row of ctx.coverage.nodes) if (row.class === 'generatable' && row.realisation) realisationOf.set(row.nodeId, row.realisation)
  const problems: IacProblem[] = []
  const nodeOf = (id: string) => ctx.byId.get(id)!
  const is = (id: string, realisation: string) => realisationOf.get(id) === realisation
  const ordered = [...realisationOf.keys()].map(nodeOf).sort((a, b) => byCodeUnit(a.codeName, b.codeName))

  const vpcs: AwsVpc[] = []
  for (const node of ordered.filter((candidate) => is(candidate.id, 'aws.vpc'))) {
    const up = ancestors(ctx.doc, node.id).map(nodeOf)
    if (up.some((ancestor) => ancestor.type === 'network_segment' || ancestor.type === 'zone')) {
      problems.push(problem('IAC-E02', ctx, node,
        `${node.codeName} is a network (VPC) inside another segment or a zone; on AWS a VPC spans zones.`,
        `${node.codeName} là mạng (VPC) nằm trong phân đoạn khác hoặc vùng; trên AWS, VPC trải qua các vùng.`,
        'Move the network to the top level or into a site, and put zones inside it.',
        'Chuyển mạng lên cấp cao nhất hoặc vào site, và đặt các vùng bên trong.', '.parentId'))
    }
    const inside = ordered.filter((candidate) => is(candidate.id, 'aws.az') && ancestors(ctx.doc, candidate.id).includes(node.id))
    const parent = node.parentId !== undefined ? ctx.byId.get(node.parentId) : undefined
    const siblings = parent?.type === 'site'
      ? ordered.filter((candidate) => is(candidate.id, 'aws.az') && candidate.parentId === parent.id)
      : []
    const zoneNodes = inside.length > 0 ? inside : siblings
    const zones = zoneNodes.map((zone, index) => ({ node: zone, index }))
    const cidrText = typeof node.config?.cidr === 'string' ? node.config.cidr : ''
    vpcs.push({ node, cidrText, cidr: parseCidr(cidrText), zones, zoneCount: zones.length > 0 ? zones.length : DEFAULT_ZONE_COUNT, zonesAssumed: zones.length === 0, subnets: [] })
  }
  const vpcById = new Map(vpcs.map((vpc) => [vpc.node.id, vpc]))

  const subnetById = new Map<string, AwsSubnet>()
  for (const node of ordered.filter((candidate) => is(candidate.id, 'aws.subnets'))) {
    const up = ancestors(ctx.doc, node.id).map(nodeOf)
    const vpcIndex = up.findIndex((ancestor) => vpcById.has(ancestor.id))
    const between = vpcIndex >= 0 ? up.slice(0, vpcIndex) : up
    const cidrText = typeof node.config?.cidr === 'string' ? node.config.cidr : ''
    if (vpcIndex < 0 || between.some((ancestor) => ancestor.type === 'network_segment')) {
      problems.push(problem('IAC-E02', ctx, node,
        `${node.codeName} is a subnet tier that is not directly inside a network (VPC) segment.`,
        `${node.codeName} là tầng mạng con không nằm trực tiếp trong phân đoạn mạng (VPC).`,
        'Put the tier inside a network segment of variant "network" (optionally through one zone).',
        'Đặt tầng vào phân đoạn mạng biến thể "network" (có thể qua một vùng).', '.parentId'))
      continue
    }
    const vpc = vpcById.get(up[vpcIndex].id)!
    const zonesBetween = between.filter((ancestor) => ancestor.type === 'zone')
    if (zonesBetween.length > 1) {
      problems.push(problem('IAC-E02', ctx, node, `${node.codeName} is inside nested zones.`, `${node.codeName} nằm trong các vùng lồng nhau.`,
        'Use one zone level inside the network.', 'Chỉ dùng một cấp vùng trong mạng.', '.parentId'))
      continue
    }
    const zone = zonesBetween.length === 1 ? vpc.zones.find((candidate) => candidate.node.id === zonesBetween[0].id) : undefined
    const stretched = zone === undefined
    const subnet: AwsSubnet = {
      node, vpc, exposure: exposureOf(node), ...(zone ? { zone } : {}), stretched,
      count: stretched ? vpc.zoneCount : 1, cidrText, cidr: parseCidr(cidrText),
    }
    vpc.subnets.push(subnet)
    subnetById.set(node.id, subnet)
  }
  for (const node of ordered.filter((candidate) => candidate.type === 'network_segment')) {
    const children = ctx.doc.nodes.filter((child) => child.parentId === node.id && child.type === 'network_segment' && realisationOf.has(child.id))
    if (subnetById.has(node.id) && children.length > 0) {
      problems.push(problem('IAC-E02', ctx, node, `${node.codeName} is a subnet tier that contains other segments.`, `${node.codeName} là tầng mạng con nhưng chứa phân đoạn khác.`,
        'Make it a network (variant "network") or move the inner segments out.', 'Đổi thành mạng (biến thể "network") hoặc chuyển các phân đoạn bên trong ra ngoài.'))
    }
  }

  for (const vpc of vpcs) problems.push(...cidrProblems(ctx, vpc))
  return { vpcs, subnetById, realisationOf, problems }
}

function cidrProblems(ctx: TargetContext, vpc: AwsVpc): IacProblem[] {
  const out: IacProblem[] = []
  const bad = (node: ArchNodeV2, en: string, vi: string, fixEn: string, fixVi: string) =>
    out.push(problem('IAC-E03', ctx, node, en, vi, fixEn, fixVi, '.config.cidr'))
  if (!vpc.cidr || vpc.cidr.hostBitsSet || vpc.cidr.prefix < 16 || vpc.cidr.prefix > 28) {
    bad(vpc.node, `${vpc.node.codeName}: CIDR ${JSON.stringify(vpc.cidrText)} is not a network address between /16 and /28.`,
      `${vpc.node.codeName}: CIDR ${JSON.stringify(vpc.cidrText)} không phải địa chỉ mạng từ /16 đến /28.`,
      'Use a private network address such as 10.0.0.0/16.', 'Dùng địa chỉ mạng riêng, ví dụ 10.0.0.0/16.')
    return out
  }
  if (vpc.zoneCount > 4 && vpc.subnets.some((subnet) => subnet.stretched)) {
    bad(vpc.node, `${vpc.node.codeName} has ${vpc.zoneCount} zones; a stretched tier is split into at most 4.`,
      `${vpc.node.codeName} có ${vpc.zoneCount} vùng; tầng trải chỉ chia tối đa 4.`,
      'Use at most 4 zones, or place the tiers inside zones.', 'Dùng tối đa 4 vùng, hoặc đặt các tầng vào trong vùng.')
  }
  const valid: AwsSubnet[] = []
  for (const subnet of vpc.subnets) {
    const max = subnet.stretched ? 28 - STRETCH_NEWBITS : 28
    if (!subnet.cidr || subnet.cidr.hostBitsSet || subnet.cidr.prefix > max) {
      bad(subnet.node, `${subnet.node.codeName}: CIDR ${JSON.stringify(subnet.cidrText)} is not a network address of /${max} or shorter${subnet.stretched ? ' (it is split across zones)' : ''}.`,
        `${subnet.node.codeName}: CIDR ${JSON.stringify(subnet.cidrText)} không phải địa chỉ mạng /${max} hoặc ngắn hơn${subnet.stretched ? ' (được chia theo vùng)' : ''}.`,
        `Use a /${Math.min(max, 24)} or larger block inside ${vpc.cidrText}.`, `Dùng khối /${Math.min(max, 24)} hoặc lớn hơn trong ${vpc.cidrText}.`)
      continue
    }
    if (!contains(vpc.cidr, subnet.cidr)) {
      bad(subnet.node, `${subnet.node.codeName}: ${subnet.cidrText} is outside its network ${vpc.cidrText}.`,
        `${subnet.node.codeName}: ${subnet.cidrText} nằm ngoài mạng ${vpc.cidrText}.`,
        `Choose a block inside ${vpc.cidrText}.`, `Chọn khối nằm trong ${vpc.cidrText}.`)
      continue
    }
    const clash = valid.find((other) => overlaps(other.cidr!, subnet.cidr!))
    if (clash) {
      bad(subnet.node, `${subnet.node.codeName}: ${subnet.cidrText} overlaps ${clash.node.codeName} (${clash.cidrText}).`,
        `${subnet.node.codeName}: ${subnet.cidrText} chồng lấn ${clash.node.codeName} (${clash.cidrText}).`,
        'Give each tier its own block.', 'Cấp cho mỗi tầng một khối riêng.')
      continue
    }
    valid.push(subnet)
  }
  return out
}

/** The subnet tier a VPC-bound workload sits in: its nearest segment ancestor, when that is a tier. */
export function subnetOf(ctx: TargetContext, topology: AwsTopology, nodeId: string): AwsSubnet | undefined {
  const nearest = ancestors(ctx.doc, nodeId).map((id) => ctx.byId.get(id)!).find((ancestor) => ancestor.type === 'network_segment')
  return nearest ? topology.subnetById.get(nearest.id) : undefined
}

/**
 * AWS gate rules (design-v2 4.4.10; REQ-ADP-008: run after the neutral rules).
 *
 *   AWS-E01  load balancer in fewer than 2 zones, or with no access edge to a service
 *   AWS-E02  database subnet group would span fewer than 2 zones
 *   AWS-E03  VPC-bound node (LB, service, database) not inside a subnet tier;
 *            internet-facing LB not in a public tier
 *   AWS-E04  service not in a private tier, or in a VPC with nat = none (cannot pull images)
 *   AWS-E05  NAT requested but the VPC has no suitable public tier (proposed; see build note)
 *   IAC-E03  CIDR problems (topology.ts);  IAC-E02 VPC structure (topology.ts)
 *   IAC-E05  access-edge shapes this version cannot generate
 *   IAC-E07  value outside a curated list or range
 *   IAC-W02  HTTP-only listener;  IAC-W05 secure default relaxed;  IAC-W06 NAT per zone
 *   IAC-W10  stateful node in a public tier;  IAC-W11 sizing value clamped
 *   IAC-I02  service egress TCP 443 to the internet (C-v2-2)
 *   IAC-I03  zones assumed (no zone container in the design)
 */
import type { ArchEdgeV2, ArchNodeV2 } from '../../../graph/types'
import type { IacProblem, TargetContext } from '../../core/types'
import { awsOptions, bindingConfig, configOf, dbSettings, DB_INSTANCE_CLASSES, ENGINES, FARGATE_CPU, FARGATE_MEMORY, LOG_RETENTION_DAYS, serviceSettings } from './options'
import { analyseTopology, subnetOf, type AwsTopology } from './topology'

export interface AccessLink { edge: ArchEdgeV2; source: ArchNodeV2; target: ArchNodeV2 }

export function generatableLinks(ctx: TargetContext): AccessLink[] {
  const byEdge = new Map(ctx.doc.edges.map((edge) => [edge.id, edge]))
  return ctx.coverage.edges
    .filter((row) => row.class === 'generatable')
    .map((row) => {
      const edge = byEdge.get(row.edgeId)!
      return { edge, source: ctx.byId.get(edge.source)!, target: ctx.byId.get(edge.target)! }
    })
}

export function awsGate(ctx: TargetContext): IacProblem[] {
  const topology = analyseTopology(ctx)
  const out: IacProblem[] = [...topology.problems]
  const nodeIndex = (node: ArchNodeV2) => ctx.doc.nodes.findIndex((candidate) => candidate.id === node.id)
  const err = (ruleId: string, node: ArchNodeV2, en: string, vi: string, fixEn: string, fixVi: string, field = '') =>
    out.push({ severity: 'error', ruleId, path: `nodes[${nodeIndex(node)}]${field}`, nodeId: node.id, message: { en, vi }, fix: { en: fixEn, vi: fixVi } })
  const note = (severity: 'warning' | 'info', ruleId: string, node: ArchNodeV2 | undefined, en: string, vi: string, field = '') =>
    out.push({ severity, ruleId, path: node ? `nodes[${nodeIndex(node)}]${field}` : 'deployment', ...(node ? { nodeId: node.id } : {}), message: { en, vi } })
  const curated = (node: ArchNodeV2, key: string, value: unknown, allowed: string) =>
    err('IAC-E07', node, `${node.codeName}: ${key} = ${JSON.stringify(value)} is not allowed (${allowed}).`, `${node.codeName}: ${key} = ${JSON.stringify(value)} không được phép (${allowed}).`,
      `Choose one of: ${allowed}.`, `Chọn một trong: ${allowed}.`, `.config.${key}`)

  const { options, invalid } = awsOptions(ctx)
  for (const item of invalid) {
    out.push({ severity: 'error', ruleId: 'IAC-E07', path: `deployment.profiles.${ctx.profile.id}.options.${item.key}`,
      message: { en: `Target option ${item.key} = ${JSON.stringify(item.value)} is not valid.`, vi: `Tùy chọn đích ${item.key} = ${JSON.stringify(item.value)} không hợp lệ.` },
      fix: { en: `Use ${item.expected}.`, vi: `Dùng ${item.expected}.` } })
  }

  const links = generatableLinks(ctx)
  const realisation = (node: ArchNodeV2) => topology.realisationOf.get(node.id)
  const workloads = [...topology.realisationOf.entries()].map(([id]) => ctx.byId.get(id)!)
    .filter((node) => ['aws.alb', 'aws.ecs_fargate', 'aws.rds'].includes(realisation(node)!))

  for (const node of workloads) {
    const subnet = subnetOf(ctx, topology, node.id)
    if (!subnet) {
      err('AWS-E03', node, `${node.codeName} must sit inside a subnet tier (a network segment inside a network).`,
        `${node.codeName} phải nằm trong một tầng mạng con (phân đoạn mạng bên trong một mạng).`,
        'Drag it into a subnet tier.', 'Kéo nó vào một tầng mạng con.', '.parentId')
      continue
    }
    if (realisation(node) === 'aws.alb') checkLoadBalancer(ctx, topology, node, links, err, note)
    if (realisation(node) === 'aws.ecs_fargate') {
      if (subnet.exposure !== 'private' || options.nat === 'none') {
        err('AWS-E04', node,
          `${node.codeName} runs in ${subnet.node.codeName} (${subnet.exposure}${options.nat === 'none' ? ', nat none' : ''}), so it has no route to pull images.`,
          `${node.codeName} chạy trong ${subnet.node.codeName} (${subnet.exposure}${options.nat === 'none' ? ', nat none' : ''}), nên không có đường để tải image.`,
          'Place services in a private tier and set the NAT option to single or perZone.',
          'Đặt dịch vụ vào tầng riêng tư và đặt tùy chọn NAT là single hoặc perZone.', '.parentId')
      }
      const settings = serviceSettings(ctx, node)
      const binding = bindingConfig(ctx, node.id)
      if (!FARGATE_CPU.includes(settings.cpu)) curated(node, 'cpu', binding.cpu, FARGATE_CPU.join(', '))
      if (!FARGATE_MEMORY.includes(settings.memoryMiB)) curated(node, 'memoryMiB', binding.memoryMiB, FARGATE_MEMORY.join(', '))
      if (!LOG_RETENTION_DAYS.includes(settings.logRetentionDays)) curated(node, 'logRetentionDays', binding.logRetentionDays, LOG_RETENTION_DAYS.join(', '))
      if (!Number.isInteger(settings.port) || settings.port < 1 || settings.port > 65535) curated(node, 'port', configOf(node, 'port'), '1-65535')
      if (!Number.isInteger(settings.desiredCount) || settings.desiredCount < 0 || settings.desiredCount > 100) curated(node, 'replicas', settings.desiredCount, '0-100')
      if (settings.healthPath !== undefined && !/^\/[\x21-\x7e]{0,1023}$/.test(settings.healthPath)) curated(node, 'healthPath', settings.healthPath, 'a path starting with /')
      note('info', 'IAC-I02', node, `${node.codeName}: egress TCP 443 to the internet is opened for image pulls and AWS APIs (through NAT).`,
        `${node.codeName}: mở egress TCP 443 ra internet để tải image và gọi API AWS (qua NAT).`)
    }
    if (realisation(node) === 'aws.rds') {
      if (!subnet.stretched || subnet.vpc.zoneCount < 2) {
        err('AWS-E02', node, `${node.codeName}: its subnet group would span fewer than 2 zones.`, `${node.codeName}: nhóm mạng con sẽ trải ít hơn 2 vùng.`,
          'Place the database in a tier that spans at least two zones.', 'Đặt cơ sở dữ liệu vào tầng trải ít nhất hai vùng.', '.parentId')
      }
      const db = dbSettings(ctx, node)
      const engineKey = String(configOf(node, 'engine') ?? '')
      if (!ENGINES[engineKey]) curated(node, 'engine', engineKey, Object.keys(ENGINES).join(', '))
      else if (!db.engine.majors.includes(db.major)) curated(node, 'engineMajor', db.major, db.engine.majors.join(', '))
      if (!DB_INSTANCE_CLASSES.includes(db.instanceClass)) curated(node, 'instanceClass', db.instanceClass, DB_INSTANCE_CLASSES.join(', '))
      if (!Number.isInteger(db.backupRetentionDays) || db.backupRetentionDays < 1 || db.backupRetentionDays > 35) curated(node, 'backupRetentionDays', db.backupRetentionDays, '1-35')
      if (db.storageClamped) {
        note('warning', 'IAC-W11', node, `${node.codeName}: storage clamped to ${db.storageGiB} GiB (RDS allows ${20}-${65536}).`, `${node.codeName}: dung lượng được giới hạn về ${db.storageGiB} GiB.`, '.config.storageGiB')
      }
      if (!db.deletionProtection) {
        note('warning', 'IAC-W05', node, `${node.codeName}: deletion protection is off.`, `${node.codeName}: đã tắt chống xóa.`, '.config.deletionProtection')
      }
      if (subnet.exposure === 'public') {
        note('warning', 'IAC-W10', node, `${node.codeName} is stateful and sits in a public tier (it stays not publicly accessible).`,
          `${node.codeName} có trạng thái và nằm ở tầng công khai (vẫn không truy cập công khai).`, '.parentId')
      }
    }
  }

  for (const vpc of topology.vpcs) {
    const privateTiers = vpc.subnets.filter((subnet) => subnet.exposure === 'private')
    const publicTiers = vpc.subnets.filter((subnet) => subnet.exposure === 'public')
    if (options.nat !== 'none' && privateTiers.length > 0) {
      if (publicTiers.length === 0) {
        err('AWS-E05', vpc.node, `${vpc.node.codeName}: NAT (${options.nat}) needs a public tier to live in.`, `${vpc.node.codeName}: NAT (${options.nat}) cần một tầng công khai.`,
          'Add a public tier, or set the NAT option to none.', 'Thêm một tầng công khai, hoặc đặt NAT là none.')
      } else if (options.nat === 'perZone' && !publicTiers.some((subnet) => subnet.stretched)) {
        err('AWS-E05', vpc.node, `${vpc.node.codeName}: NAT per zone needs a public tier that spans every zone.`, `${vpc.node.codeName}: NAT mỗi vùng cần một tầng công khai trải mọi vùng.`,
          'Make one public tier span all zones, or use NAT single.', 'Cho một tầng công khai trải mọi vùng, hoặc dùng NAT single.')
      } else if (options.nat === 'perZone') {
        note('warning', 'IAC-W06', vpc.node, `${vpc.node.codeName}: one NAT gateway per zone (${vpc.zoneCount}) is billed per hour each.`,
          `${vpc.node.codeName}: mỗi vùng một cổng NAT (${vpc.zoneCount}), mỗi cổng tính phí theo giờ.`)
      }
    }
    if (vpc.zonesAssumed) {
      note('info', 'IAC-I03', vpc.node, `${vpc.node.codeName}: no zone containers, so ${vpc.zoneCount} availability zones are assumed.`,
        `${vpc.node.codeName}: không có vùng, giả định ${vpc.zoneCount} vùng khả dụng.`)
    }
  }
  return out
}

type Err = (ruleId: string, node: ArchNodeV2, en: string, vi: string, fixEn: string, fixVi: string, field?: string) => void
type Note = (severity: 'warning' | 'info', ruleId: string, node: ArchNodeV2 | undefined, en: string, vi: string, field?: string) => void

function checkLoadBalancer(ctx: TargetContext, topology: AwsTopology, node: ArchNodeV2, links: AccessLink[], err: Err, note: Note): void {
  const subnet = subnetOf(ctx, topology, node.id)!
  const scheme = String(configOf(node, 'scheme'))
  const protocol = String(configOf(node, 'protocol'))
  if (!subnet.stretched || subnet.vpc.zoneCount < 2) {
    err('AWS-E01', node, `${node.codeName} would span fewer than 2 zones.`, `${node.codeName} sẽ trải ít hơn 2 vùng.`,
      'Place the load balancer in a tier that spans at least two zones.', 'Đặt bộ cân bằng tải vào tầng trải ít nhất hai vùng.', '.parentId')
  }
  if (scheme === 'internet_facing' && subnet.exposure !== 'public') {
    err('AWS-E03', node, `${node.codeName} is internet-facing but sits in ${subnet.node.codeName} (${subnet.exposure}).`,
      `${node.codeName} hướng internet nhưng nằm trong ${subnet.node.codeName} (${subnet.exposure}).`,
      'Move it to a public tier, or set its scheme to internal.', 'Chuyển nó sang tầng công khai, hoặc đặt scheme là internal.', '.parentId')
  }
  if (protocol !== 'http' && protocol !== 'https') {
    err('IAC-E07', node, `${node.codeName}: protocol ${protocol} needs a layer-4 load balancer.`, `${node.codeName}: giao thức ${protocol} cần cân bằng tải lớp 4.`,
      'Use protocol http or https, or set layer to l4 (manual in this version).', 'Dùng http hoặc https, hoặc đặt layer là l4 (thủ công ở phiên bản này).', '.config.protocol')
  }
  const targets = links.filter((link) => link.source.id === node.id && link.target.type === 'service')
  if (targets.length === 0) {
    err('AWS-E01', node, `${node.codeName} has no access edge to a service.`, `${node.codeName} chưa có cạnh truy cập tới dịch vụ nào.`,
      'Draw an access edge (connect) from the load balancer to the service it fronts.', 'Vẽ cạnh truy cập (connect) từ bộ cân bằng tải tới dịch vụ.')
  } else if (targets.length > 1) {
    err('IAC-E05', node, `${node.codeName} fronts ${targets.length} services; aws-terraform 0.1.0 supports one service per load balancer.`,
      `${node.codeName} đứng trước ${targets.length} dịch vụ; aws-terraform 0.1.0 chỉ hỗ trợ một dịch vụ mỗi bộ cân bằng tải.`,
      'Use one load balancer per service for now (path routing arrives later).', 'Tạm dùng một bộ cân bằng tải cho mỗi dịch vụ.')
  }
  const fromClient = links.filter((link) => link.target.id === node.id && link.source.type === 'client')
  if (fromClient.length > 0 && scheme !== 'internet_facing') {
    err('IAC-E05', node, `${node.codeName} is internal but a client connects to it from outside.`, `${node.codeName} là nội bộ nhưng có client kết nối từ bên ngoài.`,
      'Set the scheme to internet_facing, or remove the client edge.', 'Đặt scheme là internet_facing, hoặc xóa cạnh từ client.')
  }
  const healthPath = String(configOf(node, 'healthPath') ?? '/health')
  if (!/^\/[\x21-\x7e]{0,1023}$/.test(healthPath)) {
    err('IAC-E07', node, `${node.codeName}: healthPath ${JSON.stringify(healthPath)} is not a URL path.`, `${node.codeName}: healthPath ${JSON.stringify(healthPath)} không phải đường dẫn URL.`,
      'Use a path starting with / and without spaces.', 'Dùng đường dẫn bắt đầu bằng / và không có dấu cách.', '.config.healthPath')
  }
  if (protocol === 'http') {
    note('warning', 'IAC-W02', node, `${node.codeName}: the listener is HTTP only (no TLS).`, `${node.codeName}: listener chỉ có HTTP (không TLS).`, '.config.protocol')
  }
}

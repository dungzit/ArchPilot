/**
 * Prefilled text for the manual HLD sections (pilot: no AI; 06 "S" sections
 * become manual text that starts from a skeleton derived from the model).
 *
 * Pure. The screen shows `buildSkeleton(...)[field]` until the user edits a
 * field; only edited fields are stored, so a skeleton follows the design and
 * the document language until it is touched (TP-05: edits are never lost).
 */
import type { SizingRun } from '../../contracts/pilot'
import { getRole } from '../graph/catalog'
import type { ArchGraphV2, ArchNodeV2, ConfigValue } from '../graph/types'
import { formatNumber, formatValue } from './format'
import type { HldDesignInput, HldLanguage, HldManual, HldMeta } from './types'

export interface SkeletonInput {
  design: HldDesignInput
  runs: SizingRun[] | null
  meta: Pick<HldMeta, 'customer' | 'projectName'>
  language: HldLanguage
}

const ANNOTATION_ROLES = new Set(['note', 'shape', 'text'])

export function isAnnotation(node: ArchNodeV2): boolean {
  return ANNOTATION_ROLES.has(node.type) || node.annotation !== undefined
}

function nodesOf(graph: ArchGraphV2 | null, roles: string[]): ArchNodeV2[] {
  if (!graph) return []
  const wanted = new Set(roles)
  return graph.nodes.filter((node) => wanted.has(node.type))
}

function names(nodes: ArchNodeV2[]): string {
  return nodes.map((node) => node.label).join(', ')
}

function numberAnswer(graph: ArchGraphV2 | null, key: string): number | undefined {
  const value = graph?.brief?.answers?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

const CONTEXT_LABELS: Record<string, { vi: string; en: string }> = {
  hostingIntent: { vi: 'Hình thức triển khai', en: 'Hosting intent' },
  dataResidency: { vi: 'Vị trí lưu trữ dữ liệu', en: 'Data residency' },
  airGapped: { vi: 'Mạng cách ly (air-gapped)', en: 'Air-gapped' },
  budgetClass: { vi: 'Mức ngân sách', en: 'Budget class' },
  existingPlatforms: { vi: 'Nền tảng sẵn có', en: 'Existing platforms' },
}

export function buildSkeleton(input: SkeletonInput): HldManual {
  const { design, runs, meta, language } = input
  const vi = language === 'vi'
  const graph = design.graph
  const nodes = (graph?.nodes ?? []).filter((node) => !isAnnotation(node))
  const edges = graph?.edges ?? []
  const project = meta.projectName.trim() || design.name
  const customer = meta.customer.trim()
  const n = (value: number) => formatNumber(value, language)

  // 1 Introduction
  const intro = vi
    ? [
        `Mục đích: Tài liệu mô tả thiết kế mức cao (HLD) của dự án ${project}${customer ? ` cho ${customer}` : ''}, dựa trên thiết kế "${design.name}" trong ArchPilot.`,
        `Phạm vi: ${n(nodes.length)} thành phần và ${n(edges.length)} kết nối của thiết kế, kết quả sizing và các rủi ro đã biết.`,
        'Thuật ngữ:',
        '- HLD: High-Level Design, thiết kế mức cao',
        '- RPO/RTO: lượng dữ liệu tối đa có thể mất / thời gian khôi phục tối đa',
        'Tài liệu tham chiếu:',
        '- RFP/TOR của khách hàng (bổ sung số hiệu và ngày)',
      ]
    : [
        `Purpose: this document describes the high-level design (HLD) of project ${project}${customer ? ` for ${customer}` : ''}, based on the ArchPilot design "${design.name}".`,
        `Scope: the design's ${n(nodes.length)} components and ${n(edges.length)} connections, the sizing results and the known risks.`,
        'Terms:',
        '- HLD: High-Level Design',
        '- RPO/RTO: maximum tolerable data loss / maximum time to recover',
        'Reference documents:',
        "- Customer RFP/TOR (add the reference number and date)",
      ]

  // 2.1 Business overview
  const purpose = graph?.brief?.context?.purpose
  const business = [
    typeof purpose === 'string' && purpose.trim()
      ? vi ? `Mục đích nghiệp vụ: ${purpose.trim()}` : `Business purpose: ${purpose.trim()}`
      : vi ? 'Mục đích nghiệp vụ: (mô tả bài toán của khách hàng)' : "Business purpose: (describe the customer's problem)",
    vi ? 'Người dùng chính: …' : 'Main users: …',
    vi ? 'Quy trình nghiệp vụ chính: …' : 'Main business processes: …',
  ]

  // 2.2 Functional summary: one line per application-facing component.
  const functionalNodes = nodesOf(graph, ['service', 'function', 'api_gateway'])
  const functional = functionalNodes.length > 0
    ? functionalNodes.map((node) => `- ${node.label}: ${node.rationale?.trim() || (vi ? '(chức năng chính)' : '(main function)')}`)
    : [vi ? '- Chức năng 1: …' : '- Function 1: …', vi ? '- Chức năng 2: …' : '- Function 2: …']

  // 2.3 Non-functional requirements from the design brief, when answered.
  const availabilityTarget = numberAnswer(graph, 'availabilityTarget')
  const rpo = numberAnswer(graph, 'rpoMinutes')
  const rto = numberAnswer(graph, 'rtoMinutes')
  const peakRps = numberAnswer(graph, 'peakRps')
  const readWrite = numberAnswer(graph, 'readWriteRatio')
  const nonFunctional = [
    vi ? `- Tính sẵn sàng (SLA): ${availabilityTarget !== undefined ? `${n(availabilityTarget)}%` : '…'}` : `- Availability (SLA): ${availabilityTarget !== undefined ? `${n(availabilityTarget)}%` : '…'}`,
    `- RPO: ${rpo !== undefined ? `${n(rpo)} ${vi ? 'phút' : 'minutes'}` : '…'}`,
    `- RTO: ${rto !== undefined ? `${n(rto)} ${vi ? 'phút' : 'minutes'}` : '…'}`,
    vi ? `- Tải đỉnh: ${peakRps !== undefined ? `${n(peakRps)} request/giây` : '…'}` : `- Peak load: ${peakRps !== undefined ? `${n(peakRps)} requests/second` : '…'}`,
    ...(readWrite !== undefined ? [vi ? `- Tỷ lệ đọc/ghi: ${n(readWrite)}:1` : `- Read/write ratio: ${n(readWrite)}:1`] : []),
    vi ? '- Bảo mật: …' : '- Security: …',
    vi ? '- Tuân thủ: …' : '- Compliance: …',
  ]

  // 2.4 Constraints from the brief context.
  const context = graph?.brief?.context ?? {}
  const constraintLines = Object.entries(context)
    .filter(([key]) => key !== 'purpose')
    .map(([key, value]: [string, ConfigValue]) => `- ${CONTEXT_LABELS[key]?.[language] ?? key}: ${formatValue(value, language)}`)
  const constraints = constraintLines.length > 0
    ? constraintLines
    : [vi ? '- Ràng buộc về hạ tầng sẵn có: …' : '- Existing infrastructure: …', vi ? '- Ràng buộc về ngân sách, thời gian: …' : '- Budget and schedule: …']

  // 3.1 Principles: a sensible default list.
  const principles = vi
    ? [
        '- Trung lập nhà cung cấp: thiết kế logic trước, chọn nền tảng triển khai sau.',
        '- Không có điểm lỗi đơn cho thành phần quan trọng (từ 2 bản sao, đặt ở các miền lỗi khác nhau).',
        '- Bảo mật nhiều lớp: phân vùng mạng, mã hóa khi truyền và khi lưu, quyền tối thiểu.',
        '- Tầng ứng dụng không trạng thái, mở rộng theo chiều ngang.',
        '- Tự động hóa triển khai và vận hành (IaC, giám sát, cảnh báo).',
      ]
    : [
        '- Provider-neutral: logical design first, deployment target chosen later.',
        '- No single point of failure for critical components (2+ replicas in separate failure domains).',
        '- Defence in depth: network segmentation, encryption in transit and at rest, least privilege.',
        '- Stateless application tier that scales horizontally.',
        '- Automated deployment and operations (IaC, monitoring, alerting).',
      ]

  // 4 Deployment notes.
  const environment = graph?.settings?.environment
  const deployment = [
    vi ? `Môi trường của thiết kế: ${environment ?? '…'}.` : `Design environment: ${environment ?? '…'}.`,
    vi ? '- Các môi trường Prod / DR / UAT / Dev: …' : '- Prod / DR / UAT / Dev environments: …',
    vi ? '- Phân vùng mạng và security zone: …' : '- Network zones and security zones: …',
    vi ? '- Luồng dữ liệu chính: …' : '- Main data flows: …',
  ]

  // 5 HA/DR from replicas, statefulness and the brief targets.
  const redundant = nodes.filter((node) => (node.attributes?.replicas ?? 1) >= 2)
  const stateful = nodes.filter((node) => (node.attributes?.statefulness ?? getRole(node.type)?.defaultAttributes.statefulness) === 'stateful')
  const singleCritical = nodes.filter(
    (node) => (node.attributes?.replicas ?? 1) < 2 && (node.attributes?.criticality ?? getRole(node.type)?.defaultAttributes.criticality) === 'high',
  )
  const availability = [
    vi
      ? `Mục tiêu: SLA ${availabilityTarget !== undefined ? `${n(availabilityTarget)}%` : '…'}, RPO ${rpo !== undefined ? `${n(rpo)} phút` : '…'}, RTO ${rto !== undefined ? `${n(rto)} phút` : '…'}.`
      : `Targets: SLA ${availabilityTarget !== undefined ? `${n(availabilityTarget)}%` : '…'}, RPO ${rpo !== undefined ? `${n(rpo)} minutes` : '…'}, RTO ${rto !== undefined ? `${n(rto)} minutes` : '…'}.`,
    ...redundant.map((node) =>
      vi
        ? `- ${node.label}: ${n(node.attributes?.replicas ?? 1)} bản sao${node.attributes?.failureDomainLevel ? `, tách theo ${node.attributes.failureDomainLevel}` : ''}.`
        : `- ${node.label}: ${n(node.attributes?.replicas ?? 1)} replicas${node.attributes?.failureDomainLevel ? `, spread across ${node.attributes.failureDomainLevel}` : ''}.`,
    ),
    ...(stateful.length > 0 ? [vi ? `- Cơ chế replication cho thành phần có trạng thái (${names(stateful)}): …` : `- Replication for stateful components (${names(stateful)}): …`] : []),
    ...singleCritical.map((node) => (vi ? `- Cần xem xét: ${node.label} quan trọng nhưng chỉ có 1 bản sao.` : `- To review: ${node.label} is critical but has a single replica.`)),
    vi ? '- Kịch bản failover và chuyển sang DR: …' : '- Failover and DR switch-over scenario: …',
  ]

  // 8 Security.
  const idp = nodesOf(graph, ['identity_provider'])
  const keys = nodesOf(graph, ['key_management', 'secrets_vault', 'certificate_authority'])
  const perimeter = nodesOf(graph, ['firewall', 'waf', 'ddos_protection'])
  const logs = nodesOf(graph, ['siem_log_store'])
  const sensitive = nodes.filter((node) => node.attributes?.dataClassification === 'confidential' || node.attributes?.dataClassification === 'restricted')
  const listOr = (items: ArchNodeV2[]) => (items.length > 0 ? names(items) : '…')
  const security = vi
    ? [
        `- Quản lý định danh và truy cập (IAM): ${listOr(idp)}`,
        `- Mã hóa và quản lý khóa: ${listOr(keys)}`,
        `- An ninh mạng: ${listOr(perimeter)}`,
        `- Ghi log và audit: ${listOr(logs)}`,
        `- Tuân thủ và dữ liệu nhạy cảm: ${listOr(sensitive)}`,
      ]
    : [
        `- Identity and access management (IAM): ${listOr(idp)}`,
        `- Encryption and key management: ${listOr(keys)}`,
        `- Network security: ${listOr(perimeter)}`,
        `- Logging and audit: ${listOr(logs)}`,
        `- Compliance and sensitive data: ${listOr(sensitive)}`,
      ]

  // 9 Operations.
  const monitoring = nodesOf(graph, ['monitoring'])
  const backups = nodesOf(graph, ['backup_target'])
  const runCount = runs?.length ?? 0
  const operations = vi
    ? [
        `- Giám sát và cảnh báo: ${listOr(monitoring)}`,
        `- Sao lưu và khôi phục: ${listOr(backups)}`,
        '- Vá lỗi và cập nhật (patching): …',
        `- Quản lý capacity: theo dõi so với kết quả sizing (${n(runCount)} lần chạy đã lưu).`,
      ]
    : [
        `- Monitoring and alerting: ${listOr(monitoring)}`,
        `- Backup and restore: ${listOr(backups)}`,
        '- Patching and updates: …',
        `- Capacity management: track against the sizing results (${n(runCount)} saved runs).`,
      ]

  // 11 Rollout.
  const rollout = vi
    ? ['- Giai đoạn 1 — Chuẩn bị hạ tầng: …', '- Giai đoạn 2 — Triển khai và kiểm thử: …', '- Giai đoạn 3 — Chuyển đổi và vận hành: …']
    : ['- Phase 1 — Infrastructure preparation: …', '- Phase 2 — Deployment and testing: …', '- Phase 3 — Cut-over and operations: …']

  // PL-C: unconfirmed assumptions and sizing inputs without a source.
  const questions: string[] = []
  for (const assumption of graph?.brief?.assumptions ?? []) {
    questions.push(vi
      ? `Xác nhận giả định ${assumption.key} = ${formatValue(assumption.value, language)}?`
      : `Confirm the assumption ${assumption.key} = ${formatValue(assumption.value, language)}?`)
  }
  for (const run of runs ?? []) {
    const label = run.componentLabel?.trim() || run.modelName
    for (const item of run.inputs ?? []) {
      if (item.source && item.source.trim()) continue
      questions.push(vi
        ? `Xác nhận ${item.name} = ${formatNumber(item.value, language)} ${item.unit} cho ${label}?`
        : `Confirm ${item.name} = ${formatNumber(item.value, language)} ${item.unit} for ${label}?`)
    }
  }

  const join = (lines: string[]) => lines.join('\n')
  return {
    intro: join(intro),
    business: join(business),
    functional: join(functional),
    nonFunctional: join(nonFunctional),
    constraints: join(constraints),
    principles: join(principles),
    deployment: join(deployment),
    availability: join(availability),
    security: join(security),
    operations: join(operations),
    risks: '',
    rollout: join(rollout),
    questions: join(questions.slice(0, 40)),
  }
}

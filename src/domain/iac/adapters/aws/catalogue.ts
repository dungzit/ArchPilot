/**
 * The `aws` realisation catalogue bundled with `aws-terraform` 0.1.0
 * (design-v2 4.3.6 and 4.4.8; versioned with the adapter, C-v2-8 / M11).
 *
 * 0.1.0 is the Phase 1 slice (design-v2 5.2 tasks 1.3, 1.4): network (site,
 * zone, VPC, subnets, NAT), load balancer, ECS Fargate service, container
 * platform, RDS, firewall-as-rules. The other Must rows (cache, queue,
 * object_storage, cdn) arrive with Phase 3 (task 3.1); until then they are
 * honest `manual` rows with a checklist, never silently dropped.
 *
 * Every catalogue role resolves to exactly one row (a test asserts it), so
 * the coverage report never says "no realisation" for a known role.
 */
import { catalog } from '../../../graph/catalog'
import type { AccessPair, Realisation, RealisationCatalogue } from '../../core/types'

const en = (text: string) => ({ en: text, vi: text })

const generatable: Realisation[] = [
  {
    id: 'aws.region', role: 'site', label: { en: 'AWS region', vi: 'Vùng AWS' }, badge: 'generatable', detail: 'implicit',
    note: { en: 'The target region (var.aws_region); no resource of its own.', vi: 'Vùng đích (var.aws_region); không có tài nguyên riêng.' },
    consumes: ['siteKind'],
  },
  {
    id: 'aws.az', role: 'zone', label: { en: 'Availability zone', vi: 'Vùng khả dụng' }, badge: 'generatable', detail: 'implicit',
    note: { en: 'Maps to an availability zone of the region, in code-name order.', vi: 'Ánh xạ tới một vùng khả dụng của vùng, theo thứ tự tên mã.' },
    consumes: ['zoneKind'],
  },
  {
    id: 'aws.vpc', role: 'network_segment', when: { variant: ['network'] }, label: { en: 'VPC', vi: 'VPC' }, badge: 'generatable',
    note: { en: 'aws_vpc with DNS support; an internet gateway when a public segment exists.', vi: 'aws_vpc có DNS; cổng internet khi có phân đoạn công khai.' },
    consumes: ['cidr'], requires: ['cidr'],
  },
  {
    id: 'aws.subnets', role: 'network_segment', label: { en: 'Subnets', vi: 'Mạng con' }, badge: 'generatable',
    note: { en: 'One subnet per zone (stretched) or one (zone-local), route table, NAT per the target option.', vi: 'Một mạng con mỗi vùng (trải) hoặc một (cục bộ vùng), bảng định tuyến, NAT theo tùy chọn đích.' },
    consumes: ['cidr', 'exposure'], requires: ['cidr'],
  },
  {
    id: 'aws.alb', role: 'load_balancer', when: { configKey: 'layer', in: ['l7'] }, label: { en: 'Application Load Balancer', vi: 'Application Load Balancer' }, badge: 'generatable',
    note: { en: 'aws_lb (application), target group, listeners; HTTPS with a TLS 1.3 policy when protocol is https.', vi: 'aws_lb (application), nhóm đích, listener; HTTPS với chính sách TLS 1.3 khi giao thức là https.' },
    consumes: ['scheme', 'layer', 'protocol', 'healthPath', 'replicas'],
  },
  {
    id: 'aws.sg_rules', role: 'firewall', label: { en: 'Security-group rules', vi: 'Luật security group' }, badge: 'generatable', detail: 'implicit',
    note: { en: 'Generated as security-group rules from access edges (default deny, only needed ports).', vi: 'Sinh thành luật security group từ các cạnh truy cập (mặc định chặn, chỉ mở cổng cần).' },
    consumes: ['inspection', 'defaultPolicy'],
  },
  {
    id: 'aws.ecs_fargate', role: 'service', when: { variant: ['web', 'api', 'worker'] }, label: { en: 'ECS service on Fargate', vi: 'Dịch vụ ECS trên Fargate' }, badge: 'generatable',
    note: { en: 'Task definition, ECS service (no public IP), log group, execution role, security group.', vi: 'Task definition, dịch vụ ECS (không IP công khai), log group, vai trò thực thi, security group.' },
    consumes: ['port', 'healthPath', 'replicas'],
  },
  {
    id: 'aws.ecs_cluster', role: 'container_platform', label: { en: 'ECS cluster', vi: 'Cụm ECS' }, badge: 'generatable',
    note: { en: 'aws_ecs_cluster with Container Insights; services inside it run on it.', vi: 'aws_ecs_cluster bật Container Insights; dịch vụ bên trong chạy trên cụm này.' },
    consumes: ['nodeCount'],
  },
  {
    id: 'aws.rds', role: 'relational_db', when: { configKey: 'engine', in: ['postgres', 'postgresql', 'mysql', 'mariadb'] }, label: { en: 'Amazon RDS', vi: 'Amazon RDS' }, badge: 'generatable',
    note: { en: 'aws_db_instance: managed master secret, encrypted, private, deletion protection, final snapshot.', vi: 'aws_db_instance: bí mật quản lý, mã hóa, riêng tư, chống xóa, ảnh chụp cuối.' },
    consumes: ['engine', 'engineMajor', 'storageGiB', 'backupRetentionDays', 'deletionProtection', 'replicas'], requires: ['engine'],
  },
]

/** Manual in 0.1.0, with the version that brings the mapping. */
const plannedManual: [role: string, id: string, text: string][] = [
  ['cache', 'aws.elasticache', 'Create an ElastiCache (Valkey or Redis) replication group for {codeName} with encryption at rest and in transit. Mapping arrives in aws-terraform 1.0.0.'],
  ['queue', 'aws.sqs', 'Create an SQS queue for {codeName} with SSE and a dead-letter queue. Mapping arrives in aws-terraform 1.0.0.'],
  ['object_storage', 'aws.s3', 'Create an S3 bucket for {codeName} with all four public-access blocks, SSE and a TLS-only bucket policy. Mapping arrives in aws-terraform 1.0.0.'],
  ['cdn', 'aws.cloudfront', 'Create a CloudFront distribution for {codeName} with redirect-to-https. Mapping arrives in aws-terraform 1.0.0.'],
]

const manualRoles: [role: string, id: string, text: string][] = [
  ['key_value_store', 'aws.dynamodb', 'Create a DynamoDB table for {codeName} (on-demand, point-in-time recovery, encryption).'],
  ['dns', 'aws.route53', 'Create or delegate the Route 53 hosted zone {zoneName} and records for {codeName}.'],
  ['secrets_vault', 'aws.secrets_manager', 'Create the Secrets Manager secrets {codeName} needs; never put values in code. RDS master passwords are managed automatically.'],
  ['key_management', 'aws.kms', 'Create a customer-managed KMS key for {codeName} with rotation on.'],
  ['virtual_machine', 'aws.ec2', 'Launch the EC2 instance {codeName} from a hardened AMI in a private subnet, with IMDSv2 required.'],
  ['identity_provider', 'aws.identity_center', 'Connect {codeName} through IAM Identity Center or Cognito, as the organisation requires.'],
  ['siem_log_store', 'aws.siem', 'Route logs for {codeName} to the organisation SIEM or a locked log archive account.'],
  ['artifact_registry', 'aws.ecr', 'Create an ECR repository for {codeName} with image scanning and immutable tags.'],
  ['api_gateway', 'aws.api_gateway', 'Create an API Gateway for {codeName} with the authorisation mode {authMode}.'],
  ['block_storage', 'aws.ebs', 'Create encrypted EBS volumes for {codeName}.'],
  ['backup_target', 'aws.backup', 'Create an AWS Backup plan for {codeName} keeping backups {retentionDays} days.'],
  ['function', 'aws.lambda', 'Create the Lambda function {codeName} with its own least-privilege role.'],
  ['waf', 'aws.wafv2', 'Attach an AWS WAF web ACL for {codeName} in {mode} mode.'],
  ['reverse_proxy', 'aws.reverse_proxy', 'Realise {codeName} as listener rules on the load balancer or as a service.'],
  ['ddos_protection', 'aws.shield', 'Review AWS Shield (Standard is automatic; Advanced is a subscription) for {codeName}.'],
  ['vpn_link', 'aws.vpn', 'Create the Site-to-Site VPN or Direct Connect for {codeName}.'],
  ['document_db', 'aws.documentdb', 'Create the document database {codeName} (DocumentDB or DynamoDB).'],
  ['search_index', 'aws.opensearch', 'Create an OpenSearch domain for {codeName} inside the VPC.'],
  ['pubsub_topic', 'aws.sns', 'Create an SNS topic for {codeName} with SSE.'],
  ['event_stream', 'aws.kinesis', 'Create a Kinesis stream or MSK cluster for {codeName}.'],
  ['certificate_authority', 'aws.acm_pca', 'Issue certificates for {codeName} with ACM or ACM Private CA.'],
  ['monitoring', 'aws.cloudwatch', 'Create CloudWatch dashboards and alarms for {codeName}.'],
]

const scheduler: Realisation = {
  id: 'aws.ecs_scheduled_task', role: 'service', when: { variant: ['scheduler'] }, label: en('ECS scheduled task'), badge: 'manual',
  note: { en: 'Scheduled tasks are not generated in 0.1.0.', vi: 'Tác vụ theo lịch chưa được sinh ở 0.1.0.' }, consumes: [],
  manualSteps: [{ id: 'schedule', text: en('Create an EventBridge Scheduler rule that runs {codeName} on the schedule {schedule}.') }],
}

const nlb: Realisation = {
  id: 'aws.nlb', role: 'load_balancer', label: en('Network Load Balancer'), badge: 'manual',
  note: { en: 'Layer-4 load balancers are not generated in 0.1.0.', vi: 'Cân bằng tải lớp 4 chưa được sinh ở 0.1.0.' }, consumes: [],
  manualSteps: [{ id: 'nlb', text: en('Create a Network Load Balancer for {codeName} in at least two zones.') }],
}

const rdsOther: Realisation = {
  id: 'aws.rds_other_engine', role: 'relational_db', label: en('Relational database (other engine)'), badge: 'manual',
  note: { en: 'Only postgres, mysql and mariadb are generated; set engine to one of them.', vi: 'Chỉ sinh postgres, mysql và mariadb; hãy đặt engine là một trong số đó.' }, consumes: [],
  manualSteps: [{ id: 'engine', text: en('Provision {codeName} (engine {engine}) by hand, or change its engine to postgres, mysql or mariadb.') }],
}

// requirements v2.1 8.3: physical gear has no AWS realisation.
const unsupportedRoles = ['bare_metal_host', 'hypervisor_cluster', 'san', 'file_storage', 'switch', 'router']

function manualRow([role, id, text]: [string, string, string]): Realisation {
  return {
    id, role, label: en(id), badge: 'manual',
    note: { en: 'Manual on aws in this adapter version; see MANUAL-STEPS.md.', vi: 'Thủ công trên aws ở phiên bản adapter này; xem MANUAL-STEPS.md.' },
    consumes: [], manualSteps: [{ id: 'provision', text: en(text) }],
  }
}

function unsupportedRow(role: string): Realisation {
  return {
    id: `aws.none_${role}`, role, label: en('No AWS realisation'), badge: 'unsupported',
    note: { en: 'Physical or on-prem component: no AWS realisation.', vi: 'Thành phần vật lý hoặc tại chỗ: không có hiện thực AWS.' }, consumes: [],
  }
}

const pair = (source: string, target: string, modes: string[], note: string): AccessPair => ({ source, target, modes, note: en(note) })

export const AWS_ACCESS_PAIRS: AccessPair[] = [
  pair('client', 'load_balancer', ['connect'], 'Load balancer security group allows the listener port(s) from the internet.'),
  pair('load_balancer', 'service', ['connect'], 'Target group; load balancer to service security-group rules on the service port.'),
  pair('service', 'load_balancer', ['connect'], 'Service to internal load balancer security-group rules; URL environment variable.'),
  pair('service', 'relational_db', ['connect', 'read', 'write', 'read_write'], 'Service to database security-group rules; host, port, name and secret ARN in the task.'),
  pair('service', 'external_service', ['connect', 'send', 'read', 'write', 'read_write'], 'Base URL variable passed to the service.'),
  pair('service', 'cache', ['connect', 'read', 'write', 'read_write'], 'Security-group rules and endpoint environment variables (1.0.0).'),
  pair('service', 'queue', ['send', 'consume', 'send_consume'], 'Task-role IAM statements on the queue ARN (1.0.0).'),
  pair('service', 'object_storage', ['read', 'write', 'read_write'], 'Task-role IAM statements on the bucket ARN (1.0.0).'),
  pair('client', 'cdn', ['connect', 'read'], 'No code: the distribution is public by design.'),
  pair('cdn', 'object_storage', ['read'], 'Origin access control and bucket policy (1.0.0).'),
]

export const AWS_CATALOGUE: RealisationCatalogue = {
  target: 'aws',
  version: '0.1.0',
  realisations: [
    ...generatable,
    scheduler, nlb, rdsOther, // no-when fallbacks after the generatable rows of the same role
    ...plannedManual.map(manualRow),
    ...manualRoles.map(manualRow),
    ...unsupportedRoles.map(unsupportedRow),
  ],
  aliases: [],
  accessPairs: AWS_ACCESS_PAIRS,
  unmappedAccess: 'error',
}

/** Roles with no row at all would read "no realisation": the test in catalogue.test.ts keeps this list empty. */
export function rolesWithoutRow(): string[] {
  return catalog.roles
    .filter((role) => role.codeBearing && !AWS_CATALOGUE.realisations.some((realisation) => realisation.role === role.id))
    .map((role) => role.id)
}

/**
 * `vsphere-terraform` 0.1.0 - the Phase 1 vSphere SPIKE (design-v2 4.4.9,
 * task 1.7, milestone M1). Registered as `test`, so the UI does not offer it.
 *
 * Proves that the adapter interface, IR, printer, packaging and CI harness
 * serve a second provider: existing datacenter / cluster / datastore / port
 * groups as data sources, and each `virtual_machine` cloned from a template
 * with template-derived guest settings (review M4), an OS disk never smaller
 * than the template's, explicit thin/thick, and a fixed IP (static mode)
 * written as cloud-init network-config v2 into guestinfo metadata.
 *
 * Secrets: `vsphere_user` / `vsphere_password` are sensitive variables with no
 * default and no tfvars value (supplied as TF_VAR_* from CI secrets). No
 * guest passwords; user-data carries only an optional SSH public key.
 *
 * Not in the spike (Phase V): the generic vmGroup generator, anti-affinity by
 * edition, data disks from sizing, pipelines, the VSP-E02 rule.
 */
import { catalog } from '../../../graph/catalog'
import { ancestors } from '../../../graph/containment'
import type { ArchNodeV2, ConfigValue, SizeClass } from '../../../graph/types'
import type { IacAdapter } from '../../core/adapter'
import { orderedNodes } from '../../core/context'
import { kebab, mdCode } from '../../core/text'
import type { IacProblem, ManualStep, TargetContext, ToolIr } from '../../core/types'
import { parseCidr } from '../../terraform/cidr'
import {
  attr, block, bool, call, data, forList, list, nul, num, obj, op, ref, resource, str, tmpl, type Block, type Expr,
} from '../../terraform/ir'
import { isTerraformIr, TERRAFORM_FILES, terraformAddressProblems, terraformFiles, type MainGroup, type TerraformIr, type TfOutput, type TfVariable } from '../../terraform/module'
import { label } from '../../terraform/naming'
import { TERRAFORM_REQUIRED_VERSION, VSPHERE_PROVIDER } from '../../versions'
import { fileHeader, TERRAFORM_VALIDATION_COMMANDS } from '../aws'
import VSPHERE_LOCK_FILE from './terraform.lock.hcl?raw'
import { VSPHERE_CATALOGUE } from './catalogue'

export const VSPHERE_ADAPTER_ID = 'vsphere-terraform'
export const VSPHERE_ADAPTER_VERSION = '0.1.0'

const REQUIRED_OPTIONS = ['server', 'datacenter', 'cluster', 'datastore', 'vmTemplate'] as const
const IPV4 = /^(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])){3}$/
const OPTION_TEXT = /^[A-Za-z0-9][A-Za-z0-9 ._/()-]{0,79}$/

interface Segment { node: ArchNodeV2; static: boolean; addresses: string[]; prefixLength: number; gateway: string; dnsServers: string[]; portGroup: string }
interface Vm { node: ArchNodeV2; segment: Segment; count: number; vcpu: number; memoryMiB: number }

function binding(ctx: TargetContext, nodeId: string): Record<string, ConfigValue> {
  return (ctx.doc.deployment?.bindings ?? []).find((b) => b.nodeId === nodeId && b.target === ctx.profile.target)?.config ?? {}
}

const strings = (value: ConfigValue | undefined): string[] => (Array.isArray(value) ? value : typeof value === 'string' && value !== '' ? [value] : [])

function model(ctx: TargetContext): { segments: Segment[]; vms: Vm[]; orphans: ArchNodeV2[] } {
  const generatable = new Map(ctx.coverage.nodes.filter((row) => row.class === 'generatable').map((row) => [row.nodeId, row.realisation]))
  const segments = new Map<string, Segment>()
  const vms: Vm[] = []
  const orphans: ArchNodeV2[] = []
  for (const node of orderedNodes(ctx.doc, (candidate) => generatable.get(candidate.id) === 'vsphere.vm')) {
    const segmentNode = ancestors(ctx.doc, node.id).map((id) => ctx.byId.get(id)!).find((up) => up.type === 'network_segment' && generatable.has(up.id))
    if (!segmentNode) {
      orphans.push(node)
      continue
    }
    if (!segments.has(segmentNode.id)) {
      const b = binding(ctx, segmentNode.id)
      segments.set(segmentNode.id, {
        node: segmentNode,
        static: (segmentNode.config?.ipMode ?? 'dhcp') === 'static',
        addresses: strings(b.ipv4Addresses),
        prefixLength: Number(b.prefixLength ?? parseCidr(String(segmentNode.config?.cidr ?? ''))?.prefix ?? 24),
        gateway: String(b.gateway ?? ''),
        dnsServers: strings(b.dnsServers),
        portGroup: String(b.portGroup ?? kebab(segmentNode.codeName)),
      })
    }
    const size = catalog.sizeClasses[(node.attributes?.sizeClass ?? 'S') as SizeClass]
    const b = binding(ctx, node.id)
    vms.push({
      node, segment: segments.get(segmentNode.id)!, count: node.attributes?.replicas ?? 1,
      vcpu: Number(b.vcpu ?? size.vcpu), memoryMiB: Number(b.memoryGiB ?? size.memoryGiB) * 1024,
    })
  }
  return { segments: [...segments.values()], vms, orphans }
}

function vsphereGate(ctx: TargetContext): IacProblem[] {
  const out: IacProblem[] = []
  const nodeError = (ruleId: string, node: ArchNodeV2, en: string, fix: string) => out.push({
    severity: 'error', ruleId, path: `nodes[${ctx.doc.nodes.indexOf(node)}]`, nodeId: node.id, message: { en, vi: en }, fix: { en: fix, vi: fix },
  })
  for (const key of REQUIRED_OPTIONS) {
    const value = ctx.options[key]
    if (typeof value !== 'string' || !OPTION_TEXT.test(value)) {
      out.push({ severity: 'error', ruleId: 'VSP-E01', path: `deployment.profiles.${ctx.profile.id}.options.${key}`,
        message: { en: `Target option ${key} is missing or not a plain name.`, vi: `Tùy chọn đích ${key} bị thiếu hoặc không hợp lệ.` },
        fix: { en: `Set ${key} (letters, digits, space . _ / ( ) -).`, vi: `Đặt ${key}.` } })
    }
  }
  if (ctx.options.allowUnverifiedSsl === true) {
    out.push({ severity: 'warning', ruleId: 'IAC-W05', path: `deployment.profiles.${ctx.profile.id}.options.allowUnverifiedSsl`,
      message: { en: 'TLS certificate checks against vCenter are turned off.', vi: 'Đã tắt kiểm tra chứng chỉ TLS của vCenter.' } })
  }
  const { segments, vms, orphans } = model(ctx)
  for (const node of orphans) nodeError('VSP-E01', node, `${node.codeName} has no network reference: place it inside a network segment.`, 'Drag the VM into a network segment.')
  for (const segment of segments) {
    if (!OPTION_TEXT.test(segment.portGroup)) nodeError('IAC-E07', segment.node, `${segment.node.codeName}: port group name ${JSON.stringify(segment.portGroup)} is not a plain name.`, 'Use letters, digits, space . _ / ( ) -.')
    if (!segment.static) continue
    const needed = vms.filter((vm) => vm.segment === segment).reduce((sum, vm) => sum + vm.count, 0)
    if (segment.addresses.length < needed) {
      nodeError('VSP-E03', segment.node, `${segment.node.codeName} uses static IPs but lists ${segment.addresses.length} address(es) for ${needed} VM(s).`, 'Add one IPv4 address per VM in the segment binding.')
    }
    for (const address of [...segment.addresses, segment.gateway, ...segment.dnsServers]) {
      if (!IPV4.test(address)) nodeError('IAC-E03', segment.node, `${segment.node.codeName}: ${JSON.stringify(address)} is not an IPv4 address.`, 'Use dotted IPv4 addresses.')
    }
    if (!Number.isInteger(segment.prefixLength) || segment.prefixLength < 8 || segment.prefixLength > 30) nodeError('IAC-E03', segment.node, `${segment.node.codeName}: prefix length ${segment.prefixLength} is out of range.`, 'Use 8-30.')
  }
  return out
}

function vsphereVariables(ctx: TargetContext): TfVariable[] {
  const text = (key: string) => String(ctx.options[key] ?? '')
  const plain = (name: string, description: string, value: string): TfVariable => ({ name, type: 'string', description, default: str(value) })
  return [
    { name: 'project_name', type: 'string', description: 'Short project name used in VM names.', default: str(kebab(ctx.doc.settings.codeName).slice(0, 16).replace(/-+$/, '')),
      validations: [{ condition: call('can', call('regex', str('^[a-z][a-z0-9-]{0,15}$'), ref('var.project_name'))), message: 'project_name must be 1-16 lower-case letters, digits or hyphens.' }] },
    plain('environment', 'Environment name used in VM names.', ctx.doc.settings.environment),
    plain('vsphere_server', 'vCenter server host name.', text('server')),
    { name: 'vsphere_user', type: 'string', description: 'vCenter user. Supply as TF_VAR_vsphere_user from a CI secret; never write it to a file.', sensitive: true },
    { name: 'vsphere_password', type: 'string', description: 'vCenter password. Supply as TF_VAR_vsphere_password from a CI secret; never write it to a file.', sensitive: true },
    { name: 'vsphere_allow_unverified_ssl', type: 'bool', description: 'Skip TLS verification of vCenter. Keep false; true raises IAC-W05.', default: bool(ctx.options.allowUnverifiedSsl === true) },
    plain('vsphere_datacenter', 'Existing datacenter name.', text('datacenter')),
    plain('vsphere_cluster', 'Existing compute cluster name.', text('cluster')),
    plain('vsphere_datastore', 'Existing datastore name.', text('datastore')),
    plain('vsphere_vm_template', 'Existing VM template to clone (cloud-init enabled).', text('vmTemplate')),
    { name: 'vsphere_vm_folder', type: 'string', description: 'Existing VM folder, or null for the datacenter root.', default: typeof ctx.options.vmFolder === 'string' ? str(ctx.options.vmFolder) : nul },
    { name: 'ssh_public_key', type: 'string', description: 'Optional SSH PUBLIC key for the default user. Never a private key or a password.', default: str(''),
      validations: [{ condition: op(op(ref('var.ssh_public_key'), '==', str('')), '||', call('can', call('regex', str('^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp[0-9]+) '), ref('var.ssh_public_key')))),
        message: 'ssh_public_key must be empty or an OpenSSH public key.' }] },
  ]
}

function vspherePlan(ctx: TargetContext): TerraformIr {
  const { segments, vms } = model(ctx)
  const dc = ref('data.vsphere_datacenter.this.id')
  const template = (path: string) => ref(`data.vsphere_virtual_machine.template.${path}`)
  const shared: Block[] = [
    data('vsphere_datacenter', 'this', [attr('name', ref('var.vsphere_datacenter'))]),
    data('vsphere_compute_cluster', 'this', [attr('name', ref('var.vsphere_cluster')), attr('datacenter_id', dc)]),
    data('vsphere_datastore', 'this', [attr('name', ref('var.vsphere_datastore')), attr('datacenter_id', dc)]),
    data('vsphere_virtual_machine', 'template', [attr('name', ref('var.vsphere_vm_template')), attr('datacenter_id', dc)]),
  ]
  const groups: MainGroup[] = [{ title: 'existing vSphere inventory (data sources)', blocks: shared }]
  const variables = vsphereVariables(ctx)
  const outputs: TfOutput[] = []

  for (const segment of segments) {
    const cn = segment.node.codeName
    groups.push({ title: `${cn} (network_segment, existing port group)`, codeName: cn, blocks: [data('vsphere_network', label(cn), [attr('name', ref(`var.${cn}_port_group`)), attr('datacenter_id', dc)])] })
    variables.push({ name: `${cn}_port_group`, type: 'string', description: `Existing port group of ${cn}.`, default: str(segment.portGroup), codeName: cn })
    if (segment.static) {
      const onSegment = vms.filter((vm) => vm.segment === segment)
      const total = onSegment.map((vm) => ref(`var.${vm.node.codeName}_vm_count`)).reduce((a, b) => op(a, '+', b))
      variables.push(
        { name: `${cn}_ipv4_addresses`, type: 'list(string)', description: `Fixed IPv4 addresses for the VMs in ${cn}, in VM order.`, default: list(segment.addresses.map(str)), codeName: cn,
          validations: [
            { condition: op(call('length', ref(`var.${cn}_ipv4_addresses`)), '>=', total), message: `${cn}_ipv4_addresses needs one address per VM (VSP-E03).` },
            { condition: call('alltrue', forList('a', ref(`var.${cn}_ipv4_addresses`), call('can', call('cidrhost', tmpl(ref('a'), '/32'), num(0))))), message: `${cn}_ipv4_addresses must hold IPv4 addresses.` },
          ] },
        { name: `${cn}_prefix_length`, type: 'number', description: `Prefix length of ${cn}.`, default: num(segment.prefixLength), codeName: cn,
          validations: [{ condition: op(op(ref(`var.${cn}_prefix_length`), '>=', num(8)), '&&', op(ref(`var.${cn}_prefix_length`), '<=', num(30))), message: `${cn}_prefix_length must be between 8 and 30.` }] },
        { name: `${cn}_gateway`, type: 'string', description: `Default gateway of ${cn}.`, default: str(segment.gateway), codeName: cn },
        { name: `${cn}_dns_servers`, type: 'list(string)', description: `DNS servers for ${cn}.`, default: list(segment.dnsServers.map(str)), codeName: cn },
      )
    }
  }

  const offsets = new Map<string, Expr | undefined>()
  for (const vm of vms) {
    const cn = vm.node.codeName
    const before = vms.slice(0, vms.indexOf(vm)).filter((other) => other.segment === vm.segment)
    const offset = before.length === 0 ? undefined : before.map((other) => ref(`var.${other.node.codeName}_vm_count`)).reduce((a, b) => op(a, '+', b))
    offsets.set(cn, offset)
    const seg = vm.segment.node.codeName
    const vmName = tmpl(ref('local.name_prefix'), `-${kebab(cn)}-`, op(ref('count.index'), '+', num(1)))
    const index = offset ? op(offset, '+', ref('count.index')) : ref('count.index')
    const nic = vm.segment.static
      ? obj([
          ['match', obj([['name', str('e*')]])],
          ['addresses', list([tmpl(call('element', ref(`var.${seg}_ipv4_addresses`), index), '/', ref(`var.${seg}_prefix_length`))])],
          ['routes', list([obj([['to', str('default')], ['via', ref(`var.${seg}_gateway`)]])])],
          ['nameservers', obj([['addresses', ref(`var.${seg}_dns_servers`)]])],
        ])
      : obj([['match', obj([['name', str('e*')]])], ['dhcp4', bool(true)]])
    const metadata = call('base64encode', call('yamlencode', obj([
      ['instance-id', vmName],
      ['local-hostname', vmName],
      ['network', obj([['version', num(2)], ['ethernets', obj([['nic0', nic]])]])],
    ])))
    const vmBlock = resource('vsphere_virtual_machine', label(cn), [
      attr('count', ref(`var.${cn}_vm_count`)),
      attr('name', vmName),
      attr('resource_pool_id', ref('data.vsphere_compute_cluster.this.resource_pool_id')),
      attr('datastore_id', ref('data.vsphere_datastore.this.id')),
      attr('folder', ref('var.vsphere_vm_folder')),
      attr('num_cpus', ref(`var.${cn}_vcpu`)),
      attr('memory', ref(`var.${cn}_memory_mib`)),
      attr('guest_id', template('guest_id')),
      attr('scsi_type', template('scsi_type')),
      attr('firmware', template('firmware')),
      block('network_interface', [], [attr('network_id', ref(`data.vsphere_network.${seg}.id`)), attr('adapter_type', template('network_interface_types[0]'))]),
      block('disk', [], [
        attr('label', str('os')),
        attr('size', call('max', ref(`var.${cn}_os_disk_gib`), template('disks[0].size'))),
        attr('thin_provisioned', ref(`var.${cn}_thin_provisioned`)),
      ]),
      block('clone', [], [attr('template_uuid', template('id'))]),
      attr('extra_config', obj([
        ['guestinfo.metadata.encoding', str('base64')],
        ['guestinfo.userdata', call('base64encode', ref('local.cloud_init_userdata'))],
        ['guestinfo.userdata.encoding', str('base64')],
        ['guestinfo.metadata', metadata],
      ])),
    ], { comments: vm.segment.static ? [`Fixed IPs from ${seg}_ipv4_addresses; cloud-init network-config v2 in guestinfo metadata.`] : ['DHCP: apply waits for an address, so the port group needs a DHCP server.'] })
    groups.push({ title: `${cn} (virtual_machine)`, codeName: cn, blocks: [vmBlock] })
    variables.push(
      { name: `${cn}_vm_count`, type: 'number', description: `Number of VMs for ${cn}.`, default: num(vm.count), codeName: cn,
        validations: [{ condition: op(op(ref(`var.${cn}_vm_count`), '>=', num(1)), '&&', op(ref(`var.${cn}_vm_count`), '<=', num(20))), message: `${cn}_vm_count must be between 1 and 20.` }] },
      { name: `${cn}_vcpu`, type: 'number', description: `vCPUs per VM of ${cn}.`, default: num(vm.vcpu), codeName: cn },
      { name: `${cn}_memory_mib`, type: 'number', description: `Memory (MiB) per VM of ${cn}.`, default: num(vm.memoryMiB), codeName: cn },
      { name: `${cn}_os_disk_gib`, type: 'number', description: `OS disk (GiB) of ${cn}; never smaller than the template disk.`, default: num(40), codeName: cn },
      { name: `${cn}_thin_provisioned`, type: 'bool', description: `Thin-provision the disks of ${cn} (explicit, REQ-IAC-019).`, default: bool(true), codeName: cn },
    )
    outputs.push(
      { name: `${cn}_names`, description: `VM names of ${cn}.`, value: ref(`vsphere_virtual_machine.${cn}[*].name`), codeName: cn },
      { name: `${cn}_ip_addresses`, description: `Guest IP addresses of ${cn} (seed for a later Ansible inventory).`, value: ref(`vsphere_virtual_machine.${cn}[*].default_ip_address`), codeName: cn },
    )
  }

  const ir: TerraformIr = {
    tool: 'terraform', groups, variables, outputs,
    locals: [
      attr('name_prefix', tmpl(ref('var.project_name'), '-', ref('var.environment'))),
      attr('cloud_init_userdata', call('format', str('#cloud-config\n%s'), call('yamlencode', obj([
        ['ssh_authorized_keys', { k: 'cond', test: op(ref('var.ssh_public_key'), '==', str('')), then: list([]), else: list([ref('var.ssh_public_key')]) }],
      ])))),
    ],
    providers: [block('provider', ['vsphere'], [
      attr('user', ref('var.vsphere_user')),
      attr('password', ref('var.vsphere_password')),
      attr('vsphere_server', ref('var.vsphere_server')),
      attr('allow_unverified_ssl', ref('var.vsphere_allow_unverified_ssl')),
    ])],
    pins: [VSPHERE_PROVIDER], requiredVersion: TERRAFORM_REQUIRED_VERSION,
    backend: block('backend', ['s3'], []),
    backendExample: [
      attr('bucket', str('REPLACE-with-state-bucket')),
      attr('key', str(`${ctx.doc.settings.codeName}/${ctx.doc.settings.environment}/terraform.tfstate`)),
      attr('region', str('us-east-1')),
      attr('endpoints', obj([['s3', str('https://s3.example.internal')]])),
      attr('use_path_style', bool(true)),
      attr('skip_credentials_validation', bool(true)),
      attr('skip_region_validation', bool(true)),
      attr('skip_requesting_account_id', bool(true)),
      attr('skip_metadata_api_check', bool(true)),
      attr('encrypt', bool(true)),
      attr('use_lockfile', bool(true)),
    ],
    lockFile: VSPHERE_LOCK_FILE,
    problems: [],
  }
  ir.problems.push(...terraformAddressProblems(ir))
  return ir
}

function vsphereManualSteps(ctx: TargetContext): ManualStep[] {
  return [{
    codeName: 'before_first_plan', role: 'setup', items: [
      `Create a least-privilege vCenter role for the Terraform account: clone from ${mdCode('vsphere_vm_template')}, create VMs in the folder, resource pool and datastore, and assign the port groups used here. Store its user and password as CI secrets (${mdCode('TF_VAR_vsphere_user')}, ${mdCode('TF_VAR_vsphere_password')}).`,
      `Provide an S3-compatible state store; copy ${mdCode('backend.hcl.example')} to ${mdCode('backend.hcl')} and fill it in. ${mdCode('use_lockfile')} needs conditional-write support in the store.`,
      'Run plan and apply from a self-hosted runner that can reach vCenter.',
    ],
  }]
}

function asTerraform(ir: ToolIr): TerraformIr {
  if (!isTerraformIr(ir)) throw new Error(`expected a terraform IR, got ${ir.tool}`)
  return ir
}

export const vsphereTerraformAdapter: IacAdapter = {
  id: VSPHERE_ADAPTER_ID,
  version: VSPHERE_ADAPTER_VERSION,
  tool: 'terraform',
  targetKinds: ['vsphere'],
  toolConstraint: TERRAFORM_REQUIRED_VERSION,
  providerPins: [{ source: VSPHERE_PROVIDER.source, constraint: VSPHERE_PROVIDER.constraint }],
  supportedFailureDomainLevels: ['host', 'site'],
  variableSchema: [
    { key: 'server', kind: 'text', label: { en: 'vCenter server', vi: 'Máy chủ vCenter' }, required: true },
    { key: 'datacenter', kind: 'text', label: { en: 'Datacenter', vi: 'Datacenter' }, required: true },
    { key: 'cluster', kind: 'text', label: { en: 'Compute cluster', vi: 'Cụm tính toán' }, required: true },
    { key: 'datastore', kind: 'text', label: { en: 'Datastore', vi: 'Datastore' }, required: true },
    { key: 'vmTemplate', kind: 'text', label: { en: 'VM template', vi: 'Mẫu máy ảo' }, required: true },
    { key: 'vmFolder', kind: 'text', label: { en: 'VM folder (existing)', vi: 'Thư mục máy ảo (có sẵn)' } },
    { key: 'edition', kind: 'enum', label: { en: 'Edition', vi: 'Phiên bản' }, values: ['standard', 'vvfVcf'], default: 'standard' },
    { key: 'allowUnverifiedSsl', kind: 'bool', label: { en: 'Allow unverified TLS', vi: 'Cho phép TLS chưa xác minh' }, default: false },
  ],
  emittedFiles: [...TERRAFORM_FILES, 'COVERAGE.md', 'MANUAL-STEPS.md', 'README.md', 'archpilot-manifest.json'].sort(),
  pipelineTemplates: [],
  validationCommands: TERRAFORM_VALIDATION_COMMANDS,
  goldenFixtures: ['vsphere-static-vm'],
  catalogue: VSPHERE_CATALOGUE,
  gate: vsphereGate,
  plan: vspherePlan,
  manualSteps: vsphereManualSteps,
  files: (ir) => terraformFiles(asTerraform(ir), fileHeader(VSPHERE_ADAPTER_ID, VSPHERE_ADAPTER_VERSION)),
  readme: (ir) => [
    '## How to run (spike)',
    '',
    '```sh',
    'export TF_VAR_vsphere_user=... TF_VAR_vsphere_password=...   # from CI secrets',
    'cp backend.hcl.example backend.hcl',
    'terraform init -backend-config=backend.hcl',
    'terraform validate',
    'terraform plan -out=tfplan',
    '```',
    '',
    `This is the ${VSPHERE_ADAPTER_ID} ${VSPHERE_ADAPTER_VERSION} spike: VMs are provisioned, software on them is not (see MANUAL-STEPS.md).`,
    `Provider ${mdCode(asTerraform(ir).pins[0].source)} ${mdCode(asTerraform(ir).pins[0].constraint)}.`,
  ],
}

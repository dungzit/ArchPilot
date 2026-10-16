/**
 * `vsphere` realisation catalogue for the `vsphere-terraform` 0.1.0 SPIKE
 * (design-v2 4.4.9, task 1.7). Only what the spike generates is
 * `generatable`: existing datacenter, cluster, datastore and port groups as
 * data sources, and `virtual_machine` cloned from a template with a fixed IP.
 * The generic `vmGroup` generator (service, databases, ... on VMs) is Phase V;
 * until then those roles are manual with a checklist.
 */
import type { Realisation, RealisationCatalogue } from '../../core/types'

const en = (text: string) => ({ en: text, vi: text })

const rows: Realisation[] = [
  { id: 'vsphere.datacenter', role: 'site', label: en('Existing datacenter'), badge: 'generatable', detail: 'reference',
    note: en('Referenced as data vsphere_datacenter (var.vsphere_datacenter).'), consumes: ['siteKind'] },
  { id: 'vsphere.compute_cluster', role: 'hypervisor_cluster', label: en('Existing compute cluster'), badge: 'generatable', detail: 'reference',
    note: en('Referenced as data vsphere_compute_cluster and vsphere_datastore; creating clusters is out of scope.'), consumes: ['hostCount', 'hostFailover', 'workloadBalancing'] },
  { id: 'vsphere.port_group_existing', role: 'network_segment', label: en('Existing port group'), badge: 'generatable', detail: 'reference',
    note: en('Referenced as data vsphere_network; VLAN and switch configuration are manual.'), consumes: ['cidr', 'ipMode', 'exposure'],
    manualSteps: [{ id: 'vlan', text: en('Make sure the port group of {codeName} exists and carries VLAN {vlanId}.') }] },
  { id: 'vsphere.vm', role: 'virtual_machine', label: en('VM cloned from a template'), badge: 'generatable',
    note: en('vsphere_virtual_machine cloned from the template; guest settings come from the template.'), consumes: ['osFamily', 'dataDiskGiB', 'replicas'] },
  { id: 'vsphere.zone_manual', role: 'zone', label: en('Room or rack (physical)'), badge: 'manual',
    note: en('Rooms and racks are physical; host placement uses DRS groups.'), consumes: [],
    manualSteps: [{ id: 'drs', text: en('Create DRS host groups so that VMs placed in {codeName} run on its hosts.') }] },
  { id: 'vsphere.cdn_none', role: 'cdn', label: en('No vSphere realisation'), badge: 'unsupported', note: en('A CDN has no on-prem realisation.'), consumes: [] },
]

const PHASE_V = ['service', 'relational_db', 'key_value_store', 'cache', 'queue', 'artifact_registry', 'container_platform', 'document_db', 'search_index', 'event_stream', 'pubsub_topic', 'monitoring']
const MANUAL = ['load_balancer', 'firewall', 'san', 'file_storage', 'block_storage', 'backup_target', 'bare_metal_host', 'identity_provider', 'secrets_vault',
  'key_management', 'siem_log_store', 'dns', 'api_gateway', 'object_storage', 'router', 'switch', 'vpn_link', 'waf', 'reverse_proxy', 'ddos_protection',
  'certificate_authority', 'function']

export const VSPHERE_CATALOGUE: RealisationCatalogue = {
  target: 'vsphere',
  version: '0.1.0',
  realisations: [
    ...rows,
    ...PHASE_V.map((role): Realisation => ({
      id: `vsphere.vm_group_${role}`, role, label: en(`${role} on VMs`), badge: 'manual',
      note: en('VM groups arrive with the Phase V generator; manual in the spike.'), consumes: [],
      manualSteps: [{ id: 'vms', text: en('Provision VMs for {codeName} and install its software; firewall requests are listed below.') }],
    })),
    ...MANUAL.map((role): Realisation => ({
      id: `vsphere.manual_${role}`, role, label: en(`${role} (manual)`), badge: 'manual',
      note: en('Configured by the infrastructure team; see MANUAL-STEPS.md.'), consumes: [],
    })),
  ],
  aliases: [],
  accessPairs: [],
  unmappedAccess: 'manual',
}

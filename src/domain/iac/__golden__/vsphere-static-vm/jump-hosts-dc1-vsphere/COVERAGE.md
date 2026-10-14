# Coverage: `jump_hosts` on `dc1_vsphere` (`vsphere`)

Adapter `vsphere-terraform` 0.1.0, generator 0.1.0.
Every node and every edge of the design is listed exactly once.

## Totals

| Generatable | Manual | Unsupported | Annotation | Other target |
|---|---|---|---|---|
| 5 | 2 | 0 | 0 | 0 |

## Nodes

| Code name | Role | Badge | Detail | Realisation | Note | Reason |
|---|---|---|---|---|---|---|
| `dc1` | `site` | generatable | reference | `vsphere.datacenter` (default) | Referenced as data vsphere\_datacenter (var.vsphere\_datacenter). |  |
| `app_vlan` | `network_segment` | generatable | reference | `vsphere.port_group_existing` | Referenced as data vsphere\_network; VLAN and switch configuration are manual. |  |
| `prod_cluster` | `hypervisor_cluster` | generatable | reference | `vsphere.compute_cluster` (default) | Referenced as data vsphere\_compute\_cluster and vsphere\_datastore; creating clusters is out of scope. |  |
| `bastion` | `virtual_machine` | generatable |  | `vsphere.vm` (default) | vsphere\_virtual\_machine cloned from the template; guest settings come from the template. |  |
| `tools` | `virtual_machine` | generatable |  | `vsphere.vm` (default) | vsphere\_virtual\_machine cloned from the template; guest settings come from the template. |  |
| `tools_db` | `relational_db` | manual |  | `vsphere.vm_group_relational_db` (default) | VM groups arrive with the Phase V generator; manual in the spike. |  |
| `dc_firewall` | `firewall` | manual |  | `vsphere.manual_firewall` (default) | Configured by the infrastructure team; see MANUAL-STEPS.md. |  |

## Edges

| Edge | From | To | Kind | Mode | Class | Note |
|---|---|---|---|---|---|---|
| `e1` | `tools` | `tools_db` | access | read_write | manual | An endpoint is not generated; see MANUAL-STEPS.md. |
| `e2` | `bastion` | `tools` | access | connect | manual | Firewall request: see MANUAL-STEPS.md. |

## Attributes not expressed

| Code name | Key | Value | Note |
|---|---|---|---|
| `dc1` | `location` | Ha Noi | Not expressed by vsphere.datacenter. |
| `app_vlan` | `vlanId` | 102 | Not expressed by vsphere.port\_group\_existing. |
| `tools_db` | `engine` | postgresql | Not expressed by vsphere.vm\_group\_relational\_db. |
| `tools_db` | `replicas` | 2 | Not expressed by vsphere.vm\_group\_relational\_db. |

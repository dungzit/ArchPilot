# Manual steps: `jump_hosts` on `dc1_vsphere` (`vsphere`)

ArchPilot generated no code for the items below. Each one is still part of the design.

## `tools_db` (`relational_db`)

- Target: `vsphere`
- Realisation: `vsphere.vm_group_relational_db`

- [ ] Provision VMs for `tools_db` and install its software; firewall requests are listed below.

## `dc_firewall` (`firewall`)

- Target: `vsphere`
- Realisation: `vsphere.manual_firewall`

- [ ] Provision `dc_firewall` (`firewall`) by hand; this adapter version generates no code for it.

## `connectivity` (`edges`)

- Target: `vsphere`
- Realisation: none

- [ ] Edge `e1`: `tools` -> `tools_db` (read_write). An endpoint is not generated; see MANUAL-STEPS.md.
- [ ] Edge `e2`: `bastion` -> `tools` (connect). Firewall request: see MANUAL-STEPS.md.

## `before_first_plan` (`setup`)

- Target: `vsphere`
- Realisation: none

- [ ] Create a least-privilege vCenter role for the Terraform account: clone from `vsphere_vm_template`, create VMs in the folder, resource pool and datastore, and assign the port groups used here. Store its user and password as CI secrets (`TF_VAR_vsphere_user`, `TF_VAR_vsphere_password`).
- [ ] Provide an S3-compatible state store; copy `backend.hcl.example` to `backend.hcl` and fill it in. `use_lockfile` needs conditional-write support in the store.
- [ ] Run plan and apply from a self-hosted runner that can reach vCenter.

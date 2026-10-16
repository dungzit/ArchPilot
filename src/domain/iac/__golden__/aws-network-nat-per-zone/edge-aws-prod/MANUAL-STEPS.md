# Manual steps: `edge` on `aws_prod` (`aws`)

ArchPilot generated no code for the items below. Each one is still part of the design.

## `before_first_plan` (`setup`)

- Target: `aws`
- Realisation: none

- [ ] Create the Terraform state bucket (versioning and encryption on, public access blocked) in `ap-southeast-1`, then copy `backend.hcl.example` to `backend.hcl` and fill it in.

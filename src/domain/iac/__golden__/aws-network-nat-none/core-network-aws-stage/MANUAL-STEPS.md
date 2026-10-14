# Manual steps: `core_network` on `aws_stage` (`aws`)

ArchPilot generated no code for the items below. Each one is still part of the design.

## `public_zone` (`dns`)

- Target: `aws`
- Realisation: `aws.route53`

- [ ] Create or delegate the Route 53 hosted zone example.org and records for `public_zone`.

## `before_first_plan` (`setup`)

- Target: `aws`
- Realisation: none

- [ ] Create the Terraform state bucket (versioning and encryption on, public access blocked) in `eu-west-1`, then copy `backend.hcl.example` to `backend.hcl` and fill it in.

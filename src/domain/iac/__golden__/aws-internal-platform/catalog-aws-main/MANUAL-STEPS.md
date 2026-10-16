# Manual steps: `catalog` on `aws_main` (`aws`)

ArchPilot generated no code for the items below. Each one is still part of the design.

## `legacy_search` (`bare_metal_host`)

- Target: `aws`
- Realisation: `aws.none_bare_metal_host`

- [ ] `legacy_search` has no `aws` realisation. Provide it outside this package, or move it to another target.

## `connectivity` (`edges`)

- Target: `aws`
- Realisation: none

- [ ] Edge `e5`: `indexer` -> `legacy_search` (connect). An endpoint is not generated; see MANUAL-STEPS.md.

## `before_first_plan` (`setup`)

- Target: `aws`
- Realisation: none

- [ ] Create the Terraform state bucket (versioning and encryption on, public access blocked) in `us-east-2`, then copy `backend.hcl.example` to `backend.hcl` and fill it in.
- [ ] Build and push the image of `catalog_api`, then set `catalog_api_image` in `terraform.tfvars`.
- [ ] Build and push the image of `indexer`, then set `indexer_image` in `terraform.tfvars`.

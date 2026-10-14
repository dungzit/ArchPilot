# Manual steps: `hostile` on `aws_dev` (`aws`)

ArchPilot generated no code for the items below. Each one is still part of the design.

## `names` (`dns`)

- Target: `aws`
- Realisation: `aws.route53`
- Linked decision: ADR-1 \| table \| break \`code\` $\{var.x\} \<b\>bold\</b\> \# not a heading (proposed)

- [ ] Create or delegate the Route 53 hosted zone \`rm -rf /\` \| \<script\>alert(1)\</script\> $\{x\} \# heading and records for `names`.

## `before_first_plan` (`setup`)

- Target: `aws`
- Realisation: none

- [ ] Create the Terraform state bucket (versioning and encryption on, public access blocked) in `ap-southeast-1`, then copy `backend.hcl.example` to `backend.hcl` and fill it in.
- [ ] Build and push the image of `web`, then set `web_image` in `terraform.tfvars`.
- [ ] Request or import an ACM certificate in `ap-southeast-1` for `lb` and set `lb_certificate_arn` in `terraform.tfvars`.

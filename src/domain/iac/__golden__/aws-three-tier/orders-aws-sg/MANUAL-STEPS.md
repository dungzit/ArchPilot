# Manual steps: `orders` on `aws_sg` (`aws`)

ArchPilot generated no code for the items below. Each one is still part of the design.

## `mail_queue` (`queue`)

- Target: `aws`
- Realisation: `aws.sqs`
- Linked decision: ADR-1 Send mail asynchronously (accepted)

- [ ] Create an SQS queue for `mail_queue` with SSE and a dead-letter queue. Mapping arrives in aws-terraform 1.0.0.

## `connectivity` (`edges`)

- Target: `aws`
- Realisation: none

- [ ] Edge `e5`: `orders_api` -> `mail_queue` (send). An endpoint is not generated; see MANUAL-STEPS.md.

## `before_first_plan` (`setup`)

- Target: `aws`
- Realisation: none

- [ ] Create the Terraform state bucket (versioning and encryption on, public access blocked) in `ap-southeast-1`, then copy `backend.hcl.example` to `backend.hcl` and fill it in.
- [ ] Build and push the image of `orders_api`, then set `orders_api_image` in `terraform.tfvars`.
- [ ] Request or import an ACM certificate in `ap-southeast-1` for `web_lb` and set `web_lb_certificate_arn` in `terraform.tfvars`.
- [ ] Set `payments_base_url` in `terraform.tfvars`.

# Coverage: `orders` on `aws_sg` (`aws`)

Adapter `aws-terraform` 0.1.0, generator 0.1.0.
Every node and every edge of the design is listed exactly once.

## Totals

| Generatable | Manual | Unsupported | Annotation | Other target |
|---|---|---|---|---|
| 10 | 1 | 0 | 3 | 0 |

## Nodes

| Code name | Role | Badge | Detail | Realisation | Note | Reason |
|---|---|---|---|---|---|---|
| `customers` | `client` | annotation |  |  | No code (annotation). |  |
| `payments` | `external_service` | annotation |  |  | No code; a service that uses it gets a URL variable. |  |
| `pii_note` | `note` | annotation |  |  | No code (annotation). |  |
| `sg_region` | `site` | generatable | implicit | `aws.region` (default) | The target region (var.aws\_region); no resource of its own. |  |
| `zone_a` | `zone` | generatable | implicit | `aws.az` (default) | Maps to an availability zone of the region, in code-name order. |  |
| `zone_b` | `zone` | generatable | implicit | `aws.az` (default) | Maps to an availability zone of the region, in code-name order. |  |
| `main` | `network_segment` | generatable |  | `aws.vpc` (default) | aws\_vpc with DNS support; an internet gateway when a public segment exists. |  |
| `app` | `network_segment` | generatable |  | `aws.subnets` (default) | One subnet per zone (stretched) or one (zone-local), route table, NAT per the target option. |  |
| `orders_api` | `service` | generatable |  | `aws.ecs_fargate` (default) | Task definition, ECS service (no public IP), log group, execution role, security group. |  |
| `mail_queue` | `queue` | manual |  | `aws.sqs` (default) | Manual on aws in this adapter version; see MANUAL-STEPS.md. |  |
| `data` | `network_segment` | generatable |  | `aws.subnets` (default) | One subnet per zone (stretched) or one (zone-local), route table, NAT per the target option. |  |
| `orders_db` | `relational_db` | generatable |  | `aws.rds` | aws\_db\_instance: managed master secret, encrypted, private, deletion protection, final snapshot. |  |
| `public_web` | `network_segment` | generatable |  | `aws.subnets` (default) | One subnet per zone (stretched) or one (zone-local), route table, NAT per the target option. |  |
| `web_lb` | `load_balancer` | generatable |  | `aws.alb` (default) | aws\_lb (application), target group, listeners; HTTPS with a TLS 1.3 policy when protocol is https. |  |

## Edges

| Edge | From | To | Kind | Mode | Class | Note |
|---|---|---|---|---|---|---|
| `e1` | `customers` | `web_lb` | access | connect | generatable | Load balancer security group allows the listener port(s) from the internet. |
| `e2` | `web_lb` | `orders_api` | access | connect | generatable | Target group; load balancer to service security-group rules on the service port. |
| `e3` | `orders_api` | `orders_db` | access | read_write | generatable | Service to database security-group rules; host, port, name and secret ARN in the task. |
| `e4` | `orders_api` | `payments` | access | connect | generatable | Base URL variable passed to the service. |
| `e5` | `orders_api` | `mail_queue` | access | send | manual | An endpoint is not generated; see MANUAL-STEPS.md. |
| `e6` | `pii_note` | `orders_db` | flow |  | no code | Flow edge (visual only). |

## Attributes not expressed

| Code name | Key | Value | Note |
|---|---|---|---|
| `orders_api` | `runtime` | java21 | Not expressed by aws.ecs\_fargate. |
| `data` | `vlanId` | 30 | Not expressed by aws.subnets. |

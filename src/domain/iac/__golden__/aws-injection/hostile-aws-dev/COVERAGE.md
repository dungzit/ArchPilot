# Coverage: `hostile` on `aws_dev` (`aws`)

Adapter `aws-terraform` 0.1.0, generator 0.1.0.
Every node and every edge of the design is listed exactly once.

## Totals

| Generatable | Manual | Unsupported | Annotation | Other target |
|---|---|---|---|---|
| 5 | 1 | 0 | 2 | 0 |

## Nodes

| Code name | Role | Badge | Detail | Realisation | Note | Reason |
|---|---|---|---|---|---|---|
| `users` | `client` | annotation |  |  | No code (annotation). |  |
| `note_1` | `note` | annotation |  |  | No code (annotation). |  |
| `names` | `dns` | manual |  | `aws.route53` (default) | Manual on aws in this adapter version; see MANUAL-STEPS.md. |  |
| `net` | `network_segment` | generatable |  | `aws.vpc` (default) | aws\_vpc with DNS support; an internet gateway when a public segment exists. |  |
| `back` | `network_segment` | generatable |  | `aws.subnets` (default) | One subnet per zone (stretched) or one (zone-local), route table, NAT per the target option. |  |
| `web` | `service` | generatable |  | `aws.ecs_fargate` (default) | Task definition, ECS service (no public IP), log group, execution role, security group. |  |
| `front` | `network_segment` | generatable |  | `aws.subnets` (default) | One subnet per zone (stretched) or one (zone-local), route table, NAT per the target option. |  |
| `lb` | `load_balancer` | generatable |  | `aws.alb` (default) | aws\_lb (application), target group, listeners; HTTPS with a TLS 1.3 policy when protocol is https. |  |

## Edges

| Edge | From | To | Kind | Mode | Class | Note |
|---|---|---|---|---|---|---|
| `e1` | `users` | `lb` | access | connect | generatable | Load balancer security group allows the listener port(s) from the internet. |
| `e2` | `lb` | `web` | access | connect | generatable | Target group; load balancer to service security-group rules on the service port. |

## Attributes not expressed

| Code name | Key | Value | Note |
|---|---|---|---|
| `names` | `zoneName` | \`rm -rf /\` \| \<script\>alert(1)\</script\> $\{x\} \# heading | Not expressed by aws.route53. |

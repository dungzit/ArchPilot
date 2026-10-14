# Coverage: `catalog` on `aws_main` (`aws`)

Adapter `aws-terraform` 0.1.0, generator 0.1.0.
Every node and every edge of the design is listed exactly once.

## Totals

| Generatable | Manual | Unsupported | Annotation | Other target |
|---|---|---|---|---|
| 10 | 0 | 1 | 0 | 0 |

## Nodes

| Code name | Role | Badge | Detail | Realisation | Note | Reason |
|---|---|---|---|---|---|---|
| `region` | `site` | generatable | implicit | `aws.region` (default) | The target region (var.aws\_region); no resource of its own. |  |
| `platform_net` | `network_segment` | generatable |  | `aws.vpc` (default) | aws\_vpc with DNS support; an internet gateway when a public segment exists. |  |
| `apps` | `network_segment` | generatable |  | `aws.subnets` (default) | One subnet per zone (stretched) or one (zone-local), route table, NAT per the target option. |  |
| `internal_lb` | `load_balancer` | generatable |  | `aws.alb` (default) | aws\_lb (application), target group, listeners; HTTPS with a TLS 1.3 policy when protocol is https. |  |
| `apps_cluster` | `container_platform` | generatable |  | `aws.ecs_cluster` (default) | aws\_ecs\_cluster with Container Insights; services inside it run on it. |  |
| `catalog_api` | `service` | generatable |  | `aws.ecs_fargate` (default) | Task definition, ECS service (no public IP), log group, execution role, security group. |  |
| `indexer` | `service` | generatable |  | `aws.ecs_fargate` (default) | Task definition, ECS service (no public IP), log group, execution role, security group. |  |
| `db` | `network_segment` | generatable |  | `aws.subnets` (default) | One subnet per zone (stretched) or one (zone-local), route table, NAT per the target option. |  |
| `catalog_db` | `relational_db` | generatable |  | `aws.rds` (default) | aws\_db\_instance: managed master secret, encrypted, private, deletion protection, final snapshot. |  |
| `ingress` | `network_segment` | generatable |  | `aws.subnets` (default) | One subnet per zone (stretched) or one (zone-local), route table, NAT per the target option. |  |
| `legacy_search` | `bare_metal_host` | unsupported |  | `aws.none_bare_metal_host` (default) | Physical or on-prem component: no AWS realisation. |  |

## Edges

| Edge | From | To | Kind | Mode | Class | Note |
|---|---|---|---|---|---|---|
| `e1` | `internal_lb` | `catalog_api` | access | connect | generatable | Target group; load balancer to service security-group rules on the service port. |
| `e2` | `indexer` | `internal_lb` | access | connect | generatable | Service to internal load balancer security-group rules; URL environment variable. |
| `e3` | `catalog_api` | `catalog_db` | access | read | generatable | Service to database security-group rules; host, port, name and secret ARN in the task. |
| `e4` | `indexer` | `catalog_db` | access | write | generatable | Service to database security-group rules; host, port, name and secret ARN in the task. |
| `e5` | `indexer` | `legacy_search` | access | connect | manual | An endpoint is not generated; see MANUAL-STEPS.md. |

## Attributes not expressed

| Code name | Key | Value | Note |
|---|---|---|---|
| `legacy_search` | `memoryGiB` | 256 | Not expressed by aws.none\_bare\_metal\_host. |

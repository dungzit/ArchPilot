# Coverage: `edge` on `aws_prod` (`aws`)

Adapter `aws-terraform` 0.1.0, generator 0.1.0.
Every node and every edge of the design is listed exactly once.

## Totals

| Generatable | Manual | Unsupported | Annotation | Other target |
|---|---|---|---|---|
| 8 | 0 | 0 | 0 | 0 |

## Nodes

| Code name | Role | Badge | Detail | Realisation | Note | Reason |
|---|---|---|---|---|---|---|
| `edge_net` | `network_segment` | generatable |  | `aws.vpc` (default) | aws\_vpc with DNS support; an internet gateway when a public segment exists. |  |
| `zone_a` | `zone` | generatable | implicit | `aws.az` (default) | Maps to an availability zone of the region, in code-name order. |  |
| `zone_b` | `zone` | generatable | implicit | `aws.az` (default) | Maps to an availability zone of the region, in code-name order. |  |
| `zone_c` | `zone` | generatable | implicit | `aws.az` (default) | Maps to an availability zone of the region, in code-name order. |  |
| `batch_c` | `network_segment` | generatable |  | `aws.subnets` (default) | One subnet per zone (stretched) or one (zone-local), route table, NAT per the target option. |  |
| `apps` | `network_segment` | generatable |  | `aws.subnets` (default) | One subnet per zone (stretched) or one (zone-local), route table, NAT per the target option. |  |
| `data` | `network_segment` | generatable |  | `aws.subnets` (default) | One subnet per zone (stretched) or one (zone-local), route table, NAT per the target option. |  |
| `dmz` | `network_segment` | generatable |  | `aws.subnets` (default) | One subnet per zone (stretched) or one (zone-local), route table, NAT per the target option. |  |

## Edges

None.

## Attributes not expressed

None.

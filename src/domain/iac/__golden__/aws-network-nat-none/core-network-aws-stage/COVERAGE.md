# Coverage: `core_network` on `aws_stage` (`aws`)

Adapter `aws-terraform` 0.1.0, generator 0.1.0.
Every node and every edge of the design is listed exactly once.

## Totals

| Generatable | Manual | Unsupported | Annotation | Other target |
|---|---|---|---|---|
| 7 | 1 | 0 | 0 | 0 |

## Nodes

| Code name | Role | Badge | Detail | Realisation | Note | Reason |
|---|---|---|---|---|---|---|
| `public_zone` | `dns` | manual |  | `aws.route53` (default) | Manual on aws in this adapter version; see MANUAL-STEPS.md. |  |
| `region` | `site` | generatable | implicit | `aws.region` (default) | The target region (var.aws\_region); no resource of its own. |  |
| `core` | `network_segment` | generatable |  | `aws.vpc` (default) | aws\_vpc with DNS support; an internet gateway when a public segment exists. |  |
| `zone_a` | `zone` | generatable | implicit | `aws.az` (default) | Maps to an availability zone of the region, in code-name order. |  |
| `private_a` | `network_segment` | generatable |  | `aws.subnets` (default) | One subnet per zone (stretched) or one (zone-local), route table, NAT per the target option. |  |
| `zone_b` | `zone` | generatable | implicit | `aws.az` (default) | Maps to an availability zone of the region, in code-name order. |  |
| `isolated_b` | `network_segment` | generatable |  | `aws.subnets` (default) | One subnet per zone (stretched) or one (zone-local), route table, NAT per the target option. |  |
| `public` | `network_segment` | generatable |  | `aws.subnets` (default) | One subnet per zone (stretched) or one (zone-local), route table, NAT per the target option. |  |

## Edges

None.

## Attributes not expressed

| Code name | Key | Value | Note |
|---|---|---|---|
| `public_zone` | `zoneName` | example.org | Not expressed by aws.route53. |
| `region` | `location` | Singapore | Not expressed by aws.region. |

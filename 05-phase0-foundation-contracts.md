# ArchPilot — Phase 0 Foundation Contracts

| Field | Value |
|---|---|
| Product | ArchPilot |
| Version | 0.1 |
| Status | Foundation baseline |
| Date | 2026-09-19 |

## 1. Product vision

ArchPilot helps an individual system architect turn requirements and evidence into reviewable architecture, deployment, sizing, knowledge, and investment decisions across cloud, on-premises, Kubernetes, bare metal, and hybrid environments.

The product loop is:

```text
Understand -> Design -> Size -> Review -> Explain -> Export -> Learn
```

AWS, VMware, Kubernetes, and other targets are adapters. They are not the domain boundary.

## 2. Common entity envelope

Every persisted business object uses this metadata:

```yaml
id: uuid
entity_type: string
schema_version: "1.0"
project_id: uuid
revision: 1
status: draft
owner_id: uuid
created_at: datetime
updated_at: datetime
provenance:
  source_ids: [uuid]
  confidence: measured | declared | estimated | unverified
  recorded_at: datetime
  freshness: current | stale | unknown
```

Material self-review records point to an immutable revision. A change to a linked requirement, input, formula, evidence item, or option marks the previous reviewed revision `stale`.

## 3. Domain model

```text
Workspace
  -> Project
    -> System
      -> Environment
      -> Requirement / NFR / Assumption / Constraint
      -> Component / Connection / DeploymentTarget
      -> ArchitectureOption
        -> Decision / Review / SelfReview
      -> SizingScenario / SizingResult
      -> KnowledgeArticle / Evidence
      -> InvestmentCase / CostItem / BenefitItem / CalculationRun
```

Core entities:

- `Workspace`: local architect workspace and settings.
- `Project`: scope, owner, status, and review dates.
- `System`: system profile and business context.
- `Requirement`: functional requirement, NFR, constraint, or assumption.
- `Component`: logical or physical architecture node.
- `Connection`: dependency, data flow, or network flow.
- `DeploymentTarget`: AWS, Azure, GCP, VMware, Kubernetes, on-premises, bare metal, or hybrid.
- `ArchitectureOption`: candidate design with mappings, assumptions, and risks.
- `Decision`: ADR and selected option.
- `Review`: checklist execution and comments.
- `SelfReview`: architect-owned checklist and decision record tied to a revision.
- `SizingScenario`: workload inputs and formula version.
- `KnowledgeArticle`: internal or public best-practice record.
- `Evidence`: source file, URL, test output, quotation, or operational record.
- `InvestmentCase`: baseline, candidate, costs, benefits, scenarios, and financial result.
- `AuditEvent`: append-only record of material actions.

## 4. Requirement format

```yaml
id: REQ-001
type: functional | nfr | constraint | assumption
title: "API peak throughput"
statement: "The system must process at least 500 requests per second."
priority: must | should | could | wont
status: proposed | accepted | rejected | superseded
category: performance
target:
  metric: throughput
  operator: ">="
  value: 500
  unit: requests_per_second
acceptance_criteria:
  - "P95 latency <= 300 ms at 500 RPS."
source_ids: [EVD-001]
confidence: measured | declared | estimated | unverified
review_due: 2026-10-01
```

Rules:

- Human-readable `statement` and machine-checkable `target` are separate.
- Important NFRs require acceptance criteria.
- `unknown` is not represented as zero.
- Superseded requirements remain in history.

## 5. Architecture document template

1. Metadata: ID, version, status, owner, reviewers, review date.
2. Context: problem, objective, scope, exclusions, assumptions, constraints.
3. Requirements: ID, type, priority, evidence.
4. Current state: components, dependencies, target, known issues.
5. Options: summary, components, deployment, coverage, sizing, cost, risks, trade-offs.
6. Evaluation: criteria, weights, scores, evidence.
7. Decision: selected option, rationale, rejected alternatives, exceptions, actions.
8. Review and decision closure: checklist, comments, self-review record, revision.
9. Provenance: sources, formula versions, input hash, confidence.

The database is the source of truth; Markdown/Mermaid are exports.

## 6. Decision workflow

```text
draft -> proposed -> under_review -> reviewed
                         |              |
                         v              v
                 changes_requested   stale/superseded
                         |
                         v
                       draft
```

A decision may be `rejected` from review. Every transition creates an immutable event containing actor, old status, new status, revision, reason, and timestamp.

Self-review requirements:

- Owner, context, linked requirements, at least one option, evidence, and completed mandatory checklist.
- A reviewed revision cannot be edited in place.
- A changed dependency makes the previous reviewed revision stale.

## 7. Sizing formula format

```yaml
formula_id: sizing.api.instance_count
version: "1.0"
domain: api
inputs:
  - name: peak_rps
    unit: requests_per_second
    required: true
  - name: capacity_per_instance
    unit: requests_per_second
    required: true
  - name: headroom
    unit: ratio
    required: true
expression: "ceil(peak_rps / capacity_per_instance * (1 + headroom))"
output:
  name: instance_count
  unit: instance
classification: estimated
assumptions:
  - "capacity_per_instance comes from benchmark fixture PERF-001"
test_vectors:
  - inputs: { peak_rps: 500, capacity_per_instance: 100, headroom: 0.3 }
    expected: 7
```

Supported initial domains: API, database, Kubernetes, storage, network, and firewall. Each result includes input snapshot, formula version, range, classification, confidence, warnings, and source IDs.

## 8. Knowledge article format

```yaml
id: KB-001
title: "Active-passive disaster recovery"
kind: pattern | anti_pattern | technology | sizing_rule | control | incident_lesson
scope: public | personal | project
status: draft | reviewed | deprecated
summary: "Use one-way replication when cross-site writes cannot be reconciled."
problem: "What problem does this address?"
use_when: []
avoid_when: []
preconditions: []
trade_offs: []
failure_modes: []
implementation_notes: []
applicability:
  targets: [aws, vmware, kubernetes, on_premises, hybrid]
  domains: [availability, database, network]
sources:
  - title: "Source title"
    url: "https://example.com"
    retrieved_at: 2026-09-19
owner_id: user-001
review_due: 2027-03-19
```

Public best practices require citation, retrieval date, license/usage note where relevant, applicability, owner, and review date. Uncited content cannot be promoted to `reviewed`.

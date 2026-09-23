# ArchPilot — Next Implementation Plan

| Field | Value |
|---|---|
| Product | ArchPilot |
| Version | 0.1 |
| Status | Planning baseline |
| Date | 2026-09-19 |
| Next release | Vertical Slice 01 |

## 1. Planning decision

The current frontend prototype proves the product direction and user interface. It does not yet prove domain correctness, persistence, sizing formulas, financial calculations, provenance, or integrations.

The next release will therefore build one complete decision loop before expanding integrations or provider adapters:

```text
One system
  -> requirements and NFR
    -> two architecture options
      -> ADR and review
        -> purchase data
          -> deterministic TCO/ROI
            -> provenance and self-review
              -> architecture + business case report
```

The product remains cloud-neutral. The first analyzed system may use an AWS reference target, but the domain model must also represent VMware, Kubernetes, on-premises, bare metal, and hybrid targets.

## 2. Vertical Slice 01 scope

### In scope

- One individual architect workspace.
- One project and one pilot system.
- Form UI plus versioned CSV/XLSX template import.
- Requirements, NFRs, assumptions, and constraints.
- Cloud-neutral components, dependencies, deployment target, and Mermaid export.
- Two architecture options and weighted criteria.
- ADR, evidence, self-review, and immutable revision metadata.
- Purchase history import with row-level validation and partial success.
- TCO for 3-year and 5-year horizons.
- Conservative, expected, and optimistic scenarios.
- ROI, payback, NPV when inputs support it, and sensitivity analysis.
- Provenance manifest and Markdown/CSV export.
- Seed data and repeatable local execution.

### Explicitly deferred

- Production provisioning or automatic apply.
- Two-way GitLab synchronization and webhooks.
- Confluence synchronization; only a report/link contract is prepared.
- Multi-target Terraform/Ansible generation.
- Cloud billing discovery and automatic price refresh.
- Prometheus/Grafana/ITSM integration.
- Autonomous AI recommendations.
- Multi-tenant enterprise RBAC and SSO.
- Automatic drift detection and runtime discovery.

## 3. Phase 0 — Discovery and contracts

**Duration:** 1-2 weeks

| Work item | Output | Owner |
|---|---|---|
| Choose pilot system and real decision | Named pilot, decision, and outcome owner | Architect |
| Confirm system profile | Required fields and lifecycle states | Architect |
| Version Excel template | Workbook contract with sheets, columns, types, and examples | Architect |
| Define sizing contracts | Units, formulas, ranges, headroom, and confidence | Architect |
| Define financial contract | Currency, horizon, labor, risk, inflation, discount rate | Architect + Finance |
| Define terminology | Vietnamese/English glossary and translation keys | Architect |
| Define evidence policy | Source, owner, timestamp, freshness, confidence | Architect |
| Prepare sample data | Architecture, purchase, cost, and benefit fixtures | Architect |

### Gate G0

Proceed only when:

- The pilot system and decision are real.
- The workbook has been validated by its data owner.
- At least one workload baseline and purchase sample exist.
- Currency, horizon, and TCO categories are agreed.
- Required formulas have a reference spreadsheet or independently calculated expected result.

## 4. Phase 1 — Domain and persistence foundation

**Duration:** 3-4 weeks

Build the backend foundation as a modular monolith. Use PostgreSQL for persisted records and an S3-compatible object store for original files and reports.

### Initial modules

- `workspace`: project, system, owner, environment.
- `requirements`: requirement, NFR, assumption, constraint.
- `architecture`: component, dependency, deployment target, option.
- `decision`: ADR, criteria, score, review, self-review.
- `procurement`: import job, original file, purchase record, validation error.
- `value`: cost item, benefit item, scenario, calculation run.
- `evidence`: source, artifact, confidence, freshness, provenance.
- `audit`: immutable business events.
- `reporting`: architecture pack and business case export.

### Persistence rules

Every material record has:

- Stable identifier.
- Owner and status.
- Created/updated timestamp.
- Revision number.
- Source/provenance where applicable.
- Audit events for material changes.

A self-review points to an immutable revision. If a requirement, input, formula, evidence item, or option changes, the previous reviewed revision becomes `stale` and requires self-review again.

## 5. Phase 2 — Deterministic calculation engine

**Duration:** 2-3 weeks

The calculation engine is a pure domain module. It must not depend on UI state or external live pricing.

### Formula contract

```text
TCO = purchase
    + implementation
    + migration
    + license
    + support
    + infrastructure
    + operations_staff
    + training
    + security
    + backup
    + upgrade
    + expected_downtime_cost
    - residual_value

ROI = (total_benefits - total_investment) / total_investment

PaybackMonths = initial_investment / monthly_net_benefit

NPV = -initial_investment + sum(net_benefit_t / (1 + discount_rate)^t)
```

Each calculation run stores:

- Formula version.
- Input snapshot and hash.
- Scenario.
- Currency.
- Period and horizon.
- Assumption list.
- Confidence per input.
- Calculation timestamp.
- Output values.

### Required test vectors

- Zero investment.
- Zero benefit.
- Negative or invalid cost rejected.
- Missing support period marked unknown, never silently zero.
- Positive and negative ROI.
- Different horizons.
- Discount rate zero and non-zero.
- Currency normalization metadata.
- Sensitivity at low, expected, and high data growth.

## 6. Phase 3 — Excel/CSV import and report output

**Duration:** 2-3 weeks

### Workbook version 1

Sheets:

- `System`
- `Requirements`
- `Components`
- `Connections`
- `Sizing`
- `Cost Inputs`
- `Evidence`

The importer must:

- Store the original file immutably.
- Validate sheet, row, column, type, unit, and currency.
- Return valid rows and row-level errors separately.
- Preserve original and normalized values.
- Flag duplicates and unknown references.
- Reject formulas/macros from execution.
- Apply upload size and file-type limits.
- Sanitize exported CSV cells that begin with formula characters.

Reports must include:

- Calculation ID.
- Input snapshot hash.
- Formula version.
- Deployment target.
- Assumptions.
- Source manifest.
- Confidence and freshness.
- Self-review revision and decision history.

## 7. Phase 4 — Sizing scenario calculator

**Duration:** 3-4 weeks

The initial sizing engine supports scenarios, not authoritative infrastructure recommendations.

| Domain | Minimum inputs | Output |
|---|---|---|
| API | RPS, peak factor, payload, latency, headroom | Instance/pod count and resource range |
| Database | Read/write rate, storage, retention, IOPS, HA | Node/resource range and storage |
| Kubernetes | Services, replicas, requests/limits, AZ/site | Worker and control-plane range |
| Storage | Ingress, retention, replication, backup | Raw, usable, and backup capacity |
| Network | North-south/east-west traffic, redundancy | Throughput and link range |
| Firewall | Source, destination, zone, port, protocol | Rule matrix and warnings |

Every output is labelled `declared`, `estimated`, `measured`, or `unverified`; it is not labelled `ready` without benchmark or verified evidence.

## 8. Phase 5 — Architecture decision and review

**Duration:** 2-3 weeks

Complete the vertical loop:

1. Create two options.
2. Score weighted criteria.
3. Link requirements and NFRs.
4. Record trade-offs and rejected alternatives.
5. Attach evidence and assumptions.
6. Run review checklist.
7. Request changes or mark the revision reviewed.
8. Mark older revisions stale when inputs change.
9. Export architecture and business case reports.

## 9. Phase 6 — Adapter readiness, after G1

Only after the vertical slice passes G1 should an adapter be implemented.

### First adapter

Use AWS as a reference adapter for the pilot only:

- Intent-to-capability mapping.
- Deterministic Terraform draft generation.
- No embedded secrets.
- Version-pinned modules/providers.
- `terraform fmt`, `validate`, and test plan.
- Generated output is a reviewable artifact or pull request.
- No direct production apply.

### Second target

Represent Kubernetes or on-premises as a second target. At first, it may generate a checklist and deployment mapping rather than complete provider-specific IaC. This proves that the domain model is genuinely target-neutral.

### Integration sequence

1. GitLab outbound branch/merge request in a test repository.
2. Confluence one-way publish to a test space.
3. Ansible draft generation with lint/check-mode.
4. AWS pricing adapter.
5. Additional cloud and on-premises cost templates.

## 10. Quality gates

| Gate | Pass condition |
|---|---|
| G0 — Pilot scope | Real system, real decision, trusted sample data, agreed financial contract |
| G1 — Domain correctness | Requirement -> ADR -> assumption -> evidence -> calculation -> self-review is traceable |
| G2 — Data/security | Upload controls, authorization tests, audit, backup/restore drill pass |
| G3 — Sizing | Golden fixtures and ranges agree with reference calculations; no false confidence |
| G4 — Adapter | Output is deterministic, secret-free, validated, linted, and PR-only |
| G5 — Integration | Least privilege, retry/idempotency, provenance, and test-space publish pass |

## 11. Immediate next tasks

1. Select the pilot system and decision.
2. Create and validate the version 1 Excel workbook.
3. Write the formula reference sheet and calculation test vectors.
4. Add a backend workspace/domain package to the repository.
5. Replace hard-coded Investment values with calculation service calls.
6. Persist one system, one ADR, one investment case, and one calculation run.
7. Generate the first Markdown report from persisted data.
8. Run G1 review before adding GitLab, Confluence, or IaC generation.

## 12. Definition of done for Vertical Slice 01

- A new local environment can be started with documented commands.
- One architect can complete the workflow without editing the database manually.
- The same workbook and form produce equivalent normalized records.
- TCO/ROI output is reproducible from an input snapshot.
- Every material output has provenance and confidence.
- Cross-project restricted-data tests pass.
- Markdown report contains architecture, decision, sizing, TCO/ROI, assumptions, evidence, and self-review history.
- No production provisioning or automatic apply is possible from this release.

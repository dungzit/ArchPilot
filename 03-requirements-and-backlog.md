# ArchPilot — Requirements and Initial Backlog

| Field | Value |
|---|---|
| Product | ArchPilot |
| Version | 0.1 |
| Status | Initial MVP backlog |
| Date | 2026-09-18 |

## 1. Primary MVP user journeys

### Journey A — Architecture decision

1. Create a project and system profile.
2. Record business goals, requirements, NFRs, constraints, and assumptions.
3. Add architecture components, dependencies, and deployment environments.
4. Create two or more options.
5. Score options against weighted criteria.
6. Record the ADR and rejected alternatives.
7. Run review checklist.
8. Complete self-review and decision log.
9. Export an architecture decision pack.

### Journey B — Investment evaluation

1. Select the current baseline system or asset.
2. Import purchase and operating-cost history.
3. Validate supplier, product, unit, currency, date, and quantity.
4. Define a candidate solution or device.
5. Define one-time, recurring, migration, support, staffing, and risk costs.
6. Define measurable benefits and assumptions.
7. Run conservative, expected, and optimistic scenarios.
8. Review TCO, ROI, payback, NPV, and sensitivity.
9. Capture Finance, Procurement, and Architecture evidence when available.
10. Export a business case with provenance.

### Journey C — Outcome review

1. Record actual cost, performance, utilization, and incident results.
2. Compare actual values with reviewed assumptions.
3. Mark benefits as achieved, partial, unverified, or missed.
4. Create a follow-up optimization or replacement decision.

## 2. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-001 | Users can create projects, systems, environments, and owners. | Must |
| FR-002 | Users can record functional requirements, NFRs, constraints, assumptions, and evidence. | Must |
| FR-003 | Users can model components, dependencies, deployment nodes, deployment targets, and Mermaid views. | Must |
| FR-004 | Users can create ADRs with context, options, criteria, scores, trade-offs, risks, and a selected decision. | Must |
| FR-005 | The architect can run a checklist, record comments, request changes, and mark an ADR reviewed or rejected. | Must |
| FR-006 | The system preserves version history and audit events for material changes. | Must |
| FR-007 | Users can maintain a technology catalog with owner, lifecycle, capability, and adoption status. | Must |
| FR-008 | Users can import purchase data from CSV/Excel and receive validation errors by row. | Must |
| FR-009 | Users can normalize suppliers, products, currencies, units, and cost periods. | Must |
| FR-010 | Users can define cost and benefit items for a baseline and candidate option. | Must |
| FR-011 | The system calculates TCO, ROI, payback, and NPV when required inputs exist. | Must |
| FR-012 | Users can run conservative, expected, and optimistic scenarios. | Must |
| FR-013 | Users can run sensitivity analysis on selected variables. | Should |
| FR-014 | Users can link external evidence such as repositories, pipelines, dashboards, quotations, and test results. | Must |
| FR-015 | Users can export architecture and investment reports to Markdown and CSV. | Must |
| FR-016 | Access is controlled by organization, project, and role. | Must |
| FR-017 | Restricted financial fields can be viewed only by authorized roles. | Must |
| FR-018 | The system displays source, formula, assumption, confidence, and calculation version for financial results. | Must |
| FR-019 | Users can record actual outcomes and compare them with reviewed forecasts. | Should |
| FR-020 | The system supports review dates and reminders for decisions and technologies. | Should |
| FR-021 | Users can select AWS, Azure, GCP, VMware, Kubernetes, on-premises, or hybrid as a deployment target. | Must |
| FR-022 | The system keeps architecture intent separate from target-specific implementation mappings. | Must |
| FR-023 | Users can generate target-specific Terraform, Ansible, Helm, or network artifacts from a reviewed blueprint. | Must |

## 3. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-001 | All material calculations are deterministic and reproducible from versioned inputs and formulas. |
| NFR-002 | Every self-review, export, import, formula change, and restricted-data access is auditable. |
| NFR-003 | Organization and project data are isolated by authorization checks and tested for cross-tenant access. |
| NFR-004 | The application supports backup, restore, and a documented recovery procedure before pilot production use. |
| NFR-005 | The main API supports a pilot workload with p95 latency under 500 ms excluding long-running imports and report jobs. |
| NFR-006 | Long-running imports, calculations, and exports run asynchronously and expose status. |
| NFR-007 | Financial outputs clearly distinguish actual, estimated, and unverified data. |
| NFR-008 | The system never presents a single ROI value without its scenario, assumptions, and data-confidence context. |
| NFR-009 | Sensitive evidence and reports have access controls and export authorization. |
| NFR-010 | The product can be deployed locally with documented configuration and seeded sample data. |

## 4. Initial backlog

| ID | Epic | Story / deliverable | Acceptance signal |
|---|---|---|---|
| EPIC-01 | Foundation | Create local development environment and seed data | A new developer runs the product locally |
| EPIC-02 | Identity | Add OIDC login and project roles | Unauthorized project access is denied and audited |
| EPIC-03 | Workspace | Create project, system, environment, owner | A system profile is visible and editable by authorized users |
| EPIC-04 | Requirements | Add requirements, NFRs, constraints, and assumptions | An ADR cannot be submitted without required context |
| EPIC-05 | Architecture | Add components, dependencies, deployment nodes | Mermaid output matches the stored model |
| EPIC-06 | Decisions | Add options, criteria, weighted scoring, and ADR | Score is reproducible and decision rationale is required |
| EPIC-07 | Review | Add checklist, comments, change request, self-review | Decision history shows actor, date, and decision |
| EPIC-08 | Technology | Add technology catalog and lifecycle status | A technology can be linked to systems and ADRs |
| EPIC-09 | Procurement | Import CSV/Excel purchase records | Invalid rows are reported without losing valid rows |
| EPIC-10 | Cost model | Normalize cost items and periods | Same cost data can be compared across options |
| EPIC-11 | Value engine | Calculate TCO, ROI, payback, and NPV | Results include formula version and assumptions |
| EPIC-12 | Scenarios | Add conservative/expected/optimistic values | Scenario results can be compared in one report |
| EPIC-13 | Evidence | Upload or link source documents | A result links to its source and confidence |
| EPIC-14 | Reporting | Export architecture pack and business case | Export is readable and includes provenance |
| EPIC-15 | Outcome | Record actual results and variance | Forecast versus actual is visible |
| EPIC-16 | QA | Add unit, API, authorization, import, and calculation tests | Critical paths pass in CI |

## 5. Acceptance criteria for the first vertical slice

The first vertical slice is complete when all conditions hold:

- A user creates a system and records at least one requirement and one NFR.
- The user creates two architecture options and scores them using weighted criteria.
- The selected option becomes an ADR with an owner, assumptions, evidence, and reviewer.
- A purchase CSV is imported with valid rows, invalid-row errors, and normalized currency metadata.
- A baseline and candidate option each have one-time and recurring costs.
- The system produces three TCO scenarios and a reproducible ROI result.
- The architect marks or rejects the ADR and investment case after self-review.
- Markdown output contains architecture, decision, assumptions, sources, TCO, and self-review history.
- A test proves one project cannot read another project's restricted financial data.

## 6. Data-quality rules for purchase import

Required or conditionally required fields:

- Supplier.
- Product/model.
- Category.
- Purchase date.
- Quantity.
- Unit price.
- Currency.
- Unit of measure.
- Contract or support period where applicable.
- Source document or source reference.

Validation rules:

- Currency must be an approved ISO currency code.
- Quantity and price cannot be negative.
- Dates must be valid and cannot be outside the configured project period without warning.
- Duplicate transaction identifiers must be flagged.
- Supplier and product names should map to canonical records.
- Missing support or renewal period must reduce confidence, not silently become zero.
- Imported records retain the original value and normalized value.

## 7. Test strategy

- Unit tests for scoring and TCO/ROI formulas.
- Property tests for zero, negative, missing, and boundary values.
- API tests for workflows and asynchronous job status.
- Authorization tests for organization, project, role, and restricted fields.
- Import tests for encoding, duplicate rows, invalid currency, missing values, and partial success.
- UI tests for the architecture and investment journeys.
- Export tests to confirm report provenance and self-review history.
- Performance test for API p95 and large import jobs.
- Backup/restore test before pilot release.

## 8. Discovery questions to answer in Phase 0

1. Which real system and investment decision will be the pilot?
2. Who owns the architecture data, procurement data, operational metrics, and benefits validation?
3. Which currency and exchange-rate source should be authoritative?
4. Should TCO include internal labor, datacenter overhead, downtime risk, and opportunity cost?
5. Which cost categories are confidential and which roles may see them?
6. What is the minimum self-review workflow for architecture and investment?
7. Which existing systems and target environments are available first: GitLab, Excel, AWS, Azure, GCP, VMware, Kubernetes, Prometheus, Jira, or ITSM?
8. What reporting format is required by the architecture board and Finance?
9. What is the target analysis period: 3, 5, or 7 years?
10. Which historical records are reliable enough to become the baseline?

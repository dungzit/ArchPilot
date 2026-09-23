# ArchPilot — Core Modules and UCROPS Workbench

| Field | Value |
|---|---|
| Product | ArchPilot |
| Reference | SystemsArchitect.io core framework, reviewed 2026-09-19 |
| Status | Product direction and Phase 1 module map |
| Language | Vietnamese + English |

## 1. Reference synthesis

SystemsArchitect.io organizes architecture work around seven workflows:

1. 6R solution lifecycle: Request, Requirements, Review, Resolve, Realize, Reassess.
2. 6U user workflow: User Pitch, User Roles, User Qualities, UI, UX/Screens, User Projections.
3. Platform workflow: application, data, storage, networking, security, and DevOps platforms.
4. UCROPS technology composition: Usability, Cost, Reliability, Operations, Performance, Security.
5. Architecture pattern checklist.
6. Design funnel: n-tier, API/microservices, queue/API/microservices, event-driven.
7. Data model workflow: use cases, access patterns, API design, and data model.

ArchPilot adopts these as inspiration and adds evidence, sizing, deployment targets, knowledge, review, and Investment & Technology Value.

## 2. ArchPilot module map

| Module | Purpose | Core output |
|---|---|---|
| 6R Solution Lifecycle | Manage the architecture journey from request to reassessment | Stage board, decisions, actions, reassessment record |
| 6U User & Business | Capture who uses the system and what quality of experience is required | User/persona profile, journeys, UX requirements |
| Architecture Canvas | Model components, dependencies, boundaries, and deployment targets | Logical/deployment graph, Mermaid export |
| Platform Map | Organize technology by application, data, storage, network, security, DevOps | Capability map and technology catalog |
| UCROPS Quality Review | Score and evidence the six architecture qualities | UCROPS scorecard, gaps, actions |
| Pattern Funnel | Select an architecture style based on scale, complexity, team, and reliability needs | Pattern recommendation with trade-offs |
| Data Model & Access | Connect use cases to APIs, access patterns, schemas, and storage | Data decision record and access matrix |
| Sizing Studio | Estimate API, database, Kubernetes, storage, network, and firewall | Scenario ranges with formula and confidence |
| Deployment Blueprint | Map intent to AWS, on-premises, Kubernetes, VMware, or hybrid | Target mapping and reviewable artifacts |
| Knowledge Base | Store internal and public patterns, controls, sizing rules, and lessons | Searchable, cited knowledge records |
| Investment & Technology Value | Evaluate TCO, ROI, payback, NPV, and benefit realization | Business case and outcome review |
| Evidence & Export | Keep provenance and produce architecture/business reports | Evidence manifest, Markdown, CSV |

## 3. UCROPS as the quality gate

Every architecture option and major technology choice receives a score from 0 to 5 for each dimension. A score is not valid without evidence or an explicit assumption.

| Dimension | Questions |
|---|---|
| Usability | Can users, administrators, developers, and operators use the system effectively? Is UX measurable? |
| Cost | What are CapEx, OpEx, licensing, staffing, migration, and exit costs? |
| Reliability | What are availability, failure domains, backup, DR, RPO, and RTO? |
| Operations | Can teams deploy, observe, troubleshoot, patch, scale, and recover it? |
| Performance | What are latency, throughput, concurrency, capacity, and growth assumptions? |
| Security | How are identity, access, data, network, secrets, supply chain, and audit handled? |

The scorecard produces:

- Weighted score.
- Evidence coverage.
- Unresolved gaps.
- Required actions.
- Confidence classification: measured, declared, estimated, or unverified.

## 4. 6R lifecycle in ArchPilot

```text
Request -> Requirements -> Review -> Resolve -> Realize -> Reassess
```

| Stage | ArchPilot capability |
|---|---|
| Request | 6U user/business brief and problem statement |
| Requirements | Functional requirements, NFR, constraints, assumptions |
| Review | UCROPS, security, sizing, pattern, and data checklists |
| Resolve | ADR, trade-offs, issues, exceptions, and actions |
| Realize | Deployment blueprint, export, IaC draft, test evidence |
| Reassess | Actual-vs-forecast, incidents, SLO, TCO, and next decision |

## 5. Phase 1 demo scope

The first usable web demo adds these focused views:

- Lifecycle board showing 6R stage and open gates.
- UCROPS scorecard with evidence coverage and gap actions.
- Pattern Funnel showing recommended style and rejected alternatives.
- Data Access view connecting use case, API, access pattern, and data store.
- Existing Architecture, Sizing, Deployment, Operations, Technology Radar, and Investment views remain available.

The demo remains local and single-user. It uses seeded records and does not claim live production integration.

## 6. Design guardrails

- UCROPS is a self-review framework, not an automatic architecture decision.
- A high score without evidence is shown as low confidence.
- Pattern recommendations explain trade-offs and do not replace architect judgment.
- Public knowledge requires citation, retrieval date, applicability, and review owner.
- Every export includes revision, source, formula version, and self-review metadata.
- The system supports cloud and on-premises designs equally; target-specific artifacts use adapters.

## 7. Reference

- [SystemsArchitect.io core](https://www.systemsarchitect.io/docs/intro#systemsarchitectio-core)

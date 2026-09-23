# ArchPilot — Phase 1 MVP Acceptance Plan

## Scope

Local single-user MVP covering Workspace, Requirement/NFR, Architecture Model, ADR, Basic Sizing, Review Checklist, Knowledge Search, and Markdown/CSV Export.

## Acceptance criteria

| ID | Module | Acceptance |
|---|---|---|
| AC-WS-001 | Workspace | Create and reopen a project/system with stable ID, owner, status, revision, and timestamps. |
| AC-REQ-001 | Requirement | Create functional requirement and NFR with enum validation, target metric, source, and confidence. |
| AC-ARCH-001 | Architecture | Create components, dependencies, deployment target, and Mermaid output from the stored graph. |
| AC-ADR-001 | ADR | Create options, weighted criteria, rationale, trade-offs, risks, evidence, and selected decision. |
| AC-ADR-002 | Review | Reviewed revisions are immutable; changes create a new revision and stale the old self-review. |
| AC-SIZE-001 | Sizing | Run API/database/Kubernetes/storage/network/firewall scenarios with formula version and warnings. |
| AC-REV-001 | Checklist | Mandatory failed items prevent marking reviewed; checklist stores architect notes, timestamp, and revision. |
| AC-KB-001 | Knowledge | Search title, summary, tags, target, and source across local knowledge records. |
| AC-EXP-001 | Export | Export Markdown architecture pack and CSV tables with provenance and self-review history. |

## Test cases

- Create project, system, and environment; restart local app; reopen saved record.
- Reject missing requirement title, invalid priority, invalid target unit, and duplicate IDs.
- Reject a dependency to an unknown component.
- Render a two-node Mermaid graph with a labelled edge.
- Calculate an API scenario with 500 RPS, 2x peak, and 30% headroom.
- Mark sizing `estimated` when no benchmark evidence exists.
- Prevent marking reviewed when a mandatory checklist item is `fail` or unresolved.
- Search both Vietnamese and English knowledge titles case-insensitively.
- Export Markdown with revision, formula version, assumptions, sources, and self-review history.
- Escape CSV values beginning with `=`, `+`, `-`, or `@`.

## Definition of done

- Seed data loads without manual database edits.
- Core records survive app restart using local persistence.
- All calculations are deterministic and have unit tests.
- The UI does not present an estimated result as `ready`.
- Exported documents can be reopened and traced to stored records.
- `npm run build` passes.

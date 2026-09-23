# ArchPilot

> Architecture and Technology Value Engineering Platform

ArchPilot is a decision-support platform for the technology decision lifecycle:

`Requirement -> Architecture Decision -> Deployment -> Operations -> Optimization -> Investment Value`

The product helps an individual architect make technology decisions with traceable evidence. It does not replace ERP, CMDB, monitoring, CI/CD, accounting, or enterprise approval workflows.

## First build slice

The first product slice focuses on two connected workflows:

1. Architecture decision and review for a real system.
2. TCO/ROI evaluation for a technology, solution, or device using historical purchase data.

The first pilot should prove that one decision can be traced from requirements and options through cost assumptions, self-review, and an outcome review.

## Product decisions for the first build

- Primary user: an individual system architect.
- Deployment model: cloud-neutral; supports public cloud, on-premises, bare metal, Kubernetes, and hybrid environments.
- Initial provider example: AWS. AWS is an adapter and reference implementation, not a product boundary.
- Air-gapped deployment is out of scope for the first release, but the domain model must not prevent future private deployment.
- Input modes: Excel import plus form UI.
- Sizing scope: API, database, Kubernetes, VM, storage, network, and firewall across cloud and on-premises targets.
- Knowledge base: internal knowledge plus curated public best practices.
- Languages: Vietnamese and English.
- First integrations: GitLab and Confluence.
- Infrastructure output: Terraform and Ansible generation in the MVP workflow.
- Product goal: a usable architect-owned product, not only an internal demo for the current sub-agent workspace.

## Running the prototype

Requires **Node 24** (matches both Dockerfiles' build stage; Node 20 is EOL).

```text
npm install
npm run dev
```

## Lint, test, build

These four commands are exactly what CI runs (`.github/workflows/ci.yml`, job
`frontend`). There is no ESLint config on purpose: `tsc -b` under `"strict": true`
is the TypeScript gate for this prototype.

```text
npm run typecheck   # tsc -b
npm test            # vitest run - 63 tests
npm run build       # tsc -b && vite build
```

The current prototype provides a navigable workspace for Architecture, Sizing, Deployment, Operations, Technology Radar, and Investment & Technology Value. The Investment module includes an interactive TCO/ROI draft calculator; persistence and live integrations are planned next.

## Source layout

```text
src/main.tsx              bootstrap only
src/app/                  App shell, navigation, shell regression tests
src/ui/                   shared: copy(), PageHeader, ModulePanel, DatabaseIcon
src/features/<module>/    one file per screen, keyed to ModuleKey
src/domain/               framework-free logic: sizing, knowledge, store, ...
src/contracts/            the TypeScript half of contracts/archgraph.schema.json
```

Add a screen by adding a `ModuleKey`, a `src/features/<key>/` directory, one
line in `src/app/navigation.ts` and one line in `src/app/App.tsx`.

For the complete Windows PC and Docker instructions, see [PC deployment guide](09-pc-deployment-guide.md).

## Documents

- [Product charter](01-product-charter.md)
- [MVP architecture and delivery plan](02-mvp-architecture-plan.md)
- [Requirements and initial backlog](03-requirements-and-backlog.md)
- [Next implementation plan](04-next-implementation-plan.md)
- [Phase 0 foundation contracts](05-phase0-foundation-contracts.md)
- [Phase 1 MVP acceptance](06-phase1-mvp-acceptance.md)
- [Core modules and UCROPS workbench](07-core-modules-ucrops-workbench.md)
- [Reference synthesis: SystemsArchitect.io and SysDesAi](08-reference-synthesis-sysdesai.md)

## Working principles

- Evidence before recommendation.
- Explicit assumptions and confidence levels.
- Explicit self-review for architecture and investment decisions.
- Reuse existing tools through adapters rather than replacing them.
- Start as a modular monolith; split services only when a real boundary is proven.
- Keep financial and procurement data tenant-scoped and auditable.

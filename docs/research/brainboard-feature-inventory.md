# Brainboard feature inventory (research for ArchPilot v1)

Source: public docs at docs.brainboard.co (read 2026-09). All notes are paraphrased in our own words; this is input for an original ArchPilot design, not a copy. Where a docs page came back thin (see section 6), the gap is stated rather than guessed.

Our current prototype (`docs/prototype/systemsarchitect-demo.html`) already has: a left icon rail (main navigation), a top project toolbar, and views for Canvas, Sizing, Hub, Admin. So a Brainboard-like canvas workspace slots into the existing "Canvas" view.

---

## 1. Plain-language summary

Brainboard is a web workspace where a team draws cloud infrastructure on a canvas and the tool writes the Terraform (or OpenTofu) for it. The diagram is the source of truth for editing; code is regenerated from it, and edits to the code can flow back onto the diagram. Around that core sit:

- a palette of real provider resources (taken from the Terraform provider schema, version-selectable),
- containers that pass settings (for example the network id) down to children,
- variables, locals, outputs, modules, providers and state backend handled as first-class UI objects,
- a template catalog (public + organisation) to start from,
- import of existing infrastructure (from a cloud account, or from a Git repo of Terraform),
- an AI assistant ("Brainy") that edits the diagram from chat,
- an Issues tab (warnings + Terraform validation errors),
- a built-in CI/CD designer (stages of tasks, plugins for plan/apply, security scans, cost estimate, notifications), pipeline run history, drift detection on a cron schedule,
- Git integration (push generated code as a pull request; import code from a repo) with GitHub, GitLab, Azure DevOps, Bitbucket,
- project / environment / architecture hierarchy with RBAC, SSO, teams, SOC 2 Type II, and a self-hosted option.

Design philosophy: "design first, one end-to-end platform" (visual design -> code -> pipeline -> deploy -> drift, all in one place).

Key takeaway for ArchPilot: Brainboard is a deployment-oriented tool. ArchPilot is a system-design/learning workbench. We should adopt the *design-to-code mapping and generated-file layout*, the template catalog, the right-panel Code/Issues/Resources idea, and Git/PR export, but not the runner, drift, or cloud-credential machinery in v1.

---

## 2. Screen / layout description (designer-reproducible)

### 2.1 Regions of the architecture workspace

```
+--------------------------------------------------------------------------+
| Top bar: project > environment > architecture name, version, share,      |
|          Pull request button, run/plan actions, collaborators            |
+---------+-----------------------------------------------+----------------+
| LEFT    |                                               | RIGHT PANEL    |
| PANE    |            DESIGN AREA (canvas)               | tabs:          |
|         |    + docked Brainy chat (bottom/side)         |  Resources     |
| provider|                                               |  Code          |
| search  |                                               |  Issues        |
| Resources                                               |  Deploy        |
| Data src|                                               | (+ resource    |
| Modules |                                               |  config form   |
| Inputs/ |                                               |  when a node   |
| Outputs |                                               |  is selected)  |
+---------+-----------------------------------------------+----------------+
```

**Left pane**
- Provider selector (and provider version) at top; filtering the list to that provider.
- Search box.
- Toggle between "Resources" (things that get created) and "Data sources" (read-only lookups of existing things).
- Category-grouped list of node types; each item is dragged onto the canvas.
- Modules section: an Import button (from a registry or Git repo) and a Catalog button (organisation module library).
- Inputs & outputs section: Variables, Locals, Outputs, each a small list with an "add" action, plus import of existing variables from .tfvars/.tf files. Variables have a scope: architecture, environment, project or organisation (narrower scope overrides broader).

**Design area (canvas)**
- Free-form 2D canvas with drag-and-drop nodes, nested containers, connector lines, text and shape annotations.
- Six node kinds: resource, data source, icon-only (no code), container, module (can display as a node or expand as a container), shapes/text (documentation only).
- Containers accept children; invalid nesting (e.g. a subnet inside a subnet) is blocked and the layout auto-corrects.
- Connectors come in two kinds: purely visual (manual, dragged from a node border handle) and relationship connectors (auto-created when a field references another resource; labelled with the attribute involved). Style options: orthogonal/straight/curvy, solid/dashed (three dash sizes), thickness small/medium/large, colour (palette or hex), arrowhead filled/outline/none; double-click to edit the label.
- Renaming a resource updates every reference automatically.
- Extra design-area features listed in the docs index: versioning, architecture documentation (a Readme file), multi-user collaboration, graphical options, multi-cloud, provider-specific config, keyboard shortcuts.
- Brainy chat is docked next to the canvas (already known from the task brief: @ mentions of nodes, expandable "Thought", undo, validation, live code view).

**Right panel**
- Four tabs: Resources (list of every node, click to jump), Code (generated Terraform, editable in a Monaco-based editor), Issues (warnings + validation errors, click to jump to the offending node), Deploy (pipeline set-up, execution history, deployment targets, quick actions).
- Collapsible with an arrow, resizable by dragging its left edge; shortcuts exist to toggle Code and Resources.
- Selecting a node shows the **Resource Configuration form** (see 3.3) in the panel.

**Other screens** (outside the canvas): home page with "Create architecture" (from scratch / from a template / import from cloud provider / import from Git); template catalog (filters: scope, provider, tags, search, sort by name/provider/updated); Pipelines page (table of runs with status and a mini task graph); Settings (authentication, SSO, organisation, members, teams, RBAC, integrations for Git and cloud providers, remote backend default).

### 2.2 Key interactions
- Drag from palette -> drop on canvas or on a container (container passes inherited fields).
- Click node -> right panel shows config form; fields can be text/number/boolean/list, nested blocks (add/remove via a "sections builder"), value from variable, or reference to another node's attribute.
- Setting a reference -> connector appears automatically; deleting the reference removes it.
- Right-click on a node: move to a Terraform file ("Edit TF filename"), etc.
- Right-click an architecture -> Publish as template.
- Save in the code editor (Ctrl/Cmd+S) -> code is parsed, validated, and the diagram updated; new resources land at the right edge and need manual placement.
- Code editor limits: cannot rename resources there; provider and backend files are read-only; comments are not preserved; attribute order may change.

### 2.3 Fit with ArchPilot's existing layout
Rail + topbar + Canvas view already exist. Add: a palette pane (left, inside Canvas view), a right inspector with tabs (Inspector / Code / Issues / Sizing), and a docked assistant later. Keep provider-neutral vocabulary in the palette (see 5).

---

## 3. Design-to-Terraform pipeline, step by step

### 3.1 Mental model
1. **Palette item = provider schema entry.** Each palette item corresponds to one Terraform resource type (or data source) at the chosen provider version; the config form is built from that version's parameters. Switching provider version reloads the palette and requires a plan to validate, because parameters can be added/removed between versions.
2. **Node = one block.** Resource node -> `resource` block; data node -> `data` block; module node -> `module` block; icon/shape/text nodes -> no code.
3. **Nesting = inherited attribute.** Putting a gateway inside a network container fills its network id reference automatically. Containers know which of their properties children inherit.
4. **Edge = reference/dependency.** Relationship connectors are derived from attribute references (and explicit `depends_on`, which also draws a link). Visual connectors carry no code.
5. **Variables/locals/outputs are separate lists** referenced from fields.
6. **Code is regenerated, not stored.** The platform persists the design as JSON (nodes, positions, config, variables) and produces Terraform on demand; the docs explicitly say the generated text isn't stored as code.

### 3.2 Generated file layout (default)
| File | Content |
|---|---|
| main.tf | all resource / data / module blocks |
| variables.tf | variable definitions (type, default, sensitive, validation) |
| terraform.tfvars | variable values only |
| locals.tf | local values |
| outputs.tf | output declarations |
| providers.tf | `terraform` block (required providers/versions) + provider configs (read-only in editor) |
| backend.tf | remote backend config (read-only in editor) |

Users can create extra files by "Move to file" (for example vpc.tf, db.tf, or per-microservice files), rename them, and move resources between files. Deleting a file returns its resources to main.tf. Best practice suggested: group by infra component or by application component.

### 3.3 Resource configuration form
- Attribute editors by type (text, number, tri-state boolean, list).
- Nested blocks with add/remove.
- Field can be bound to: literal, variable, reference to another resource attribute (Terraform expression generated for you), or a Terraform function expression (e.g. `merge` for tags).
- Meta-arguments: `count`, `for_each`, `depends_on` (draws a link), `lifecycle`.
- Tags handled as an optional section.

### 3.4 Variables and scope
Types: any, bool, list, map, number, object, set, string, tuple. Options: default (makes it optional), value (goes to tfvars), sensitive flag, custom validation rules. Four scopes (architecture, environment, project, organisation) with narrower scope winning. Import from existing .tfvars/.tf. Vault-backed secrets are referenced via variables rather than pasted.

### 3.5 Providers and multi-cloud
Supported providers: AWS, Azure (AzureRM), GCP, OCI, Scaleway. Multiple providers can live in one design. Provider config can be customised; unsupported providers have a documented workaround path (page listed but not read).

### 3.6 Modules
Import from a Terraform registry (with registry credentials for private ones) or from a Git repo; browse an organisation module catalog; a module node can be used as a node or a container; module nodes emit `module` blocks.

### 3.7 State backend
- Default: Brainboard stores state itself, isolated one file per architecture (named by architecture id).
- Optional: your own S3, Azure Blob, GCS, Terraform Cloud, or an HTTP endpoint; can be set organisation-wide or overridden per architecture. Bucket/container auto-created when missing (S3, Azure).
- State can be imported when importing existing Terraform.

### 3.8 Validate / plan / apply
- Issues tab gives design-time warnings (missing required params, unconnected resources, security best-practice violations) and Terraform validation errors, before any run.
- Terraform/OpenTofu actions (init, validate, plan, apply, destroy) are available from the UI ("one action") and appear in the Pipelines list too. Plan output shows in the Deploy tab. Requires cloud credentials configured in Settings > Integrations (docs do not detail the exact action page).

### 3.9 How it plugs into CI/CD and Git
1. **Git out:** "Pull request" button opens a dialog (commit message, title, description, file selection). The tool packages generated files, pulls the target branch first and pushes only the difference, then opens a PR on GitHub / GitLab / Azure DevOps / Bitbucket. Recommended before pushing: run cost analysis and security scan.
2. **Git in:** import an existing Terraform repo to get diagram + code. An "architecture synchronization" feature exists (synced architectures) but its page was not read.
3. **Built-in CI/CD designer:** a *workflow* = ordered *stages* (horizontal), each with *tasks* (stacked vertically, parallel). Tasks come from plugins: Terraform actions; security scanners (Trivy, Tfsec, Terrascan, OPA, Checkov); cost estimation (Infracost: breakdown or diff vs current); notifications (email, Slack, Teams); webhooks. Any task can require manual approval. Workflows can be saved as workflow templates. Run via "Run pipeline"; results in the Pipelines table with states: scheduled, pending (waiting for runner), running, succeeded, failed, terminated, manual (waiting approval). Runs execute on Brainboard runners or a **self-hosted runner** (Docker Compose or Kubernetes). An API exists.
4. **Drift:** scheduled (cron) or manual comparison of real infrastructure against the design; a detected drift marks the workflow failed and can email. Types of drift and remediation pages exist (not read).

### 3.10 Import of existing infrastructure
AWS: scans chosen regions using the account's resource index, lists resources with filters, then generates diagram + Terraform + state. Limits: only discoverable/tagged resources, secrets become placeholders, some mutually exclusive params need manual fixing, certain resource types should not be imported. Advice: import small logical groups. Azure import exists too.

---

## 4. Template system

- **Definition:** a template is a saved, standardised architecture (diagram + Terraform + variables) ready to clone.
- **Scopes:** Organisation (private to the company) and Public (curated by Brainboard's architects).
- **Publish:** right-click an architecture -> Publish as template; choose scope, name, optional description; remove sensitive data first.
- **Catalog:** searchable; filters for scope, provider, tags (networking, database, compute, serverless ...); sort by name / provider / last update.
- **Use:** "Create architecture -> From a template" or left menu. Choose "Use template", then pick project, environment, name, description. Alternatively copy a template's components into an existing architecture. Then customise (rename, change variables, use the assistant, validate).
- **Workflow templates:** separate concept for reusable CI/CD pipelines.
- **Data model:** template sits beside projects (not inside), so it can seed any project/environment.

---

## 5. Feature table

Priority key: Must / Should / Later / Skip for ArchPilot v1 (canvas + templates + custom design, knowledge hub, sizing, learning, Terraform generation with AWS as first adapter over a cloud-neutral model).

| Feature | What it does | Value for ArchPilot v1 | Notes |
|---|---|---|---|
| Node-palette drag and drop | Provider-organised list of resource types dropped onto canvas | Must | Palette should be cloud-neutral components (compute, DB, queue...) mapped by adapter to AWS types |
| Nested containers with inheritance | Parent (network) passes ids/settings to children; blocks invalid nesting | Must | Great for VPC/subnet/region/AZ; define a small containment rule table |
| Node-to-block mapping | Resource/data/module node -> Terraform block | Must | Core of generation; keep a mapping registry per adapter |
| Reference-derived connectors | Field references create labelled edges and dependencies | Must | Store edges with semantic type (references, depends_on, network flow) |
| Visual-only connectors | Decorative arrows with styling | Should | Needed for system-design diagrams (data flow); flag "no code" |
| Icon-only and shape/text nodes | Annotation without code | Must | Needed for design and teaching diagrams |
| Config form (attributes, blocks, meta-args) | Schema-driven inspector per node | Must | Ship curated subset for ~20 AWS resource types, not full schema |
| Variables / locals / outputs | First-class lists, typed, sensitive flag | Must | Include tfvars generation; scope only architecture + project in v1 |
| Multi-scope variables (env/project/org) | Override hierarchy | Later | Needs environments and orgs |
| Default file layout (main, variables, tfvars, locals, outputs, providers, backend) | Standard split of generated code | Must | Adopt the same well-known layout |
| Custom file grouping (move to file) | Reassign resources to named files | Should | Simple per-node "file" attribute |
| Provider block and version pinning | providers.tf with required providers | Must | Adapter emits; cloud-neutral model stays free of it |
| Provider version-driven schema | Palette reflects chosen provider version | Later | v1 pin one AWS provider version |
| Multi-provider/multi-cloud in one design | Several providers in one diagram | Later | Keep model neutral so it is possible; only AWS adapter in v1 |
| Modules (import, catalog, module node) | Reuse registry/Git modules | Later | Consider "composite node" concept first (our own template fragments) |
| Data-source nodes | Read-only lookups | Should | Useful for "existing VPC" scenarios |
| Code panel (read view) | Live generated Terraform | Must | Read-only, syntax highlighted, per-file tabs, download/copy |
| Code panel (editable, two-way sync) | Edit HCL and update diagram | Skip (v1) / Later | High complexity: needs HCL parser; note their own caveats (comments lost, ordering) |
| Download code / ZIP | Export generated files | Must | Cheapest path into a pipeline |
| Pull request to Git | Package files, push branch, open PR | Should | GitHub first; or v1 = download + documented CI snippet, PR export Later |
| Git import of existing Terraform | Repo -> diagram | Later | Requires parser + layout |
| Cloud account import (AWS scan) | Discover resources -> diagram + state | Skip | Needs credentials and heavy discovery; out of scope |
| Remote backend config | Emit backend.tf for S3/others | Must | Generate S3 backend snippet (+ lock table/lockfile note); do not host state |
| Managed state hosting | Platform stores state | Skip | Security and liability; we never run apply |
| Validate (Issues tab) | Design-time warnings + Terraform validation errors | Must | Our own rules (missing required, unconnected, best practice) + optional `terraform validate` in CI; run validation client-side for rules |
| Plan / apply / destroy from UI | Executes Terraform with credentials | Skip | v1 emits code only; run in user's pipeline |
| CI/CD designer (stages/tasks/plugins) | Visual pipeline builder | Later | v1: emit a starter pipeline file (GitHub Actions) with fmt/validate/plan steps |
| Security scanners (Trivy, Tfsec, Checkov, OPA) | Scan code in pipeline | Should | Include as steps in starter pipeline; static rules in Issues tab |
| Cost estimation (Infracost) | Monthly estimate from code | Should | Ties naturally to our sizing calculator; ArchPilot can estimate from sizing instead |
| Drift detection | Schedule compare live vs desired | Skip | Requires runners/credentials |
| Self-hosted runner | Run pipelines in own infra | Skip | |
| Notifications / webhooks | Slack, Teams, email | Skip | |
| Template catalog (public + org) | Curated architectures to clone | Must | Our knowledge-hub reference architectures become templates |
| Publish as template | Save own design for reuse | Should | Local/org library first |
| Template filters (provider, tags, scope) | Catalog browsing | Must | Tags by domain and scale |
| Template variables and post-clone edit | Adjust parameters after cloning | Must | |
| AI assistant (Brainy) | Chat edits diagram | Later | Design the command layer (add node, connect, set attr) so an assistant can call it later |
| Projects / environments / architectures hierarchy | Data organisation | Should | v1: project -> design (+ variants); environments Later |
| RBAC (admin/designer/operator/guest, custom) | Permission roles | Later | Single-user or simple share first |
| SSO / SCIM / orgs / teams | Enterprise auth | Skip | |
| Real-time multi-user | Multi-cursor editing | Later | Docs page unreadable; treat as unknown |
| Versioning of designs | Snapshot history | Should | Simple snapshots + diff |
| Architecture documentation (readme) | Markdown attached to design | Should | Fits learning/hub |
| Undo/redo, shortcuts, resizable panels | Editing ergonomics | Must | |
| Graphical options / connector styling | Line style, colours, arrowheads | Should | Small subset |
| Disaster recovery, SOC 2 | Ops/compliance | Skip | Note as trust signals only |
| Sensitive value handling (vault refs, sensitive flag) | Avoid secrets in code | Must | Never store secrets in design JSON; generate variable with sensitive = true |
| Stored as JSON, code regenerated on demand | Design model is source of truth | Must | Adopt: canonical cloud-neutral JSON model; generators pure functions |

---

## 6. Risks and gaps

**Product/scope risks**
- Full schema fidelity: Brainboard leverages complete provider schemas across versions. ArchPilot must ship a curated subset with known-good attribute mapping; explain this clearly to avoid "generated code does not apply" complaints.
- Cloud-neutral model vs AWS reality: neutral components ("managed relational DB") hide required AWS details (subnet groups, security groups, parameter groups, IAM). The adapter must add companion resources deterministically; document them as generated "companions".
- Two-way sync is expensive and lossy (their own docs note lost comments and reordered attributes). Recommend one-way in v1.
- Execution features (plan/apply/drift) drag in credentials, runners, state hosting and liability. Recommend explicit non-goal for v1.
- Diagram semantics: edges carry three meanings (visual, reference, dependency). Model them explicitly or the code output becomes unpredictable.
- Validation trust: generated code must pass `terraform validate` and format checks in CI; budget for golden-file tests per template.

**Security**
- Never persist secrets; use sensitive variables and external secret references. Their model of storing cloud credentials and Git tokens is not something to copy in v1.
- Templates can leak sensitive data if published carelessly; add a lint pass before publish.

**Research gaps (what the docs pages did not yield)**
- Many pages returned only a title and index (fetch summariser saw no body): Connection between resources, Inheritance, What & how code is generated, Split code into files (partial), Terraform/OpenTofu actions, Collaboration/Multi-user. Exact generation ordering, dependency emission and container-inheritance rules are therefore inferred only from the Node, Connectors, Resource-configuration and Code-panel pages.
- Not read (out of page budget): Modules details, Environments, Architecture synchronization, Drift types/remediation, Self-hosted runner, Workflow templates, Import from Azure, SSO, RBAC settings, Enterprise migration, Shortcuts, Glossary, Changelog, Versioning, Documentation, Graphics.
- No visual/screenshot verification; layout in section 2 is reconstructed from prose descriptions and a diagram sketch of my own, so a designer should treat proportions as free.
- Pricing/plan limits per feature were not examined.

---

## 7. URLs read

Base: https://docs.brainboard.co
- `/` (home) and `/llms.txt` (page index)
- `/cloud-design/design-area.md`, `/cloud-design/design-area/node.md`, `/cloud-design/design-area/connectors.md`, `/cloud-design/design-area/connection-between-resources.md` (thin), `/cloud-design/design-area/inheritance.md` (thin), `/cloud-design/design-area/collaboration-multi-user.md` (thin)
- `/cloud-design/left-bar/cloud-resources.md`, `/cloud-design/left-bar/input-and-output/variables.md`
- `/cloud-design/right-panel.md`, `/cloud-design/right-panel/resource-configuration.md`, `/cloud-design/right-panel/issues.md`, `/cloud-design/right-panel/deploy.md`
- `/cloud-design/code-edition.md`, `/cloud-design/autogenerated-code.md`, `/cloud-design/autogenerated-code/what-and-how-code-is-generated(.md)` (thin), `/cloud-design/autogenerated-code/split-code-into-files(.md)` (thin), `/cloud-design/autogenerated-code/terraform-opentofu-actions.md` (thin)
- `/data/data-structure.md`, `/data/data-structure/template.md`, `/data/data-structure/project-roles-and-permissions.md`, `/data/data-structure/cloud-architecture/terraform-files.md`, `/data/data-structure/cloud-architecture/remote-backend.md`
- `/data/cloud-providers/supported-cloud-providers.md`
- `/getting-started/fast-track.md`, `/getting-started/start-with-template.md`
- `/automation/ci-cd-designer.md`, `/automation/pipelines.md`, `/automation/drift.md`, `/automation/supported-plugins/cost-estimation/infracost.md`
- `/settings/integrations/git-configuration/pull-requests.md`
- `/help-and-faq/enterprise-customers/migration/aws-import.md`
- `/security/data.md`
- Previously read by requester: `/cloud-design/brainy`

# sysdesai.com "Design" Concept: Analysis and Provider-Neutral Proposals for ArchPilot

| | |
|---|---|
| Date | 2026-09-24 |
| Scope | The AI-architect design experience only. Gallery and learn are covered in `sysdesai-gallery-analysis.md` and `sysdesai-learn-analysis.md`. Governed by `docs/pattern-content-policy.md`. |
| Method | 9 successful WebFetch requests plus 3 HTTP 404s, one at a time, no scripting. robots.txt disallowed paths (`/design/`, `/designs`, `/feed`, `/notifications`, `/settings`) were NOT requested. WebFetch returns model-summarised text, so all facts below are second-hand summaries of public marketing, FAQ and llms pages. The actual design workspace is behind login and client-rendered, so UI details in section 2 are partly inferred and marked as such. |
| Wording | Everything is paraphrased. Only short feature names (Copilot, Autopilot, Fast, Deep Thinking) are reused. |

## 1. Summary: what the design experience is

sysdesai's centrepiece is an "AI Software Architect": the user describes a system in free text, and an LLM (Google Gemini) produces a structured design in a fixed sequence of phases, with a chat box available to question or change the result. It targets system-design learners and interview preparation, and is public-cloud/vendor agnostic in tone (generic "technology rationale"), with no on-prem or infrastructure sizing.

### 1.1 Observed step sequence (per llms-full.txt, about page and FAQ)

| # | Step (site's name) | What it produces (paraphrased) |
|---|---|---|
| 1 | Problem analysis | Functional and non-functional requirements. The AI asks clarifying questions first (Copilot) or answers its own questions with stated assumptions (Autopilot). |
| 2 | Scope definition | Feature prioritisation and an MVP boundary. |
| 3 | Capacity estimation | Numeric projections: traffic, storage, bandwidth. |
| 4 | Architecture ("Build") | High-level architecture diagram (rendered from Mermaid text) plus rationale for chosen technologies and trade-offs. The about page also lists a data model and API design in this phase; the exported spec lists API endpoints and data models with field specifications. |
| 5 | Data flow sequences | Sequence diagrams for key operations (described as custom SVG with zoom, pan and clickable elements). |
| 6 | Scalability strategy | Bottlenecks and scaling tactics (caching, sharding and similar). |
| 7 | Summary ("Wrap") | Recap of decisions, trade-offs, future considerations. |

The exact order of data model and API relative to architecture differs between pages (about page: after diagram; llms-full: within the build step). Treat them as sub-artifacts of step 4.

### 1.2 Modes and cross-cutting behaviours

- **Copilot**: one step generated at a time; user reviews, chats, then advances. The AI is said to update the design when the user pushes back.
- **Autopilot**: all steps generated in sequence with assumptions self-answered; user iterates afterwards.
- **Quality tiers**: Fast (cheap, quick model) and Deep Thinking (stronger model, extended reasoning), priced 5 vs 25 credits per design and 1 vs 5 per chat message. Video interview costs 30 credits. A free "fix broken diagram" action exists (implies LLM-authored Mermaid often fails to render).
- **Staleness propagation**: when an upstream step changes, downstream steps are automatically flagged "outdated". This is the most reusable idea in the whole product.
- **Persistence and sharing**: save to a personal dashboard; publish to a public gallery (optionally anonymously); each share has a short URL; anyone can fork a public design into an editable copy; social share buttons.
- **Export**: a single Markdown specification organised by phase (requirements, capacity, API endpoints, data models, diagrams, sequence flows), intended to be pasted into AI coding tools.
- **Bring your own key**: users may supply their own Gemini key (stored in the browser, per the FAQ) and then pay no credits.
- **Interview mode** (separate but design-linked): pick a topic and difficulty, or reuse any existing design as the prompt; voice conversation with an AI interviewer while drawing on a live whiteboard; scored in 6 categories; history retained.

### 1.3 Artifacts produced

Requirements list, scope/MVP list, capacity sheet, architecture diagram plus technology rationale, data model (entities and fields), API endpoint list, sequence diagrams, scaling/bottleneck notes, decision/trade-off summary, and the combined Markdown spec.

## 2. UI/UX description (partly inferred)

Not observed directly: the workspace is login-gated and disallowed for crawlers. What follows combines what the site says with typical patterns; items marked (inferred) should be confirmed by a human using the product.

**Screens**
1. **Entry**: a prompt box ("describe any system") with a mode switch (Copilot or Autopilot) and a quality switch (Fast or Deep Thinking). (Mode and quality choice stated; layout inferred.)
2. **Design session**: a stepper or phase list for the seven phases, a main content area for the current phase artifact, and a chat panel available at every step (stated: "chat at any design step"). (Layout inferred.)
3. **Phase view**: rendered artifact (diagram, tables, text). Diagrams zoomable; sequence diagrams pannable with clickable elements (stated).
4. **Outdated marker**: downstream phases show an outdated state after an upstream change (stated); presumably with a regenerate action (inferred).
5. **Dashboard**: the user's saved designs, with publish/unpublish and share (stated in outline; layout inferred).
6. **Share page**: read-only walkthrough with fork, bookmark and export (from earlier gallery research).
7. **Interview**: video call plus whiteboard (stated).

**Chat and canvas relationship**: The chat is the editing mechanism. Diagrams are produced from text; the site does not describe manual drag-and-drop editing (the FAQ is silent on diagram editing, and the presence of a "fix broken diagram" action suggests diagrams are text-rendered artifacts, not a freeform canvas). The whiteboard exists only in interview mode. So the design experience is document-like (a sequence of generated sections) rather than canvas-first.

**Reproduction guide for a designer (ArchPilot adaptation)**: left column = step list with status chips (not started, done, outdated, blocked by missing input); centre = the artifact for the current step; right = assistant/help panel (rule-based, showing checks and hints); top = mode switch (guided vs free) and export menu. Unlike sysdesai, the canvas is a first-class artifact of the "components" step.

## 3. Feature table

Priority scale: Must / Should / Later / Skip for ArchPilot v1. Constraints: no LLM in v1, 2-4 internal users, deterministic checks, sizing engine exists, Terraform generation planned.

| Feature | What it does | Applicability to provider-neutral on-prem + multi-cloud tool | Priority v1 | Notes |
|---|---|---|---|---|
| Fixed multi-step design pipeline | Guides from requirements to a summary in an ordered set of phases | High: a stepper is provider-neutral and gives structure | Must | Our phases differ (section 4a); add a deployment-target step |
| Requirements and NFR capture | Functional and non-functional requirements as the first artifact | High; on-prem adds constraints (site, power, licensing, air-gap) | Must | Use structured questionnaire, not free text |
| Scope/MVP prioritisation | Ranks features, marks MVP | Medium | Should | Simple MoSCoW list on the requirements step |
| Capacity estimation step | Traffic, storage, bandwidth numbers | High: we already have a sizing engine, which is stronger than an LLM's approximations | Must | Wizard feeds the engine; results are deterministic and reproducible |
| Architecture diagram from generated text (Mermaid) | Text-to-diagram rendering | Low: we have a canvas and an ArchGraph model | Skip | Optional Mermaid export later as a documentation format |
| Technology rationale and trade-offs | Explains why each tech was picked | High for on-prem vs cloud choices | Should | Turn into per-decision ADR records |
| Data model artifact | Entities and fields | High, neutral | Should | Simple entity/field editor; the DDL generator is Later |
| API list artifact | Endpoints and purposes | High, neutral | Should | Table editor with method, path, auth, owner component |
| Sequence flows | Step-by-step interaction diagrams | High, neutral | Later | Depends on a sequence editor; v1 can offer a numbered "flow steps" table bound to components |
| Scalability/bottleneck analysis | Identifies hot spots and remedies | High; can be rule-based on sizing output | Should | Use deterministic rules (for example headroom below threshold) |
| Summary/decision recap | Consolidated decisions | High | Should | Auto-assembled from artifacts, not free generation |
| Copilot mode (AI, step by step) | Human reviews each step | Concept applies: guided wizard | Must (as guided wizard) | Without LLM: questions and templates |
| Autopilot mode (AI generates all) | Fully generated design | Needs an LLM | Skip (v1) | A "start from a template with defaults" is the deterministic analogue |
| Chat at each step | Ask, request changes | Needs an LLM | Skip (v1) | Replace with contextual help, FAQ hints and rule explanations |
| Fast vs Deep Thinking tiers, credits | Cost/quality control | Not applicable | Skip | Internal tool has no credit model |
| Outdated-step propagation | Marks downstream steps stale on upstream edits | High and deterministic | Must | Dependency graph between artifacts and content hashes |
| Fix broken diagram | Repairs failed diagram syntax | Not needed with a structured model | Skip | Structured ArchGraph cannot be "syntactically broken" |
| Save to dashboard | Personal list of designs | High | Must | Already part of the product presumably |
| Publish with optional anonymity | Public gallery | Not applicable to an internal tool | Skip | Internal sharing by link or team space instead |
| Fork a design | Copy to editable version | High | Should | "Duplicate as new version" and "start from pattern" |
| Markdown spec export | Single doc organised by phase, for coding tools | High; useful for review and handoff | Must | Also add a structured JSON export, and Terraform later |
| Social share | Share to networks | Not applicable | Skip | |
| Bring-your-own API key | Use own LLM key | Not applicable in v1 | Skip | Reconsider when an optional LLM assistant is added |
| Interview mode (voice, whiteboard, scored) | Practice with AI | Not core to a design workbench | Skip | Learn module quiz mode already proposed in the learn analysis |
| Reuse a design as interview prompt | Links design to practice | Low | Later | |
| Interactive sequence view (zoom, pan, click) | Explore flows | Medium | Later | |
| Assumption logging in Autopilot | AI states assumptions it made | High as a concept | Should | Wizard records each defaulted answer as an explicit assumption |

## 4. Proposals for ArchPilot

### 4a. Guided design wizard without an LLM

Principle: a wizard is a fixed sequence of question forms plus deterministic mappings from answers to suggestions. Each answer set is stored, so steps can be recomputed and marked outdated when an input changes.

Steps:
1. **Context**: system name, purpose, users, environment constraints. Key branch questions: hosting intent (cloud, on-prem, hybrid), data residency, air-gapped, existing platforms (VMware, Kubernetes), team skills, budget class.
2. **Requirements and NFR questionnaire**: pick-lists and numbers, not free text. Topics: expected users, peak factor, read/write ratio, data volume and growth, latency target, availability target (nines), RPO/RTO, consistency need, data sensitivity and compliance class, geographic spread, change frequency. Each unanswered question can be set to "use default", which is stored as a visible assumption.
3. **Capacity estimates**: answers feed the existing sizing engine. Output: requests per second (average/peak), storage now and after N years, bandwidth, compute and memory class, IOPS, and optionally rack units/power for on-prem. Display formulas and inputs so numbers are reproducible.
4. **Suggested logical components**: a rule table maps requirement patterns to components (examples: availability of 99.9 or higher => load balancer plus at least two app instances and replicated data tier; read-heavy ratio above a threshold => cache tier; long-running or bursty work => queue plus workers; file/object payloads => object storage; sensitive data => key management and secrets vault; multi-site => replication and DNS/traffic steering; regulated => audit log store). Each suggestion shows the triggering answers ("because availability 99.95 and single site") and can be accepted or dismissed.
5. **Deployment target choice** (see 4d): still logical at this point; targets bind later.
6. **Canvas**: accepted logical components are placed on the canvas with default edges from a small template (tiers, data paths, async paths). The user edits freely; validation and sizing rules run continuously.
7. **Review**: checklist of unresolved suggestions, failing rules, outdated artifacts; export.

Deterministic rule format: JSON rules of the form `when <answers/graph predicate> then suggest <component or edge> with <reason text>`, authored as data so they can be extended without release. This mirrors the lesson check rules already proposed in the learn analysis, so both features can share one rule engine.

"Free mode" bypasses the wizard: open blank canvas at any time. Wizard artifacts stay linked to the design.

### 4b. Design artifacts beyond the diagram

| Artifact | Contents | v1 or later | Rationale |
|---|---|---|---|
| Requirements and NFR sheet | Questionnaire answers, assumptions log, MoSCoW scope | v1 | Foundation; drives everything |
| Capacity sheet | Inputs, formulas, outputs per tier and per site, growth years | v1 | Sizing engine already built |
| Component inventory | Table generated from the canvas: name, type, target, quantity, size class | v1 | Needed for Terraform and bill of materials |
| Decision log (ADR) | Title, context, options, decision, consequences, status, linked components; auto-suggested entries when a rule-driven choice is accepted | v1 (light) | Cheap, high value for review; also captures on-prem vs cloud rationale |
| Risks and checks report | Failing/passing deterministic rules, SPOFs, headroom | v1 | Deterministic; existing validation |
| API list | Endpoint, method, owner component, auth, rate class | v1 (table only) | Simple structured table |
| Data model | Entities, fields, keys, store type, owning component, retention | v1 (basic editor) | Links storage choices to sizing |
| Sequence flows | Ordered steps between components for key scenarios | Later (v1.5): numbered step table in v1 if time allows | Needs a dedicated editor and layout |
| Scalability notes | Rule output about bottlenecks | v1 (auto from rules) | Deterministic |
| Combined Markdown/PDF spec | All of the above in phase order | v1 (Markdown), PDF later | Handoff and review |
| Terraform skeleton | Generated from the component inventory per target | Planned, separate track | Only cloud and some on-prem providers (vSphere) map cleanly |
| Runbook/DR plan, cost estimate | Later derivatives | Later | Avoid scope creep |

Dependency order for outdated flags: requirements -> capacity -> components/canvas -> data model, API list, sequences -> decisions/scaling notes -> spec. Editing an earlier artifact marks later ones outdated (using content hashes).

### 4c. Provider-neutral component taxonomy

Two levels: a **logical role** (what the component does; neutral) and a **realisation** (how it is provided on a target). The canvas shows the role; the realisation is chosen per deployment target.

| Layer | Logical roles | Example realisations (illustrative, not exhaustive) |
|---|---|---|
| Edge and access | DNS, global traffic steering, CDN, WAF, DDoS protection, API gateway, reverse proxy | Cloud DNS/CDN/WAF services; on-prem appliance ADC, HAProxy/NGINX |
| Network | Load balancer (L4/L7), firewall, router, switch, VPN/interconnect, VLAN/VPC/VNet segment, service mesh | Cloud VPC constructs; physical switches, firewalls, WAN links |
| Compute | Bare-metal host, hypervisor cluster, virtual machine, container platform, function/serverless, batch worker | Bare-metal servers; VMware/Hyper-V/KVM; Kubernetes (managed or self-run); cloud VMs and functions |
| Application | Web tier, API service, background worker, scheduler, integration bus | Any of the compute realisations |
| Data stores | Relational DB, document DB, key-value store, wide-column, search index, time-series, graph, cache, data warehouse/lake | Managed services or self-hosted engines on VMs or Kubernetes |
| Storage | Block storage, file storage (NAS), object storage, SAN, backup target, archive/tape | SAN/NAS arrays, object gateways, cloud volumes/buckets |
| Messaging and streaming | Queue, pub/sub topic, event stream, workflow engine | Self-run brokers; cloud messaging services |
| Security and identity | Identity provider, directory, secrets vault, key management/HSM, certificate authority, SIEM/log audit | HSM appliances; cloud KMS; enterprise directory |
| Observability and ops | Metrics, logging, tracing, alerting, config management, CI/CD, artifact registry | Self-hosted stacks or cloud-native services |
| Physical and facility (on-prem) | Site/datacentre, rack, power/UPS, cooling, out-of-band management | Only in on-prem targets; carries rack units and power in sizing |
| External | Client, third-party service, SaaS, partner link | n/a |

Attributes common to every node: role, tier, criticality, statefulness, replica count, failure domain (host, rack, site, region/zone), data classification, sizing class, owner, and per-target realisation mapping. Failure domain is essential because on-prem redundancy is expressed in racks and sites while cloud uses zones and regions; a neutral field lets one HA rule check both.

### 4d. Presenting deployment targets in the UI

- **Two-step model**: design the logical architecture first; then choose a **target profile** for the whole design or per node group. Do not make users pick a provider at the start.
- **Target picker**: a card row with neutral names: Public cloud (AWS, Azure, GCP as sub-choices), On-prem virtualised (VMware, Hyper-V/KVM), Kubernetes (managed or self-run, any host), Bare metal, and Hybrid (mix). Cards show which features are available (for example Terraform support: full, partial, none).
- **Per-node override**: each component can be assigned a different realisation, giving hybrid designs (for example database on-prem, web tier in cloud). Nodes get a small target badge, and the canvas offers a "colour by target" toggle.
- **Mapping panel**: a side panel for the selected node lists suggested realisations for the chosen target (for example "Managed relational DB on Azure" vs "PostgreSQL on 2 VMs in VMware") with size class from the sizing engine.
- **Compare view** (Should, later in v1): the same logical design shown against two targets side by side: component count, rough capacity fit, availability construction, and which parts lack a Terraform mapping. Costs are indicative only and should be labelled as such.
- **Honesty about coverage**: show badges "generatable / manual / unsupported" per node so nobody assumes Terraform coverage for appliances or SAN.
- Avoid provider logos in v1 unless brand rules are checked; text labels suffice.

### Top proposals (short list)

1. Ship a rule-driven design wizard (questionnaire -> sizing engine -> suggested components -> canvas) with visible assumptions.
2. Adopt outdated-step propagation across design artifacts using content hashes.
3. Add a light ADR/decision log that auto-drafts entries from accepted suggestions.
4. Use a two-level neutral taxonomy (logical role plus per-target realisation, with a failure-domain attribute) covering on-prem and cloud.
5. Present deployment targets as a late, per-node-overridable choice with coverage badges and a compare view; export a phase-ordered Markdown spec and later Terraform.

## 5. Limitations, unknowns, risks, URLs read

**Limitations and unknowns**
- The design workspace lives under login and disallowed paths, and its pages are client-rendered. No screenshots or direct UI inspection were possible; section 2 is partly inferred. A human should create a free account (50 credits, or their own key) and walk one design to confirm layout, chat placement, how outdated steps look and whether diagrams are manually editable.
- Whether data model and API design are separate steps or sub-parts of the build step is inconsistent across pages.
- Export formats: the llms files say nothing, the FAQ and about page describe a Markdown spec. Whether there are other formats is unknown.
- Whiteboard exists in interview mode only per the sources; not confirmed as part of design mode.
- Counts conflict (738+ gallery designs on the home page, 48+ in llms text, 60+ lessons in FAQ vs 131 in the learn analysis). Treat all numbers as unreliable.
- No on-prem, hardware sizing, multi-cloud or IaC capability was observed; this is a differentiator for ArchPilot, not something to copy.

**Risks**
- Copying the seven-step wording or Markdown export layout too closely; the phases themselves are common knowledge, but our layout, labels and rule text must be original (policy).
- Rule-based suggestions can look simplistic against LLM output; mitigate by showing reasons and making all rules editable data.
- Rule and sizing drift: suggestions must reference sizing engine outputs, not stored constants.
- Terraform coverage gaps for on-prem items may disappoint; badges and manual-step lists address this.
- Scope creep (sequence editor, compare view, PDF) can delay v1; hold to the table in 4b.
- Summaries came through an AI-processing fetch tool and may be imperfect; nothing critical depends on a single claim.

**URLs read (successful)**
- https://www.sysdesai.com/
- https://www.sysdesai.com/llms-full.txt
- https://www.sysdesai.com/llms.txt
- https://www.sysdesai.com/about
- https://www.sysdesai.com/faq
- https://www.sysdesai.com/pricing
- https://www.sysdesai.com/interview

**Returned 404**: /how-it-works, /docs, /features.

**Local**: `docs/research/sysdesai-gallery-analysis.md`, `docs/research/sysdesai-learn-analysis.md`, `docs/pattern-content-policy.md`.

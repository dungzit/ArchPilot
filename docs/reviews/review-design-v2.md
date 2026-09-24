# Red-Team Review — ArchPilot Design v2 (provider-neutral design, deployment targets, IaC adapters)

| Field | Value |
|---|---|
| Title | Red-team challenge of `docs/design-v2.md` |
| Author | Solution Architect #2 (Red Team / Challenger) |
| Date | 2026-09-24 |
| Version | 1.0 |
| Doc reviewed | `docs/design-v2.md` v0.2 (Solution Architect #1), 1,483 lines |
| Requirements reviewed | `docs/requirements-v2.md` **v2.1** (binding). The design was written against v2.0 (its A-7). |
| Also read | `docs/research/*.md`, `docs/pattern-content-policy.md`, `docs/systemsarchitect-build-scope.md` v1.5, `docs/reviews/review-systemsarchitect-prototype.md` |
| Code inspected | `backend/app/main.py`, `schemas.py`, `routers/*.py`, `repositories/designs.py`, `backend/tests/test_contracts.py`, `backend/Dockerfile`, `Dockerfile`, `contracts/archgraph.schema.json`, `package.json`, `.github/workflows/ci.yml`, `src/` tree |
| Facts checked (web, 2026-09-24) | Terraform CLI current 1.16.0 (2026-08-26); `hashicorp/aws` 6.65.0 (2026-09-16) and 6.66.0; `vmware/vsphere` 2.17.1 (2026-09-14, namespace `vmware/`); OpenTofu 1.12.x; `@xyflow/react` MIT; `fflate` 0.8.3 MIT, writes zip times with **local-time** getters; CDKTF archived 2025-12-10; MinIO community repo archived 2026-02-12; BUSL permits internal CI use. Sources at the end. |
| Verdict | **Approve-with-changes.** The architecture is right. The document is not yet reconciled with the binding requirements, is not self-contained, and the plan is not a minimum plan. |
| Finding counts | **4 Blocker, 12 Major, 12 Minor** |

---

## 1. Executive summary

### English

The core architecture is sound and I approve its shape. Three layers (logical design, deployment target, adapter) is the right model. Running every generator as deterministic TypeScript (D-01) is the right call: a Python copy would duplicate the resolution logic, and a Node sidecar would add a runtime. A typed HCL IR with our own printer (D-07) is realistic if we constrain the IR and test it against the real `terraform fmt`. I am not asking for a redesign.

I am asking for four blocking fixes. **(1)** The design is not reconciled with requirements v2.1. It has different role ids, no `zone` container, no failure-domain label, no `COVERAGE.md`, no coverage of edges, clashing rule ids, and templates that carry an AWS target. Several Must acceptance criteria (AC-21, AC-22, AC-27, US-D2) would fail as designed. **(2)** Storing `realisations.<target>` on each node puts provider tokens inside the neutral model. This fails the neutrality scan (NFR2-NEUT-001). The data-keyed maps also break the existing contract test, which requires camelCase keys at every depth. Fix the data shape before the contract freezes in week 1. **(3)** The document points 26 times to "as in 0.1", but no 0.1 text exists in the repo. So the security controls, the AWS mapping, the gate rules and the CSP cannot be reviewed. **(4)** The "minimum releasable slice" contains Should items: 6 targets, hybrid, 7 lessons, 20 rules and an assistant. It also carries 2.7% contingency and ignores Tết (Lunar New Year). Below I give a corrected Tier-2 plan and a cut order. With 2 engineers it releases on **2027-02-19**; with a third engineer (E3) from week 2 it releases on **2027-01-15**. The critical path is the E1 user-interface chain, not the IaC chain.

### Tiếng Việt

Kiến trúc cốt lõi là đúng và tôi chấp thuận hình dạng tổng thể. Mô hình ba lớp (thiết kế logic, đích triển khai, adapter) là đúng. Chạy mọi bộ sinh mã bằng TypeScript tất định (D-01) là lựa chọn đúng: bản sao bằng Python sẽ lặp lại logic phân giải, còn một sidecar Node sẽ thêm một runtime. Biểu diễn trung gian HCL có kiểu cùng bộ in riêng (D-07) là khả thi, với điều kiện giới hạn phạm vi IR và kiểm thử nó với `terraform fmt` thật. Tôi không yêu cầu thiết kế lại.

Tôi yêu cầu bốn sửa đổi bắt buộc. **(1)** Thiết kế chưa được đối chiếu với yêu cầu v2.1. Tên vai trò khác nhau, thiếu container `zone`, thiếu nhãn miền lỗi (failure-domain label), thiếu `COVERAGE.md`, không tính độ phủ cho cạnh (edge), mã quy tắc bị trùng, và mẫu (template) lại gắn đích AWS. Nhiều tiêu chí nghiệm thu bắt buộc (AC-21, AC-22, AC-27, US-D2) sẽ không đạt nếu làm theo thiết kế hiện tại. **(2)** Lưu `realisations.<target>` trên từng nút đưa tên nhà cung cấp vào mô hình trung lập. Điều này làm hỏng bài kiểm tra trung lập (NFR2-NEUT-001). Các map có khóa là dữ liệu cũng làm hỏng bài kiểm tra hợp đồng hiện có, vốn yêu cầu khóa camelCase ở mọi cấp. Cần sửa hình dạng dữ liệu trước khi hợp đồng bị đóng băng ở tuần 1. **(3)** Tài liệu dẫn 26 lần tới "như bản 0.1", nhưng repo không còn nội dung bản 0.1. Vì vậy không thể rà soát các kiểm soát bảo mật, ánh xạ AWS, quy tắc chặn và CSP. **(4)** "Lát cắt tối thiểu có thể phát hành" lại chứa các hạng mục Should: 6 đích, hybrid, 7 bài học, 20 quy tắc và một trợ lý. Kế hoạch chỉ có 2,7% dự phòng và bỏ qua Tết. Tôi đưa ra kế hoạch Tier-2 đã hiệu chỉnh cùng thứ tự cắt giảm. Với 2 kỹ sư, ngày phát hành là **2027-02-19**; nếu có kỹ sư thứ ba (E3) từ tuần 2, ngày phát hành là **2027-01-15**. Đường găng là chuỗi giao diện của E1, không phải chuỗi IaC.

---

## 2. Direct verdicts

### 2.1 On Architect #1's six self-flagged questions (§9.2)

| # | #1's question | My verdict | Reasoning (short) |
|---|---|---|---|
| 1 | D-04: placement in scenarios, not on nodes | **Agree on placement; modify where realisations live** | Keeping placement off the node is right. But `realisations` keyed by target **on the node** undoes it: provider tokens enter the neutral node (B2). Move realisations into `deployment.bindings[]`. In the v1 UI, show one implicit scenario ("Runs on: <profile>"). Multiple scenarios and hybrid stay in the data shape and ship in v1.1 (both are Should in v2.1). |
| 2 | D-05: five coverage levels | **Modify** | v2.1 and US-D2 expect three badges (generatable / manual / unsupported), with "annotation" and "assigned-to-another-target" in the report. US-D2 expects firewall on AWS to show "generatable (as rules)", but D-05 calls it `implicit`. So keep 3 badges plus a `detail` sub-kind (`partial`, `implicit`, `reference`) that the tooltip and `COVERAGE.md` show. Honesty is kept, and the acceptance criteria pass. |
| 3 | Q-13: Terraform vSphere over Ansible | **Agree, conditional** | The toolchain reuse and offline `validate` argument holds. Condition: in week 1, confirm with Infra Ian (Q-19) that the platform is still VMware, and which edition. After Broadcom's licensing changes, some estates moved to Proxmox or Hyper-V. The edition also decides whether DRS and vDS exist (M4). |
| 4 | D-01: client-side generators | **Agree, with four fixes** | These fixes are: pure-JS SHA-256 (M6), a timezone-safe zip (M2), revision pinning so that "regenerate gives the same bytes" is true (M5), and a browser-side secret lint (M10). |
| 5 | D-08: one design document | **Agree, with limits** | One document keeps undo, revisions and conflicts simple. Bound the free text (ADRs), replace data-keyed maps with arrays (B2), and pin revisions on generate (M5). |
| 6 | Plan: 147.5 pd, 91% load | **Disagree** | See B4 and §8. The effort total is roughly right: my cuts and my additions cancel out. The duration is not credible, and the slice is not minimal. |

### 2.2 On the seven attack areas I was asked to cover

| Area | Verdict | Key findings |
|---|---|---|
| (1) Generators in the browser (D-01) and the fmt printer (D-07) | Realistic with constraints | M1, M2, M10; alternatives A1 |
| (2) 40 roles, 6 target catalogues, 5 coverage levels | Too much for v1. The on-prem taxonomy is coherent, but "no silent drops" covers nodes only | B1, B2, M7, M8 |
| (3) AWS and vSphere adapters, pins, offline CI, BUSL | Sound choice; the vSphere mapping has real apply-time gaps; the pins are too loose; offline CI needs a mirror, not a cache; BUSL is fine | M3, M4, m12 |
| (4) ArchGraph v2, 1 MiB cap, hashes, migration | Workable. Hash projections are too coarse (false "outdated" noise); no revision history | M5, M6, m2, m3, m6 |
| (5) Security | No blocker, but four concrete gaps: fallback route, CSP, injection beyond fixtures, audit hygiene | M9, M10, m8, m11 |
| (6) Plan | Not minimal, no contingency, the critical path is misread, one Must list is incomplete | B4, §8 |
| (7) Content load | Under-counted by about 10 pd; needs an on-prem subject-matter expert (SME); has two hidden dependencies | M12 |

---

## 3. Blockers (must fix before approval)

| # | Severity | Issue | Evidence / failure scenario | Concrete recommendation |
|---|---|---|---|---|
| **B1** | Blocker | **The design is not reconciled with binding requirements v2.1. As designed, several Must criteria fail.** | Design A-7 and §7 say it was written against v2.0. Concrete deltas: **(a)** Role ids differ: design uses `database`+variant, `object_store`, `network`, `subnet`, `bare_metal_server`, `kubernetes_cluster`, `identity`, `backup`, `vpn_gateway`, `topic`, `stream`. v2.1 §4.1.1 uses `relational_db`, `object_storage`, `network_segment`, `bare_metal_host`, `container_platform`, `identity_provider`, `backup_target`, `vpn_link`, `pubsub_topic`, `event_stream`. **(b)** There is no `zone` container, but REQ-DES-004 (Must) requires site > zone > network_segment. **(c)** There is no `failureDomainLabel` (REQ-DES-025, Must). Scenario: US-D2 says "two replicas in the same rack label warn; two distinct labels do not". With only a level field, the rule cannot tell rack-1 from rack-2, so AC-27 fails. **(d)** The package has no `COVERAGE.md` (REQ-IAC-003, Must). **(e)** Coverage covers nodes only (S-4). REQ-ADP-004 and AC-22 require every **edge** too, plus the classes "annotation" and "assigned-to-another-target". **(f)** Rule ids clash: v2.1 IAC-W08 is "failure-domain level not expressible", but the design's IAC-W08 is "stateful node in public tier". v2.1 IAC-W09 is "other-target nodes excluded", but the design's IAC-W09 is "clamped sizing". **(g)** Templates carry an AWS profile (§4.3.7), but REQ-TPL-004 says templates are "all logical (no target chosen)". Legacy migration and "Open in canvas" add a default AWS profile, but REQ-TGT-003 says the default is **unset**. **(h)** REQ-ART-004 (package shows "generated from revision N; design is now M") has no mechanism, because C-v2-1 removed the revision. **(i)** The adapter interface lacks REQ-ADP-001 metadata: validation command set, supported failure-domain levels, pipeline templates. **(j)** The vSphere backend is http/pg, but Q-25 says S3-compatible. | Issue design v0.3 after one joint mapping pass by SA#1 and the BA (**0.5 day, week 1, before tasks 0.2 and 0.6**). Adopt the v2.1 role ids (keep the design's variants where v2.1 is silent). Add `zone` and `failureDomainLabel`. Add `COVERAGE.md` with node **and** edge rows. Re-number the design's new rules as IAC-W10..W11. Ship templates with no deployment block; put per-adapter goldens in `tests/fixtures/<template>.<adapter>.json`. Default target = unset. Add a stale-package banner fed by the last `iac-event` revision (M5). Add the three interface fields. The BA should also fix one requirement inconsistency: Must wizard rules (REQ-WIZ-006) suggest `key_management` and `siem_log_store` (Should) and `artifact_registry` (Could). Promote those three roles to Must, or relax the rules. |
| **B2** | Blocker | **D-04 stores `realisations.<target>` on each node and uses maps keyed by data. This breaks neutrality and the existing wire contract.** | **Neutrality:** NFR2-NEUT-001 and AC-21 scan "graph schema, palette data and templates" for `aws`, `vsphere`, … The design's example node (§4.3.2) carries `"aws": {"realisation": "aws.rds", "config": {"instanceClass": "db.t4g.medium"}}`, so every template fails the scan. **Contract:** `backend/tests/test_contracts.py:177-190` validates every design response, graph included, against `camelCaseObject`, which recursively requires keys to match `^[a-z][A-Za-z0-9]*$` (`archgraph.schema.json:14`). Target ids `bare_metal` and `k8s_onprem`, profile ids like `dc1_vsphere`, derivation keys like `brief.answers`, and unconstrained node ids used as `placements` keys all fail it. Scenario: the first v2 design saved with a vSphere binding turns CI red, or someone quietly weakens the casing rule. | Move every target-specific item out of the node into `deployment`, as **arrays of objects**: `deployment.bindings: [{nodeId, target, realisation, config}]`, `scenario.placements: [{nodeId, profileId}]`, `derivations: [{artifact, upstream, hash}]`. The neutrality scan then excludes only the `deployment` subtree. Retargeting stays lossless, because bindings for every target are kept. Arrays also sort canonically for hashing (M6). Cost is about 0.5 pd if done in task 0.2. Done later, it becomes a data migration. |
| **B3** | Blocker | **The document is not self-contained. 26 references point to "as in 0.1", and no 0.1 text exists in the repo.** | `grep "as in 0.1\|from 0.1"` gives 26 hits in `design-v2.md`. A grep for `IAC-E11`, `hclString`, `SPA fallback` over the whole repo finds only `design-v2.md`. Missing, among others: the AWS key arguments and secure defaults (§4.4.5), the access-edge matrix, the IAM and security-group derivation, gate rules IAC-E01..E11 and W01..W09, zip path guard, CSP, STRIDE-lite, rate limits, migrations 005-009, keyboard map, and the wizard-free canvas behaviour. The security-architect and QA cannot review what is not written, and the pd estimates for those items cannot be checked. | Restore the 0.1 sections into v0.3, as an appendix or as `docs/design-v2-aws-adapter.md`. Replace each "as in 0.1" with a section link. Cost is about 0.5 day of SA#1 time. Re-review is a delta. |
| **B4** | Blocker | **The plan does not deliver what v2.1 §3.1 asked for: a Tier-2 minimum releasable build with cut lines.** | **(a)** §5.5 "minimum releasable slice" includes Should or non-required items: 6 target catalogues (Azure, GCP and k8s are Should), multiple scenarios and hybrid packaging (Should), lessons L2/L5/L6/L9 (Should), 20 rules (12 required), ADR auto-drafts (Should), and a rule-based assistant (not in v2.1 at all). **(b)** Contingency is the 4 pd remediation line in 7.6, which is **2.7%** of 147.5 pd. At 4.5 pd per week each engineer is 90% utilised for 17 weeks, while also reviewing golden diffs, supporting content and attending PO sessions. **(c)** The calendar ignores Tết 2027 (Lunar New Year on 2027-02-06). A 3-week slip from 2027-01-22 lands in it. **(d)** The cut levers total 4.5 pd and trigger only on M1. **(e)** The vSphere adapter is first touched in week 9, so the "stable" interface is proven by a second provider only after AWS has hardened it. **(f)** §5.4 calls IaC mapping the long pole, but E1 carries 74 pd of UI-heavy work with more under-estimates (M12, §8). | Adopt the corrected plan in §8. Must-only Tier 2. Explicit 15% contingency. A thin vSphere spike inside Tier 1 (week 5). Rule grammar moved to week 6. The template catalogue UI and editorial UI moved to E2. A cut order with pd values and approvers. Dates that include the year-end and Tết weeks. |

---

## 4. Major findings

| # | Severity | Issue | Evidence / failure scenario | Concrete recommendation |
|---|---|---|---|---|
| **M1** | Major | **The fmt-canonical printer (D-07) is realistic but under-scoped. Its only oracle is the fixtures.** | `terraform fmt` does more than align `=`. It **unwraps interpolation-only strings** (`"${var.x}"` becomes `var.x`), normalises type expressions, and aligns keys inside object and map literals. REQ-IAC-024 applies to **every** user design, not just fixtures. Scenario: a user adds tags whose keys differ in length inside a `tags = {…}` literal, or a realisation emits a `tmpl` node that is a single interpolation. The printer's output is valid HCL but not fmt-canonical, and Dana's pipeline fails on `fmt -check`. Golden files never saw this shape. 3 pd covers the printer, not the proof. | Keep D-07 and constrain the IR. **(1)** The IR never emits a single-interpolation template; `tmpl` with one part collapses to the naked expression. **(2)** No heredocs. No comments inside expressions; comments sit only above blocks. **(3)** Every multi-line value is isolated by blank lines, as the design already says. Object literals get key alignment. **(4)** Add a nightly **fuzz job**: generate 300 random valid designs × 2 adapters, emit, and run the real `terraform fmt -check -diff` plus `validate`. A diff fails the job and writes a minimal reproducer. Re-estimate 1.1 at **4.5 pd** (+1.5). Fallback if the fuzz job finds more than 3 printer classes by week 8: post-format with Go `hclwrite.Format` compiled to WASM, lazy-loaded on the Code tab (see A1). |
| **M2** | Major | **As designed, the zip is not byte-identical across time zones, and it can crash west of UTC.** | `fflate` builds the DOS time with local-time getters (`dt.getFullYear()`, `getHours()`, …) and throws error 10 when the local year is below 1980. Scenario: a "fixed mtime" of `new Date('1980-01-01T00:00:00Z')` becomes 1979-12-31 in UTC-5, so the export throws. A fixed `…Z` date in 2000 gives different bytes in Hanoi (UTC+7) and in CI (UTC). AC-04 passes in CI and fails between two users. Deflate output can also change between fflate versions. | Build the mtime with the **local constructor**: `new Date(2000, 0, 1, 0, 0, 0)`, so the local getters return the same fields everywhere. Pin fflate exactly (0.8.3). Run the determinism suite twice in CI with `TZ=Asia/Ho_Chi_Minh` and `TZ=America/Los_Angeles` and compare SHA-256s. Golden-test the zip bytes, so that a fflate bump is a reviewed diff. About 0.25 pd. |
| **M3** | Major | **Version pinning and "offline" CI are weaker than stated.** | **(a)** `hashicorp/aws ~> 6.0` allows 6.0 through 6.x. The generated package has **no `.terraform.lock.hcl`**, so each user's `init` takes the newest 6.x. Scenario: 6.8x deprecates an argument we emit, and the user's `validate` shows a warning, while our S-1 promises "0 warnings". **(b)** `required_version >= 1.11.0` is never tested at 1.11, because A-6 says CI uses the latest patch (1.16.0 today). **(c)** A-5 depends on registry access. A **plugin cache still contacts the registry** to resolve versions and checksums; only a filesystem mirror is truly offline (R-5 of v2.1). A registry outage turns CI red on unrelated PRs, and an on-prem runner cannot run the job at all. | **(1)** Tighten the pins to `>= 6.66.0, < 7.0.0` and `>= 2.17.1, < 3.0.0`. **(2)** Emit a **static `.terraform.lock.hcl` per adapter version**. Produce it once in CI with `terraform providers lock -platform=linux_amd64 -platform=darwin_arm64 -platform=windows_amd64`, commit it as adapter data, and emit it byte-for-byte. It is deterministic. **(3)** In CI, run `terraform providers mirror` into an Actions cache keyed by the lock hash. Use `provider_installation { filesystem_mirror {…} direct { exclude = ["registry.terraform.io/*/*"] } }` and `plugin_cache_dir` so that 35 folders symlink instead of copying the large AWS binary. **(4)** Matrix: Terraform 1.11.x (floor) and 1.16.x (current). OpenTofu 1.12.x nightly as the Could item (REQ-IAC-029). About 1 pd. |
| **M4** | Major | **The vSphere mapping will pass `validate` but fail at `apply` in common estates. `validate` without a vCenter proves very little here.** | `validate` never reads data sources, so none of these faults show up: **(a) IP addressing is not modelled.** Most server VLANs have no DHCP. Cloned VMs boot without an address, and `wait_for_guest_net_timeout` (default 5 min) makes `apply` hang and then fail. **(b) Template-derived attributes:** `guest_id`, `scsi_type` and `firmware` must come from `data.vsphere_virtual_machine.template`, and a disk smaller than the template's disk fails the clone. Sizing can easily produce a smaller disk. **(c) Edition dependency:** anti-affinity rules are enforced only with DRS, and `vsphere_distributed_port_group` needs a vDS. Both need VVF or VCF, not vSphere Standard or Essentials. **(d)** `vsphere_tag_category` names are global in vCenter, so the second design that creates the same category fails. **(e)** `vsphere.vm_group_minio` is the default on-prem object store, but the MinIO community repo was archived on 2026-02-12 and ships no binaries. | **(1)** Add a per-port-group `ip_mode` (`dhcp` / `static`). For static: `ipv4_addresses` list variables sized to `vm_count`, plus `netmask`, `gateway` and `dns_servers`, emitted as cloud-init `network-config` in `guestinfo.metadata`. Add a VS-E04 error when static is chosen without enough addresses. **(2)** Always set `guest_id`, `scsi_type` and `firmware` from the template data source, and set the OS disk to `max(var.x, template.disks[0].size)`. **(3)** Add a profile option `edition` (`standard` / `vvf_vcf`). On `standard`, anti-affinity and DV port groups become a manual step with VS-W03. **(4)** Tags reference an **existing** category via a data source (default), or use a name prefixed with `project_name`. **(5)** The object-store realisation text becomes "existing S3-compatible service (for example Ceph RGW)". **(6)** Add a nightly `plan` against **vcsim** (the govmomi vCenter simulator, Apache-2.0, in Docker) for the 2 vSphere templates. It exercises data sources and clone arguments that `validate` cannot. About +1.5 pd (IP config and template attributes) and +0.5 pd (vcsim). |
| **M5** | Major | **There is no revision history, so D-16's "users regenerate, which gives the same bytes" is false after any edit. REQ-ART-004, REQ-ART-017 and the audit cannot be met.** | `repositories/designs.py:96-131` is a full replace, and `revision` is only a counter. Scenario: Dana downloads a package at revision 14. A week later a plan fails and Tom asks what was generated. The design is now at revision 40, and revision 14 no longer exists anywhere, so the audit event points to nothing. The same gap means "Requirements sheet changed at revision 7" cannot be shown. | Add a `design_revisions(design_id, revision, graph_json, reason, created_at)` table. Write a row **only** on generate, download, spec export, lesson check and explicit snapshot, not on every autosave. The `iac-event` stores `revision` and the manifest SHA-256. The package banner compares the last generated revision with the current one (REQ-ART-004). This also gives REQ-DES-018 snapshots almost for free. About 1 pd E2. |
| **M6** | Major | **Outdated propagation will produce false positives, and its hash is not specified tightly enough to be stable.** | §4.3.10 hashes whole artifacts. `brief.answers` is upstream of capacity, and capacity is upstream of node sizing. Scenario: a user changes **budget class** or **team skills**, which no formula reads. Capacity goes "outdated", every attached sizing goes stale, and IAC-W04 fires on every node, all within 1 s. That is the fatigue R-18 warns about. Other gaps: "canonical JSON (sorted keys)" does not fix number formatting, Unicode NFC/NFD (macOS can emit NFD Vietnamese) or `undefined` handling. A rule-set or catalogue version bump should also outdate suggestions, but is not an input. REQ-ART-002 "Mark as current" appears only as per-artifact actions. `crypto.subtle` exists only in secure contexts, so over plain-HTTP intranet access hashing is `undefined` and propagation dies silently. | **(1)** Define one **projection function per edge** of the dependency graph (for example `capacityInputs(answers)` = the 7 fields the engine reads), and version it (`hashVersion`). **(2)** Canonicalise with RFC 8785 (JCS), with strings NFC-normalised first. **(3)** Add `ruleSetVersion` and `catalogueVersion` as upstream inputs of suggestions and bindings. **(4)** Add a universal "Mark as current" that re-records hashes. **(5)** Use a pure-JS SHA-256 (`@noble/hashes`, MIT, synchronous, same bytes in Node). **(6)** Add a test table of edits that must **not** outdate anything: move, relabel, rationale, ADR text, non-capacity answers. About +0.5 pd. |
| **M7** | Major | **"No silent drops" is enforced only for nodes. Edges, attributes and unknown realisations can still drop or change silently.** | **(a)** Edges are absent from the coverage invariant (S-4), although REQ-ADP-004 names them. **(b)** Neutral config that a realisation does not consume is silently ignored. Example: `backupRetentionDays: 7` on a database realised as `vsphere.vm_pair_postgres` produces nothing, and nothing tells the user. **(c)** Resolution step 2 uses `node.realisations[target] ?? catalogue default`. Scenario: catalogue 1.1 renames `aws.rds` to `aws.rds_instance`. An old design's stored id no longer resolves, and it is either treated as absent (so it **silently falls back to the default**, changing the generated infrastructure) or it crashes. | **(1)** `COVERAGE.md` and the report get one row per edge: `access` edges are generated or manual (firewall request); `flow` edges are "no code (visual)"; cross-target edges are manual. **(2)** Each realisation declares `consumes: [fieldKey]`. Any non-default neutral field not consumed produces an info row: "`backupRetentionDays=7` not expressed on `vsphere.vm_pair_postgres`; see manual step". **(3)** An unknown stored realisation id resolves to `unsupported` with **TGT-E01 "unknown realisation"**. It never falls back silently. Catalogues carry `aliases` for renames. **(4)** Extend the property test to random designs × targets × catalogue versions, asserting node, edge and non-default-attribute accounting. About +1 pd. |
| **M8** | Major | **The taxonomy and catalogue scope is too large for v1, and the catalogue work is badly under-estimated.** | About 40 roles × 6 targets is about 240 (role, target) cells, each needing labels, fields, a coverage class, sizing hints and manual-step text. T.1 budgets **3 pd**, which is about 6 minutes per cell. The manual steps *are* the on-prem deliverable (C-13, R-16), so thin text there means a thin product. v2.1 makes only aws, vsphere and bare_metal Must (REQ-TGT-001/002). The taxonomy is coherent for on-prem: SAN, NAS, appliances and switches as roles, and appliance-versus-software as a realisation, is the right split. The problem is breadth, not shape. | **v1 palette** = the 29 v2.1 Must roles plus the 3 roles the Must wizard rules need (B1): `key_management`, `siem_log_store`, `artifact_registry`. That is 32. Should roles are data added in v1.1. **v1 catalogues** = aws, vsphere, bare_metal. Azure, GCP and k8s_onprem move to v1.1 (they are text-only anyway). Re-estimate T.1 at **8 pd**: C and Q 5 pd, the on-prem SME 2 pd, E1 1 pd. Implement all on-VM realisations (postgres, redis, rabbitmq, kafka, haproxy) as **one generic `vm_group` generator** parameterised by catalogue data (NFR2-EXT-002). |
| **M9** | Major | **The SPA fallback and the CSP are named but not specified, and the obvious implementations break things.** | `main.py:241-243` mounts `StaticFiles(html=True)` at `/` with no fallback, so `/designs/abc` gives 404 today. A naive catch-all creates two failures. **(a)** `/api/unknown` returns `index.html` with status 200, which breaks the JSON error-envelope contract (`test_contracts.py` checks error shapes). In production `/api/docs` is disabled (`main.py:147`), so it would also return HTML. **(b)** After a deploy, an old tab requests `/assets/index-OLD.js`. The fallback returns HTML, `nosniff` blocks it, and the user sees a blank app. On CSP (none today, `main.py:37-41`): Shiki's default Oniguruma engine needs `'wasm-unsafe-eval'`; Shiki emits inline `style=` attributes; `html-to-image` needs `data:` and `blob:` in `img-src`; the zip download needs `blob:`. | The fallback serves `index.html` **only** for `GET`/`HEAD`, only when the path does not start with `/api/` or `/assets/`, and only when `Accept` includes `text/html`. Everything else gets the JSON 404 envelope. `index.html` gets `Cache-Control: no-store`; hashed assets get `immutable, max-age=31536000`. CSP: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`. Use Shiki's JavaScript regex engine to avoid WASM. Add a Playwright test that fails on any `securitypolicyviolation` event, and pytest cases for `/api/nope` (JSON 404) and `/assets/missing.js` (404, not HTML). About 0.5 pd on top of task 0.5. |
| **M10** | Major | **Generated-code safety is proven only on fixtures. User-entered strings and secrets reach the package untested.** | **(a) HCL interpolation injection:** a label, tag, description or datacenter name containing `${file("~/.aws/credentials")}` or `%{…}` is **evaluated in the user's CI** if unescaped. The value can land in resource tags and in `plan` output, exfiltrating runner files. This matters because templates and patterns are authored content, and team templates (Should) come from colleagues. **(b) Pipeline YAML:** any label placed in a workflow `name:` or `run:` line enables `${{ … }}` expression injection on GitHub. **(c) Secrets typed into free fields:** NFR2-SEC-001 scans **fixtures** in CI, but a user who pastes an access key into a description ships it. IAC-E06 covers only fields flagged as secret. | **(1)** Put `hclString()` escapes (`$${`, `%%{`, `\"`, `\\`, control characters) under a property test with a hostile-string corpus. Assert with real `terraform console` in the nightly fuzz job that the decoded value equals the input. **(2)** Pipeline files use only `codeName` (pattern-restricted) and fixed text. Never labels. **(3)** Before download, run a **browser-side secret lint** over every emitted file: AWS key ids, private-key headers, `password\s*=\s*"[^"]` literals, JWTs. A high-confidence hit **blocks** download with rule IAC-E12. About 1 pd. |
| **M11** | Major | **Bundling the realisation catalogues conflicts with "no code release" for data (NFR2-EXT-003, REQ-TGT-011). Hot-loading them would break determinism.** | §4.3.5 bundles `src/domain/targets/catalog/<target>.json` into the SPA, so adding a realisation needs an image rebuild. The design itself says a catalogue default change is an adapter version bump (§4.3.4), which is correct. If catalogues were imported at runtime instead, the same adapter version could emit different code, breaking NFR2-DET-001. | Ask the BA to amend NFR2-EXT-003 as follows. Catalogues **of shipped adapters** are versioned with the adapter: a data-file change plus a container rebuild, with no code edit. Descriptive-only target catalogues (manual text) may be imported from the content volume. The design states this explicitly. No engineering cost. |
| **M12** | Major | **The content and SME load is under-counted, and two hidden dependencies make the content track near-critical.** | C is budgeted 29.75 pd at 50% over 17 weeks (capacity about 42 pd), described as "5 weeks of slack". Not counted: realistic catalogue text (+5 pd, M8), wizard rules and question catalogue in VI and EN with defaults and help (about 2.5 pd), lesson check specs and reference solutions, and template ADR text. The slack disappears. **Hidden dependency 1:** C.3 authors the 12 pattern graphs in weeks 2-7, but the role ids will change (B1). Unless the catalogue freezes at the end of week 1, patterns get re-authored. **Hidden dependency 2:** C.4 writes L3/L4 `canvas_rule` checks in weeks 8-10, but W.1 (the predicate language) lands in weeks 11-14, so the check specs are written against a grammar that does not exist yet. **Unowned:** vSphere manual steps, the vCenter privilege list and hardware checklists need an on-prem SME. Nobody in the team table (§2.4 A-1) is one. | Freeze catalogue v1.0 and contract v2 at the **end of week 1**. Move the **rule-grammar spec (0.5 pd) and engine (W.1) to week 6**. Name Infra Ian (or equivalent) as SME for 3 pd across weeks 3-9. Cut the Should lessons (L2, L5, L6, L9) from v1 to give C back about 6 pd. Keep G3 (PO and Q) independent from C. |

---

## 5. Minor findings

| # | Severity | Issue | Recommendation |
|---|---|---|---|
| m1 | Minor | Stale facts. CI already lives in this repo (`.github/workflows/ci.yml` exists, header "repo root = this folder"), so task 0.1 is half done. `package.json` pins React as `"latest"` (now 19.x), while the design says React 18. The current Terraform is 1.16.0. | Correct §2.3, 0.1 and §4.6. Pin React 19.x exactly with the rest. |
| m2 | Minor | `archGraph = oneOf [v1, v2]`: jsonschema checks both branches (double cost on each 1.5 s autosave) and returns "not valid under any of the given schemas". Closed `brief` objects mean a new wizard question needs a contract release. | Use `if/then` on `schemaVersion`. Make `brief.answers` an open map of scalars with camelCase keys, validated in TS against the question catalogue. |
| m3 | Minor | The 1 MiB cap is safe for graphs but not for ADRs. 200 decisions × about 4 KB of VI text (3 bytes per diacritic character) is about 800 KB. There is no HTTP body guard (build-scope §7.2 3c). | Set `maxLength` 4,000 per ADR text field and cap decisions at 100. Show a size meter at 70%. Add an ASGI body guard at 1.5 MiB. |
| m4 | Minor | VI slug bug: `đ`/`Đ` does not decompose under NFD. "Đơn hàng" becomes `Đon_hang`, which fails `^[a-z]…` and gives IAC-E04 or an empty codeName. | Map `đ→d` and `Đ→D` explicitly before stripping marks. NFC-normalise labels on input. Add fixture tests. |
| m5 | Minor | One zundo history spans canvas, brief answers and ADR text. Pressing Ctrl+Z on the canvas can undo an ADR paragraph typed in between. | Use one undo scope per surface (canvas, brief, decisions), or exclude text fields from the canvas stack. |
| m6 | Minor | There are three target vocabularies: `model.ts`/`schemas.py` (`vmware`, `kubernetes`, `on_premises`, `hybrid`), the design (`vsphere`, `kubernetes`), and v2.1 (`vsphere`, `k8s_onprem`). "hybrid" is a scenario, not a target. | Add one mapping table and a migration for `workspaces.deployment_target`. Legacy designs migrate with **no** deployment (B1g). |
| m7 | Minor | Layering cycle. Lint rules live in `graph/` and use `rules/`, while `rules/` predicates `iac_error_free` and `coverage_at_least` import `iac/` and `targets/`, which import `graph/`. | Make the rule engine take an injected predicate registry. Only lessons register the IaC predicates. |
| m8 | Minor | Client-reported events (`POST /api/events`, `iac-events`) have no stated schema, size or rate limit. REQ-IAC-022 (Must) is skipped silently if the POST fails, for example offline. | Use a closed event-type enum, a 4 KB body cap, 60 per minute per user, and 180-day retention. The download starts only after the audit POST succeeds, or after it is queued and retried with a visible "audit pending" note. |
| m9 | Minor | The `IacAdapter` interface lacks `validationCommands`, `supportedFailureDomainLevels`, `pipelineTemplates` and a variable schema (REQ-ADP-001, 010, 011). | Add them as readonly fields. The CI harness reads `validationCommands`, so a new adapter cannot skip its gate (REQ-ADP-006). |
| m10 | Minor | Default realisation text leans on licence-shifting products. MinIO is archived (M4). Redis changed licences twice. | Catalogue text reads "Valkey or Redis" and "existing S3-compatible storage". No product is implied as endorsed. |
| m11 | Minor | Design documents hold infrastructure reconnaissance data (vCenter hostnames, datacenter and cluster names, CIDRs) in SQLite and its backups. | Classify designs as Internal-Confidential. Keep backups on an encrypted volume. Say so in the runbook. |
| m12 | Minor | Terraform licensing is unstated for users. BUSL-1.1 permits running Terraform in internal CI, and ArchPilot never embeds or hosts Terraform (NG-1, and the runtime image has none), so we are clean. Users' pipelines may run OpenTofu. | Add one sentence to §8. Add a nightly OpenTofu 1.12 `validate` (Could, REQ-IAC-029). The `use_lockfile` S3 locking works in OpenTofu 1.10+ too. |

---

## 6. Proposed alternatives

1. **HCL output: four options compared (A1).**

   | Option | Verdict | Why |
   |---|---|---|
   | Constrained TS printer, plus a nightly fuzz job against the real `terraform fmt` (M1) | **Recommended** | Deterministic, synchronous, small, and runs in the browser and in Node. The real formatter is the oracle over random designs, not only fixtures. |
   | TS printer without alignment, then Go `hclwrite.Format` compiled to WASM (about 2-3 MB, lazy) | Fallback | Uses the formatter's own code for alignment. It does not apply fmt's extra normalisations (interpolation unwrap), so the IR rules are still needed. Bundle weight and a CSP `'wasm-unsafe-eval'`. |
   | Emit unformatted HCL and rely on golden files | Reject | Golden files only protect fixtures. REQ-IAC-024 applies to every generated package, and Dana's `fmt -check` would fail on real designs. |
   | Emit `*.tf.json` (no printer) | Reject | `terraform fmt` ignores JSON files, so the check passes on a technicality. It is hard to review in PRs (Dana persona), and JSON strings are still templates, so escaping is still needed. |
   | CDKTF | Reject | Archived on 2025-12-10; no further fixes. |

2. **Deployment data shape (A2).** `deployment.profiles[]`, `deployment.bindings[{nodeId, target, realisation, config}]`, `deployment.scenarios[{id, defaultProfileId, placements[{nodeId, profileId}]}]`. Nodes stay neutral (B2). The camelCase contract holds. Retargeting stays lossless. Hybrid is a later UI over the same data.

3. **Coverage presentation (A3).** Use a 3-value `badge` (`generatable`, `manual`, `unsupported`) plus a `detail` (`partial`, `implicit`, `reference`) and a note. The report classes are those plus `annotation` and `assigned_to_other_target`. This meets v2.1 and US-D2 exactly and keeps D-05's honesty.

4. **Revision pinning (A4).** Pin revisions on generate, export, check and snapshot, not on every autosave (M5). Storage stays small, and audit, REQ-ART-004 and snapshots all work.

5. **vcsim nightly plan (A5).** The cheapest real evidence for the on-prem adapter short of a lab vCenter (M4). Keep the manual sandbox `plan` per template (R-02) as the release gate.

6. **One active target in the v1 UI (A6).** Hide "scenario" from users in v1. The inspector says "Runs on: DC1 vSphere". Per-node override, several scenarios and multi-folder hybrid zips ship in v1.1 with no data migration.

---

## 7. What's good (credit where due)

- **The three-layer model and the resolution algorithm are genuinely good.** In particular, "if the adapter is not registered, `full`/`partial` are downgraded to `manual`" (§4.3.5 step 3) makes coverage honest by construction. That is an invariant, not a checklist.
- **Placement in scenarios, not on nodes (D-04)** is the right instinct for lossless retargeting. My B2 finishes the job rather than reversing it.
- **Manual steps derived from access edges** ("Allow tcp/5432 from app_tier to data_tier") are the most valuable on-prem feature in the document. They turn "manual" from a shrug into a firewall request an infrastructure team can action.
- **Requirement conflicts found by #1 are real and well argued.** C-v2-5 (dividing replicated storage by the replication factor before it becomes a per-instance disk) prevents a 2-3x over-provisioned database. C-v2-4 (`use_lockfile` GA in 1.11) is correct. C-v2-2 (Fargate needs egress through NAT) is correct. C-v2-1 (manifest fingerprint instead of revision) is correct and is completed by M5.
- **Verified facts are accurate.** `vmware/vsphere` 2.17.1 on 2026-09-14 and the `vmware/` namespace check out. AWS 6.66 exists. MIT licences for `@xyflow/react` and `fflate` check out.
- **One rule engine for wizard, lessons and lint (D-10)**, rules as data with a trigger and non-trigger test per rule, and suggestions that never auto-edit the canvas: all correct.
- **The weakest-points section (§6)** is honest again. Points 1-3 match what I would have raised.
- **FinOps on CI minutes (§8)** is concrete and gives the cheaper option: path filters or a self-hosted runner.

---

## 8. Final converged recommendation

### 8.1 Ships as designed (no change)

| Item | Why |
|---|---|
| D-01 TS generators in browser and Node CI | One implementation of resolution, coverage, rules and generators. Apply the fixes in M2, M5, M6 and M10. |
| D-02 three layers | This is the PO's model, and it is structurally honest. |
| D-03 component catalogue as shared data | Right. Membership checked in Python as well. |
| D-06 adapters, Terraform AWS plus Terraform vSphere, stub Ansible | Right choice for v1, conditional on Q-19 confirmation. |
| D-09 edge kind and mode | Clear semantics. It also feeds the edge coverage rows (M7). |
| D-10 one rule engine | Yes. Inject predicates (m7). |
| D-12 content as files plus an import CLI; D-13 client-side checks; D-16 nothing generated stored server-side | Right for 2-4 trusted users. |

### 8.2 Must change before approval (Blockers, about 2 pd of SA and engineering time in week 1)

1. **B1**: reconcile with v2.1 in design v0.3 (0.5 day SA#1 + BA).
2. **B2**: move realisations and all data-keyed maps into `deployment` arrays (0.5 pd, inside task 0.2).
3. **B3**: restore the 0.1 sections (0.5 day SA#1).
4. **B4**: adopt the corrected plan below.

### 8.3 Should change (Majors, about 8 pd, already inside the corrected plan)

M1 printer constraints plus fuzz (+1.5). M2 timezone-safe zip (0.25). M3 lock file, mirror, version matrix (1). M4 vSphere IP and template attributes, edition, tags, vcsim (+2). M5 revision pinning (1). M6 hash projections, JCS, pure-JS hash, "Mark as current" (0.5). M7 edge, attribute and unknown-realisation coverage (1). M8 reduced palette and catalogues, generic `vm_group` (net saving). M9 fallback and CSP specification (0.5). M10 escaping property tests and browser secret lint (1). M11 BA amendment (0). M12 freeze, re-sequencing, SME (0 engineering).

### 8.4 Deferred to v1.1 (moved out of #1's "minimum" slice)

| Deferred | Reason | Saves |
|---|---|---|
| Rule-based assistant (2.10) | Not in v2.1 | 2.5 pd E1 |
| Azure, GCP and k8s_onprem catalogues | Should (REQ-TGT-001/002) | 1 pd E1 + 1 pd Q |
| Several scenarios, per-node override UI, hybrid multi-folder packages, cross-profile rules, hybrid E2E | Should (REQ-TGT-003 override, REQ-IAC-027). The data shape stays (A6). | 4 pd |
| ADR auto-drafts (suggestion, realisation) | Should (REQ-ART-007). Template ADRs and manual ADRs stay. | 1.5 pd |
| Lessons L2, L5, L6, L9 | Should. Frees about 6 pd of C for catalogues. | 6 pd C |
| Wizard rules beyond 12 | 12 is the Must minimum | 1 pd |
| Snapshots UI, PNG export (SVG satisfies REQ-DES-013) | Should or optional | 1 pd |
| vSphere DV port-group creation, tags | Should rows; edition-dependent (M4) | 0.5 pd |

### 8.5 Corrected minimum-releasable plan (Tier 2 = v2.1 Must only)

**Effort.** #1's 147.5 pd, minus 13 pd of cuts (§8.4, engineering part), plus 12.5 pd of under-estimates and fixes. The fixes are: printer +1.5, containers +2, undo and autosave +1, wizard UI +2, vSphere +2, CI pins and mirror +1, revisions +1, coverage +1, reconciliation refactor +1. That gives **about 147 pd of work**. Add **15% contingency (22 pd)**, for **about 169 pd**. The productivity assumption stays at #1's 4.5 pd per engineer per week.

**Tiers and milestones (2-engineer baseline, week 1 = 2026-09-28).**

| Tier / milestone | Week | Exit criterion |
|---|---|---|
| Freeze | end wk 1 | Design v0.3 approved; catalogue v1.0 (32 roles, v2.1 ids) and contract v2 (bindings arrays) frozen; CI mirror job green |
| **Tier 1 / M1** | end wk 5 | Three-tier template on AWS: generate, zip, then `fmt`/`init`/`validate` green on TF 1.11 and 1.16. **vSphere spike**: VM plus data sources for the same template's app tier is green. Canvas shows nodes, edges, basic containers and target badges from the coverage query. |
| Rule grammar | wk 6 | Predicate spec and engine (W.1) merged; C writes L3/L4 checks against it |
| **M2 internal pilot** | end wk 11 | Canvas complete (containers, inspector, undo, autosave, Problems, export); AWS complete with gate and pipelines; vSphere Must rows with IP config and manual steps; 5 templates (2 on vSphere) green; sizing attach |
| M3 feature complete | end wk 17 | Wizard (7 steps, 12 rules), outdated propagation, manual ADRs, Markdown spec, hub (12 patterns), editorial gate, lessons L1/L3/L4, revision pinning |
| G3 audit, hardening | wk 18-19 | a11y, i18n parity, E2E J0-J7, k6, remediation from contingency |
| **Release** | end wk 19 | **2027-02-19**, counting one year-end week and one Tết week off |

**With E3 from week 2** (recommended): about 15 working weeks, so release on **2027-01-15**, before Tết.

**Critical path.** It is the **E1 user-interface chain**: catalogue and contract freeze (wk 1), then canvas containers and inspector (wk 2-9), then the target tab, Code tab and export (wk 10-11), then sizing attach (wk 12), then wizard, outdated propagation and ADR (wk 13-15), then the hub UI (wk 16), then the lesson player (wk 17), then a11y and E2E (wk 18-19). After the cuts, E2's IaC chain has about 1.5 weeks of float. Use that float by moving the **template catalogue UI (2.5 pd) and editorial UI (2.5 pd) to E2**. Content is near-critical: patterns depend on the week-1 freeze, and lessons depend on the week-6 grammar.

**Cut order if Tier 2 slips** (most expendable first; not cuttable: the per-adapter CI gate, coverage flagging including edges, determinism, no secrets, legacy load, owner-only access):

| # | Cut | Saves | Approver |
|---|---|---|---|
| 1 | Per-target sizing-hint block and inventory totals (design extras beyond REQ-ART-005) | 1.5 pd | SA |
| 2 | vSphere Should rows other than anti-affinity (folder, separate virtual-disk resource) | 1 pd | SA |
| 3 | Colour-by-target, `Alt+n` view shortcuts, focus mode | 1 pd | SA |
| 4 | Editorial UI reduced to checklist, publish, unpublish and takedown; edits via files and import | 1.5 pd | PO |
| 5 | Wizard review step and MoSCoW list (Should) | 1 pd | PO |
| 6 | Templates 5 to 4 | 0.5 pd + content | PO |
| 7 | Hub patterns 12 to 8 (changes decision 1) | about 4 pd C | PO |
| 8 | **Last resort (needs PO re-scope of a v2.1 Must):** vSphere adapter to v1.1; on-prem ships as catalogue, badges, `MANUAL-STEPS.md` and spec | about 10 pd | PO |

**Gates.** If M1 slips past week 6, apply cuts 1-3 at once. If M2 slips past week 12, take cuts 4-7 to the PO. Cut 8 is a PO decision only.

---

## 9. Open questions for humans

1. **PO:** Fund E3 from week 2 (release 2027-01-15), or accept 2027-02-19 with 2 engineers? A date inside Tết is not an option.
2. **Infra Ian / PO (week 1):** Is the on-prem platform still VMware vSphere? Which edition: Standard, VVF or VCF? Is there DHCP on server VLANs? The answers decide M4's defaults, and whether the vSphere adapter is worth building at all (Q-19).
3. **BA:** Accept the v2.1 amendments: role promotions for the Must wizard rules (B1), NFR2-EXT-003 wording for adapter-coupled catalogues (M11), Q-25 backend defaults without MinIO (M4), and new rule ids IAC-W10/W11, IAC-E12, TGT-E01, VS-E04, VS-W03.
4. **PO:** Confirm v1.1 for per-node override and hybrid UI (Should) while keeping the data shape now (A6).
5. **Security-architect:** Accept the CSP in M9, and the browser secret lint blocking download (M10)?
6. **Who is the on-prem SME** for the vSphere manual steps and privilege list (M12)? About 3 pd across weeks 3-9.

---

## 10. Next handoff

| Agent / role | What they need from this review |
|---|---|
| **solution-architect-1** | Issue v0.3: B1 reconciliation, B2 data shape (§6 A2), B3 restored sections, B4 plan (§8.5). Update the decision log: D-04 modified, D-05 modified (A3), D-07 constrained plus fuzz, D-15 local-time mtime, D-16 plus revision pinning. Re-review is a delta. |
| **ba-qa-analyst** | Amend v2.1 per §9 Q3. Add tests: TC-DET-TZ (zip SHA in two time zones), TC-COV-EDGE (edge rows), TC-COV-ATTR (unconsumed attributes), TC-COV-UNKNOWN (renamed realisation), TC-ART-NOISE (edits that must not outdate), TC-NEUT on templates without deployment, TC-SPA-404 (`/api/nope` JSON, `/assets/missing.js` 404). |
| **devops-master** | Filesystem mirror plus lock files, TF 1.11/1.16 matrix, nightly fuzz, vcsim plan, OpenTofu nightly, TZ matrix, path filters (M1, M2, M3, M4). |
| **security-architect** | CSP (M9), HCL and YAML injection corpus and secret lint (M10), vCenter credential guidance (Q-12), event hygiene (m8), data classification (m11). |
| **dba-master** | `design_revisions` table and retention (M5), body guard and ADR bounds (m3), `workspaces.deployment_target` migration (m6). |
| **Product Owner** | Answer §9 Q1, Q2 and Q4 in week 1. Q2 decides whether the second adapter is worth building. |

**Verdict: Approve-with-changes** — 4 Blocker, 12 Major, 12 Minor.

---

### Sources (checked 2026-09-24)

- [vmware/terraform-provider-vsphere releases (v2.17.1)](https://github.com/vmware/terraform-provider-vsphere/releases) · [vmware/vsphere on the Terraform Registry](https://registry.terraform.io/providers/vmware/vsphere/latest)
- [hashicorp/terraform releases](https://github.com/hashicorp/terraform/releases) · [Terraform CHANGELOG](https://github.com/hashicorp/terraform/blob/main/CHANGELOG.md)
- [terraform-provider-aws v6.65.0](https://github.com/hashicorp/terraform-provider-aws/releases/tag/v6.65.0) · [provider releases](https://releases.hashicorp.com/terraform-provider-aws/)
- [Terraform CLI config: provider_installation / filesystem mirror](https://terraform.io/cli/config/config-file) · [HashiCorp: local mirror for systems without internet](https://support.hashicorp.com/hc/en-us/articles/23562100651923-How-to-use-Terraform-CLI-with-Local-Mirror-for-Provider-Plugins-for-system-without-internet-access) · [plugin cache still resolves via registry](https://oneuptime.com/blog/post/2026-02-23-how-to-use-terraform-with-provider-plugin-cache/view)
- [terraform fmt: unwrap interpolation-only expressions (commit ff0dbd6)](https://git.weko.io/resilien/terraform/commit/ff0dbd621553e54fab0a55de564bd1a8b023dd69)
- [HashiCorp licensing FAQ (BUSL internal use)](https://www.hashicorp.com/en/license-faq)
- [OpenTofu v1.x compatibility promises](https://opentofu.org/docs/language/v1-compatibility-promises/) · [OpenTofu release notes](https://releasebot.io/updates/opentofu)
- [CDKTF deprecation (env zero)](https://www.envzero.com/blog/another-one-bites-the-dust-what-the-cdktf-deprecation-means-for-you) · [hashicorp/terraform-cdk](https://github.com/hashicorp/terraform-cdk)
- [xyflow LICENSE (MIT)](https://github.com/xyflow/xyflow/blob/main/LICENSE) · [fflate on npm](https://www.npmjs.com/package/fflate) · [fflate source (zip DOS time uses local getters)](https://github.com/101arrowz/fflate)
- [MinIO stops distributing binaries and images](https://gigazine.net/gsc_news/en/20251023-minio-stops-distributing-free-docker-images/) · [MinIO repository archived](https://blog.vonng.com/en/db/minio-resurrect/)

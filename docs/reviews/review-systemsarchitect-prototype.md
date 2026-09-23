# Red-Team Review — SystemsArchitect Prototype Architecture & Design

| Field | Value |
|---|---|
| Title | Red-Team Challenge of the SystemsArchitect Prototype Design |
| Author | Solution Architect #2 (Red Team / Challenger) |
| Date | 2026-09-23 |
| Version | 1.0 |
| Doc reviewed | `docs/architecture/systemsarchitect-prototype-design.md` v0.1 (Solution Architect #1) |
| Requirements reviewed | `docs/requirements/systemsarchitect-requirements.md` v0.1 (BA/QA) |
| Verdict | **Approve-with-changes** — sound architecture, four cheap-but-mandatory fixes, one scope cut, one schedule re-baseline |
| Finding counts | **4 Blocker, 12 Major, 9 Minor** |

---

## 1. Executive summary

### English

Architect #1's design is good and I approve the shape of it. The single shared
`ArchGraph` schema (D1) is the best idea in the document, the single-container
call (D2) is right for a 2-engineer prototype, the "no agent framework" call
(D10) is correct YAGNI, and the weakest-points section is unusually honest. I
am not asking for a redesign.

I am asking for four fixes, and they cluster around one theme: **several
controls in this design are gestures that look like invariants.** The legal
gate approves a pattern *ID*, not its *content* — so any edit, or any schema
migration, silently keeps an approval attached to text nobody reviewed. The
seed script and the admin UI create two sources of truth for pattern content,
and re-running the seed can resurrect a taken-down pattern, which is exactly
the NFR-LEGAL-002 failure the design claims to prevent. The sizing engine's
"we always show the formula" is a *transparency* control, not a *correctness*
control — and the formulas as written have four real defects (replication is
applied to storage but not to write throughput, one `perNodeCapacity` cannot
consume the design's own dual read/write benchmarks, no compression term, no
failure-domain spare), so the calculator will over-state storage and
under-state database nodes while showing a confident formula either way. And
the FTS5 index is declared as an external-content table with no sync triggers
and no `status='published'` re-filter, so search will be stale and can surface
draft, legally-unreviewed titles.

On Architect #1's five self-flagged risks: I **agree** on D2 and D10, **agree
but strengthen** on the content track (it is not actually parallel — diagram
authoring depends on a canvas that does not exist until week 4), **modify**
D7 (DB-as-store is right; the unmanaged Git copy is the problem), **disagree**
on D9 (defer the LLM re-rank: at a corpus of 18 patterns an LLM buys almost
nothing and costs an entire guardrail, procurement and spend-cap apparatus),
and **disagree** on the estimate (57 pd / 9 weeks carries roughly zero buffer;
re-baseline to ~72–78 pd / 12 weeks or cut scope now, before the PO commits).
Every blocker fix is half a person-day or less.

### Tiếng Việt

Thiết kế của Kiến trúc sư #1 là tốt và tôi chấp thuận cấu trúc tổng thể. Lược
đồ `ArchGraph` dùng chung (D1) là ý tưởng hay nhất trong tài liệu, lựa chọn
một container duy nhất (D2) là đúng cho một prototype 2 kỹ sư, quyết định
"không dùng agent framework" (D10) là YAGNI chính xác, và mục "các điểm yếu"
trung thực một cách hiếm thấy. Tôi không yêu cầu thiết kế lại.

Tôi yêu cầu bốn sửa đổi, và chúng đều xoay quanh một chủ đề: **một số cơ chế
kiểm soát trong thiết kế này chỉ là hình thức nhưng được trình bày như bất
biến.** Cổng pháp lý phê duyệt theo *ID* của mẫu, không theo *nội dung* — nên
bất kỳ lần chỉnh sửa hay migration lược đồ nào cũng âm thầm giữ nguyên phê
duyệt cho văn bản mà không ai rà soát. Script seed và giao diện admin tạo ra
hai nguồn chân lý cho nội dung mẫu, và chạy lại seed có thể khôi phục một mẫu
đã bị gỡ bỏ — đúng là kịch bản NFR-LEGAL-002 mà thiết kế tuyên bố ngăn chặn.
Nguyên tắc "luôn hiển thị công thức" của máy tính ước lượng là kiểm soát về
*tính minh bạch*, không phải về *tính đúng đắn* — và các công thức hiện tại có
bốn lỗi thực sự (hệ số replication áp cho dung lượng nhưng không áp cho
throughput ghi; một giá trị `perNodeCapacity` duy nhất không thể dùng được hai
mốc đọc/ghi mà chính tài liệu đưa ra; thiếu hệ số nén; thiếu dự phòng cho sự
cố), nên công cụ sẽ ước lượng thừa dung lượng và thiếu số node cơ sở dữ liệu,
trong khi vẫn hiển thị một công thức trông rất tự tin. Ngoài ra, bảng chỉ mục
FTS5 được khai báo dạng external-content nhưng không có trigger đồng bộ và
không lọc lại `status='published'`, nên tìm kiếm sẽ lỗi thời và có thể lộ tiêu
đề các bản nháp chưa qua rà soát pháp lý.

Về năm rủi ro mà Kiến trúc sư #1 tự nêu: tôi **đồng ý** với D2 và D10, **đồng
ý nhưng nhấn mạnh hơn** về luồng nội dung (thực chất nó không chạy song song —
việc vẽ sơ đồ phụ thuộc vào canvas chưa tồn tại trước tuần 4), **điều chỉnh**
D7 (lưu trong CSDL là đúng; vấn đề là bản sao trong Git không được quản lý),
**không đồng ý** với D9 (hoãn phần LLM xếp hạng lại: với kho chỉ 18 mẫu, LLM
mang lại rất ít giá trị nhưng kéo theo toàn bộ hệ thống guardrail, mua sắm dịch
vụ và giới hạn chi phí), và **không đồng ý** với ước lượng (57 người-ngày / 9
tuần gần như không có vùng đệm; nên tái lập kế hoạch ~72–78 người-ngày / 12
tuần hoặc cắt phạm vi ngay bây giờ, trước khi cam kết với chủ sản phẩm). Mọi
sửa đổi ở mức Blocker đều tốn nửa người-ngày hoặc ít hơn.

---

## 2. Direct verdicts on Architect #1's five self-flagged risk areas

| Area | #1's position | My verdict | Reasoning (short) |
|---|---|---|---|
| **D2** — single deployable container | Right for a prototype; will need Postgres + second instance if adopted | **Agree, with one correction** | Correct call. But the availability arithmetic is wrong-ish: 99.5%/month = 3.6 h budget, stated RTO is 2 h, and a single container has no rolling deploy — so *one* restore event plus normal deploys consume the whole budget. Either state 99.0% for the prototype, or declare a maintenance window that is excluded from the SLO. The real defect is not the topology, it is the backup (see **B4**). |
| **D7** — patterns in DB, not Markdown-in-Git | DB, for NFR-EXT-001 + runtime takedown | **Modify — the dichotomy is false and the design already has both** | DB-as-runtime-store is correct and I keep it. But §3.6 ships `content/patterns/` **and** `scripts/seed-patterns.ts`, so from day one there are two sources of truth, and the seed script is a live path to overwrite reviewed content or resurrect a taken-down pattern (**B2**). Fix: DB is authoritative after seed; seed becomes import-once and idempotent; add a one-way nightly export to Git as an audit/disaster copy. |
| **D9** — co-pilot: 2 skills, flagged, in MVP | Build it, flagged off, decide at launch | **Disagree on skill 1; modify skill 2** | Retrieval quality is a function of corpus size. At **n=18** a tagged filter plus FTS5 already answers "find the right pattern"; an LLM re-rank over 18 items buys marginal relevance while importing an external vendor, a procurement/data-residency decision (still open as Q5), rate limits, token caps, spend caps, prompt logging and a hallucination surface (**M3**). Defer skill 1 to Phase 2, gated on corpus > 40 patterns. Ship skill 2 as **pure deterministic rules with no LLM** — the design itself says the LLM only rewrites wording, which is ~10% of the value for 100% of the dependency. Net MVP saving: ~4 pd, one vendor, and the only variable-cost line in the FinOps table. |
| **D10** — no agent framework, ~200-line loop | Correct not-yet, adopt LangGraph when a real second agent appears | **Agree, unreservedly** | One agent, three tools, one-shot request. LangGraph/CrewAI would be pure ceremony. Only ask: put the loop behind a single `AssistProvider` interface (~20 lines) so the later swap is a file, not a refactor. This is the best-argued decision in the document. |
| **Content track as the critical path** | Yes, it is the tightest constraint; R4 = High likelihood / **Medium** impact | **Agree on the diagnosis, disagree on the severity and the plan** | Impact is **High**, not Medium: the content track's output *is* MVP AC 3 and AC 4, and it is the only work that cannot be recovered by working a weekend. Worse, the track is **not actually parallel**: step 4.2 requires authors to "draw our own `ArchGraph` diagram", but the canvas is not usable until Phase 1 ends (~week 4) and the admin editor not until week 6, so 9 pd of content is squeezed into weeks 4–6, not 1–6 (**M4**). Also Q (0.5 FTE) owns G1 review, all test plans, the usability test *and* the G3 audit — a single-person bottleneck with a role conflict. |
| **~57 pd / 9 weeks** | Stated as the plan | **Disagree — optimistic by ~25–40%** | 57 pd over 2 engineers = 28.5 pd each in a 9-week window, i.e. ~63% utilisation assumed with **zero** allowance for PR review, gate waits, rework from this review, holidays, or usability-test remediation (the plan ends at sign-off with no fix budget). Specific thin items: Entra ID OIDC end-to-end in 1 pd (step 1.4) against a dependency #1 himself rates R10 "blocks all auth"; a full accessibility pass including **keyboard navigation on a graph canvas** in 1 pd (step 7.1). See **M5** for the re-baseline. |

---

## 3. Blockers (must fix before approval)

| # | Severity | Issue | Evidence / reasoning | Concrete recommendation |
|---|---|---|---|---|
| **B1** | Blocker | **The legal gate approves a pattern ID, not the content. The "DB invariant" is not an invariant.** §3.6 states the `approved → published` transition is rejected unless a `legal_reviews` row exists with `decision='approved'` and `reviewer_id != author_id`. That row references `pattern_id` only. Nothing binds the approval to the bytes that were approved. An author can be approved, then edit `body_md`, then publish — the check still passes. A schema migration touching `graph_json` has the same effect. This defeats NFR-LEGAL-001, the single hardest requirement in the product. | `legal_reviews` DDL (§3.6) has `pattern_id`, `reviewer_id`, `checklist_json`, `decision` — no content reference. `patterns` has a mutable `updated_at` and no re-review trigger. | Add `content_hash TEXT NOT NULL` to `legal_reviews` = SHA-256 over `body_md ‖ graph_json ‖ source_company ‖ source_url ‖ source_title`. Publish check becomes: `sha256(current_pattern) == legal_reviews.content_hash`. Any write to a reviewed pattern (including a migration) that changes the hash resets `status` to `draft`. **~0.5 pd.** This converts the gate from an audit trail into a real invariant, and it is the single highest-value fix in this review. |
| **B2** | Blocker | **Two sources of truth for pattern content; the seed script can resurrect taken-down content.** The repo ships `content/patterns/` (authoring source) *and* `scripts/seed-patterns.ts` that "loads `content/` → DB". Once an editor edits a pattern in `/admin/patterns`, the Git copy is stale. Re-running the seed — on a rebuild, a restore, a new environment, or by habit — overwrites legally-reviewed text with unreviewed file content, and will **re-create a pattern that was unpublished under a takedown request**. That is a direct NFR-LEGAL-002 breach path introduced by the tooling that is supposed to enforce it. | §3.6 repo layout; step 4.4 "`scripts/seed-patterns.ts` loads `content/` → DB"; §3.6 state machine has no interaction with the seed path; `takedown_requests` has no linkage to seeding. | (1) Seed becomes **import-once and idempotent**: skip any `slug` that already exists; hard-refuse any slug whose current `status IN ('unpublished','published')` unless `--force` is passed, and make `--force` require an explicit `CONFIRM_OVERWRITE_REVIEWED=1` env var. (2) Declare **DB authoritative after G1**; the Git folder becomes read-only history. (3) Add a nightly one-way export DB → `content/patterns/*.md` committed to Git, so the ~9 pd of hand-authored, legally-reviewed content is version-controlled and diffable. **~0.5 pd.** |
| **B3** | Blocker | **The sizing formulas have four defects that produce materially wrong numbers, and "we show the formula" does not mitigate wrongness.** (a) `replicationFactor` is applied to storage but **not** to write throughput or node count — yet 3 replicas is exactly the 3x write amplification that sizes a database tier, so databases will be **under-sized**. (b) `nodeCount = ceil(peakQps / perNodeCapacity * (1+headroom))` takes **one** capacity number, but §3.4's own benchmark table gives `database` **two** (8,000 read qps / 2,000 write qps) — the formula cannot consume its own inputs. (c) No compression term, and the assumption text says "no compression"; for 2 KB JSON on any modern store real compression is 3–10x, so storage is **over-stated by close to an order of magnitude** — the 22.7 TB on the mockup is the number a user will screenshot. (d) No failure-domain spare (N+1 / AZ loss); this is a capacity plan that assumes nothing ever fails. Persona "Architect Aisha" is explicitly meant to attach these numbers to a capacity sign-off (REQ-CALC-003). | §3.4 formula block; §3.4 benchmark table; §3.2.3 mockup showing `22.7 TB` and `20 instances`; requirements persona table. | Replace the engine core with: `effectiveWriteQps = writeQps * replicationFactor`; `storageBytes = bytesPerDay * retentionDays * replicationFactor * (1+indexOverhead) / compressionRatio` with `compressionRatio` a visible input (default `1.0`, labelled "compression not modelled", with a one-click `3.0` preset tagged `estimated`); `nodeCount = ceil(max(peakReadQps/readCap, peakWriteQps*replicationFactor/writeCap) * (1+headroom)) + spareNodes` with `spareNodes` default 1. Add unit tests for each term. **~1 pd**, and it is the difference between a credible calculator and a demo liability. |
| **B4** | Blocker | **RPO 24 h against a nightly file copy of a live WAL-mode SQLite database is both too lossy and technically unsafe.** A plain `cp`/volume snapshot of a SQLite file with an active `-wal` and `-shm` yields a torn, possibly unrecoverable copy — the classic SQLite backup mistake. And 24 h of loss means: a day of user designs, plus up to the entire output of the content track (≈9 pd of hand-authored, legally-reviewed pattern text that lives *only* in the DB per D7). That is the most expensive data in the project sitting behind the weakest control in the design. | §3.6 "Nightly backup to blob/file share"; §3.8 NFR-AVAIL-001 "RPO 24 h / RTO 2 h"; D7 makes the DB the content store. | Two changes, both cheap: (1) Backups **must** use `VACUUM INTO '/backup/sa-$(date).db'` or the SQLite online-backup API — never a file copy. (2) Add **Litestream** (Apache-2.0, single binary, ~$0) streaming the WAL to the same blob/file share continuously → **RPO drops from 24 h to ~seconds** for roughly 0.25 pd of setup and no architectural change. Keep the nightly `VACUUM INTO` as the coarse restore point. Then keep the restore drill already in step 7.6 and add a *point-in-time* restore to it. |

---

## 4. Major findings

| # | Severity | Issue | Evidence / reasoning | Concrete recommendation |
|---|---|---|---|---|
| **M1** | Major | **FTS5 external-content table has no sync triggers, and search does not re-filter published status.** `CREATE VIRTUAL TABLE patterns_fts USING fts5(..., content='patterns', content_rowid='rowid')` is an external-content index: it does **not** update itself. Without triggers, every edit or unpublish leaves the index stale — so a taken-down pattern remains findable by search, and edited text is not searchable. Separately, the index covers **all** rows regardless of `status`, so any search query that does not re-join and re-filter will surface **draft, legally-unreviewed** titles and snippets. | §3.6 DDL; §3.3 "REQ-HUB-004 → SQLite FTS5"; step 5.1 says `GET /api/patterns` filters published but the search path is not separately specified. | Add the three standard triggers (`AFTER INSERT`, `AFTER DELETE`, `AFTER UPDATE ON patterns`) that `INSERT INTO patterns_fts(patterns_fts, rowid, ...) VALUES('delete', ...)` then re-insert; run `INSERT INTO patterns_fts(patterns_fts) VALUES('rebuild')` at the end of seeding. Route **all** search through one `searchPublishedPatterns()` repository function that joins `patterns` and applies `status='published'` server-side. Add a test: create a draft with a unique token, assert search returns 0 rows. |
| **M2** | Major | **Co-pilot skill 1 (LLM re-rank) does not earn its dependency at a corpus of 18.** Retrieval value scales with corpus size. With 18 patterns across 9 categories, a user can read every title in 30 seconds; FTS5 + facets already solves it. In exchange the MVP acquires: an external vendor, an unresolved procurement/data-residency decision (Q5 is still open), rate limiting, token caps, spend caps with a cutoff, prompt-hash logging, a golden-set evaluation, and the hallucination surface in **M3** — 5 pd in the most compressed phase, satisfying **zero** MVP acceptance criteria (#1 says so himself). | §3.5; §4 Phase 4 (8 pd in weeks 6–8, all on E2, while E1 does a11y); §4 "Cutting the co-pilot removes zero MVP acceptance criteria"; §6 Q5 unresolved. | **Defer skill 1 to Phase 2**, gated on `published_pattern_count > 40`. **Ship skill 2 as deterministic rules only, no LLM** (the design states the LLM merely rewrites the wording) — ~1 pd, no vendor, no guardrails, no spend cap, and it delivers the actual user value (sanity-checking implausible inputs). Keep `ENABLE_COPILOT` and the `AssistProvider` seam in the code so Phase 2 is additive. Saves ~4 pd and removes the only variable-cost line from §7.3. |
| **M3** | Major | **The hallucination-safety claim is overstated in a way that touches the legal posture.** "The model cannot invent a pattern" and "No hallucinated patterns reach the UI" are true **only of `patternId`**. The `reason` field is unconstrained free text, generated by a model, rendered next to a curated pattern card that carries a third-party company badge, on a product whose entire legal position is *"every word here is our own and human-reviewed"* (NFR-LEGAL-001, and the banner literally reads "Original summary by the SystemsArchitect team"). An LLM sentence in that frame is neither ours nor reviewed. Skill 2 is worse in kind: an LLM paraphrase of numeric warnings can introduce or alter a number in a tool whose credibility NFR is "no unexplained numbers" (NFR-USE-002). Also, the prompt-injection mitigation only covers *our* pattern text — the **user's free-text description is untrusted input in the same prompt**, and while it cannot forge an ID, it can shape arbitrary `reason` text (a stored-XSS vector if that text is ever rendered as HTML/Markdown). | §3.5 skill 1 step 3; §3.5 skill 2; §3.9 "Prompt injection — Pattern text is authored by us"; §3.2.4 attribution banner wording. | (1) Replace free-text `reason` with a **template composed from structured fields**: matched category/tag names + a fixed phrase ("matches your tags: *messaging, real-time*"). No generated prose ships next to attributed content. If free text is kept, render it in a visually distinct, clearly-labelled *"AI suggestion — not reviewed"* block outside the attribution frame, and log it. (2) For skill 2, **reject any LLM output containing a digit** (regex) — or, per M2, drop the LLM there entirely. (3) Render **all** assistant output as escaped plain text, never `dangerouslySetInnerHTML`. (4) Reword §3.9 to "the model cannot invent a pattern **ID**; free-text output remains untrusted". |
| **M4** | Major | **The content track is not actually parallel — it is blocked on the canvas and the admin editor.** Step 4.2 requires each author to "draw our own `ArchGraph` diagram", but the canvas editor is not usable until Phase 1 completes (~week 4) and `/admin/patterns` not until step 5.4 (~week 6). So the 9 pd content track compresses into weeks 4–6, not weeks 1–6, and its dependency is not the legal gate G0.2 alone. Combined with 0.5 FTE on C, and Q (also 0.5 FTE) owning G1 review *plus* all test plans *plus* the usability test *plus* the G3 audit, this is the most likely slip in the plan. | §4 Content track vs Phase 1 (12 pd, weeks 1–4) and step 5.4 (week 6); team assumption §4; R4 rated Med impact. | (1) **Decouple diagrams from the tool**: define the pattern diagram as a hand-written `ArchGraph` JSON file (or a tiny Mermaid-ish DSL compiled by `packages/core`) so authors can work from week 1 with a text editor. Adds ~0.5 pd of tooling, removes a 3-week dependency. (2) **Cut the seed to 9–12 patterns** (one per category) for MVP; "2 per category" becomes a Phase 2 goal. A3 is an assumption, not a requirement — and #1's own impact note says "higher = content track becomes the critical path". (3) **Split the roles**: G1 per-entry review and the G3 pre-launch audit must not both sit with Q, or the second control adds no independent assurance. (4) Re-estimate at 0.75–1.0 pd per entry (read a dense blog post → original summary → decision/rationale/trade-off table → diagram → attribution is not 4 hours). |
| **M5** | Major | **57 pd / 9 weeks has effectively zero buffer and contains specific under-estimates.** 28.5 pd per engineer inside a 9-week window leaves no room for PR review, gate waits, rework from this review, holidays, or fixing what the usability test (7.5) finds — the plan terminates at sign-off (7.7) with no remediation budget. Thin line items: **1.4 Entra ID OIDC in 1 pd** (app registration + auth-code/PKCE + session cookie + group→role claim mapping + an IT dependency #1 rates R10 "blocks all auth"); **7.1 accessibility in 1 pd** including keyboard navigation on a *graph canvas*, which is genuinely hard; **2.7 undo/redo** as a command stack layered over React Flow's own state in ~1 pd; **6.2 compare UI** in ~1 pd. | §4 summary table; §4 phase tables; R10; step 7.5 with no follow-on task. | Pick one and state it to the PO before commitment: **(a)** re-baseline to **~72–78 pd / 12 calendar weeks** with a named 15% contingency; or **(b)** hold 9 weeks and bank the cuts now — co-pilot skill 1 (−4 pd, M2), seed 12 not 18 (−3 pd content, M4), CSV export (−1 pd, Should), share link (−1 pd, see M9) — and move REQ-HUB-008 *compare* to first-cut-if-needed. Add an explicit 2 pd "usability + review remediation" line after 7.5. Do not carry a 0%-buffer plan into a PO commitment; that is a governance problem, not an estimating one. |
| **M6** | Major | **"Postgres migration is a connection-string change if we use Kysely" is wrong, and it is load-bearing for the D2 decision.** Kysely abstracts the query builder, not driver semantics or dialect features. Three concrete blockers to that claim: (i) `better-sqlite3` is **synchronous**; every Postgres driver is async — code written `db.prepare(x).get()` does not port. (ii) **FTS5 has no Postgres equivalent**; search becomes `tsvector`/`pg_trgm` with different ranking and different query syntax — a rewrite, not a config change. (iii) `TEXT` timestamps, `AUTOINCREMENT`, and JSON-as-TEXT all differ (`timestamptz`, identity, `jsonb`). Realistic port is **3–5 pd**, not a connection string. Stating it as free makes D2 look safer than it is. | §3.6 C7 note; R5 mitigation; §5 weakest point 2. | Either correct the decision log to "3–5 pd port, mostly search", **or** spend **0.5 pd now** to make it nearly true: use Kysely's **async** API everywhere even over SQLite (`await db...`), and put every FTS query behind a single `searchPublishedPatterns()` function in one repository file. Then the port really is a dialect swap plus one file. I recommend the 0.5 pd. |
| **M7** | Major | **The calculator holds itself to a lower evidence standard than the hub.** The product's whole legal and credibility posture is "everything is cited" — yet §3.4 tags `cache` 80,000 ops/s and `queue` 50 MB/s as `declared` ("published Redis benchmarks", "published Kafka sizing guidance") with **no URL, no title, no date, no version**. A reviewer cannot check them; a user cannot defend them. This is the exact BA open question Q4 ("what are the real numbers grounded in") and the answer as written is not auditable. | §3.4 benchmark table; requirements Open Question 4; NFR-USE-002. | Give every benchmark the same attribution shape as a pattern: `{ value, unit, basis, sourceUrl, sourceTitle, retrievedDate, hardwareProfile, confidence }`. Render `sourceUrl` in the existing `[why?]` popover. Store benchmarks in the DB (not only `benchmarks.ts`) so the editor can update them without a deploy — consistent with NFR-EXT-001. Where no citation exists, the tag must be `estimated` or `unverified`, never `declared`. **~0.5 pd.** |
| **M8** | Major | **Point estimates communicate false precision, and the disclaimer does not travel with the artefact.** "20 instances" and "22.7 TB" read as answers. Showing a formula makes the number *inspectable by someone who already knows the answer* — it does not stop Architect Aisha pasting `22.7 TB` into a budget. Three gaps: (i) no uncertainty is expressed numerically; (ii) the disclaimer is on-screen only — the CSV export (REQ-CALC-008), the node-attached scenario, and any screenshot lose it; (iii) `formula_version` exists in the DDL but nothing states what happens when a benchmark changes — a saved scenario re-rendered against new defaults silently changes a number someone already committed to. | §3.2.3 mockup; §3.6 `sizing_scenarios.formula_version`; risk R3 mitigation is "assumptions + confidence + disclaimer". | (1) **Render ranges, not points**: derive bands from the confidence tag (`measured` ±10%, `declared` ±25%, `estimated` ±50%, `unverified` ±100%) and show `14–30 instances (point estimate 20)`. This is ~0.5 pd and is the highest-value credibility fix in the calculator. (2) Put the disclaimer, `formula_version`, benchmark sources and confidence tags into the **CSV header rows** and into the PNG/JSON export envelope. (3) Pin saved scenarios to a **benchmark snapshot**; offer an explicit "recompute with current benchmarks" action that shows the before/after diff. |
| **M9** | Major | **The share link is the one mechanism that lets internal-only content leave the org, and A1 (internal-only) is the assumption the entire legal posture rests on.** The self-certification model, the absence of counsel, and the 5-item checklist are all justified by "internal, behind SSO, 50–200 users". §6 Q7 defaults the share link **into MVP** with no note that a `share_token` URL is bearer-auth that can be pasted into any chat, email or external ticket. No expiry, no SSO requirement, no revocation SLA, no referrer or indexing controls are specified. | A1 §2.3; §3.6 `share_token TEXT UNIQUE`; §3.8 NFR-SEC-001; §6 Q7 default "In MVP". | (1) Default share links to **"anyone in the org with the link"** — i.e. the token still requires a valid SSO session; truly anonymous sharing becomes a separate, explicitly-logged choice that is **out of MVP**. (2) Add `expires_at` (default 30 days) and a visible revoke control. (3) Serve shared pages with `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex`. (4) Add to the design doc, in bold: **any move to public/external distribution re-opens gate G0.2 and requires legal counsel, not the checklist.** |
| **M10** | Major | **Takedown does not reach derived artefacts, and attribution is missing where it is most exposed.** NFR-LEGAL-002 requires takedown to be *actionable*; §3.6 makes it a one-click unpublish of one row. But `seeded_from_pattern_id` records that N user designs were copied from that pattern, and those designs persist with the pattern's structure and labels — and exported PNG/JSON files have already left the tool. Separately, the "Not affiliated with or endorsed by X" disclaimer appears only on the **detail page**, while the company badge appears on **every gallery card** and — via export — on artefacts that leave the product entirely with no attribution at all. | §3.6 `designs.seeded_from_pattern_id`; §3.2.4 item 2 (detail page only); §3.2.4 gallery card mock showing "Netflix" badge; §3.3 export rows. | (1) On unpublish, query `designs WHERE seeded_from_pattern_id = ?`, count them, record the count in `takedown_requests.resolution`, and suppress the source company name/attribution rendered on those derived designs. It is one query and it makes the response to the requester honest. (2) Add a short attribution line to the **gallery card** ("Source: Netflix Tech Blog — not affiliated"). (3) Add an attribution + disclaimer footer to the **PNG export** and an `attribution` block to the **JSON export envelope** whenever `seededFromPatternId` is set. (4) Add a weekly job that `HEAD`-checks every published `source_url` and raises an admin flag on 404 — checklist item 3 ("the link resolves") is verified once and then rots. |
| **M11** | Major | **`diffGraphs` keyed on `(type, lowercase(label))` will look broken in the first demo.** "Orders API" vs "orders-api" vs "Order Service" vs "OrdersSvc" all diff as *different components*. Since patterns are authored by our editor and designs are named by users, near-total label mismatch is the expected case, not the edge case — so REQ-HUB-008 will report "everything missing, everything extra" and Tech Lead Tom will stop using it. It also compares only nodes; the insight a reviewer actually wants ("the pattern puts a cache between the service and the database; you don't") is an **edge-shape** question that the current diff cannot answer. | §3.7 point 3: "`diffGraphs(a,b)` … keyed on `type + lowercase(label)`"; §3.3 REQ-HUB-008 row. | Diff in three tiers, rendered as three sections: (1) **by type count** — "pattern: 2 × cache, yours: 0 × cache" (always meaningful, never label-dependent); (2) **by normalised label** — lowercase, strip non-alphanumerics, strip `api|service|svc|server` suffixes, then fuzzy-match (Levenshtein ≤ 2) for the "probably the same thing" hint; (3) **by edge shape** — for each pattern edge `(sourceType → targetType)` not present in the design, report it. Tier 1 and 3 carry the value; tier 2 is a nicety. ~1 pd, same as the current plan. |
| **M12** | Major | **Day-2 operability gaps: at 3 a.m. you have a container and a file.** Missing from the design entirely: (i) **structured application logging / error tracking** — §3.8 only names the `events` *business* table, so there is no request log, no request ID, no stack traces; (ii) the **health check is shallow** — `/api/health` returning `{"status":"ok"}` will keep returning 200 while SQLite is locked or corrupt, so the `restart: unless-stopped` policy never fires and the tool is silently down until a user complains; (iii) **no database migration runner** for the DDL itself (distinct from `ArchGraph.schemaVersion`); (iv) **no secrets management statement at all** — Entra client secret, LLM API key and session signing key are unaddressed; (v) **no rollback path** — rolling a container back to the previous image against a forward-migrated SQLite file will fail. | §3.6 component table; §3.8 NFR-OBS-001 and NFR-AVAIL-001 rows; step 7.6 "Deploy + runbook"; absence of any secrets row in §3.6 or §3.9. | (1) `pino` JSON logs to stdout with a per-request `x-request-id`; keep the `events` table for analytics only. (2) Deepen the health check: `SELECT count(*) FROM patterns LIMIT 1` plus a write probe to a scratch table, with a 2 s timeout — so a locked DB actually fails the probe. (3) Add a numbered-migrations table and a forward-only runner; **backup before migrate** (ties to B4). (4) Add a secrets paragraph: env file with `chmod 600`, never committed, named owner, rotation cadence; escalate to devops-master. (5) Runbook rollback procedure = restore-from-backup, **not** image rollback. State it in 7.6. |

---

## 5. Minor findings

| # | Severity | Issue | Recommendation |
|---|---|---|---|
| m1 | Minor | `schemaVersion: '1.0'` is a **literal** type. The day `'1.1'` exists, every construction site needs a cast or a union edit, and a v1.1 server cannot type a v1.0 object. | Declare `schemaVersion: SchemaVersion` where `type SchemaVersion = '1.0' \| '1.1'`, validate at the boundary with zod, and add `migrate()` coverage per version pair. Also state the migration strategy explicitly: **lazy on read, pure, idempotent**, written back on next save — and never batch-migrate the `patterns` table without re-running the legal gate (B1). |
| m2 | Minor | `props?: Record<string, string \| number>` is an untyped escape hatch shared by client and server. This is the standard way a shared schema rots — ad-hoc keys accumulate with no validation and no owner. | Namespace keys (`sizing.*`, `render.*`, `meta.*`), keep a registry of known keys in `packages/core`, add a unit test that fails on an unregistered key in seed content. Unknown keys are preserved on round-trip but never read. |
| m3 | Minor | **Unit ambiguity across the sizing engine.** The input is "Retention [12] **months**" but the formula uses `retentionDays` with no stated conversion (30? 30.44? 365/12?). `ingressBps` is named "Bps" but the mockup renders "1.0 MB/s". The input says "Avg record [2] **KB**" while the formula says `avgRecordBytes` — KB or KiB is undefined. These are exactly the details that make a reviewer distrust every other number. | Name every field with its unit (`avgRecordKiB`, `ingressBytesPerSec`, `retentionMonths`), do one conversion in one place, state `1 month = 30.44 days` and `1 KiB = 1024 B` in the assumptions string. |
| m4 | Minor | `sizing_scenarios` references `design_id` and `node_id` with no cascade or cleanup. Deleting a node orphans its scenario row and leaves `sizingScenarioId` dangling on nothing. | On node delete, delete the scenario (or soft-delete and hide). On design delete, cascade. Add a test for the dangling-reference render path. |
| m5 | Minor | **PNG export brittleness is understated.** R11 frames it as "quality"; the real failure mode is a **blank or garbled export** — `html-to-image` is well known for web-font race conditions, CORS-tainted external CSS, and `foreignObject` differences in Safari. | Await `document.fonts.ready` before capture, inline all CSS, and add **SVG export** as the lossless artefact — React Flow's viewport serialises cleanly, the file is small, it is browser-independent, and it is a *better* attachment for a design doc than a raster image. Keep PNG for convenience. |
| m6 | Minor | The assistant's "global monthly spend cap with hard cutoff" does not state **what happens when it trips**. If it 500s, every user sees a broken feature; if it 429s, the UI must handle it. | The cap must degrade to the deterministic FTS5 path (the same path as `ENABLE_COPILOT=false`), log a single alert, and name an owner who can reset it. Test the tripped state, not just the cap logic. |
| m7 | Minor | Rate limiting is per-user (10/hour) with no **global** concurrency or QPS cap on `/api/assist`. 200 users × 10 = 2,000 calls could all arrive in one minute. | Add a global concurrency limiter (e.g. 4 in flight) and a queue with fast-fail, so one bad afternoon cannot exhaust the spend cap or saturate the single Node process. |
| m8 | Minor | §7.3 omits two real costs and mis-frames one: no line for the Phase 4b **embedding** step, no line for a **staging** environment, and "$0 if an existing internal host is used" is *allocated* cost, not zero cost. | Add both lines (small), and phrase the host line as "no marginal cost; consumes existing capacity". Note in #1's favour: deferring the co-pilot (M2) removes the only variable-cost item and takes the MVP to < $5/month marginal. |
| m9 | Minor | The legal checklist bans reproducing logos, but nothing in the build enforces it, and §3.2.4's card mock leads with a company badge. | Add a CI check that fails if any file under `apps/web/public/` or `content/` matches a brand-asset allowlist violation (any image file not in an approved manifest). Policy: **text company names only, never logo assets**. Nominative use of a name is defensible; a logo in the repo is not. |

---

## 6. Proposed alternatives

1. **Legal gate: attestation → detection (recommended, ~1 pd).** The current
   5-item checklist is a *self-attestation with an audit trail*. It records
   that two humans clicked, and says nothing about whether the text is
   original — and a reviewer under deadline ticks five boxes in twenty
   seconds. Add a mechanical check in the admin save path and in CI: fetch the
   source article **transiently**, compute 8-gram shingle overlap
   (Jaccard) and longest common substring against the draft, and block
   approval on any ≥25-word verbatim run or >15% shingle overlap. **Critical
   nuance:** the fetched source text must be held in memory and never
   persisted — otherwise you have built the scraper the product promised not
   to build (REQ-HUB-011, NFR-LEGAL-001). Document that explicitly in the
   code and the policy doc. This converts G1 from a gesture into a control.

2. **Sizing credibility: ranges over points (recommended, ~0.5 pd).** See M8.
   `14–30 instances` communicates uncertainty in a way no formula string ever
   will, and it costs almost nothing. This is the cheapest way to honour the
   BA's own risk entry ("rough capacity formulas can mislead users if
   presented as precise") — which REQ-CALC-004 alone does not discharge.

3. **Co-pilot: rules now, LLM later (recommended).** See M2. Ship
   `reviewSizing` as pure deterministic rules in `packages/core` — no vendor,
   no guardrails, no spend cap, testable, always available. Keep the
   `AssistProvider` interface and the feature flag so Phase 2 adds skill 1
   without rework. Revisit the LLM re-rank when the corpus passes ~40
   patterns, which is when retrieval actually becomes a problem worth paying
   for.

4. **Content: text-first authoring (recommended, ~0.5 pd tooling).** See M4.
   Let editors write pattern diagrams as `ArchGraph` JSON (or a tiny DSL) from
   week 1 instead of waiting for the canvas at week 4. This removes the only
   hard dependency between the content track and the engineering track and
   makes the "parallel tracks" claim in §4 actually true.

5. **Alt A (static site + Git) — I agree with rejecting it, but for a sharper
   reason than #1 gave.** #1 rejects it on persistence and NFR-EXT-001. The
   decisive reason is **NFR-LEGAL-002**: a takedown that requires a Git commit,
   a CI run and a deploy cannot meet a 2-business-day SLA reliably, and it
   makes the removal of legally-contested content dependent on an engineer
   being available. Keep Alt A as the fallback *only* if the timeline halves,
   and note that choosing it means re-negotiating the takedown SLA.

6. **Alt B (microservices) — agree, reject outright.** Three services for a
   2-engineer prototype at <200 users is unambiguously wrong. No change.

---

## 7. What's good (credit where due)

- **The shared `ArchGraph` schema (D1) is genuinely the right central idea.**
  It collapses REQ-HUB-007 to a copy and REQ-HUB-008 to a diff, and it keeps
  React Flow as a *renderer* rather than a data model (D4) so the canvas
  library is replaceable. That is a real architectural insight, not a
  restatement of the requirements.
- **D6 — making `formula` and `assumptions` structurally required by the
  `SizingResult` type** turns a code-review convention into a compile error.
  This is exactly the right instinct: enforce in the type system what you
  would otherwise enforce in a checklist. I want the same instinct applied to
  the legal gate (B1) and to benchmark citations (M7).
- **D10 — no agent framework** is well argued, correctly scoped as "not yet"
  rather than "never", and names the specific trigger for revisiting.
- **The §5 "weakest points of this design, stated plainly" section** is
  unusually honest and correctly identifies four of the five things I would
  have raised unprompted. That materially shortened this review.
- **§7.2 M365 E3 vs E5** is correct and precise: Entra ID P1 (group-based app
  roles, standard Conditional Access) is in E3; P2 features (PIM,
  risk-based CA) are E5 and are genuinely not needed here. The E3-only
  fallbacks listed (small editor group + quarterly review + admin action
  logging instead of PIM) are the right compensating controls. No change.
- **§7.3 FinOps** is honest and correctly ordered (engineering time first,
  storage as rounding error), and "cap LLM spend with a hard cutoff, not an
  alert" is the correct distinction.
- **NFR-SEC-001 verification as "user B gets 404, not 403"** is the right
  instinct — it avoids confirming the existence of another user's resource.
- Every design section cites its `REQ-*`/`NFR-*` ID. Traceability was done
  properly, which is rarer than it should be.

---

## 8. Final converged recommendation

### Ship as-is (no change)

| Item | Why |
|---|---|
| D1 shared `ArchGraph` schema | Best idea in the doc; keep it |
| D2 single container, SPA + Fastify + SQLite | Right for a 2-engineer prototype (fix the backup, not the topology) |
| D3/D4 React + Vite + React Flow as renderer | Matches `ArchPilot/`, MIT, replaceable |
| D5 client-side sizing | NFR-PERF-002 with huge margin, formulas visible by design |
| D6 required `formula`/`assumptions` on `SizingResult` | Enforcement in the type system |
| D7 patterns in DB + admin UI | Correct for NFR-EXT-001 and runtime takedown |
| D10 no agent framework | Correct YAGNI |
| D11 Entra ID OIDC; §7.2 E3 verdict; §7.3 FinOps shape | All correct |

### Must change before approval (4 Blockers, ~2.5 pd total)

1. **B1** — `content_hash` in `legal_reviews`; publish requires hash match; any
   edit or migration resets to `draft`. *(0.5 pd)*
2. **B2** — Seed script import-once and idempotent; refuse to overwrite
   published/unpublished patterns; DB authoritative after G1; nightly DB → Git
   export. *(0.5 pd)*
3. **B3** — Fix the four formula defects (replication on writes, dual
   read/write capacity, compression term, failure-domain spare) + unit tests.
   *(1 pd)*
4. **B4** — `VACUUM INTO` (never a file copy) + Litestream continuous WAL
   replication; RPO 24 h → ~seconds; add point-in-time restore to the 7.6
   drill. *(0.5 pd)*

### Should change (highest-value Majors, ~3.5 pd)

M1 FTS triggers + published-only search filter *(0.5)*; M3 template the
assistant `reason`, escape all assistant output *(0.5)*; M7 benchmark
citations *(0.5)*; M8 ranges + disclaimer travels with exports + pinned
benchmark snapshots *(1)*; M9 share links SSO-scoped with expiry *(0.5)*;
M11 three-tier diff *(same budget as current plan)*; M12 pino logs + deep
health check + migration runner + secrets paragraph *(0.5)*.

### Explicitly deferred, with the reason stated

| Deferred | Reason |
|---|---|
| **Co-pilot skill 1 (LLM pattern re-rank)** → Phase 2, gated on corpus > 40 patterns | Retrieval value scales with corpus size; at n=18 an LLM buys marginal relevance while importing a vendor, a procurement decision, guardrails, spend caps and a hallucination surface — for zero MVP acceptance criteria. Saves ~4 pd and the only variable cost line. |
| **LLM phrasing inside skill 2** → not planned | The deterministic rules carry ~90% of the value; an LLM paraphrase near numbers is a credibility risk (NFR-USE-002) for no measurable gain. |
| **Seed patterns 18 → 12 for MVP (2 per category → 1, plus 3 doubles)** | The content track is the critical path and is *not* parallel (M4). 18 is assumption A3, not a requirement. 12 still demonstrates all 9 categories. |
| **Phase 4b embeddings** | Pointless below ~100 patterns; FTS5 is sub-5 ms at this corpus. |
| **Postgres migration** | Correct not to do it now — but re-cost it honestly at 3–5 pd (M6), or spend 0.5 pd on async-everywhere + one search repository to make the later port genuinely cheap. |
| **Full WCAG 2.1 AA audit** | Agree with A6 best-effort — but budget the canvas keyboard-navigation work at 2–3 pd, not 1 (M5). |
| **Anonymous / public share links** | Out of MVP. A1 "internal-only" is load-bearing for the entire legal posture; public distribution re-opens G0.2 and requires counsel. |

### Schedule position

Do not commit 9 weeks. Either re-baseline to **~72–78 pd / 12 weeks** with a
named 15% contingency, **or** hold 9 weeks having banked the cuts above
(co-pilot skill 1, 12 patterns, CSV export, share link ≈ 9 pd) plus a 2 pd
remediation line after the usability test. Blockers B1–B4 add ~2.5 pd and are
not optional.

---

## 9. Open questions for humans

1. **PO / legal:** Is the mechanical originality check (§6 item 1) acceptable,
   given it transiently fetches source text? I believe it strengthens
   NFR-LEGAL-001, but somebody must confirm that transient, never-persisted
   fetching for *comparison* is not "scraping" under our own policy.
2. **PO:** Confirm the seed count. I recommend **12** for MVP with 18 as the
   Phase 2 target. #1 recommends 18. This is the single biggest schedule lever.
3. **PO:** Accept **9 weeks with the cuts**, or **12 weeks with full scope**?
   Please choose explicitly; the current plan is 9 weeks with full scope and
   that is the option that is not available.
4. **PO / legal:** Is the share link permitted to be org-SSO-scoped only for
   MVP (my recommendation), rather than an anonymous bearer URL?
5. **PO:** Who is the second reviewer, so G1 (per-entry) and G3 (pre-launch
   audit) are not both owned by Q? The two controls are only independent if
   the people are.
6. **IT:** Timeline for the Entra ID app registration. R10 rates it "blocks all
   auth"; it needs a date, not a risk row.

---

## 10. Next handoff

| Agent / role | What they need from this review |
|---|---|
| **solution-architect-1** | Apply B1–B4 and the M-series fixes; issue design v0.2 with an updated decision log (D7 modified, D9 descoped, D12 added for content-hash) and a re-baselined §4. Re-review is a delta, not a full pass. |
| **security-architect** | Full STRIDE pass. Priority items raised here: share-token lifecycle and referrer leakage (M9), stored-HTML XSS from pre-rendered Markdown (M3/M12), untrusted user text in the assistant prompt (M3), secrets management (M12), and the admin role boundary. §3.9 remains a starter, not a deliverable. |
| **dba-master** | Validate the FTS5 external-content trigger set (M1), the `content_hash` invariant (B1), the Litestream + `VACUUM INTO` backup design and a point-in-time restore drill (B4), and cost the real Postgres port (M6). |
| **devops-master** | Deep health check, forward-only migration runner, backup-before-migrate, restore-as-rollback runbook, secrets handling, and the global assist limiter (M12, m6, m7). |
| **ba-qa-analyst** | New test cases: TC-COMPLY-002 (edit-after-approval must reset to draft), TC-COMPLY-003 (search must not return drafts), TC-COMPLY-004 (re-running seed must not resurrect an unpublished pattern), TC-FUNC-CALC-010 (replication applied to write throughput), TC-DR-001 (point-in-time restore). Own the G1/G3 role split question. |
| **Product Owner** | Answer §9 questions 2, 3, 4 and 5 before G0.2. Questions 2 and 3 determine whether this ships. |

**Verdict: Approve-with-changes** — 4 Blocker, 12 Major, 9 Minor.

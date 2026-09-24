# SystemsArchitect in ArchPilot — Build Scope & Phase-0 Scaffold

| | |
|---|---|
| **Author** | Senior Developer #1 (Builder / Proposer) |
| **Date** | 2026-09-23 (v1.0) · 2026-09-23 (v1.2, post-review) · 2026-09-23 (v1.3, CI + `main.tsx` split) · 2026-09-23 (v1.4, persistence spine: 1.2 / 1.3 / 1.6) · 2026-09-24 (v1.5, 1.4 store + 3.3 benchmarks + 3.4 sizing UI) · 2026-09-24 (v1.6, **v2 Phase 0**: design-v2 §5.2 tasks 0.2-0.6 - see §7.0) |
| **Version** | 1.6 |
| **Status** | Reviewed (`senior-developer-2`, approve-with-changes) up to v1.3. **v1.4 and v1.5 are not yet reviewed.** All four red-team blockers carried in code. v1.5: the SPA's workspace now lives on the server (**1.4**), benchmarks have a cited, idempotent seed and a read endpoint (**3.3**), and the Sizing screen is a real calculator on the v2.0 engine (**3.4**). Next: the interactive canvas (1.5 → 2.1–2.6). |
| **Language / stack** | Backend: Python 3.10+ (CI tests **3.12 and 3.10**; the image is 3.12), FastAPI, SQLite (stdlib-preferring, **4 runtime deps** since 1.6 — `jsonschema` promoted from test-only — + 3 test/lint-only). Frontend: existing ArchPilot React 18 + TypeScript + Vite on **Node 24**, with `vitest` + `ajv` + `jsdom` as devDependencies. |
| **Code delivered with this doc** | `ArchPilot/backend/` · `ArchPilot/contracts/` · `ArchPilot/src/domain/sizing.ts` · `ArchPilot/src/contracts/` · `ArchPilot/src/{app,ui,features,api,test}/` · `ArchPilot/vite.config.ts` · `.github/workflows/ci.yml` (**outside this repo — see §7.2 item 5c**) |
| **Related docs** | `docs/requirements/systemsarchitect-requirements.md` v0.1 · `docs/architecture/systemsarchitect-prototype-design.md` v0.1 · `docs/architecture/reviews/review-systemsarchitect-prototype.md` v1.0 · `docs/development/reviews/review-systemsarchitect-backend.md` v1.0 · `docs/development/systemsarchitect-contracts-and-sizing.md` v1.0 · `docs/requirements/systemsarchitect-decisions.md` v0.1 |

### Change log

| Version | Date | What changed |
|---|---|---|
| 1.0 | 2026-09-23 | Initial scope + Phase-0 backend scaffold (36 tests). |
| 1.1 | 2026-09-23 | `senior-developer-2` review: 14 findings fixed in code, backend suite 36 → 65. Wire format switched to camelCase (M-5). Two items handed back. |
| 1.2 | 2026-09-23 | The two handed-back items delivered: task **0.5/0.6** (`contracts/` + shared fixtures + envelope rules) and task **3.1/3.2** (corrected sizing engine, red-team B3). Backend 65 → **90 pytest**; frontend 0 → **57 vitest**. |
| 1.3 | 2026-09-23 | Task **0.7** (CI: `.github/workflows/ci.yml` runs ruff + pytest on Python 3.12 **and** 3.10, and `tsc -b` + vitest + `vite build` on Node 24) and task **1.1** (`main.tsx` 292 lines → 25 files under `src/app`, `src/ui`, `src/features/<module>/`, proved byte-identical by a 36-state DOM diff). Frontend 57 → **63 vitest**. Node images bumped 20 → 24 (Node 20 is EOL; jsdom 30 needs ≥ 22.22.2). |
| 1.5 | 2026-09-24 | Tasks **1.4** (`store.ts` async on `/api/workspaces/current`, owner-scoped `localStorage` cache, one-time legacy import, 409 → reload + message, offline → pending edit + "not saved" + Retry), **3.3** (migration `004`, idempotent never-overwriting benchmark seed, `GET /api/benchmarks`) and **3.4** (Sizing calculator: inputs left, result cards right, formula + substitution + assumptions + confidence on every number, deterministic review hints, single-benchmark shortcut note, VI/EN). Backend 154 → **174 pytest**; frontend 97 → **150 vitest**. Image built and run as `archpilot:task-3x`, exercised with curl, then removed. |
| 1.6 | 2026-09-24 | **v2 Phase 0** (design-v2 §5.2 tasks 0.2, 0.3, 0.4, 0.5, 0.6; 0.1 skipped - CI already in this repo), with the red-team review's B1/B2/M6/M9/m2/m3/m4 applied: contract **1.1.0** (ArchGraph 2.0 design document, `if/then/else` on `schemaVersion`), component catalogue v1.0.0 (45 v2.1 roles, 11 layers), `src/domain/graph/` core, `graph_integrity.py` + migration **005**, react-router + SPA fallback + CSP + Studio shell. Backend 174 → **323 pytest**; frontend 150 → **387 vitest**. Image build **blocked** (Docker Desktop crashed at start-up, §7.0.4); the production-configured app was verified with curl instead. |
| 1.4 | 2026-09-23 | Tasks **1.3** (`GET/PUT /api/workspaces/current`, revision-checked, 409 on stale), **1.6** (designs CRUD, owner-scoped, 404 for non-owners, graph validated at request time against **the same** `contracts/archgraph.schema.json`, 409 on stale revision, paginated list, soft delete) and **1.2** (`src/api/client.ts`, `src/api/auth.ts`, `LoginScreen`, auth gate + Logout in `App.tsx`, Vite `/api` proxy, `scripts/create_user.py`). Backend 90 → **154 pytest**; frontend 63 → **97 vitest**. Backend image **built and run** under Docker 29.8 and exercised with curl (first time; the v1.3 `node:24-alpine` bump is now verified). |

---

## 1. Executive summary

**English.** SystemsArchitect is not a new application. It is the concrete
implementation of three modules ArchPilot's own Phase 1 roadmap already
planned: the architecture canvas, the sizing studio, and knowledge/pattern
search. ArchPilot today is frontend-only — React + TypeScript + Vite with a
`localStorage` store — so the work is to put a real backend behind it. That
backend is Python (FastAPI) with SQLite in a single on-prem Docker container,
matching this repo's stdlib-preferring `tools/` convention. Authentication is
simple local username/password for 2–4 internal users; there is no SSO and no
LLM anywhere in this version. This document reconciles the BA requirements, the
architects' proposal, the red-team's four blockers and the Product Owner's
decisions into one plan: the API surface, the SQLite schema, exactly what
changes in `store.ts`, `architecture.ts`, `sizing.ts` and `knowledge.ts`, and a
numbered 9-week task breakdown. The Phase-0 scaffold ships with this document
and already runs: migrations, a deep health check, local login, WAL-safe
backups, and **174 passing Python tests plus 150 passing TypeScript tests**
(v1.5). ArchPilot's `main.tsx` — one 292-line file holding all sixteen screens
— has been split into one file per screen (task 1.1). **As of v1.4 the
persistence spine has started:** the server stores each user's workspace and
architecture designs, other users get "not found" for them, and a stale edit
is refused instead of silently overwriting newer work. The SPA now opens on a
login screen and signs out from the top bar. The single Docker image has been
built and run for real. **As of v1.5** the workspace itself is stored on the
server (the browser keeps only a copy for when the server is down, and an old
browser-only workspace is copied up once on first login), and the Sizing
screen is a real calculator: every number it shows comes with its formula,
its assumptions and a confidence tag, and per-node capacities can be loaded
from a small, clearly-labelled set of generic benchmarks. The next large piece
is the interactive architecture canvas.

**Honest status of the four red-team blockers (v1.0 of this document did not
make this clear enough, and the reviewer was right to say so).** At v1.0 only
**B4** (WAL-safe backups) was genuinely carried. **B1** was half-implemented —
the schema revoked an approval after an edit but did not gate publication.
**B2** had no live risk only because the seed script does not exist yet. **B3**
(the four sizing-formula defects) was untouched. As of **v1.2 all four are
carried in code**: B1 by `003_publish_gate.sql`, B3 by the rewritten
`src/domain/sizing.ts` with one unit test per corrected term, B4 as before, and
B2 is now structurally half-closed by the publish gate with written acceptance
criteria for the seed script (task C.5).

**Tiếng Việt.** SystemsArchitect không phải một ứng dụng mới. Đây là phần hiện
thực hóa cụ thể của ba module mà lộ trình Phase 1 của chính ArchPilot đã đặt ra:
canvas kiến trúc, studio ước lượng năng lực, và tìm kiếm tri thức/mẫu kiến
trúc. Hiện tại ArchPilot chỉ có frontend — React + TypeScript + Vite, lưu dữ
liệu bằng `localStorage` — nên công việc là xây một backend thật phía sau. Backend
đó dùng Python (FastAPI) với SQLite, chạy trong một container Docker duy nhất
trên máy chủ nội bộ, đúng theo quy ước ưu tiên thư viện chuẩn của thư mục
`tools/` trong repo này. Xác thực là đăng nhập nội bộ bằng tên người dùng và mật
khẩu cho 2–4 người dùng; không có SSO và không có LLM trong phiên bản này. Tài
liệu này hợp nhất yêu cầu của BA, đề xuất của các kiến trúc sư, bốn lỗi chặn từ
bản phản biện, và các quyết định của chủ sản phẩm thành một kế hoạch duy nhất:
danh sách API, lược đồ SQLite, thay đổi chính xác trong `store.ts`,
`architecture.ts`, `sizing.ts`, `knowledge.ts`, và phân rã công việc theo 9 tuần
có đánh số. Bộ khung Phase-0 đi kèm tài liệu này đã chạy được: migration, health
check sâu, đăng nhập nội bộ, sao lưu an toàn với WAL, và **174 test Python cùng
150 test TypeScript đang pass** (v1.5). Tệp `main.tsx` của ArchPilot — một tệp
292 dòng chứa toàn bộ mười sáu màn hình — đã được tách thành mỗi màn hình một
tệp (công việc 1.1). **Từ bản v1.4, phần lưu trữ phía máy chủ đã bắt đầu:**
máy chủ lưu workspace và các thiết kế kiến trúc của từng người dùng, người
khác nhận "không tìm thấy" khi truy cập chúng, và một lần sửa dựa trên dữ liệu
cũ sẽ bị từ chối thay vì âm thầm ghi đè lên bản mới hơn. SPA nay mở bằng màn
hình đăng nhập và có nút đăng xuất trên thanh trên cùng. Image Docker duy nhất
đã được build và chạy thật. **Từ bản v1.5**, workspace được lưu trên máy chủ
(trình duyệt chỉ giữ một bản sao để dùng khi mất kết nối, và workspace cũ chỉ
nằm trong trình duyệt được chuyển lên máy chủ một lần ở lần đăng nhập đầu
tiên), và màn hình Sizing là một công cụ tính thật: mọi con số đều đi kèm công
thức, giả định và mức tin cậy, và công suất mỗi node có thể nạp từ một bộ
benchmark chung được ghi rõ là ước lượng. Phần lớn tiếp theo là canvas kiến
trúc tương tác.

**Tình trạng thật của bốn lỗi chặn từ đội phản biện.** Ở bản v1.0 chỉ có **B4**
(sao lưu an toàn với WAL) là thực sự được khắc phục; **B1** mới làm một nửa,
**B2** chưa có rủi ro thực tế vì script seed chưa tồn tại, và **B3** hoàn toàn
chưa được sửa. Từ bản **v1.2, cả bốn đều đã được hiện thực trong mã nguồn**: B1
bằng `003_publish_gate.sql`, B3 bằng việc viết lại `src/domain/sizing.ts` kèm
một unit test cho từng số hạng đã sửa, B4 như cũ, và B2 được đóng một nửa về mặt
cấu trúc nhờ cổng xuất bản, phần còn lại là tiêu chí nghiệm thu cho script seed
(công việc C.5).

---

## 2. Context & objectives

### 2.1 What changed from the original architecture proposal

The architects' proposal (`systemsarchitect-prototype-design.md`) assumed a new
standalone app, a Node/Fastify backend, Entra ID SSO, 18 patterns, an LLM
co-pilot, and 50–200 users. Four of those are now wrong. This table is the
authoritative reconciliation; where this table and the proposal disagree, **this
table wins**.

| Topic | Architects proposed | Binding decision now | Source |
|---|---|---|---|
| Product boundary | New standalone `SystemsArchitect/` app | **Fold into `ArchPilot/`** as its Phase 1 canvas / sizing / knowledge modules. No second frontend. | PO, mid-session |
| Backend stack | Fastify + TypeScript + Kysely + better-sqlite3 | **Python 3.10+ / FastAPI / SQLite (stdlib `sqlite3`)** | PO stack decision |
| Frontend | New React+Vite SPA | **Keep ArchPilot's existing React 18 + TS + Vite SPA**; extend it | PO |
| Audience | Internal, ~50–200 users | **Internal, 2–4 users** | Decision 2 |
| Auth | Entra ID OIDC + PKCE | **Local username/password.** SSO cut entirely. | Decision 4 |
| Seed patterns | 18 | **12** | Decision 1 |
| Timeline | 9 weeks full scope (red-team: not available) | **9 weeks with the cuts banked** | Decision 1 |
| Legal review | Self-certify + independent countersign + originality tool | **Self-certify only.** No second reviewer, no originality tool. `content_hash` invariant retained. | Decision 3 + red-team B1 |
| Co-pilot | 2 LLM skills behind a flag | **No LLM at all.** Sizing review ships as deterministic rules; pattern-suggest deferred. | Decision 5/6 |
| Deployment | Internal Docker host / Azure | **On-prem Docker host, single container** | Decision 7 |
| Success metric | designs created, patterns applied | **Qualitative team adoption**, no numeric target | Decision 8 |
| CSV sizing export | In MVP (Should) | **Cut** | Decision 1 |

### 2.2 Module mapping — ArchPilot Phase 1 ↔ SystemsArchitect pillars

`ArchPilot/08-reference-synthesis-sysdesai.md` §2 lists 12 Phase-1 core modules.
Three of them are exactly the three SystemsArchitect pillars. Everything below
implements those three; the other nine ArchPilot modules are untouched.

| ArchPilot Phase-1 module | SystemsArchitect pillar | Requirement IDs |
|---|---|---|
| 4. Architecture canvas and pattern funnel | Pillar A — interactive design canvas | `REQ-DESIGN-001..009` |
| 8. Basic sizing studio | Pillar B — capacity calculator | `REQ-CALC-001..007` |
| 9. Knowledge and pattern search | Pillar C — reference pattern hub | `REQ-HUB-001..009` |
| 1. Workspace and project context | (enabler) server-side workspace | `REQ-DESIGN-005`, `NFR-SEC-001` |

Deliberately **not** in this build: 6R board, 6U brief, UCROPS gate, ADR module,
platform map, data-access workflow, document export, Investment/TCO. They stay
as they are.

### 2.3 What exists in ArchPilot today (verified by reading the code)

| File | Today | Verdict |
|---|---|---|
| `src/domain/store.ts` | `WorkspaceRecord` + sync `loadWorkspace`/`saveWorkspace` on `localStorage['archpilot.workspace.v1']` | Replace with an async API-backed repository |
| `src/domain/architecture.ts` | Flat `ArchitectureComponent[]` in `localStorage`, no edges, no positions | Extend to a real `ArchGraph` (nodes + edges + positions), persist server-side |
| `src/domain/sizing.ts` | `sizeApi`, `sizeStorage` — pure, already carry `range`/`confidence`/`warnings`/`formulaVersion`. **Currently dead code: `main.tsx` never imports it**; the Sizing screen is hard-coded HTML | Keep and extend. Wire it up. Fix the formulas per red-team B3 |
| `src/domain/knowledge.ts` | `searchKnowledge(records, query)` — pure in-memory substring filter with `toLocaleLowerCase('vi-VN')`. Records are hard-coded inside `main.tsx` | Keep as the client-side fallback; primary search becomes FTS5 over the API |
| `src/domain/model.ts` | `Confidence`, `Status`, `DeploymentTarget`, `EntityEnvelope`, `ArchitectureComponent/Connection` | Reuse as-is. `Confidence` is the vocabulary for benchmarks and sizing results |
| `src/domain/{requirements,review,export}.ts` | In use by `main.tsx` | Out of scope, unchanged |
| `package.json` | React, react-dom, vite, TS, lucide-react. **No test runner, no router, no canvas lib, no HTTP client** | Add `vitest`, `@xyflow/react`. No HTTP client — `fetch` is enough |

---

## 3. Detailed design

### 3.1 Integration shape

```mermaid
flowchart TB
  subgraph Browser["Browser — existing ArchPilot SPA (unchanged toolchain)"]
    UI["main.tsx modules:<br/>Architecture · Sizing · Knowledge"]
    DOM["src/domain/*.ts<br/>graph.ts · sizing.ts · knowledge.ts · store.ts"]
    API["src/api/client.ts<br/>fetch wrapper, credentials: include"]
    CACHE[("localStorage<br/>offline cache only,<br/>no longer source of truth")]
    UI --- DOM
    DOM --- API
    DOM -.write-through.- CACHE
  end

  subgraph Container["Single Docker container — on-prem host"]
    STATIC["StaticFiles mount<br/>serves built SPA (same origin)"]
    FAST["FastAPI<br/>/api/auth /api/workspaces /api/designs<br/>/api/sizings /api/benchmarks /api/patterns<br/>/api/admin/* /api/events /api/health"]
    SEC["Local auth<br/>PBKDF2 + opaque session cookie"]
    LEGAL["Legal gate<br/>content_hash invariant"]
    STATIC --- FAST
    FAST --- SEC
    FAST --- LEGAL
  end

  DB[("SQLite WAL<br/>users · sessions · workspaces · designs<br/>sizing_scenarios · benchmarks · patterns<br/>legal_reviews · takedown_requests · events<br/>+ patterns_fts")]
  BAK[("VACUUM INTO snapshots<br/>+ Litestream WAL stream")]

  API -->|HTTPS| STATIC
  FAST --> DB
  DB --> BAK
```

**One container, two artefacts.** The Dockerfile builds the Vite SPA in a Node
stage and copies `dist/` into the Python image as `backend/static/`. FastAPI
serves it at `/` when that directory exists. Same origin means no CORS in
production and a first-party session cookie. In development the Vite dev server
runs on `:5173` and CORS is configured for it.

### 3.2 Key decisions

| # | Decision | Rationale | Trade-off accepted |
|---|---|---|---|
| **D1** | Fold into `ArchPilot/`, do not build a second app | ArchPilot's Phase 1 already promises these three modules; a parallel app would fork the product | ArchPilot's `main.tsx` was one 292-line file with all screens inline. **Paid off at v1.3 (task 1.1):** it is now 21 lines of bootstrap, with one file per screen under `src/features/<module>/` |
| **D2** | Python/FastAPI backend, **not** Node/Fastify | PO decision; matches the repo's `tools/` Python convention; 3 runtime deps | **Loses the architects' "one shared `packages/core`" benefit (D1/C5 in their doc).** Mitigated by D3 below — this is the single biggest cost of the stack switch and reviewers should attack it first |
| **D3** | **Sizing arithmetic lives only in TypeScript. The server never computes a sizing number.** The server owns the *benchmark inputs* (with citations) and stores the client's result plus a benchmark snapshot | There is exactly one implementation, so client/server drift is impossible by construction, not by discipline. Also satisfies `NFR-PERF-002` (<500 ms) with no round trip | A malicious client could POST a fabricated sizing result. Acceptable: 2–4 trusted internal users, and the stored `benchmark_snapshot_json` + `formula_version` make any result reproducible and auditable |
| **D4** | **BUILT.** The `ArchGraph` shape *and three envelope rules* (camelCase casing, `{detail, requestId?}` errors, ISO-8601-UTC timestamps) are defined once in `contracts/archgraph.schema.json`; `jsonschema` in pytest and `ajv` in vitest validate **the same fixture files** off **one manifest**. Amended after review: envelope drift, not graph drift, is what actually caused a bug | Restores most of the shared-schema benefit without sharing a language, and both validators are standards-compliant 2020-12 implementations, so agreement is a property of the standard rather than of our discipline | A hand-maintained schema file plus two test harnesses (~120 lines each). One test-only dependency per language (`jsonschema`, `ajv`) — the backend's **runtime** dependency count stays at three. No OpenAPI, no codegen: reviewed and confirmed right-sized |
| **D5** | `localStorage` becomes a write-through **cache**, never the source of truth. One-time import of existing local data on first login | Existing prototype data is not thrown away; `REQ-DESIGN-005` (reload in the same state, on any machine) becomes true | A cache-invalidation path to get wrong. Kept trivial: cache is read only when the API call fails, and is cleared on logout |
| **D6** | Local auth = PBKDF2-HMAC-SHA256 (stdlib `hashlib`) + opaque session token, SHA-256 of the token stored server-side | No bcrypt/argon2/passlib dependency; a DB leak yields neither passwords nor replayable sessions | PBKDF2 is memory-cheap vs argon2id. Per-user `password_iterations` column allows raising the factor or swapping the scheme without a destructive migration |
| **D7** | Both layers enforce the legal gate: an application `content_hash` check **and** a SQLite trigger that resets `status` to `draft` on any content edit | Red-team B1. A trigger also catches a migration or a manual `sqlite3` session — the exact hole B1 described | An approval is revoked by a whitespace-only edit. Correct behaviour; the editor is told why |
| **D8** | No LLM, no vendor, no API key, no spend cap, no prompt logging | PO decision 5/6 | The "suggest 3 patterns" differentiator is deferred. At 12 patterns, facets + FTS5 answer the same question |
| **D9** | FTS5 tokenizer `unicode61 remove_diacritics 2` | ArchPilot is a bilingual VI/EN product; "kiến trúc" and "kien truc" must both match | Changing the tokenizer later needs an index rebuild. Set correctly now |

### 3.3 SQLite schema

Shipped as forward-only migrations in `ArchPilot/backend/app/migrations/`.
Full DDL is in those two files; this is the map and the invariants.

```mermaid
erDiagram
  users ||--o{ sessions : "has"
  users ||--o{ workspaces : "owns"
  workspaces ||--o{ designs : "contains"
  users ||--o{ designs : "owns"
  designs ||--o{ sizing_scenarios : "has"
  patterns ||--o{ legal_reviews : "approved by (content_hash)"
  patterns ||--o{ takedown_requests : "subject of"
  patterns ||--o{ designs : "seeded (provenance)"
  patterns ||--|| patterns_fts : "synced by triggers"
```

| Table | Migration | Purpose | Enforced invariant |
|---|---|---|---|
| `users` | 001 | Local accounts | `role IN (member, editor, admin)`; per-user KDF iterations |
| `sessions` | 001 | Opaque sessions | Only `sha256(token)` is stored; `expires_at` checked on every request |
| `workspaces` | 001 | Server home for `store.ts`'s `WorkspaceRecord` | Owner-scoped |
| `designs` | 001 | One `ArchGraph` JSON per design | `visibility` defaults `private` (`NFR-SEC-001`); `seeded_from_pattern_id` keeps takedown reach (`M10`) |
| `sizing_scenarios` | 001 | `REQ-CALC-007` | `benchmark_snapshot_json` + `formula_version` **NOT NULL** — a saved number stays reproducible when benchmarks change (`M8`) |
| `benchmarks` | 001 | Per-node capacity, editable without a deploy (`NFR-EXT-001`) | **Trigger: `confidence` in (`measured`,`declared`) requires a `source_url`** (`M7`) |
| `events` | 001 | `NFR-OBS-001` business analytics | Request logs go to stdout instead |
| `health_probe` | 001 | Deep health-check write target | `/api/health` writes here (`M12`) |
| `patterns` | 002 | Hub content | Attribution columns **NOT NULL + non-blank CHECK** (`REQ-HUB-005`); `content_hash` NOT NULL |
| `legal_reviews` | 002 | `NFR-LEGAL-001` audit trail | **`content_hash` NOT NULL** (`B1`); append-only triggers block UPDATE/DELETE |
| `takedown_requests` | 002 | `NFR-LEGAL-002` | `derived_design_count` recorded at resolution (`M10`) |
| `patterns_fts` | 002 | `REQ-HUB-004` | **Three sync triggers** (`M1`) + VI-diacritic-folding tokenizer |

**The B1 invariant, stated precisely.** `content_hash` = SHA-256 over a
length-prefixed canonical encoding of `title ‖ summary_one_line ‖ body_md ‖
graph_json ‖ categories_json ‖ source_company ‖ source_url ‖ source_title ‖
source_published_date`. JSON fields are re-serialised with sorted keys so an
incidental key reorder does not revoke a valid approval. Publish requires
`patterns.content_hash == legal_reviews.content_hash` for an `approved` review.
Any edit to those columns fires `trg_patterns_reset_status_on_content_change`,
which sets `status='draft'` and nulls `published_at`. Per PO decision 3 there is
**no** `reviewer_id != author_id` check — self-certification is allowed — but the
hash binding is not relaxed.

### 3.4 API surface

Bold = implemented (Phase-0 scaffold, plus v1.4 workspaces and designs, plus v1.5 benchmarks). Everything else is scoped, not built.

| Method | Path | Auth | Requirement |
|---|---|---|---|
| **GET** | **`/api/health/live`** | none | liveness |
| **GET** | **`/api/health`** | none | `NFR-AVAIL-001`, `M12` — deep read+write probe, 503 on failure |
| **POST** | **`/api/auth/login`** | none | Decision 4 |
| **POST** | **`/api/auth/logout`** | session | — |
| **GET** | **`/api/auth/me`** | session | — |
| **GET / PUT** | **`/api/workspaces/current`** | session | ArchPilot module 1. **v1.4:** `WorkspaceRecord` shape; GET 404 until one exists; PUT `revision` = last seen (0 creates), stale → 409 |
| **GET / POST** | **`/api/designs`** | session | `REQ-DESIGN-001/005`. **v1.4:** list is `?limit=` (1–100, default 50) `&offset=`, newest first, no graphs; POST `{name, graph}` → 201. `POST {seededFromPatternId}` (`REQ-HUB-007`) is **not** accepted yet — it lands with 6.1 so provenance cannot be forged by a client |
| **GET / PUT / DELETE** | **`/api/designs/{id}`** | session (owner) | `REQ-DESIGN-004/005`; non-owner gets **404, not 403**. **v1.4:** PUT `{name, graph, revision}` full replace, stale → 409; DELETE is soft → 204 |
| **GET** | **`/api/benchmarks`** | session (any user) | `REQ-CALC-003`, `M7` — every row carries its citation. **v1.5:** shared reference data (not owner-scoped), `?componentType=`, one row per metric, `sourceTitle` always non-blank (migration 004), `sourceUrl` required for measured/declared (001), `origin` `seed`/`user`. Read-only (405 on POST); editing arrives with the admin surface |
| GET / POST | `/api/designs/{id}/sizings` | session (owner) | `REQ-CALC-007` |
| POST | `/api/sizings/review` | session | Deterministic rules only, **no LLM** (Decision 5) |
| GET | `/api/patterns` | session | `REQ-HUB-001/003/004/006` — `?q=&category=&company=&sort=`, published only |
| GET | `/api/patterns/{slug}` | session | `REQ-HUB-002/005` |
| POST | `/api/patterns/{slug}/report` | session | `NFR-LEGAL-002` |
| GET/POST/PUT | `/api/admin/patterns[/{id}]` | editor/admin | `REQ-HUB-009` |
| POST | `/api/admin/patterns/{id}/legal-review` | editor/admin | `NFR-LEGAL-001` — records `content_hash` |
| POST | `/api/admin/patterns/{id}/publish` | editor/admin | **409 unless the hash matches** |
| POST | `/api/admin/patterns/{id}/unpublish` | editor/admin | one-click takedown |
| GET/PATCH | `/api/admin/takedowns[/{id}]` | admin | `NFR-LEGAL-002` |
| POST | `/api/events` | session | `NFR-OBS-001` |

All search goes through one `search_published_patterns()` repository function
that joins `patterns_fts` to `patterns` and filters `status='published'`. Nothing
else may query `patterns_fts` directly (`M1`).

### 3.5 Frontend changes, file by file

#### 3.5.1 New files

| File | Responsibility |
|---|---|
| `src/api/client.ts` ✅ **v1.4** | `fetch` wrapper: same-origin URLs, `credentials: 'include'`, `x-request-id`, `x-csrf-token` from the `archpilot_csrf` cookie on unsafe methods, JSON encode/decode with **no** case conversion (the wire is camelCase), typed `ApiError` (`status`, `detail`, `requestId`, `kind: 'http' \| 'unreachable'`), 401 → registered handler → login. No HTTP library |
| `src/api/auth.ts` ✅ **v1.4**; `workspace.ts` ✅ **v1.5**; `benchmarks.ts` ✅ **v1.5**; `designs.ts`, `patterns.ts`, `sizings.ts` | One thin module per resource; the only place a URL string appears. `designs.ts` lands with 2.5 |
| `src/features/auth/LoginScreen.tsx` ✅ **v1.4** | Username/password form, VI/EN via `copy()`, error states: wrong password, throttled, server unreachable, empty fields; session-expired and signed-out notices |
| `src/domain/graph.ts` | `ArchGraph`, `ArchNode`, `ArchEdge`, `NodeType`, `PALETTE`, `validateGraph()`, `diffGraphs()`, `migrateGraph()` |
| `src/domain/benchmarks.ts` ✅ **v1.5** | `BenchmarkRow` (wire), `pairBenchmarks()` (read_qps + write_qps rows → one dual-capacity option; the weaker confidence wins; a URL is kept only if both rows share it), `builtInBenchmarkOptions()` used only when `/api/benchmarks` cannot be reached |
| `src/domain/sizingCalculator.ts` ✅ **v1.5** | The Sizing screen's model: peak read/write → the engine's average + ratio (exact inverse, tested), substituted formula lines, the single-benchmark shortcut comparison, deterministic bilingual review hints that mirror every engine warning one-for-one (tested), per-field bilingual validation. No sizing arithmetic of its own (D3) |
| `src/features/canvas/*`, `src/features/sizing/*` ✅ **v1.5**, `src/features/patterns/*` | The three screens. Sizing is done; canvas and patterns are open |
| `contracts/archgraph.schema.json` | The one graph contract, validated by both languages (D4) |

#### 3.5.2 Changes to the four existing domain modules

| File | Change | Why | Breaking? |
|---|---|---|---|
| **`store.ts`** ✅ **done (v1.5)** | `loadWorkspace(): WorkspaceRecord \| null` → `loadWorkspace(): Promise<WorkspaceRecord \| null>` calling `GET /api/workspaces/current`. `saveWorkspace(...)` → `Promise<WorkspaceRecord>` calling `PUT`. Keep the `localStorage` write as a read-only fallback cache, and add `importLegacyLocalWorkspace()` run once after first login. `revision` is now assigned by the server, not `previous.revision + 1` | Source of truth moves to SQLite; `revision` incremented client-side is wrong the moment two browsers exist | **Yes** — sync→async. Call site: `main.tsx` `useState(() => loadWorkspace())` becomes a `useEffect` load + loading state |
| **`architecture.ts`** | `ArchitectureComponent[]` becomes `ArchGraph` (`nodes` + `edges` + `position`). `loadComponents`/`saveComponents` → `loadDesign(id)`/`saveDesign(id, graph)` over `/api/designs/{id}`. `seedComponents` stays as the empty-canvas starter. `createComponent`'s `Date.now()` ID is replaced by a collision-safe `crypto.randomUUID()` | Edges and positions are `REQ-DESIGN-003/004/005`; the current model has neither. `Date.now()` collides on a fast double-click | **Yes** — shape change. A `migrateComponentsToGraph()` helper converts existing localStorage data in one pass (nodes laid out on a grid, no edges) |
| **`sizing.ts`** ✅ **done (v2.0)** | Keep `SizingResult`'s shape (it already has `range`/`confidence`/`warnings`/`formulaVersion` — better than the architects' proposal). Add the corrected engine (§3.6) with `assumptions: string[]` and `formula: string` **required** by the type. `sizeApi(peakRps, capacityPerInstance, ...)` is replaced by `sizeComponent(inputs, benchmarks)` taking **dual read/write capacity**. Benchmarks arrive from `GET /api/benchmarks`, not from a constant | The current single `capacityPerInstance` cannot consume the dual read/write benchmarks the design itself defines (`B3b`); `sizeStorage` has no compression term (`B3c`) and applies replication to storage only (`B3a`); neither applies a failure-domain spare (`B3d`) | **Yes** — but the module is currently *unused* by `main.tsx`, so there are no call sites to break. Cheapest possible moment to fix it |
| **`knowledge.ts`** | `searchKnowledge()` stays exactly as-is and becomes the **offline/fallback** path. Primary search becomes `GET /api/patterns?q=` (FTS5). `KnowledgeRecord` gains required `sourceUrl`, `sourceCompany`, `sourceTitle` (currently `source?: string`, optional and free-text) | `REQ-HUB-005`: no entry may render without attribution. Optional `source?: string` cannot enforce that | **Minor** — `source?` widening to three required fields. The 4 hard-coded records in `main.tsx` move into the seed content set |

#### 3.5.3 `main.tsx` was split first — **done (task 1.1, v1.3)**

`main.tsx` was 292 lines holding every screen as an inline function, with JSX
lines over 3,000 characters. Adding a canvas, a calculator and a hub to it was
not viable. It is now 21 lines of bootstrap:

| Path | Responsibility |
|---|---|
| `src/main.tsx` | bootstrap only — `createRoot`, `render`, the `__archPilotRoot` HMR guard |
| `src/app/App.tsx` | the shell: sidebar, topbar, VI/EN toggle, module switch, the two modals. Owns no screen content |
| `src/app/navigation.ts` | `ModuleKey` + `navItems`. One `ModuleKey` value ↔ one `src/features/` directory |
| `src/app/App.test.tsx` | 6 shell regression tests (jsdom): every module renders its own screen, the architecture module renders **both** panes, the language toggle, both modals |
| `src/ui/copy.ts` | `Copy`, `copy(vi, en)`, and the `TextFn` alias every screen takes |
| `src/ui/PageHeader.tsx`, `ModulePanel.tsx`, `DatabaseIcon.tsx` | the three components shared by more than one screen |
| `src/features/<module>/<Name>Screen.tsx` | one file per screen, 16 of them, keyed to `ModuleKey` |
| `src/features/architecture/ArchitectureEditor.tsx` | the second pane the architecture module renders alongside its screen |
| `src/features/investment/InvestmentModal.tsx`, `src/features/workspace/WorkspaceModal.tsx` | the two modals the shell owns |

Verification was a **before/after DOM diff**, not a screenshot: the real SPA was
booted in jsdom, all 16 modules walked in both languages and both modals opened
and closed, and the resulting 36 DOM states hashed. Before and after are
byte-identical (`sha256 c3d5f0bf…c442d62b`). The harness was thrown away; the
six tests in `App.test.tsx` are what stayed.

`src/features/sizing/SizingScreen.tsx` was moved **unchanged** and is still
hard-coded HTML with no import of `src/domain/sizing.ts`. Wiring it to the v2.0
engine is task 3.4 and is deliberately not part of this refactor.

### 3.6 Corrected sizing engine (red-team B3) — **implemented**

Units are in the names, and every conversion constant is stated (`m3`).
Shipped in `ArchPilot/src/domain/sizing.ts` as `formulaVersion: '2.0'`, tested by
`ArchPilot/src/domain/sizing.test.ts` (34 tests). Two deliberate refinements
against the pseudocode below, both explained in
`docs/development/systemsarchitect-contracts-and-sizing.md`:

1. `spareNodes` is added **outside** the confidence band, not inside it — how
   many nodes may fail is a policy the team picks, not something the benchmark
   is uncertain about.
2. Storage is driven by **average** write QPS, not peak. Peaks change how many
   nodes you need; they do not change how many bytes are retained.

```
// inputs: avgQps, avgRecordKiB, readWriteRatio, retentionMonths,
//         peakFactor (3.0), replicationFactor (3), indexOverhead (0.30),
//         compressionRatio (1.0 default, "compression not modelled"),
//         headroom (0.30), spareNodes (1)

writeFraction       = 1 / (1 + readWriteRatio)              // 9:1 -> 0.10
readQps             = avgQps * (1 - writeFraction)
writeQps            = avgQps * writeFraction
peakReadQps         = readQps  * peakFactor
peakWriteQps        = writeQps * peakFactor

// B3(a) replication amplifies WRITES, not only storage
effectiveWriteQps   = peakWriteQps * replicationFactor

avgRecordBytes      = avgRecordKiB * 1024                   // 1 KiB = 1024 B
retentionDays       = retentionMonths * 30.44               // 1 month = 30.44 d
bytesPerDay         = writeQps * avgRecordBytes * 86400

// B3(c) compression term; default 1.0 so the label stays honest
storageBytes        = bytesPerDay * retentionDays * replicationFactor
                      * (1 + indexOverhead) / compressionRatio

ingressBytesPerSec  = writeQps * avgRecordBytes
egressBytesPerSec   = readQps  * avgRecordBytes

// B3(b) dual capacity + B3(d) failure-domain spare
nodeCount = ceil( max( peakReadQps      / readCapacityPerNode,
                       effectiveWriteQps / writeCapacityPerNode )
                  * (1 + headroom) ) + spareNodes
```

Output is a **range, not a point** (`M8`), widened from the weakest input
benchmark's confidence tag: `measured` ±10%, `declared` ±25%, `estimated` ±50%,
`unverified` ±100%. The UI renders `14–30 instances (point estimate 20)`. The
disclaimer travels inside the JSON export envelope, not only on screen.

`sizeStorage`'s existing hard-coded `low: *0.8 / high: *1.3` band is replaced by
this confidence-derived band.

---

## 4. Step-by-step plan

**Team:** E1 (frontend-leaning), E2 (backend/full-stack), C (content editor,
50%), Q (BA/QA, 50%), PO. Effort in person-days (pd). 9 calendar weeks.

### Phase 0 — Foundations (7 pd) · **5.5 pd delivered, 1.5 pd open**

| # | Task | Owner | Depends on | Effort | Verification |
|---|---|---|---|---|---|
| 0.1 | ~~FastAPI skeleton, config, JSON logging, request IDs~~ | E2 | — | ~~1~~ **done** | `uvicorn app.main:app` starts; `/api/health` returns 200 |
| 0.2 | ~~SQLite migration runner + `001_core.sql` + `002_patterns_legal.sql`~~ | E2 | 0.1 | ~~1.5~~ **done** | `pytest` — migrations idempotent, WAL on |
| 0.3 | ~~Local auth: login/logout/me, PBKDF2, session cookie, throttle~~ | E2 | 0.2 | ~~1~~ **done** | 12 auth tests pass; unauth `/api/auth/me` → 401 |
| 0.4 | ~~`VACUUM INTO` backup script + verify + prune~~ | E2 | 0.2 | ~~0.5~~ **done** | `python -m scripts.backup --verify` → `integrity_check: ok` |
| 0.5 | ~~Add `vitest` to `ArchPilot/package.json`; first test for `sizing.ts`~~ | E1 | — | ~~0.5~~ **done** | `npm test` → **57 passed** (`vitest run`, 2 files). `npm run typecheck` and `npm run build` clean |
| 0.6 | ~~`contracts/archgraph.schema.json` + shared fixtures + contract test in **both** suites, **plus the three envelope rules**~~ | E2 | 0.5 | ~~1~~ **1.25 done** | 16 shared fixtures, 9 of them deliberately broken, run by `pytest` (jsonschema) **and** `vitest` (ajv) off one manifest. Negative control performed: weakening the casing rule failed the same fixture in both suites |
| 0.7 | ~~CI: `pytest`, `npm test`, `tsc -b`, `npm run build`~~ | E2 | 0.5 | ~~0.5~~ **done** | `.github/workflows/ci.yml`: job `backend` = `ruff check` + `pytest` on a **3.12 / 3.10 matrix** (M-9 closed — 3.12 is the image, 3.10 is the documented floor, both must pass); job `frontend` = `npm ci` → `tsc -b` → `vitest` → `tsc -b && vite build` on **Node 24**. `ruff` added and the codebase made clean (15 findings fixed). `mypy --strict` deliberately deferred, see §7.2 |
| 0.8 | Docker build of the combined image; run on the on-prem host | E2 | 0.1 | 1 · **local half done (v1.4)** | **Verified locally 2026-09-23, Docker 29.8.0:** `docker build -f backend/Dockerfile .` succeeds (the `node:24-alpine` bump is no longer unverified); `docker run` → container `healthy`, SPA at `/` (200, `text/html`), `/api/health` 200 schema 003, full CRUD exercised with curl (§5). **Open:** run on the on-prem host, Compose file, TLS in front (the image sets `ARCHPILOT_COOKIE_SECURE=true`) |

### Phase 1 — Persistence spine (9 pd) · **7.5 pd delivered (1.1, 1.2, 1.3, 1.4, 1.6), 1.5 pd open (1.5)** · depends on Phase 0

| # | Task | Owner | Depends on | Effort | Verification |
|---|---|---|---|---|---|
| 1.1 | ~~**Split `main.tsx`** into `src/features/*` — pure refactor~~ | E1 | 0.5 | ~~2~~ **done** | 292 lines → 25 files (`src/app/`, `src/ui/`, `src/features/<module>/`). **Proved** by a throwaway before/after jsdom diff of all 36 states (16 modules × VI/EN + 4 modal states): identical, `sha256 c3d5f0bf…c442d62b` on both sides. `tsc -b` clean; `vite build` clean. Six kept shell tests replace the throwaway harness |
| 1.2 | ~~`src/api/client.ts` + `auth.ts`; login screen; 401 redirect~~ | E1 | 0.3, 1.1 | ~~1.5~~ **done** | Through the Vite proxy: `/api/auth/me` → 401, login → 200 with both cookies, `/me` with the cookies → 200 (refresh keeps the session). 21 client tests + 13 login-flow tests (jsdom, real `<App/>`): gate, wrong password, 429, unreachable (network error **and** the proxy's empty 502), logout sends `x-csrf-token`, a later 401 routes back to login. First user: `scripts/create_user.py` (prompt or `--password-stdin`, never argv) |
| 1.3 | ~~`GET/PUT /api/workspaces/current`~~ | E2 | 0.2 | ~~1~~ **done** | `pytest` (16): user B cannot read **or overwrite** user A's workspace; stale revision → 409 and no overwrite; `revision: 0` cannot clobber; two racing writers → exactly one wins (negative control: without the IMMEDIATE transaction both "win") |
| 1.4 | ~~Rewrite `store.ts` async + write-through cache + legacy import~~ | E1 | 1.2, 1.3 | ~~1.5~~ **done (v1.5)** | `src/domain/store.test.ts` (14): legacy `archpilot.workspace.v1` is PUT with `revision: 0` on first login and appears server-side, exactly once (a second user on the same browser does not re-import; legacy data is never deleted); not imported over an existing server workspace; 404 → `null`; 409 → newer record reloaded + reported, nothing overwritten; unreachable → owner-scoped cache + pending edit pushed on next load (or conflict if stale). `WorkspaceModal.test.tsx` (5) through the real `<App/>`. Negative control: dropping the owner check on the cache fails 2 tests. Also verified with curl against the container (§5) |
| 1.5 | `src/domain/graph.ts` — `ArchGraph`, palette, `validateGraph()` | E1 | 0.6 | 1.5 | Unit tests for the 4 validation rules |
| 1.6 | ~~Designs CRUD API, owner-scoped, **404 for non-owners**~~ | E2 | 1.3 | ~~1.5~~ **done** | `pytest` (38): cross-user read/update/delete → 404 with the same body as a missing id (negative control: dropping the owner filter fails 4 tests); **every `archGraph` fixture in the shared manifest is POSTed to the live endpoint and gets the same verdict** as in the jsonschema/ajv suites; stale revision → 409; list paginated and capped at 100; soft delete. +3 live-response contract tests (casing, timestamps, graph, and the 404/409/422 error envelopes) |

### Phase 2 — Pillar A: canvas (11 pd) · depends on Phase 1

| # | Task | Owner | Depends on | Effort | Verification |
|---|---|---|---|---|---|
| 2.1 | Add `@xyflow/react`; pan/zoom/minimap shell; 3-pane layout | E1 | 1.1 | 1.5 | Empty canvas renders |
| 2.2 | Palette → node create; 10 node types from `PALETTE` data (`REQ-DESIGN-002`) | E1 | 1.5, 2.1 | 1.5 | Dragging `service` creates a node |
| 2.3 | Labelled directional edges (`REQ-DESIGN-003`) | E1 | 2.2 | 1 | Two nodes connect with "writes to" |
| 2.4 | Inspector: rename/delete/move + rationale note (`REQ-DESIGN-004/008`) | E1 | 2.2 | 1.5 | Rationale survives reload |
| 2.5 | `architecture.ts` → API-backed; debounced autosave + `Ctrl+S` (`REQ-DESIGN-005`) | E1 | 1.6, 2.2 | 1.5 | Reload restores exact positions |
| 2.6 | Legacy `ArchitectureComponent[]` → `ArchGraph` migration | E1 | 2.5 | 0.5 | Existing components appear as nodes on a grid |
| 2.7 | Export JSON + SVG (`REQ-DESIGN-006`; SVG over PNG per `m5`) | E1 | 2.5 | 1 | Both files valid; JSON re-imports |
| 2.8 | Undo/redo depth 50 (`REQ-DESIGN-009`) | E1 | 2.4 | 1.5 | `Ctrl+Z` reverses 50 actions |
| 2.9 | Non-blocking validation warnings in the status bar (`REQ-DESIGN-007`) | E1 | 1.5 | 0.5 | Orphan node warns; save still succeeds |

### Phase 3 — Pillar B: sizing studio (8 pd) · **5.5 pd delivered (3.1–3.4)** · depends on Phase 1, parallel with Phase 2

| # | Task | Owner | Depends on | Effort | Verification |
|---|---|---|---|---|---|
| 3.1 | ~~**Corrected engine in `sizing.ts`** — B3(a)(b)(c)(d) + required `formula`/`assumptions`~~ | E2 | 0.5 | ~~2~~ **done** | 34 tests, one group per B3 term with the v1.0→v2.0 delta asserted; worked example 5000 QPS / 2 KiB / 9:1 / 12 mo → **4 nodes, ~114.6 TiB uncompressed** |
| 3.2 | ~~Confidence-derived ranges replacing the fixed 0.8/1.3 band (`M8`)~~ | E2 | 3.1 | ~~0.5~~ **done** | `estimated` → ±50% (`3–6 node (point estimate 4)`); `measured` → ±10% (`4–5`). Folded into 3.1: leaving a hard-coded band inside a file being rewritten was not defensible |
| 3.3 | ~~`benchmarks` seed + `GET /api/benchmarks`; every `declared` row cited (`M7`)~~ | E2 | 0.2 | ~~1~~ **done (v1.5)** | `tests/test_benchmarks.py` (19): **seeding an uncited `declared` row fails and writes nothing**; a CHECK typo fails too (no `INSERT OR IGNORE`); idempotent; never overwrites a user-edited row (a trigger flips `origin` to `user` on any content edit); never resurrects a deleted row (`benchmark_seed_log`); skips a slot a user row holds; every row needs a non-blank `source_title`; seed rows are all `estimated`, URL-less, labelled "generic planning heuristic". Endpoint: 401 without session, same list for two users, filter, 405 on POST, restart does not duplicate. Negative control: ignoring the seed log fails 4 tests |
| 3.4 | ~~Sizing UI: two-column, live recompute, assumptions beside every number~~ | E1 | 3.1, 1.1 | ~~2~~ **done (v1.5)** | **No number renders without its formula**: `SizingScreen.test.tsx` (12) asserts every card has formula + substituted formula + ≥1 assumption + a confidence tag; plus live recompute, dropdown fed by `/api/benchmarks` (and the built-in fallback when unreachable), measured toggle (±50% → ±10%), shortcut note (demo scenario: 6 vs 11 nodes, 45% too small), hints, accessible validation, VI/EN. `sizingCalculator.test.ts` (22). The 34 engine tests are unchanged and green |
| 3.5 | 4 workload profiles (`REQ-CALC-005`) | E2 | 3.1 | 0.5 | Selecting a profile pre-fills; user can override |
| 3.6 | Attach scenario to a node + `benchmark_snapshot_json` pinning (`REQ-CALC-007`, `M8`) | E2 | 1.6, 3.3 | 1.5 | Reopening a design shows the attached sizing, unchanged after a benchmark edit |
| 3.7 | `POST /api/sizings/review` — deterministic rules, **no LLM** | E2 | 3.1 | 0.5 | Rules fire on `peakFactor = 1.0`, retention > 24 mo with `compressionRatio = 1.0` |

### Content track — 12 seed patterns (10 pd, weeks 1–7) · gated on G0.2

| # | Task | Owner | Depends on | Effort | Verification |
|---|---|---|---|---|---|
| C.1 | ~~**G0.2**: PO signs the 5-item content-IP policy~~ → `docs/pattern-content-policy.md`. **DONE 2026-09-23** — approved via chat, formal signature waived by PO, recorded in the doc's Sign-off section | PO | — | 0.5 | Policy committed |
| C.2 | Shortlist 12 patterns, one per category + 3 doubles, with source URLs | C + Q | C.1 | 1 | PO review |
| C.3 | Author 12 original summaries; diagrams written **as `ArchGraph` JSON by hand** (`M4` — do not wait for the canvas) | C | C.2, 0.6 | 7 | Word-count + self-check per entry |
| C.4 | Self-certify each entry against the checklist (`NFR-LEGAL-001`) | C | C.3 | 1 | 12 `legal_reviews` rows with a matching `content_hash` |
| C.5 | Idempotent import script: skip existing slugs; refuse to overwrite `published`/`unpublished` without `--force` **and** `CONFIRM_OVERWRITE_REVIEWED=1` (`B2`) | E2 | 0.2 | 0.5 | Re-running the seed cannot resurrect an unpublished pattern |

### Phase 4 — Pillar C: pattern hub, read side (7 pd) · depends on Phase 1

| # | Task | Owner | Depends on | Effort | Verification |
|---|---|---|---|---|---|
| 4.1 | `GET /api/patterns` — published-only filter, facets, sort | E2 | 0.2 | 1.5 | Test: a draft with a unique token returns 0 rows |
| 4.2 | FTS5 search via the single `search_published_patterns()` function (`M1`) | E2 | 4.1 | 1 | VI-diacritic test already passing |
| 4.3 | Gallery UI: cards, filter sidebar, search, sort; **attribution on every card** (`M10`) | E1 | 4.1, 1.1 | 2 | Filtering by a category shows only that category |
| 4.4 | Detail page: Markdown body, decision table, read-only graph render, non-collapsible attribution banner | E1 | 4.3, 1.5 | 2 | Every entry shows source name + resolving link |
| 4.5 | `knowledge.ts` widened to required attribution fields; fallback path retained | E1 | 4.1 | 0.5 | A record without `sourceUrl` fails `tsc` |

### Phase 5 — Editorial + legal gate (7 pd) · depends on Phase 4 + C.1

| # | Task | Owner | Depends on | Effort | Verification |
|---|---|---|---|---|---|
| 5.1 | Admin pattern CRUD + status state machine | E2 | 4.1 | 2 | New pattern publishable with no deploy (`NFR-EXT-001`) |
| 5.2 | **Legal-review endpoint recording `content_hash`; publish 409s on mismatch** (`B1`) | E2 | 5.1 | 1 | Edit-after-approval → `draft`; publish rejected |
| 5.3 | Admin UI: editor form + 5-item checklist (self-certify, no second reviewer) | E1 | 5.1 | 2 | Approve disabled until all 5 boxes are checked |
| 5.4 | Takedown: report form → `takedown_requests` → one-click unpublish; record `derived_design_count` and suppress attribution on derived designs (`M10`) | E2 | 5.1 | 1.5 | Unpublished pattern 404s within seconds; tabletop drill |
| 5.5 | Nightly one-way DB → `content/patterns/*.md` export for audit (`B2`) | E2 | C.5 | 0.5 | Export diffable in Git |

### Phase 6 — Integration (5 pd) · depends on Phases 2, 3, 4

| # | Task | Owner | Depends on | Effort | Verification |
|---|---|---|---|---|---|
| 6.1 | Apply to canvas — deep copy + new IDs + provenance (`REQ-HUB-007`) | E2 | 2.5, 4.1 | 1 | New editable design seeded from a pattern |
| 6.2 | Compare — **three-tier diff**: type counts, normalised labels, edge shapes (`M11`) | E2 | 6.1 | 2 | "Pattern has 2 caches, yours has 0" renders without label matching |
| 6.3 | `events` writes for `sizing_run`, `pattern_applied`, `pattern_viewed`, `design_saved` (`NFR-OBS-001`) | E2 | 1.6 | 0.5 | Rows appear after a scripted session |
| 6.4 | Read-only share link, expiry 30 days, session required, revocable (`M9`) | E2 | 1.6 | 1.5 | Revoked token 404s; page sends `Referrer-Policy: no-referrer` |

### Phase 7 — Hardening & launch (8 pd)

| # | Task | Owner | Depends on | Effort | Verification |
|---|---|---|---|---|---|
| 7.1 | Accessibility: keyboard canvas nav, ARIA labels, contrast (`NFR-A11Y-001`) | E1 | Phase 2 | 2.5 | axe-core: 0 critical; full keyboard pass |
| 7.2 | Performance: canvas < 150 ms on 100 nodes, recompute < 500 ms | E1 | Phases 2–3 | 1 | Profiler + unit benchmark |
| 7.3 | CSRF double-submit token for cookie-authenticated mutating routes | E2 | 1.2 | 1 | Cross-site POST without the token → 403 |
| 7.4 | Litestream WAL replication + point-in-time restore drill (`B4`) | E2 | 0.4, 0.8 | 1 | Restore to a timestamp; `/api/health` reports the expected schema |
| 7.5 | **G3 pre-launch legal audit** of all 12 entries | Q + PO | C.4, 5.2 | 1 | Signed audit, zero exceptions (MVP AC 4) |
| 7.6 | Usability check, Engineer-Emma profile (`NFR-USE-001`) | Q | Phase 6 | 0.5 | 3-component design in < 10 min |
| 7.7 | **Remediation buffer** for 7.5 / 7.6 findings | E1 + E2 | 7.5, 7.6 | 3 | Findings closed or explicitly deferred |
| 7.8 | Runbook + MVP sign-off | E2 + PO | all | 0.5 | Walk MVP AC 1–6 |

### Effort roll-up

| Track | pd | Calendar |
|---|---|---|
| Phase 0 foundations (**6 pd of 7 done** — 0.8 is built and run locally; on-prem run remains) | 7 | Week 1 |
| Phase 1 persistence spine (**7.5 pd of 9 done** — 1.1, 1.2, 1.3, 1.4, 1.6) | 9 | Weeks 1–2 |
| Phase 2 canvas (E1) | 11 | Weeks 2–5 |
| Phase 3 sizing (**5.5 pd of 8 done** — 3.1–3.4) | 8 | Weeks 2–4 |
| Content track (C, parallel) | 10 | Weeks 1–7 |
| Phase 4 hub read side | 7 | Weeks 4–6 |
| Phase 5 editorial + legal gate | 7 | Weeks 5–7 |
| Phase 6 integration | 5 | Weeks 7–8 |
| Phase 7 hardening + launch | 8 | Weeks 8–9 |
| **Engineering total** | **62 pd** (**47 remaining** after 0.1–0.7, 1.1–1.4, 1.6, 3.1–3.4) | |
| **Content total** | **10 pd** | |

Two engineers × 9 weeks ≈ 90 pd of raw capacity; 62 pd of planned work is ~69%
utilisation, which leaves room for PR review, gate waits and the 3 pd
remediation line the red-team's `M5` asked for. **Critical path:** G0.2 → C.3
authoring → C.4 self-certify → 5.2 publish gate → 7.5 audit → launch. The canvas
and sizing pillars are not on it.

---

## 5. How to run & test (what I actually ran)

```bash
# backend
cd ArchPilot/backend
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements-dev.txt
.venv/Scripts/python.exe -m ruff check .          # same command CI runs
.venv/Scripts/python.exe -m pytest
.venv/Scripts/python.exe -m scripts.create_user admin --role admin   # prompts twice (v1.4)
.venv/Scripts/python.exe -m uvicorn app.main:app --port 8000

# frontend
cd ArchPilot
npm install
npm test          # vitest run
npm run typecheck # tsc -b
npm run build     # tsc -b && vite build
npm run dev       # :5173, proxies /api -> 127.0.0.1:8000 (v1.4); open it and sign in

# container (v1.4) - Git Bash on Windows needs MSYS_NO_PATHCONV=1
docker build -f backend/Dockerfile -t archpilot:dev .
docker run -d --rm --name archpilot -p 18000:8000 archpilot:dev
printf '%s\n' "$PW" | docker exec -i archpilot python -m scripts.create_user alice --role admin --password-stdin
docker stop archpilot   # --rm also removes the anonymous /data volume
```

Observed on 2026-09-23 (Windows 10, Python 3.10.11, SQLite 3.40.1, Node 24.18.0):

| Command | Result |
|---|---|
| `ruff check .` (v1.5) | `All checks passed!` |
| `pytest` (v1.5) | **174 passed**, 95 s. New: `test_benchmarks.py` 19, `test_contracts.py` +1 (benchmark casing/timestamps). `test_schema_invariants.py`: the "estimated may omit a URL" fixture row now carries a `source_title`, as migration 004 requires |
| `npm test` (v1.5) | **150 passed**, 9 files (`sizing` 34, `contract` 23, `App` 6, `api/client` 21, `LoginScreen` 13, **`store` 14, `WorkspaceModal` 5, `sizingCalculator` 22, `SizingScreen` 12**). `LoginScreen.test.tsx`'s fake backend learned `GET /api/workspaces/current` → 404 (the shell now asks for it) |
| `npm run typecheck` / `npm run build` (v1.5) | clean · `index-*.js 335.46 kB (gzip 101.28 kB)` |
| negative controls (v1.5) | cache owner check removed from `store.ts` → **2 tests fail**; seed-log check removed from `seed_benchmarks` → **4 tests fail**. Both restored |
| container (v1.5): `docker build -f backend/Dockerfile -t archpilot:task-3x .`, `docker run -d --name archpilot-test-3x -p 18081:8000 -v archpilot-test-3x-data:/data` | healthy; log `applying migration 004_benchmark_seed.sql` → `benchmarks seed 2026-09-24.1: inserted 10, already seeded 0, skipped … 0`; `/api/health` `schemaVersion "004"`; `create_user tester3x --role member --password-stdin` → exit 0 |
| curl, workspace (v1.5; `Secure` cookies over http, so the `Cookie` header is passed explicitly) | GET before first save → **404** `no workspace yet` · PUT rev 0 → 200 rev 1 · PUT rev 1 → 200 rev 2 · PUT rev 1 again → **409** `you sent revision 1 but the current revision is 2; reload and re-apply your change` · PUT without `x-csrf-token` → **403** · GET → 200 rev 2 (and still rev 2 after a container restart) |
| curl, benchmarks (v1.5) | no cookie → **401** · as a `member` → 200, `total 10`: cache 80000/80000, database 8000/2000, object_store 1000/500, queue 20000/10000, service 1000/1000, every row `estimated`, `origin seed`, `sourceUrl null`, `sourceTitle "ArchPilot generic planning heuristic - not a vendor benchmark and not a measurement. …"` · `?componentType=queue` → 2 rows · POST → **405** · after `docker restart`: still `total 10` · `python -m scripts.seed_benchmarks` in the container → `inserted 0, already seeded 10` · the served bundle contains the calculator (`single-benchmark shortcut would say`, `/api/benchmarks`, `archpilot.workspace.cache.v2`). Container, volume and image removed afterwards; `archpilot-v1` untouched |
| `ruff check .` (v1.4) | `All checks passed!` |
| `pytest` (v1.4) | **154 passed**, 1 warning (the same starlette-internal `anyio` deprecation), 74 s. New: `test_workspaces.py` 16, `test_designs.py` 38, `test_create_user_script.py` 7, `test_contracts.py` +3 |
| `npm test` (v1.4) | **97 passed**, 5 files (`sizing` 34, `contract` 23, `App` 6, `api/client` 21, `features/auth/LoginScreen` 13) |
| `npm run typecheck` / `npm run build` (v1.4) | clean · `✓ 1909 modules transformed` · `index-*.js 305.40 kB (gzip 90.56 kB)` |
| negative controls (v1.4) | owner filter removed from `designs.py` → **4 tests fail**; IMMEDIATE transaction removed from `workspaces.put_current` (with a widened race window) → concurrency test fails with `['ok', 'ok']` (a lost update); restored code passes with the same widened window |
| `docker build -f backend/Dockerfile .` (v1.4, Docker 29.8.0) | succeeds; container reaches `healthy`; `GET /` → 200 `text/html` (SPA), `/api/health` → `{"status":"ok","env":"production","schemaVersion":"003",…}` |
| `docker exec -i … scripts.create_user … --password-stdin` | `created user alice (admin)` exit 0 · 5-char password → exit 2 `password must be at least 12 characters` · no TTY and no flag → exit 2, refuses rather than hangs |
| curl against the container (v1.4) | login → 200 with `archpilot_session` (`HttpOnly; Secure; SameSite=lax`) and `archpilot_csrf` (`Secure`, readable) · `POST /api/designs` **without** `x-csrf-token` → 403 `csrf check failed: missing csrf token`, with a forged one → 403 `csrf token mismatch` · with it → **201** + `location: /api/designs/dsg_…` · GET → 200 · list → 200 · PUT rev 1 → 200 rev 2 · PUT rev 1 again → **409** `you sent revision 1 but the current revision is 2` · snake_case graph → 422 `graph does not match the ArchGraph contract - …` · **as bob:** GET/PUT/DELETE alice's design → **404** `design not found` (identical to a nonexistent id), list → `{"items":[],"total":0}`, workspace → 404 · DELETE as alice → 204, then GET → 404 · no cookie → 401 |
| dev pair: uvicorn :8000 + vite :5173 (v1.4) | through the proxy: `/` serves `index.html` (`<div id="root">`, `/src/main.tsx`) · `/api/auth/me` → **401** · login → 200, both cookies `secure=FALSE` (dev) · `/me` with the jar → 200. With uvicorn stopped the proxy answers **502, empty body**, which `client.ts` reports as "server unreachable". Both processes stopped afterwards; ports 8000/5173 free |
| `ruff check .` (v1.3) | `All checks passed!` — 15 findings existed before and were fixed, not suppressed |
| `pytest` (v1.3) | **90 passed**, 1 warning (a starlette-internal `anyio` deprecation), 11.8 s |
| `npm test` (v1.3) | **63 passed**, 3 files (`sizing.test.ts` 34, `contract.test.ts` 23, `App.test.tsx` 6), 3.0 s |
| `npm run typecheck` (v1.3) | clean, no output |
| `npm run build` (v1.3) | `✓ 1906 modules transformed` · `built in 671ms` · `dist/assets/index-*.js 296.81 kB (gzip 87.52 kB)` |
| before/after DOM diff of the `main.tsx` split | 36/36 states identical, `sha256 c3d5f0bf…c442d62b` on both sides, 0 differing entries |
| `pytest` (v1.2, historical) | **90 passed**, 11.7 s |
| `npm test` (v1.2, historical) | **57 passed**, 2 files, 0.8 s |
| `pytest` (v1.0, historical) | **36 passed**, 4.12 s |
| `python -m scripts.init_db --create-user admin --role admin` | `migrations applied this run: ['001', '002']` · `created user admin (admin) id=usr_…` |
| `curl /api/health` | `200` · `{"status":"ok","version":"0.1.0","env":"development","schemaVersion":"003","checks":[{"name":"sqlite_read","status":"ok","detail":"schema 003","latencyMs":2.52},{"name":"sqlite_write","status":"ok","latencyMs":0.06}]}` — camelCase since v1.1 (review M-5) |
| `curl -X POST /api/auth/login` (correct password) | `200` · `{"user":{"id":"usr_…","username":"admin","displayName":"…","role":"admin"},"expiresAt":"2026-09-23T06:26:52+00:00","csrfToken":"…"}` + `Set-Cookie: archpilot_session=…; HttpOnly; SameSite=lax` |
| `curl /api/auth/me` with the cookie | `200` · the admin user |
| `curl -X POST /api/auth/login` (wrong password) | `401` · `{"detail":"invalid username or password"}`, **378 ms vs 369 ms** for the success path — no timing oracle |
| `curl /api/auth/me` with no cookie | `401` · `{"detail":"authentication required"}` |
| `python -m scripts.backup --verify` | `backup written: …/archpilot-20260922T182752Z.db (208896 bytes)` · `integrity_check: ok` |
| stdout logs | one JSON line per request with `request_id`, `method`, `path`, `status`, `duration_ms` |

**What the 36 tests cover.** Deep health (read-broken → 503, write-broken → 503,
request-id propagation); login success/failure, case-insensitive usernames,
bearer fallback, expired sessions, logout revocation, throttling after 8
failures, `extra="forbid"` on the login body, weak-password rejection; migration
idempotence and WAL mode; `VACUUM INTO` backup + `integrity_check` + prune; and
the invariants — edit-after-approval resets to `draft`, status-only updates do
not, hash stability under JSON key reordering, append-only `legal_reviews`,
blank attribution rejected at both the app and storage layers, FTS insert/update
sync, Vietnamese diacritic folding, drafts invisible to published-only search,
and an uncited `declared` benchmark rejected.

**What is scaffolded vs. still a stub:** see §7.

---

## 6. Risks & mitigations

| # | Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| R1 | Content drifts toward verbatim reproduction — and PO decision 3 removed the second reviewer, so a single author self-certifies | Med | **Very high** | `content_hash` binding (B1, both layers); G3 pre-launch audit by Q **and** PO together — the only remaining independent check; attribution NOT NULL in storage | PO + Q |
| R2 | Content track is the critical path at 12 entries with a 50% editor | High | High | Diagrams authored as `ArchGraph` JSON from week 1 (`M4`), so authoring never waits for the canvas; launch with 9 if 12 slips | C + PO |
| R3 | ~~`main.tsx` refactor (1.1) regresses existing ArchPilot screens~~ | ~~Med~~ **Closed** | Med | **Done and evidenced.** Pure refactor, no behaviour change, verified by a before/after DOM diff of all 36 states rather than a screenshot (`sha256` equal on both sides), landed before any new feature. Six shell tests in `App.test.tsx` and `tsc -b` now run in CI on every push | E1 |
| R4 | Python/TypeScript split lets the contract drift (the cost of D2) | ~~Med~~ **Low** | High | **Mitigated.** `contracts/archgraph.schema.json` + 16 shared fixtures asserted by **both** suites, including 9 that must fail on a named keyword; three envelope rules cover the drift that actually happened (casing, error shape, timestamps); the Python suite also validates live API responses. Negative control run: weakening the casing rule broke the same fixture in both languages. The sizing engine exists in TS only, so formulas cannot drift at all. **Residual closed at v1.3:** `.github/workflows/ci.yml` runs both halves of the contract suite on every push and pull request, so the guard no longer depends on someone remembering to run it | E2 |
| R5 | Local auth is weaker than SSO — no MFA, no central revocation | Med | Med | 2–4 known users on an internal network; 12-char minimum, PBKDF2 600k, throttling, server-side revocable sessions, 12 h TTL. **Re-open if the audience grows** | E2 |
| R6 | SQLite write contention | Low | Low | WAL + 5 s busy timeout; 2–4 users is orders of magnitude below the limit | E2 |
| R7 | Single container is a single point of failure | Med | Low | Deep health check + `restart: unless-stopped`; `VACUUM INTO` nightly + Litestream (7.4) takes RPO from 24 h to seconds | E2 |
| R8 | Rollback after a forward-only migration | Low | High | Rollback = restore-from-backup, **never** an image rollback. Backup before migrate. Documented in `backend/README.md` and the 7.8 runbook | E2 |
| R9 | 9 weeks is the schedule the red-team called unavailable at full scope | Med | Med | All the cuts are banked (no LLM −5 pd, no SSO −2 pd, 12 not 18 patterns −3 pd, no CSV −1 pd, no second reviewer −1 pd) and a 3 pd remediation line is in Phase 7 | PO |
| R10 | Sizing numbers pasted into a budget as if exact | Med | High | **Mostly mitigated in code.** `SizingResult` requires `assumptions` and `formula`; `range` comes from the weakest benchmark's confidence tag; and **since v1.5 the UI renders the range and the confidence tag next to every number**, with the substituted formula and the assumptions on the same card (task 3.4, tested). **Still to do:** the disclaimer inside the export envelope (task 2.7) | E2 |

---

## 7. Status board — done vs still open

Updated 2026-09-24 at v1.6 (v2 Phase 0, §7.0); v1.5 added 1.4, 3.3, 3.4; v1.4 added 1.2, 1.3, 1.6. This
section supersedes the v1.0 stub list.

### 7.0 v2 Phase 0 - design-v2 §5.2 tasks 0.2-0.6 (v1.6)

Binding inputs: `docs/requirements-v2.md` v2.1, `docs/design-v2.md` v0.2, and the red-team review
`docs/reviews/review-design-v2.md` v1.0. Where design and requirements disagreed, **requirements v2.1
won**, and the review's findings that touch these tasks were applied (7.0.2). Not reviewed yet.

#### 7.0.1 Tasks

| # | Task | Status | What is real now |
|---|---|---|---|
| 0.1 | CI in repo, pins | **Skipped** (per instruction) | `.github/workflows/ci.yml` already runs in this repo. New deps are pinned exactly: `react-router` **7.18.4** (design D-14 says 7; 8.4.0 exists), `@noble/hashes` **2.4.0**. The older `"latest"` deps are still unpinned (0.1 remainder) |
| 0.2 | Contract v2 design document | **Done** | `contracts/archgraph.schema.json` **1.1.0**: `archGraph` dispatches on `schemaVersion` (`if/then/else`; 1.0 frozen, 2.0 new). 2.0 = neutral nodes (`type` = catalogue role pattern, `variant`, `codeName`, v2.1 `attributes`, neutral `config`, `sizing`, `annotation`) + edges (`kind` flow/access, `mode`, `protocol`, `port`) + `deployment{profiles[], bindings[], scenarios[{placements[]}], activeScenarioId}` + `brief` (open `context`/`answers` maps, assumptions, capacity, suggestions) + `decisions[]` (ADR, 4000-char fields, max 100) + `derivations[]`. Limits: nodes 500, edges 1000, profiles 10, scenarios 10, bindings 5000. Fixtures 16 → **45** in `fixtures/index.json`: 11 valid, 17 shape-invalid (each fails on a named keyword), **17 integrity-invalid** (contract-valid, each fails on a named `INT-*` rule), 1 migration pair. `archgraph.wrong-schema-version.invalid.json` now says `1.1` (2.0 is legal) |
| 0.6 | Component catalogue | **Done** | `contracts/catalog/components.json` v1.0.0: **45 roles in 11 layers**, requirements v2.1 §4.1.1 ids and priorities (every Must and Should role, plus `artifact_registry` for the Must air-gap wizard rule). On-prem is first-class: `site`, `zone`, `network_segment` (variants network/subnet), `hypervisor_cluster`, `bare_metal_host`, `san`, `file_storage` (NAS), `switch`, `router`, `firewall`, `load_balancer`, `vpn_link`, `backup_target`. VI/EN label + purpose per role, neutral synonyms, field descriptors, access modes, default attributes, 9 common attributes, 10 edge modes, size classes, **10 NEST rules** (8 child, 2 container), 1.0 legacy types, 15 aliases (design-v0.2 ids -> v2.1 ids). `components.schema.json` (shape) and `neutrality-tokens.json` (NFR2-NEUT-001, 79 tokens). Loaders: `src/domain/graph/catalog.ts`, `backend/app/catalog.py` (validates at start-up; app refuses to start without it) |
| 0.3 | `src/domain/graph/` core | **Done** | `types.ts`, `catalog.ts` (palette groups, VI-folding synonym search), `codeName.ts` (NFC, `đ`→`d`, uniqueness), `migrate.ts` (1.0 → 2.0, byte-identical to the shared pair), `containment.ts` (`canNest` per NEST rule, ancestry, depth, `validParents`, effective failure domain per REQ-DES-025), `validate.ts` (L1 = the 19 `INT-*` rules, same codes/paths/order as Python; L2 = NEST-*, DES-W01/W03/W04/W05/W06, DES-I01, warnings only), `hash.ts` (RFC 8785 JCS + NFC + pure-JS SHA-256), `commands.ts` (13 pure commands: add/move/resize/rename/setCodeName/reparent/update/remove(delete or lift)/addEdge/updateEdge/removeEdge/setBinding/setPlacement; refusals carry the NEST or INT code + VI/EN text). A purity test forbids clock, randomness, locale, Web Crypto and browser I/O in these files |
| 0.4 | Backend integrity + migration 005 | **Done** | `backend/app/graph_integrity.py` (19 rules: duplicate ids/codeNames, dangling edges/parents/bindings/placements/decision refs, containment cycles reported once, depth ≤ 6, unknown role (with the canonical id as a hint) / variant, deployment references). Hooked into the designs request model after shape and size: a violation is a **422 `{detail, requestId}`** naming up to 3 issues. Migration `005_design_document_v2.sql`: triggers keep `designs.schema_version` ∈ {1.0, 2.0} and equal to `graph_json.$.schemaVersion` (a script cannot store a lying row). The designs API accepts **1.0 and 2.0** on POST and PUT (a 1.0 design can be upgraded and back) |
| 0.5 | Router, SPA fallback, Studio shell | **Done** | `App` = `BrowserRouter` + auth gate; sidebar groups **STUDIO** (Overview `/`, Designs, New guided design, Templates, Knowledge hub, Sizing, Learn - unbuilt ones render a planned screen that already answers its deep links, params shown as text), **ARCHPILOT MODULES** (the 16 screens unchanged at `/m/<key>`, collapsed by default, auto-open on `/m/*`; `/m/sizing` → `/sizing`), **EDITORIAL** (editor/admin only; 404 for members). Routes are generated from each Studio item's patterns, so the breadcrumb and the router cannot disagree. Backend `app/spa.py`: history-API fallback **only** for GET/HEAD, not `/api*`, not `/assets/*`, and only when `Accept` has `text/html`; `index.html` `no-store`, hashed assets `immutable`; CSP on every response (dev-only Swagger exempt). `ARCHPILOT_STATIC_DIR` setting. Not done: focus mode (needs the workspace, Phase 2) |

#### 7.0.2 Red-team review findings applied (docs/reviews/review-design-v2.md)

| Finding | What changed in code |
|---|---|
| **B1** reconcile with v2.1 | Catalogue uses the v2.1 role ids and priorities; `zone` container; `failureDomainLevel` + `failureDomainLabel`, `statefulness`, criticality low/medium/high; migration adds **no** deployment (REQ-TGT-003 "unset"); design-v0.2 ids kept only as aliases, and refused on save with the canonical id in the message |
| **B2** no target data on nodes, no data as keys | Node `realisations.<target>` removed; `deployment.bindings[]`, `placements[]`, `derivations[]` are arrays of values. A 2.0 design response passes the existing camelCase-at-every-depth test; neutrality scan excludes only `$.deployment`. Regression fixture `archgraph.v2-target-keyed-map.invalid.json` |
| **M6** + coordinator (3) hashing | `hash.ts`: JCS + NFC, `@noble/hashes` (no Web Crypto, works on plain-HTTP pages); golden hash cross-checked with Python `hashlib` |
| **M9** fallback + CSP | Implemented as specified, with pytest cases for `/api/nope` (JSON 404 whatever the Accept), `/assets/missing.js` (404) and CSP presence |
| **m2** | `if/then/else` instead of `oneOf`; `brief.context`/`answers` are open camelCase maps |
| **m3** | ADR text fields ≤ 4000, decisions ≤ 100 |
| **m4** | `đ`/`Đ` mapped before stripping marks; NFD input folds like NFC |

#### 7.0.3 Deviations from design-v2 v0.2 (for SA#1's v0.3)

1. Role ids and attribute names follow v2.1, not §4.3.1/§4.3.2 (B1).
2. Target data in `deployment.bindings[]`, not `node.realisations` (B2).
3. Legacy 1.0 documents migrate with **no** default AWS profile (§4.3.4 said add one; B1g, REQ-TGT-003).
4. `maxNestingDepth` = **6**, not 4: v2.1 adds `zone`, and design NEST-04/05 already allowed site > network > subnet > cluster > workload (5 levels).
5. Aliases are resolved by migration only; a 2.0 save with an alias type is refused (INT-UNKNOWN-ROLE + hint) so TS consumers never see two spellings.
6. NEST rules renumbered for the v2.1 container set (NEST-01..10); `network_segment` may nest in `network_segment` (network > subnet tier).
7. Home keeps the "Tổng quan / Overview" label: `/` renders the Overview screen until a real Home exists.
8. Migration 005 carries the schema-version guard; `lesson_id` / `seeded_from_template_id` wait for the migrations that create their target tables.

#### 7.0.4 Evidence (what I actually ran)

| Check | Result |
|---|---|
| `ruff check .` | All checks passed |
| `pytest` | **323 passed** (was 174): new `test_catalog.py` 27, `test_graph_integrity.py` 21, `test_spa.py` 27; `test_contracts.py` 29 → 67, `test_designs.py` 38 → 74 (every integrity fixture POSTed → 422 with its rule code) |
| `npm test` (vitest) | **387 passed** in 18 files (was 150 in 9): `graph/{catalog 24, codeName 25, migrate 11, containment 23, validate 19, commands 42, hash 18, purity 10}`, `contract` 23 → 68, new `app/routing` 20; `App` 6 unchanged in count (now expands the module group first) |
| `npm run typecheck` / `npm run build` | clean · `index-*.js 384.27 kB (gzip 118.20 kB)` (was 335 kB; +react-router) |
| Negative controls | integrity hook removed from `schemas.py` → **20** designs tests fail; `/api` exclusion removed from `spa.py` → **4** fail; dangling-edge rule disabled in `validate.ts` → **5** fail; NEST container rule disabled in `containment.ts` → **6** fail. All restored |
| Docker image `archpilot:p0` | **Not built.** Docker Desktop 4.91.0 was not running; on start it crashed: `initializing Secrets Engine: listening on unix://C:/Users/DATVT/AppData/Local/docker-secrets-engine/engine.sock: rename ... engine.sock.stale: The file cannot be accessed by the system`. The fix (delete that stale socket file, restart Docker Desktop) touches the user's Docker install, so it was not done. **Do NOT press "Reset to factory defaults"** in its dialog - that wipes `archpilot-data`. `archpilot-v1` was not touched (the engine never came up) |
| Substitute: the same app with the image's production settings | `ARCHPILOT_ENV=production`, `COOKIE_SECURE=true`, empty CORS, `ARCHPILOT_STATIC_DIR=dist`, throwaway DB, uvicorn on `127.0.0.1:18082`. `create_user tester --role member --password-stdin` → exit 0. `/api/health` → `ok production schema 005`. Login → both cookies `Secure`, passed back as an explicit `Cookie` header. **v2 document** (hybrid fixture) POST → **201**, `schemaVersion 2.0`, 20 nodes, 3 bindings; GET → 200; a 1.0 document → 201. **Invalid** → **422** `{detail, requestId}`: dangling edge (`INT-DANGLING-EDGE edges[0].target: 'n9' is not a node id`), unknown role, legacy id `database` (`use 'relational_db'`), parent cycle (`containment loop n1 -> n3 -> n2 -> n1`), target-keyed map (contract: `'realisations' was unexpected`); nothing stored. **`/hub/anything`** (Accept text/html) → **200 `text/html`**, `no-store`, CSP header, `<div id="root">`. **`/api/nothing`** → **404 `application/json`** `{"detail":"Not Found","requestId":…}` for Accept text/html and application/json. Also: `/hub/anything` as a fetch (`*/*`) → JSON 404; `/assets/index-OLD.js` → 404; the real bundle → `immutable`; POST `/hub/anything` → 405 JSON. Server stopped and data deleted afterwards |

#### 7.0.5 Weakest points (attack these first)

1. **The image was not built or run.** The Dockerfile now copies `contracts/` into the SPA stage and `contracts/catalog/` into the runtime; both are untested in Docker. First thing to run once Docker Desktop is fixed.
2. **CSP allows Google Fonts** because `src/styles.css` `@import`s them. On an air-gapped host (NFR2-DEP-001) fonts silently fall back. Self-host the fonts, then drop the two origins.
3. **Two hand-written integrity implementations.** They are held together by 17 shared fixtures, identical paths/messages/order tests and negative controls - not by construction. A rule added to one side only is caught solely if someone adds a shared fixture.
4. **REQ-DES-026 / US-D2 "two replicas in the same rack label"** cannot be decided from one node's single `failureDomainLabel`; DES-W04 covers "replicas = 1" only. Needs a BA decision (per-replica labels, or spread = child nodes in distinct zones).
5. **Catalogue breadth vs review M8.** 45 roles ship as data (Must + Should); every role will need a realisation or an explicit "unsupported" per target in T.1.
6. Design rules are noisy on purpose-built on-prem gear: DES-W04 fires on a single SAN or backup target (stateful, 1 replica). Tune per role in the catalogue if users object.

#### 7.0.6 Next tasks

- **Human:** fix Docker Desktop (delete `%LOCALAPPDATA%\docker-secrets-engine\engine.sock`, restart), then run `docker build -f backend/Dockerfile -t archpilot:p0 .` and the curl script's checks against a throwaway container, then remove it.
- **senior-developer-2:** review v1.6 (contract 1.1.0 shape, integrity parity, fallback/CSP, command semantics - especially `lift`, and binding/placement normalisation).
- **SA#1:** fold §7.0.3 into design-v2 v0.3; **BA:** US-D2 label semantics, v2.1 wording for aliases and depth 6.
- **Engineering, next in plan:** 1.1 HCL IR/printer (E2); 2.1 workspace shell on `@xyflow/react` using `commands.ts` + `validateGraph` (E1); T.1 realisation catalogues as `deployment.bindings` targets; 0.1 remainder (pin the `"latest"` deps); self-host fonts; `design_revisions` (review M5).

### 7.1 Done and tested

| Area | What is real |
|---|---|
| Backend platform | Config, JSON logging with request IDs, CORS (production refuses loopback origins), forward-only migration runner with **backup-before-migrate**, deep read+write health check, `VACUUM INTO` backup/verify/prune, Dockerfile |
| Auth | PBKDF2 local login, opaque server-side sessions, role dependency, throttling with a bounded map, no user-enumeration timing oracle, expired-session purge on startup and on login |
| CSRF | Double-submit token enforced centrally in middleware, so a router added later cannot forget it. Bearer clients exempt |
| Legal gate (B1) | `003_publish_gate.sql`: publish requires an `approved` `legal_reviews` row whose `content_hash` matches the row being published; a reviewed pattern cannot be deleted |
| Backups (B4) | `VACUUM INTO` + `integrity_check` + prune that never deletes a pre-migration snapshot |
| **Wire contract (D4 / task 0.6)** | `ArchPilot/contracts/archgraph.schema.json` + 16 shared fixtures (9 deliberately broken) + `fixtures/index.json` manifest, run by **both** suites. Three envelope rules enforced: camelCase casing, `{detail, requestId?}` errors, ISO-8601-UTC timestamps. Python additionally validates **live API responses**, not just fixtures |
| **Sizing engine (B3 / tasks 3.1, 3.2)** | `ArchPilot/src/domain/sizing.ts` v2.0: replication on writes, dual read/write benchmarks, compression term, failure-domain spare, confidence-derived ranges, `formula` + `assumptions` required by the type |
| **CI (task 0.7)** | `.github/workflows/ci.yml`. Job `backend`: `ruff check` + `pytest` on a **Python 3.12 / 3.10 matrix**, `fail-fast: false`, plus a step that records the interpreter, the SQLite build and that the FTS5 `unicode61 remove_diacritics 2` tokenizer exists on the runner. Job `frontend`: `npm ci` → `tsc -b` → `vitest` → `tsc -b && vite build` → assert `dist/index.html` exists, on **Node 24**. `contents: read` only; `cancel-in-progress` concurrency |
| **Backend lint (task 0.7)** | `ArchPilot/backend/ruff.toml` — `E W F I B UP C4 SIM BLE RUF`, `target-version = "py310"` (the floor, not the image, so ruff never suggests syntax 3.10 rejects). 15 pre-existing findings fixed in code, including 7 dead `# noqa` directives that were claiming protection they no longer gave |
| **`main.tsx` split (task 1.1)** | 292 lines → 25 files: `src/main.tsx` (bootstrap), `src/app/` (shell + nav + tests), `src/ui/` (`copy`, `PageHeader`, `ModulePanel`, `DatabaseIcon`), `src/features/<module>/` (16 screens + editor + 2 modals). Byte-identical DOM across all 36 states |
| **Workspaces API (task 1.3)** | `GET/PUT /api/workspaces/current`, owner-scoped by construction (no id in the URL). Wire shape = `WorkspaceRecord` in `store.ts`. Client sends the revision it last saw (`0` creates); server assigns the next one; a stale write is a 409 and never lands. Check-and-write in one `BEGIN IMMEDIATE` transaction (`app/db.py:immediate_transaction`) |
| **Designs API (task 1.6)** | Full CRUD, owner-scoped, **404 not 403** for a non-owner (same body as a missing id). `graph` validated per request against **`contracts/archgraph.schema.json` itself** (`app/contract.py`, jsonschema); no second definition of `ArchGraph` exists in Python. 1 MiB graph cap. Optimistic concurrency on PUT. List paginated (`limit` ≤ 100) and graph-free. Soft delete (takedown can still count derived designs). The first design auto-creates the owner's workspace (`designs.workspace_id` is NOT NULL) |
| **SPA auth (task 1.2)** | `src/api/client.ts` (credentials, CSRF from cookie, request id, typed `ApiError` incl. `unreachable`, 401 → login hand-off), `src/api/auth.ts`, `src/features/auth/LoginScreen.tsx` (VI/EN, labelled fields, Enter submits, focus management, `role="alert"` errors), auth gate + Logout + real user name in `src/app/App.tsx`, `/api` dev proxy in `vite.config.ts`. The rest of the app behaves as before once signed in (`store.ts` untouched) |
| **First user** | `backend/scripts/create_user.py` — prompt (twice) or `--password-stdin`; never argv, never env; refuses without a TTY instead of hanging; migrates a fresh DB first |
| **Docker (task 0.8, local half)** | Image built and run under Docker 29.8.0; healthy; SPA at `/`; full CRUD exercised with curl. The contract file is copied to `/srv/contracts/`, and the app refuses to start without it |
| **Workspace store (task 1.4)** | `src/domain/store.ts` async on `src/api/workspace.ts`. Server is the source of truth; `localStorage` key `archpilot.workspace.cache.v2` is an owner-scoped cache, read only when the server is unreachable, cleared on logout. One-time import of the legacy `archpilot.workspace.v1` record on first login (normalised to what the server accepts; never deleted; a marker records the decision). 409 → newer record reloaded, the modal stays open with the typed values and says what happened. Unreachable → edit kept as `pending`, sidebar shows "Not saved to the server" with **Retry**, pushed automatically on the next load (as a conflict if it went stale). `src/features/workspace/useWorkspace.ts` replaces the old `useState(() => loadWorkspace())` |
| **Benchmarks (task 3.3)** | Migration `004_benchmark_seed.sql` (`origin` column, `benchmark_seed_log`, non-blank `source_title` on every row, edit → `origin=user` trigger). `app/repositories/benchmarks.py` seed: 5 component types × read/write, all `estimated`, URL-less, cited as a generic planning heuristic; runs at every start-up and via `scripts/seed_benchmarks.py`; never updates, never resurrects. `GET /api/benchmarks` for any signed-in user |
| **Sizing calculator (task 3.4)** | `src/features/sizing/SizingScreen.tsx` replaces the hard-coded HTML: inputs left (peak read/write QPS, payload, peak factor, retention, RF, compression, per-node read/write with "load from benchmark", spare nodes, measured toggle), cards right (nodes, storage, cluster write load, payload bandwidth, review hints). Each card: number + range + confidence tag + formula + substituted formula + assumptions. Shortcut note when a single-benchmark sizing would under-size. `src/domain/sizingCalculator.ts` + `src/domain/benchmarks.ts` hold the logic; the engine is untouched |
| Test suites | **v1.6: 323 pytest · 387 vitest** (breakdown in §7.0.4). At v1.5: **174 pytest** (`ArchPilot/backend`) · **150 vitest** (`ArchPilot`: 34 sizing + 23 contract + 6 shell + 21 client + 13 login + 14 store + 5 workspace shell + 22 calculator + 12 sizing screen) · `ruff check`, `tsc -b` and `vite build` clean. **CI caveat:** see §7.2 item 5c |

### 7.2 Still open — engineering

| # | Item | Task | Note |
|---|---|---|---|
| 0 | **Remaining, in order (v1.5).** ~~1.4~~, ~~3.3~~, ~~3.4~~ done. (1) **Interactive canvas** following the demo layout — 1.5 `graph.ts` + `validateGraph()`, then 2.1–2.6 (`@xyflow/react` shell, palette, labelled edges, inspector, autosave onto `/api/designs`, legacy component migration), 2.8 undo/redo, 2.9 status-bar warnings; (2) **3.6** attach a sizing scenario to a node + `benchmark_snapshot_json` pinning, with **3.7** reusing `reviewHints()` rules server-side or dropping the endpoint; (3) **pattern hub API** 4.1/4.2; (4) **admin / legal-gate UI** 5.1–5.4, including benchmark editing (NFR-EXT-001); (5) **Litestream** 7.4; (6) move CI into this repo (item 5c) | — | (1) is the big one (~11 pd). (2) and (3) are backend-led and can run in parallel with it |
| 1 | ~~No routers for designs, workspaces, benchmarks~~. **Still no routers for sizings, patterns or admin** | 3.6, 4.1, 5.1–5.4 | Workspaces and designs done at v1.4, benchmarks (read-only) at v1.5 |
| 2 | **No search endpoint.** `patterns_fts` is populated and tested; `search_published_patterns()` is specified (§3.4), not written | 4.2 | All search must route through this one function (`M1`) |
| 3 | **Frontend wiring, mostly done.** ~~`client.ts`, `auth.ts`~~ (v1.4), ~~`store.ts` async (1.4), `workspace.ts`, `benchmarks.ts`, Sizing calculator (3.4)~~ (v1.5). **Still open:** `graph.ts` (1.5), `designs.ts` + the canvas (2.x). **Known gaps in 3.4:** the engine's `assumptions` strings are English-only (the VI screen labels them as engine output); `headroom` (30%) and `indexOverhead` (30%) are engine defaults shown in the assumptions but not editable; scenarios are not saved yet (3.6) | 1.5, 2.x, 3.6 | — |
| 3b | ~~**Referential integrity of stored graphs is not checked server-side.**~~ **Done at v1.6** (v2 task 0.4, §7.0): `app/graph_integrity.py`, 19 shared `INT-*` rules, 422 on violation, for 1.0 and 2.0 documents. Original note: the API accepted a graph whose edge names a missing node, or two nodes with one id — JSON Schema cannot say otherwise (item 11) | 1.5 | When 1.5 decides which `validateGraph()` rules are hard errors (not warnings — `REQ-DESIGN-007` wants an orphan to warn and still save), mirror **only those** in the designs router. ~20 lines |
| 3c | **No HTTP body-size limit.** The 1 MiB graph cap runs after the body is parsed; uvicorn itself has no limit | 7.x | Put `client_max_body_size` on the TLS proxy in front of the container (devops), or a small ASGI guard |
| 4 | ~~**`main.tsx` is still one 292-line file**~~ | 1.1 | **Done at v1.3.** See §3.5.3 |
| 5 | ~~**No CI.**~~ **`mypy --strict` and `ruff format --check` are still not in CI** | 0.7 (partial) | **CI done at v1.3** (`ruff check` + `pytest` × {3.12, 3.10}, `tsc -b` + vitest + `vite build` on Node 24). Two deliberate gaps: (i) `ruff format --check` would rewrite **16 of 26** Python files, and a whole-tree reformat landing with a refactor makes both unreviewable — run `ruff format .` once on its own, then add the check; (ii) `mypy --strict` (m12) was not attempted and its cost is unmeasured. Both are ~0.25 pd each |
| 5b | **Nothing in CI builds the Docker image or runs a container** | 0.8 | The `node:24-alpine` bump **is now verified locally** (v1.4: the backend image builds and runs). CI still does not build it; a `docker build` job is ~10 lines |
| 5c | **The CI workflow is not in this repository.** `ArchPilot/` is now its own git repo, but `ci.yml` lives at `D:\ClaudCode\Sub-agents\.github\workflows\ci.yml`, one level up, and uses `working-directory: ArchPilot/backend`. On `github.com/dungzit/ArchPilot` **no CI runs today**, so the "runs on every push" claims in §6 R3/R4 are currently untrue for this repo | 0.7 | Move it to `ArchPilot/.github/workflows/ci.yml` and change the two `working-directory` values (`ArchPilot/backend` → `backend`, `ArchPilot` → `.`) plus any cache paths. PO decision because it touches the repo layout; not done here |
| 6 | **Litestream is not configured.** `VACUUM INTO` alone leaves RPO at the backup interval | 7.4 | Devops. Also M-8: `ARCHPILOT_BACKUP_DIR` currently defaults to the same volume as the database |
| 7 | **No seed script.** B2's acceptance criteria are written (review §7.3) but unimplemented | C.5 | Gated on the content track |
| 8 | Login throttling is in-process and keyed on `(ip, username)` | — | Accepted for 2–4 users; revisit with `login_attempts` if the audience grows |
| 9 | PBKDF2, not argon2id | — | Deliberate (stdlib only); per-user `password_iterations` is the upgrade seam |
| 10 | `/api/health` is unauthenticated and verbose | — | Deliberate; decide the production redaction with devops-master |
| 11 | Referential integrity of `ArchGraph` (dangling edges, duplicate node ids) is **not** in the JSON Schema | 1.5 | JSON Schema cannot express it. It belongs in `validateGraph()`; do not let that boundary blur. Server-side consequence: item 3b |
| 12 | **The CSRF cookie name is hard-coded in the SPA** (`archpilot_csrf` in `src/api/client.ts`) while the backend makes it configurable (`ARCHPILOT_CSRF_COOKIE`) | — | Changing the env var alone would make every mutation 403. Either drop the env var or have `/api/auth/me` return the name. Low risk; noted so nobody "tunes" it |
| 13 | **Logout while the server is unreachable leaves the httpOnly session cookie in place.** The SPA shows the login screen, but a reload signs the user back in | — | Acceptable for an internal tool; the session still expires after 12 h and is revocable server-side |

### 7.3 Still open — blocking gates

| Gate | Owner | Blocks |
|---|---|---|
| ~~G0.2 — content-IP policy sign-off~~ (`docs/pattern-content-policy.md`, task C.1) | **CLEARED 2026-09-23** — chat approval, formal signature waived | The content track (C.2–C.5) is now unblocked to start |
| G3 — pre-launch legal audit of all 12 entries (task 7.5) | Q + PO | Launch |
| Open question: deletion of reviewed patterns is now structurally impossible | PO / legal | Confirm takedown-as-unpublish satisfies a rights-holder demand |

**Where I would attack this design if I were reviewing it now:** D3 (the server
still stores a client-computed sizing number — the cheap hardening is to
validate `benchmark_snapshot_json` against real `benchmarks` rows when task 3.6
lands), R5 (local auth with no MFA), and R1 (a self-certifying author with no
independent check is the weakest control in the product, and it is the one the
Product Owner explicitly chose). D2 is no longer the top answer: `contracts/`
now has teeth, and the negative control proves it.

---

## 8. Open questions

1. **PO** — Does the 30-day share link (task 6.4) still make sense at 2–4 users,
   or should it be cut to save 1.5 pd? It was justified for a 50–200-user org.
2. **PO** — With no independent reviewer, should G3 (7.5) require **both** Q and
   PO to sign, to keep at least one non-author in the loop? My recommendation:
   yes, and the plan assumes it.
3. **PO / C** — Are the four hard-coded knowledge records currently in
   `main.tsx` (transactional outbox, "when not to use Redis", active-passive DR,
   queue vs event-driven) intended to become seed patterns, or are they a
   separate internal-notes corpus? They lack source URLs today.
4. **Devops** — Is Litestream permitted on the on-prem host, or is a scheduled
   `VACUUM INTO` to a file share the only option? This sets RPO at seconds vs
   hours.
5. **E1 / PO** — ArchPilot's UI is bilingual VI/EN via the `copy(vi, en)` helper.
   Do the three new screens need full Vietnamese strings for MVP, or is English
   acceptable with VI to follow? This is ~1 pd across Phases 2–4.
6. **Q** — Confirm the seed count once C.2 lands: 12 is the decision, but can a
   50% editor deliver 12 at ~0.8 pd each inside 7 weeks?

---

## 9. References & next handoff

### References

- `docs/requirements/systemsarchitect-requirements.md` v0.1 — source of every
  `REQ-*` / `NFR-*` ID cited here.
- `docs/architecture/systemsarchitect-prototype-design.md` v0.1 — shared-graph
  idea (D1), screen layouts, formula baseline. Superseded on stack, auth,
  audience, co-pilot and seed count by §2.1.
- `docs/architecture/reviews/review-systemsarchitect-prototype.md` v1.0 —
  blockers B1–B4 and majors M1, M3, M4, M5, M7, M8, M9, M10, M11, M12 are
  carried into this plan and named at each task.
- `docs/requirements/systemsarchitect-decisions.md` v0.1 — decisions 1–9.
- `ArchPilot/08-reference-synthesis-sysdesai.md` §2 — the Phase 1 module list
  this work implements.
- Code read: `ArchPilot/src/domain/{store,architecture,sizing,knowledge,model}.ts`,
  `ArchPilot/src/main.tsx`, `ArchPilot/package.json`, `ArchPilot/vite.config.ts`,
  `ArchPilot/Dockerfile`.

### Files created by this deliverable

| Path | Responsibility |
|---|---|
| `docs/development/systemsarchitect-build-scope.md` | this document |
| `ArchPilot/backend/README.md` | run/test/operate the backend |
| `ArchPilot/backend/requirements.txt`, `requirements-dev.txt` | 3 runtime deps, 2 test deps |
| `ArchPilot/backend/pytest.ini`, `.gitignore`, `.env.example` | dev + config hygiene |
| `ArchPilot/backend/Dockerfile` | SPA build stage + Python runtime, single container |
| `ArchPilot/backend/app/main.py` | FastAPI factory, request IDs, CORS, SPA mount |
| `ArchPilot/backend/app/config.py` | env-driven frozen settings |
| `ArchPilot/backend/app/db.py` | connection tuning + forward-only migration runner |
| `ArchPilot/backend/app/security.py` | PBKDF2 hashing, session tokens (stdlib) |
| `ArchPilot/backend/app/content_hash.py` | canonical pattern hashing — the B1 invariant |
| `ArchPilot/backend/app/schemas.py` | pydantic request/response models |
| `ArchPilot/backend/app/dependencies.py` | `DbConn`, `CurrentUser`, `require_role` |
| `ArchPilot/backend/app/logging_config.py` | JSON logs to stdout |
| `ArchPilot/backend/app/migrations/001_core.sql` | identity, workspaces, designs, sizing, benchmarks, events |
| `ArchPilot/backend/app/migrations/002_patterns_legal.sql` | patterns, legal gate, takedowns, FTS5 + triggers |
| `ArchPilot/backend/app/repositories/users.py` | user + session SQL |
| `ArchPilot/backend/app/routers/health.py` | shallow + deep health |
| `ArchPilot/backend/app/routers/auth.py` | login / logout / me |
| `ArchPilot/backend/scripts/init_db.py` | migrate + create a user |
| `ArchPilot/backend/scripts/backup.py` | `VACUUM INTO` snapshot, verify, prune |
| `ArchPilot/backend/tests/` | health, auth, invariants, migrations, backup, CSRF, legal gate, contracts — **90 tests** |

### Files added after the review (v1.1 / v1.2)

| Path | Responsibility |
|---|---|
| `ArchPilot/backend/app/migrations/003_publish_gate.sql` | publish requires a matching approved review; a reviewed pattern cannot be deleted (B1) |
| `ArchPilot/backend/app/repositories/patterns.py` | publish/unpublish/`resync_content_hash` |
| `ArchPilot/backend/app/csrf.py` | double-submit CSRF, enforced in middleware |
| `ArchPilot/contracts/archgraph.schema.json` | **the one wire contract** — ArchGraph shape + 3 envelope rules (D4 / task 0.6) |
| `ArchPilot/contracts/fixtures/index.json` | shared fixture manifest, read by both suites |
| `ArchPilot/contracts/fixtures/*.json` | 16 fixtures: 7 must validate, 9 must fail on a named keyword |
| `ArchPilot/contracts/README.md` | what the contract covers, who enforces it, how to change it |
| `ArchPilot/backend/tests/test_contracts.py` | Python half: fixtures + live-response envelope checks (25 tests) |
| `ArchPilot/src/contracts/contract.test.ts` | TypeScript half: same fixtures via ajv (23 tests) |
| `ArchPilot/src/domain/sizing.ts` | **rewritten** — corrected engine v2.0 (red-team B3 a/b/c/d + M8) |
| `ArchPilot/src/domain/sizing.test.ts` | 34 tests, one group per corrected term with the v1.0→v2.0 delta |
| `ArchPilot/vitest.config.ts`, `package.json` | `npm test` / `npm run test:watch` / `npm run typecheck` |
| `docs/development/systemsarchitect-contracts-and-sizing.md` | build note for the two tasks above |

### Files added / changed at v1.3 (tasks 0.7 and 1.1)

| Path | Responsibility |
|---|---|
| `.github/workflows/ci.yml` | **new.** The whole of task 0.7: two jobs, five commands, a 3.12/3.10 Python matrix and Node 24 |
| `ArchPilot/backend/ruff.toml` | **new.** Lint rule set, `target-version = "py310"`, and the written reason `ruff format --check` is not in CI yet |
| `ArchPilot/backend/requirements-dev.txt` | `ruff==0.14.6` added, lint-only |
| `ArchPilot/backend/app/config.py`, `app/main.py`, `scripts/backup.py`, `scripts/init_db.py`, `tests/conftest.py`, `tests/test_auth.py`, `tests/test_csrf.py` | 15 ruff findings fixed. No behaviour change: `pytest` is 90 passed before and after |
| `ArchPilot/Dockerfile`, `ArchPilot/backend/Dockerfile` | SPA build stage `node:20-alpine` → `node:24-alpine`. **Unverified — no Docker available** |
| `ArchPilot/src/main.tsx` | **reduced to 21 lines** of bootstrap |
| `ArchPilot/src/app/App.tsx` | the shell, extracted |
| `ArchPilot/src/app/navigation.ts` | `ModuleKey` + `navItems` |
| `ArchPilot/src/app/App.test.tsx` | **new.** 6 jsdom shell regression tests |
| `ArchPilot/src/ui/copy.ts`, `PageHeader.tsx`, `ModulePanel.tsx`, `DatabaseIcon.tsx` | the shared primitives |
| `ArchPilot/src/features/{overview,lifecycle,user,requirements,architecture,decisions,platform,ucrops,patterns,data-model,knowledge,sizing,deployment,operations,innovation,investment,workspace}/*.tsx` | 19 files: 16 screens + `ArchitectureEditor` + 2 modals |
| `ArchPilot/vitest.config.ts` | `include` widened to `*.test.tsx`; jsdom opted into per-file, so the domain suites stay on `node` |
| `ArchPilot/package.json`, `package-lock.json` | `jsdom` added as a devDependency (shell test only) |
| `docs/development/systemsarchitect-build-scope.md` | this document — §3.5.3, §5, §7.1, §7.2 and the task tables carry the v1.3 record; there is no separate build note |

### Files added / changed at v1.5 (tasks 1.4, 3.3, 3.4)

| Path | Responsibility |
|---|---|
| `ArchPilot/backend/app/migrations/004_benchmark_seed.sql` | **new.** `benchmarks.origin`, `benchmark_seed_log`, citation-title triggers, edit → `origin=user` trigger |
| `ArchPilot/backend/app/repositories/benchmarks.py` | **new.** Seed data (10 rows), `seed_benchmarks()`, `list_benchmarks()` |
| `ArchPilot/backend/app/routers/benchmarks.py` | **new.** `GET /api/benchmarks` |
| `ArchPilot/backend/app/schemas.py` | `BenchmarkOut`, `BenchmarkList` |
| `ArchPilot/backend/app/main.py` | registers the router; seeds benchmarks at start-up (logged, non-fatal) |
| `ArchPilot/backend/scripts/seed_benchmarks.py` | **new.** Manual/idempotent seed run |
| `ArchPilot/backend/tests/test_benchmarks.py` | **new.** 19 tests |
| `ArchPilot/backend/tests/test_contracts.py`, `test_schema_invariants.py` | +1 live-response test; one fixture row gains a `source_title` |
| `ArchPilot/backend/README.md` | endpoint + layout + script entries |
| `ArchPilot/src/api/workspace.ts`, `src/api/benchmarks.ts` | **new.** Resource modules |
| `ArchPilot/src/domain/store.ts` | **rewritten.** Async, server-backed, owner-scoped cache, legacy import, conflict/offline handling |
| `ArchPilot/src/domain/benchmarks.ts`, `src/domain/sizingCalculator.ts` | **new.** Pairing + calculator model |
| `ArchPilot/src/features/workspace/useWorkspace.ts` | **new.** The hook the shell uses |
| `ArchPilot/src/features/workspace/WorkspaceModal.tsx` | async save, saving state, conflict/error message, server-profile copy |
| `ArchPilot/src/features/sizing/SizingScreen.tsx` | **rewritten.** The calculator |
| `ArchPilot/src/app/App.tsx` | `useWorkspace(user.id)`, sync line + Retry under the switcher, cache cleared on logout |
| `ArchPilot/src/styles.css` | sync line, modal message, calculator styles (appended) |
| `ArchPilot/src/domain/store.test.ts`, `src/features/workspace/WorkspaceModal.test.tsx`, `src/domain/sizingCalculator.test.ts`, `src/features/sizing/SizingScreen.test.tsx` | **new.** 14 + 5 + 22 + 12 tests |
| `ArchPilot/src/features/auth/LoginScreen.test.tsx` | fake backend answers `/api/workspaces/current` (404) |
| `ArchPilot/docs/systemsarchitect-build-scope.md` | this document — v1.5 |

### Files added / changed at v1.4 (tasks 1.2, 1.3, 1.6)

| Path | Responsibility |
|---|---|
| `ArchPilot/backend/app/contract.py` | **new.** Loads `contracts/archgraph.schema.json` once (repo or `/srv/contracts`), `validate_archgraph()` with path-naming messages; start-up fails if the file is missing |
| `ArchPilot/backend/app/repositories/workspaces.py`, `designs.py`, `errors.py` | **new.** Owner-scoped SQL; `RevisionConflictError`, `NotFoundError` |
| `ArchPilot/backend/app/routers/workspaces.py`, `designs.py` | **new.** The five design routes and the two workspace routes |
| `ArchPilot/backend/app/schemas.py` | `WorkspaceOut/Put`, `DesignCreate/Put/Summary/Out/List`, `StrictApiModel` (`extra="forbid"`), `ArchGraphDocument` (contract-validated), 1 MiB cap |
| `ArchPilot/backend/app/db.py` | `immediate_transaction()` |
| `ArchPilot/backend/app/main.py` | registers the two routers; loads the contract at start-up |
| `ArchPilot/backend/scripts/create_user.py` | **new.** First-user script (prompt or `--password-stdin`) |
| `ArchPilot/backend/requirements.txt`, `requirements-dev.txt` | `jsonschema` moved to runtime (3 → 4 runtime deps) |
| `ArchPilot/backend/Dockerfile` | copies `contracts/archgraph.schema.json` into `/srv/contracts/` |
| `ArchPilot/backend/tests/test_workspaces.py`, `test_designs.py`, `test_create_user_script.py` | **new.** 16 + 38 + 7 tests |
| `ArchPilot/backend/tests/conftest.py`, `test_contracts.py` | two-user fixtures (`user_a`, `user_b`); +3 live-response contract tests |
| `ArchPilot/backend/README.md` | endpoints, layout, `create_user` usage |
| `ArchPilot/contracts/README.md` | the "no runtime validation" non-goal is **reversed**, with the reason; runtime row in "Who enforces it" |
| `ArchPilot/src/api/client.ts`, `auth.ts` | **new.** The HTTP client and the auth resource module |
| `ArchPilot/src/features/auth/LoginScreen.tsx` | **new.** The login screen |
| `ArchPilot/src/app/App.tsx` | auth gate (`checking` / `anonymous` / `authenticated`), unauthorized handler, Logout button, real user name/initials, `<html lang>` follows the toggle. The old `App` body is now `AppShell`, otherwise unchanged |
| `ArchPilot/src/styles.css` | login / splash / logout styles, appended |
| `ArchPilot/vite.config.ts` | `/api` proxy for `dev` and `preview` (`ARCHPILOT_API_URL` overrides the target) |
| `ArchPilot/src/test/fakeFetch.ts` | **new.** Test-only fetch stub + `waitFor` |
| `ArchPilot/src/api/client.test.ts`, `src/features/auth/LoginScreen.test.tsx` | **new.** 21 + 13 tests |
| `ArchPilot/src/app/App.test.tsx` | signs in through the fake backend before the 6 shell tests (assertions unchanged) |
| `ArchPilot/docs/systemsarchitect-build-scope.md` | this document — header, change log, §1, §3.4, §3.5.1, task tables, §5, §7 |

### Next handoff

| Agent / role | What they need to do |
|---|---|
| **senior-developer-2 (v1.5)** | Review the v1.5 slice together with v1.4. Attack first: (a) the store's offline path — a pending edit is pushed automatically on the next load; is silent auto-push right, or should the user confirm? (b) the one-time legacy import goes to whichever user signs in first on that browser; (c) the seed runs at every start-up and logs rather than fails; (d) the peak → average conversion in `toWorkload` (floating-point at `ceil` boundaries); (e) engine assumptions shown in English on the VI screen |
| **senior-developer-2 (v1.4)** | Review the v1.4 slice. Attack first: (a) the reversal of the contract's "no runtime validation" non-goal — `jsonschema` at runtime vs. a second pydantic definition; (b) GET `/api/workspaces/current` answering 404 before first save instead of auto-creating; (c) the "unreachable" heuristic in `client.ts` (any 5xx without our envelope, plus 502/503/504); (d) soft delete with no purge path |
| **senior-developer-2** | **Done** — review delivered as `docs/development/reviews/review-systemsarchitect-backend.md` v1.0, approve-with-changes, 14 findings fixed in code. **Next:** re-review the two handed-back deliverables (`ArchPilot/contracts/` and `src/domain/sizing.ts` v2.0). Specific things to attack: the decision to close `archNode`/`archEdge` with `additionalProperties: false` against NFR-EXT-002's "readers ignore unknown fields"; whether `spareNodes` belongs outside the confidence band; and whether storage should use average rather than peak write QPS |
| **ba-qa-analyst** | `TC-COMPLY-002`/`003` are green; `TC-COMPLY-005` (publish with no approval refused at the storage layer) and `TC-COMPLY-006` (a reviewed pattern cannot be deleted) are now testable. **`TC-FUNC-CALC-010` (replication applied to write throughput) is unblocked and already has an automated equivalent** — `sizing.test.ts` "a 3x replicated write path needs 3x the write capacity"; write the manual/acceptance form of it plus the other three B3 terms. `TC-COMPLY-004` still needs the seed script |
| **security-architect** | STRIDE pass on local auth (D6), session lifecycle, the share token (6.4), CSRF (7.3), the admin role boundary, and Markdown → HTML rendering on the pattern detail page |
| **dba-master** | Validate `001`/`002`: the FTS5 external-content trigger set, the `content_hash` reset trigger under `recursive_triggers = OFF`, index coverage for the facet queries, and the `VACUUM INTO` + Litestream restore design |
| **devops-master** | **CI (0.7) is delivered** — review `.github/workflows/ci.yml` rather than build it. Still yours: **task 0.8** (`docker build -f backend/Dockerfile .` — the `node:24-alpine` bump is unverified), Docker Compose for the on-prem host, secrets handling (`.env`, `chmod 600`, rotation owner), M-8 (`ARCHPILOT_BACKUP_DIR` must not default to the database volume), backup cron + Litestream (7.4), restore-as-rollback runbook. Also decide whether `ruff format` and `mypy --strict` are worth their one-off cost |
| **Product Owner** | Answer §8 questions 1, 2 and 5; sign gate G0.2 (task C.1) — it is the critical-path dependency |

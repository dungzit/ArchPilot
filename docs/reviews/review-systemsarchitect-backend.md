# Code Review — SystemsArchitect Phase-0 Backend (`ArchPilot/backend/`)

| | |
|---|---|
| **Author** | Senior Developer #2 (Reviewer / Challenger) |
| **Date** | 2026-09-23 |
| **Version** | 1.0 |
| **Code reviewed** | `ArchPilot/backend/` as delivered with `docs/development/systemsarchitect-build-scope.md` v1.0 (Senior Developer #1). No VCS in this workspace, so the review is against the working tree at time of review. |
| **Docs reviewed** | `docs/development/systemsarchitect-build-scope.md` v1.0 · `docs/architecture/reviews/review-systemsarchitect-prototype.md` v1.0 · `docs/requirements/systemsarchitect-decisions.md` v0.1 |
| **Environment used** | Windows 10, Python 3.10.11 (`backend/.venv`), SQLite 3.40.1, FastAPI 0.115.6, pytest 8.3.4 |
| **Verdict** | **Approve-with-changes** — blockers fixed in place during review; two remain open and are owned elsewhere |
| **Finding counts** | **5 Blocker · 10 Major · 12 Minor** (14 fixed in code by this review, 13 recommended) |

---

## 1. Executive summary

### English

The scaffold is genuinely good work and I am not asking for a redesign. It runs,
the 36 claimed tests really do pass, the deep health check really does write to
SQLite, and the `VACUUM INTO` backup really is WAL-safe — I ran all of it rather
than trusting the summary. The PBKDF2 no-timing-oracle claim also holds *today*:
over 15 samples I measured a +0.1 ms median difference between an existing and a
non-existent username, which is 0.0 pooled standard deviations. But the claim is
fragile, not solid — the moment you use the per-user `password_iterations`
upgrade seam the design advertises, the gap opens to **+359 ms (737 ms vs
378 ms, zero overlap between the two populations)**, a perfect user-enumeration
oracle. That is the pattern of this review: the controls are the right controls,
several of them are one step short of actually holding.

The most serious finding is that blocker **B1 is half-implemented while being
described as "two independent layers"**. Layer 2 revokes an approval after a
content edit — that works, I verified it. Layer 2 does not *gate publication*: I
published a pattern with `UPDATE patterns SET status='published'` and **zero
rows in `legal_reviews`**, on the shipped schema. I also deleted a pattern and
watched its append-only legal audit trail vanish through `ON DELETE CASCADE`.
Separately, the app auto-migrates on startup with no backup, directly
contradicting its own documented rollback procedure. Of the four architecture
blockers: **B4 is genuinely fixed**, **B1 is now genuinely fixed (by this
review)**, **B2 has no live risk because the seed script does not exist yet**,
and **B3 is not fixed at all — `src/domain/sizing.ts` is byte-for-byte the
pre-review version**. I fixed what was cheap and provably correct: the storage
publish gate, the audit-trail protection, backup-before-migrate, CSRF, the
session purge, the throttle memory leak, the timing oracle, CORS, and the
snake_case/camelCase wire drift. Tests went 36 → 65, all passing. B3 and the
`contracts/` schema I am recommending, not fixing — they belong to the people who
own `sizing.ts` and the TypeScript test suite.

### Tiếng Việt

Bộ khung này thực sự tốt và tôi không yêu cầu thiết kế lại. Ứng dụng chạy được,
36 test như công bố đều pass thật, health check sâu thực sự có ghi vào SQLite, và
sao lưu bằng `VACUUM INTO` thực sự an toàn với WAL — tôi đã chạy lại tất cả chứ
không tin vào bản tóm tắt. Khẳng định "PBKDF2 không có kênh rò rỉ thời gian" cũng
đúng ở *thời điểm hiện tại*: qua 15 lần đo, chênh lệch trung vị giữa tên người
dùng có thật và không có thật chỉ là +0,1 ms, tức 0,0 độ lệch chuẩn. Nhưng đây là
sự đúng đắn mong manh: ngay khi dùng cơ chế nâng `password_iterations` theo từng
người dùng mà chính thiết kế quảng bá, khoảng cách mở ra **+359 ms (737 ms so với
378 ms, hai nhóm không hề chồng lấn)** — một kênh liệt kê tài khoản hoàn hảo. Đó
là đặc điểm chung của bản rà soát này: các biện pháp kiểm soát được chọn đúng,
nhưng nhiều biện pháp còn thiếu đúng một bước nữa mới thực sự có hiệu lực.

Phát hiện nghiêm trọng nhất: **blocker B1 mới được hiện thực một nửa trong khi
được mô tả là "hai lớp độc lập"**. Lớp 2 có thu hồi phê duyệt sau khi nội dung bị
sửa — điều này tôi đã kiểm chứng là đúng. Nhưng lớp 2 **không chặn việc xuất
bản**: tôi đã xuất bản một mẫu bằng `UPDATE patterns SET status='published'` với
**không có dòng nào trong `legal_reviews`**, ngay trên lược đồ đã bàn giao. Tôi
cũng xóa một mẫu và chứng kiến toàn bộ dấu vết kiểm toán pháp lý "chỉ ghi thêm"
biến mất qua `ON DELETE CASCADE`. Ngoài ra, ứng dụng tự động chạy migration khi
khởi động mà không sao lưu, trái ngược với chính quy trình rollback đã ghi trong
tài liệu. Trong bốn blocker kiến trúc: **B4 đã được khắc phục thật**, **B1 giờ
mới thực sự được khắc phục (bởi bản rà soát này)**, **B2 chưa có rủi ro thực tế
vì script seed chưa tồn tại**, và **B3 hoàn toàn chưa được sửa —
`src/domain/sizing.ts` vẫn y nguyên bản trước rà soát**. Tôi đã tự sửa những gì
rẻ và chắc chắn đúng: cổng xuất bản ở tầng lưu trữ, bảo vệ dấu vết kiểm toán, sao
lưu trước khi migrate, CSRF, dọn phiên hết hạn, rò rỉ bộ nhớ ở bộ đếm đăng nhập,
kênh rò rỉ thời gian, CORS, và sai lệch kiểu đặt tên snake_case/camelCase trên
đường truyền. Số test tăng từ 36 lên 65, tất cả đều pass. B3 và tệp `contracts/`
tôi chỉ khuyến nghị chứ không tự sửa — chúng thuộc về người sở hữu `sizing.ts` và
bộ test TypeScript.

---

## 2. What I actually ran

Every result below is copied from a real run, not inferred from the code.

| Command / probe | Result |
|---|---|
| `.venv/Scripts/python.exe -m pytest` (as delivered) | **36 passed**, 1 warning (starlette-internal `anyio` deprecation), 4.1 s — the claimed count is accurate |
| `python -m scripts.init_db --create-user admin --role admin` | `migrations applied this run: ['001', '002']` · `created user admin (admin) id=usr_28eaecc0ea2948f3` |
| `GET /api/health` | `200` · `{"status":"ok","schema_version":"002","checks":[{"name":"sqlite_read",...,"latency_ms":2.16},{"name":"sqlite_write",...,"latency_ms":2.01}]}` |
| `POST /api/auth/login` (correct) → `GET /api/auth/me` → `POST /api/auth/logout` → `GET /api/auth/me` | `200` + `Set-Cookie: archpilot_session=…; HttpOnly; SameSite=lax` → `200` → `200` → `401`. Full flow works. |
| Login timing, 15 samples each, matched iteration counts | existing username median **366.4 ms**, non-existent **366.4 ms**, delta **+0.1 ms / 0.0σ**. **The no-oracle claim is real.** |
| Login timing, 15 samples each, `ARCHPILOT_PBKDF2_ITERATIONS` raised 600k→1.2M with the account still at 600k | existing **377.7 ms** (max 381.5), non-existent **737.0 ms** (min 716.3). Delta **+359 ms / +95%**, **zero overlap** — 15/15 correct classification. **The claim does not survive the documented upgrade path.** |
| `UPDATE patterns SET status='published'` with 0 rows in `legal_reviews` | **succeeded** — `status='published'`, `legal_reviews rows=0` |
| `DELETE FROM patterns` on a reviewed pattern | `legal_reviews` count **1 before → 0 after** — audit trail destroyed |
| Forge `content_hash` back to an approved value after editing `body_md`, then publish | **succeeded** — trigger satisfied, content unreviewed |
| `POST /api/auth/logout` cross-site-shaped (cookie, no token) | **200** before the fix — a cookie-authenticated mutating route was already live with no CSRF |
| `python -m scripts.backup --verify` | snapshot written, `integrity_check: ok`, no `-wal`/`-shm` sidecars — **B4 is genuinely fixed** |
| FTS rowid alignment across a `VACUUM INTO` restore (5 patterns, 2 deleted to create rowid gaps) | rowids preserved on SQLite 3.40.1, search still resolved `unicorn5 → pat_5`. **Not reproduced**, but see m9 |
| **After my fixes:** `pytest` | **65 passed**, 1 warning, 10.7 s |
| **After my fixes:** timing probe, upgraded-iterations scenario | delta **−0.9 ms / 0.1σ** — oracle closed |
| **After my fixes:** publish with 0 approvals | `sqlite3.IntegrityError: publish blocked: no approved legal_review matches this content_hash` |
| **After my fixes:** restart against an existing 002 database | `{"msg": "pre-migration snapshot written", "backup": "…archpilot-20260922T184603Z-premigrate.db", "pending_migrations": ["003"]}` then migration applied |
| **After my fixes:** `ARCHPILOT_ENV=production` with default CORS | startup **refused**: `ARCHPILOT_CORS_ORIGINS must not contain a loopback origin in production` |

---

## 3. Status of the four architecture-review blockers — verified, not taken on trust

| # | Claim in the build-scope doc | What the code actually does | Verdict |
|---|---|---|---|
| **B1** content_hash-gated legal reviews | "Two independent layers enforce it" (`002_patterns_legal.sql` header) | `legal_reviews.content_hash` is `NOT NULL` ✔; `trg_patterns_reset_status_on_content_change` revokes on edit ✔ (verified); **nothing gated publication** ✘; the audit trail was destroyable by `DELETE` ✘; the application half does not exist (no router, no repository) ✘ | **Was half-done. Now fixed** — see F-1/F-2 |
| **B2** safe, idempotent seed script | Task C.5, not claimed as done | Correct — there is no seed script at all, so there is no live path to resurrect an unpublished pattern | **Not fixed, no live risk.** See M-7 for the acceptance criteria it must meet |
| **B3** four sizing-formula fixes | §3.6 specifies the corrected engine; task 3.1 marked not done | `ArchPilot/src/domain/sizing.ts` is unchanged: `sizeApi(peakRps, capacityPerInstance, …)` still takes a **single** capacity (B3b), `sizeStorage` still has **no compression term** (B3c), replication is applied to **storage only** (B3a), there is **no spare-node term** (B3d), and the band is still the hard-coded `*0.8 / *1.25` (M8) | **Not fixed.** Schema support exists (`benchmarks` has dual read/write rows + citation triggers), the engine does not |
| **B4** WAL-safe backups | `scripts/backup.py` uses `VACUUM INTO` | Verified: snapshot + `integrity_check: ok` + no sidecars + prune. Litestream absent (acknowledged, devops task) | **Genuinely fixed.** Two residual gaps: backups defaulted to the same volume as the database (M-8), and migrations ran without one (F-3) |

**Honest note on the doc.** The build-scope §7 stub list is accurate and the task
table marks 3.1 as not done. But §1's executive summary — "36 passing tests that
enforce the red-team's content-hash, FTS-sync and benchmark-citation invariants"
— reads, in context, as though the blockers were carried. Two of four were not.
Recommend §1 says so in one sentence.

---

## 4. Blockers

All five are must-fix before more code lands on top. Four are fixed in this
review; one is handed back.

| # | Severity | File:line | Issue | Evidence | Fix |
|---|---|---|---|---|---|
| **F-1** | Blocker | `app/migrations/002_patterns_legal.sql:83-100` | **The legal gate revokes but does not gate.** The only publish-side control was an application check that does not exist yet (no pattern router). The storage layer happily set `status='published'` with no approval at all — the exact shape of red-team B1, one level down. | Reproduced: `UPDATE patterns SET status='published' WHERE id='p1'` → `status='published'`, `legal_reviews rows=0`. | **FIXED.** New `app/migrations/003_publish_gate.sql` adds `trg_patterns_publish_requires_approval_update` / `_insert`: `BEFORE UPDATE/INSERT ON patterns WHEN NEW.status='published' AND NOT EXISTS (approved review with r.content_hash = NEW.content_hash) → RAISE(ABORT)`. Now returns `IntegrityError: publish blocked: no approved legal_review matches this content_hash`. |
| **F-2** | Blocker | `app/migrations/002_patterns_legal.sql:56` | **`ON DELETE CASCADE` erases the append-only legal audit trail.** `legal_reviews` has UPDATE/DELETE guard triggers, but the DELETE guard's `WHEN (SELECT COUNT(*) FROM patterns WHERE id=OLD.pattern_id) > 0` is *false* during a cascade — the parent is already gone. One `DELETE FROM patterns` destroys the record of who approved what. NFR-LEGAL-001 is an audit requirement; an audit trail that a single statement can erase is not one. | Reproduced: `legal_reviews` count 1 → 0 after `DELETE FROM patterns WHERE id='p1'`. | **FIXED.** `003_publish_gate.sql` adds `trg_patterns_no_delete_when_reviewed`: a pattern with any `legal_reviews` row cannot be deleted; takedown is an unpublish, which is what the design says anyway. Unreviewed patterns stay deletable (tested). |
| **F-3** | Blocker | `app/main.py:34` → `app/db.py:137` | **The app auto-migrates on every startup with no backup.** `lifespan` calls `init_database()` unconditionally. The README and risk R8 both say rollback is restore-from-backup and "always back up before migrating" — but nothing did. Deploy a new image on the on-prem host, the container restarts, the schema moves forward, and the documented rollback procedure has no artefact to restore. | Code path: `lifespan → init_database → run_migrations`, no backup call anywhere. | **FIXED.** `init_database()` now takes a `VACUUM INTO` snapshot (`archpilot-<stamp>-premigrate.db`) before applying pending migrations to a non-empty database, and **refuses to migrate if the snapshot fails**. Skipped on a fresh database. Gated by `ARCHPILOT_BACKUP_BEFORE_MIGRATE` (default on). `scripts/backup.py prune` never deletes a premigrate snapshot. Verified live on the 002→003 upgrade. |
| **F-4** | Blocker | `src/domain/sizing.ts` (whole file) | **Red-team B3 was not carried into the build.** All four formula defects are still present, and the build now has a `benchmarks` table with dual `read_qps`/`write_qps` rows that `sizeApi`'s single `capacityPerInstance` parameter structurally cannot consume. Any sizing UI built on this ships wrong numbers with a confident formula string attached — the precise failure B3 described. | `sizeApi(peakRps, capacityPerInstance, headroom, …)`; `sizeStorage` has no `compressionRatio`; `replicationFactor` multiplies storage only; `range` is `*0.8/*1.25` fixed, not confidence-derived. | **NOT FIXED — handed back.** This is task 3.1 (2 pd) plus 3.2, in TypeScript, with its own test plan (one unit test per term, plus the 5000 QPS / 2 KiB / 9:1 / 12 mo worked example). Out of scope for a backend hardening pass and I will not half-do it. **Gate: no sizing screen may ship before 3.1 and 3.2 land.** |
| **F-5** | Blocker | `app/routers/auth.py:132` | **A cookie-authenticated mutating route was already live with no CSRF**, which the build-scope doc's own stub #1 forbids ("must land before any cookie-authenticated mutating route ships"). `POST /api/auth/logout` is that route. Exploitability today is genuinely low — `SameSite=lax` blocks the cookie on cross-site form POSTs and a cross-origin JSON POST needs a preflight the server will not grant — but the control was scheduled for task 7.3, i.e. *after* designs, workspaces, sizings, patterns and admin routers were all built on top of the gap. | `curl -b cookies.txt -X POST /api/auth/logout` → `200` with no token. | **FIXED.** See §6.1. Now `403 {"detail":"csrf check failed: missing csrf token"}`, and `200` with a matching `x-csrf-token`. |

---

## 5. Major findings

| # | Severity | File:line | Issue | Evidence / reasoning | Fix |
|---|---|---|---|---|---|
| **M-1** | Major | `app/repositories/users.py:40` (was) | **The timing-oracle claim does not survive the upgrade seam it is paired with.** `hash_password_dummy` burned `settings.pbkdf2_iterations`, while a real verify burns the *user's* stored `password_iterations`. Decision D6 sells that per-user column as the way to raise the cost factor without a destructive migration — and using it is exactly what opens the oracle. | Measured: 600k stored / 1.2M configured → non-existent username **737.0 ms** (min 716.3), existing **377.7 ms** (max 381.5). Non-overlapping; 15/15 classified correctly. | **FIXED.** `dummy_iterations()` charges the unknown-user path the **highest count actually stored** (`SELECT MAX(password_iterations) FROM users WHERE is_active=1`), falling back to settings for an empty table; and `upgrade_password_iterations()` re-hashes a verified password at the configured cost on successful login, so the fleet converges. Re-measured: **−0.9 ms / 0.1σ**. |
| **M-2** | Major | `app/repositories/users.py:172` (was) | **`purge_expired_sessions()` was dead code** — flagged in the doc as "wire it to a startup task or cron", and nothing did. A container that runs for weeks accumulates one `sessions` row per login forever. Not a security hole (`resolve_session` filters on `expires_at`), but unbounded growth in the table that holds session hashes and IP addresses, i.e. the most sensitive table after `users`. | `grep -rn purge_expired_sessions app/` → defined once, called never. | **FIXED.** Called on startup (`_purge_expired_sessions` in `lifespan`, logged as `expired_sessions_purged`) **and** on every successful login. Two tests. |
| **M-3** | Major | `app/routers/auth.py:34` (was) | **Unbounded memory growth keyed on attacker input.** `_attempts` is a `defaultdict(list)` keyed on `(client_ip, username)`. `_is_throttled` rewrote `_attempts[key] = recent` even when `recent` was empty, so **every username ever tried left a permanent entry**. An unauthenticated attacker spraying distinct usernames grows the dict without bound on a process meant to run for weeks. | `_attempts[key] = recent` at line 49 with `recent == []`; nothing ever removes a key except `_clear_failures` on success. | **FIXED.** Empty keys are popped, not stored; `MAX_TRACKED_KEYS = 2048` with a stale-key sweep and an oldest-key eviction fallback. Test asserts the map drains to 0 once attempts age out. |
| **M-4** | Major | `app/config.py:30` (was) | **CORS could not be turned off, and a credentialed loopback grant could reach production.** `_env_list` returned the default when the variable was set-but-empty, so `ARCHPILOT_CORS_ORIGINS=` — which `.env.example` explicitly tells operators to use in production — silently re-enabled `http://localhost:5173` **with `allow_credentials=True`**. The config file and the code disagreed, and the code won. | `.env.example`: "this can be left empty in production" vs `if raw is None or not raw.strip(): return default`. | **FIXED.** An explicitly-empty value now means empty list. `Settings.validate()` additionally **refuses to start** in production if any loopback origin is configured. Verified both paths. |
| **M-5** | Major | `app/schemas.py` + `src/domain/*.ts` | **The Python/TypeScript wire contract is already drifting, on the only two endpoints that exist.** Every SPA domain type is camelCase (`WorkspaceRecord.projectName`, `EntityEnvelope.schemaVersion`, `SizingResult.formulaVersion`); the API emitted `display_name`, `expires_at`, `schema_version`, `latency_ms`. This is the concrete form of the cost of decision D2 — not an abstract risk, a live one, before a single frontend call site exists. Left alone it becomes a hand-written mapping layer per resource across ~20 endpoints. | `src/domain/store.ts:4` `projectName` vs `LoginResponse.expires_at`. | **FIXED, and flagged for your objection.** `schemas.ApiModel` now sets `alias_generator=to_camel, populate_by_name=True`; the wire is camelCase, Python stays snake_case, snake_case input is still accepted. Locked by `test_wire_format_is_camel_case`. **Zero consumers exist today, so this was the cheapest possible moment; if you prefer snake_case on the wire, delete the alias generator and say so — but decide now, not at endpoint 20.** |
| **M-6** | Major | `contracts/archgraph.schema.json` | **The D4 mitigation for losing `packages/core` does not exist.** The decision log presents it as the thing that makes the stack switch safe ("reviewers should attack it first"). It is task 0.6 and unwritten. | `ls ArchPilot/contracts` → no such directory. | **NOT FIXED — recommendation in §7.1.** Short version: the mitigation as described is *necessary but not sufficient*, and it is aimed at the wrong risk. Graph-shape drift is the risk it covers; wire-casing and error-envelope drift (M-5) is the risk that actually bit first. |
| **M-7** | Major | *(absent)* | **B2's guard rails are unwritten, and the seed script is on the critical path.** No seed script exists, so nothing is broken today — but C.3/C.4 produce ~9 pd of hand-authored, legally-reviewed content that lives only in the DB, and C.5 is the import path that can overwrite it. | Task C.5, effort 0.5 pd, not started. | **NOT FIXED — acceptance criteria in §7.3.** With `003_publish_gate.sql` in place the seed script can no longer resurrect content into `published` state without an approval row, which removes the worst half of B2 structurally. |
| **M-8** | Major | `app/config.py:47`, `Dockerfile:20-21,33` | **Every backup defaults to the same volume as the database it protects.** `ARCHPILOT_DB_PATH=/data/archpilot.db` and `ARCHPILOT_BACKUP_DIR=/data/backups`, with `VOLUME ["/data"]`. Losing the volume loses the database and all 30 snapshots of it. B4 fixed *how* the copy is made, not *where* it lands. | Dockerfile env block. | **PARTIALLY FIXED** (documented in `backend/README.md` operational notes). The deployment change is devops-master's: mount `ARCHPILOT_BACKUP_DIR` from a different volume/file share, and confirm it in the 7.8 runbook. |
| **M-9** | Major | `Dockerfile:16` vs `.venv` | **Dev and prod run different Python minor versions.** Tests, and therefore every claim in this review, ran on **3.10.11**; the image is `python:3.12-slim`. Nothing in the repo pins or checks this, and there is no CI (task 0.7). A 3.12-only behaviour difference would first appear on the on-prem host. | `FROM python:3.12-slim` / `python --version` → 3.10.11. | **NOT FIXED — recommendation.** Pick one (3.12 is the better choice), recreate the venv on it, add `python_requires`/a CI matrix, and make CI run pytest on the image's interpreter. ~0.25 pd inside task 0.7. |
| **M-10** | Major | `app/routers/health.py:94` | **`/api/health` is unauthenticated and verbose.** It returns `env`, `version`, `schema_version` and, on failure, `str(exc)[:200]` — which for a SQLite error includes the database file path. Fine behind a container network; it is also the endpoint most likely to get exposed when someone port-forwards for debugging. | Observed body: `{"status":"ok","version":"0.1.0","env":"development","schema_version":"002",…}`. | **NOT FIXED — deliberate.** Operators need the detail and `/api/health/live` exists for the dumb probe. Recommendation: in production return `detail` only for `status != "ok"` and strip anything matching the DB path, or require the session for the deep probe and point the Docker `HEALTHCHECK` at `/api/health/live`. Decide with devops-master. |

---

## 6. Minor findings

| # | Severity | File:line | Issue | Fix |
|---|---|---|---|---|
| m1 | Minor | `app/main.py:54` (was) | `/api/docs` and `/api/openapi.json` served unauthenticated in production, publishing the full route schema including the future admin surface. | **FIXED.** `docs_url`/`openapi_url` are `None` when `ARCHPILOT_ENV=production`; `redoc_url` disabled everywhere. Verified. |
| m2 | Minor | `app/main.py` | No `X-Content-Type-Options`, `X-Frame-Options` or `Referrer-Policy`. The same origin will serve user-authored Markdown (pattern bodies) later. | **FIXED.** `SECURITY_HEADERS` applied to every response including error paths. Parametrised test. |
| m3 | Minor | `app/routers/auth.py:108` (was) | Failed logins logged the attempted **username** at INFO. A user who types their password into the username field puts it in stdout, which the Docker log driver ships somewhere. | **FIXED.** Unknown-user failures log no identifier; known-user failures log `user_id`, not the submitted string. |
| m4 | Minor | `tests/test_health.py:17` (was) | `assert body["schema_version"] == "002"` — a hard-coded literal that turns every future migration into a false failure (it failed the moment I added 003). | **FIXED.** Asserted against `discover_migrations()[-1]`. |
| m5 | Minor | `tests/test_migrations_and_backup.py:10` (was) | `assert names == ["001_core.sql", "002_patterns_legal.sql"]` — same brittleness, plus it did not actually test the property that matters. | **FIXED.** Now asserts ordering **and** gapless, unique numeric prefixes — a stronger test that does not need editing per migration. |
| m6 | Minor | `app/content_hash.py:22` + `002:86-94` | Two hand-maintained lists guard one invariant: `LEGALLY_SIGNIFICANT_FIELDS` and the reset trigger's `WHEN` clause. They agree today. Nothing makes them keep agreeing, and drift means a field can be edited after approval without revoking it. | **FIXED.** `test_trigger_and_python_agree_on_the_legally_significant_columns` reads the trigger SQL out of `sqlite_master` and diffs it against the Python tuple. |
| m7 | Minor | `app/db.py:121-124` | `run_migrations` string-interpolates the filename and timestamp into the bookkeeping `INSERT`. It is guarded by `MIGRATION_NAME_RE` and both values are machine-generated, so this is not exploitable — but it is the one place in the codebase that builds SQL by concatenation, and it sits next to `executescript`. | **Not fixed** (the `executescript` single-transaction trick genuinely needs it). Recommend a comment upgrade to "guarded by MIGRATION_NAME_RE — do not relax that regex" and a test that a filename with a quote is rejected. |
| m8 | Minor | `app/dependencies.py:20` | `extract_token` prefers a cookie over a Bearer header, so a stale cookie in a scripted client's jar beats a valid token → confusing 401s. | Recommend: prefer the `Authorization` header when both are present, matching every other API in the world. 2 lines. |
| m9 | Minor | `002:129-140` + `scripts/backup.py` | `patterns` has a `TEXT PRIMARY KEY`, so its rowid is implicit, and `patterns_fts` is external-content keyed on `content_rowid='rowid'`. SQLite reserves the right to renumber implicit rowids during `VACUUM`. I **tested this and could not reproduce it** on SQLite 3.40.1 (5 patterns, 2 deleted to create gaps, rowids preserved, search still resolved correctly) — but "did not happen on this build" is not a guarantee. | Recommend: add `INSERT INTO patterns_fts(patterns_fts) VALUES('rebuild');` plus an fts5 `integrity-check` to the restore runbook (7.4/7.8). Costs milliseconds at 12 patterns and removes the whole question. |
| m10 | Minor | `app/routers/auth.py:37` | Throttling is keyed on `(ip, username)`, so an attacker rotating usernames is never slowed down. It also resets on restart (already acknowledged). At 2–4 accounts the password-guessing case is covered and the enumeration case is now closed by M-1, so this is acceptable — but state it. | **Documented** in `backend/README.md` known limitations. Recommend adding an IP-only counter (e.g. 30 failures / 5 min / IP) when the `login_attempts` table lands. |
| m11 | Minor | `app/routers/auth.py:142` | `response.delete_cookie(...)` emits the clearing cookie without `HttpOnly`/`Secure`/`SameSite`. Harmless (the value is empty) but it is a lint-visible inconsistency with the setter. | Recommend passing the same flags for symmetry. |
| m12 | Minor | repo root | No linter, no type checker, no CI. `requirements.txt` pins exact versions (good) but there is no lockfile and no hashes. | Recommend inside task 0.7: `ruff` + `mypy --strict` on `app/`, `pip-compile`-style hashes, and `pytest` on the image's Python (ties to M-9). |

---

## 7. Recommendations I am *not* implementing

### 7.1 The `packages/core` mitigation (decision D4) — necessary, not sufficient, and aimed slightly off-target

**My assessment: keep the plan, narrow it, and add the thing that actually broke.**

The proposal is `contracts/archgraph.schema.json` validated by pydantic and by a
TypeScript guard, with both suites running the same fixtures. That is a sound,
proportionate mitigation **for graph-shape drift**, and I would not replace it
with anything heavier — no codegen, no OpenAPI-to-TS pipeline, no shared runtime.
At 2–4 users and one graph type, a hand-maintained JSON Schema plus shared
fixtures is right-sized.

But note what actually drifted first, before a single frontend call site existed:
**wire casing** (M-5). `ArchGraph` was never the highest-probability drift point —
it is one well-specified object that both sides read from the same file. The
drift-prone surface is the *envelope* around it: field casing, error shape,
timestamp format, null-vs-absent. So:

1. **Keep task 0.6 as scoped** (~1 pd) — same fixture files, both suites, plus a
   deliberately-broken fixture that must fail both. That last part is the half
   people skip and it is the half that proves the test works.
2. **Add three envelope rules to the same contract file**, because they cost
   almost nothing and they are what bit: wire casing is camelCase (now enforced
   by `test_wire_format_is_camel_case`); errors are always
   `{detail, requestId?}`; timestamps are ISO-8601 UTC with an explicit offset.
3. **Do not** try to share the sizing engine. D3 is right: one implementation in
   TypeScript means zero drift by construction. Leave it.
4. **Put the fixtures where both suites already look** —
   `ArchPilot/contracts/fixtures/*.json`, read by `pytest` and by `vitest`. If a
   fixture has to be copied, the contract is already broken.

**Cost check:** 1 pd as planned, +0.25 pd for the envelope rules. That is a
reasonable insurance premium against the single biggest cost of decision D2.

### 7.2 D3 — the server trusts a client-computed sizing number

I agree with D3 and would not change it. One cheap hardening for when task 3.6
lands, not now: on `POST /api/designs/{id}/sizings`, verify that every entry in
`benchmark_snapshot_json` corresponds to a real `benchmarks` row and that
`formula_version` is in a known set. That is not anti-tampering (a trusted user
can still post nonsense); it is an integrity check that makes the stored artefact
actually reproducible, which is the property D3 claims. ~0.25 pd.

### 7.3 Acceptance criteria for the seed script (C.5 / B2)

When it is written it must satisfy, as tests:

1. Re-running the seed over an existing slug is a no-op (exit 0, no UPDATE).
2. A slug whose current status is `published` or `unpublished` is refused unless
   **both** `--force` and `CONFIRM_OVERWRITE_REVIEWED=1` are given.
3. `TC-COMPLY-004`: a pattern that was unpublished under a takedown cannot be
   returned to `published` by any seed invocation. `003_publish_gate.sql` now
   makes this structurally true — the seed would need to forge an approval row
   with a matching `content_hash` — but test it explicitly anyway.
4. The seed writes `content_hash` via `patterns.resync_content_hash()`, never by
   hand.

### 7.4 In-process login throttling

**Acceptable as-is for 2–4 users on an internal network** — I am not asking for
the `login_attempts` table now. The restart-clears-it property is a real but
minor weakness: an attacker who can restart your container has already won. The
two things that *were* wrong about it (unbounded memory, no enumeration
protection) are fixed. Revisit if the audience grows, alongside R5.

---

## 8. What's good

Credit where it is due, and there is a lot of it.

- **The deep health check is the real thing.** `/api/health` reads *and* writes
  SQLite and returns 503 on either failure, with per-check latency. I broke the
  write path (`DROP TABLE health_probe`) and the read path independently and got
  503 both times. This is exactly what red-team M12 asked for and most teams
  ship a `return {"status":"ok"}` instead.
- **Session handling is right.** Opaque token, only `sha256(token)` stored,
  server-side revocation, expiry checked on every request, httpOnly cookie with
  a Bearer fallback for scripts. A database leak yields neither passwords nor
  replayable sessions. That is the correct design, implemented correctly.
- **The content-hash canonicalisation is careful in a way that matters.**
  Length-prefixed encoding to prevent boundary-shuffling collisions, sorted-key
  JSON re-serialisation so a key reorder does not revoke a valid approval, and a
  `HASH_VERSION` prefix. Someone thought about this properly rather than
  concatenating strings.
- **The FTS5 sync triggers and the VI-diacritic tokenizer are done right**, and
  the tests actually prove it (`kien AND truc` matching `kiến trúc` is a real
  assertion, not a smoke test).
- **The benchmark citation triggers** enforce M7 in the schema rather than in a
  review checklist — the same instinct the red-team praised in D6, applied to a
  new place.
- **The tests are mostly *meaningful*, not count-padding.** `test_deep_health_*`
  break the database and assert the consequence. `test_editing_an_approved_pattern_resets_it_to_draft`
  tests an invariant, not a getter. `test_backup_uses_vacuum_into_and_verifies`
  checks for the absence of `-wal` sidecars, which is the actual property B4
  cares about. Of the 36, I would call ~28 genuinely load-bearing. The weak ones
  are the two brittle literals (m4, m5) and `test_estimated_benchmark_may_omit_a_source_url`,
  which mostly restates the schema.
- **The stub list in build-scope §7 is honest**, including "where I would attack
  this design if I were reviewing it" — which named D2 and D3 correctly. That
  materially shortened this review, and it is the second time in this project's
  document chain that self-honesty has paid off.
- **Three runtime dependencies.** No passlib, no SQLAlchemy, no pydantic-settings,
  no python-jose. For a 2–4-user internal tool this is the right call and it
  keeps the CVE surface near zero.

---

## 9. Summary of changes I made

| File | Change |
|---|---|
| `app/migrations/003_publish_gate.sql` | **new** — publish requires an approved `legal_review` matching `content_hash` (UPDATE + INSERT); a reviewed pattern cannot be deleted |
| `app/repositories/patterns.py` | **new** — `publish_pattern()` recomputes the hash from the row before publishing (the trigger cannot: SQLite has no SHA-256), `resync_content_hash()`, `unpublish_pattern()` returning the derived-design count (M10) |
| `app/csrf.py` | **new** — double-submit CSRF, enforced centrally so a future router cannot forget it; Bearer clients exempt; `/api/auth/login` exempt |
| `app/main.py` | CSRF + security headers wired into the request middleware; expired-session purge on startup; docs/OpenAPI disabled in production |
| `app/db.py` | `snapshot_database()` (single `VACUUM INTO` implementation); `pending_migrations()`; `init_database()` snapshots before migrating and refuses to migrate if the snapshot fails |
| `app/config.py` | `_env_list` honours an explicit empty value; `csrf_cookie_name`; `backup_before_migrate`; `is_production`; production rejects loopback CORS origins |
| `app/repositories/users.py` | `dummy_iterations()` + `hash_password_dummy(conn, …)` close the enumeration oracle; `upgrade_password_iterations()` converges stored hashes on login |
| `app/routers/auth.py` | CSRF cookie issued on login and cleared on logout; session purge on login; throttle map bounded and drained; failed-login logging no longer echoes the submitted username |
| `app/schemas.py` | `ApiModel` base with `alias_generator=to_camel, populate_by_name=True` — camelCase wire format |
| `app/security.py` | `new_csrf_token()` |
| `scripts/backup.py` | delegates to `app.db.snapshot_database`; `prune()` never deletes a pre-migration snapshot |
| `tests/test_csrf.py` | **new** — 10 tests: token issuance, missing/mismatched/valid token, Bearer exemption, login exemption, safe methods, security headers, camelCase wire lock |
| `tests/test_legal_gate.py` | **new** — 10 tests, each reproducing something that succeeded against the shipped 002 schema |
| `tests/test_auth.py` | +5 tests: iteration convergence, dummy-iteration parity, session purge (twice), throttle-map bounding |
| `tests/test_migrations_and_backup.py` | +3 tests: premigrate snapshot taken / not taken on a fresh DB / never pruned; migration-ordering test strengthened |
| `tests/{conftest,test_health,test_schema_invariants}.py` | `login` fixture returning CSRF headers; brittle literals replaced; publish path in the FTS test now goes through the legal gate |
| `README.md`, `.env.example` | CSRF usage, backup-before-migrate, backup-volume warning, production CORS rule, revised known-limitations list |

**Test suite: 36 → 65, all passing** (`65 passed, 1 warning in 10.65s`).

---

## 10. Open questions for humans

1. **Senior Developer #1 — wire casing.** I switched the API to camelCase
   (M-5) because zero consumers exist today and it is the cheapest moment
   there will ever be. If you disagree, say so now: it is one `ConfigDict` line
   to revert, and one very expensive decision to revisit at endpoint 20.
2. **Senior Developer #1 / PO — B3 ownership and gating.** Task 3.1 is the last
   unfixed architecture blocker. Confirm that no sizing UI work starts before
   3.1 + 3.2 land, and that the four worked examples from the red-team are the
   acceptance tests.
3. **PO / legal — deletion of reviewed patterns is now impossible.** Takedown is
   unpublish, which matches the design, but confirm there is no real-world
   requirement to *erase* a pattern (e.g. a rights-holder demanding deletion
   rather than removal). If there is, the answer is a separate, logged,
   admin-only purge path that archives `legal_reviews` first — not relaxing the
   trigger.
4. **Devops — backup volume.** M-8 needs a deployment decision: which mount does
   `ARCHPILOT_BACKUP_DIR` point at, and who verifies it is not the database's
   volume?
5. **PO — the audit question the red-team raised and the PO answered.** With no
   second reviewer (decision 3), `003_publish_gate.sql` is now the *only*
   mechanical control between an author and publication. It enforces "these
   exact bytes were self-certified", which is real, and it is not a substitute
   for the independent check that was traded away. Worth restating before G3.

---

## 11. Next handoff

| Agent / role | What they need to do |
|---|---|
| **senior-developer-1** | **Immediate, in this order:** (1) answer open question 1 (wire casing) — it blocks `src/api/client.ts`; (2) task 0.6, `contracts/archgraph.schema.json` + shared fixtures + the deliberately-broken fixture, with the three envelope rules from §7.1; (3) task 3.1/3.2, the corrected sizing engine — the last open blocker. Do **not** start Phase 1 routers before 0.6: every router written first is a router that has to be re-cased. |
| **ba-qa-analyst** | Test plan for what is now enforceable: `TC-COMPLY-002` (edit-after-approval → draft) and `TC-COMPLY-003` (search hides drafts) are already green; add `TC-COMPLY-005` (publish with no approval is refused **at the storage layer**) and `TC-COMPLY-006` (a reviewed pattern cannot be deleted). `TC-COMPLY-004` needs the seed script first — see §7.3 for its acceptance criteria. `TC-FUNC-CALC-010` is blocked on F-4. |
| **security-architect** | STRIDE pass, with these as inputs rather than discoveries: local auth and the PBKDF2 cost-factor upgrade path (M-1), the double-submit CSRF model in `app/csrf.py` (is exempting Bearer clients acceptable in your threat model?), the unauthenticated deep health endpoint (M-10), the admin role boundary, and — before Phase 4 — Markdown → HTML rendering of `patterns.body_md`. |
| **dba-master** | Validate `003_publish_gate.sql` under `recursive_triggers = OFF`, specifically the interaction between the BEFORE publish gate and the AFTER reset trigger in a single statement that changes both content and status. Also: index coverage for the facet queries, and m9 (implicit rowids vs FTS5 external content across `VACUUM`). |
| **devops-master** | M-8 (backup volume must not be the database volume), M-9 (dev/prod Python skew + CI on the image's interpreter), task 0.7 CI with `ruff`/`mypy`, Litestream, and the restore runbook — which must now include `INSERT INTO patterns_fts(patterns_fts) VALUES('rebuild')` per m9. |
| **Product Owner** | Open questions 2, 3 and 5. Question 3 is the only one with a legal dimension. |

---

**Verdict: Approve-with-changes.** 5 Blocker · 10 Major · 12 Minor. Four of five
blockers and ten of the remaining findings are fixed in code as part of this
review; the suite is 65 green. The one blocker I am handing back is **F-4, the
unfixed sizing engine (red-team B3)** — it is TypeScript work with its own test
plan and it gates any sizing UI.

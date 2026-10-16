# Code Review — ArchPilot v2 Phase 0 (contract 1.1.0, catalogue, graph core, integrity, SPA fallback)

| Field | Value |
|---|---|
| Title | Review and hardening of v2 Phase 0 (build-scope §7.0, tasks 0.2-0.6) |
| Author | Senior Developer #2 (Reviewer) |
| Date | 2026-09-24 |
| Version | 1.0 |
| Code reviewed | Commit `46539eb` (senior-developer-1), plus my fixes in the working tree (uncommitted; no git writes were made) |
| Inputs read | `docs/systemsarchitect-build-scope.md` §7.0, `docs/requirements-v2.md` v2.1 §4.1.1, `docs/design-v2.md` v0.3 §4.3.10, `docs/reviews/review-design-v2.md` |
| Code read | `contracts/archgraph.schema.json`, `contracts/catalog/*`, `contracts/fixtures/*`, `src/domain/graph/*`, `backend/app/{graph_integrity,catalog,contract,schemas,spa,main,db,csrf,dependencies}.py`, `backend/app/routers/designs.py`, `backend/app/repositories/designs.py`, migration 005, `backend/Dockerfile` |
| Verdict | **Approve-with-changes.** The one Blocker and four of the five Majors are fixed, with tests. One Major (fonts and CSP) and 7 Minors remain as recommendations |
| Finding counts | **1 Blocker, 5 Major, 11 Minor** (fixed: 1 B, 4 M, 4 m) |

---

## 1. Executive summary

### English

Phase 0 is good work. I tried hard to break it, and most of it held. Over 13,000 random graphs, the TypeScript and Python integrity checks agreed on every rule code, path and order. Content hashing matches an independent Python RFC 8785 implementation on 4,000 random values. Migration 1.0 → 2.0 is lossless and idempotent over 400 random documents. The command layer never broke integrity or the contract across 300 random 60-step edit sessions.

I found one Blocker, and it predates Phase 0. SQLite connections were opened with Python's default `check_same_thread=True`, but FastAPI moves a request between worker threads. Against a real server, **599 of 600 concurrent requests failed with a 500**, sometimes after the write had already been saved.

I also found a denial-of-service path. Each 1 MiB save froze the whole server for about 9 seconds, and oversized uploads for over a minute. `NaN` or `1e400` in a graph caused a 500.

Integrity messages differed between the two languages in 59% of random cases. Nothing tested rule order, so a reordering would have gone unnoticed. The provider-neutrality scan could not see words such as `awsRegion`.

All of these are fixed and covered by 66 new pytest and 286 new vitest tests. Every fix was checked by breaking it again and watching a test fail. The main open item is to self-host the fonts so the CSP can drop Google.

### Tiếng Việt

Phase 0 là một phần việc tốt. Tôi đã cố gắng phá nó và phần lớn đều đứng vững. Trên hơn 13.000 đồ thị ngẫu nhiên, bộ kiểm tra toàn vẹn TypeScript và Python cho cùng mã quy tắc, đường dẫn và thứ tự. Băm nội dung khớp với một bản cài đặt RFC 8785 độc lập bằng Python trên 4.000 giá trị ngẫu nhiên. Chuyển đổi 1.0 → 2.0 không mất dữ liệu và lũy đẳng trên 400 tài liệu ngẫu nhiên. Lớp lệnh không làm hỏng tính toàn vẹn hay hợp đồng trong 300 phiên chỉnh sửa ngẫu nhiên, mỗi phiên 60 bước.

Tôi tìm thấy một lỗi chặn (Blocker), và lỗi này có từ trước Phase 0. Kết nối SQLite được mở với mặc định của Python `check_same_thread=True`, trong khi FastAPI chuyển một yêu cầu qua nhiều luồng. Trên máy chủ thật, **599/600 yêu cầu đồng thời bị lỗi 500**, đôi khi sau khi dữ liệu đã được lưu.

Tôi cũng tìm thấy một đường tấn công từ chối dịch vụ. Mỗi lần lưu 1 MiB làm treo toàn bộ máy chủ khoảng 9 giây, còn tệp tải lên quá lớn làm treo hơn một phút. `NaN` hoặc `1e400` trong đồ thị gây lỗi 500.

Thông báo toàn vẹn khác nhau giữa hai ngôn ngữ ở 59% trường hợp ngẫu nhiên. Không có kiểm thử nào kiểm tra thứ tự quy tắc, nên việc đảo thứ tự sẽ không bị phát hiện. Bộ quét trung lập nhà cung cấp không nhìn thấy các từ như `awsRegion`.

Tất cả đã được sửa và có 66 kiểm thử pytest và 286 kiểm thử vitest mới. Mỗi bản sửa đã được kiểm chứng bằng cách cố ý làm hỏng lại và thấy một kiểm thử thất bại. Việc còn mở chính là tự lưu trữ phông chữ để CSP bỏ được Google.

---

## 2. What I ran (evidence)

| Check | Result |
|---|---|
| Baseline at `46539eb` | `ruff` clean · **323 pytest** · `tsc -b` clean · **387 vitest** (reproduced §7.0.4 exactly) |
| After my fixes (tree also holds the two other agents' in-progress work) | `ruff check .` clean · **389 pytest** (+66, all mine) · `tsc -b` clean · **963 vitest in 37 files** (+286 mine; the rest are the other agents') · `npm run build` OK (`index-*.js` 715.54 kB, gzip 220.65 kB; the growth is the design agent's canvas) |
| Integrity differential (ad hoc) | 13,000 generated contract-valid documents (seeds 1, 7, 42), all 19 rules hit thousands of times: **0 code/path/order mismatches**; **1,777 of 3,000** message mismatches before the fix, **0** after |
| Real-server probes (uvicorn on 127.0.0.1, throwaway DB, no Docker) | HEAD: `/api/health` blocked **9.47 s** during one 1 MB save, and that save returned **500**; after the fix, 16 health samples at 0.5-0.8 s and the save returned 201. HEAD: **599/600** concurrent authenticated GETs → 500 (`sqlite3.ProgrammingError`); after the fix, **600/600 → 200** |
| JCS cross-check | 4,000 random JSON values (astral/NFD keys, controls, subnormals, 2^53+1, 1e21, random 64-bit doubles), serialised by Python and parsed by JS as the server round trip does: TS `canonicalJson` + SHA-256 == independent Python reference, **0 mismatches**. The golden hash in `hash.test.ts` (`8c560a7d…`) is now independently reproduced |
| Mutation checks | **18 of 18 mutants killed** (table in §7) |

---

## 3. Blockers

| Severity | File:line | Issue | Evidence | Fix (applied) |
|---|---|---|---|---|
| **Blocker** B1 (pre-existing since v1.4, exposed by any concurrency) | `backend/app/db.py:44` (HEAD) | `sqlite3.connect()` used the default `check_same_thread=True`. FastAPI runs a sync yield dependency's setup (`get_connection`), the other sync dependencies, the handler and the teardown as **separate threadpool calls**. Under concurrency they land on different worker threads | HEAD against real uvicorn with 16 concurrent clients: `{500: 599, 200: 1}`, log `ProgrammingError: SQLite objects created in a thread can only be used in that same thread`, raised in `conn.close()` **after** writes had committed, so the client saw a 500 for a saved design and would retry into a duplicate. TestClient runs requests one at a time, so the suite never saw it | `sqlite3.connect(..., check_same_thread=False)` with a comment on why it is safe: one connection per request, used by one thread at a time, in sequence. New `tests/test_concurrency.py`: a deterministic hand-off test plus 120 overlapping API requests. Both fail if the fix is reverted |

---

## 4. Major findings

| Severity | File:line | Issue | Evidence | Fix |
|---|---|---|---|---|
| **Major** M1 — fixed | `src/domain/graph/validate.ts:52` (HEAD `show`) · `backend/app/graph_integrity.py:78` | Parity was held by 17 one-rule fixtures only. TS `show()` was not Python `repr()`: wrong quotes for `o'brien`, raw `\t`/`\n`/`\x1b`/U+2028, and truncation in UTF-16 units instead of code points. Ids are free strings (`$defs/id`, no pattern), so this is reachable | 1,777/3,000 random cases had different messages. Swapping `_check_deployment`/`_check_decisions` in Python, or changing `repr`, **passed the whole suite** at HEAD | `pythonRepr()` in `validate.ts` (CPython `unicode_repr` rules; `\p{C}\p{Z}` for isprintable; code-point truncation). Added a generated corpus `contracts/differential/integrity.corpus.json` (120 contract-valid docs, all 19 rules, adversarial ids) from `backend/tests/integrity_corpus.py`. Both suites assert exact `[code, path, message]` lists: `tests/test_integrity_differential.py`, `src/domain/graph/integrity.differential.test.ts`. The corpus lives outside `contracts/fixtures/` so the manifest and its "every file is listed" checks stay untouched |
| **Major** M2 — fixed (residual below) | `backend/app/schemas.py:44-62` (HEAD) · FastAPI `dependencies/utils.py:876-912` | (a) The contract and integrity pass ran as a pydantic validator, and FastAPI validates bodies **on the event loop**. (b) Shape was checked **before** size, and 1.0 arrays have no `maxItems`. (c) There was no request body limit (build-scope 7.2 item 3c) | Worst case under 1 MiB: jsonschema **5.4 s** (1.0, 14,500 nodes), **6.1 s** (2.0 max arrays). Oversized 1.0: **13 s at 1.4 MB, 64 s at 7 MB** before the 1 MiB cap refused it. Health blocked 9.47 s on a real server | `check_archgraph()`: size first (also the NaN/surrogate gate), then contract, then integrity. It is called from the **sync handlers** (worker thread) via `routers/designs.py:_validated_graph`, before any repository call, so 404-not-403 still holds; the 422 text is unchanged (`body.graph: Value error, …`). New `app/body_limit.py`: pure ASGI guard, **413** `{detail, requestId}` for a declared body > 4 MiB; a streamed body is cut off at the limit (FastAPI reports its 400 envelope). Tests: `tests/test_request_limits.py` (17) |
| **Major** M3 — fixed | `backend/app/schemas.py` (HEAD size check) | Python `json.loads` accepts `NaN`, `Infinity`, `-Infinity`, and `1e400` (→ `inf`). The schema's `"type": "number"` accepts them; migration 005's `json_valid` trigger then refused the row → **500**. A lone surrogate gave a raw codec message | Probe: all four → `500 internal server error` with `IntegrityError: designs: schema_version must be…` (misleading) | `json.dumps(..., allow_nan=False)` in `_encoded_size`, with explicit 422 messages: "graph contains NaN or Infinity (or a number too large for a double, such as 1e400)" and "graph contains an unpaired UTF-16 surrogate". Finite `-0`, `1.0` and 30-digit integers still round-trip (tested) |
| **Major** M4 — fixed | `src/test/neutrality.ts:14` · `backend/tests/test_catalog.py:208` | The NFR2-NEUT-001 scanner lowercases first, so a token glued into camelCase is invisible: `awsRegion`, `s3Bucket`, `vSphereCluster`, `AWSRegion`, `cosmosDb`. Config keys are camelCase **by contract**, so that is exactly where a vendor term would hide | `neutralityHits({config:{awsRegion:1}})` → `[]` at HEAD | Both scanners now also test every contiguous join of camelCase parts against the single-word tokens. `awesomeRegion` and `cardsDeck` stay clean. Negative controls added in both suites, plus a test pinning the core tokens (never delete one to make a test pass). Before tightening, I re-scanned the catalogue, contract, every fixture, and the IaC agent's fixtures and goldens: **no new hits**, so nothing turned red |
| **Major** M5 — **open** | `backend/app/main.py:47-60` · `src/styles.css:1` | CSP allows `https://fonts.googleapis.com` / `https://fonts.gstatic.com` because `styles.css` `@import`s Google Fonts. Air-gapped hosts (NFR2-DEP-001) silently fall back, and the CSP trusts a third party. `style-src 'unsafe-inline'` is probably unnecessary: the built `index.html` has no inline `<style>`/`<script>`, and React style props go through the CSSOM, which CSP does not block | Read `dist/index.html`; no `dangerouslySetInnerHTML` / `setAttribute('style')` in `src/` | **Not done:** `package.json`, `package-lock.json` and `src/styles.css` were being edited by other agents at the time. Recipe (~0.25 pd): `npm i -E @fontsource-variable/dm-sans @fontsource-variable/space-grotesk @fontsource/dm-mono`, import them in `src/main.tsx` (Vite bundles the woff2 under `/assets`, same origin, `immutable`), delete line 1 of `styles.css`, then set `style-src 'self'` and `font-src 'self'`. Try dropping `'unsafe-inline'` in a real browser with the canvas open (the xyflow canvas is the likely consumer); keep it only if something breaks |

**M2 residual (recommendation).** A legitimate 1 MiB save still costs about 5-6 s of pure-Python CPU. It is now off the event loop, but it holds the GIL, so other requests slow down (0.5-0.8 s health latency during a save) rather than stall. Options, cheapest first:
1. Cap 1.0 documents at the 2.0 limits (500 nodes, 1000 edges). This touches a frozen schema, so it needs an SA decision.
2. Pre-resolve `$ref`s once, or cache a compiled validator per `schemaVersion`.
3. Validate in a `ProcessPoolExecutor`.

---

## 5. Minor findings

| Severity | File:line | Issue | Evidence | Fix |
|---|---|---|---|---|
| Minor m1 — fixed | `backend/app/spa.py:66` (HEAD) | A NUL byte in the path (`/hub%00x`, `/assets/x%00.js`) made StaticFiles raise `ValueError`: an **unauthenticated 500** with a full traceback in the log, on any OS. An over-long path 500s on Windows (WinError 123) | Probe output | `get_response` treats `ValueError`/`OSError` as "no such file": 404 envelope, or the shell under the normal fallback rules; never the shell for a NUL path. `tests/test_spa_hardening.py` |
| Minor m2 — fixed | `backend/app/spa.py:77-80` (HEAD) | Cache headers followed the raw URL: `/assets/..%2findex.html` served `index.html` as **`immutable`** for a year; `/index.html/` got no `no-store` | Probe: `cc=public, max-age=31536000, immutable` on HTML | Decide on the normalised served path (`path`), not `scope["path"]`. Tested, plus a traversal matrix (16 cases, `%2f`, `%5c`, `%2e%2e`) with a marker file next to the static dir: never served |
| Minor m3 — fixed | `src/domain/graph/hash.ts:47-61` (HEAD) | `canonicalJson([ , 1])` → `"[,1]"` (invalid JSON; `.map` skips holes). `Date`/`Map`/`Set`/class instances hashed as `{}`, so two different dates got one hash. Lone surrogates were accepted (RFC 8785 requires I-JSON) | vite-node probe | `Array.from`; refuse non-plain objects (null-prototype objects allowed); refuse unpaired surrogates. `src/domain/graph/hash.vectors.test.ts`. I A/B-tested the design agent's autosave test (it calls `canonicalJson`) against HEAD's `hash.ts`: it passes with both |
| Minor m4 — fixed (evidence) | `contracts/differential/jcs.vectors.json`, `backend/tests/jcs_reference.py` | "TS and Python hash identically" was unprovable: Python has no JCS, and the golden hash was a one-off | — | Independent Python RFC 8785 + NFC reference (ES `Number::toString` from `repr` digits, UTF-16 key order) and 148 shared vectors. Both suites assert byte-identical canonical text and SHA-256. It is a ready, tested port if the server ever has to verify `derivations` |
| Minor m5 — open | `src/domain/graph/migrate.ts:50-92` | A **valid** 1.0 document can migrate to an **invalid** 2.0 one: 1.0 has no `maxItems` and no `props` limits | `props` value of 2001 chars → `/nodes/0/config/note must NOT have more than 2000 characters`; 101 props → `maxProperties`; 501 nodes → `maxItems` (all shown with ajv) | Have `migrateGraph` refuse with `MigrationError('MIG-LIMIT', …)` naming the limit, so the UI can say "too large for 2.0: split it" instead of an autosave 422 loop. Real exposure is low (1.0 designs only came from the API) |
| Minor m6 — open | `src/domain/graph/commands.ts:133-144, 304-321, 417-435` | Commands enforce L1 integrity but not contract limits on `config` (≤100 keys, strings ≤2000, lists ≤100×200), `rationale` and `annotation.text` (≤4000). Such edits pass locally and 422 at save. `updateEdge` to `kind: 'flow'` keeps `mode` | Code reading; the property test stays inside the limits | Validate `config` values against `configValue` in `checkConfig()` for `addNode`/`updateNode`/`setBinding`; cap `rationale`/`annotation.text`; clear `mode` when `kind` becomes `flow` |
| Minor m7 — open (design) | `contracts/catalog/components.json` NEST rules | On-prem coherence: NEST-07 allows `dns`, `function` and `client` only at root or in a site, but internal DNS lives in a management segment and on-prem functions run on a container platform. `zone` cannot nest in `zone` (room > rack). A workload on a physical host cannot be expressed (`bare_metal_host`/`virtual_machine` are not containers; fine if "runs on" is a binding, but say so) | Catalogue reading; all are warnings, never save-blocking | SA/BA: move `dns` to NEST-05's parent set, let `function` nest in `container_platform`/`network_segment`, allow `zone` in `zone`, and document that host placement is a deployment binding. The Must/Should role coverage of §4.1.1 is complete (44 + `artifact_registry` = 45) |
| Minor m8 — open (policy) | `components.json` roles[22], `aliases.kubernetes_cluster` | `container_platform` names **Kubernetes** in `purpose.en`, `purpose.vi` and synonyms `kubernetes`/`k8s`, while `kubernetes` is also a `DeploymentTarget`. It is not in the token list, so the scan passes | Extended-token scan | PO/BA: either accept it as a generic industry term (keep synonyms for search, drop it from `purpose`), or treat it as a target and move it to realisation data |
| Minor m9 — open | `backend/app/spa.py:43-47` · `main.py:69` | `Accept: text/html;q=0` and `text/htmlx` still get the shell (substring test). `/api.v2`, `/apix` and `/API/x` get the shell, which is acceptable: the router shows not-found and nothing leaks. `CSP_EXEMPT_PREFIXES` `"/api/docs"` also matches `/api/docsX` (a JSON 404 without CSP, harmless) | Probe | Optional: parse media ranges and ignore `q=0`; make the exemption exact (`/api/docs`, `/api/docs/oauth2-redirect`, `/api/openapi.json`) |
| Minor m10 — open | `backend/app/schemas.py` request parsing | Duplicate JSON keys are accepted, last one wins (the same as `JSON.parse`, so the stored document is consistent). `\u0000` is accepted in names and labels | Probe: `{"schemaVersion":"2.0","schemaVersion":"1.0",…}` → 201 as 1.0 | Optional: reject duplicate keys via `object_pairs_hook` in a custom JSON body parser; decide whether labels may carry control characters (contract pattern, so SA) |
| Minor m11 — open (pre-existing / other owners) | `backend/Dockerfile:62` · `main.py:197` · `src/features/design/workspace.test.tsx` | `chown -R archpilot /data /srv` makes app code writable by the runtime user (chown only `/data`). `x-request-id` is echoed unvalidated (length bounded by h11; no injection with JSON logs). The design agent's "50 edits undo" test takes **~20 s against a 30 s timeout** and failed once under full-suite load | Measured | Devops: `chown -R archpilot /data`. Validate the request id with `^[A-Za-z0-9._:-]{1,128}$`, else mint one. Design agent: shrink that test or raise its timeout |

---

## 6. What I changed (all uncommitted; no git writes)

**Backend**
- `app/db.py`: `check_same_thread=False` (B1).
- `app/schemas.py`: `check_archgraph()` (size → contract → integrity), `_encoded_size()` (NaN/Infinity/surrogate gate). `ArchGraphDocument` is now a plain `dict[str, Any]`, so model names and wire shape are unchanged (M2, M3).
- `app/routers/designs.py`: `_validated_graph()` runs the gates at the top of POST/PUT in the worker thread and raises `RequestValidationError`, so the 422 text is identical (M2).
- `app/body_limit.py` (new) + `app/main.py`: `BodySizeLimitMiddleware`, 4 MiB, innermost, so the 413 carries `x-request-id` and CSP (M2).
- `app/spa.py`: NUL/OS-error paths → 404; cache decisions on the served file (m1, m2).
- Docstring touch-ups in `graph_integrity.py` and `repositories/designs.py` (they named the old validator location).

**Frontend domain** (API surface unchanged; `pythonRepr` is module-private)
- `src/domain/graph/validate.ts`: faithful `repr()` + code-point truncation (M1).
- `src/domain/graph/hash.ts`: array holes, non-plain objects, unpaired surrogates (m3).
- `src/test/neutrality.ts`: camelCase-aware scan (M4).

**Tests and data**
- New, backend: `tests/{test_concurrency, test_request_limits, test_spa_hardening, test_integrity_differential, test_jcs_vectors}.py`, `tests/integrity_corpus.py` and `tests/jcs_reference.py` (generators, not collected).
- New, frontend: `src/domain/graph/{integrity.differential, hash.vectors, migrate.property, commands.property}.test.ts`.
- Edited: `backend/tests/test_catalog.py` and `src/domain/graph/catalog.test.ts` (scanner + negative controls).
- `contracts/differential/integrity.corpus.json` (370 KB) and `jcs.vectors.json` (35 KB): generated, with a `description` saying so; regenerate with `python -m tests.integrity_corpus` / `python -m tests.jcs_reference` from `backend/`. Outside `contracts/fixtures/`, so the manifest is untouched. The Dockerfile's `COPY contracts` already includes them for `tsc -b`.

Not mine: `build/` (IaC agent's `scripts/iac-validate.mjs` scratch, already git-ignored by that agent), `docs/demov1/`, `scripts/`, `.gitattributes`, `.tools/`, and the `.gitignore` change. I did not touch or ignore them.

---

## 7. Mutation checks (break a rule, confirm a test fails, restore)

| # | Mutation | Result |
|---|---|---|
| PY1 | Swap deployment/decision rule groups in `graph_integrity.py` | 1 failed: **only the new differential test** (it passed the whole HEAD suite) |
| PY2 | `_show` without `repr` | 1 failed: **only the new differential test** |
| PY3 | INT-DEPTH off by one | 3 failed |
| PY4 | Drop `allow_nan=False` | 6 failed |
| PY5 | Size check after contract | 1 failed |
| PY6 | Skip the gates on POST | 43 failed |
| PY7 | Remove SPA `ValueError/OSError` handling | 9 failed |
| PY8 | Cache decision on the raw URL again | 3 failed |
| PY9 | Body limit ×100 | 1 failed |
| PY10 | `check_same_thread` back to default | 2 failed |
| TS1 | Swap rule groups in `validate.ts` | 24 failed |
| TS2 | Old `show()` | 71 failed |
| TS3 | Drop the surrogate check | 2 failed |
| TS4 | `.map` over sparse arrays | 1 failed |
| TS5 | `removeNode` keeps bindings | 3 failed |
| TS6 | Migration drops `rationale` | 2 failed |
| TS7 | Scanner without camelCase | 1 failed |
| TS8 | `lift` without position shift | 2 failed |

---

## 8. What's good (credit)

- **Parity is real where it matters.** 13,000 random documents gave zero code/path/order disagreements. The cycle walk, "report a loop once, anchored at its first member", and first-id-wins duplicate handling are identical down to edge cases (self-loops, loops below dangling parents, 64-char astral ids).
- **The command layer is excellent.** 300 random 60-step sessions (more than 4,000 accepted commands across all 12 types, more than 1,000 refused): never an integrity error, never contract-invalid, never a mutated input. Refusals are atomic and carry honest codes.
- **Migration** is lossless, ordered, deterministic and idempotent (the same object for 2.0), and adds no deployment (REQ-TGT-003). Code names are always valid and unique, even for emoji-only, CJK-only, digit-first and 120-character labels.
- **Hashing** is correct JCS + NFC, with no Web Crypto dependency. The pinned golden hash is now independently reproduced.
- **Migration 005** cannot be bypassed through the API: the API always derives `schema_version` from the parsed document, and the trigger even caught the NaN case.
- **The SPA fallback is narrow and correct.** No traversal (16 encodings), `/api*` always JSON, `/assets/*` misses are 404, HEAD works, unsafe methods are 405, and CSP is on every response. 404-not-403 and CSRF are unchanged (re-tested with the new validation order).
- **The neutrality scan is a real scan** with negative controls, and the catalogue covers every v2.1 Must/Should role with sensible on-prem containers.
- The build note's "weakest points" list (§7.0.5) was honest and pointed at the right places.

---

## 9. Open questions for humans

1. **1.0 limits (M2 residual, m5):** may 1.0 documents be capped at 500 nodes / 1000 edges (frozen schema edit), or must migration refuse over-limit documents instead?
2. **Kubernetes in the neutral catalogue (m8):** is it a generic term or a target name?
3. **On-prem NEST rules (m7):** DNS in segments, functions in platforms, zone-in-zone. BA/SA to confirm.
4. **Control characters in labels (m10):** should the contract forbid them?

## 10. Next handoff

- **senior-developer-1:** m5 (`MIG-LIMIT`), m6 (command-level contract limits, clear `mode` on flow). Please re-run the corpus generators if you change a rule or message on purpose.
- **devops-master:** M5 fonts/CSP once `package.json` is quiet; Dockerfile `chown` (m11); put the 4 MiB request cap on the TLS proxy too; build and run the image once Docker Desktop is repaired (still unverified: §7.0.5 item 1).
- **security-architect:** CSP without `'unsafe-inline'` after self-hosting; duplicate-key policy; request-id validation.
- **ba-qa-analyst:** add "two concurrent users" and "1 MiB save while another user browses" to the acceptance test plan (B1, M2 were invisible to single-client tests).
- **design agent (src/features/design):** the 20 s undo test near its 30 s timeout.

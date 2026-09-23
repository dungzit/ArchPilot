# Review — CI workflow (task 0.7), Node 24 Docker bump, and the `main.tsx` split (task 1.1)

| | |
|---|---|
| **Author** | Senior Developer #2 (Reviewer / Challenger) |
| **Date** | 2026-09-23 |
| **Version** | 1.0 |
| **Code reviewed** | `.github/workflows/ci.yml` · `ArchPilot/Dockerfile` · `ArchPilot/backend/Dockerfile` · `ArchPilot/.dockerignore` · `ArchPilot/backend/ruff.toml` + the 7 ruff-touched Python files · `ArchPilot/src/{main.tsx,app,ui,features}` (25 files) · `ArchPilot/package.json` + `package-lock.json` |
| **Commit reviewed** | **None. This directory is not a git repository** — see Blocker B-1. Reviewed against the working tree as of 2026-09-23 02:40 local. |
| **Verdict** | **Approve-with-changes.** Two blockers found; one is fixed in code by this review, one is a process call only the Product Owner can make. |
| **Related** | `docs/development/systemsarchitect-build-scope.md` v1.3 · `docs/development/reviews/review-systemsarchitect-backend.md` v1.0 |

---

## 1. Executive summary

**English.** The engineering work in this round is good and, unusually, the
evidence behind it holds up. I re-ran every claim rather than accepting it:
`ruff check` is clean, **90 pytest pass**, **63 vitest pass**, `tsc -b` and
`vite build` are clean, and I rebuilt the frontend from a wiped tree with a real
`npm ci` on Node 24 / npm 11 — it produced a byte-identical bundle. The
`main.tsx` split is genuinely proved: dev-1's before/after DOM dumps survived in
the scratchpad, and I verified independently that all 36 states are byte-equal
(`sha256 e0fb62a4…`) **and** that the "after" capture is newer than every source
file it covers, so the proof is not stale. I read all 19 extracted screen files
and found no dropped prop, no typo and no changed handler. Two real defects did
come out of reading rather than running: the backend image sets
`ARCHPILOT_ENV=production` but not the two settings its own `validate()` demands,
so **`docker run` crashes at import every time** — I reproduced it and fixed it;
and `ruff.toml`'s header claimed it catches f-strings in SQL when the `S` rules
were never selected — the same "claiming protection you do not give" sin dev-1
correctly removed seven dead `# noqa`s for. The single largest risk is not code
at all: **this project has no version control.** Tonight's ~35 changed files, the
backend scaffold, the contracts and a 25-file refactor exist in exactly one
place, with no diff history and no way to revert. That is why I could not diff
the refactor against the original `main.tsx` — it no longer exists anywhere.

**Tiếng Việt.** Phần việc kỹ thuật vòng này là tốt, và hiếm khi thấy, bằng chứng
đi kèm là đứng vững. Tôi đã chạy lại từng tuyên bố thay vì tin lời: `ruff check`
sạch, **90 test pytest pass**, **63 test vitest pass**, `tsc -b` và `vite build`
sạch, và tôi dựng lại frontend từ cây thư mục trống bằng `npm ci` thật trên Node
24 / npm 11 — bundle ra giống hệt từng byte. Việc tách `main.tsx` được chứng minh
thật: bản dump DOM trước/sau của dev-1 còn nằm trong thư mục tạm, và tôi tự kiểm
chứng được cả 36 trạng thái giống nhau từng byte (`sha256 e0fb62a4…`), đồng thời
bản chụp "sau" mới hơn mọi tệp nguồn mà nó bao phủ, nên bằng chứng không bị cũ.
Tôi đã đọc toàn bộ 19 tệp màn hình được tách ra và không thấy prop bị rơi, không
lỗi chính tả, không handler bị đổi hành vi. Hai lỗi thật lộ ra từ việc đọc chứ
không phải chạy: image backend đặt `ARCHPILOT_ENV=production` nhưng không đặt hai
biến mà chính hàm `validate()` của nó bắt buộc, nên **`docker run` luôn chết ngay
lúc import** — tôi đã tái hiện và sửa; và phần chú thích của `ruff.toml` tuyên bố
bắt được f-string trong SQL trong khi nhóm luật `S` chưa từng được bật — đúng
kiểu "hứa một lớp bảo vệ không tồn tại" mà chính dev-1 đã sửa khi gỡ bảy `# noqa`
chết. Rủi ro lớn nhất không nằm ở mã nguồn: **dự án này không có quản lý phiên
bản.** Khoảng 35 tệp thay đổi tối nay, bộ khung backend, phần contracts và một
đợt refactor 25 tệp chỉ tồn tại ở đúng một chỗ, không lịch sử thay đổi, không thể
hoàn tác. Đó cũng là lý do tôi không thể so sánh bản refactor với `main.tsx` gốc
— tệp gốc không còn tồn tại ở bất kỳ đâu.

---

## 2. What I actually ran (all on 2026-09-23, Windows 10, Python 3.10.11, Node 24.18.0, npm 11.16.0)

| Command | Result | Verdict on the claim |
|---|---|---|
| `ruff check .` (`ArchPilot/backend`) | `All checks passed!` | **Confirmed** |
| `pytest` (`ArchPilot/backend`) | `90 passed, 1 warning in 11.73s` | **Confirmed** — the warning is starlette-internal `anyio`, as documented |
| `npm run typecheck` (`ArchPilot`) | clean, no output | **Confirmed** |
| `npm test` (`ArchPilot`) | `3 passed (3)` / `63 passed (63)` — 34 sizing + 23 contract + 6 shell | **Confirmed** |
| `npm run build` (`ArchPilot`) | `1906 modules transformed`, `dist/assets/index-Zhds7TUv.js 296.81 kB (gzip 87.52 kB)` | **Confirmed** |
| **Clean-room rebuild**: fresh dir, `package.json` + lock + `src` + `contracts` only, `npm ci` → `typecheck` → `test` → `build` | 114 packages, **63 passed**, identical asset hashes `index-Zhds7TUv.js` / `index-CUc5gT5M.css` | **`npm ci` is in sync with `package.json`. The frontend CI job will pass.** |
| `yaml.safe_load('.github/workflows/ci.yml')` | parses; job/matrix/defaults/step structure correct | **Confirmed** |
| Independent hash of dev-1's before/after DOM dumps | 36 keys each, `keys equal: True`, `values equal: True`, `sha256 e0fb62a4…` on both | **Confirmed** |
| `mtime(after.json)` vs every `src/` file it covers | `after.json` 02:24:23 > every screen/shell file (latest 02:24:05) | **Proof is post-refactor, not stale** |
| `ARCHPILOT_ENV=production python -c "import app.main"` | `ValueError: ARCHPILOT_COOKIE_SECURE must be true in production` | **Blocker B-2 — see below** |
| `ruff check --isolated --select "E,W,F,I,B,UP,C4,SIM,BLE,RUF"` (per-file-ignores bypassed) | zero findings | **The 15 ruff fixes are real fixes, not silenced findings** |
| `ruff check --select S app scripts` | 2 × S608, both safe, both now annotated | Led to Major M-2 |
| `docker version` | `docker: command not found` | **The Node 24 bump is still unbuilt — see Major M-1** |
| Python 3.12 interpreter search (`py -0p`, `C:\Python*`) | only 2.7 and 3.10 present | **The CI 3.12 matrix leg is still unexecuted anywhere — see Major M-3** |

---

## 3. Blockers

| # | File:line | Issue | Evidence / reasoning | Fix |
|---|---|---|---|---|
| **B-1** | *(whole project)* | **No git repository.** ~35 files changed tonight across the backend scaffold, `contracts/`, the sizing rewrite, CI and a 25-file refactor, with no history, no diff, no revert. | `git status` fails; there is no `.git` anywhere under `D:\ClaudCode\Sub-agents`. Concretely, it already cost this review something real: **I could not diff the new `src/features/*` against the original inline JSX, because the original `main.tsx` no longer exists in any form.** I searched the tree, `dist/`, and the scratchpad. The only surviving trace of "before" is a rendered-DOM dump in a temp directory that a reboot will delete. | **Not mine to fix — deliberately left undone.** This is a Product Owner call. Recommended: `git init`, a `.gitignore` covering `node_modules/`, `dist/`, `backend/.venv/`, `backend/data/`, `**/__pycache__`, `.pytest_cache`, `.ruff_cache`, `*.db*`, `.env`, then **one commit of the current state before anything else is written.** Until that exists, **no further autonomous multi-file work should be authorised** — the next refactor has no undo. |
| **B-2** | `ArchPilot/backend/Dockerfile:19-24` (was) | **The container could never start.** The image sets `ARCHPILOT_ENV=production` but leaves `ARCHPILOT_COOKIE_SECURE` at its default `false` and `ARCHPILOT_CORS_ORIGINS` at its default `["http://localhost:5173", "http://127.0.0.1:5173"]`. `Settings.validate()` rejects both in production, and `get_settings()` runs inside `create_app()`, which runs at **module import** (`app/main.py:220`). So `uvicorn app.main:app` dies before it binds a port. | Reproduced exactly: `ARCHPILOT_ENV=production ARCHPILOT_DB_PATH=/data/archpilot.db ARCHPILOT_BACKUP_DIR=/data/backups python -c "import app.main"` → `ValueError: ARCHPILOT_COOKIE_SECURE must be true in production` (and `ARCHPILOT_CORS_ORIGINS must not contain a loopback origin in production` behind it). No Docker daemon was needed to find this — it is pure config, and it would have burned the first hour of task 0.8. | **Fixed by this review.** The image now ships the production values for the environment it declares. Verified: the same import now succeeds with `env=production, cookie_secure=True, cors=[], docs_url=None`. |

### B-2, the applied fix

```dockerfile
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ARCHPILOT_ENV=production \
    ARCHPILOT_COOKIE_SECURE=true \
    ARCHPILOT_CORS_ORIGINS= \
    ARCHPILOT_DB_PATH=/data/archpilot.db \
    ARCHPILOT_BACKUP_DIR=/data/backups
```

An **empty** `ARCHPILOT_CORS_ORIGINS` is the documented way to say "no CORS
origins" (`config.py:_env_list` — "An explicitly-empty value means empty list,
not use the default"), and it is the right value here: this container serves the
SPA same-origin from `./static`.

**One judgement call handed to devops, written into the Dockerfile as a comment:**
`ARCHPILOT_COOKIE_SECURE=true` means the session cookie only travels over HTTPS.
If the on-prem host will genuinely serve plain HTTP, that is a deployment
decision to make explicitly — **do not** flip `ARCHPILOT_ENV` back to
`development` to work around it, because that also re-opens `/api/docs` and
`/api/openapi.json` to unauthenticated callers.

---

## 4. Major findings

| # | File:line | Issue | Evidence / reasoning | Fix |
|---|---|---|---|---|
| **M-1** | `ArchPilot/Dockerfile:4`, `ArchPilot/backend/Dockerfile:11` | **The Node 20 → 24 bump is still unverified by an actual image build**, and I could not verify it either: no Docker daemon on this machine. | `docker version` → `command not found`. | **Partly de-risked, not closed.** I ran the strongest available proxy: a clean-room `npm ci` + `tsc -b` + `vitest` + `vite build` on Node 24.18.0 / npm 11.16.0 from a wiped directory, which is exactly what the `node:24-alpine` stage does. It passed and produced identical asset hashes. The residual risk is alpine-specific (musl vs glibc rollup/esbuild binaries) and cheap to close. **Recommendation to devops-master: run the two builds, in this order** — `docker build -f backend/Dockerfile -t archpilot:dev .` then `docker run --rm -p 8000:8000 archpilot:dev` and `curl localhost:8000/api/health`. Do not skip the `docker run`: B-2 proves the build succeeding is not the same as the image working. |
| **M-2** | `ArchPilot/backend/ruff.toml:5` | **The config header claimed a protection it did not provide.** It says the rule set catches "f-strings in SQL", but `select` was `E W F I B UP C4 SIM BLE RUF` — `S` (flake8-bandit, which owns S608 `hardcoded-sql-expression`) was never enabled. This is the identical failure mode as the seven dead `# noqa` directives dev-1 rightly deleted in this same round. | `ruff check --select S app scripts` → exactly 2 findings, both pre-existing. | **Fixed by this review**: `S` added to `select`, `tests/*` ignores `S101` (pytest *is* assert) and `S106` (test-fixture passwords), and the two real hits annotated with *why they are safe* rather than silently ignored. Cost: zero new failures. `ruff check` and `pytest` re-run clean after the change. Reverting is one line if dev-1 disagrees with the scope change. |
| **M-3** | `.github/workflows/ci.yml:50` | **The Python 3.12 matrix leg has never executed anywhere.** The dev machine has 2.7 and 3.10 only; the workflow has never run on a runner. So the first green tick on 3.12 will be its first execution ever. | `py -0p` unavailable; only `C:\Python27` and `C:\Python-3.10.12` on disk. | **No code fix — this is what CI is for, and the matrix leg is the right design.** But I checked the two likeliest 3.12 tripwires by hand and **both are absent**: no `datetime.utcnow()` anywhere (`db.py:33` correctly uses `datetime.now(timezone.utc)`), and no `sqlite3` date adapters/`detect_types` (deprecated in 3.12). Combined with `pytest.ini`'s `error::DeprecationWarning:app.*`, the 3.12 leg is more likely to pass than not. **Expect the first CI run to possibly be red anyway and budget 30 minutes for it.** |
| **M-4** | `ArchPilot/package.json:14-21` | **Eight dependencies are pinned to `"latest"`** — including `react`, `vite`, `typescript` and `@vitejs/plugin-react`. | `npm ci` reads the lock, so CI and both Docker stages *are* currently reproducible. But the moment anyone runs `npm install` or `npm update`, the lock silently jumps majors across four load-bearing packages at once — which is precisely how this project ended up on vite 8 and jsdom 30 and therefore needed the Node bump in the first place. | **Not fixed — judgement call, and it touches the lock.** Recommended: replace `"latest"` with the versions currently resolved in `package-lock.json` (caret ranges), in one isolated change with no other edits, so the diff is reviewable. ~10 minutes. Do this *after* B-1, so it is revertible. |
| **M-5** | `ArchPilot/tsconfig.app.json:22` | **The production build typechecks the test suite.** `include: ["src"]` sweeps in `App.test.tsx`, `sizing.test.ts` and `contract.test.ts`, which import `vitest`, `ajv` and `node:fs`. So `npm run build` — the command both Dockerfiles run — hard-depends on **devDependencies**. | Today both Dockerfiles run a plain `npm ci` (devDeps included), so it works; I proved it in the clean room. But it is a landmine: the standard image-slimming move, `npm ci --omit=dev`, will break the build with confusing `Cannot find module 'vitest'` errors from a *test* file during a *production* build. | **Not fixed — judgement call.** Two options: (a) add `"exclude": ["src/**/*.test.ts", "src/**/*.test.tsx"]` to `tsconfig.app.json` and give the tests their own `tsconfig.test.json` referenced from the root — keeps the typecheck gate, removes the landmine; or (b) leave it and add a one-line comment in both Dockerfiles saying "do not add `--omit=dev`". I would take (a). ~20 minutes. |

---

## 5. Minor findings

| # | File:line | Issue | Fix |
|---|---|---|---|
| **m-1** | `.github/workflows/ci.yml:57-68` | **Cache-key gap.** `cache-dependency-path` keyed on `requirements-dev.txt` only. That file is `-r requirements.txt` plus four pins, so a change to a **runtime** pin (`fastapi`/`uvicorn`/`pydantic`) did not invalidate the pip cache. Not a correctness bug — pip still resolves — but the cache is wrong exactly when it matters most, during a dependency bump. | **Fixed.** Both files now listed. (The paths themselves were already correct: `cache-dependency-path` resolves against the workspace root, *not* `defaults.run.working-directory`, and dev-1 got that right — it is the single most common mistake in a two-root repo.) |
| **m-2** | `.github/workflows/ci.yml:42, 92` | **No `timeout-minutes`.** The Actions default is 360 minutes. A deadlocked SQLite busy-wait or a hung vitest would burn six runner-hours per leg, three legs at a time. | **Fixed.** `timeout-minutes: 15` on both jobs (suites run in ~12 s and ~60 s). |
| **m-3** | `ArchPilot/.dockerignore` | Only `node_modules`, `dist`, `.git`, `*.log` were excluded. `ArchPilot/Dockerfile` uses `COPY . .`, so the SPA/nginx image was **shipping the backend's Windows virtualenv**, `backend/data/*.db`, every `__pycache__`, and any local `.env`. Both builds also uploaded that as context. | **Fixed.** Added `backend/.venv`, `backend/data`, `**/.env`, `**/__pycache__`, `**/*.pyc`, `**/.pytest_cache`, `**/.ruff_cache`, `*.db*`, with a comment warning not to exclude `backend/` wholesale (`backend/Dockerfile` COPYs `requirements.txt`, `app/`, `scripts/` explicitly). |
| **m-4** | `ArchPilot/backend/ruff.toml:38-41` | Both `per-file-ignores` entries were inert: `ruff check --isolated` with the ignores bypassed returns **zero** findings, so `"tests/*" = ["E501"]` was hiding nothing, and `"app/migrations/*" = ["ALL"]` targets `.sql` files ruff never reads. Harmless, but it is pre-emptively disabling rules nothing needs. | **Left in place** (the new `S101`/`S106` entries make `tests/*` live). Flagging so it is a conscious choice. |
| **m-5** | `.github/workflows/ci.yml:26` | `on:` is unquoted. GitHub's parser handles it, but YAML 1.1 tooling (`yaml.safe_load`, yamllint's `truthy` rule) reads the key as boolean `True` — I hit this while validating the file. Cosmetic. | Optional: `"on":`. Not changed; changing it adds noise for no runtime benefit. |
| **m-6** | `.github/workflows/ci.yml:55, 57, 103, 105` | Actions referenced by tag, not commit SHA. `permissions: contents: read` is the stronger control and it is present, so exposure is low. | Optional hardening for **security-architect** to rule on, not for now. |
| **m-7** | `.github/workflows/ci.yml:95-98` | `strategy.fail-fast: false` over a **single-entry** matrix `node-version: ['24']` is decoration. | Harmless; it documents intent to add a second Node leg. Leave. |
| **m-8** | `ArchPilot/src/main.tsx:21` | `export default App` from an entry-point module that has already called `root.render(<App/>)`. Nothing imports it. | Harmless leftover; likely predates the split. Delete when someone is next in the file. |
| **m-9** | *(observed, not a defect)* | npm 11 (which ships with Node 24) no longer runs dependency lifecycle scripts by default: `npm warn allow-scripts esbuild@0.28.2 (postinstall: node install.js)`. This is a **direct consequence of the Node 20 → 24 bump** that nobody has flagged yet. | Benign for esbuild specifically — it resolves its binary via `optionalDependencies`, and my clean-room `npm ci` + `vite build` succeeded with the script skipped. **But it is a behaviour change, and the next package that genuinely needs a postinstall will fail confusingly.** Worth one line in the devops runbook. |
| **m-10** | `ArchPilot/backend/Dockerfile:36` | `VOLUME ["/data"]` with `USER archpilot` (uid 10001). An anonymous volume inherits the built-in ownership; a **host bind mount will not**, and the deep health probe writes to SQLite — so it will 503 on a bind-mounted `/data` owned by another uid. | For **devops-master** at task 0.8: either use a named volume, or `chown 10001:10001` the host directory. Not a code fix. |

---

## 6. The `main.tsx` split — what I checked and what I could not

The brief asked me to spot-check for "a dead code path never exercised by the
harness's sweep, or an event handler with different behaviour that produces the
same initial render." Here is exactly how far the evidence goes.

**What is genuinely proved.** The DOM proof is real and I verified it myself
rather than taking the doc's word: 36 states (16 modules × VI/EN + 4 modal
states), `keys equal: True`, `values equal: True`, identical `sha256`. Crucially
I also checked the **timestamps** — `after.json` (02:24:23) is newer than every
single source file it covers (latest screen/shell edit 02:24:05), so the capture
is post-refactor. Only `App.test.tsx` and `vitest.config.ts` were touched after,
and neither is rendered.

**What the DOM proof cannot cover, by construction.** Serialised HTML does not
carry event handlers or non-initial state. So the uncovered surface is: the
`onClick`/`onChange` bodies, and every branch behind a state change. I therefore
read **all 19 extracted files** line by line, with particular attention to the
six that hold state:

| File | Uncovered path | Reading verdict |
|---|---|---|
| `features/architecture/ArchitectureEditor.tsx:11-21` | `addComponent()`, the `{message && …}` branch, `components.map` with non-empty `localStorage` | Correct. Validation, `saveComponents(next)` persistence, and the `setDraft({...draft, name: ''})` reset are all intact and in the right order. |
| `features/requirements/RequirementsScreen.tsx:12-23` | `addRequirement()`, ID generation, `{message && …}` | Correct, including the `NFR`/`REQ` prefix branch and `padStart(3,'0')`. |
| `features/decisions/DecisionsScreen.tsx:11-13` | `updateItem`, `requestReview`, `markReviewed` (including the `!canMarkReviewed` refusal), and the `under_review`/`reviewed` status-pill tones | Correct. No mutation of the shared `defaultReviewChecklist` — `items.map` returns a new array. |
| `features/workspace/WorkspaceModal.tsx:11-14` | `persist()` → `saveWorkspace()` → `onSave()` | Correct. `workspace?.id ?? 'workspace-personal'` fallback preserved. |
| `features/investment/InvestmentModal.tsx:6-10` | the `useMemo` ROI/payback arithmetic and its dependency array | Correct, and **independently checked against the kept test**: `(42000×5 − (148000+93000)) / 241000 × 100 = −12.86 → "-12.9"`, which is what `App.test.tsx:117` asserts. |
| `features/overview/OverviewScreen.tsx:12-16` | `onOpenInvestment`, and the three `onNavigate('architecture'|'investment')` call sites | Correct; all three targets are valid `ModuleKey` values. |

**Result: I found no typo, no dropped prop, no changed handler, and no dead
branch.** The prop threading is uniform (`text: TextFn` everywhere), the shared
primitives (`copy`, `PageHeader`, `ModulePanel`, `DatabaseIcon`) are extracted
verbatim, `navItems` order matches `SCREEN_MARKERS` order and the test asserts
that equality explicitly. This is a clean refactor.

**The honest residual.** My reading says "this code is correct"; it cannot say
"this code is *identical to what was there before*", because **the original
`main.tsx` is gone** and there is no history to recover it from. If a handler was
subtly rewritten during extraction, only the author would know. That residual is
entirely a symptom of Blocker B-1, and it is the single clearest illustration of
why B-1 matters.

**Recommendation on more tests: do not add any now.** `App.test.tsx`'s 6 tests
are correctly scoped — they assert structure and headings rather than snapshotting
600 kB of HTML, and the file says why. The right place for handler coverage is
the feature work that will rewrite these handlers anyway (tasks 1.4, 2.5, 3.4).
Writing interaction tests against screens that are about to be replaced is
motion, not progress.

---

## 7. The 15 ruff fixes — verified as fixes, not silencing

I could not read diffs (B-1 again), so I verified the *property* instead, which
is stronger: I re-ran ruff with the config **isolated and per-file-ignores
bypassed** (`--isolated --select "E,W,F,I,B,UP,C4,SIM,BLE,RUF"`). **Zero
findings.** So nothing is being hidden by config.

Then I checked the two shapes a fake fix takes:

- **Suppression by `# noqa`:** only **two** remain in the whole backend, both
  `BLE001` at `app/routers/health.py:51,74`, both with a written reason ("the
  probe must report, not raise"), and both genuinely load-bearing — the health
  endpoint must convert any exception into a 503 body. These are live directives,
  not decoration. Dev-1's claim to have deleted seven *dead* ones is consistent
  with what is left.
- **Suppression by `contextlib.suppress`:** ruff's `SIM105` autofix is the usual
  way a "lint fix" silently swallows an error. `grep` for `contextlib`/`suppress`
  across `app`, `scripts`, `tests` returns **one** hit — `asynccontextmanager` in
  `main.py:12`. No error was swallowed.

Every remaining broad `except` either re-raises (`db.py:150,184`) or calls
`logger.exception` and degrades deliberately (`main.py:67` startup housekeeping,
`main.py:155` the request-level 500 envelope). That is correct behaviour, not
lint appeasement. **The ruff work is genuine.**

---

## 8. What's good — credited honestly

1. **The DOM-diff proof is the right technique and it survived scrutiny.** A
   36-state before/after hash is far stronger than a screenshot or a snapshot
   test, and it is the first artefact in this project I have been able to
   independently re-verify from raw data. Throwing the harness away and keeping
   six targeted tests was also the right call.
2. **The two-root CI paths are correct.** `defaults.run.working-directory` for
   `run` steps, workspace-root-relative `cache-dependency-path` for `uses` steps —
   that distinction is the classic failure in a repo with `ArchPilot/` and
   `ArchPilot/backend/`, and it is right.
3. **The 3.12/3.10 matrix with `fail-fast: false` is the correct response to
   M-9** from the previous review. Testing the image version *and* the documented
   floor, and letting both report, is exactly what was asked for.
4. **The FTS5 tokenizer probe step** (`ci.yml:70-74`) is a genuinely thoughtful
   addition. A runner whose SQLite lacks `unicode61 remove_diacritics 2` would
   otherwise produce a baffling test failure; this fails it with a sentence. The
   escaped-quote `python -c` inside the YAML block scalar also parses correctly —
   I checked, because it looks like it shouldn't.
5. **`test -f dist/index.html`** after the build. A build that exits 0 and emits
   nothing is a real failure mode and almost nobody guards it.
6. **The refactor's file layout is disciplined**: one `ModuleKey` ↔ one
   `src/features/` directory, screens take `text: TextFn` and own no language
   state, shared primitives in `src/ui/`, and `main.tsx` down to bootstrap. The
   two deliberately-unchanged pieces (`SizingScreen` still hard-coded,
   `KnowledgeScreen`'s four records still inline) each carry a comment naming the
   task that will fix them. That is how you keep a pure refactor pure.
7. **`ruff.toml` picks `target-version = "py310"` — the floor, not the image.**
   Subtle and correct; targeting 3.12 would have let ruff suggest syntax the
   3.10 leg rejects.

---

## 9. Changes I applied

| File | Change | Why it was safe for me to make |
|---|---|---|
| `ArchPilot/backend/Dockerfile` | Added `ARCHPILOT_COOKIE_SECURE=true` and `ARCHPILOT_CORS_ORIGINS=` to the `ENV` block, with the reproduction command and a devops note about TLS in a comment | Blocker B-2. The defect is proven by execution, and the fix is the only value consistent with the `ARCHPILOT_ENV=production` the image already declared. Verified: import now succeeds with `env=production, cookie_secure=True, cors=[], docs_url=None`. |
| `ArchPilot/.dockerignore` | Excluded `backend/.venv`, `backend/data`, `**/.env`, `**/__pycache__`, `**/*.pyc`, `**/.pytest_cache`, `**/.ruff_cache`, `*.db*` | m-3. Mechanical; explicitly comments that `backend/` must not be excluded wholesale. |
| `.github/workflows/ci.yml` | `timeout-minutes: 15` on both jobs; `cache-dependency-path` now lists `requirements.txt` **and** `requirements-dev.txt` | m-1, m-2. Both mechanical. Re-parsed the file afterwards; structure intact. |
| `ArchPilot/backend/ruff.toml` | Added `"S"` to `select`; `tests/*` now also ignores `S101`, `S106` | M-2. Makes the file's own stated coverage true. Zero new failures. One-line revert. |
| `ArchPilot/backend/app/db.py:141-149` | `# noqa: S608` + 5-line comment explaining why `executescript` forces interpolation and why `MIGRATION_NAME_RE` already makes it safe | M-2 follow-through. Annotating *why* beats ignoring. |
| `ArchPilot/backend/app/repositories/patterns.py:31-36` | `# noqa: S608` + comment (`HASHED_COLUMNS` is a module literal; `pattern_id` is bound) | Same. |

**Re-verified after every change:** `ruff check .` → `All checks passed!` ·
`pytest` → **90 passed** · `npm run typecheck` → clean · `npm test` → **63
passed** · `npm run build` → `1906 modules transformed`, `built in 755ms`.

**Deliberately not changed:** M-4 (`"latest"` pins — touches the lock, do it
after B-1), M-5 (tsconfig test split — a design call for dev-1), m-5/m-6/m-7
(cosmetic or security-architect's call), and **B-1 itself: I did not run
`git init` and I committed nothing.**

---

## 10. Open questions for humans

1. **Product Owner — B-1, and it is urgent.** Do you want a git repository? If
   yes, it should happen before the next task starts, not after. If there is a
   reason this directory is deliberately untracked (it lives inside a larger
   tracked tree, it is disposable, it syncs elsewhere), say so and I will drop
   it — but the assumption right now is that ~35 files of tonight's work have no
   backup and no undo.
2. **Devops — M-1 + m-10.** Is TLS terminated in front of the container on the
   on-prem host? That decides whether `ARCHPILOT_COOKIE_SECURE=true` is correct
   as shipped. And will `/data` be a named volume or a host bind mount? The bind
   mount needs `chown 10001:10001` or the deep health probe 503s.
3. **Dev-1 — M-2.** I widened your lint scope (`S`). It cost two annotated
   `noqa`s and zero failures, and it makes the config header true. Object and I
   will revert the one line.
4. **Dev-1 — M-5.** Split the test files out of `tsconfig.app.json`, or just
   comment "no `--omit=dev`" in both Dockerfiles? I would split.

---

## 11. Next handoff

| Agent / role | What they need to do |
|---|---|
| **Product Owner** | **Decide B-1 (git) — this gates safe further work.** Then §8 of the build scope: questions 1, 2, 5, and gate G0.2, which is still the critical path. |
| **devops-master** | **Task 0.8, and it is now unblocked in the right order:** (1) `docker build -f backend/Dockerfile -t archpilot:dev .` from `ArchPilot/` — this is what closes M-1; (2) `docker run` it and `curl /api/health`, because B-2 proved a successful build is not a working image; (3) decide the `/data` mount and TLS questions (m-10, §10.2); (4) note npm 11's script-approval change (m-9) in the runbook. Then Compose, secrets, `ARCHPILOT_BACKUP_DIR` off the DB volume (M-8), Litestream (7.4). |
| **senior-developer-1** | **Concrete next task: 1.3 → 1.6, the persistence spine** (`GET/PUT /api/workspaces/current`, then designs CRUD with 404-not-403 for non-owners), exactly as the build scope orders it. **Before starting, confirm B-1 is resolved.** Optionally fold in M-4 (`"latest"` pins) and M-5 (tsconfig split) as two separate small changes first — both are ≤20 minutes and both get harder later. |
| **ba-qa-analyst** | The 6 shell tests in `App.test.tsx` are the regression baseline for all 16 screens; treat `SCREEN_MARKERS` as the canonical module list. Acceptance cases for the B3 sizing terms are still the open item from the previous review. |
| **security-architect** | Now has a concrete hook: `ruff`'s `S` rules are live (M-2), so a STRIDE pass can lean on them. Still yours: local auth (D6), session lifecycle, CSRF (7.3), the admin role boundary, and — new — whether `ARCHPILOT_COOKIE_SECURE` and the empty CORS list are the right production defaults to bake into an image (B-2). |
| **dba-master** | Unchanged from the previous review: validate `001`/`002`/`003`, the FTS5 trigger set, and the `VACUUM INTO` + Litestream restore design. |

---

**Verdict: Approve-with-changes.** 2 Blockers (1 fixed here, 1 is a Product
Owner decision), 5 Major, 10 Minor. The code that was delivered is solid and the
evidence behind it is real; the risk that should worry you is the absence of
version control, not the quality of the work.

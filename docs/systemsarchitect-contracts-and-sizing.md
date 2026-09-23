# Build note — shared wire contract + corrected sizing engine

| | |
|---|---|
| **Author** | Senior Developer #1 (Builder / Proposer) |
| **Date** | 2026-09-23 |
| **Version** | 1.0 |
| **Status** | Delivered. Both suites green. Ready for re-review by `senior-developer-2` |
| **Language / stack** | JSON Schema 2020-12 · Python 3.10 (pytest + `jsonschema`) · TypeScript 5 (vitest + `ajv`). No runtime dependency added to either side |
| **Tasks closed** | **0.5** (vitest), **0.6** (`contracts/` + shared fixtures + envelope rules, 1.25 pd), **3.1** (corrected sizing engine, 2 pd), **3.2** (confidence-derived ranges, folded into 3.1) |
| **Related docs** | `docs/development/reviews/review-systemsarchitect-backend.md` v1.0 (findings M-6, F-4) · `docs/architecture/reviews/review-systemsarchitect-prototype.md` v1.0 (blocker **B3**, majors M7/M8) · `docs/development/systemsarchitect-build-scope.md` v1.2 (§3.6, decision D4) · `docs/architecture/systemsarchitect-prototype-design.md` v0.1 (§3.1 ArchGraph, §3.4 benchmarks) |

---

## 1. Executive summary

### English

Two things shipped. First, `ArchPilot/contracts/` — one JSON Schema file that
defines the `ArchGraph` shape shared by designs and patterns, plus three rules
about the envelope around it: keys are camelCase, errors are
`{detail, requestId?}`, and timestamps are ISO 8601 in UTC with an explicit
offset. Sixteen fixture files sit beside it, nine of them deliberately broken,
and **both** test suites read the same files off the same manifest — pytest with
`jsonschema`, vitest with `ajv`. Second, `ArchPilot/src/domain/sizing.ts` was
rewritten to fix all four defects the red-team found in blocker B3: replication
now amplifies write throughput instead of only storage, node count consumes a
dual read/write benchmark instead of one generic capacity figure, storage has a
compression term, and the plan carries a failure-domain spare node. Run it with
`npm test` in `ArchPilot/` and `.venv/Scripts/python.exe -m pytest` in
`ArchPilot/backend/`. Python went 65 → 90 tests, TypeScript 0 → 57, all passing.

### Tiếng Việt

Có hai phần được bàn giao. Thứ nhất là `ArchPilot/contracts/` — một tệp JSON
Schema duy nhất định nghĩa cấu trúc `ArchGraph` dùng chung cho cả thiết kế và
mẫu kiến trúc, kèm ba quy tắc về "lớp vỏ" bao quanh nó: khóa viết theo kiểu
camelCase, lỗi luôn có dạng `{detail, requestId?}`, và dấu thời gian theo chuẩn
ISO 8601 giờ UTC với phần bù múi giờ ghi rõ. Bên cạnh là 16 tệp dữ liệu mẫu,
trong đó 9 tệp **cố ý sai**, và **cả hai** bộ kiểm thử đều đọc chung các tệp đó
từ cùng một bản kê khai — pytest dùng `jsonschema`, vitest dùng `ajv`. Thứ hai,
`ArchPilot/src/domain/sizing.ts` đã được viết lại để sửa cả bốn khiếm khuyết mà
đội phản biện nêu ở lỗi chặn B3: hệ số nhân bản giờ được áp cho cả thông lượng
ghi chứ không chỉ dung lượng lưu trữ, số lượng nút được tính từ benchmark đọc/ghi
riêng biệt thay vì một con số năng lực chung chung, công thức lưu trữ có thêm số
hạng nén dữ liệu, và kế hoạch luôn dự phòng thêm nút cho tình huống hỏng hóc.
Chạy bằng `npm test` trong `ArchPilot/` và `.venv/Scripts/python.exe -m pytest`
trong `ArchPilot/backend/`. Số test Python tăng từ 65 lên 90, TypeScript từ 0 lên
57, tất cả đều pass.

---

## 2. What was built — file map

### 2.1 Task 0.6 — the shared contract

| File | Responsibility |
|---|---|
| `ArchPilot/contracts/archgraph.schema.json` | The single source of truth. `$defs`: `archGraph` / `archNode` / `archEdge` / `nodeType` / `position` for the graph; `camelCaseObject` / `errorResponse` / `timestamp` for the envelope |
| `ArchPilot/contracts/fixtures/index.json` | The shared manifest both suites iterate: fixture → `$defs` pointer → expect valid/invalid → the keyword an invalid case must fail on → why it exists |
| `ArchPilot/contracts/fixtures/*.valid.json` (7) | Documents that must validate |
| `ArchPilot/contracts/fixtures/*.invalid.json` (9) | Documents that must **not** validate |
| `ArchPilot/contracts/README.md` | What it covers, who enforces it, how to change it, and the deliberate non-goals |
| `ArchPilot/backend/tests/test_contracts.py` | Python half — 25 tests. Fixtures, manifest completeness, and **live API responses** |
| `ArchPilot/src/contracts/contract.test.ts` | TypeScript half — 23 tests. Same fixtures via `ajv`, plus rules applied to values the SPA itself produces |
| `ArchPilot/backend/requirements-dev.txt` | `jsonschema==4.23.0`, test-only |
| `ArchPilot/package.json` | `vitest`, `ajv`, `@types/node` as devDependencies; `test` / `test:watch` / `typecheck` scripts |
| `ArchPilot/vitest.config.ts` | Node environment, `src/**/*.test.ts` |

Changed to make the contract *true* rather than aspirational:

| File | Change |
|---|---|
| `ArchPilot/backend/app/main.py` | Two exception handlers normalise every non-2xx body to `{detail, requestId?}` with a **string** `detail`; the 500 body's `request_id` key corrected to `requestId` |
| `ArchPilot/backend/app/csrf.py` | 403 body's `request_id` key corrected to `requestId` |

### 2.2 Tasks 3.1 / 3.2 — the sizing engine

| File | Responsibility |
|---|---|
| `ArchPilot/src/domain/sizing.ts` | **Rewritten.** `deriveThroughput` · `sizeNodeCount` · `sizeStorage` · `sizeComponent` · `resolveInputs` · `weakestConfidence` · `formatRange`. Pure, no I/O, no imports beyond `./model` |
| `ArchPilot/src/domain/sizing.test.ts` | 34 tests grouped B3(a) / B3(b) / B3(c) / B3(d) / M8 / worked example / validation |

---

## 3. Key decisions

### 3.1 Contract

| # | Decision | Rationale | Trade-off accepted |
|---|---|---|---|
| C1 | **One schema file, not one per resource** | At 2–4 users, one graph type and ~20 endpoints, a directory of schemas is filing, not engineering. The `$defs` block is 130 lines and fits on two screens | It will need splitting if the API triples. That is a 20-minute job when it happens, not a reason to pre-split now |
| C2 | **`jsonschema` + `ajv`, not two hand-written validators** | Both are standards-compliant 2020-12 implementations, so the two languages agreeing is a property of the specification, not of our discipline. Two hand-rolled validators would be the same drift risk we are mitigating, one level down | Two test-only dependencies. Backend **runtime** deps stay at three; `jsonschema` is in `requirements-dev.txt` only |
| C3 | **A manifest (`fixtures/index.json`) drives both suites** | The fixture list, the `$defs` pointer, the expected verdict and the reason all live in one place. Both suites also assert the manifest matches the directory, so adding a fixture without listing it fails the build in both languages | The manifest is a second thing to keep in sync — but it is the thing that *proves* sync, and it is machine-checked |
| C4 | **Invalid fixtures must fail on a named keyword** (`expectKeyword`) | "It failed" proves the validator ran. "It failed on `pattern` inside `camelCaseKey`" proves the rule is enforced. Both suites flatten errors to `keyword\|schemaPath` so one manifest string works for both | Slightly coupled to validator error vocabulary. Both use the JSON Schema keyword names, so it holds |
| C5 | **Python also validates live API responses**, not only fixtures | The bug that actually happened (review M-5) was the API emitting `display_name`. A fixture cannot catch that; only pointing the rule at a real response can | Ties the contract suite to `TestClient`. Cheap, and it is where the value is |
| C6 | **`additionalProperties: false` on `archNode` / `archEdge` / `archGraph`**, with `props` as the open extension point | NFR-EXT-002 says readers ignore unknown fields; that is a *runtime reader* rule. A *contract test* that ignores unknown fields cannot detect drift, which is its only job. `props` gives additive extension with no contract edit | Adding a first-class field means editing this file. That is intended: it is the moment two languages agree on a new field. **Flagged for challenge** — see §6 |
| C7 | **No OpenAPI, no codegen** | Confirmed with the reviewer. A generator plus its pipeline costs more than the drift it prevents at this size | If the API surface grows past ~40 endpoints, revisit |
| C8 | **Referential integrity stays out of the schema** | JSON Schema cannot express "every `edge.source` names an existing `node.id`". Faking it with a hand-rolled extension would put graph logic in two places | Dangling edges are not caught by the contract. They belong to `validateGraph()` (task 1.5), and the schema file says so in its own `description` |

### 3.2 Sizing

| # | Decision | Rationale | Trade-off accepted |
|---|---|---|---|
| S1 | **`formulaVersion` bumped to `'2.0'`** | The numbers changed. A stored `sizing_scenarios` row pinned to `'1.0'` must not be silently re-rendered under the new engine | Any future v1.0 rows need an explicit "recompute" action showing the before/after diff (red-team M8(iii)) |
| S2 | **`sizeApi` / the old `sizeStorage` signature deleted, not deprecated** | The module had zero call sites — `main.tsx` never imported it. Keeping a wrong formula exported "for compatibility" is how wrong formulas get called | If anything outside this repo imported them, it breaks. Nothing does; `tsc -b` and `vite build` are clean |
| S3 | **`spareNodes` is added *outside* the confidence band** | How many nodes may fail is a policy the team chooses. The benchmark's uncertainty is about capacity per node. Multiplying the spare by ±50% would make a deliberate redundancy decision wobble with an unrelated estimate | A reviewer could argue the spare should scale with cluster size (N+1 vs 10%). Defaulting to a flat 1 and exposing the input is the honest version. **Flagged for challenge** |
| S4 | **Storage uses *average* write QPS, not peak** | Peaks decide how many nodes absorb the burst; they do not change how many bytes are retained over 12 months. Using peak would over-state storage by `peakFactor` — 3x — which is the same class of error as B3(c), in the opposite direction | If the peak is sustained rather than bursty, this under-states. The `peakFactor` assumption string says which one was applied. **Flagged for challenge** |
| S5 | **`compressionRatio` defaults to `1.0` and says "not modelled"** | The honest answer stays the default; claiming compression is a deliberate act with a visible number. Exactly what B3(c) asked for | The default output stays alarmingly large (114.6 TiB on the worked example). That is the point: it is an upper bound and the warning says so |
| S6 | **Storage values are not rounded in the domain layer** | Rounding to 2 dp at 117,000 GiB is noise, and it broke the exact `uncompressed / compressed == ratio` relationship. Rounding is a presentation concern; `formatRange()` owns it | Callers must format. `formatRange()` is provided |
| S7 | **`assumptions: string[]` and `formula: string` are required by the type** | NFR-USE-002 "no unexplained numbers" becomes unrepresentable-if-violated rather than a review checklist item | Every new result path must write its assumptions. Correct cost |
| S8 | **Client-side `DEFAULT_NODE_BENCHMARKS` are all tagged `estimated`** | Red-team M7: `declared` without a citation is not defensible. The design doc tagged Redis/Kafka `declared` with no URL; those fallbacks are downgraded here, with a comment saying why | The cited rows come from `GET /api/benchmarks` (task 3.3), where a DB trigger already enforces the citation |

---

## 4. How to run & test

```bash
# TypeScript: sizing engine + contract (TS half)
cd D:/ClaudCode/Sub-agents/ArchPilot
npm install
npm test
npm run typecheck
npm run build

# Python: full backend suite including the contract (Python half)
cd D:/ClaudCode/Sub-agents/ArchPilot/backend
.venv/Scripts/python.exe -m pip install -r requirements-dev.txt
.venv/Scripts/python.exe -m pytest
.venv/Scripts/python.exe -m pytest tests/test_contracts.py -v   # contract only
```

### 4.1 What I actually observed, 2026-09-23

Windows 10 · Python 3.10.11 · Node 24.18.0 · vitest 3.2.4 · ajv 8.17.1 ·
jsonschema 4.23.0.

| Command | Result |
|---|---|
| `npm test` | **57 passed** (2 files: `sizing.test.ts` 34, `contract.test.ts` 23), 0.81 s |
| `npm run typecheck` (`tsc -b`) | clean, no output |
| `npm run build` | `✓ 1881 modules transformed` · `✓ built in 1.44s` |
| `pytest` (whole backend) | **90 passed**, 1 warning (starlette-internal `anyio` deprecation), 11.72 s |
| `pytest tests/test_contracts.py` | **25 passed** |

### 4.2 Negative control — I broke the contract on purpose

A contract test that has never failed is a contract test nobody has checked.
I weakened `#/$defs/camelCaseKey` from `^[a-z][A-Za-z0-9]*$` to `^.*$` and re-ran
both suites:

| Suite | Result with the rule weakened |
|---|---|
| `npm test` | `1 failed | 22 passed` — `rejects envelope.snake-case.invalid.json for the intended reason` |
| `pytest tests/test_contracts.py` | `1 failed, 24 passed` — `test_broken_fixtures_are_rejected_for_the_intended_reason[invalid-casing-envelope.snake-case.invalid.json]` |

Same rule, same fixture, both languages, and **only** that test failed — the
graph-shape cases still failed correctly on `additionalProperties`, so the
failure was precise rather than a blanket collapse. The schema was then restored
from a scratch copy and both suites returned to green.

### 4.3 The worked example, end to end

`5,000 QPS · 2 KiB records · 9:1 read:write · 12 months retention`, on the
design doc's database benchmark (8,000 read qps / 2,000 write qps, `estimated`),
with defaults `peakFactor 3.0 · replicationFactor 3 · indexOverhead 0.30 ·
compressionRatio 1.0 · headroom 0.30 · spareNodes 1`:

```
readQps            4,500        writeQps            500
peakReadQps       13,500        peakWriteQps      1,500
effectiveWriteQps  4,500        (B3a: 1,500 x 3)

readNodes   13,500 / 8,000 = 1.6875
writeNodes   4,500 / 2,000 = 2.25      <- the write side binds (B3b)
demand      ceil(2.25 x 1.30) = 3
nodes       3 + 1 spare (B3d) = 4      range 3-6 (estimated, +-50%, M8)

storage     500 x 2,048 B x 86,400 x (12 x 30.44) x 3 x 1.30 / 1.0
            = 117,383 GiB = 114.6 TiB   <- upper bound, compression not modelled
            at compressionRatio 10:1 -> 11.5 TiB (B3c)
```

### 4.4 What the tests cover, and the numbers they assert

| Group | Tests | The delta it proves |
|---|---|---|
| **B3(a)** replication on writes | 3 | Write-heavy 1:1 workload: **5 nodes → 15 nodes** when `replicationFactor` goes 1 → 3. v1.0 produced the 5-node answer for a 3-replica cluster, i.e. one third of the write capacity it needs |
| **B3(b)** dual read/write benchmark | 3 | The v1.0 single-capacity formula returns **3** for the same write-heavy workload the corrected engine sizes at **15**. And: changing *only* `writeQpsPerNode` 2,000 → 4,000 moves the answer 15 → 8, while the v1.0 signature returns an identical number for both benchmarks because it structurally cannot see the write figure |
| **B3(c)** compression term | 4 | v2.0 at `compressionRatio 1.0` reproduces the v1.0 number **exactly** (proving the only change to the expression is the new divisor), then `10:1` gives exactly one tenth: **114.6 TiB → 11.5 TiB**. Plus: ratio < 1 throws, and long retention with no compression warns |
| **B3(d)** failure-domain spare | 4 | Worked example **3 → 4 nodes**. Survivability asserted as a property: with the spare, `nodes − 1 ≥ raw demand`; without it, `nodes − 1 < raw demand`. Plus: the spare stays outside the band (`3–6`, not `2–7`) |
| **M8** confidence bands | 4 | `measured` → `4–5`; `estimated` → `3–6`. `formatRange` renders `3–6 node (point estimate 4)`. `weakestConfidence` picks the worst input. A `declared` benchmark with no `sourceUrl` warns (M7) |
| Worked example | 4 | Throughput split, 4 nodes, 114.6 TiB, and that **no result can exist without `formula` and `assumptions`** |
| Validation | 12 | Nine bad-input cases throw `RangeError`; a zero-capacity benchmark throws; `readWriteRatio: 0` (write-only) does not divide by zero |
| **Contract, TS** | 23 | 7 valid fixtures accepted, 9 invalid rejected *on the named keyword*, manifest matches the directory, every rule has a broken fixture, plus JS-specific traps (`Date#toString` and offset-less ISO both rejected) |
| **Contract, Python** | 25 | The same 16 fixtures, plus: login response is camelCase at every depth, `expiresAt` matches the timestamp rule, `/api/health` is camelCase, and 401 / 422 / 403-CSRF bodies all match `errorResponse` with `requestId` echoing the `x-request-id` header |

---

## 5. Weak points & known limitations

1. **The guard only runs when someone runs it.** There is no CI. Three green
   suites and nothing enforces them on a change — this is now the highest-value
   open task (0.7), and it is what turns R4 from "mitigated" into "mitigated
   automatically".
2. **The contract does not check referential integrity.** Dangling edges and
   duplicate node ids pass. That is a JSON Schema limitation, it is documented
   in the schema's own `description`, and it belongs to `validateGraph()`
   (task 1.5). The risk is someone reading "contract-valid" as "safe to render".
3. **`additionalProperties: false` is strict by design and will bite once.**
   The first person to add a node field will get a red build in the *other*
   language. That is the feature; it will not feel like one at the time.
4. **The sizing engine has no call site yet.** It is correct and tested, and it
   is still dead code until task 3.4 builds the UI. Correct-but-unused is a
   better state than wrong-and-shipped, but it is not value delivered.
5. **`DEFAULT_NODE_BENCHMARKS` covers three component types**, not the five in
   the design doc. Queue (MB/s) and object store (size-only) do not fit a
   read/write QPS shape and need their own term; deliberately deferred rather
   than forced into the wrong model.
6. **Storage ignores non-record overhead** — WAL, tombstones, temporary
   compaction space. On an LSM store, compaction can transiently need ~2x. The
   `indexOverhead` input absorbs some of this; it is not the same thing.
7. **Float arithmetic.** At 10^14 bytes, `Number` is exact to well under 1 byte
   (53-bit mantissa ≈ 9×10^15), so there is no precision problem today. A
   petabyte-scale input would need review.
8. **The timestamp rule accepts `Z` and `+00:00` but not other offsets.** That
   is deliberate, and it means a future integration that emits `+07:00` fails
   the contract rather than silently storing a non-comparable string. Someone
   will call that a bug; it is not.
9. **`requestId` is optional in the error envelope.** It is present on every
   path that goes through the middleware, but making it required would break
   any error raised before the middleware runs. Optional-but-always-present is
   the honest encoding.
10. **Security note, small but real:** the flattened 422 body now includes the
    field path (`body.password: Field required`). That is exactly what a client
    needs and it leaks nothing a caller did not already send. It does *not*
    include the submitted value — worth keeping true as routers are added.

---

## 6. Open questions

1. **`senior-developer-2` — decision C6.** Is `additionalProperties: false` on
   the graph objects right, given NFR-EXT-002 says readers must ignore unknown
   fields? My position: the runtime reader should be lenient, the contract test
   must not be, or it cannot detect the thing it exists to detect. If you
   disagree the fix is one line per `$defs` block, and now is the cheapest time.
2. **`senior-developer-2` — decision S3.** Should `spareNodes` scale with
   cluster size (N+1 vs a percentage) rather than being a flat default of 1? At
   15 nodes, one spare is ~7% headroom against node loss; at 3 nodes it is 33%.
3. **`senior-developer-2` — decision S4.** Storage uses average write QPS. Agree
   that peak sizes nodes and average sizes bytes, or should there be a
   `sustainedPeakMonths` input for workloads whose peak is a season rather than
   a burst?
4. **PO / `ba-qa-analyst`** — the four B3 worked examples are now automated
   tests. Are those the acceptance tests for `TC-FUNC-CALC-010`, or does QA want
   an independent manual calculation as a cross-check? I would prefer the
   cross-check: two independent derivations of the same number is the only real
   proof of arithmetic.
5. **PO** — G0.2, the content-IP policy, is **still unsigned** and is still the
   critical path. None of the work in this note moves it.

---

## 7. Next handoff

| Agent / role | What they need to do |
|---|---|
| **senior-developer-2** | Re-review `ArchPilot/contracts/` and `src/domain/sizing.ts` v2.0. Attack decisions **C6**, **S3**, **S4** (above), the `expectKeyword` coupling to validator error vocabulary, and whether the contract should also pin `sizing_scenarios` payload shape now rather than at task 3.6 |
| **devops-master** | **Task 0.7 is now the top engineering priority.** CI must run `pytest`, `npm test`, `tsc -b`, `npm run build`, on the image's Python (3.12 — dev is on 3.10.11, review M-9). Add `ruff` + `mypy --strict`. Also still open: M-8 (backup volume must differ from the database volume) and Litestream (task 7.4) |
| **ba-qa-analyst** | `TC-FUNC-CALC-010` is unblocked and has an automated equivalent; write the acceptance form of all four B3 terms plus the worked example, and add `TC-COMPLY-005`/`006` against the publish gate |
| **Product Owner** | G0.2 content-IP policy sign-off — unchanged, unsigned, still blocking the 10 pd content track |
| **security-architect** | STRIDE pass as scoped in the backend review. One addition from this delivery: the normalised 422 body now returns the failing field path; confirm that is acceptable before the admin routers land |

---

## 8. References

- `docs/development/reviews/review-systemsarchitect-backend.md` v1.0 — findings
  **M-6** (the `contracts/` mitigation does not exist) and **F-4** (B3 not
  carried into the build). Both closed by this delivery.
- `docs/architecture/reviews/review-systemsarchitect-prototype.md` v1.0 —
  blocker **B3** (the four formula defects, quoted verbatim in `sizing.ts`'s
  header comment), **M7** (benchmark citations), **M8** (ranges not points).
- `docs/development/systemsarchitect-build-scope.md` v1.2 — §3.6 the corrected
  formulas, decision **D4**, tasks 0.5 / 0.6 / 3.1 / 3.2, §7 status board.
- `docs/architecture/systemsarchitect-prototype-design.md` v0.1 — §3.1 the
  `ArchGraph` TypeScript interfaces this schema encodes, §3.4 the default
  benchmark table.

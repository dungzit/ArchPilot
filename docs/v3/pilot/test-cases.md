# WP-QA: Pilot acceptance test cases (ArchPilot pilot v1)

| Field | Value |
|---|---|
| Author | BA/QA Analyst |
| Date | 2026-10-14 (for the pilot starting 2026-10-15) |
| Version | 0.1 (written before the pilot features landed; see section 13 for items to confirm) |
| Status | Draft, ready for execution once WP-A, WP-B and WP-C are merged |
| Related docs | `docs/v3/02-requirements.md` (7.1, 10), `docs/v3/03-kh-phase1-sysdesai-reference-search.md` (5, 7), `docs/v3/05-sizing-rule-builder.md` (4, 9, 10), `docs/v3/06-hld-template-proposal.md`, `src/contracts/pilot.ts`, `src/domain/rules/engine.ts` |
| Companion files | `docs/v3/pilot/UAT-checklist.md` (Vietnamese, for pilot users), `docs/v3/pilot/search-queries.csv` (25 queries) |

## 1. Executive summary

**English.** This pack proves that the pilot gives correct, traceable numbers and safe behaviour before 30 internal users touch it. It contains hand-computed golden cases for the six built-in sizing models (every number re-derived with exact rational arithmetic), negative tests for Excel import and export, content checks for the HLD DOCX, and search checks for the SysDesAi reference index. All numbers quoted in `02-requirements.md` section 7.1 and section 10 were recomputed and are correct. I found no arithmetic error, but I did find 8 specification gaps that can make a correct implementation fail a test (units base, floating-point ceiling, `env` input for the Kafka warning, tie-breaking, size-limit definition). Nothing in the application could be executed in this worktree (the features are still being built), so every case is "Not run" and the status column says so.

**Tiếng Việt.** Bộ tài liệu này chứng minh rằng bản pilot cho ra con số đúng, truy vết được và hoạt động an toàn, trước khi 30 người dùng nội bộ sử dụng. Bộ gồm các golden case tính tay cho 6 model sizing built-in (mọi con số đều được tính lại bằng số học chính xác), các test âm cho import/export Excel, kiểm tra nội dung file HLD DOCX, và kiểm tra tìm kiếm trên chỉ mục SysDesAi. Mọi con số trong `02-requirements.md` mục 7.1 và mục 10 đã được tính lại và đều đúng. Tôi không thấy lỗi số học, nhưng thấy 8 chỗ spec còn hở có thể khiến một bản cài đặt đúng vẫn trượt test (cơ số đơn vị, làm tròn lên với số thực, input `env` cho cảnh báo Kafka, xử lý khi hai ràng buộc bằng nhau, định nghĩa giới hạn dung lượng). Chưa chạy được ứng dụng trong worktree này (các tính năng đang được xây song song), nên mọi case đang ở trạng thái "Not run".

## 2. Context, objectives and scope

**Objective.** Give the pilot lead a go/no-go decision at 07:30 on 2026-10-15 and give pilot users a safe first day.

**In scope.** Login; design canvas smoke; `/reference` (SysDesAi search); `/rules` (built-in pack `archpilot-core` with 6 models, trace, binding constraint, warnings, run tests, save run, rule editor, Excel template/import/export); `/hld` (DOCX export). Target runtime: Windows PC, Docker Desktop, ~30 users, no LLM.

**Out of scope.** AI features, SSO, BOM, IaC, Phase 2 crawlers, penetration testing beyond the injection checks listed here.

**Priority.** P0 = must pass for go. P1 = should pass; a failure needs a written workaround. P2 = nice to have.

**Conventions used in every case.**

1. Units are decimal (SI): 1 GB = 10^9 B, 1 TB = 10^6 MB, 1 day = 86,400 s. This matches the docs (`31.5 GB`, `116.64 TB`). See finding F-01.
2. "Exact" means rational arithmetic. Golden tolerance is relative 1e-9 for continuous values and exact equality for integer (ceil) outputs. Do not reuse the 0.01 tolerance of 05 section 9 (finding F-05).
3. Names such as `rps`, `data_gb`, `brokers` are illustrative. Map them to the implemented output names when running.
4. Status values: Not run, Pass, Fail, Blocked. Everything below starts as Not run.

**What was actually run while writing this pack (nothing else is claimed).**

| # | What ran | Result |
|---|---|---|
| 1 | 4 HTTP GETs of `https://www.sysdesai.com/gallery?tab=featured&sort=newest&page=1..4`, 4 s apart, User-Agent `ArchPilot-QA/0.1 (internal pilot)` (4 of the 10 allowed requests) | HTTP 200 x4, 48 unique designs (4 x 12, matching the 48 "Featured" in 03). `ExMwREO` is "URL Shortener", 15 steps, 1148 upvotes (matches 03 section 5). |
| 2 | Python 3 script with exact fractions for every golden value in section 4 | All values in this file match (Appendix A). |
| 3 | Node 24 probe of plain IEEE double arithmetic on the same cases | Reproduced the floating-point trap in K2 (28 instead of 27). See F-02. |
| 4 | `search-queries.csv` generator validated each shareId and title against the 48 fetched designs | 25 rows, 0 mismatches. |
| 5 | Scripts in Appendix B run against stand-in files built with `exceljs` and `docx` (not against the real app) | Each script reported the expected PASS, WARN or FAIL on good and bad stand-ins. `docx` 9.11.0 wrote a U+0008 control character raw into `document.xml` (the checker flagged it), which confirms case HLD-10 is a real hazard for the project's DOCX library. |
| 6 | The application itself, the rule engine (still a stub that throws "not implemented"), the vitest, pytest and k6 skeletons in section 9 and Appendix C | Not run. The pytest and k6 skeletons were only syntax-checked (`ast.parse`, `node --check`). |

## 3. Findings on the documents (discrepancies and gaps)

No arithmetic error was found. Every number in 02 section 7.1 (US-SZ-01, US-SZ-02, US-SZ-03) and section 10 (Kafka trace), and every figure in 03 section 8 that I checked (784/12 = 65.3 -> 66 gallery pages; 16,000 x 1,024 x 4 B = 65.5 MB), is correct. The gaps below matter because a correct implementation can still fail a golden test.

| ID | Where | Finding | Impact | Proposed resolution |
|---|---|---|---|---|
| F-01 | 02 SZ1-07, 05 section 3 `convert(x,"TB")` | The docs allow base-10 or base-2 units per project but the golden numbers only hold in base 10 (31.5 GB would be 29.34 GiB; 116.64 TB would be 106.08 TiB). | A binary default silently breaks every golden case. | Pilot default = base 10. Add one test that shows the unit base used. |
| F-02 | 05 section 9 `ceil(...)` | Plain double arithmetic returns `27.000000000000007` for `226.8 / (12 * 0.7)`, so `ceil` gives 28 instead of the exact 27. Case K2 reproduces it (Node: `Math.ceil(226.8/(12*0.7)) = 28`). | Over-sizes silently by one broker in rare but legitimate inputs. | Evaluate with decimal or rational arithmetic, or round to 1e-9 before `ceil`. Applies to the Excel path too (`ROUNDUP`). |
| F-03 | 05 section 9 warning `rf < 3 and env == "prod"` | `env` is not among the declared Kafka inputs, and `RuleTest.inputs` in `pilot.ts` is `Record<string, number>`, so a text `env` cannot be tested. | The warning may be untestable or fire in every environment. | Declare a numeric `is_prod` input (0 or 1), or test only `rf < 3`. Cases K3 and G-X-05 assume this is decided. |
| F-04 | 02 section 7.1 Kafka row vs 05 section 9 | 02 lists consumer fan-out as an input and network as an output; the 05 example and the pilot brief have neither. | Throughput constraint ignores egress. Not an arithmetic error. | Document "fan-out not modelled in pilot" in the model description. |
| F-05 | 05 section 9 test T1 "dung sai 0.01"; `pilot.ts` `RuleTest.tolerance` "Relative tolerance, e.g. 0.0001" | If 0.01 is relative, T1 accepts a storage value anywhere in 115.5 to 117.8 TB. | A wrong storage formula could still pass its own test. | Use 1e-6 relative for built-in golden tests. |
| F-06 | 02 US-SZ-03 | The 70% target utilisation is applied to RAM as well as CPU (2,048 / 0.7 = 2,925.7 GB), and hypervisor overhead is set to 0 "in this test". SZ3-03 requires an overhead term. | The model needs an overhead input defaulting to 0 or the golden case is not reproducible. | Expose `hypervisor_overhead` with default 0 and say so in the model description. |
| F-07 | Pilot brief vs 02 US-SZ-02 | "2 shards at 25 GB/shard" is not in 02 or 05. | The shard rule is undocumented. | Record `shard_max_gb = 25` as a catalog parameter with a citation. 45 / 25 = 1.8 -> 2 (31.5 / 25 = 1.26 -> 2 gives the same answer, so the base quantity is also unspecified). |
| F-08 | 05 section 10 AC-RB-04 vs 03/05 "5 MB" | "5 MB" is not defined (5,000,000 or 5,242,880 bytes). Tie-breaking of the binding constraint when two candidates are equal is also undefined. | Boundary tests XLS-NEG-04 and tie handling cannot be judged. | Pilot rule: 5 MiB = 5,242,880 bytes accepted, one byte more rejected; on a tie report all tied constraints. Confirm in Q-QA-03 and Q-QA-04. |

## 4. Golden cases for the six built-in models (part a)

Every case has: ID, precondition, steps, test data, expected result. Unless stated, the precondition is: logged in, `/rules`, pack `archpilot-core` selected, model selected, all inputs reset to defaults.

### 4.1 app-tier (Little's law)

Formula (02 SZ1-02): `RPS = CCU / (response time + think time)`.

**G-APP-01 (P0, mandatory)**

| Field | Value |
|---|---|
| Test data | CCU = 5,000 users; response time = 1 s; think time = 9 s |
| Hand computation | 1 s + 9 s = 10 s. 5,000 / 10 s = **500 RPS** |
| Expected output | `rps` = 500 req/s |
| Expected trace | First step shows the formula and the numbers: text contains `5000`, `1`, `9` (for example `5000 / (1 + 9)`), result 500, unit req/s |
| Steps | 1. Enter the three values. 2. Run. 3. Read the output and open the trace. |

**G-APP-02 (P0)** Recalculation (US-SZ-01). Start from G-APP-01, change think time to 4 s, run. Expected: 5,000 / (1 + 4) = **1,000 RPS**; the trace shows `5000 / (1 + 4)`; nothing else changes.

**G-APP-03 (P1)** Non-integer result. CCU = 1,000, response time = 1 s, think time = 2 s. 1,000 / 3 = 333.333... Expected: value 333.33 (2 decimals) when no rounding is declared, or 334 if the model rounds up. Pass if the same figure appears in the output, the trace and the saved run; record which rule applies (Q-QA-06).

**G-APP-04 (P1)** Invalid input. Try response time = 0 with think time = 0; CCU = -1; CCU = `abc`; CCU empty. Expected: each is blocked with a message naming the field, in Vietnamese; no `Infinity`, `NaN` or blank output; no crash; the previous valid result stays on screen or is cleared with an explanation.

**G-APP-05 (P1, to confirm)** Instances, vCPU, RAM. 02 section 7.1 lists these outputs (CPU-ms per request, RAM per instance, target utilisation). Formulas are not specified in the docs. Procedure: read the formulas from the trace, recompute by hand with the worksheet in 4.5, then freeze the expected values here. Status: To confirm.

### 4.2 redis

Formula source: 02 US-SZ-02. The shard rule is from the pilot brief (F-07).

**G-RED-01 (P0, mandatory)**

| Field | Value |
|---|---|
| Test data | keys = 50,000,000; key = 40 B; value = 500 B; overhead = 90 B per key; fill factor = 0.7; replicas = 1; shard cap = 25 GB |
| Hand computation | 1) bytes per key = 40 + 500 + 90 = **630 B**. 2) data = 50,000,000 x 630 B = 31,500,000,000 B = **31.5 GB**. 3) RAM per copy = 31.5 GB / 0.7 = **45 GB**. 4) total with 1 replica = 45 x (1 + 1) = **90 GB**. 5) shards = ceil(45 / 25) = ceil(1.8) = **2**; RAM per shard = 45 / 2 = 22.5 GB (<= 25). Nodes = 2 shards x 2 copies = 4 nodes x 22.5 GB = 90 GB (consistent with step 4). |
| Expected output | `data_gb` 31.5; `ram_per_copy_gb` 45; `total_ram_gb` 90; `shards` 2; `ram_per_shard_gb` 22.5 |
| Expected warnings | none (fill 0.70 is not above 0.75) |
| Expected trace | One row per step above, each with formula, substituted numbers and unit |
| Trap | Binary units give 29.34 GiB. Pass only with 31.5 GB (F-01). |

**G-RED-02 (P1)** Warning boundary (02 SZ2-03, "Redis dùng > 75% RAM"). Same data, fill = 0.75. RAM per copy = 31.5 / 0.75 = 42 GB; total 84 GB; shards = ceil(42 / 25) = 2. Expected: **no** warning (0.75 is not greater than 0.75).

**G-RED-03 (P1)** Same data, fill = 0.80. RAM per copy = 31.5 / 0.8 = 39.375 GB; total 78.75 GB; shards = ceil(39.375 / 25) = 2. Expected: warning present, severity medium or high (confirm), message in VI and EN.

**G-RED-04 (P1)** replicas = 0, other inputs as G-RED-01. Total = 45 GB (equal to one copy); shards 2. Expected: no crash; total equals RAM per copy.

**G-RED-05 (P1)** Exact multiple of the shard cap. keys = 50,000,000; key 40 B; value 570 B; overhead 90 B (700 B per key); fill 0.7. Data = 35 GB; RAM per copy = 35 / 0.7 = 50 GB; shards = ceil(50 / 25) = **2** (not 3); RAM per shard = 25 GB (at the cap); total = 100 GB.

### 4.3 vmware-host

Formula (02 US-SZ-03, SZ3-03): physical cores = sum(vCPU / ratio); divide by target utilisation; divide by cores per host; ceil. Same for RAM. Hosts = max(CPU hosts, RAM hosts); N+1 adds one host. Hypervisor overhead = 0 (F-06).

**G-VMW-01 (P0, mandatory)** (US-SZ-03)

| Field | Value |
|---|---|
| Test data | App 400 vCPU at 3:1; DB 120 vCPU at 1:1; RAM 2,048 GB; host = 64 cores (2 x 32) and 1,024 GB; target utilisation 0.7; HA = N+1; hypervisor overhead 0 |
| Hand computation (CPU) | 400 / 3 = 133.333 pCore. 133.333 + 120 = **253.333 pCore**. 253.333 / 0.7 = **361.905 core**. 361.905 / 64 = 5.655 -> ceil = **6 hosts**. |
| Hand computation (RAM) | 2,048 / 0.7 = **2,925.714 GB**. 2,925.714 / 1,024 = 2.857 -> ceil = **3 hosts**. |
| Hosts | max(6, 3) = 6. N+1: 6 + 1 = **7 hosts**. |
| Expected output | `hosts_cpu` 6; `hosts_ram` 3; `hosts_total` 7 |
| Expected binding | **CPU** |
| Expected trace | Rows for pCore, CPU need, hosts by CPU, RAM need, hosts by RAM, base hosts, +N+1 |

**G-VMW-02 (P0, extra: exact multiple)**

| Field | Value |
|---|---|
| Test data | App 300 vCPU at 3:1; DB 124 vCPU at 1:1; RAM 2,048 GB; host 64 cores / 1,024 GB; util 0.7; N+1 |
| Hand computation | 300 / 3 = 100. 100 + 124 = **224 pCore**. 224 / 0.7 = **320 core**. 320 / 64 = **5.000** exactly -> 5 hosts (not 6). RAM: 2,925.714 / 1,024 = 2.857 -> 3. max(5, 3) = 5. +1 = **6 hosts**. |
| Expected | `hosts_cpu` 5; `hosts_ram` 3; `hosts_total` 6; binding **CPU** |
| Note | In plain doubles this case is exact (checked in Node), so it passes on a naive engine too. It guards against an implementation that adds a safety `+1` before `ceil`. |

**G-VMW-03 (P0, extra: RAM-bound)**

| Field | Value |
|---|---|
| Test data | App 300 vCPU at 3:1; DB 40 vCPU at 1:1; RAM 6,144 GB; host 64 cores / 1,024 GB; util 0.7; N+1 |
| Hand computation (CPU) | 300 / 3 = 100. 100 + 40 = **140 pCore**. 140 / 0.7 = **200 core**. 200 / 64 = 3.125 -> **4 hosts**. |
| Hand computation (RAM) | 6,144 / 0.7 = **8,777.143 GB**. 8,777.143 / 1,024 = 8.571 -> **9 hosts**. |
| Hosts | max(4, 9) = 9. +1 = **10 hosts**. |
| Expected | `hosts_cpu` 4; `hosts_ram` 9; `hosts_total` 10; binding **RAM** |

**G-VMW-04 (P1)** Validation. vCPU ratio = 0 (division by zero), host cores = 0, utilisation = 0 or 1.5, negative vCPU. Expected: blocked with a field-specific message; no `Infinity`.

### 4.4 kafka

Source: 02 section 10 and 05 section 9. Parameters in all cases unless stated: broker write capacity 100 MB/s, target utilisation 0.6, disk per broker 12 TB, disk fill 0.7 (usable 12 x 0.7 = 8.4 TB per broker).

Closed forms with these parameters: `tp_brokers = ceil(ingress x rf / 60)` and `storage_brokers = ceil(0.0864 x ingress x days x rf / 8.4)`.

**G-KAF-01 (P0, mandatory)** (02 section 10, 05 AC-RB-01)

| Field | Value |
|---|---|
| Test data | ingress 150 MB/s; rf 3; retention 3 days; env prod |
| Hand computation (throughput) | 150 x 3 = 450 MB/s. 450 / 100 = 4.5. 4.5 / 0.6 = 7.5. ceil = **8**. |
| Hand computation (storage) | 150 MB/s x 86,400 s = 12,960,000 MB/day = 12.96 TB/day. x 3 days = 38.88 TB. x rf 3 = **116.64 TB**. |
| Hand computation (brokers by storage) | 12 x 0.7 = 8.4 TB. 116.64 / 8.4 = 13.8857 -> ceil = **14**. |
| Brokers | max(8, 14, rf 3) = **14** |
| Expected output | `tp_brokers` 8; `storage` 116.64 TB; `storage_brokers` 14; `brokers` 14 |
| Expected binding | **storage** (`storage_brokers`) |
| Expected trace (exactly 4 steps, AC-RB-01) | `tp_brokers`: `ceil(150 MB/s x 3 / 100 MB/s / 0.6)` = 8. `storage`: `convert(150 MB/s x 3 day x 3, "TB")` = 116.64 TB. `storage_brokers`: `ceil(116.64 TB / (12 TB x 0.7))` = 14. `brokers`: `max(8, 14, 3)` = 14. |
| Expected warnings | none (rf = 3) |

**G-KAF-02 (P0, extra: exact multiple and floating-point trap)**

| Field | Value |
|---|---|
| Test data | ingress 175 MB/s; rf 3; retention 5 days |
| Hand computation (throughput) | 175 x 3 = 525. 525 / 100 = 5.25. 5.25 / 0.6 = 8.75 -> **9**. |
| Hand computation (storage) | 175 x 86,400 = 15,120,000 MB/day. x 5 = 75,600,000 MB. x 3 = 226,800,000 MB = **226.8 TB**. |
| Hand computation (brokers by storage) | 226.8 / 8.4 = **27 exactly** (8.4 x 27 = 226.8). ceil = **27**. |
| Brokers | max(9, 27, 3) = **27**; binding **storage** |
| Why it matters | Plain doubles give `226.8 / (12 x 0.7) = 27.000000000000007`, so `ceil` returns **28**. Pass only with 27 (F-02). |

**G-KAF-03 (P0, extra: rf below 3 in prod)**

| Field | Value |
|---|---|
| Test data | ingress 100 MB/s; rf 2; retention 1 day; env prod |
| Hand computation (throughput) | 100 x 2 = 200. 200 / 100 = 2. 2 / 0.6 = 3.333 -> **4**. |
| Hand computation (storage) | 100 x 86,400 = 8,640,000 MB/day = 8.64 TB. x 1 x rf 2 = **17.28 TB**. 17.28 / 8.4 = 2.057 -> **3**. |
| Brokers | max(4, 3, rf 2) = **4**; binding **throughput** |
| Expected warning | High severity: "Replication factor < 3 ở môi trường Prod" (05 section 9), shown in Vietnamese and English |
| Companion | Same data with env = non-prod (or rf = 3): the warning must **not** appear (F-03). |

**G-KAF-04 (P1, bonus: minimum constraint binds)**

| Field | Value |
|---|---|
| Test data | ingress 10 MB/s; rf 3; retention 1 day |
| Hand computation | tp: 10 x 3 / 100 / 0.6 = 0.5 -> 1. Storage: 10 x 86,400 x 3 = 2,592,000 MB = 2.592 TB; 2.592 / 8.4 = 0.309 -> 1. max(1, 1, 3) = **3**. |
| Expected | `brokers` 3; binding "minimum (rf)", as in the third row of the 02 section 10 trace |

**G-KAF-05 (P1)** Retention fraction and large value. retention = 0.5 day (150 MB/s, rf 3): storage = 150 x 86,400 x 0.5 x 3 = 19,440,000 MB = 19.44 TB; 19.44 / 8.4 = 2.314 -> 3; tp 8 -> brokers **8**, binding throughput. Then retention = 365 days: storage = 150 x 86,400 x 365 x 3 = 14,191,200,000 MB = 14,191.2 TB; 14,191.2 / 8.4 = 1,689.43 -> **1,690**; binding storage. Expected: no overflow, thousands separators readable, unit stays TB.

### 4.5 rdbms (aligned with the implemented inputs, 2026-10-16)

The implemented model (`src/domain/rules/packs/rdbms.ts`) does **not** take "read TPS / write TPS". It takes total peak `tps` plus `reads_per_txn` and `writes_per_txn` (logical I/Os per transaction), and also `growth_rate` (a fraction per year, 0.3 = 30%, max 2), `years`, `cpu_ms_per_txn` and `backup_fulls`. There is no `env` input: the single-node warning fires whenever `replicas < 1`. Every case below is entered with exactly these fields. Ratios are fractions (20% is 0.2).

Fixed params (shown under "Fixed parameters"): buffer hit 0.9, target utilisation 0.6, WAL/archive 0.25 of DB size, disk fill 0.75, backup compression 0.5, 10 MB RAM per connection, 8 GB OS RAM, vCPU step 2, RAM step 16 GB, IOPS warning 20,000. Units are decimal (1 GB = 1,000 MB).

| ID | Priority | Inputs to enter | Expected (hand result) |
|---|---|---|---|
| G-RDB-01 | P0 | data_size 2000 GB; index_overhead 0.3; growth_rate 0.25; years 2; tps 2500; reads_per_txn 6; writes_per_txn 2; cpu_ms_per_txn 4; working_set 0.2; connections 800; replicas 1; backup_fulls 4 | vCPU **18**; RAM **832 GB**; IOPS **10,834**; storage per node **6,770.83 GB**; total storage **13,541.67 GB**; backup **8,125 GB**; nodes **2**; buffer pool **812.5 GB**; no warning; no binding (no max/min). |
| G-RDB-02 | P1 | Same as 01 with replicas 0 | Nodes **1**; total storage **6,770.83 GB**; every other output as in 01; **high** warning "DB chỉ có 1 node: không có failover." / "Single database node: no failover." (02 SZ2-03). |
| G-RDB-03 | P1 | Same as 01 with data_size 0 and tps 0 | Zero-valued outputs, never NaN: vCPU **0**; IOPS **0**; storage per node, total, backup and buffer pool **0 GB**; RAM **16 GB** (connections and OS only); nodes **2**; no warning. |

Hand arithmetic for G-RDB-01 (each line is one trace step):

```
data_future      = 2000 x (1 + 0.25)^2         = 2000 x 1.5625          = 3125 GB
db_size          = 3125 x (1 + 0.3)                                     = 4062.5 GB
wal_archive      = 4062.5 x 0.25                                        = 1015.625 GB
storage_per_node = (4062.5 + 1015.625) / 0.75  = 5078.125 / 0.75        = 6770.8333 GB
nodes            = 1 + 1                                                = 2
total_storage    = 6770.8333 x 2                                        = 13541.6667 GB
backup_storage   = 4062.5 x 0.5 x 4                                     = 8125 GB
read_iops        = 2500 x 6 x (1 - 0.9)                                 = 1500 IOPS
write_iops       = 2500 x 2                                             = 5000 IOPS
iops             = (1500 + 5000) / 0.6         = 10833.33 -> output ceil = 10834 IOPS
vcpu             = roundup_to(2500 x 0.004 s / 0.6, 2) = roundup_to(16.67, 2) = 18
buffer_pool      = 4062.5 x 0.2                                         = 812.5 GB
ram_needed       = 812.5 + 800 x 10 MB (8 GB) + 8                       = 828.5 GB
ram              = roundup_to(828.5, 16)       = 52 x 16                = 832 GB
```

G-RDB-02 changes only `nodes = 1 + 0 = 1` and `total_storage = 6770.8333 x 1`; the warning condition `replicas < 1` is true. G-RDB-03: every size and rate is 0 x something = 0; `vcpu = roundup_to(0, 2) = 0`; `ram_needed = 0 + 8 + 8 = 16 GB`, `roundup_to(16, 16) = 16 GB`.

These three cases are also asserted in `src/domain/rules/packs/packs.test.ts` ("rdbms QA G-RDB-0x"), so a formula change that breaks them fails CI.

Worksheet (one row per trace step; copy it for each case):

| Step name | Formula as shown in the trace | Substituted values (copy) | Hand result (exact) | App result | Match (relative 1e-9) |
|---|---|---|---|---|---|
| | | | | | |

Property checks that hold for any correct formula set (run them even before the formulas are final):

1. P-RDB-1: every output is a finite, non-negative number with a unit.
2. P-RDB-2: doubling data size never decreases storage outputs.
3. P-RDB-3: counts that map to physical units (vCPU, nodes, disks) are whole numbers after rounding.
4. P-RDB-4: running the same inputs twice gives identical outputs and an identical trace.
5. P-RDB-5: every output has at least one test in the pack (05 section 7).

### 4.6 san-storage (aligned with the implemented inputs, 2026-10-16)

02 SZ3-05: usable capacity to raw by RAID, plus snapshot reserve, hot spares and thin-provisioning ratio, then disk count and IOPS check. The implemented model (`src/domain/rules/packs/sanStorage.ts`) takes: `usable` (TB), `raid_level` (a number: 10, 6 = 8+2, 5 = 4+1, 1), `snapshot_reserve` (fraction), `thin_ratio` (provisioned / physical, 1 = thick, default 1; added 2026-10-16 per SZ3-05), `disk_size` (TB), `disk_iops`, `host_iops` (front-end), `read_ratio`, and spares as `spare_every` = **one hot spare per N disks** (not a percentage: "spare 5%" is entered as `spare_every` 20). Erasure coding and per-tier (NVMe/SSD/HDD) splits are not modelled; enter the drive class through `disk_iops`.

RAID table: RAID10 factor 2.0, write penalty 2, group 2; RAID6 1.25, 6, 10; RAID5 1.25, 4, 5; RAID1 2.0, 2, 2. Units are decimal TB.

| ID | Priority | Inputs to enter | Expected (hand result) |
|---|---|---|---|
| G-SAN-01 | P0 | usable 100 TB; raid_level 6; snapshot_reserve 0.2; thin_ratio 1; spare_every 20; disk_size 7.68 TB; disk_iops 10000; host_iops 50000; read_ratio 0.7 | Raw **150 TB**; data disks **20**; hot spares **1**; total disks **21**; raw installed **161.28 TB**; back-end IOPS **125,000**; deliverable front-end IOPS **80,000**; binding **data_disks**; no warning. |
| G-SAN-02 | P1 | Same as 01 with raid_level 10 | Raw **240 TB** (larger than RAID6, P-SAN-4); data disks **32**; hot spares **2**; total **34**; raw installed **261.12 TB**; back-end IOPS **65,000**; deliverable **246,153** IOPS (floor); binding **data_disks**. |
| G-SAN-03 | P1 | Same as 01 with thin_ratio 2 | Raw **75 TB** (smaller than 01); data disks **20**; hot spares **1**; total **21**; raw installed **161.28 TB**; deliverable **80,000** IOPS; binding **iops_disks**; two **info** warnings: "IOPS, not capacity, decides the disk count" and "Thin-provisioning credit applied (2x)". Total disks do not drop: IOPS binds once capacity halves. |

Hand arithmetic for G-SAN-01:

```
capacity_needed = 100 / 1 x (1 + 0.2)                          = 120 TB
raw             = 120 x 1.25 (RAID6)                           = 150 TB
data_disks      = ceil(150 / 7.68) = ceil(19.53)               = 20
backend_iops    = 50000 x 0.7 + 50000 x 0.3 x 6 = 35000 + 90000 = 125000 IOPS
iops_disks      = ceil(125000 / 10000) = ceil(12.5)            = 13
disks_needed    = roundup_to(max(20, 13), 10)                  = 20
hot_spares      = ceil(20 / 20)                                = 1
total_disks     = 20 + 1                                       = 21
raw_installed   = 21 x 7.68                                    = 161.28 TB
iops_capacity   = 20 x 10000 / (0.7 + 0.3 x 6) = 200000 / 2.5  = 80000 IOPS
```

G-SAN-02 (RAID10): raw = 120 x 2.0 = 240 TB; data_disks = ceil(240 / 7.68 = 31.25) = 32; backend = 35,000 + 50,000 x 0.3 x 2 = 65,000; iops_disks = ceil(6.5) = 7; disks_needed = roundup_to(32, 2) = 32; spares = ceil(32 / 20 = 1.6) = 2; total = 34; raw installed = 34 x 7.68 = 261.12 TB; iops_capacity = 32 x 10,000 / (0.7 + 0.3 x 2 = 1.3) = 246,153.85, floor 246,153.

G-SAN-03 (thin 2): capacity_needed = 100 / 2 x 1.2 = 60 TB; raw = 60 x 1.25 = 75 TB; data_disks = ceil(75 / 7.68 = 9.77) = 10; iops_disks = 13 (as 01); disks_needed = roundup_to(max(10, 13), 10) = 20; spares 1; total 21; raw installed 161.28 TB; iops_capacity 80,000.

These three cases are also asserted in `src/domain/rules/packs/packs.test.ts` ("san-storage QA G-SAN-0x").

Property checks: P-SAN-1 raw >= usable / thin_ratio (with thin_ratio 1, raw >= usable); P-SAN-2 data disks x disk size >= raw (disks rounded up); P-SAN-3 raw is non-decreasing in usable; P-SAN-4 RAID10 raw > RAID6 raw for equal inputs; P-SAN-5 the unit base (TB, decimal) matches F-01; P-SAN-6 same as P-RDB-1 and P-RDB-4.

### 4.7 Cross-model checks (apply to all six models)

| ID | Priority | Precondition | Steps | Test data | Expected result |
|---|---|---|---|---|---|
| G-X-01 | P0 | Pack `archpilot-core` | Open the pack | none | Exactly 6 models: app-tier, rdbms, redis, kafka, vmware-host, san-storage. Pack is marked built-in and cannot be edited or deleted. |
| G-X-02 | P0 | Any model | Press the "run tests" control for the pack | none | Every test passes; the report lists each model and test id; each model has at least one test and every output is covered. |
| G-X-03 | P0 | G-KAF-01 done | Open the trace | Kafka inputs | 4 steps in order; each shows formula, substituted numbers and unit; the deciding constraint is highlighted or named. |
| G-X-04 | P0 | G-VMW-01 done | Read the result panel | VMware inputs | Binding constraint "CPU" is displayed next to the 7 hosts. |
| G-X-05 | P0 | G-KAF-03 | Run with rf = 2 | Kafka K3 | High warning appears in VI and EN; with rf = 3 it disappears. |
| G-X-06 | P0 | A design exists | Run Kafka K1, save the run to the design with label "Kafka cluster (Prod)" | label | Save succeeds; the run appears in the design's list with pack id `archpilot-core`, pack version, model id, inputs, steps, outputs, binding, warnings and a created time. Reload the page: it is still there. |
| G-X-07 | P0 | G-X-06 done | Save the same run twice | same | Two separate runs, or an explicit "replace" prompt; never a silent overwrite or duplicate error. |
| G-X-08 | P1 | Any model | Run the same inputs 3 times | any | Identical outputs, identical trace text (PR-1, NFR-01). |
| G-X-09 | P1 | Any model | Enter a value below `min` or above `max` of an input | out-of-range | Blocked with the allowed range in the message. |
| G-X-10 | P1 | Any model | Switch UI language VI/EN | none | Labels, warnings and trace labels switch; numbers do not change. |
| G-X-11 | P1 | Any model | Change one input and watch the result | any | Result and trace update without a page reload; no stale value stays visible. |
| G-X-12 | P1 | Two users A and B | A saves a run to A's design; B opens `/rules` | none | B cannot see or open A's run or design (404 or empty), matching the "404, not 403" rule in the backend README. |

## 5. Excel import and export (part b)

Files for the negative cases are produced by the script in Appendix B1 from the template that the app itself offers for download (so the cell addresses match the real file). "Cell address" below means sheet name plus A1 address, for example `Calc!B2`.

Common expectations for every rejection (E-REJ): (1) a Vietnamese message that says what is wrong and where; (2) no stack trace and no HTTP 500 text; (3) **no half-created model**: the list of rule packs and models is identical before and after; (4) the page stays usable and the next import works; (5) the file name is shown as text (a file called `<img src=x onerror=alert(1)>.xlsx` must not execute).

**Positive controls first.**

| ID | Priority | Precondition | Steps | Test data | Expected result |
|---|---|---|---|---|---|
| XLS-POS-01 | P0 | `/rules`, Excel tab | Download the template, open it in Excel without changes, close | template (Kafka example) | File has the 8 sheets of 05 section 4 (Model, Inputs, Params, Calc, Outputs, Warnings, Lookups, Tests); Calc holds 4 steps; values match K1 (8, 116.64, 14, 14) when opened in Excel. |
| XLS-POS-02 | P0 | XLS-POS-01 | Import the unchanged template | same | Model created; test T1 passes; trace shows exactly 4 steps and the binding constraint "storage" (AC-RB-01). |
| XLS-POS-03 | P0 | XLS-POS-02 | Export the imported pack, open in Excel, change nothing | exported file | Formulas are still formulas (not pasted values); recalculated results equal the app (AC-RB-05): brokers 14. |
| XLS-POS-04 | P1 | XLS-POS-03 | In Excel set ingress 175, rf 3, retention 5, recalculate, save, import, run tests | K2 inputs | Cached value is whatever Excel computed (27 expected). Import auto-test agrees with the app: pass. If Excel and the app disagree on 27 versus 28, log it as F-02 evidence. |
| XLS-POS-05 | P1 | XLS-POS-02 | Import the same file a second time | same | Clear outcome: new version, replace prompt, or "already exists"; never a silent duplicate with the same id. |

**Negative cases.**

| ID | Priority | Precondition | Steps | Test data | Expected result |
|---|---|---|---|---|---|
| XLS-NEG-01 | P0 | E-REJ | Import `neg-01-indirect.xlsx` | `Calc!B2` = `INDIRECT("Inputs!B2")` | Rejected. Message names the function (INDIRECT), says it is not supported, and gives the address `Calc!B2` (AC-RB-03). No model created. |
| XLS-NEG-02 | P0 | E-REJ | Import `neg-02-a1-reference.xlsx` | `Calc!B2` = `Inputs!B2*Inputs!B3` | Rejected with address `Calc!B2`; message says cell references are not allowed and to use named ranges (05 section 4). No model created. |
| XLS-NEG-03a | P0 | E-REJ | Choose `neg-03a-macro.xlsm` | `.xlsm` | Rejected before upload or parsing: "chỉ nhận .xlsx". The file input may filter by extension, but the server must also refuse (call the API directly, see Appendix C2). |
| XLS-NEG-03b | P2 | E-REJ | Import `neg-03b-macro-disguised.xlsx` | macro content type behind the `.xlsx` name | Rejected, or imported with the macro part ignored and never executed. Record which (Q-QA-07). |
| XLS-NEG-04 | P0 | E-REJ | Import `size-6000000-bytes.xlsx` | 6,000,000 bytes | Rejected with a message that states the 5 MB limit; rejection happens before parsing (fast; the page does not hang); HTTP 413 or 422, not 500. |
| XLS-NEG-04b | P0 | none | Import `size-4000000-bytes.xlsx` and `size-5242880-bytes.xlsx` | 4,000,000 and 5,242,880 bytes | Both accepted (extra zip part is ignored). |
| XLS-NEG-04c | P1 | E-REJ | Import `size-5242881-bytes.xlsx`; then `size-5000001-bytes.xlsx` | 5 MiB + 1 byte; 5,000,001 bytes | First rejected. Second: record the outcome; it is the "5 MB" definition test (F-08, Q-QA-03). |
| XLS-NEG-05 | P0 | E-REJ | Import `neg-05-no-cached-values.xlsx` | every formula cell has no stored result | The app does not claim success without tests. Either (a) rejected with the first uncached address and the hint "mở bằng Excel, tính lại (F9), lưu rồi import lại", or (b) imported as Draft flagged "chưa có test" that cannot be published or used in an HLD. Record which. |
| XLS-NEG-06 | P0 | Rule editor open, new model | Add a calc step named `bad_sum` with formula `ingress + storage` where `ingress` is `MB/s` and `storage` is `TB`; press compile or save | units `MB/s` and `TB` | Compile error that names the step `bad_sum` and both units (AC-RB-02). The model cannot be saved as published or run. Fix the formula (use `ingress * retention`) and the error disappears. |
| XLS-NEG-06b | P1 | same | Formula `a_mb + b_tb` with `MB` and `TB` (same dimension, different scale) | MB + TB | **No** error; the value is converted (false-positive guard). A formula `3 day + 5 GB` must give a unit error. |
| XLS-NEG-07 | P0 | Rule editor | Create a pack whose texts contain the injection set P-INJ (below): model names (VI and EN), input labels, descriptions, sources, warning messages, test ids. Save, export to `.xlsx`. Run `node check-export-injection.mjs <file>` with each `--payload` (Appendix B2). | P-INJ-1 to P-INJ-7 | Script exits 0: no formula cell exists in any text sheet; no dangerous function in Calc formulas; every payload is present as text (not dropped). Opening in Excel shows the literal text, with no security prompt, no link to click, and no external-content warning. WARN lines mean "stored as plain string": acceptable for pass, recorded for Q-QA-05 (apostrophe prefix policy). |
| XLS-NEG-08 | P1 | E-REJ | Import `neg-08-not-a-zip.xlsx` and `neg-13-empty.xlsx` | text file, 0 bytes | Both rejected cleanly ("không phải file Excel hợp lệ"). |
| XLS-NEG-09 | P1 | E-REJ | Import `neg-09-external-workbook.xlsx` | `Calc!B2` = `'[other.xlsx]Sheet1'!A1` | Rejected with address; the app never tries to read another file. |
| XLS-NEG-10 | P1 | E-REJ | Import `neg-10-undefined-name.xlsx` | `Calc!B2` uses `no_such_name` | Rejected with address `Calc!B2` and the unknown name. |
| XLS-NEG-11 | P1 | E-REJ | Import `neg-11-missing-tests-sheet.xlsx` | no `Tests` sheet | Rejected; message names the missing sheet. |
| XLS-NEG-12 | P1 | E-REJ | Upload a `.csv`, `.xls`, `.pdf` and a `.docx` | wrong types | All rejected with the same "chỉ nhận .xlsx" message. |
| XLS-NEG-14 | P1 | Rule editor, units mode | Divide by zero: formula `a / b` with b default 0 | b = 0 | Evaluation error naming the step; no `Infinity` shown. |
| XLS-NEG-15 | P2 | E-REJ | Password-protected workbook; workbook with 1,000,000 rows in a sheet (still under 5 MB compressed) | protected; large | Clean rejection or bounded processing time (under 10 s); the server stays responsive for other users. |

Injection payload set **P-INJ** (use exactly; one per field or all in one name):

```text
P-INJ-1  =HYPERLINK("https://example.invalid/x","Click")
P-INJ-2  +1+1
P-INJ-3  -2+3
P-INJ-4  @SUM(1+1)
P-INJ-5  =cmd|' /C calc'!A0
P-INJ-6  <TAB>=1+1        (a real tab character, then =1+1)
P-INJ-7  <CR>=1+1         (a real carriage return, then =1+1)
```

## 6. HLD DOCX content checks (part c)

The HLD outline is not final. Minimum pilot outline to confirm with WP-C (06 section 1, rows 0, 3, 6, PL-A, PL-D): (1) Document information (design name, version = design revision, date, author); (2) Architecture overview (component list and counts from the design); (3) Sizing (one block per saved run); (4) Appendix A, detailed sizing trace; (5) Appendix D, references. Headings are matched by text, so edit the `--heading` arguments to the final wording.

Automated checks use `check-hld.mjs` (Appendix B3). Manual checks are done by opening the file in Microsoft Word.

Reference design for the HLD test: design "UAT-HLD" with 3 or more components; runs saved: Kafka K1 ("Kafka cluster (Prod)"), VMware V1 ("VMware hosts (Prod)"), Kafka K3 (to carry a warning); pins: URL Shortener `ExMwREO` step 8, Rate Limiter `V31LdXN` (no step).

| ID | Priority | Precondition | Steps | Test data | Expected result |
|---|---|---|---|---|---|
| HLD-01 | P0 | Reference design ready | `/hld`, choose the design, export | reference design | A `.docx` downloads (file name like `HLD_<design>_v<revision>.docx`, no path characters). Word opens it without a repair prompt. Script: all "package contains" checks PASS. |
| HLD-02 | P0 | HLD-01 | `node check-hld.mjs <file> --heading "Sizing" --heading "Tham chiếu"` (adjust wording) | final outline | Every minimum-outline heading is present, in order, with heading styles (navigation pane shows them in Word). |
| HLD-03 | P0 | HLD-01 | `--text "116.64 TB" --text "14" --text "7"` and read the Sizing block | K1 and V1 runs | Kafka block shows brokers 14, storage 116.64 TB, tp_brokers 8, binding "storage"; VMware block shows 7 hosts and binding "CPU". Values equal the saved run and the `/rules` screen character for character. Pack id `archpilot-core` and its version appear. |
| HLD-04 | P0 | HLD-01 | Read Appendix A | K1 run | The 4 Kafka steps appear with formula, substituted numbers and unit, in the same order as the app trace. |
| HLD-05 | P0 | K3 run saved | `--text "Replication factor"` | K3 | The High warning from the saved run appears in the Sizing block (in the language of the document). |
| HLD-06 | P0 | Pins exist | `--link https://www.sysdesai.com/share/ExMwREO --link https://www.sysdesai.com/share/V31LdXN --text "Nguồn: SysDesAi" --text "AI-generated"` | 2 pins | Each pin is a clickable hyperlink whose target is exactly `https://www.sysdesai.com/share/<shareId>` (https, external). Link text is the design title. Pin 1 shows "Bước 8: Add Cache Layer for Redirects". Every pin shows "Nguồn: SysDesAi" and the label "Nội dung AI-generated, chỉ để tham khảo". In Word, Ctrl+click opens the page. |
| HLD-07 | P0 | New empty design (no components, runs or pins) | Export | empty | File is produced and opens. Title and document information are present; each empty section either is omitted or shows an explicit "Chưa có dữ liệu" line. No `undefined`, `NaN`, empty tables or error. No HTTP 500. |
| HLD-08 | P1 | Design with runs but no pins; design with pins but no runs | Export both | partial | Each exports; the missing part is stated; no leftover heading without content and no broken link. |
| HLD-09 | P1 | User-created pack with a saved run | Edit the pack (change a formula or default), save, then export the HLD | edited pack | HLD still shows the run as saved (old values and old pack version). It does not silently recompute. |
| HLD-10 | P1 | Design named `A<U+0008>B` and a component label with U+0000, emoji (U+1F600), 500 characters, `<script>`, `&`, `"` | Export; run the script with no extra flags | hostile text | Export succeeds; script check "no XML-invalid control characters" PASS (invalid characters are removed or replaced); Word opens it without a repair prompt; markup characters appear as literal text. (docx 9.11.0 does not strip U+0008 by itself; see section 2 row 5.) |
| HLD-11 | P1 | Two designs A and B with different runs | Export A | A and B | HLD of A contains only A's runs and pins. |
| HLD-12 | P1 | User B | Request the HLD export URL or API for user A's design id directly | A's id | 404 (not 403, not a file). |
| HLD-13 | P1 | Word | Open the file and look at Vietnamese text | any | Diacritics render correctly (for example "Kết quả", "Thông tin tài liệu"), no square placeholder glyphs; tables fit the page width; table header row repeats or is clearly styled. |
| HLD-14 | P1 | HLD-01 | Export the same unchanged design twice | same | Text content identical except date and time stamps. |
| HLD-15 | P1 | Design with 50 components, 10 runs, 10 pins | Time the export | large | Finishes in 10 s or less on the pilot PC (proposed threshold); file under 5 MB. |
| HLD-16 | P2 | Pin on a step of phase `estimate` | Export | pin with note | If the HLD copies any estimate figure, it carries the warning "AI-generated, chưa kiểm chứng" (03 KH-P1-10); ideally only link and title are copied (KH-P1-12). |
| HLD-17 | P2 | UI language EN | Export | EN | Document language follows the UI language, or the Vietnamese-only decision is stated (Q-QA-08). |

## 7. Reference search checks (part d)

Data under test: `search-queries.csv` (25 rows). The API path is a placeholder: `GET /api/reference/search?q=<text>` returning `ReferenceSearchResponse` (`pilot.ts`). Confirm with WP-B and edit Appendix C1.

| ID | Priority | Precondition | Steps | Test data | Expected result |
|---|---|---|---|---|---|
| REF-00 | P0 | Index loaded | Open `/reference`; read the index status | status | `indexedDesigns` >= 768 (98% of 784, AC-01) and shown; `lastCrawlAt` shown; `indexedSteps` in the order of 12,000 to 16,000 (03 section 8). No crawl runs during the UAT. |
| REF-01 | P0 | REF-00 | Search `URL shortener` (AC-02, row en-01) | `URL shortener` | The **first** result is `https://www.sysdesai.com/share/ExMwREO`, title "URL Shortener". |
| REF-02 | P0 | REF-00 | Search `bộ nhớ đệm cho chuyển hướng link rút gọn` (AC-03, row vi-01) | VI query | ExMwREO is in the top 3, and its card lists "Bước 8: Add Cache Layer for Redirects" among at most 3 steps. `expandedQuery` shows the glossary expansion (cache, redirect, short, url). |
| REF-03 | P0 | REF-00 | Inspect one result card | any | Each card has: title; link `https://www.sysdesai.com/share/<id>`; for each matched step "Bước N: <title>" and the phase; a plain-text snippet of at most about 300 characters; "Nguồn: SysDesAi" with the link; the label "Nội dung AI-generated, chỉ để tham khảo"; the update date (03 section 5). |
| REF-04 | P0 | REF-00 | Open 5 result links (the 5 first distinct shareIds of the CSV run) | links | Each opens in a new tab on the right design (HTTP 200 on SysDesAi; AC-04). Links carry `rel="noopener noreferrer"`. Do not open more than 1 link every 3 seconds. |
| REF-05 | P0 | REF-00 | Step numbering: open ExMwREO on SysDesAi and count steps | ExMwREO | Step 8 is "Add Cache Layer for Redirects", counted from 1 with Clarify as step 1. The app uses the display number, not the internal id `step-7` (03 section 5). |
| REF-06 | P0 | REF-00 | Injection set S-INJ (below), one query each | S-INJ-1 to S-INJ-12 | For each: HTTP 200 with a list (possibly empty) or 400 with a friendly message; never 500; no stack trace; no script runs; the typed text appears as plain text in the page, the query echo and `expandedQuery`; after the whole set a normal query (`URL shortener`) still returns ExMwREO first and `indexedDesigns` is unchanged. |
| REF-07 | P0 | REF-00 | Open the screen with the network cable unplugged from the internet (LAN only) | none | Search still works (the index is local). Only opening the SysDesAi links fails, and nothing in the app hangs. |
| REF-08 | P1 | REF-00 | Diacritic and case folding: for each of the 15 VI queries run the original, the unaccented form (`bo nho dem cho chuyen huong link rut gon`), UPPER CASE, and an NFD-decomposed copy | 15 x 4 | Top 3 identical to the original in all variants. Pay special attention to `đ` (U+0111) and `Đ`, which Unicode decomposition does not split: `đăng nhập` must equal `dang nhap` (row vi-13). Composed (`ệ`) and decomposed (`e` + marks) input give the same results. |
| REF-09 | P1 | REF-00 | Run all 25 rows of `search-queries.csv` with Appendix C1 | CSV | Hit rate (expected shareId in the top 3; rows stating top 5 may use 5; rows stating rank 1 need 1): overall >= 20 of 25, EN >= 8 of 10, VI >= 12 of 15 (proposed thresholds; PO to confirm). Rows vi-01, vi-02, en-10 also list step 8. Record rank per row. |
| REF-10 | P1 | REF-00 | Empty string, spaces only, 1 character, 2,000 characters, 10,000 characters, emoji only | edge | Friendly prompt or truncation; no 500; response time under 2 s; the page does not freeze. |
| REF-11 | P1 | REF-00 | Search `zzzzqqqqxx` | nonsense | "Không tìm thấy tham chiếu phù hợp" with tips; no endless spinner. |
| REF-12 | P1 | REF-00 | Search a term that exists mostly in Real World designs (try `Netflix`) | any | At least one result from tab Real World shows the line "Bài gốc: <blog> - <article url>" with a working link (03 section 5). |
| REF-13 | P1 | REF-00 | Time 25 queries x 4 runs on the pilot PC | CSV | p95 <= 1 s (AC-08, keyword search). Single user, then 10 parallel users. |
| REF-14 | P1 | REF-00, a design exists | Pin ExMwREO step 8 to the design, reload, unpin, pin again | pin | Pin appears in the design's pin list with title, step and note; survives reload; unpin removes it; duplicate pin is refused or merged. |
| REF-15 | P1 | REF-00 | Look for any control that copies SysDesAi numbers into sizing | UI | None exists (KH-P1-12): sizing inputs are never filled from SysDesAi content. |
| REF-16 | P1 | REF-00 | Backend returns an error (stop the backend, search) | outage | A clear Vietnamese error with a retry control; no blank page. |

Injection query set **S-INJ** (type or paste exactly):

```text
S-INJ-1   <script>alert(1)</script>
S-INJ-2   <img src=x onerror=alert(1)>
S-INJ-3   "><svg/onload=alert(1)>
S-INJ-4   ' OR '1'='1
S-INJ-5   "; DROP TABLE designs;--
S-INJ-6   url* NEAR/3 shortener
S-INJ-7   "unbalanced quote
S-INJ-8   cache AND OR NOT (
S-INJ-9   %_\
S-INJ-10  javascript:alert(1)
S-INJ-11  {{7*7}} ${7*7}
S-INJ-12  (NUL character) U+0000 inside the text, and a 5,000-character string of "a"
```

## 8. Environment and non-functional smoke (pilot-specific)

| ID | Priority | Check | Expected result |
|---|---|---|---|
| ENV-01 | P0 | `GET /api/health` (deep) on the pilot PC | 200 with database read and write probes passing. |
| ENV-02 | P0 | Create a design, restart the container (`docker restart`), reload | The design is still there. If not, the SQLite file is not on a volume: Blocker (the `--rm` run in `09-pc-deployment-guide.md` has no volume). |
| ENV-03 | P0 | Open the pilot URL from a second PC on the LAN | Login page loads. Otherwise fix the address, the port mapping and the Windows Firewall inbound rule. |
| ENV-04 | P0 | Create 30 accounts (one per user, `scripts.create_user`) and log in with 5 of them at once | All succeed. Do not share one account: designs are owner-scoped and edits from two sessions give revision conflicts. |
| ENV-05 | P1 | Chrome and Edge, latest, window 1366 x 768, zoom 100% and 125% | All six screens usable without horizontal scroll on the main controls. |
| ENV-06 | P1 | Run `python -m scripts.backup --verify` once | Snapshot created and verified (a file copy of a WAL database is not a backup). |
| ENV-07 | P1 | 30 virtual users for 10 minutes: 80% search, 15% open and save designs, 5% HLD export, think time 10 s (script in Appendix C3, not run yet) | p95 under 2 s for search and design reads, HLD export p95 under 10 s, error rate under 1%, no database lock errors. |
| ENV-08 | P1 | Wrong password 5 times from one account | Throttling message appears; the account recovers after the wait. Do this only in QA, never during UAT. |

## 9. Automation recommendation and CI gates

| Layer | What | Tool | Share |
|---|---|---|---|
| Unit | Golden cases 4.1 to 4.4 and property checks 4.5 and 4.6; DSL unit-check errors; Excel formula translator | vitest (already a project dependency) against `evaluateModel`, `compileModel`, `runModelTests` of `src/domain/rules/engine.ts` | about 70% |
| API | Search queries, rule-pack import limits and rejections, run save, HLD export authorisation | pytest with the existing FastAPI TestClient; `httpx` for the live container | about 25% |
| UI | One end-to-end smoke: login, search, run Kafka, save, export HLD | Playwright (not required for tomorrow) | about 5% |
| File checks | `check-hld.mjs`, `check-export-injection.mjs` | Node (fflate, exceljs, already dependencies) | with API |

**CI gate proposal (hand-off to devops-master).** A merge to the pilot branch is blocked unless: `npm run typecheck`, `npm test` (including the golden suite), `ruff check` and `pytest` pass; the golden suite includes K2 so that floating-point regressions are caught; `search-queries.csv` hit rate does not drop below the REF-09 thresholds when the index fixture is present; the HLD checker passes on the reference design.

Vitest skeleton (**not run**: the engine in this worktree still throws "not implemented"; the built-in pack import path is a placeholder):

```ts
import { describe, expect, it } from 'vitest'
import { evaluateModel } from '../src/domain/rules/engine'
import { ARCHPILOT_CORE } from '../src/domain/rules/builtin' // placeholder path

const model = (id: string) => ARCHPILOT_CORE.models.find((m) => m.id === id)!
const meta = { rulePackId: 'archpilot-core', rulePackVersion: 1 }
const out = (run: ReturnType<typeof evaluateModel>, name: string) => run.outputs.find((o) => o.name === name)!.value

describe('golden: kafka', () => {
  it.each([
    ['K1', { ingress: 150, rf: 3, retention: 3 }, { tp_brokers: 8, storage: 116.64, brokers: 14 }, 'storage_brokers'],
    ['K2', { ingress: 175, rf: 3, retention: 5 }, { tp_brokers: 9, storage: 226.8, brokers: 27 }, 'storage_brokers'], // float trap
    ['K3', { ingress: 100, rf: 2, retention: 1 }, { tp_brokers: 4, storage: 17.28, brokers: 4 }, 'tp_brokers'],
    ['K4', { ingress: 10, rf: 3, retention: 1 }, { tp_brokers: 1, storage: 2.592, brokers: 3 }, 'rf'],
  ])('%s', (_id, inputs, expected, binding) => {
    const run = evaluateModel(model('kafka'), inputs, meta)
    for (const [name, value] of Object.entries(expected)) {
      expect(out(run, name)).toBeCloseTo(value, 9) // exact for integers
    }
    expect(run.binding).toContain(binding)
  })
})
```

## 10. Quality gates and exit criteria

**Gate G1: build done (before 07:30 on 2026-10-15).**

1. CI green on `typecheck`, `npm test`, `ruff`, `pytest`.
2. All P0 cases in sections 4 to 8 are Pass; the TBC case G-APP-05 is either frozen and Pass, or the model is hidden from the pilot pack with the PO's agreement; G-RDB-* and G-SAN-* carry hand results since 2026-10-16 (4.5, 4.6) and must Pass.
3. Zero open Blockers; no open Critical without an agreed workaround.
4. Traceability matrix (section 11) has no empty "Test case" cell for a Must feature.
5. `UAT-checklist.md` dry run by one non-technical person finishes in 45 minutes or less.

**Gate G2: pilot exit (end of the pilot).**

1. At least 80% of the invited users completed the UAT checklist; per-section pass rate at least 90%.
2. Average usability score at least 3.5 out of 5; usefulness of reference search at least 4 out of 5 (02 section 2 target).
3. No data loss and no wrong golden number reported.

**Severity.** Blocker: wrong sizing number, data loss, cannot log in, security hole. Critical: a P0 feature unusable, no workaround. Major: wrong behaviour with a workaround. Minor: cosmetic or wording.

**Defect record.** ID, case ID, build or commit, steps, expected, actual, severity, screenshot, owner, status.

## 11. Traceability matrix

Status is "Not run" everywhere because the application could not be run in this worktree. "Doc arithmetic OK" means the hand computation was re-derived and matches the document.

| Requirement | Design element | Test cases | Status |
|---|---|---|---|
| US-SZ-01, SZ1-02 (Little's law) | `/rules` app-tier; `evaluateModel` | G-APP-01 to 05 | Doc arithmetic OK; Not run |
| US-SZ-02 (Redis), SZ2-03 | `/rules` redis | G-RED-01 to 05 | Doc arithmetic OK; Not run |
| US-SZ-03 (VMware N+1), SZ3-03 | `/rules` vmware-host | G-VMW-01 to 04 | Doc arithmetic OK; Not run |
| 02 section 10 (Kafka trace), 05 section 9, AC-RB-01, PR-2 | `/rules` kafka; trace panel; `SizingStep` | G-KAF-01 to 05, G-X-03 | Doc arithmetic OK; Not run |
| SZ2-01, SZ2-03 (RDBMS, warnings) | `/rules` rdbms | G-RDB-01 to 03, P-RDB-1 to 5 | Hand results in 4.5; automated in packs.test.ts; Not run in the UI |
| SZ3-05 (SAN) | `/rules` san-storage | G-SAN-01 to 03, P-SAN-1 to 6 | Hand results in 4.6; automated in packs.test.ts; Not run in the UI |
| SZ2-01, NFR-01 (golden test per model, determinism), PR-1 | `runModelTests`; run-tests control | G-X-01, G-X-02, G-X-08 | Not run |
| SZ2-05, RB-02, AC-RB-02 (unit check) | rule editor; DSL compile | XLS-NEG-06, 06b, 14 | Not run |
| SZ2-06, RB-03, RB-05, AC-RB-01, AC-RB-05 (Excel in and out) | Excel panel; template | XLS-POS-01 to 05 | Not run |
| AC-RB-03 (unsupported function with address), RB-04 (cached values) | Excel import validator | XLS-NEG-01 to 05, 08 to 12 | Not run |
| Pilot rule: `.xlsx` only, 5 MB | Excel import endpoint | XLS-NEG-03a, 03b, 04, 04b, 04c | Not run; definition F-08 |
| Security: formula injection on export | Excel export | XLS-NEG-07 | Not run |
| SZ2-04 / save run, DS3-04 (sizing linked to a design) | save-run control; `SizingRun` | G-X-06, G-X-07, G-X-12 | Not run |
| DS6-01, TP-01 (HLD DOCX) | `/hld` | HLD-01 to 05, 07 to 09, 13 to 15, 17 | Not run |
| PR-7, KH1-04, KH-P1-15 (attribution), pins in HLD | `ReferencePin`; HLD references section | HLD-06, HLD-16, REF-03, REF-14 | Not run |
| NFR-11, KH1-03, KH-P1-07 (VI to EN search, folding) | glossary; folding; `expandedQuery` | REF-02, REF-08, REF-09 | Not run |
| AC-02, AC-03, AC-04, KH-P1-09 | `/reference`; `ReferenceHit` | REF-01 to 05 | Not run |
| AC-01 (index size), AC-08 (latency) | index status; search API | REF-00, REF-13, ENV-07 | Not run |
| KH-P1-12, PR-4 (no SysDesAi numbers in sizing) | reference and rules screens | REF-15 | Not run |
| Security: injection-safe search, HLD escaping | search API; DOCX writer | REF-06, REF-10, HLD-10 | Not run |
| PL3-01 (login), DS3-01 (canvas) | login; `/designs` | UAT-checklist sections A and B | Not run |
| Operations (pilot PC, 30 users) | Docker Desktop | ENV-01 to ENV-08 | Not run |

## 12. Step-by-step plan

| # | Step | Owner | Expected outcome |
|---|---|---|---|
| 1 | Confirm the items in section 13 (units base, `env` input, rounding, size limit, tie rule) | PO with WP-A, WP-B, WP-C leads | Written answers; this file updated |
| 2 | Add the golden vitest suite (section 9 skeleton) to the WP-A branch | WP-A dev | G-APP, G-RED, G-VMW, G-KAF automated and green on the first merge |
| 3 | Re-check the rdbms and san-storage hand results (4.5, 4.6) against the published formulas | QA (not the formula author) | G-RDB-01, G-SAN-01 confirmed, or a finding raised |
| 4 | Download the template, run `make-negative-xlsx.mjs`, run XLS cases | QA | XLS-POS and XLS-NEG results recorded |
| 5 | Build the reference design "UAT-HLD", export, run `check-hld.mjs` | QA with WP-C dev | HLD-01 to 17 recorded |
| 6 | Run `search-queries.csv` and the S-INJ set against the pilot index | QA with WP-B dev | REF-00 to 16 recorded; hit rate computed |
| 7 | Smoke the Docker Desktop PC: ENV-01 to 04, then ENV-06 | Pilot lead with devops | Persistent volume, LAN access and 30 accounts confirmed |
| 8 | Dry run of `UAT-checklist.md` by one non-technical colleague | Pilot lead | 45 minutes or less; wording fixes |
| 9 | Go/no-go meeting against Gate G1 | Pilot lead, QA, PO | Decision recorded |
| 10 | Pilot day: collect checklists and the feedback form; triage defects twice a day | QA | Defect list by severity; Gate G2 evidence |

## 13. Risks, assumptions, open questions, next handoff

**Risks.**

1. A correct engine can still fail golden cases through unit base (F-01) or floating-point `ceil` (F-02). Mitigation: decide both before testing.
2. Search quality for Vietnamese depends on the glossary, not on semantic search (no LLM in the pilot). Natural phrasing such as vi-09 may rank below 3. Mitigation: thresholds in REF-09 are proposals; extend the glossary from failed rows.
3. SQLite without a persistent volume loses all pilot data on a container restart (ENV-02).
4. Single shared account or concurrent edits give revision conflicts (ENV-04).
5. rdbms and san-storage numbers cannot be checked independently until the formulas exist; a wrong formula would be trusted. Mitigation: hand worksheet by a second person.
6. The negative Excel files are built from the app's own template, so they inherit any template bug (XLS-POS-01 must pass first).
7. Outbound access to sysdesai.com from users' browsers may be blocked by the company proxy; links would not open (REF-07, REF-04).

**Assumptions.**

1. The six model ids are `app-tier`, `rdbms`, `redis`, `kafka`, `vmware-host`, `san-storage` in pack `archpilot-core`, version 1.
2. Parameters that are not inputs (broker write capacity, utilisation, disk size, fill, shard cap, host size) are fixed in the model at the values in this file; if they are inputs, the cases still apply with those values entered.
3. The search index contains the featured, real-world and community designs listed in 03.
4. UI language defaults to Vietnamese (confirmed in `App.tsx`: initial language is `vi`).

**Open questions.**

| ID | Question | Default used here |
|---|---|---|
| Q-QA-01 | Is the unit base fixed to base 10 for the pilot (F-01)? | Yes, base 10 |
| Q-QA-02 | How is `env` represented for the Kafka warning (F-03)? | Numeric `is_prod` or warning on `rf < 3` alone |
| Q-QA-03 | What is "5 MB" (F-08)? | 5,242,880 bytes accepted, +1 byte rejected |
| Q-QA-04 | What does the trace show when two constraints tie? | All tied constraints are named |
| Q-QA-05 | Must exported text cells starting with `= + - @` carry an apostrophe prefix, or is string typing enough? | String typing is enough; prefix is a WARN |
| Q-QA-06 | Rounding of non-integer outputs such as RPS (G-APP-03)? | No rounding, 2 decimals displayed |
| Q-QA-07 | Behaviour for a macro-enabled file renamed `.xlsx` (XLS-NEG-03b)? | Reject or ignore the macro part |
| Q-QA-08 | HLD language: follows UI language or Vietnamese only (HLD-17)? | Follows UI language |
| Q-QA-09 | Which exact output names and defaults does each built-in model use? | Illustrative names in this file |
| Q-QA-10 | Do pilot users see published and draft packs, and can they delete their own? | Own packs only |

**Next handoff.** WP-A, WP-B and WP-C leads: answer Q-QA-01 to 10 and tell QA the final output names. devops-master: adopt the CI gate in section 9 and confirm the volume and firewall items (ENV-02, ENV-03). Pilot lead: run `UAT-checklist.md` after Gate G1.

---

## Appendix A. Exact-arithmetic evidence (Python 3, fractions)

Output of the verification script (floats shown for reading; the comparison used exact fractions):

```text
K1 tp_raw 7.5   tp 8  storage_tb 116.64 per_broker 8.4 sb_raw 13.8857 sb 14 brokers 14 binding storage
K2 tp_raw 8.75  tp 9  storage_tb 226.8  per_broker 8.4 sb_raw 27.0    sb 27 brokers 27 binding storage
K3 tp_raw 3.333 tp 4  storage_tb 17.28  per_broker 8.4 sb_raw 2.0571  sb 3  brokers 4  binding throughput
K4 tp_raw 0.5   tp 1  storage_tb 2.592  per_broker 8.4 sb_raw 0.3086  sb 1  brokers 3  binding min(rf)
V1 pcore 253.333 cpu_need 361.905 hc_raw 5.6548 hc 6 ram_need 2925.714 hr_raw 2.857 hr 3 base 6 total 7  CPU
V2 pcore 224     cpu_need 320     hc_raw 5.0    hc 5 ram_need 2925.714 hr_raw 2.857 hr 3 base 5 total 6  CPU
V3 pcore 140     cpu_need 200     hc_raw 3.125  hc 4 ram_need 8777.143 hr_raw 8.571 hr 9 base 9 total 10 RAM
R1 fill 0.70: data 31.5 GB, ram/copy 45,     total 90,    shards 2, ram/shard 22.5,   nodes 4
R2 fill 0.75: data 31.5 GB, ram/copy 42,     total 84,    shards 2, ram/shard 21,     nodes 4
R3 fill 0.80: data 31.5 GB, ram/copy 39.375, total 78.75, shards 2, ram/shard 19.6875, nodes 4
APP 5000/(1+9) = 500;  5000/(1+4) = 1000;  1000/(1+2) = 333.333...
ALL MATCH
```

Plain IEEE double probe (Node): `Math.ceil(226.8 / (12 * 0.7))` = 28 (the value is `27.000000000000007`); `12 * 0.7` = `8.399999999999999`. Cases K1, K3, K4, V1, V2, V3 give the right integer in plain doubles; K2 does not.

## Appendix B. Verified helper scripts

All three scripts were run against stand-in files only (see section 2, row 5). Run them from the ArchPilot repo root so that `exceljs` and `fflate` resolve.

### B1. make-negative-xlsx.mjs

Creates the negative and size-boundary files from the template downloaded from the app. Usage: `node make-negative-xlsx.mjs <template.xlsx> <outDir>`. It prints the expectation for each file.

```js
// make-negative-xlsx.mjs
// Usage (from the ArchPilot repo root, which provides exceljs and fflate):
//   node make-negative-xlsx.mjs <template.xlsx downloaded from the app> <outDir>
// Builds the negative files used by XLS-NEG-01..XLS-NEG-13 and prints what each one must trigger.
import ExcelJS from 'exceljs'
import { zipSync, unzipSync, strFromU8, strToU8 } from 'fflate'
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'

const [, , templatePath, outDir] = process.argv
if (!templatePath || !outDir) {
  console.error('usage: node make-negative-xlsx.mjs <template.xlsx> <outDir>')
  process.exit(2)
}
mkdirSync(outDir, { recursive: true })
const report = []
const note = (file, expectation) => report.push(`${file.padEnd(34)} ${expectation}`)

async function load() {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(templatePath)
  return wb
}

function firstFormulaCell(wb, sheetName = 'Calc') {
  const ws = wb.getWorksheet(sheetName)
  if (!ws) throw new Error(`template has no sheet "${sheetName}"`)
  let found = null
  ws.eachRow((row) => row.eachCell((cell) => {
    if (!found && cell.type === ExcelJS.ValueType.Formula) found = cell
  }))
  if (!found) throw new Error(`no formula cell in sheet "${sheetName}"`)
  return found
}

async function mutateFormula(file, formula, expectation) {
  const wb = await load()
  const cell = firstFormulaCell(wb)
  cell.value = { formula, result: 1 }
  await wb.xlsx.writeFile(join(outDir, file))
  note(file, `${expectation} at Calc!${cell.address}`)
}

// XLS-NEG-01 unsupported function, XLS-NEG-02 A1 reference, XLS-NEG-09 external workbook, XLS-NEG-10 undefined name
await mutateFormula('neg-01-indirect.xlsx', 'INDIRECT("Inputs!B2")', 'REJECT unsupported function INDIRECT')
await mutateFormula('neg-02-a1-reference.xlsx', 'Inputs!B2*Inputs!B3', 'REJECT A1 cell reference')
await mutateFormula('neg-09-external-workbook.xlsx', "'[other.xlsx]Sheet1'!A1", 'REJECT external workbook reference')
await mutateFormula('neg-10-undefined-name.xlsx', 'ingress*no_such_name', 'REJECT undefined name')

// XLS-NEG-05 missing cached results: every formula cell loses its stored result
{
  const wb = await load()
  let n = 0
  wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((cell) => {
    if (cell.type === ExcelJS.ValueType.Formula) {
      cell.value = { formula: cell.formula }
      n += 1
    }
  })))
  await wb.xlsx.writeFile(join(outDir, 'neg-05-no-cached-values.xlsx'))
  note('neg-05-no-cached-values.xlsx', `mode B: REFUSE auto-test, cannot publish (${n} formula cells without result)`)
}

// XLS-NEG-11 required sheet missing
{
  const wb = await load()
  const tests = wb.getWorksheet('Tests')
  if (tests) wb.removeWorksheet(tests.id)
  await wb.xlsx.writeFile(join(outDir, 'neg-11-missing-tests-sheet.xlsx'))
  note('neg-11-missing-tests-sheet.xlsx', 'REJECT missing sheet "Tests" (message names the sheet)')
}

// XLS-NEG-03 macro workbook: (a) real extension .xlsm, (b) macro content hidden behind the .xlsx extension
copyFileSync(templatePath, join(outDir, 'neg-03a-macro.xlsm'))
note('neg-03a-macro.xlsm', 'REJECT extension .xlsm (only .xlsx is accepted)')
{
  const files = unzipSync(new Uint8Array(readFileSync(templatePath)))
  const ct = strFromU8(files['[Content_Types].xml']).replace(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
    'application/vnd.ms-excel.sheet.macroEnabled.main+xml',
  )
  files['[Content_Types].xml'] = strToU8(ct)
  files['xl/vbaProject.bin'] = randomBytes(2048)
  writeFileSync(join(outDir, 'neg-03b-macro-disguised.xlsx'), zipSync(files))
  note('neg-03b-macro-disguised.xlsx', 'REJECT macro-enabled content despite .xlsx name (confirm with WP-A2: P2)')
}

// XLS-NEG-08 not a spreadsheet at all, XLS-NEG-13 empty file
writeFileSync(join(outDir, 'neg-08-not-a-zip.xlsx'), 'this is plain text, not a zip archive\n')
note('neg-08-not-a-zip.xlsx', 'REJECT cleanly (no stack trace, no 500)')
writeFileSync(join(outDir, 'neg-13-empty.xlsx'), '')
note('neg-13-empty.xlsx', 'REJECT cleanly (0 bytes)')

// XLS-NEG-04 size limit. Padding is a stored (uncompressed) zip entry, so the size is exact.
function sizedCopy(targetBytes, file, expectation) {
  const base = unzipSync(new Uint8Array(readFileSync(templatePath)))
  const build = (n) => zipSync({ ...base, 'xl/media/pad.bin': [new Uint8Array(n).map(() => 0), { level: 0 }] })
  const empty = build(0).length
  const out = build(targetBytes - empty)
  if (out.length !== targetBytes) throw new Error(`size mismatch ${out.length} != ${targetBytes}`)
  writeFileSync(join(outDir, file), out)
  note(file, `${expectation} (${targetBytes} bytes)`)
}
sizedCopy(4_000_000, 'size-4000000-bytes.xlsx', 'ACCEPT')
sizedCopy(5_000_000, 'size-5000000-bytes.xlsx', 'ACCEPT (5 MB if MB = 10^6)')
sizedCopy(5_000_001, 'size-5000001-bytes.xlsx', 'AMBIGUOUS: reject if MB = 10^6, accept if 5 MiB (see Q-QA-03)')
sizedCopy(5_242_880, 'size-5242880-bytes.xlsx', 'ACCEPT (exactly 5 MiB)')
sizedCopy(5_242_881, 'size-5242881-bytes.xlsx', 'REJECT (5 MiB + 1 byte)')
sizedCopy(6_000_000, 'size-6000000-bytes.xlsx', 'REJECT, message states the 5 MB limit')

console.log(report.join('\n'))
```

### B2. check-export-injection.mjs

Usage: `node check-export-injection.mjs <exported.xlsx> [--formula-sheets Calc] [--payload "<text>"]...`. Exit code 1 on any FAIL or MISSING.

```js
// check-export-injection.mjs
// Usage (from the ArchPilot repo root):
//   node check-export-injection.mjs <exported.xlsx> [--formula-sheets Calc] [--payload "<text planted in the app>"]...
// FAIL  = a formula cell exists in a sheet that must hold text only, or a formula uses a dangerous function.
// WARN  = a text cell starts with = + - @ TAB CR and is stored as a plain string (safe in Excel as typed text,
//         but not neutralised with a leading apostrophe; record the policy decision in Q-QA-05).
// MISSING = a planted payload text cannot be found in any cell (data silently dropped).
import ExcelJS from 'exceljs'

const args = process.argv.slice(2)
const file = args[0]
if (!file) {
  console.error('usage: node check-export-injection.mjs <exported.xlsx> [--formula-sheets Calc,Tests] [--payload TEXT]...')
  process.exit(2)
}
const sheetsArg = args.indexOf('--formula-sheets')
const formulaSheets = new Set((sheetsArg >= 0 ? args[sheetsArg + 1] : 'Calc').split(','))
const payloads = args.flatMap((a, i) => (a === '--payload' ? [args[i + 1]] : []))
const TRIGGER = /^[=+\-@\t\r]/
const DANGEROUS = /\b(HYPERLINK|WEBSERVICE|FILTERXML|INDIRECT|CALL|REGISTER|EXEC|RTD|DDE)\b|cmd\||powershell|https?:\/\//i

const wb = new ExcelJS.Workbook()
await wb.xlsx.readFile(file)
let fail = 0
let warn = 0
const seenText = []
wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((cell) => {
  const where = `${ws.name}!${cell.address}`
  if (cell.type === ExcelJS.ValueType.Formula) {
    if (!formulaSheets.has(ws.name)) { console.log(`FAIL  ${where} formula in a text sheet: =${cell.formula}`); fail += 1 }
    else if (DANGEROUS.test(cell.formula ?? '')) { console.log(`FAIL  ${where} dangerous formula: =${cell.formula}`); fail += 1 }
    return
  }
  if (typeof cell.value === 'string') {
    seenText.push(cell.value)
    if (TRIGGER.test(cell.value)) { console.log(`WARN  ${where} text starts with a trigger character, not neutralised: ${JSON.stringify(cell.value)}`); warn += 1 }
  }
})))
for (const p of payloads) {
  const bare = (t) => t.replace(/^'/, '')
  if (!seenText.some((t) => bare(t) === p || bare(t).includes(p))) { console.log(`MISSING payload not found as text: ${JSON.stringify(p)}`); fail += 1 }
}
console.log(`${file}: ${fail} FAIL, ${warn} WARN, ${seenText.length} text cells scanned`)
process.exit(fail ? 1 : 0)
```

### B3. check-hld.mjs

Usage: `node check-hld.mjs <HLD.docx> [--heading T]... [--text T]... [--absent T]... [--link URL]...`. Exit code 1 when any check fails.

```js
// check-hld.mjs
// Usage (from the ArchPilot repo root, which provides fflate):
//   node check-hld.mjs <HLD.docx> [--heading TEXT]... [--text TEXT]... [--absent TEXT]... [--link URL]...
// Reads word/document.xml and word/_rels/document.xml.rels. Exit code 1 when any check fails.
import { unzipSync, strFromU8 } from 'fflate'
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const file = args[0]
if (!file) {
  console.error('usage: node check-hld.mjs <file.docx> [--heading T]... [--text T]... [--absent T]... [--link URL]...')
  process.exit(2)
}
const all = (flag) => args.flatMap((a, i) => (a === flag ? [args[i + 1]] : []))
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

const zip = unzipSync(new Uint8Array(readFileSync(file)))
const need = ['[Content_Types].xml', 'word/document.xml']
const results = []
const check = (ok, label) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`) }
for (const part of need) check(part in zip, `package contains ${part}`)
if (!need.every((p) => p in zip)) process.exit(1)

const xml = strFromU8(zip['word/document.xml'])
const rels = 'word/_rels/document.xml.rels' in zip ? strFromU8(zip['word/_rels/document.xml.rels']) : ''
const paragraphs = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((m) => {
  const p = m[0]
  const style = /<w:pStyle w:val="([^"]+)"/.exec(p)?.[1] ?? ''
  const text = decode([...p.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)].map((t) => t[1]).join(''))
  return { style, text }
})
const fullText = paragraphs.map((p) => p.text).join('\n')
const headings = paragraphs.filter((p) => /^Heading\d|^Title$|^heading/i.test(p.style))
const targets = new Map([...rels.matchAll(/<Relationship [^>]*>/g)].map((m) => {
  const r = m[0]
  return [/Id="([^"]+)"/.exec(r)?.[1], { type: /Type="([^"]+)"/.exec(r)?.[1] ?? '', target: decode(/Target="([^"]*)"/.exec(r)?.[1] ?? ''), mode: /TargetMode="([^"]+)"/.exec(r)?.[1] ?? '' }]
}))
const links = [...xml.matchAll(/<w:hyperlink [^>]*r:id="([^"]+)"[^>]*>([\s\S]*?)<\/w:hyperlink>/g)].map((m) => ({
  target: targets.get(m[1])?.target ?? '(missing relationship)',
  external: targets.get(m[1])?.mode === 'External',
  text: decode([...m[2].matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)].map((t) => t[1]).join('')),
}))

console.log(`info  ${paragraphs.length} paragraphs, ${headings.length} headings, ${links.length} hyperlinks`)
check(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(xml), 'document.xml has no XML-invalid control characters')
check(!/undefined|\bNaN\b|\[object Object\]|Infinity/.test(fullText), 'no undefined / NaN / [object Object] / Infinity in the text')
check(!/\d\.\d{6,}/.test(fullText), 'no number printed with 6+ decimals (floating-point noise)')
check(links.every((l) => l.external && /^https:\/\//.test(l.target)), 'every hyperlink is an external https link')
for (const h of all('--heading')) check(headings.some((x) => x.text.includes(h)), `heading contains "${h}"`)
for (const t of all('--text')) check(fullText.includes(t), `text contains "${t}"`)
for (const t of all('--absent')) check(!fullText.includes(t), `text does NOT contain "${t}"`)
for (const u of all('--link')) {
  const hit = links.find((l) => l.target === u)
  check(Boolean(hit), `hyperlink to ${u}${hit ? ` (link text: "${hit.text}")` : ''}`)
}
process.exit(results.every(Boolean) ? 0 : 1)
```

## Appendix C. Skeletons that were not run

### C1. Search regression over `search-queries.csv` (pytest + httpx; API path and login shape to confirm)

```python
import csv, os, pathlib, unicodedata, httpx, pytest

BASE = os.environ.get("ARCHPILOT_URL", "http://127.0.0.1:8080")
ROWS = list(csv.DictReader(open(pathlib.Path("docs/v3/pilot/search-queries.csv"), encoding="utf-8", newline="")))

@pytest.fixture(scope="session")
def client():
    c = httpx.Client(base_url=BASE, timeout=10)
    r = c.post("/api/auth/login", json={"username": os.environ["QA_USER"], "password": os.environ["QA_PASSWORD"]})
    r.raise_for_status()
    return c

def rank(client, query, share_id):
    r = client.get("/api/reference/search", params={"q": query})  # path to confirm with WP-B
    assert r.status_code == 200
    ids = [h["shareId"] for h in r.json()["items"]]
    return (ids.index(share_id) + 1) if share_id in ids else None

@pytest.mark.parametrize("row", ROWS, ids=[r["id"] for r in ROWS])
def test_expected_design_in_top3(client, row):
    got = rank(client, row["query"], row["expected_share_id"])
    limit = 1 if "pass=rank 1" in row["notes"] else (5 if "pass=top5" in row["notes"] else 3)
    assert got is not None and got <= limit, f'{row["id"]}: rank {got}, limit {limit}'

def fold(s):  # REF-08 variant: strip marks, map d-stroke by hand
    s = s.replace("đ", "d").replace("Đ", "D")
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")

@pytest.mark.parametrize("row", [r for r in ROWS if r["language"] == "vi"], ids=lambda r: r["id"])
def test_folded_query_gives_same_top3(client, row):
    a = [h["shareId"] for h in client.get("/api/reference/search", params={"q": row["query"]}).json()["items"][:3]]
    b = [h["shareId"] for h in client.get("/api/reference/search", params={"q": fold(row["query"])}).json()["items"][:3]]
    assert a == b
```

### C2. Server-side check of the `.xlsm` and size rules (XLS-NEG-03a, 04), path to confirm with WP-A2

```bash
curl -i -b cookies.txt -H "x-csrf-token: $TOKEN" -F "file=@neg-03a-macro.xlsm;type=application/vnd.ms-excel.sheet.macroEnabled.12" http://127.0.0.1:8080/api/rule-packs/import
curl -i -b cookies.txt -H "x-csrf-token: $TOKEN" -F "file=@size-6000000-bytes.xlsx" http://127.0.0.1:8080/api/rule-packs/import
# expected: 4xx with a JSON error body, never 500, and the rule-pack list is unchanged afterwards
```

### C3. Load smoke (k6, thresholds from ENV-07; path to confirm)

```js
import http from 'k6/http'
import { check, sleep } from 'k6'
export const options = {
  vus: 30, duration: '10m',
  thresholds: { http_req_failed: ['rate<0.01'], 'http_req_duration{kind:search}': ['p(95)<2000'] },
}
const queries = ['URL shortener', 'rate limiter', 'bộ nhớ đệm cho chuyển hướng link rút gọn']
export default function () {
  const q = queries[Math.floor(Math.random() * queries.length)]
  const r = http.get(`${__ENV.BASE}/api/reference/search?q=${encodeURIComponent(q)}`, { tags: { kind: 'search' }, headers: { Cookie: __ENV.COOKIE } })
  check(r, { 'status 200': (x) => x.status === 200 })
  sleep(10)
}
```

## Known pilot limitations

Read these before the usability evaluation; do not log them as new defects.

1. **No version history for rule packs.** `PUT /api/rule-packs/{id}` replaces the pack and bumps `version`; the previous version is not kept. A saved run that cites `v2` after the pack moved to `v3` cannot be re-run on `v2`; its stored inputs, trace and outputs stay readable.
2. **DSL subset.** Unit literals (`150 MB/s` inside a formula), `switch(...)` and `catalog(...)` from 05 section 3 are not supported. A quantity with a unit must come from an input or a param; use `if()` and `lookup()` instead of `switch()`; enter catalog figures as params.
3. **Reference reload locks the database briefly.** Loading a new SysDesAi snapshot (`crawl-reference.ps1`, or a restart that loads one) holds the SQLite write lock for a short time, so saves can stall or fail meanwhile. Do not run crawls or reloads during evaluation sessions.

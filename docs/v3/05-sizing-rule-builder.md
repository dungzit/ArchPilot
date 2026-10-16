# ArchSizer — Spec Sizing Rule Builder và Excel Import

| Field | Value |
|---|---|
| Tài liệu | 05 — Spec rule builder |
| Ngày | 2026-10-14 |
| Quyết định gốc | Q-05 (2026-10-14): "Thiết kế cần cho phép import Excel rule hoặc tạo sizing rule theo nhu cầu" |
| Ảnh hưởng | SZ2-05 và SZ2-06 trong 02-requirements được nâng lên **Must · MVP**. Đây là nền móng: mọi sizing model, kể cả model built-in, đều được biểu diễn bằng cùng một định dạng rule. |

## 1. Nguyên tắc

1. **Rule là dữ liệu, không phải code.** Model built-in và model do người dùng tạo dùng chung một định dạng, chung một evaluator, chung một cách kiểm thử.
2. **Tất định và an toàn.** Ngôn ngữ công thức không có vòng lặp, không I/O, không gọi mạng. Cùng input và cùng version luôn cho cùng output.
3. **Có kiểm tra đơn vị.** Mỗi giá trị mang theo đơn vị; cộng GB với GB/s thì báo lỗi. Mục đích là chặn đúng loại lỗi SysDesAi mắc phải (nhầm TB với PB, xem 01-research §4.1).
4. **Không publish nếu chưa có test.** Rule chỉ được publish khi toàn bộ test case pass.
5. **Excel vào và ra không mất thông tin.** Import từ Excel, export lại ra Excel mà vẫn giữ công thức.

## 2. Khái niệm

```
RulePack (bộ rule: owner, phạm vi org/team/project, version, trạng thái)
 └─ SizingModel (gắn với component type, ví dụ "kafka", "redis", "vmware-host")
     ├─ Inputs     tên, nhãn VI/EN, kiểu, đơn vị, mặc định, min/max, nguồn
     ├─ Params     hằng số tham chiếu catalog, ví dụ catalog("kafka.broker_write_mbps")
     ├─ Calc       các bước tính có tên, theo thứ tự; mỗi bước là một biểu thức
     ├─ Outputs    giá trị đầu ra, đơn vị, cách làm tròn
     ├─ Constraints  nhiều ứng viên → max/min, và ghi lại ràng buộc nào quyết định
     ├─ Warnings   điều kiện → mức độ → thông điệp VI/EN
     ├─ Lookups    bảng tra cứu, ví dụ hệ số RAID, overhead theo loại DB
     └─ Tests      input → output kỳ vọng, có dung sai
```

## 3. Ngôn ngữ công thức (DSL)

| Nhóm | Hỗ trợ |
|---|---|
| Toán tử | `+ - * / ^`, so sánh, `and or not` |
| Hàm số học | `ceil, floor, round(x, n), roundup_to(x, step), min, max, sum, avg, abs` |
| Điều kiện | `if(cond, a, b)`, `switch(key, …)` |
| Tra cứu | `lookup(table, key, column)`, `catalog("path")` (đọc catalog đã duyệt, đúng version dự án đã ghim) |
| Đơn vị | Literal có đơn vị (`150 MB/s`, `3 day`), `convert(x, "TiB")`; kiểm tra thứ nguyên khi compile |
| Cấm | Vòng lặp, đệ quy, I/O, thời gian thực, số ngẫu nhiên |

## 4. Định dạng Excel template (import và export)

| Sheet | Nội dung | Cột chính |
|---|---|---|
| `Model` | Metadata | id, name_vi, name_en, component_type, version, owner, mô tả |
| `Inputs` | Biến đầu vào | name, label_vi, label_en, unit, default, min, max, source |
| `Params` | Hằng số | name, value hoặc `catalog:path`, unit, source/citation |
| `Calc` | Các bước tính | name, formula (công thức Excel tham chiếu named range), unit, mô tả |
| `Outputs` | Đầu ra | name, from_calc, unit, rounding |
| `Warnings` | Cảnh báo | condition, severity, message_vi, message_en |
| `Lookups` | Bảng tra | Mỗi bảng là một vùng có tên |
| `Tests` | Test case | test_id, input=value…, expected output=value…, tolerance |

**Hàm Excel được hỗ trợ khi import:** `+ - * / ^`, `ROUND, ROUNDUP, ROUNDDOWN, CEILING, FLOOR, MAX, MIN, SUM, AVERAGE, IF, IFS, AND, OR, NOT, VLOOKUP, XLOOKUP, INDEX/MATCH` (chỉ tham chiếu sheet `Lookups`), và named range. Gặp hàm ngoài danh sách thì báo lỗi kèm địa chỉ ô, không âm thầm bỏ qua.

## 5. Hai chế độ import

| Chế độ | Dùng khi | Cách hoạt động |
|---|---|---|
| **A. Template** | File làm theo template ở §4 | Dịch trực tiếp sang DSL, độ chính xác 100%. Chạy sheet `Tests` ngay khi import. |
| **B. Excel có sẵn** (file sizing riêng của công ty) | File tự do, không theo template | 1) Parser liệt kê ô input, ô công thức và đồ thị phụ thuộc giữa các ô. 2) AI (nếu dự án cho phép) đề xuất cách ánh xạ sang Inputs/Calc/Outputs. 3) Người dùng xác nhận. 4) **Tự sinh test từ giá trị đã tính sẵn trong file xlsx** (file Excel lưu cả kết quả lần tính gần nhất), nên bản dịch phải ra đúng số như file gốc mới được chấp nhận. |

Chế độ B giải quyết đúng nhu cầu "đã có Excel sizing nội bộ". Bằng chứng bản dịch đúng chính là việc tái tạo lại đúng các con số của file gốc.

## 6. Rule builder UI (tạo rule theo nhu cầu)

- Form khai báo Inputs, Params, Calc, Outputs, Warnings; trình soạn công thức có autocomplete tên biến và hàm, báo lỗi đơn vị ngay khi gõ.
- **Xem trước trực tiếp:** nhập giá trị thử, xem từng bước tính với số đã thay vào (cùng kiểu trace như phụ lục §10 của 02).
- Clone một model built-in làm điểm xuất phát.
- So sánh 2 version: thay đổi công thức, và chênh lệch kết quả trên bộ test.

## 7. Quản trị vòng đời

`Draft → Testing (mọi test pass, mỗi output có ≥ 1 test) → In review → Published → Deprecated`

- Quyền: Architect tạo và sửa; Reviewer hoặc Chief Architect duyệt publish; Admin quản lý phạm vi org.
- Dự án ghim version rule pack. Muốn nâng version thì hệ thống hiển thị trước kết quả thay đổi thế nào.
- Mọi lần publish được ghi audit log.

## 8. Yêu cầu

| ID | Yêu cầu | Ưu tiên | Release |
|---|---|---|---|
| RB-01 | Định dạng rule thống nhất (§2) cho cả model built-in và model tùy chỉnh | M | MVP |
| RB-02 | DSL tất định, có kiểm tra đơn vị (§3) | M | MVP |
| RB-03 | Import Excel theo template, chế độ A (§4, §5) | M | MVP |
| RB-04 | Import Excel có sẵn, chế độ B, có tự sinh test từ giá trị đã tính sẵn | S | MVP |
| RB-05 | Export rule pack ra Excel, giữ nguyên công thức | M | MVP |
| RB-06 | Rule builder UI và xem trước trực tiếp (§6) | M | MVP |
| RB-07 | Vòng đời, phân quyền, ghim version, xem trước tác động khi nâng version (§7) | M | MVP |
| RB-08 | Thư viện rule pack mẫu: Kafka, Redis, Elasticsearch, RDBMS, VMware host, SAN, K8s | M | MVP |
| RB-09 | Rule pack có phạm vi (org / team / project), cho phép override ở phạm vi hẹp hơn | S | v1.1 |

## 9. Ví dụ: model Kafka theo template

**Inputs:** `ingress = 150 MB/s` · `rf = 3` · `retention = 3 day`

**Params:** `broker_write = catalog("kafka.broker_write_mbps") = 100 MB/s` · `target_util = 0.6` · `disk_per_broker = 12 TB` · `disk_fill = 0.7`

**Calc:**

| name | formula | kết quả |
|---|---|---|
| tp_brokers | `ceil(ingress * rf / broker_write / target_util)` | ceil(7.5) = 8 |
| storage | `convert(ingress * retention * rf, "TB")` | 116.64 TB |
| storage_brokers | `ceil(storage / (disk_per_broker * disk_fill))` | ceil(13.9) = 14 |
| brokers | `max(tp_brokers, storage_brokers, rf)` | **14**, ràng buộc quyết định là storage |

**Warnings:** `rf < 3 and env == "prod"` → mức High: "Replication factor < 3 ở môi trường Prod".

**Tests:** `T1: ingress=150, rf=3, retention=3 → brokers=14, storage=116.64 TB (dung sai 0.01)`.

## 10. Tiêu chí nghiệm thu

| ID | Given / When / Then |
|---|---|
| AC-RB-01 | **Given** file template Kafka ở §9, **when** import, **then** model được tạo, test T1 pass, và trace hiển thị đúng 4 bước kèm ràng buộc quyết định. |
| AC-RB-02 | **Given** một công thức cộng `MB/s` với `TB`, **then** compile báo lỗi đơn vị, chỉ rõ tên bước. |
| AC-RB-03 | **Given** file Excel có hàm `INDIRECT`, **then** import báo "hàm không hỗ trợ" kèm địa chỉ ô, và không tạo model dở dang. |
| AC-RB-04 | **Given** một file Excel sizing nội bộ (chế độ B), **when** người dùng xác nhận ánh xạ, **then** mọi output tái tạo đúng giá trị đã tính sẵn trong file (dung sai 1e-9 tương đối), nếu không thì không cho publish. |
| AC-RB-05 | Import rồi export lại ra Excel: mở trong Excel, các công thức tính ra đúng như kết quả trong app. |
| AC-RB-06 | Rule ở trạng thái Draft hoặc có test fail thì không publish được; dự án đang ghim v1 không bị ảnh hưởng khi v2 được publish. |

# ArchSizer — Đề xuất template HLD và cơ chế template

| Field | Value |
|---|---|
| Tài liệu | 06 — Template HLD mẫu |
| Ngày | 2026-10-14 |
| Quyết định gốc | Q-06 (2026-10-14): "Để mở để tôi upload/import sau, hoặc bạn đề xuất template mẫu" |
| Cách làm | ArchSizer có sẵn **template built-in** (dưới đây) để dùng ngay. Sau này công ty upload template DOCX riêng có placeholder để thay thế. |

## 1. Cấu trúc HLD đề xuất

Cột "Nguồn" cho biết nội dung lấy từ đâu:
- **A (Auto):** sinh hoàn toàn từ design model.
- **S (Semi):** AI viết nháp từ model, người dùng sửa lại.
- **M (Manual):** người dùng tự viết; nội dung lưu trong app nên không mất khi sinh lại tài liệu.

| # | Mục | Nội dung | Nguồn |
|---|---|---|---|
| 0 | Thông tin tài liệu | Tên dự án, khách hàng, version, người lập, người duyệt, lịch sử thay đổi | A |
| 1 | Giới thiệu | Mục đích, phạm vi, thuật ngữ, tài liệu tham chiếu (RFP/TOR) | S |
| 2 | Yêu cầu và ràng buộc | 2.1 Tổng quan nghiệp vụ (S) · 2.2 Yêu cầu chức năng tóm tắt (A, từ requirement register) · 2.3 Yêu cầu phi chức năng: SLA, RPO/RTO, bảo mật, tuân thủ (A) · 2.4 Ràng buộc (A) · **2.5 Giả định** (A, từ assumption register, kèm nguồn và mức tin cậy) | A/S |
| 3 | Kiến trúc tổng thể | 3.1 Nguyên tắc thiết kế (S) · 3.2 Sơ đồ logic C4 context/container (A) · 3.3 Mô tả thành phần (S) · **3.4 Các phương án đã cân nhắc và quyết định (A, từ ADR)** | A/S |
| 4 | Kiến trúc triển khai | 4.1 Sơ đồ triển khai theo site/zone (A) · 4.2 Các môi trường Prod/DR/UAT/Dev (A) · 4.3 Phân vùng mạng và security zone (A/S) · 4.4 Luồng dữ liệu chính (A, sequence) | A/S |
| 5 | Tính sẵn sàng và DR | Topology, cơ chế replication, RPO/RTO đạt được so với yêu cầu, kịch bản failover | A/S |
| 6 | Sizing | 6.1 Giả định workload (A) · 6.2 Phương pháp, version rule pack (A) · 6.3 Kết quả theo component và môi trường (A) · 6.4 Kịch bản tăng trưởng, N-1, DR (A) · 6.5 Headroom (A). Chi tiết ở Phụ lục A | A |
| 7 | Hạ tầng và BOM cấu hình | Tóm tắt compute, storage, network, software/license. Chi tiết ở Phụ lục B | A |
| 8 | Bảo mật | IAM, mã hóa, network security, logging/audit, tuân thủ | S/M |
| 9 | Vận hành | Monitoring, backup, patching, quản lý capacity | S/M |
| 10 | Rủi ro | Risk register, failure modes, các finding lint đã chấp nhận kèm lý do | A/S |
| 11 | Kế hoạch triển khai | Các giai đoạn và mốc (tùy chọn) | M |
| PL-A | Sizing chi tiết | Trace đầy đủ từng con số: công thức, input, nguồn | A |
| PL-B | BOM cấu hình chi tiết | Theo vendor hoặc spec trung lập | A |
| PL-C | Câu hỏi làm rõ | Các câu đang mở hoặc đã trả lời | A |
| PL-D | Tham chiếu | Pattern, các design SysDesAi đã ghim (link và nguồn) | A |

## 2. Gói đề xuất kèm theo HLD (Proposal pack)

| File | Nội dung |
|---|---|
| `HLD_<dự án>_v<x>.docx` | Theo cấu trúc ở §1 |
| `Sizing_<dự án>_v<x>.xlsx` | Workbook giữ nguyên công thức, mỗi tầng một sheet |
| `BOM_<dự án>_v<x>.xlsx` | BOM cấu hình |
| `Diagrams/` | Sơ đồ PNG và SVG |
| `Assumptions_Questions.xlsx` | Giả định và câu hỏi làm rõ |

## 3. Cơ chế template

| ID | Yêu cầu | Ưu tiên | Release |
|---|---|---|---|
| TP-01 | Template HLD built-in theo §1, có bản VI và EN | M | MVP |
| TP-02 | Upload template DOCX của công ty có placeholder (ví dụ `{{project.name}}`, `{{#components}}…{{/components}}`, `{{diagram:logical}}`, `{{table:bom}}`). Hệ thống kiểm tra placeholder và báo placeholder không hợp lệ | M | MVP |
| TP-03 | Bật/tắt từng mục; đổi thứ tự mục | S | MVP |
| TP-04 | Ánh xạ style (Heading 1–3, style bảng, caption, mục lục) theo file template | M | MVP |
| TP-05 | Nội dung Manual và Semi lưu trong app; sinh lại tài liệu không làm mất phần đã sửa | M | MVP |
| TP-06 | Template có version; ghi rõ template version nào đã dùng cho tài liệu nào | S | MVP |
| TP-07 | Template cho Proposal/Technical response (ngoài HLD), dùng chung cơ chế | S | v1.1 |

## 4. Việc PO làm khi có template công ty

Upload file DOCX → gắn placeholder theo danh sách biến (hệ thống cung cấp sẵn tài liệu danh sách biến) → chạy thử với dự án mẫu → publish template.

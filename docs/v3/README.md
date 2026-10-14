# ArchPilot v3: Sizing Studio (trước đây tên tạm ArchSizer)

Nền tảng **Sizing · Design · Knowledge Hub** cho hệ thống IT, dành cho Presales/Solution Architect làm RFP và team kiến trúc nội bộ doanh nghiệp. Ý tưởng tham chiếu từ [SysDesAi](https://www.sysdesai.com/). Điểm khác biệt chính là **sizing do engine tất định tính toán** (không để LLM tự đưa ra con số), **rule sizing tự định nghĩa hoặc import từ Excel**, và đi tới **BOM cấu hình** cho on-prem, cloud (AWS, Azure, Viettel, FPT), K8s và hybrid.

**Trạng thái:** Requirement v0.3. Đã hợp nhất vào ArchPilot (phương án C). Pilot đang được build trên nhánh `pilot/v1` để dùng sáng 2026-10-15. Phạm vi pilot xem 02 §12.3.

## Tài liệu

| File | Nội dung |
|---|---|
| [01-research-sysdesai.md](01-research-sysdesai.md) | Khảo sát SysDesAi: các module, cấu trúc 15 bước của một design, **các lỗi sizing đã kiểm chứng** |
| [02-requirements.md](02-requirements.md) | **Bộ requirement tổng thể v0.2**: personas, nguyên tắc, luồng nghiệp vụ, epic (Sizing / Design / Knowledge / Platform), NFR, data model, lộ trình, quyết định và câu hỏi còn mở |
| [03-kh-phase1-sysdesai-reference-search.md](03-kh-phase1-sysdesai-reference-search.md) | Spec Knowledge Hub **phase 1**: tìm kiếm tham chiếu trên SysDesAi Gallery, trả về link design và bước cụ thể |
| [04-knowledge-sources-phase2.md](04-knowledge-sources-phase2.md) | Danh sách nguồn blog public cho **phase 2**, đã kiểm tra feed thật |
| [05-sizing-rule-builder.md](05-sizing-rule-builder.md) | Spec **rule builder và import rule từ Excel**: DSL có kiểm tra đơn vị, template Excel, 2 chế độ import, vòng đời và test |
| [06-hld-template-proposal.md](06-hld-template-proposal.md) | **Template HLD đề xuất** và cơ chế upload template DOCX của công ty |
| [07-archpilot-vs-archsizer-assessment.md](07-archpilot-vs-archsizer-assessment.md) | Đánh giá ArchPilot (đã chạy test) và **khuyến nghị hợp nhất**, kèm 6 xung đột cần PO quyết |

## Nhật ký quyết định

| Ngày | Quyết định |
|---|---|
| 2026-10-08 | Người dùng chính: (a) Presales/SA làm sizing cho RFP; (b) team kiến trúc nội bộ doanh nghiệp |
| 2026-10-08 | Phạm vi hạ tầng: public cloud, on-prem (VMware, bare-metal, SAN), K8s, hybrid |
| 2026-10-08 | Độ sâu sizing: node / vCPU / RAM / storage, đến **BOM cấu hình** (v1 chưa có giá) |
| 2026-10-08 | Triển khai: v1 cài nội bộ, sẵn sàng chạy trên public cloud; dùng LLM trên cloud |
| 2026-10-12 | Knowledge: ưu tiên blog public (Backend/System Design, Open Compute, Cloud Native, Medium); Facebook và LinkedIn để sau |
| 2026-10-13 | **Knowledge Hub phase 1 = tra cứu trên SysDesAi Gallery**, trả về link cụ thể |
| 2026-10-14 | Q-01: không cần xin phép SysDesAi; dùng như công cụ tra cứu, vẫn ghi nguồn |
| 2026-10-14 | Q-02: LLM dùng Microsoft (Azure OpenAI / Foundry) và AWS Bedrock |
| 2026-10-14 | Q-03: BOM ưu tiên top 3 vendor; spec trung lập phải đáp ứng được cả top 3 |
| 2026-10-14 | Q-04: Cloud đích là AWS, Azure, Viettel Cloud, FPT Cloud |
| 2026-10-14 | Q-05: Cho phép import rule từ Excel hoặc tự tạo rule sizing |
| 2026-10-14 | Q-06: Dùng template HLD đề xuất; PO upload template công ty sau |
| 2026-10-14 | Q-07: Hạ tầng cài đặt nội bộ là VMware |
| 2026-10-14 | Q-08: PO giao đánh giá. Khuyến nghị hợp nhất với ArchPilot thành v3, **chờ PO xác nhận (Q-09)** |
| 2026-10-14 | Q-09: **Hợp nhất với ArchPilot theo phương án C**; áp dụng hướng xử lý X-1 đến X-6, không cần ký riêng |
| 2026-10-14 | Q-10: Loại yêu cầu ẩn danh / tắt AI cho RFP có NDA (xem lại sau v1.1) |
| 2026-10-14 | Q-11: Quy mô v1 là 30 user, 3 người dùng đồng thời |
| 2026-10-14 | Q-12: Tên sản phẩm **ArchPilot**; module sizing mới là **Sizing Studio** |
| 2026-10-14 | Pilot sáng 2026-10-15, bắt buộc: Tra cứu SysDesAi, Sizing rule + import Excel, Xuất HLD DOCX. Không AI. Chạy bằng Docker Desktop trên PC |

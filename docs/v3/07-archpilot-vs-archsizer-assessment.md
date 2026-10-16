# ArchSizer — Đánh giá quan hệ với ArchPilot và phương án đề xuất (Q-08)

| Field | Value |
|---|---|
| Tài liệu | 07 — Đánh giá và khuyến nghị |
| Ngày | 2026-10-14 |
| Câu hỏi | Q-08: giữ ArchSizer là dự án độc lập, hay đưa vào làm module của ArchPilot? |
| Cơ sở | Đã đọc `ArchPilot/README.md`, `01-product-charter.md`, `docs/requirements-v2.md` v2.1, `docs/pattern-content-policy.md`; xem cấu trúc code; **chạy test thực tế ngày 2026-10-14** |

## 1. Khuyến nghị (tóm tắt)

**Gộp thành một sản phẩm trên codebase ArchPilot. ArchSizer trở thành định vị và lộ trình kế tiếp (v3) của ArchPilot, chứ không phải dự án mới.**

Lý do chính:
1. **Khoảng 70% phạm vi trùng nhau:** design canvas, sizing có công thức và trích dẫn, catalog, knowledge hub, chạy on-prem, giao diện VI/EN. ArchPilot đã build và test xong phần lõi này. Viết lại từ đầu là lãng phí.
2. **Nguyên tắc cốt lõi giống nhau.** ArchPilot đã làm đúng tinh thần "AI đề xuất, engine tính" của ArchSizer: sizing tất định, công thức hiển thị kèm số đã thay vào, khoảng tin cậy theo nguồn benchmark.
3. **Cùng một PO, nguồn lực nhỏ.** Bản thân ArchPilot đã ghi nhận lịch 9 tuần không còn khả thi vì phạm vi phình to (C-3). Chạy song song 2 sản phẩm sẽ chia đôi nguồn lực vốn đã thiếu.
4. **Các xung đột đều là quyết định chính sách, không phải giới hạn kỹ thuật.** Có thể giải quyết bằng cách PO ghi nhận quyết định mới thay thế quyết định cũ, cộng với cờ cấu hình (xem §4).

## 2. Thực trạng ArchPilot (kiểm chứng ngày 2026-10-14)

| Hạng mục | Thực trạng |
|---|---|
| Repo | Git, 7 commit; commit gần nhất: "Phase 0 of v2: contract v2, neutral component catalogue, graph core, integrity checks, router" |
| Code | Khoảng 21,600 dòng TS/Python. Frontend React/TS (Vite), backend FastAPI, CI GitHub Actions, Dockerfile |
| Test | **Frontend: 37 file, 963 test pass. Backend: khoảng 384 test pass (exit 0)** |
| Đã build | Graph core và contract `archgraph.schema.json` v2 (có kiểm tra toàn vẹn chéo TS/Python), catalogue component trung lập, canvas (containers, edges, inspector, undo, xử lý xung đột khi lưu, chế độ offline), **sizing engine tất định** (công thức hiển thị số đã thay vào, khoảng tin cậy ±10/25/50/100% theo nguồn benchmark), API benchmark có trích dẫn, workspaces/designs API, đăng nhập local, content hash và legal review gate cho pattern, khung IaC (Terraform core, adapter AWS và vSphere) |
| Đang làm hoặc chưa làm | Wizard theo rule, knowledge hub (12 pattern tự viết), learning, sinh IaC hoàn chỉnh, TCO/ROI (mới có bản nháp calculator) |

## 3. So sánh phạm vi

| Năng lực | ArchPilot v2.1 | ArchSizer v0.1 | Đánh giá |
|---|---|---|---|
| Canvas và graph trung lập nền tảng | ✅ Đã build | Cần (DS3) | **Tái sử dụng nguyên vẹn** |
| Lớp đích triển khai (AWS, vSphere, K8s…) | ✅ Thiết kế, đang build | Cần (SZ3) | Tái sử dụng, mở rộng thêm Azure, Viettel, FPT |
| Sizing tất định có công thức và trích dẫn | ✅ Engine v2.0 | Cần (SZ1–SZ2) | **Tái sử dụng**, mở rộng thêm model và rule builder |
| Sizing hạ tầng vật lý (IOPS, host, SAN, rack) | ❌ Để sau (C-14, REQ-SIZ-014) | **Lõi MVP** (SZ3) | Phần mới chính của ArchSizer |
| Chọn instance/hardware, BOM | ❌ Cấm (REQ-SIZ-013) | **Lõi MVP** (SZ4) | Xung đột, cần sửa REQ-SIZ-013 |
| Excel rule import, rule builder | ❌ | **MVP (Q-05)** | Phần mới |
| LLM (copilot, trích xuất RFP, RAG) | ❌ **Không dùng LLM** (quyết định 5/6) | Có (Azure, Bedrock) | **Xung đột chính sách** |
| Knowledge hub | Pattern tự viết; **cấm crawl SysDesAi** (REQ-KH-017, policy đã duyệt) | Phase 1 **index SysDesAi** | **Xung đột chính sách** |
| Người dùng, xác thực | 2–4 người, auth local, **không có SSO** | Presales và enterprise, SSO/RBAC, khoảng 300 người | Xung đột quy mô |
| IaC Terraform | ✅ Trụ cột v1 | Ngoài phạm vi v1 | Giữ như module có sẵn, không nằm trên critical path |
| Learning | Trụ cột v1 | Không làm | Hạ ưu tiên |
| TCO/ROI | Bản nháp calculator | v2 (giá) | Khớp với v2 của ArchSizer |
| Triển khai | Docker on-prem | VMware (Q-07) | Tương thích: Docker chạy trên VM |

## 4. Xung đột và cách giải quyết (PO cần xác nhận)

| # | Quyết định cũ của ArchPilot | Quyết định mới (ArchSizer) | Đề xuất giải quyết |
|---|---|---|---|
| X-1 | Không dùng LLM | Dùng LLM qua Azure (Microsoft) và AWS Bedrock | LLM trở thành **cờ cấu hình theo deployment và theo dự án**. Chế độ "no-LLM" của ArchPilot được giữ lại dưới dạng chính sách "tắt AI" (PL2-03). Đây cũng chính là lời giải cho RFP có NDA. |
| X-2 | REQ-KH-017: cấm crawl hoặc lưu nội dung SysDesAi | Phase 1 index SysDesAi để tra cứu | Nâng `pattern-content-policy.md` lên v0.2 và tách 2 loại nội dung: **(a) Pattern tự viết**: giữ nguyên quy trình 5 bước tự chứng nhận; **(b) Tham chiếu ngoài** (SysDesAi): chỉ dùng để tìm kiếm, hiển thị trích đoạn ngắn kèm link, ghi nguồn, gắn nhãn AI-generated, không tái xuất bản, không dùng số liệu. PO ký lại gate G0.2. |
| X-3 | REQ-SIZ-013: sizing không chọn instance/hardware | BOM cấu hình | Sửa thành: "Engine **đề xuất** instance/hardware từ catalog đã curate, người dùng xác nhận hoặc đổi. Không tính giá trong v1." |
| X-4 | 2–4 người, không SSO | Presales và enterprise, SSO/RBAC | Thêm SSO (OIDC/SAML/LDAP) và RBAC theo workspace. Backend đã có phần users và security làm nền. |
| X-5 | Quyết định D3: chỉ tính sizing trong TypeScript ở client | Rule import từ Excel, xuất XLSX/BOM ở server | **Rule là dữ liệu (DSL)**, chỉ có 1 bộ evaluator viết bằng TypeScript, chạy ở client và trong một Node worker phía server cho export. Giữ đúng tinh thần D3 là "một implementation". Kiểm chứng bằng golden vectors chạy chéo, giống cách `hash.vectors.test` đang làm. |
| X-6 | Persona: kỹ sư nội bộ (Emma, Tom…) | Presales và enterprise architect | Thêm persona P1 Presales. Giữ các persona cũ. |

## 5. Ba phương án đã cân nhắc

| Tiêu chí | A. Độc lập hoàn toàn | B. ArchSizer là module trong ArchPilot, giữ nguyên định vị ArchPilot | **C. Hợp nhất: ArchPilot v3 theo định vị ArchSizer (khuyến nghị)** |
|---|---|---|---|
| Tái sử dụng khoảng 21.6k LOC đã test | ❌ Viết lại hoặc copy rồi phân kỳ | ✅ | ✅ |
| Rõ ràng về định vị sản phẩm | ✅ | ⚠️ Hai câu chuyện chồng nhau (IaC/learning so với sizing/BOM) | ✅ Một định vị: sizing-first cho presales và enterprise |
| Xử lý xung đột chính sách | Không cần | ⚠️ Phải sống chung với 2 bộ chính sách | ✅ PO quyết một lần, ghi nhận thay thế |
| Nguồn lực | ❌ Chia đôi | ⚠️ Phạm vi phình thêm | ✅ Cắt bớt learning/IaC khỏi critical path |
| Rủi ro | Hai engine sizing cho ra kết quả khác nhau | Phạm vi vỡ lịch (đã xảy ra, C-3) | Cần một đợt re-plan và sửa tài liệu |

## 6. Lộ trình chuyển đổi nếu chọn C

1. **PO ký quyết định** X-1 đến X-6, ghi vào decision log của ArchPilot (`docs/systemsarchitect-decisions.md`).
2. Chuyển tài liệu `ArchSizer/01–07` vào `ArchPilot/docs/v3/` làm input cho requirements v3. Giữ lại folder `ArchSizer/` làm bản gốc hoặc để redirect.
3. Đóng băng các phần chưa build của v2.1 không nằm trên critical path mới: learning, wizard IaC nâng cao, adapter IaC thứ 3 trở đi.
4. Lộ trình build v3, theo thứ tự rủi ro giảm dần:
   1. Rule DSL, evaluator và Excel import (Q-05). Đây là nền móng cho mọi sizing model.
   2. Workload L1 và các model L2 mới (Redis, Kafka, Elasticsearch, RDBMS đầy đủ, backup).
   3. Mapping L3: VMware host N+1, SAN usable↔raw, bare-metal.
   4. BOM L4 và spec trung lập cho top 3 vendor.
   5. Tra cứu SysDesAi (phase 1 của Knowledge Hub).
   6. LLM gateway (Azure, Bedrock), copilot, trích xuất RFP.
   7. SSO/RBAC; HLD DOCX export.
5. Đội BA/kiến trúc (các sub-agent trong repo) re-plan và ước lượng lại.

## 7. Điều cần PO trả lời để chốt

- Đồng ý phương án **C**?
- Đặt **tên sản phẩm**: giữ "ArchPilot" và dùng "Sizing Studio" làm tên module, hay đổi tên chung?
- Đồng ý các hướng xử lý xung đột X-1 đến X-6? Riêng X-2 cần PO ký lại policy.

# ArchSizer — Khảo sát SysDesAi

| Field | Value |
|---|---|
| Sản phẩm | ArchSizer (tên tạm) |
| Tài liệu | 01 — Khảo sát sản phẩm tham chiếu |
| Ngày khảo sát | 2026-10-08 |
| Nguồn | https://www.sysdesai.com/ (trang public, không đăng nhập) |
| Trang đã xem | Home, `/gallery`, `/share/ExMwREO` (URL Shortener, cả 15 bước), `/learn`, `/learn/foundations`, `/learn/foundations/back-of-envelope-estimation`, `/news`, `/interview`, `/pricing`, `/faq` |
| Liên quan | Repo đã có các phân tích SysDesAi trước đó tại `ArchPilot/08-reference-synthesis-sysdesai.md` và `ArchPilot/docs/research/sysdesai-*.md`. Tài liệu này bổ sung phần **kiểm tra độ đúng của sizing**, đây là trọng tâm của ArchSizer. |

## 1. Các module của SysDesAi

| Module | Nội dung chính |
|---|---|
| **AI Architect** | Bạn mô tả hệ thống, AI dẫn qua từng bước. Có 2 chế độ: **Copilot** (AI hỏi, bạn trả lời) và **Autopilot** (AI tự đặt giả định). Có Fast/Deep. Mỗi bước có chat riêng để sửa. Xuất Markdown để đưa cho AI coding agent (Cursor, Claude Code…). |
| **Design Gallery** | Trang chủ ghi 764 design; trang gallery public hiển thị 48. Lọc theo category (Messaging, E-commerce, Storage & CDN, AI & ML…), trạng thái, độ phổ biến. Nhiều design lấy ý tưởng từ blog kỹ thuật (Cloudflare, Dropbox…). Có fork, upvote, bookmark và comment theo từng bước. |
| **Academy** | 18 module, 131 bài, khoảng 29 giờ. Có quiz (trắc nghiệm, đúng/sai, nối cặp), chứng chỉ và AI chat trong từng bài. |
| **News** | Tự lấy bài từ 35+ blog kỹ thuật mỗi 6 giờ, lọc theo độ liên quan, AI tóm tắt và phân 12 chủ đề. Mỗi bài có nút **"Design this"** để chuyển thẳng sang AI Architect. |
| **Video Interview** | Phỏng vấn bằng giọng nói với avatar AI, kèm whiteboard. Chấm điểm 6 tiêu chí. |
| **Community** | Hồ sơ kiến trúc sư, diễn đàn thảo luận, follow, leaderboard, huy hiệu, activity feed. |
| **Kinh doanh** | Mọi phần nội dung đều miễn phí. AI chạy bằng Gemini (design) và OpenAI (voice). Người dùng mang API key riêng (BYOK) hoặc mua credit: $5 được 50 credit, $20 được 250 credit. Một bước design Fast tốn 5 credit, Deep tốn 25 credit. |

## 2. Cấu trúc một design (ví dụ URL Shortener, 15 bước)

| # | Bước | Nội dung |
|---|---|---|
| 1 | Clarify Requirements | 6 câu hỏi làm rõ, mỗi câu kèm **"Architect's assumption"** |
| 2 | Scope | Phát biểu bài toán đã thu hẹp |
| 3 | Functional & Non-functional requirements | Yêu cầu chức năng; NFR có số cụ thể (p99, QPS, availability, durability, consistency) |
| 4 | Estimates | Storage, bandwidth, QPS, có công thức dạng văn bản |
| 5 | API | Bảng endpoint gồm method, path, mô tả, auth |
| 6 | Data model | Entity, field, kiểu dữ liệu, nơi lưu trữ |
| 7–10 | Build (mỗi bước thêm 1 thành phần) | "Architect's note", bảng **Option / Pros / Cons / Pick**, quyết định, sơ đồ được cập nhật dần |
| 11–13 | Flows | Sequence diagram cho từng luồng chính |
| 14 | Scaling & Failure Modes | Bảng **Hiện tại so với 10x** và bảng **Failure, Impact, Mitigation** |
| 15 | Summary | Điểm mạnh, hướng cải tiến, kiến trúc đầy đủ, xuất .md/PDF |

## 3. Nên học theo

1. **Giả định tường minh** ngay từ bước đầu. Người dùng thấy AI đang giả định gì.
2. **Bảng so sánh phương án ở mỗi quyết định.** Đây là nguyên liệu sẵn để sinh ADR.
3. **Dựng kiến trúc từng bước**, mỗi bước thêm 1 thành phần và giải thích lý do. Cách này dễ review và dễ học.
4. **Scale ×10 kèm bảng kiểu lỗi** là đúng tư duy của người làm vận hành.
5. **Nối kiến thức với thiết kế:** từ bài News bấm "Design this" là sang thiết kế, trong bài học cũng có AI chat.
6. **Xuất tài liệu để dùng tiếp** sau khi thiết kế xong (Markdown cho AI coding agent).

## 4. Điểm yếu, cũng là cơ hội của ArchSizer

### 4.1 Sizing do LLM viết thành văn bản và tính sai (đã kiểm chứng)

Design URL Shortener được upvote nhiều nhất (1148). Mình tính lại theo đúng công thức mà chính trang đưa ra:

| Chỉ số | Site ghi | Tính lại | Sai lệch |
|---|---|---|---|
| Storage 10 năm | ~11.7 GB | 100,000 × 524 B × 3,650 ngày ≈ **191 GB** | ~16 lần |
| Read bandwidth 10 năm | "= 18.25 PB", sau đó ra "~4.2 PB" | 10M × 3,650 × 500 B = **18.25 TB** | 1000 lần (nhầm đơn vị) |
| Peak redirect QPS | ~115 | 10M / 86,400 = 115.7 là số **trung bình**; nhân hệ số đỉnh 1.5 ra **~174** | Quên nhân hệ số đỉnh |
| Redis cache | "100M URL active trong 10 GB RAM" | Tương đương 100 B/entry, trong khi mỗi URL đã ~500 B, chưa tính overhead của key | ≥ 5 lần |

Bước 14 (Scale ×10) lại dùng tiếp các số sai này, ví dụ "11.7 GB → 117 GB".

**Kết luận:** sizing không thể giao cho LLM. Nguyên tắc cho ArchSizer là **"AI đề xuất, engine tính"**: mọi con số đều qua engine cố định, có đơn vị, công thức và nguồn để truy lại.

### 4.2 Sizing dừng ở QPS, storage và bandwidth
Không ra được số node, vCPU, RAM, IOPS, số partition Kafka, bộ nhớ Redis, số host ESXi, dung lượng SAN raw/usable hay BOM. Đây đúng là khoảng trống của **sizing hệ thống IT** cho presales và enterprise.

### 4.3 Sơ đồ chỉ để xem, không phải mô hình
Sơ đồ do AI sinh ra. Trên trang giá có mục "Fix broken diagram" miễn phí, tức là sơ đồ hay bị lỗi. Không có canvas để chỉnh, không có view triển khai (site, zone, DC/DR, cluster/host).

### 4.4 Hướng thiên về phỏng vấn FAANG
Bài toán greenfield quy mô web. Không đề cập on-prem/VMware/SAN, HA/DR theo RPO/RTO, nhiều môi trường (Prod/DR/UAT/Dev), license, compliance hay đấu thầu. Đây lại là những thứ dự án doanh nghiệp tại Việt Nam thực sự cần.

### 4.5 Kiến thức nằm thành các mảng rời
Khóa học và News là nội dung để đọc. Không có thư viện tra cứu kiểu **thẻ công nghệ** (giới hạn, benchmark, tham số mặc định, license) để engine sizing dùng trực tiếp, và không có quy trình kiểm duyệt số liệu.

## 5. Không nên làm theo (với định vị B2B của ArchSizer)

- Phỏng vấn video, leaderboard, huy hiệu, cộng đồng public.
- Khóa học có chứng chỉ (có thể làm sau, dưới dạng lộ trình học nội bộ).
- Mô hình BYOK/credit cho người dùng cuối. ArchSizer cài nội bộ, LLM do doanh nghiệp cấu hình tập trung.

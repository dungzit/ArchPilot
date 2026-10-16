# ArchSizer — Knowledge Hub Phase 1: Tra cứu tham chiếu từ SysDesAi Gallery

| Field | Value |
|---|---|
| Sản phẩm | ArchSizer (tên tạm) |
| Tài liệu | 03 — Spec Knowledge Hub giai đoạn 1 |
| Phiên bản | 0.1 Draft |
| Ngày | 2026-10-13 |
| Quyết định gốc | 2026-10-13: "Giai đoạn 1 lấy thông tin tham chiếu từ https://www.sysdesai.com/gallery. Khi user search thì tìm theo từ khóa hoặc nội dung tương tự và trả về link cụ thể để tham chiếu." |
| Liên quan | 02-requirements.md (nhóm C, Knowledge Hub), 04-knowledge-sources-phase2.md |

## 1. Mục tiêu

Khi presales hoặc kiến trúc sư tìm một chủ đề (ví dụ "rate limiting", "thiết kế hệ thống thanh toán", "cache cho chuyển hướng link"), ArchSizer trả về **danh sách design cụ thể trên SysDesAi**, kèm:
- link trực tiếp tới design,
- **bước** trong design có nội dung khớp,
- đoạn trích,
- link bài blog gốc nếu design được sinh từ một bài viết.

Mục đích là tham chiếu nhanh cách người khác đã giải bài toán tương tự. **Không** dùng làm tham số cho sizing engine.

## 2. Kết quả khảo sát nguồn dữ liệu (2026-10-13)

| Hạng mục | Phát hiện | Hệ quả cho thiết kế |
|---|---|---|
| `robots.txt` | `Allow` cho `/gallery` và `/share/` với mọi user-agent, kể cả bot AI (ClaudeBot, GPTBot…). `Disallow` cho `/design/`, `/designs`, `/feed`, `/notifications`, `/settings/` | Được phép đọc gallery và trang design public. Không động tới `/design/` (trang thiết kế riêng của user). |
| `sitemap.xml` | 1,149 URL, trong đó **784 URL `/share/{id}`**. Ngoài ra có 150 `/learn`, 101 `/discussions`, 51 `/news`, 50 `/u` | Sitemap là **danh sách design public đầy đủ nhất**, dùng làm nguồn discovery chính. |
| Gallery | 3 tab: **Featured** (48), **Real World** (686, design AI sinh ra từ bài blog kỹ thuật), **Community**. URL dạng `/gallery?tab={featured\|real-world\|community}&sort=newest&page=N`, 12 design mỗi trang, các trang không trùng nhau | Lấy metadata giàu hơn từ gallery: categories, upvote, nguồn blog. |
| Metadata trong gallery (JSON nhúng sẵn trong HTML) | `shareId, title, prompt, completedSteps, totalSteps, categories[], authorName, upvoteCount, shareCount, commentCount, isFeatured, designSource (user\|article), sourceBlogName, sourceArticleUrl, createdAt, updatedAt` | Design thuộc tab Real World có `sourceArticleUrl`, nên trả được **cả link design lẫn link bài gốc**. |
| Trang design `/share/{id}` | Server-rendered (Next.js), tải về bằng HTTP thường là có nội dung, không cần chạy JS. JSON nhúng có mảng `steps[]`, mỗi phần tử gồm `id, phase, title, status, data.content` | Index được **theo từng bước**. |
| Phase của các bước | `clarify, problem, scope, estimate, api, data, build, flows, scale, wrap` (xem §2.1) | Cho phép lọc theo phase, ví dụ chỉ tìm trong bước Scale. |
| Deep link tới từng bước | **Không có.** Chuyển bước thì URL không đổi | Link trỏ tới design, kèm "Bước N: tên bước" để người dùng tự chuyển tới. |
| Terms of Service (cập nhật 01/03/2026) | Không có điều khoản cấm index. Cấm gây quá tải hạ tầng ("abuse, overload"). Cấm khai thác thương mại nội dung AI sinh ra "**without attribution**". Nội dung là AI-generated, cung cấp "as is". Có ghi chú rằng profile, comment, upvote có thể do AI agent tạo | Bắt buộc **giới hạn tốc độ crawl** và **ghi nguồn kèm link**. Upvote chỉ là tín hiệu xếp hạng yếu. |
| `llms.txt`, `llms-full.txt` | Chỉ mô tả sản phẩm, không chứa nội dung design | Không dùng làm nguồn dữ liệu. |

### 2.1 Nội dung theo phase (khảo sát trên design URL Shortener, 15 bước)

| Phase | Ví dụ tiêu đề bước | Các key trong `data.content` |
|---|---|---|
| `clarify` | Clarify Requirements | `questions[] {question, context, defaultAssumption, userAnswer}`, `finalized` |
| `problem` | Design a URL Shortener for … | `designChallenge, approach, whyItMatters` |
| `scope` | Defining functional and non-functional requirements | `functional, nonFunctional` |
| `estimate` | Estimating storage, bandwidth, and QPS | `metrics` |
| `api` | Designing the … API | `endpoints, rateLimiting` |
| `data` | Designing the database schema … | `entities, indexingStrategy` |
| `build` | Add Cache Layer for Redirects | `componentName, tradeoff, diagram, script` |
| `flows` | Short URL Redirection Flow | `flowName, script, participants, steps` |
| `scale` | Scaling and Failure Modes | `scalingTable, failureModes` |
| `wrap` | Design Summary | `designSummary, differentiators, futureImprovements` |

> Đây là cấu trúc nội bộ của SysDesAi, có thể đổi bất kỳ lúc nào mà không báo trước. Parser phải có phương án dự phòng (xem KH-P1-03).

## 3. Phạm vi

**Trong phạm vi**
- Metadata và nội dung từng bước của khoảng 784 design public (sitemap kết hợp 3 tab gallery).
- Index keyword và semantic, tìm kiếm, hỏi đáp RAG có trích dẫn, gợi ý theo ngữ cảnh trong design studio.
- Refresh định kỳ; dashboard quản trị.

**Ngoài phạm vi phase 1**
- `/learn`, `/news`, `/discussions` (robots.txt cho phép, có thể làm ở phase 1.1).
- Comment, profile, avatar, username của user SysDesAi (dữ liệu cá nhân).
- Tái xuất bản toàn văn design; đăng nhập; mọi URL bị `Disallow`.

## 4. Yêu cầu chức năng

Ưu tiên: M (Must), S (Should), C (Could).

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| KH-P1-01 | **Discovery:** đọc `sitemap.xml` để lấy danh sách `/share/{id}`. Duyệt 3 tab gallery (có phân trang) để bổ sung metadata. Design có trong sitemap mà không có trong gallery vẫn được index, metadata lấy từ trang design. | M |
| KH-P1-02 | **Crawl có trách nhiệm:** kiểm tra lại `robots.txt` đầu mỗi lần chạy. Mặc định 1 kết nối, ≤ 1 request mỗi 3 giây (cấu hình được). User-Agent định danh, kèm email liên hệ. Dùng ETag/Last-Modified nếu có. Exponential backoff khi gặp 429/5xx. Chạy vào giờ thấp điểm. | M |
| KH-P1-03 | **Parse:** trích JSON `steps[]` và chuẩn hóa mỗi bước thành 1 chunk (title, phase, text đã làm phẳng). Nếu không tìm thấy JSON hoặc schema đổi thì chuyển sang trích text từ HTML, **cảnh báo admin** và không ghi đè dữ liệu tốt đã có. | M |
| KH-P1-04 | **Lưu trữ tối thiểu:** metadata design, text từng bước (phục vụ index), content hash, thời điểm thu thập. Không lưu ảnh, avatar, username, comment. | M |
| KH-P1-05 | **Refresh:** incremental hằng ngày (design mới theo sitemap hoặc gallery `sort=newest`, design có `updatedAt` mới). Full re-crawl hằng tháng. Design trả 404 hai lần liên tiếp thì bị ẩn khỏi kết quả. | M |
| KH-P1-06 | **Làm giàu dữ liệu (enrichment):** trích công nghệ (Redis, Kafka, PostgreSQL…), pattern (cache-aside, CQRS, saga…), loại hệ thống; ánh xạ vào taxonomy của ArchSizer. Tóm tắt mỗi design 2–3 câu bằng tiếng Việt và tiếng Anh. | S |
| KH-P1-07 | **Tìm kiếm hybrid:** keyword (BM25) trên title, prompt, categories, tiêu đề bước, nội dung bước, kết hợp semantic (embedding). Trộn kết quả bằng RRF, boost nhẹ cho Featured và upvote. **Truy vấn tiếng Việt phải tìm ra được nội dung tiếng Anh** (embedding đa ngôn ngữ hoặc dịch truy vấn). | M |
| KH-P1-08 | **Bộ lọc:** category, tab (Featured, Real World, Community), phase, công nghệ, blog nguồn. | S |
| KH-P1-09 | **Định dạng kết quả:** gom theo design; mỗi design hiển thị tối đa 3 bước khớp nhất (xem §5). | M |
| KH-P1-10 | **Hỏi đáp RAG:** câu trả lời trích dẫn [n], mỗi trích dẫn trỏ tới link design và bước. Không có design phù hợp thì trả lời "không tìm thấy tham chiếu phù hợp". Số liệu lấy từ bước `estimate` phải kèm cảnh báo "AI-generated, chưa kiểm chứng". | M |
| KH-P1-11 | **Gợi ý theo ngữ cảnh:** trong design studio, panel "Tham chiếu SysDesAi" tự gợi ý design tương tự theo mô tả dự án hoặc component đang chọn. Có nút "Mở trên SysDesAi". | S |
| KH-P1-12 | **Cách ly với sizing:** không đưa số liệu nào từ SysDesAi vào catalog hay sizing engine (nguyên tắc PR-4). | M |
| KH-P1-13 | **Quản trị:** dashboard hiển thị số design đã index, lần chạy gần nhất, lỗi, cảnh báo schema. Có nút chạy lại, cấu hình rate limit, **kill switch** tắt nguồn. | M |
| KH-P1-14 | **Phản hồi:** người dùng đánh dấu kết quả "hữu ích" hoặc "không liên quan"; dữ liệu này dùng để tinh chỉnh xếp hạng. | C |
| KH-P1-15 | **Ghi nguồn:** mọi kết quả và câu trả lời đều ghi "Nguồn: SysDesAi" kèm link, và gắn nhãn "Nội dung AI-generated, chỉ để tham khảo". | M |

## 5. Mẫu kết quả tìm kiếm

Truy vấn: `cache cho chuyển hướng link rút gọn`

```
1. URL Shortener                                   ★ Featured · Other · ▲1148
   https://www.sysdesai.com/share/ExMwREO
   "Design a URL shortener like Bitly"
   ├─ Bước 8: Add Cache Layer for Redirects                (build)
   │    "...introducing a dedicated Cache layer, specifically Redis. This cache
   │     will store the shortCode to longURL mappings..."
   ├─ Bước 12: Short URL Redirection Flow                  (flows)
   └─ Bước 14: Scaling and Failure Modes                   (scale)
   Nguồn: SysDesAi · Nội dung AI-generated, chỉ để tham khảo · cập nhật 2026-09-23
```

Với design thuộc tab Real World, hiển thị thêm dòng: `Bài gốc: {sourceBlogName} – {sourceArticleUrl}`.

**Đánh số bước:** dùng thứ tự hiển thị trên SysDesAi (bắt đầu từ 1, bước Clarify là Bước 1), **không** dùng `id` nội bộ (`step-7`…), vì người dùng chuyển bước theo số hiển thị.

## 6. Mô hình dữ liệu

```
ExternalSource   (id, name="SysDesAi", base_url, robots_checked_at, enabled, rate_limit)
ExternalDesign   (id, source_id, share_id, url, title, prompt, categories[], tab,
                  design_source[user|article], source_blog_name, source_article_url,
                  upvote_count, comment_count, total_steps, created_at, updated_at,
                  fetched_at, content_hash, status[active|hidden|error], summary_vi, summary_en)
ExternalStep     (id, design_id, position, step_key, phase, title, text, embedding,
                  tech_tags[], pattern_tags[])
CrawlRun         (id, started_at, finished_at, discovered, fetched, updated, failed,
                  schema_warnings, robots_status)
SearchFeedback   (id, user_id, query, design_id, step_id, verdict, created_at)
```

## 7. Tiêu chí nghiệm thu

| ID | Given / When / Then |
|---|---|
| AC-01 | **Given** sitemap có N link `/share/`, **when** chạy full crawl, **then** ≥ 98% design được index (phần còn lại có log lỗi) và không request nào vi phạm rate limit đã cấu hình. |
| AC-02 | **When** tìm `URL shortener`, **then** kết quả đầu tiên là `https://www.sysdesai.com/share/ExMwREO`. |
| AC-03 | **When** tìm bằng tiếng Việt `bộ nhớ đệm cho chuyển hướng link rút gọn`, **then** top 3 có URL Shortener, kèm bước "Bước 8: Add Cache Layer for Redirects". |
| AC-04 | Mọi kết quả có link trả về HTTP 200 tại thời điểm crawl gần nhất, có ghi nguồn SysDesAi và nhãn AI-generated. |
| AC-05 | **Given** `robots.txt` đổi thành `Disallow: /share/`, **when** tới lần chạy kế tiếp, **then** crawler dừng, index giữ nguyên ở trạng thái "đóng băng" và admin nhận cảnh báo để quyết định có xóa không. |
| AC-06 | **Given** JSON `steps` biến mất hoặc đổi cấu trúc, **then** parser chuyển sang trích text HTML, ghi `schema_warnings` và không làm mất dữ liệu cũ. |
| AC-07 | Design trả 404 ở 2 lần chạy liên tiếp thì bị ẩn khỏi kết quả tìm kiếm. |
| AC-08 | Với khoảng 1,000 design / 16,000 bước: tìm keyword p95 ≤ 1 giây, tìm hybrid p95 ≤ 2 giây. |
| AC-09 | Câu trả lời RAG có ≥ 1 trích dẫn kèm link. Nếu câu trả lời chứa số liệu từ bước `estimate` thì phải kèm cảnh báo chưa kiểm chứng. |

## 8. Ước lượng vận hành

| Hạng mục | Tính toán | Kết quả |
|---|---|---|
| Thời gian full crawl | 784 trang design × 3 giây + khoảng 66 trang gallery × 3 giây (784 / 12 ≈ 66) | ≈ 39 + 3 phút ≈ **42 phút** |
| Dung lượng tải về | 784 × khoảng 77 KB (đo trên trang URL Shortener) | ≈ **60 MB** mỗi lần full crawl |
| Số chunk cần index | 784 design × 15–20 bước | ≈ **12,000–16,000 chunk** |
| Dung lượng vector | 16,000 × 1,024 chiều × 4 byte | ≈ **65.5 MB** |
| Incremental hằng ngày | sitemap + 1–3 trang gallery mỗi tab + các design mới hoặc đã đổi | vài chục request mỗi ngày |

## 9. Rủi ro và biện pháp giảm thiểu

| ID | Rủi ro | Biện pháp |
|---|---|---|
| R-P1-01 | Phụ thuộc bên thứ ba: SysDesAi có thể đổi cấu trúc, chặn bot hoặc ngừng hoạt động | Kill switch, parser có phương án dự phòng, giữ index đã có, cảnh báo admin. Nguồn blog ở phase 2 giảm sự phụ thuộc. |
| R-P1-02 | Pháp lý: dùng trong công cụ thương mại nội bộ | **Quyết định của PO (Q-01, 2026-10-14):** không cần xin phép; SysDesAi được dùng như công cụ tra cứu giống người dùng thông thường. Vẫn bắt buộc: chỉ hiển thị trích đoạn kèm link, ghi nguồn đầy đủ (Terms §4 yêu cầu attribution), giới hạn tốc độ crawl (Terms cấm gây quá tải). |
| R-P1-06 | Xung đột với chính sách nội dung của ArchPilot (REQ-KH-017 cấm crawl SysDesAi, đã được PO duyệt tại gate G0.2) | Nếu hợp nhất với ArchPilot, PO cần ký lại policy v0.2 và tách riêng loại "tham chiếu ngoài". Xem 07 §4 X-2. |
| R-P1-03 | Chất lượng: nội dung do AI sinh, đã phát hiện lỗi tính toán (xem 01-research §4.1) | Gắn nhãn AI-generated; không dùng làm tham số sizing; số liệu estimate luôn kèm cảnh báo. |
| R-P1-04 | Tín hiệu cộng đồng không tin cậy (Terms cho biết upvote và profile có thể do AI agent tạo) | Upvote chỉ boost nhẹ; ưu tiên độ liên quan về nội dung. |
| R-P1-05 | Lệch ngôn ngữ: người dùng hỏi tiếng Việt, nội dung tiếng Anh | Embedding đa ngôn ngữ hoặc dịch truy vấn; có test AC-03. |

## 10. Mở rộng sau phase 1

- **Phase 1.1:** thêm `/learn` (150 URL trong sitemap) làm tri thức nền, tức các bài học về khái niệm.
- **Phase 2:** blog kỹ thuật public: Backend/System Design, Cloud Native, Open Compute, Medium. Xem `04-knowledge-sources-phase2.md`.
- **Phase 3:** Facebook và LinkedIn qua nút clip, nhập tay hoặc API chính thức. Không crawl tự động.

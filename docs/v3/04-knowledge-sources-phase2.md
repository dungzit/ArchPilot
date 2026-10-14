# ArchSizer — Nguồn tri thức Phase 2 (blog kỹ thuật public)

| Field | Value |
|---|---|
| Tài liệu | 04 — Danh sách nguồn phase 2 |
| Ngày kiểm tra | 2026-10-12, kiểm tra thật bằng HTTP GET từ máy dev |
| Quyết định gốc | 2026-10-12: lấy bài kỹ thuật từ blog public trước, gồm các nhóm Backend/System Design, Open Compute, Cloud Native, Medium. Facebook và LinkedIn để sau. |
| Cách đọc | ✅ = HTTP 200 và có bài (`<item>`/`<entry>`). ⚠️ = cần cách khác. Số bài là số có trong feed tại thời điểm kiểm tra. |

> Cách hiểu "group" ở đây là **nhóm chủ đề**, không phải group Facebook. Nếu ý là group Facebook thì xếp vào Phase 3.

## 1. Backend & System Design

| Nguồn | Feed | Trạng thái |
|---|---|---|
| Netflix Tech Blog | https://netflixtechblog.com/feed | ✅ 10 bài |
| Cloudflare Blog | https://blog.cloudflare.com/rss/ | ✅ 20 |
| Meta Engineering | https://engineering.fb.com/feed/ | ✅ 9 |
| Dropbox Tech | https://dropbox.tech/feed | ✅ 10 |
| Slack Engineering | https://slack.engineering/feed/ | ✅ 8 |
| Spotify Engineering | https://engineering.atspotify.com/feed/ | ✅ 5 |
| GitHub Engineering | https://github.blog/engineering/feed/ | ✅ 10 |
| Stripe Blog | https://stripe.com/blog/feed.rss | ✅ 10 |
| Discord Blog | https://discord.com/blog/rss.xml | ✅ 100. Đây là blog chung của Discord, cần lọc bài kỹ thuật. |
| Shopify Engineering | https://shopify.engineering/blog.atom | ✅ 432 |
| Datadog Blog | https://www.datadoghq.com/blog/index.xml | ✅ 97 |
| High Scalability | https://highscalability.com/rss/ | ✅ 15 |
| ByteByteGo | https://blog.bytebytego.com/feed | ✅ 20 |
| InfoQ Architecture & Design | https://feed.infoq.com/architecture-design/ | ✅ 15 |
| Martin Fowler | https://martinfowler.com/feed.atom | ✅ 30 |
| The Pragmatic Engineer | https://newsletter.pragmaticengineer.com/feed | ✅ 19. Nhiều bài cần trả phí, chỉ lấy phần public. |
| All Things Distributed (Werner Vogels) | https://www.allthingsdistributed.com/atom.xml | ✅ 10 |
| Uber Engineering | https://www.uber.com/blog/engineering/rss/ | ⚠️ HTTP 406. Cần tìm feed khác hoặc dùng sitemap. |

## 2. Cloud Native

| Nguồn | Feed | Trạng thái |
|---|---|---|
| CNCF Blog | https://www.cncf.io/blog/feed/ | ✅ 10 (lần đầu timeout, thử lại thì OK) |
| Kubernetes Blog | https://kubernetes.io/feed.xml | ✅ 50 |
| Istio Blog | https://istio.io/latest/blog/feed.xml | ✅ 166 |
| Prometheus Blog | https://prometheus.io/blog/feed.xml | ✅ 60 |
| Grafana Blog | https://grafana.com/blog/index.xml | ✅ 10 |
| The New Stack | https://thenewstack.io/feed/ | ✅ 26 |
| Red Hat Blog | https://www.redhat.com/en/rss/blog | ✅ 10 |
| SUSE / Rancher | https://www.suse.com/c/feed/ | ⚠️ HTTP 404. Cần tìm URL feed mới. |

## 3. Open Compute & hạ tầng (quan trọng cho catalog phần cứng và BOM)

| Nguồn | Feed | Trạng thái |
|---|---|---|
| Open Compute Project | https://www.opencompute.org/blog/rss | ✅ 10 |
| ServeTheHome (đánh giá server, CPU, NIC) | https://www.servethehome.com/feed/ | ✅ 6 (lần đầu timeout, thử lại thì OK) |
| The Next Platform | https://www.nextplatform.com/feed/ | ✅ 88 |
| Blocks and Files (storage) | https://blocksandfiles.com/feed/ | ✅ 75 |
| StorageReview | https://www.storagereview.com/feed | ✅ 17 |

## 4. Cloud provider

| Nguồn | Feed | Trạng thái |
|---|---|---|
| AWS Architecture Blog | https://aws.amazon.com/blogs/architecture/feed/ | ✅ 10 |
| Google Cloud Blog | https://cloudblog.withgoogle.com/rss/ | ✅ 3 (feed ít bài) |

## 5. Medium

| Nguồn | Feed | Trạng thái |
|---|---|---|
| Tag `system-design` | https://medium.com/feed/tag/system-design | ⚠️ Lỗi kết nối |
| Tag `software-architecture` | https://medium.com/feed/tag/software-architecture | ⚠️ Lỗi kết nối |
| Tag `distributed-systems` | https://medium.com/feed/tag/distributed-systems | ⚠️ Lỗi kết nối |
| Tag `kubernetes`, `cloud-native`, `microservices` | https://medium.com/feed/tag/{tag} | ⚠️ Lỗi kết nối |
| Airbnb Engineering, Pinterest Engineering | https://medium.com/feed/{publication} | ⚠️ Lỗi kết nối |

**Ghi chú về Medium:** từ máy kiểm tra, mọi request tới `medium.com:443` đều bị `Connection refused` ngay ở tầng TCP. Trong khi đó Netflix Tech Blog, cũng chạy trên hạ tầng Medium nhưng dùng domain riêng, vẫn hoạt động bình thường. Khả năng cao là **mạng hoặc firewall cục bộ đang chặn domain medium.com**, chưa phải do Medium chặn. Cần kiểm tra lại từ mạng hoặc proxy của server sẽ chạy crawler trước khi kết luận.

## 6. Nguồn tiếng Việt

| Nguồn | Feed | Trạng thái |
|---|---|---|
| Viblo | https://viblo.asia/rss | ✅ 40. Nội dung đa dạng, cần lọc chủ đề kiến trúc và hạ tầng. |

## 7. Quy tắc áp dụng chung cho phase 2

- Chỉ crawl nguồn có trong source registry (allowlist). Tuân thủ robots.txt và ToS; giới hạn tốc độ; User-Agent định danh.
- Lưu metadata, text để index và tóm tắt. Giao diện chỉ hiển thị tóm tắt kèm link gốc, không tái xuất bản toàn văn.
- Số liệu benchmark trích từ bài viết chỉ là **ứng viên**; curator phải duyệt mới được đưa vào catalog (nguyên tắc PR-4).

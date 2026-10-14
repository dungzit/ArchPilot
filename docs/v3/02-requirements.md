# ArchSizer — Bộ Requirement v0.2

| Field | Value |
|---|---|
| Sản phẩm | ArchSizer (tên tạm): nền tảng **Sizing · Design · Knowledge Hub** cho hệ thống IT |
| Phiên bản | 0.2: cập nhật theo câu trả lời Q-01 đến Q-08 của PO (2026-10-14) |
| Ngày | 2026-10-14 |
| Trạng thái | Chờ review; quyết định và câu hỏi còn mở xem §12 |
| Tài liệu liên quan | 01-research-sysdesai.md · 03-kh-phase1-sysdesai-reference-search.md · 04-knowledge-sources-phase2.md · 05-sizing-rule-builder.md · 06-hld-template-proposal.md · 07-archpilot-vs-archsizer-assessment.md |

**Thay đổi so với v0.1:** Rule builder và Excel import lên **Must · MVP** (Q-05). Cloud đích là AWS, Azure, Viettel Cloud, FPT Cloud; GCP lùi sang v2 (Q-04). LLM dùng Microsoft (Azure) và AWS Bedrock (Q-02). BOM ưu tiên top 3 vendor, spec trung lập phải đáp ứng được cả 3 (Q-03). Có template HLD built-in (Q-06). Triển khai nội bộ trên VMware (Q-07). Không cần xin phép SysDesAi (Q-01). Khuyến nghị hợp nhất với ArchPilot (Q-08, xem 07).

**Ký hiệu:** Ưu tiên M (Must), S (Should), C (Could). Release: MVP, v1.1, v2.

---

## 1. Bối cảnh và vấn đề

- **Presales / Solution Architect** khi trả lời RFP thường làm sizing bằng Excel cá nhân với các rule-of-thumb truyền miệng. Mỗi người làm một kiểu, nên khó review, khó bảo vệ con số trước khách hàng và khó tái sử dụng giữa các dự án.
- **Team kiến trúc nội bộ doanh nghiệp** thiếu chuẩn chung. HLD và sizing nằm ở hai nơi tách rời, nên khi thiết kế thay đổi thì sizing không được cập nhật theo.
- Các công cụ AI design như SysDesAi giải quyết tốt phần "suy nghĩ thiết kế", nhưng **sizing do LLM tự viết nên sai**: đã kiểm chứng sai từ 16 đến 1000 lần (xem 01-research §4.1). Ngoài ra sizing chỉ dừng ở QPS/storage, không ra được cấu hình hạ tầng.

## 2. Mục tiêu và chỉ số thành công

| Mục tiêu | Chỉ số | Target v1 |
|---|---|---|
| Rút ngắn thời gian sizing cho RFP | Thời gian từ khi nhận RFP đến khi có bản sizing và BOM cấu hình nháp | ≤ 1 ngày làm việc (đo baseline khi pilot) |
| Sizing đúng và bảo vệ được | Tỷ lệ con số đầu ra truy vết được về công thức và giả định | 100% |
| | Tỷ lệ bản sizing qua review mà không phải sửa số do lỗi tính | ≥ 90% |
| Chuẩn hóa | Tỷ lệ dự án dùng template và catalog chuẩn | ≥ 70% |
| Tái sử dụng tri thức | Người dùng đánh giá mức hữu ích của kết quả tra cứu và hỏi đáp | ≥ 4/5 |

## 3. Phạm vi

### 3.1 Trong phạm vi v1
- **Sizing 4 tầng:** Workload → Component → Hạ tầng → **BOM cấu hình** (chưa có giá).
- **Nền tảng đích:** on-prem (VMware vSphere, bare-metal, SAN), Kubernetes, hybrid; public cloud **AWS, Azure**; cloud trong nước **Viettel Cloud, FPT Cloud**.
- **Design studio:** AI copilot/autopilot, canvas nhiều view, lint, ADR, xuất tài liệu.
- **Knowledge Hub, chia theo phase:**
  - Phase 1 (MVP): tra cứu tham chiếu từ **SysDesAi Gallery**, trả về link cụ thể (spec chi tiết ở 03).
  - Phase 2: blog kỹ thuật public (danh sách ở 04).
  - Phase 3: Facebook và LinkedIn qua clip, nhập tay hoặc API chính thức.
- **Triển khai:** v1 cài nội bộ trên **VMware**, kiến trúc sẵn sàng chạy trên public cloud. LLM dùng dịch vụ cloud: **Microsoft (Azure OpenAI / Microsoft Foundry) và AWS Bedrock**.

### 3.2 Ngoài phạm vi v1
- Giá, TCO, báo giá. Cấu trúc dữ liệu BOM vẫn chừa sẵn trường đơn giá cho v2.
- Hiệu chỉnh sizing bằng số liệu vận hành thật (Prometheus, vROps, CloudWatch).
- Sinh IaC (Terraform, Ansible).
- Phỏng vấn video, gamification, cộng đồng public, khóa học có chứng chỉ.
- Multi-tenant SaaS. v1 chỉ có một tenant, nhưng dữ liệu đã có sẵn `tenant_id`.

## 4. Personas

| ID | Persona | Mục tiêu | Khó khăn |
|---|---|---|---|
| P1 | Presales / Solution Architect (SI, vendor) | Trả lời RFP nhanh, có sizing và BOM cấu hình bảo vệ được | Deadline gấp, RFP mơ hồ, nhiều khách hàng cùng lúc, phải giữ bảo mật thông tin từng khách |
| P2 | Enterprise Architect (nội bộ doanh nghiệp) | Thiết kế theo chuẩn, lập kế hoạch năng lực nhiều năm, có quy trình duyệt | Thiết kế và sizing rời rạc, không có chuẩn chung, tri thức không được tích lũy |
| P3 | Reviewer / Technical lead | Duyệt nhanh, nhìn rõ giả định và rủi ro | Phải soát Excel từng ô |
| P4 | Knowledge curator | Giữ tri thức và catalog chính xác, cập nhật | Nhiều nguồn, chất lượng không đồng đều |
| P5 | System admin | Cài đặt, vận hành, cấu hình LLM và SSO | — |

## 5. Nguyên tắc sản phẩm (bắt buộc)

| ID | Nguyên tắc |
|---|---|
| PR-1 | **AI đề xuất, engine tính.** LLM không bao giờ đưa ra con số sizing cuối cùng. LLM chỉ đề xuất giả định, thành phần và tham số. Mọi con số do engine tính toán cố định (deterministic): cùng input và cùng version model thì cho cùng output. |
| PR-2 | **Truy vết đầy đủ.** Bấm vào bất kỳ con số đầu ra nào cũng thấy được công thức, giá trị đầu vào, nguồn của giả định (khách hàng cung cấp / AI đề xuất / mặc định trong catalog / benchmark có trích dẫn) và mức độ tin cậy. |
| PR-3 | **Một mô hình duy nhất.** Mỗi dự án có một design model (component graph + workload + placement). Sơ đồ, sizing, BOM và tài liệu đều được dựng ra từ model này. |
| PR-4 | **Tri thức phải được duyệt mới thành tham số.** Mọi số liệu từ nguồn bên ngoài (SysDesAi, blog…) chỉ là tham khảo hoặc ứng viên. Chỉ khi curator duyệt thì mới vào catalog để engine sử dụng. |
| PR-5 | **Bảo vệ dữ liệu khách hàng khi dùng LLM cloud.** Gửi lên ít dữ liệu nhất có thể, ẩn danh trước khi gửi, có thể tắt AI theo từng dự án. |
| PR-6 | **Trung lập nền tảng.** Một design logic có thể ánh xạ sang nhiều nền tảng đích để so sánh. |
| PR-7 | **Ghi nguồn.** Mọi tri thức bên ngoài hiển thị đều kèm nguồn và link gốc. |

## 6. Luồng nghiệp vụ chính

**F1. Presales trả lời RFP**
1. Tạo dự án: khách hàng, deadline, ngôn ngữ đầu ra.
2. Upload RFP/TOR → AI trích xuất yêu cầu chức năng, yêu cầu phi chức năng, số liệu workload và các ràng buộc. Mỗi mục được trích dẫn vị trí trong tài liệu gốc.
3. Hệ thống liệt kê các thông tin còn thiếu → tạo câu hỏi làm rõ, hoặc đặt giả định có đánh dấu rõ.
4. Chọn nền tảng đích, ví dụ on-prem VMware kèm DR, hoặc so sánh on-prem với AWS.
5. AI đề xuất 1–3 phương án kiến trúc, kèm **tham chiếu SysDesAi** tương tự. Người dùng chọn và chỉnh trên canvas.
6. Engine tính sizing theo từng môi trường (Prod, DR, UAT, Dev) và từng kịch bản (năm 1, 3, 5).
7. Chạy lint và review nội bộ.
8. Xuất gói đề xuất: HLD (DOCX), sizing workbook (XLSX), BOM cấu hình (XLSX), sơ đồ, danh sách giả định và câu hỏi làm rõ.

**F2. Enterprise architect thiết kế hoặc mở rộng hệ thống**
Tạo từ reference architecture hoặc clone dự án cũ → nhập workload hiện tại và mức tăng trưởng → thiết kế và kiểm tra theo bộ rule chuẩn → so sánh kịch bản (hiện tại, +3 năm, failover sang DR) → gửi duyệt → baseline được khóa.

**F3. Tra cứu tham chiếu (Knowledge Hub phase 1)**
Người dùng gõ từ khóa hoặc mô tả (tiếng Việt hoặc tiếng Anh) → nhận danh sách design SysDesAi có link, bước khớp, đoạn trích và link bài gốc → mở trên SysDesAi hoặc ghim vào dự án làm tham chiếu.

---

## 7. Yêu cầu chức năng

### 7.1 Nhóm A: SIZING

#### EP-SZ1. Mô hình workload (tầng L1)

| ID | Yêu cầu | Ưu tiên | Release |
|---|---|---|---|
| SZ1-01 | Nhập workload theo 3 cách: (a) theo người dùng: tổng user, DAU/MAU, CCU (người dùng đồng thời); (b) theo nghiệp vụ: số giao dịch/ngày và % lưu lượng vào giờ cao điểm; (c) nhập trực tiếp RPS/TPS | M | MVP |
| SZ1-02 | Quy đổi CCU sang RPS theo định luật Little: `RPS = CCU / (response time + think time)`, cho phép chỉnh think time | M | MVP |
| SZ1-03 | Tính RPS trung bình, RPS giờ cao điểm và RPS đỉnh (theo peak factor) cho từng nghiệp vụ và cho tổng; tính tỉ lệ đọc/ghi | M | MVP |
| SZ1-04 | Mô hình dữ liệu: kích thước bản ghi, số bản ghi/ngày, file/object (số lượng, kích thước trung bình), thời gian lưu trữ (online, archive), tỉ lệ nén, tăng trưởng %/năm | M | MVP |
| SZ1-05 | Kế hoạch 1–5 năm, tính riêng cho từng năm | M | MVP |
| SZ1-06 | Tính bandwidth vào/ra theo payload | M | MVP |
| SZ1-07 | Đơn vị hệ 10 (KB = 1000) hoặc hệ 2 (KiB = 1024), cấu hình theo dự án. Mọi giá trị hiển thị đều kèm đơn vị | M | MVP |
| SZ1-08 | Kiểm tra tính hợp lệ: peak ≥ avg; % giờ cao điểm ≤ 100%; cảnh báo khi giá trị lệch bất thường so với mẫu tham chiếu | M | MVP |
| SZ1-09 | Import/export workload qua Excel template | S | MVP |
| SZ1-10 | Workload profile mẫu theo loại hệ thống: core banking, e-commerce, cổng dịch vụ công, ERP, data platform… | S | v1.1 |

> **US-SZ-01.** Là presales, tôi nhập CCU = 5,000, response time = 1 giây, think time = 9 giây.
> **Then:** RPS = **500**, công thức hiển thị là `5000 / (1 + 9)`, và tôi có thể đổi think time để thấy kết quả tính lại.

#### EP-SZ2. Sizing theo từng component (tầng L2)

Mỗi loại component có một **sizing model có version**. Model nhận input, áp công thức, cho ra output và cảnh báo. Tham số mặc định lấy từ catalog (EP-PL1).

| Model | Input chính | Output | Ưu tiên |
|---|---|---|---|
| App/Web tier stateless (VM hoặc container) | RPS, CPU-ms/request (hoặc profile nhẹ/vừa/nặng), RAM/instance, target utilization | Số instance, vCPU, RAM | M · MVP |
| Kubernetes cluster | Danh sách workload (requests/limits, replicas), max pods/node, overhead hệ thống, DaemonSet | Số worker node theo flavor, control plane (3 node), ingress | M · MVP |
| RDBMS (PostgreSQL, MySQL, SQL Server, Oracle) | Data size, % overhead của index, TPS đọc/ghi, working set %, số connection, số replica | vCPU, RAM (buffer pool), IOPS, storage cho data/log/archive/backup | M · MVP |
| Cache (Redis) | Số key, kích thước key và value, overhead/key, fill factor, ops/s | RAM/node, số shard, số replica | M · MVP |
| Streaming (Kafka) | MB/s vào, số consumer đọc song song (fan-out), retention, replication factor | Số broker, số partition, disk/broker, network | M · MVP |
| Search (Elasticsearch/OpenSearch) | Dữ liệu index/ngày, retention, replica, kích thước shard mục tiêu | Số data node và master node, heap, disk | M · MVP |
| Object storage (S3-compatible, MinIO, Ceph) | Dung lượng logic, erasure coding hoặc replication | Raw capacity, số node, số disk | M · MVP |
| Backup | Dung lượng nguồn, chính sách full/incremental, retention, tỉ lệ dedup | Dung lượng backup repository | M · MVP |
| LB / API gateway / WAF | RPS, số kết nối đồng thời, số TLS handshake/s, throughput | Số instance hoặc hạng throughput của appliance | S · MVP |
| Queue (RabbitMQ), NoSQL (MongoDB, Cassandra), Logging/Monitoring, File/NAS | — | — | S · v1.1 |

| ID | Yêu cầu | Ưu tiên | Release |
|---|---|---|---|
| SZ2-01 | Mỗi model có đủ: input schema, công thức, giá trị mặc định (từ catalog), output, rule cảnh báo, bộ **golden test** | M | MVP |
| SZ2-02 | Model có version. Dự án ghim (pin) version khi tạo. Muốn nâng version phải làm chủ động, và hệ thống hiển thị kết quả chênh lệch | M | MVP |
| SZ2-03 | Cảnh báo theo best practice, ví dụ: ES heap > 31 GB; Kafka replication factor < 3 ở Prod; Redis dùng > 75% RAM; DB chỉ 1 node ở Prod | M | MVP |
| SZ2-04 | Cho phép ghi đè bất kỳ tham số nào, nhưng **bắt buộc nhập lý do**. Các giá trị ghi đè được đánh dấu khi review | M | MVP |
| SZ2-05 | **Rule builder:** người dùng tự tạo sizing rule theo nhu cầu bằng DSL có kiểm tra đơn vị, không cần viết code; phải có test trước khi publish. Spec chi tiết ở **05-sizing-rule-builder.md** | **M** | **MVP** |
| SZ2-06 | **Import rule từ Excel:** theo template (độ chính xác 100%) hoặc từ file Excel có sẵn (tự sinh test từ giá trị đã tính sẵn trong file); export ngược ra Excel giữ nguyên công thức. Xem 05 | **M** | **MVP** |

> **US-SZ-02 (Redis).** Given: 50M key, key 40 B, value 500 B, overhead 90 B/key (theo catalog), fill factor 70%, 1 replica.
> **Then:** dữ liệu = 50M × 630 B = **31.5 GB**; RAM cần cho mỗi bản sao = 31.5 / 0.7 = **45 GB**; tổng cho primary và replica = **90 GB**. Hệ thống hiển thị từng bước tính.

#### EP-SZ3. Ánh xạ hạ tầng và HA/DR (tầng L3)

| ID | Yêu cầu | Ưu tiên | Release |
|---|---|---|---|
| SZ3-01 | Placement: gán mỗi component vào site (DC chính, DR, cloud region), zone (DMZ, App, Data, Management) và nền tảng (VMware cluster, bare-metal pool, K8s cluster, cloud account) | M | MVP |
| SZ3-02 | Môi trường Prod, DR, UAT, Staging, Dev/Test. Mỗi môi trường có quy mô theo % so với Prod và tùy chọn bật/tắt HA | M | MVP |
| SZ3-03 | **VMware:** xếp VM lên host ESXi. Tỉ lệ vCPU:pCore cấu hình được (ví dụ 1:1 cho DB, 3:1 cho app); mặc định không overcommit RAM; HA admission control N+1 hoặc % dự phòng; có tính overhead của hypervisor; model host lấy từ hardware catalog | M | MVP |
| SZ3-04 | **Bare-metal:** xếp workload vào server trong hardware catalog (socket/core, slot RAM, khay đĩa), có ràng buộc anti-affinity | M | MVP |
| SZ3-05 | **Storage/SAN:** quy đổi usable sang raw theo RAID hoặc erasure coding, cộng spare, snapshot reserve, tỉ lệ thin provisioning. Chia tier theo IOPS (NVMe, SSD, HDD) và kiểm tra IOPS/throughput theo profile của array. Có lựa chọn vSAN | M | MVP |
| SZ3-06 | **Kubernetes:** on-prem (chạy trên VMware hoặc bare-metal) hoặc managed (EKS, AKS, GKE). Chia node pool theo loại workload | M | MVP |
| SZ3-07 | **Cloud:** map sang instance type/flavor theo vCPU, RAM, network, local disk; map sang managed service tương đương (RDS, ElastiCache, MSK, OpenSearch Service…); chọn loại disk và IOPS. Áp dụng cho **AWS, Azure, Viettel Cloud, FPT Cloud**. GCP để v2 | M | MVP |
| SZ3-08 | Topology HA/DR: active-active, active-standby, pilot light. Từ RPO/RTO suy ra cơ chế replication cần dùng. Năng lực DR tính theo % (100%, 50%…) | M | MVP |
| SZ3-09 | Headroom (target utilization) và tăng trưởng theo kỳ kế hoạch. Làm tròn lên theo đơn vị vật lý (host, đĩa, node) | M | MVP |
| SZ3-10 | Hybrid: một dự án có cả component on-prem lẫn cloud; tính bandwidth giữa các site (replication và lưu lượng người dùng) | S | MVP |
| SZ3-11 | Từ cùng một design logic, tạo nhiều deployment variant (ví dụ VMware và AWS) để so sánh cạnh nhau | S | v1.1 |

> **US-SZ-03 (VMware N+1).** Given: app 400 vCPU với tỉ lệ 3:1; DB 120 vCPU với tỉ lệ 1:1; RAM 2,048 GB; host loại 2×32 core / 1,024 GB; target utilization 70%; N+1; overhead hypervisor = 0 trong test này.
> **Then:** cần 253.3 pCore / 0.7 = 361.9 core, tương đương 6 host theo CPU. RAM cần 2,925.7 GB, tương đương 3 host. Kết quả: **7 host** (6 + 1 cho N+1), hệ thống chỉ rõ **ràng buộc quyết định là CPU**.

#### EP-SZ4. BOM cấu hình (tầng L4)

| ID | Yêu cầu | Ưu tiên | Release |
|---|---|---|---|
| SZ4-01 | Sinh BOM theo cấp site → môi trường → nhóm (compute, storage, network, software) | M | MVP |
| SZ4-02 | Dòng BOM cho server: model (hoặc spec trung lập), CPU (model, socket, core, GHz), RAM (dung lượng, cấu hình DIMM), đĩa (loại, dung lượng, số lượng, RAID), NIC (tốc độ, số cổng), HBA, nguồn dự phòng, số lượng | M | MVP |
| SZ4-03 | Dòng BOM cho storage array: dung lượng usable/raw, tier, số đĩa, IOPS mục tiêu, giao thức (FC, iSCSI, NVMe-oF), controller kép | M | MVP |
| SZ4-04 | Dòng BOM cho cloud: instance type × số lượng × môi trường; volume (loại, GB, IOPS); managed service (SKU, tier) | M | MVP |
| SZ4-05 | Đếm số lượng license theo metric (core, socket, VM, node) cho VMware, OS, DB, middleware. **Chỉ đếm, không tính giá** | M | MVP |
| SZ4-06 | Hai chế độ BOM: (a) **theo vendor**, ưu tiên **top 3 vendor** của từng hạng mục (xem SZ4-10); (b) **spec trung lập, không nêu thương hiệu**, dùng cho hồ sơ đấu thầu (thông số kỹ thuật tối thiểu) | M | MVP |
| SZ4-07 | Mỗi dòng BOM truy vết ngược được về component và con số sizing đã sinh ra nó | M | MVP |
| SZ4-08 | Ước lượng network: số cổng switch, uplink | S | v1.1 |
| SZ4-09 | Trường đơn giá và tổng tiền (ẩn trong v1) | C | v2 |
| SZ4-10 | **Danh sách top 3 vendor theo hạng mục** do curator quản lý trong catalog, rà soát lại hằng năm và ghi rõ căn cứ xếp hạng. Đề xuất ban đầu: **Server**: Gartner không có Magic Quadrant cho server, nên dùng thị phần IDC trong nhóm vendor có kênh phân phối enterprise tại Việt Nam, tức **Dell, HPE, Lenovo**. **Storage**: các Leader trong Gartner Magic Quadrant for Enterprise Storage Platforms 2025 (đã xác nhận NetApp, HPE, Pure Storage; curator chốt danh sách đầy đủ từ báo cáo gốc) | M | MVP |
| SZ4-11 | **Kiểm tra spec trung lập:** mỗi dòng thông số phải được đáp ứng bởi ≥ 1 model của **mỗi** vendor trong top 3 (đối chiếu catalog). Dòng nào chỉ 1–2 vendor đáp ứng được thì cảnh báo nguy cơ "chỉ định thương hiệu" và gợi ý nới thông số | M | MVP |

#### EP-SZ5. Kịch bản và phân tích độ nhạy

| ID | Yêu cầu | Ưu tiên | Release |
|---|---|---|---|
| SZ5-01 | Các kịch bản: baseline, tăng trưởng năm N, N-1 (mất 1 node/host) | M | MVP |
| SZ5-02 | Các kịch bản: đỉnh sự kiện (×k), DR failover (DR gánh toàn bộ tải) | S | MVP |
| SZ5-03 | So sánh các kịch bản hoặc variant cạnh nhau, tô sáng phần chênh lệch | S | MVP |
| SZ5-04 | Phân tích độ nhạy (biểu đồ tornado) và what-if bằng thanh trượt | S | v1.1 |

### 7.2 Nhóm B: DESIGN

#### EP-DS1. Thu nhận yêu cầu và RFP

| ID | Yêu cầu | Ưu tiên | Release |
|---|---|---|---|
| DS1-01 | Upload RFP/TOR (PDF, DOCX, XLSX; tiếng Việt và tiếng Anh) → AI trích xuất yêu cầu chức năng, NFR (SLA, RPO/RTO, bảo mật, tuân thủ), số liệu workload và ràng buộc. Mỗi mục trích dẫn vị trí trong tài liệu gốc | S | MVP |
| DS1-02 | Requirement register: mỗi yêu cầu có ID, nguồn và trạng thái (đã xác nhận / giả định / cần hỏi) | M | MVP |
| DS1-03 | Assumption register: mỗi giả định có nguồn, mức tin cậy, người chịu trách nhiệm, và liên kết tới các con số sizing bị ảnh hưởng | M | MVP |
| DS1-04 | Sinh danh sách câu hỏi làm rõ gửi khách hàng (xuất ra file được) | S | MVP |
| DS1-05 | Ma trận tuân thủ RFP (compliance matrix) | S | v1.1 |

#### EP-DS2. AI Design Copilot

| ID | Yêu cầu | Ưu tiên | Release |
|---|---|---|---|
| DS2-01 | Hai chế độ: Copilot (hỏi đáp từng bước) và Autopilot (AI tự đặt giả định và đánh dấu rõ) | M | MVP |
| DS2-02 | Các bước: Làm rõ → Yêu cầu → Workload → Kiến trúc logic → Kiến trúc triển khai → Sizing → Luồng chính → Rủi ro và failure modes → Tổng kết | M | MVP |
| DS2-03 | Đầu ra của AI là **thay đổi trên design model** (JSON theo schema), được validate với schema và catalog trước khi áp dụng. Người dùng xem diff rồi chấp nhận hoặc từ chối | M | MVP |
| DS2-04 | AI **không tự đưa ra con số sizing**. Khi cần số, AI gọi engine (tool call) và trích dẫn kết quả | M | MVP |
| DS2-05 | Đề xuất 2–3 phương án kiến trúc kèm bảng trade-off | M | MVP |
| DS2-06 | Chat theo ngữ cảnh từng bước hoặc từng component; câu trả lời có trích dẫn Knowledge Hub, kể cả link SysDesAi | M | MVP |

#### EP-DS3. Canvas và các view

| ID | Yêu cầu | Ưu tiên | Release |
|---|---|---|---|
| DS3-01 | Canvas kéo-thả; palette component lấy từ catalog | M | MVP |
| DS3-02 | Các view dựng từ cùng một model: Logical (C4 context/container), Deployment (site → zone → cluster/host → component) | M | MVP |
| DS3-03 | View Sequence và Data flow | S | MVP |
| DS3-04 | Overlay số liệu sizing (vCPU, RAM, storage, số instance) và trạng thái lint ngay trên từng node | M | MVP |
| DS3-05 | Connection có thuộc tính: giao thức, sync/async, throughput | S | MVP |
| DS3-06 | Import/export Mermaid; draw.io; Structurizr DSL | S | MVP (Mermaid) / v1.1 |

#### EP-DS4. Review: lint, ADR, rủi ro

| ID | Yêu cầu | Ưu tiên | Release |
|---|---|---|---|
| DS4-01 | Rule engine kiểm tra design model, có **≥ 25 rule built-in**. Ví dụ: SPOF; chỉ có 1 site trong khi RPO/RTO yêu cầu DR; DB ở Prod không có replica; không có backup; cơ chế replication không đáp ứng RPO; K8s control plane < 3; Kafka RF < 3; ES heap > 31 GB; utilization vượt mục tiêu; DB đặt trong DMZ; thiếu monitoring/logging; endpoint public không có WAF | M | MVP |
| DS4-02 | Bộ rule riêng theo chuẩn kiến trúc của doanh nghiệp | S | v1.1 |
| DS4-03 | Mỗi finding có mức độ, giải thích, cách khắc phục và link tri thức; cho phép "chấp nhận rủi ro" kèm lý do | M | MVP |
| DS4-04 | Sinh ADR từ quyết định trên bảng trade-off | M | MVP |
| DS4-05 | Risk register và bảng failure mode (failure → impact → mitigation) | S | MVP |
| DS4-06 | Checklist Well-Architected | S | v1.1 |

#### EP-DS5. Cộng tác, version, phê duyệt

| ID | Yêu cầu | Ưu tiên | Release |
|---|---|---|---|
| DS5-01 | Workspace theo khách hàng. Phân quyền theo dự án: presales chỉ thấy khách hàng mình phụ trách | M | MVP |
| DS5-02 | Snapshot version; so sánh 2 version (component, giả định, kết quả sizing, BOM) | M | MVP |
| DS5-03 | Quy trình duyệt: Draft → In review → Approved (baseline bị khóa) → Superseded | M | MVP |
| DS5-04 | Clone dự án; tạo từ template hoặc reference architecture | M | MVP |
| DS5-05 | Comment trên component, bước, dòng BOM; mention | S | MVP |

#### EP-DS6. Xuất tài liệu

| ID | Yêu cầu | Ưu tiên | Release |
|---|---|---|---|
| DS6-01 | HLD dạng DOCX: dùng **template built-in** (đề xuất ở 06-hld-template-proposal.md), hoặc **template của công ty** upload sau, có placeholder (logo, style, mục lục, các section cấu hình được) | M | MVP |
| DS6-02 | Sizing workbook dạng XLSX, **giữ nguyên công thức trong Excel** để reviewer kiểm tra | M | MVP |
| DS6-03 | BOM cấu hình dạng XLSX (theo vendor hoặc spec trung lập) | M | MVP |
| DS6-04 | Sơ đồ dạng PNG/SVG; danh sách giả định và câu hỏi làm rõ | M | MVP |
| DS6-05 | Ngôn ngữ đầu ra Việt/Anh, chọn theo dự án | M | MVP |
| DS6-06 | PDF; Markdown spec cho AI coding agent | S | MVP |

### 7.3 Nhóm C: KNOWLEDGE HUB

#### EP-KH1. Phase 1: tra cứu tham chiếu SysDesAi Gallery (MVP)

Spec chi tiết ở **03-kh-phase1-sysdesai-reference-search.md** (KH-P1-01 đến KH-P1-15). Tóm tắt:

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| KH1-01 | Index khoảng 784 design public (sitemap kết hợp 3 tab gallery), **theo từng bước** | M |
| KH1-02 | Crawl có trách nhiệm: tuân thủ robots.txt, ≤ 1 request mỗi 3 giây, có kill switch | M |
| KH1-03 | Tìm kiếm hybrid keyword + semantic; truy vấn tiếng Việt tìm ra nội dung tiếng Anh | M |
| KH1-04 | Kết quả gồm link design, "Bước N: tên bước" khớp, đoạn trích, link bài gốc (với design thuộc tab Real World), ghi nguồn và nhãn AI-generated | M |
| KH1-05 | Hỏi đáp RAG có trích dẫn link; số liệu estimate luôn kèm cảnh báo chưa kiểm chứng | M |
| KH1-06 | Panel "Tham chiếu SysDesAi" trong design studio | S |
| KH1-07 | Không đưa số liệu SysDesAi vào catalog hay sizing engine | M |

#### EP-KH2. Phase 2: blog kỹ thuật public (v1.1)

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| KH2-01 | Source registry (allowlist) và connector RSS/Atom, sitemap, trích xuất HTML. Nguồn khởi đầu: danh sách đã kiểm tra trong **04-knowledge-sources-phase2.md** | M |
| KH2-02 | Khử trùng lặp (theo URL canonical và near-duplicate); lọc độ liên quan và chất lượng; phân loại theo taxonomy | M |
| KH2-03 | Tóm tắt song ngữ, tập trung vào quyết định và trade-off; giao diện hiển thị tóm tắt kèm link gốc | M |
| KH2-04 | Trích xuất tri thức dạng đơn vị nhỏ (pattern, trade-off, benchmark) làm **ứng viên**, đưa vào hàng đợi duyệt của curator | S |
| KH2-05 | Hiển thị độ tin cậy nguồn: tài liệu vendor > blog kỹ thuật của công ty > bài cá nhân | M |

#### EP-KH3. Phase 3: Facebook / LinkedIn (v2)

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| KH3-01 | **Không crawl tự động** vì ToS cấm. Thay bằng: tiện ích trình duyệt "Clip" để người dùng gửi bài họ đang đọc; dán link kèm nội dung; API chính thức cho Page hoặc Organization mà công ty sở hữu | S |

#### EP-KH4. Tri thức có cấu trúc (dùng chung cho mọi phase)

| ID | Yêu cầu | Ưu tiên | Release |
|---|---|---|---|
| KH4-01 | **Tech card** đã duyệt: mô tả, khi nào dùng/không dùng, giới hạn, tham số sizing mặc định, best practice HA/DR, nguồn. Engine sizing đọc trực tiếp từ đây | M | MVP |
| KH4-02 | Pattern library (≥ 30 pattern khởi đầu); thư viện reference architecture nội bộ | M | MVP |
| KH4-03 | Tri thức theo ngữ cảnh: chọn một component thì thấy tech card, pattern và tham chiếu liên quan; mỗi finding của lint có link giải thích | M | MVP |
| KH4-04 | Upload tài liệu nội bộ (chuẩn kiến trúc, HLD cũ) vào hub riêng tư | C | v2 |

### 7.4 Nhóm D: NỀN TẢNG VÀ CATALOG

#### EP-PL1. Catalog (dữ liệu chuẩn cho engine)

| ID | Yêu cầu | Ưu tiên | Release |
|---|---|---|---|
| PL1-01 | Hardware catalog: model server, CPU SKU (core, GHz, chỉ số hiệu năng để quy đổi giữa các đời CPU), loại đĩa (dung lượng, IOPS, throughput, độ bền ghi) | M | MVP |
| PL1-02 | Profile storage array: RAID/EC hỗ trợ, IOPS/throughput theo cấu hình, dung lượng tối đa | M | MVP |
| PL1-03 | Cloud catalog (instance, disk, managed service) cho AWS và Azure, đồng bộ định kỳ từ API công khai của provider | M | MVP |
| PL1-04 | Catalog license metric: theo core, socket, VM, node, kèm các quy tắc tối thiểu | S | MVP |
| PL1-05 | Version hóa catalog; dự án ghim version; import/export qua Excel/JSON | M | MVP |
| PL1-06 | **Viettel Cloud và FPT Cloud:** không có API catalog công khai như AWS/Azure, nên import flavor, disk và dịch vụ qua Excel template, curator cập nhật định kỳ. Các cloud trong nước khác (VNG, CMC…) dùng cùng cơ chế khi cần | M | MVP |

#### EP-PL2. LLM gateway và bảo vệ dữ liệu

| ID | Yêu cầu | Ưu tiên | Release |
|---|---|---|---|
| PL2-01 | Lớp trừu tượng nhiều provider. **MVP: Microsoft (Azure OpenAI / Microsoft Foundry) và AWS Bedrock.** Cấu hình model riêng cho từng tính năng (trích xuất RFP, copilot, tóm tắt, RAG). Lưu ý: "Microsoft Copilot" là sản phẩm dành cho người dùng cuối; muốn ứng dụng gọi được model của Microsoft thì dùng API Azure OpenAI / Foundry | M | MVP |
| PL2-02 | **Ẩn danh trước khi gửi:** thay tên khách hàng, tên hệ thống, IP, hostname, email, số điện thoại bằng token, và khôi phục lại khi nhận kết quả | M | MVP |
| PL2-03 | Chính sách AI theo dự án: bật / chỉ gửi dữ liệu đã ẩn danh / tắt hoàn toàn | M | MVP |
| PL2-04 | Chỉ dùng endpoint doanh nghiệp có cam kết không dùng dữ liệu để train và có thời gian lưu dữ liệu giới hạn; chọn được region | M | MVP |
| PL2-05 | Log prompt/response có kiểm soát; không log dữ liệu chưa ẩn danh | M | MVP |
| PL2-06 | Quota và theo dõi chi phí token; fallback sang provider khác; timeout và retry | S | MVP |
| PL2-07 | Tích hợp **Microsoft 365 Copilot**: agent hoặc connector cho phép hỏi ArchSizer ngay trong Teams/Copilot (tra cứu tham chiếu, trạng thái dự án) | C | v2 |

#### EP-PL3. Định danh, phân quyền, kiểm toán

| ID | Yêu cầu | Ưu tiên | Release |
|---|---|---|---|
| PL3-01 | SSO: LDAP/AD, OIDC/SAML (Entra ID, Keycloak) | M | MVP |
| PL3-02 | RBAC: Admin, Curator, Architect/Presales, Reviewer, Viewer; phân quyền ở cấp workspace và dự án | M | MVP |
| PL3-03 | Audit log: đăng nhập; xem, sửa, xuất dự án; thay đổi catalog; các lần gọi AI | M | MVP |

#### EP-PL4. Triển khai và vận hành

| ID | Yêu cầu | Ưu tiên | Release |
|---|---|---|---|
| PL4-01 | Cài đặt nội bộ **trên VMware**: các VM Linux chạy Docker Compose (app, worker, PostgreSQL, object storage), có tài liệu yêu cầu cấu hình VM và tùy chọn đóng gói OVA. Helm chart cho K8s để v1.1 | M | MVP |
| PL4-02 | **Sẵn sàng chạy trên cloud:** ứng dụng stateless; cấu hình qua env/secret; object storage chuẩn S3; DB tương thích PostgreSQL managed | M | MVP |
| PL4-03 | Chỉ mở outbound internet tối thiểu: LLM endpoint, các nguồn crawl, API catalog cloud; hỗ trợ proxy doanh nghiệp | M | MVP |
| PL4-04 | Backup/restore; tự giám sát ứng dụng (metrics, log, trace); health check | M | MVP |
| PL4-05 | Giao diện song ngữ Việt/Anh | M | MVP |

---

## 8. Yêu cầu phi chức năng

| ID | Hạng mục | Yêu cầu |
|---|---|---|
| NFR-01 | Tính đúng | Golden test cho mọi sizing model; CI chặn release nếu test fail; kết quả tái lập 100% |
| NFR-02 | Hiệu năng | Tính lại sizing cho dự án ≤ 200 component: p95 ≤ 2 giây. Canvas 300 node chạy mượt. Tìm kiếm tri thức p95 ≤ 1–2 giây. RAG p95 ≤ 10 giây. Mỗi bước AI design p95 ≤ 60 giây |
| NFR-03 | Quy mô v1 | 300 user, 50 user đồng thời, 2,000 dự án, 200,000 tài liệu tri thức |
| NFR-04 | Sẵn sàng | 99.5% trong giờ hành chính; RPO ≤ 1 giờ, RTO ≤ 4 giờ cho dữ liệu ứng dụng |
| NFR-05 | Bảo mật | OWASP ASVS L2; TLS 1.2 trở lên; mã hóa dữ liệu lưu trữ; secret đặt trong vault; quét SAST, DAST và dependency trong CI |
| NFR-06 | Dữ liệu khách hàng | Cô lập theo workspace. Không gửi dữ liệu khách hàng tới LLM khi chưa qua lớp ẩn danh, trừ khi chính sách của dự án cho phép |
| NFR-07 | Dễ dùng | Người dùng mới hoàn thành sizing cho dự án mẫu trong ≤ 2 giờ, sau 30 phút hướng dẫn |
| NFR-08 | Mở rộng | Thêm sizing model và rule bằng cấu hình; thêm connector nguồn tri thức dạng plugin |
| NFR-09 | Truy vết | Mọi con số đầu ra truy vết được về input, công thức, version của model và catalog |
| NFR-10 | Thu thập tri thức | Tuân thủ robots.txt và ToS; giới hạn tốc độ; chỉ lưu tóm tắt và link; có quy trình gỡ bỏ nội dung khi được yêu cầu |
| NFR-11 | Ngôn ngữ | Xử lý đúng RFP tiếng Việt có dấu; tìm kiếm chéo ngôn ngữ Việt ↔ Anh |

## 9. Mô hình dữ liệu khái niệm

```
Workspace (khách hàng / tài khoản) ─1:n─ Project ─1:n─ DesignVersion
DesignVersion
 ├─ Requirement[] · Assumption[] (nguồn, độ tin cậy, liên kết tới SizingResult)
 ├─ WorkloadProfile (nghiệp vụ, người dùng, dữ liệu, kỳ kế hoạch)
 ├─ Component[] (type → SizingModel) · Connection[]
 ├─ Placement: Site · Zone · Environment · Platform
 ├─ DeploymentVariant[] · Scenario[]
 ├─ SizingRun (input hash, version model, version catalog) → SizingResult[] → BOMItem[]
 ├─ Finding[] (Rule) · ADR[] · Risk[]
 └─ ReferenceLink[] (design SysDesAi / bài viết được ghim làm tham chiếu)
RulePack (có version, vòng đời Draft → Published) → SizingModel → Inputs · Params · Calc ·
                      Outputs · Warnings · Lookups · Tests  (xem 05 §2)
Catalog (có version): HardwareModel · CpuSku · DiskType · StorageArrayProfile ·
                      CloudInstanceType (AWS, Azure, Viettel, FPT) · ManagedService ·
                      TechCard · LicenseMetric · VendorRanking (top 3 theo hạng mục)
DocTemplate (có version): built-in VI/EN · template DOCX của công ty  (xem 06)
Knowledge: ExternalSource → ExternalDesign → ExternalStep  (phase 1, xem 03 §6)
           Source → KnowledgeItem → KnowledgeAtom → CurationRecord  (phase 2+)
```

## 10. Phụ lục: ví dụ truy vết một con số (minh họa nguyên tắc PR-2)

Người dùng bấm vào ô **"Kafka broker: 14"** và thấy:

| Ràng buộc | Công thức | Giá trị |
|---|---|---|
| Throughput | ceil(150 MB/s × RF 3 / 100 MB/s mỗi broker / 0.6) = ceil(7.5) | 8 |
| Storage | 150 MB/s × 86,400 s × 3 ngày retention × RF 3 = 116.64 TB; mỗi broker 12 TB × 70% fill = 8.4 TB → ceil(13.9) | **14** ← quyết định |
| Tối thiểu | ≥ RF | 3 |
| **Kết quả** | max(8, 14, 3) | **14 broker** |

Nguồn tham số: `100 MB/s/broker` và `70% fill` lấy từ tech card Kafka (catalog v2026.10, đã duyệt). `150 MB/s` và `retention 3 ngày` do khách hàng cung cấp theo RFP mục 4.2.

## 11. Lộ trình đề xuất

| Release | Trọng tâm | Phạm vi chính |
|---|---|---|
| **MVP (v1.0)** | Presales sizing end-to-end và tra cứu tham chiếu | **Rule builder và Excel import** (05); SZ1–SZ4, SZ5 cơ bản; nền tảng VMware, bare-metal, SAN, K8s, **AWS, Azure, Viettel Cloud, FPT Cloud**; BOM top 3 vendor và spec trung lập; DS1–DS6, template HLD built-in (06); **Knowledge Hub phase 1 (SysDesAi)**; tech card và pattern; LLM qua Azure và Bedrock; PL1–PL4 |
| **v1.1** | Mở rộng cho enterprise | Knowledge Hub phase 2 (blog); custom lint rule; so sánh variant; phân tích độ nhạy; compliance matrix; Well-Architected; Helm chart |
| **v2** | Giá trị và SaaS | Giá/TCO; GCP; hiệu chỉnh sizing từ monitoring; IaC; Knowledge Hub phase 3 (clip FB/LinkedIn); tích hợp M365 Copilot; tài liệu nội bộ; multi-tenant SaaS |

> Nếu cần rút gọn MVP: chỉ AWS và một cloud trong nước, 6 sizing model, 15 lint rule, import Excel chỉ theo chế độ template.
>
> Nếu chọn phương án hợp nhất với ArchPilot (07), lộ trình này trở thành lộ trình v3 của ArchPilot và tái sử dụng graph core, canvas, sizing engine và catalog đã build.

## 12. Quyết định và câu hỏi còn mở

### 12.1 Quyết định của PO (2026-10-14)

| ID | Câu hỏi | Quyết định | Áp dụng vào |
|---|---|---|---|
| Q-01 | Xin phép SysDesAi? | **Không cần.** Dùng SysDesAi như một công cụ tra cứu, giống cách người dùng vẫn dùng. Vẫn giữ ghi nguồn và giới hạn tốc độ crawl theo Terms | 03 §9 R-P1-02 |
| Q-02 | LLM provider | **Microsoft (Azure OpenAI / Foundry) và AWS Bedrock** | PL2-01, PL2-07 |
| Q-03 | Vendor BOM | Không phải hạng mục quan trọng. **Ưu tiên top 3 vendor**; spec trung lập phải **đáp ứng được cả top 3** | SZ4-06, SZ4-10, SZ4-11 |
| Q-04 | Cloud | **AWS, Azure, Viettel Cloud, FPT Cloud**; GCP để v2 | SZ3-07, PL1-03, PL1-06 |
| Q-05 | Excel sizing nội bộ | **Cho phép import rule từ Excel hoặc tự tạo rule theo nhu cầu** | SZ2-05, SZ2-06, file 05 |
| Q-06 | Template HLD | Để mở, PO upload sau; trước mắt dùng **template đề xuất** | DS6-01, file 06 |
| Q-07 | Hạ tầng cài đặt | **VMware** | PL4-01 |
| Q-08 | Quan hệ với ArchPilot | PO giao đánh giá và đề xuất. **Khuyến nghị: hợp nhất, phát triển thành ArchPilot v3 theo định vị ArchSizer** | file 07 |

### 12.2 Câu hỏi còn mở

| ID | Câu hỏi | Mặc định đang áp dụng nếu chưa trả lời |
|---|---|---|
| Q-09 | Đồng ý phương án hợp nhất với ArchPilot (07 §1) và các hướng xử lý xung đột X-1 đến X-6? Riêng X-2 cần PO ký lại content policy của ArchPilot | Giữ 2 folder tách biệt cho tới khi PO xác nhận |
| Q-10 | Với RFP có NDA cấm chia sẻ cho bên thứ ba: chính sách "tắt AI theo dự án" và ẩn danh đã đủ chưa? | Đủ; dự án có NDA mặc định tắt AI |
| Q-11 | Quy mô người dùng v1 | 300 user, 50 user đồng thời (NFR-03) |
| Q-12 | Tên sản phẩm chính thức | "ArchSizer" là tên tạm |

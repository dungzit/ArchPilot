# ArchPilot Pilot: Phiếu nghiệm thu dành cho người dùng (UAT)

| Mục | Nội dung |
|---|---|
| Tác giả | BA/QA Analyst |
| Ngày | 2026-10-14 (dùng cho pilot bắt đầu 2026-10-15) |
| Phiên bản | 0.1 |
| Trạng thái | Bản nháp, cần chạy thử một lần bởi một người không chuyên kỹ thuật trước giờ pilot |
| Tài liệu liên quan | `docs/v3/pilot/test-cases.md` (test chi tiết cho QA), `docs/v3/pilot/search-queries.csv`, `docs/v3/02-requirements.md`, `03-kh-phase1-sysdesai-reference-search.md`, `05-sizing-rule-builder.md`, `06-hld-template-proposal.md` |

## 1. Tóm tắt / Executive summary

**Tiếng Việt.** Phiếu này hướng dẫn bạn thử toàn bộ các tính năng chính của bản pilot ArchPilot trong tối đa 45 phút: đăng nhập, vẽ thiết kế, tra cứu thiết kế tham chiếu trên SysDesAi, tính sizing theo rule (có xem từng bước tính), import/export Excel, và xuất tài liệu HLD dạng Word. Mỗi bước có việc cần làm và kết quả mong đợi; bạn chỉ cần đánh dấu Pass hoặc Fail và ghi chú nếu thấy khác. Cuối phiếu có phần góp ý ngắn (điểm dễ dùng từ 1 đến 5 và 3 vấn đề lớn nhất) để đánh giá pilot. Bản pilot không dùng AI: mọi con số do công thức cố định tính ra, nên cùng đầu vào luôn cho cùng kết quả.

**English.** This checklist walks a pilot user through every must-have feature of the ArchPilot pilot in at most 45 minutes: login, design canvas, SysDesAi reference search, rule-based sizing with a step-by-step trace, Excel import/export, and HLD export to Word. Each step states the action and the expected result; the tester only marks Pass or Fail and adds a note when something differs. A short feedback section (usability 1 to 5, top 3 issues) closes the sheet. The pilot uses no AI: every number comes from deterministic formulas.

## 2. Bối cảnh và mục tiêu

- **Mục tiêu:** xác nhận bản pilot dùng được cho công việc presales / solution architect, và thu thập góp ý để quyết định bước tiếp theo.
- **Ai làm:** khoảng 30 người dùng nội bộ, mỗi người một tài khoản riêng, trên trình duyệt Chrome hoặc Edge bản mới.
- **Phạm vi:** 6 phần A đến F bên dưới và phần góp ý G. Không kiểm thử AI (pilot không có AI).
- **Không nhập thông tin khách hàng thật hoặc tài liệu có NDA.** Chỉ dùng dữ liệu mẫu trong phiếu này cho tới khi điều phối viên cho phép.
- **Nội dung SysDesAi** do AI sinh ra, chỉ để tham khảo. Không dùng các con số trong đó làm đầu vào sizing.

## 3. Thông tin người thử

| Mục | Điền |
|---|---|
| Họ tên | |
| Vai trò (presales / SA / khác) | |
| Ngày và giờ bắt đầu | |
| Trình duyệt (Chrome / Edge) và phiên bản | |
| Địa chỉ pilot (điều phối viên điền) | `http://________________` |
| Tên đăng nhập (điều phối viên cấp) | |
| Mức quen thuộc với công cụ thiết kế (1 = chưa dùng, 5 = thành thạo) | |

## 4. Cách làm phiếu này

1. Làm lần lượt từ phần A đến phần G. Mỗi phần có thời gian gợi ý.
2. Mỗi dòng: làm theo cột "Việc cần làm", so với cột "Kết quả mong đợi", rồi đánh dấu **Pass** (giống mong đợi) hoặc **Fail** (khác). Gõ P hoặc F vào cột "Pass / Fail".
3. Khi Fail: ghi vào cột "Ghi chú" điều bạn thấy (ví dụ nội dung thông báo lỗi). Chụp màn hình bằng phím **Windows + Shift + S**, dán vào email hoặc nhóm chat pilot, và ghi mã bước (ví dụ C4).
4. Nếu một bước bị kẹt, bấm F5 tải lại trang một lần. Nếu vẫn kẹt, ghi Fail và chuyển sang bước tiếp theo. Đừng dừng cả phiếu vì một bước.
5. Các bước đánh dấu **(tùy chọn)** làm khi còn thời gian. Nếu bỏ qua, ghi "bỏ qua".
6. Tên nút có thể khác một chút so với phiếu (ví dụ "Chạy" hay "Tính"). Hãy tìm nút có ý nghĩa tương đương; nếu khó tìm, ghi vào Ghi chú, đó cũng là phản hồi hữu ích.
7. Dấu thập phân có thể hiển thị là `31.5` hoặc `31,5`; cả hai đều đúng.

**Thời gian gợi ý (tổng tối đa 45 phút).**

| Phần | Nội dung | Phút (bắt buộc) | Thêm nếu làm bước tùy chọn |
|---|---|---|---|
| 0 | Chuẩn bị | 2 | 0 |
| A | Đăng nhập | 3 | 0 |
| B | Thiết kế (canvas) | 4 | +2 |
| C | Tra cứu SysDesAi | 6 | +2 |
| D | Sizing theo rule | 10 | +2 |
| E | Import/Export Excel và soạn rule | 5 | +2 |
| F | Xuất HLD | 4 | 0 |
| G | Góp ý | 3 | 0 |
| | **Tổng** | **37** | **45 nếu làm hết các bước tùy chọn** |

**Quy tắc thời gian.** Nếu một phần vượt thời gian gợi ý quá 3 phút, ghi "hết giờ" vào các bước còn lại của phần đó rồi sang phần tiếp theo. Dù thế nào cũng dành 3 phút cuối cho phần G.

**Chuẩn bị (phần 0, 2 phút).** Mở sẵn Microsoft Word và Excel (cần ở phần E và F). Ghi giờ bắt đầu ở mục 3. Giữ cửa sổ trình duyệt ở mức thu phóng 100%.

## 5. Phần A: Đăng nhập (3 phút)

| Bước | Việc cần làm | Kết quả mong đợi | Pass / Fail | Ghi chú |
|---|---|---|---|---|
| A1 | Mở địa chỉ pilot trên trình duyệt. | Thấy màn "Đăng nhập" có ô "Tên đăng nhập", ô "Mật khẩu", nút "Đăng nhập" và nút chuyển ngôn ngữ VI / EN. Giao diện bằng tiếng Việt. | | |
| A2 | Để trống cả hai ô, bấm "Đăng nhập". | Dòng chữ đỏ "Nhập tên đăng nhập và mật khẩu." Trang không bị treo. | | |
| A3 | Gõ đúng tên đăng nhập nhưng sai mật khẩu, bấm "Đăng nhập". Chỉ thử **một lần**. | Dòng đỏ "Sai tên đăng nhập hoặc mật khẩu." Ô mật khẩu được xóa, tên đăng nhập còn nguyên. | | |
| A4 | Gõ đúng tên và mật khẩu, bấm "Đăng nhập". | Vào được ứng dụng. Menu bên trái có "Thiết kế", "Tra cứu SysDesAi", "Sizing theo rule", "Xuất HLD". Có nút "Đăng xuất". | | |
| A5 | Bấm phím F5 để tải lại trang. | Vẫn đang đăng nhập, không bị đưa về màn "Đăng nhập". | | |
| A6 | Bấm "Đăng xuất". Sau đó bấm nút quay lại (mũi tên Back) của trình duyệt. | Về màn "Đăng nhập" với dòng "Bạn đã đăng xuất." Sau khi bấm Back vẫn chỉ thấy màn đăng nhập, không xem được dữ liệu. Đăng nhập lại để làm tiếp. | | |

## 6. Phần B: Thiết kế (canvas) (4 phút, +2 tùy chọn)

Thiết kế bạn tạo ở đây sẽ được dùng lại ở phần C, D và F.

| Bước | Việc cần làm | Kết quả mong đợi | Pass / Fail | Ghi chú |
|---|---|---|---|---|
| B1 | Bấm "Thiết kế" ở menu trái. | Trang "Thiết kế" có danh sách thiết kế (hoặc dòng "Chưa có thiết kế nào") và nút "Thiết kế mới". | | |
| B2 | Bấm "Thiết kế mới". Ở ô "Tên thiết kế" gõ `UAT-` và tên của bạn (ví dụ `UAT-Lan`). Bấm "Tạo thiết kế trống". | Mở ra canvas trống với dòng "Canvas đang trống". | | |
| B3 | Thêm ít nhất 3 thành phần: bấm "Thêm địa điểm" cho thành phần đầu, rồi nhấn phím `/` để mở menu lệnh hoặc dùng bảng "Thành phần" (ô "Tìm thành phần") để thêm một phân đoạn mạng và một máy chủ hoặc cơ sở dữ liệu. | Mỗi thành phần hiện trên canvas. Kéo thả được để di chuyển. | | |
| B4 | Nối hai thành phần bằng một kết nối (dùng nút "Kết nối" hoặc kéo từ điểm nối). | Xuất hiện đường nối giữa hai thành phần. | | |
| B5 | Bấm vào một thành phần, đổi "Nhãn" ở bảng "Thuộc tính". | Tên mới hiện ngay trên canvas. | | |
| B6 | Bấm Ctrl+S (hoặc chờ vài giây). | Thanh trạng thái hiện "Đã lưu · bản N" (N là số). Không hiện "Chưa lưu" kéo dài. | | |
| B7 (tùy chọn) | Bấm Ctrl+Z để hoàn tác một thao tác, rồi Ctrl+Y để làm lại. | Thao tác được hoàn tác rồi làm lại đúng. | | |
| B8 | Bấm F5. Sau đó bấm "Về danh sách thiết kế". | Thiết kế còn nguyên các thành phần và kết nối đã vẽ. Tên `UAT-...` có trong danh sách. | | |
| B9 (tùy chọn) | Mở lại thiết kế, mở bảng "Vấn đề". | Hiện danh sách vấn đề hoặc "Không có vấn đề nào." Không báo lỗi lạ. | | |

## 7. Phần C: Tra cứu SysDesAi (6 phút, +2 tùy chọn)

Công cụ tìm trong khoảng 784 thiết kế tham chiếu của SysDesAi. Bạn gõ tiếng Việt hoặc tiếng Anh, có dấu hoặc không dấu.

| Bước | Việc cần làm | Kết quả mong đợi | Pass / Fail | Ghi chú |
|---|---|---|---|---|
| C1 | Bấm "Tra cứu SysDesAi" ở menu trái. | Có ô tìm kiếm. Có dòng trạng thái chỉ mục: số thiết kế đã lập chỉ mục (khoảng 784 hoặc ít nhất 768) và thời điểm cập nhật gần nhất. | | |
| C2 | Gõ `URL shortener`, nhấn Enter. | Kết quả **đầu tiên** là "URL Shortener", có đường dẫn `https://www.sysdesai.com/share/ExMwREO`. | | |
| C3 | Nhìn kỹ thẻ kết quả "URL Shortener". | Thẻ có đủ: tiêu đề; đường dẫn; các dòng "Bước N: tên bước" (tối đa 3); đoạn trích ngắn; dòng "Nguồn: SysDesAi" kèm đường dẫn; nhãn "Nội dung AI-generated, chỉ để tham khảo"; ngày cập nhật. | | |
| C4 | Xóa ô tìm, gõ tiếng Việt: `bộ nhớ đệm cho chuyển hướng link rút gọn`. | "URL Shortener" nằm trong **3 kết quả đầu**, và thẻ có dòng "Bước 8: Add Cache Layer for Redirects". | | |
| C5 | Gõ lại câu trên nhưng **không dấu**: `bo nho dem cho chuyen huong link rut gon`. | Ra cùng kết quả như C4. | | |
| C6 | Bấm đường dẫn của "URL Shortener". Trên trang SysDesAi vừa mở, tự chuyển qua các bước và đếm (bước đầu tiên là bước 1). | Mở ở tab mới, đúng thiết kế URL Shortener. Bước thứ 8 là "Add Cache Layer for Redirects". Nếu máy không vào được sysdesai.com, ghi "không mở được" vào Ghi chú. | | |
| C7 | Chọn **2 trong 4** câu sau và gõ vào ô tìm (xem bảng gợi ý bên dưới). | Mỗi câu cho ra thiết kế mong đợi trong 3 kết quả đầu. Ghi vào Ghi chú câu bạn chọn và kết quả có hữu ích không (1 đến 5). | | |
| C8 (tùy chọn) | Gõ `zzzzqqqq` rồi nhấn Enter. | Thông báo không tìm thấy tham chiếu phù hợp. Không bị treo, không có vòng quay vô tận. | | |
| C9 (tùy chọn) | Gõ `<script>alert(1)</script>` rồi nhấn Enter. | Không hiện hộp thoại nào. Dòng bạn gõ hiện như chữ bình thường. Không có trang trắng hoặc lỗi đỏ dài. | | |
| C10 | Trên thẻ "URL Shortener", dùng nút ghim ("Ghim vào thiết kế" hoặc tương đương). Chọn thiết kế `UAT-...` của bạn, chọn "Bước 8" nếu có, thêm ghi chú ngắn, xác nhận. | Có thông báo đã ghim. Tham chiếu hiện trong danh sách tham chiếu của thiết kế. Nếu không thấy nút ghim, ghi Fail. | | |
| C11 (tùy chọn) | Gõ `Netflix`. Tìm một kết quả có dòng "Bài gốc". | Dòng "Bài gốc: tên blog, đường dẫn bài" có link hoạt động. | | |
| C12 (tùy chọn) | Gõ `rate limiter`. Mở link kết quả đầu tiên. | Thiết kế "Rate Limiter for API Gateway" xuất hiện trong 3 kết quả đầu và link mở đúng trang. | | |

Bảng gợi ý cho C7:

| Câu gõ | Thiết kế nên thấy trong 3 kết quả đầu |
|---|---|
| `gửi thông báo đẩy, email và SMS cho người dùng` | Notification System |
| `làm sao để giới hạn số lần gọi API của mỗi người dùng` | Rate Limiter for API Gateway |
| `thiết kế hệ thống thanh toán trực tuyến giống Stripe` | Payment Processing System |
| `hàng đợi công việc và lập lịch tác vụ nền` | Job Queue and Task Scheduling System |

## 8. Phần D: Sizing theo rule (10 phút, +2 tùy chọn)

Bộ rule có sẵn tên `archpilot-core` gồm 6 model. Mỗi kết quả phải cho thấy **từng bước tính** với số thay vào, và nêu **ràng buộc nào quyết định** kết quả khi có. Nếu ô nhập đã có sẵn đúng giá trị, chỉ cần kiểm tra lại.

| Bước | Việc cần làm | Kết quả mong đợi | Pass / Fail | Ghi chú |
|---|---|---|---|---|
| D1 | Bấm "Sizing theo rule" ở menu trái. | Thấy bộ rule `archpilot-core` với đúng 6 model: app-tier, rdbms, redis, kafka, vmware-host, san-storage. | | |
| D2 | Chọn **app-tier**. Nhập: CCU = `5000`, thời gian phản hồi = `1` giây, think time = `9` giây. Bấm nút chạy. | Kết quả **500 RPS**. Phần các bước hiện công thức với số, dạng `5000 / (1 + 9)`. | | |
| D3 | Đổi think time từ `9` thành `4`. | Kết quả tự cập nhật thành **1000 RPS**. | | |
| D4 | Chọn **redis**. Nhập: 50000000 key; key 40 B; value 500 B; overhead 90 B mỗi key; fill factor `0.7`; 1 replica. Chạy. | Dữ liệu **31.5 GB**; RAM mỗi bản sao **45 GB**; tổng (primary + replica) **90 GB**; **2 shard** (mỗi shard 22.5 GB). Có từng bước tính. Không có cảnh báo. | | |
| D5 | Chọn **kafka**. Nhập: ingress `150` MB/s; replication factor `3`; retention `3` ngày. Chạy. | Số broker theo băng thông = **8**; dung lượng lưu trữ = **116.64 TB**; số broker theo lưu trữ = **14**; kết quả cuối **14 broker**. Có đúng **4 bước** tính. Ràng buộc quyết định là **lưu trữ (storage)**. | | |
| D6 | Vẫn ở kafka: đổi replication factor từ `3` thành `2` (chọn môi trường Prod nếu có ô chọn). | Xuất hiện **cảnh báo mức cao** về replication factor nhỏ hơn 3 ở Prod. Kết quả lúc này là **10 broker** (5 theo băng thông, 10 theo lưu trữ). Đổi lại `3` thì cảnh báo biến mất và kết quả về 14. | | |
| D7 | Chọn **vmware-host**. Nhập: app 400 vCPU tỉ lệ 3:1; DB 120 vCPU tỉ lệ 1:1; RAM 2048 GB; mỗi host 64 core và 1024 GB RAM; mức sử dụng mục tiêu `0.7`; dự phòng N+1. Chạy. | Cần **7 host** (6 host theo CPU, 3 host theo RAM, cộng 1 host dự phòng). Ràng buộc quyết định là **CPU**. | | |
| D8 (tùy chọn) | Chọn **app-tier**, nhập CCU = `-5` (hoặc để thời gian phản hồi = `0` và think time = `0`). Chạy. | Thông báo lỗi tiếng Việt nói rõ ô nào sai. Không hiện `Infinity`, `NaN` hoặc trang trắng. | | |
| D9 | Bấm nút chạy test của rule pack (tên có thể là "Chạy test"). | Tất cả test đạt (màu xanh). Không có test đỏ. | | |
| D10 | Chạy lại kafka với 150 / 3 / 3. Bấm lưu kết quả vào thiết kế, chọn thiết kế `UAT-...`, đặt nhãn `Kafka cluster (Prod)`. Làm tương tự cho vmware-host với nhãn `VMware hosts (Prod)`. | Có thông báo lưu thành công. Sau khi bấm F5, hai lần chạy vẫn còn trong danh sách kết quả đã lưu của thiết kế (kèm model, version rule pack, số liệu đầu vào và kết quả). | | |
| D11 (tùy chọn) | Chọn **rdbms**, rồi **san-storage**; chạy với giá trị mặc định. | Mỗi model cho ra kết quả có các bước tính, không báo lỗi. (Chưa đối chiếu con số, đang chờ xác nhận công thức.) | | |
| D12 (tùy chọn) | Đổi ngôn ngữ giao diện sang EN bằng nút VI/EN rồi đổi lại VI. | Nhãn và cảnh báo đổi ngôn ngữ; các con số không đổi. | | |

## 9. Phần E: Import/Export Excel và soạn rule (5 phút, +2 tùy chọn)

| Bước | Việc cần làm | Kết quả mong đợi | Pass / Fail | Ghi chú |
|---|---|---|---|---|
| E1 | Trong "Sizing theo rule", mở tab Import/Export Excel. Bấm tải template. Mở file vừa tải bằng Excel. | File `.xlsx` mở được. Có các sheet Model, Inputs, Params, Calc, Outputs, Warnings, Lookups, Tests. Đây là ví dụ Kafka; ô kết quả số broker là **14**. | | |
| E2 | Import **chính file template đó**, không sửa gì. | Thông báo thành công. Model Kafka mới hiện ra; test T1 đạt; phần các bước hiện đúng 4 bước và ràng buộc quyết định là "storage". | | |
| E3 | Thử import một file không phải `.xlsx` (một file `.pdf`, `.csv` hoặc `.xlsm` bất kỳ). | Bị từ chối, thông báo chỉ nhận `.xlsx`. Không có model mới nào xuất hiện. | | |
| E4 | Trong Excel, mở file template, ở sheet `Calc` chọn một ô công thức, gõ `=INDIRECT("B2")`, lưu thành `thu-INDIRECT.xlsx`. Import file này. | Bị từ chối. Thông báo nêu hàm **INDIRECT** không được hỗ trợ và **địa chỉ ô** (dạng `Calc!B2`; ghi lại địa chỉ app báo và so với ô bạn đã sửa). Không có model dở dang nào được tạo. | | |
| E5 | Chọn model Kafka đã import, bấm Export Excel. Mở file xuất ra. | Các ô vẫn là **công thức** (bấm vào ô thấy `=...`, không phải số cứng). Số broker tính ra là **14**, bằng kết quả trong app. | | |
| E6 (tùy chọn) | Mở tab "Trình soạn rule", tạo rule mới (hoặc nhân bản một model có sẵn). Thêm bước tính tên `bad_sum` với công thức `ingress + storage` (MB/s cộng TB). | Báo **lỗi đơn vị** nêu rõ tên bước `bad_sum`. Không lưu / không publish được. Sửa thành `ingress * retention` thì hết lỗi. | | |
| E7 (tùy chọn) | Trong trình soạn rule, đặt tên model là `=HYPERLINK("https://example.invalid","bấm vào đây")`. Lưu, export Excel, mở trong Excel. | Ô hiện đúng dòng chữ đó như văn bản. Không thành liên kết, không hiện cảnh báo bảo mật của Excel. | | |

## 10. Phần F: Xuất HLD (4 phút)

| Bước | Việc cần làm | Kết quả mong đợi | Pass / Fail | Ghi chú |
|---|---|---|---|---|
| F1 | Bấm "Xuất HLD" ở menu trái, chọn thiết kế `UAT-...` của bạn. | Thấy tóm tắt: số thành phần, ít nhất 2 kết quả sizing đã lưu, ít nhất 1 tham chiếu đã ghim. | | |
| F2 | Bấm nút xuất DOCX. | Tải về một file `.docx` (tên dạng `HLD_...`). | | |
| F3 | Mở file bằng Word. | Mở được, **không** có thông báo "nội dung không đọc được / cần sửa chữa". Tiếng Việt hiện đúng dấu, không có ô vuông thay chữ. | | |
| F4 | Lướt qua tài liệu. | Có các mục: thông tin tài liệu (tên thiết kế, ngày, người lập); kiến trúc (danh sách thành phần); sizing; phụ lục chi tiết các bước tính; tham chiếu. | | |
| F5 | So số liệu mục sizing với màn hình "Sizing theo rule". | Kafka: **14 broker**, **116.64 TB**, ràng buộc lưu trữ. VMware: **7 host**, ràng buộc CPU. Có ghi tên bộ rule `archpilot-core` và version. Số giống hệt trên màn hình. | | |
| F6 | Ở mục tham chiếu, giữ Ctrl và bấm vào tên "URL Shortener". | Mở `https://www.sysdesai.com/share/ExMwREO`. Có dòng "Bước 8: Add Cache Layer for Redirects", "Nguồn: SysDesAi" và nhãn "Nội dung AI-generated, chỉ để tham khảo". | | |
| F7 | Tạo một thiết kế mới tên `UAT-trong-` và tên bạn, **không thêm gì**. Xuất HLD cho thiết kế này. | Vẫn xuất được file và mở được. Phần chưa có dữ liệu ghi rõ là chưa có. Không có chữ `undefined` hoặc `NaN`. | | |

## 11. Phần G: Góp ý (3 phút)

Điền ngay sau khi làm xong, trong khi còn nhớ.

**G1. Tự đánh giá kết quả.**

| Phần | Số bước Pass | Số bước Fail | Số bước bỏ qua |
|---|---|---|---|
| A Đăng nhập | | | |
| B Thiết kế | | | |
| C Tra cứu SysDesAi | | | |
| D Sizing theo rule | | | |
| E Excel và soạn rule | | | |
| F Xuất HLD | | | |

Thời gian thực tế bạn làm xong (phút): ______

**G2. Điểm dễ dùng và hữu ích** (khoanh một số, 1 = rất kém, 5 = rất tốt).

| Nội dung | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| Mức độ dễ dùng chung của ứng dụng (usability) | ☐ | ☐ | ☐ | ☐ | ☐ |
| Tra cứu SysDesAi hữu ích với công việc của tôi | ☐ | ☐ | ☐ | ☐ | ☐ |
| Sizing theo rule: dễ hiểu, tin được con số | ☐ | ☐ | ☐ | ☐ | ☐ |
| Import/Export Excel | ☐ | ☐ | ☐ | ☐ | ☐ |
| Tài liệu HLD xuất ra dùng được ngay | ☐ | ☐ | ☐ | ☐ | ☐ |

**G3. Ba vấn đề lớn nhất bạn gặp.** Mức độ: **Chặn** (không làm tiếp được hoặc con số sai), **Nặng** (làm được nhưng phải đi đường vòng), **Nhẹ** (khó chịu, câu chữ, giao diện).

| # | Mô tả ngắn (ở màn hình nào, bước nào) | Mức độ | Mã bước (vd. D5) |
|---|---|---|---|
| 1 | | | |
| 2 | | | |
| 3 | | | |

**G4. Câu hỏi nhanh.**

1. Tuần tới bạn có dùng ArchPilot cho một RFP hoặc dự án thật không? ☐ Có  ☐ Có thể  ☐ Không. Vì sao: ______
2. Một điều bạn thích nhất: ______
3. Một tính năng còn thiếu mà bạn cần nhất: ______
4. Có con số nào bạn thấy sai hoặc không tin được? (ghi mô hình và đầu vào): ______

**Gửi phiếu:** gửi file này (hoặc ảnh chụp) cho điều phối viên pilot: ____________________.

---

# Phụ lục dành cho điều phối viên và QA

## A1. Ánh xạ bước UAT tới yêu cầu và test chi tiết

| Phần UAT | Yêu cầu | Test chi tiết trong `test-cases.md` | Trạng thái |
|---|---|---|---|
| A Đăng nhập | PL3-01 (xác thực), màn đăng nhập hiện có | ENV-04, ENV-08 | Chưa chạy |
| B Thiết kế | DS3-01 (canvas), tự động lưu | ENV-02 | Chưa chạy |
| C C1 đến C12 | KH1-03, KH1-04, KH-P1-09, KH-P1-15, AC-02, AC-03, AC-04, NFR-11 | REF-00 đến REF-16, `search-queries.csv` | Chưa chạy |
| D2, D3 | US-SZ-01, SZ1-02 | G-APP-01, G-APP-02, G-APP-04 | Chưa chạy |
| D4 | US-SZ-02 | G-RED-01 | Chưa chạy |
| D5, D6 | 02 mục 10, 05 mục 9, AC-RB-01, SZ2-03 | G-KAF-01, G-KAF-03, G-X-03, G-X-05 | Chưa chạy |
| D7 | US-SZ-03, SZ3-03 | G-VMW-01, G-X-04 | Chưa chạy |
| D8, D9, D10 | SZ2-01, NFR-01, lưu kết quả sizing | G-APP-04, G-X-02, G-X-06 | Chưa chạy |
| D11 | SZ3-05, RDBMS | G-RDB-*, G-SAN-* (chờ công thức) | Chưa chạy |
| E1 đến E5 | SZ2-06, RB-03, RB-05, AC-RB-01, AC-RB-03, AC-RB-05 | XLS-POS-01 đến 03, XLS-NEG-01, 03a, 12 | Chưa chạy |
| E6, E7 | RB-06, AC-RB-02, an toàn dữ liệu xuất | XLS-NEG-06, XLS-NEG-07 | Chưa chạy |
| F1 đến F7 | DS6-01, TP-01, PR-7 | HLD-01 đến HLD-07, HLD-13 | Chưa chạy |

## A2. Kế hoạch chạy UAT (từng bước)

| # | Việc | Người phụ trách | Kết quả mong đợi |
|---|---|---|---|
| 1 | Điền địa chỉ pilot ở mục 3, tạo tài khoản riêng cho mỗi người (không dùng chung), kiểm tra truy cập từ máy thứ hai trong mạng LAN | Điều phối viên pilot, devops | Mỗi người đăng nhập được; ENV-03 và ENV-04 đạt |
| 2 | Cho một đồng nghiệp không chuyên kỹ thuật chạy thử phiếu, bấm giờ | Điều phối viên | Xong trong 45 phút hoặc ít hơn; sửa các câu chữ gây hiểu nhầm |
| 3 | Cập nhật tên nút và các con số mong đợi nếu giao diện thật khác phiếu (đối chiếu `test-cases.md`) | QA | Phiếu khớp với bản được phát hành |
| 4 | Phát phiếu, hướng dẫn 5 phút ở đầu buổi (cách chụp màn hình, cách ghi Pass / Fail) | Điều phối viên | Người thử biết cách điền |
| 5 | Thu phiếu và phần góp ý; tổng hợp theo phần và theo mức độ | QA | Bảng lỗi theo mức Chặn / Nặng / Nhẹ; tỉ lệ Pass theo phần |
| 6 | Họp đánh giá pilot theo tiêu chí ở `test-cases.md` mục 10 (Gate G2) | PO, QA | Quyết định mở rộng, sửa rồi chạy lại, hoặc dừng |

## A3. Rủi ro và giả định

**Rủi ro.**

1. Người dùng dùng chung một tài khoản sẽ gây xung đột phiên bản khi cùng sửa một thiết kế. Giảm thiểu: một tài khoản cho mỗi người.
2. Máy của người dùng có thể không truy cập được `sysdesai.com` (proxy, tường lửa), nên bước C6, C12, F6 có thể không mở được link. Giảm thiểu: ghi "không mở được", không tính là lỗi của ứng dụng; tìm kiếm vẫn phải chạy.
3. Tên nút và nhãn trên giao diện thật có thể khác phiếu vì các tính năng đang được xây song song. Giảm thiểu: bước 3 của kế hoạch.
4. Dữ liệu pilot nằm trên một máy PC chạy Docker Desktop; nếu không có ổ lưu trữ bền vững, khởi động lại container sẽ mất dữ liệu. Giảm thiểu: ENV-02 trước giờ pilot, sao lưu bằng `scripts.backup`.
5. 45 phút là sát giới hạn cho người mới. Giảm thiểu: các bước tùy chọn có thể bỏ qua.

**Giả định.** Giao diện mặc định là tiếng Việt. Mỗi người có một tài khoản. Chỉ mục SysDesAi đã được nạp sẵn trước pilot. Không có AI trong pilot.

## A4. Câu hỏi còn mở

| ID | Câu hỏi | Mặc định đang dùng trong phiếu |
|---|---|---|
| Q-UAT-01 | Tên chính xác của các nút (chạy, lưu kết quả, ghim, xuất DOCX, tải template, Export Excel) | Dùng tên mô tả; người thử tìm nút tương đương |
| Q-UAT-02 | Model nào có ô "môi trường" (Prod / không phải Prod) cho cảnh báo Kafka? | D6 chọn Prod nếu có ô; nếu không có, cảnh báo vẫn phải hiện khi rf nhỏ hơn 3 |
| Q-UAT-03 | Định dạng số thập phân (dấu chấm hay dấu phẩy) | Cả hai đều chấp nhận |
| Q-UAT-04 | Cho phép nhập thông tin khách hàng thật trong pilot không? | Không, chỉ dùng dữ liệu mẫu |
| Q-UAT-05 | Giá trị mặc định của rdbms và san-storage (D11) | Chỉ kiểm tra chạy được, chưa đối chiếu số |

## A5. Bàn giao tiếp theo

1. WP-A, WP-B, WP-C: xác nhận tên nút và nhãn thật, báo QA trước khi phát phiếu.
2. Điều phối viên pilot: hoàn thành kế hoạch A2 bước 1 đến 4 trước giờ bắt đầu.
3. QA: sau pilot, tổng hợp kết quả vào bảng ở mục 10 của `test-cases.md` và cập nhật cột Trạng thái của ma trận truy vết.

# ArchPilot Pilot — Runbook vận hành

| | |
|---|---|
| Phiên bản | 1.0 (2026-10-14) |
| Áp dụng cho | Pilot nội bộ ~30 người dùng (3 người dùng đồng thời) qua mạng LAN văn phòng |
| Máy chủ pilot | 1 PC Windows 10 + Docker Desktop (không dùng LLM/AI trong pilot) |
| Người vận hành | Chạy các script trong `scripts\pilot\` bằng **Windows PowerShell 5.1** (có sẵn trên Windows 10) |
| Tài liệu liên quan | `docker-compose.pilot.yml`, `pilot.env.example`, `docs/v3/03-kh-phase1-sysdesai-reference-search.md` |

## 0. Tóm tắt nhanh

Pilot chạy trong **một container duy nhất**: tiến trình FastAPI (uvicorn) vừa phục vụ giao diện web (SPA) vừa phục vụ API trên **cổng 8000**. Dữ liệu (SQLite, backup, snapshot tham chiếu, file mật khẩu) là **file thường** trong thư mục `pilot-data\` cạnh mã nguồn.

```powershell
Set-Location D:\ClaudCode\Sub-agents\ArchPilot

.\scripts\pilot\start.ps1            # build (nếu cần) + chạy + chờ khỏe + in URL LAN
.\scripts\pilot\smoke.ps1            # kiểm tra nhanh: health, giao diện, đăng nhập, CSRF
.\scripts\pilot\create-users.ps1     # tạo 30 user từ pilot-data\users.csv
.\scripts\pilot\status.ps1           # xem tình trạng
.\scripts\pilot\backup.ps1           # backup DB (giữ 14 bản)
.\scripts\pilot\stop.ps1             # dừng (dữ liệu được giữ)
```

> **Nếu PowerShell báo "running scripts is disabled on this system"** (mặc định của Windows 10 bản client): không cần đổi chính sách hệ thống. Chạy từng script với chính sách chỉ áp dụng cho tiến trình đó:
>
> ```powershell
> powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\pilot\start.ps1
> ```
>
> Hoặc trong cửa sổ PowerShell hiện tại: `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` (hết hiệu lực khi đóng cửa sổ).

## 1. Yêu cầu trước khi chạy

| Mục | Yêu cầu | Kiểm tra |
|---|---|---|
| Hệ điều hành | Windows 10, PC bật suốt giờ làm việc, **không để máy sleep** | `powercfg /query` (xem mục 10) |
| Docker Desktop | Đã cài, đang chạy ("Engine running") | `docker info` |
| Docker Compose | v2 (đi kèm Docker Desktop) | `docker compose version` |
| Mạng khi build lần đầu | Truy cập được npm registry và PyPI | build chạy thành công |
| Ổ đĩa | Còn ≥ 5 GB trống (image ~210 MB, dữ liệu nhỏ) | `status.ps1` hiển thị dung lượng trống |
| Cổng | TCP 8000 chưa bị chương trình khác dùng | `netstat -ano \| findstr :8000` (không có kết quả) |
| IP của PC | Nên đặt IP tĩnh hoặc DHCP reservation để URL không đổi | `ipconfig` |

Không cần cài Node, Python hay Git để *chạy* pilot (chỉ cần Git để lấy bản mới). Node/Python chạy bên trong quá trình build image.

## 2. Khởi động lần đầu

```powershell
Set-Location D:\ClaudCode\Sub-agents\ArchPilot
.\scripts\pilot\start.ps1
```

Script làm theo thứ tự:

1. Kiểm tra Docker engine đang chạy (nếu không: dừng và nhắc bật Docker Desktop).
2. Tạo `pilot-data\` (các thư mục con `backups`, `reference`, `secrets`) và tạo `pilot.env` từ `pilot.env.example` nếu chưa có.
3. Kiểm tra cổng 8000 còn trống.
4. `docker compose build` — lần đầu mất ~1–3 phút (tải image nền, `npm ci`, `pip install`); các lần sau chỉ vài giây nếu không có thay đổi.
5. `docker compose up -d`, rồi chờ `GET /api/health` trả 200.
6. In URL, ví dụ:

```text
ArchPilot pilot is reachable at:
  This PC     : http://localhost:8000/
  Other PCs   : http://<IP-LAN>:8000/
```

Container có `restart: unless-stopped`: khi Docker Desktop khởi động lại (ví dụ sau khi PC reboot và bạn đăng nhập), ứng dụng **tự chạy lại**. Bật *Docker Desktop → Settings → General → "Start Docker Desktop when you sign in"* (cài đặt của người dùng, bạn tự bật).

Kiểm tra ngay:

```powershell
.\scripts\pilot\smoke.ps1
```

Kết quả mong đợi: dòng cuối `SMOKE PASSED: 14 checks`. Lần chạy đầu, smoke tạo tài khoản admin kiểm thử **`pilot-smoke`**; mật khẩu chỉ nằm trong `pilot-data\secrets\pilot-smoke.secret.csv` và không bao giờ được in ra màn hình.

## 3. Truy cập từ máy khác trong LAN và lệnh Firewall

Người dùng mở URL "Other PCs" ở mục 2 bằng trình duyệt (Chrome/Edge). Cổng 8000 đã được publish trên mọi network interface của PC.

**Windows Firewall có thể chặn kết nối vào.** Script **không** tự thay đổi firewall. Nếu máy khác không vào được, chạy lệnh sau **một lần**, trong PowerShell mở bằng *Run as administrator*:

```powershell
# Cho phép TCP 8000 từ cùng subnet LAN, trên mạng loại Private/Domain
New-NetFirewallRule -DisplayName "ArchPilot Pilot (TCP 8000)" `
  -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8000 `
  -RemoteAddress LocalSubnet -Profile Private,Domain
```

Lưu ý:

- Kiểm tra loại mạng của card đang dùng: `Get-NetConnectionProfile`. Nếu `NetworkCategory` là **Public**, rule trên (chỉ Private/Domain) sẽ không áp dụng. Khi đó hoặc đổi loại mạng thành Private (do bạn quyết định), hoặc thêm `Public` vào `-Profile` (kém an toàn hơn).
- `-RemoteAddress LocalSubnet` chỉ cho máy cùng subnet. Nếu người dùng ở VLAN/subnet khác, thay bằng dải cụ thể, ví dụ `-RemoteAddress 192.168.10.0/24,192.168.20.0/24`.
- Lần đầu Docker Desktop có thể bật popup của Windows Defender Firewall cho `com.docker.backend.exe`: chọn *Private networks*.
- Nếu đổi cổng trong `pilot.env` (`ARCHPILOT_PILOT_PORT`), đổi `-LocalPort` tương ứng.
- Gỡ rule khi kết thúc pilot: `Remove-NetFirewallRule -DisplayName "ArchPilot Pilot (TCP 8000)"`.
- Kiểm tra từ một máy khác: `Test-NetConnection <IP-LAN> -Port 8000` (thay `<IP-LAN>` bằng IP mà start.ps1 in ra) phải báo `TcpTestSucceeded : True`.

### Vì sao pilot chạy HTTP thường và cờ cookie `Secure`

Image mặc định đặt `ARCHPILOT_ENV=production` và `ARCHPILOT_COOKIE_SECURE=true`; ứng dụng **từ chối khởi động** nếu `production` mà cookie không `Secure`. Cookie `Secure` bị trình duyệt **bỏ qua** trên `http://<IP-LAN>:8000` (chỉ `localhost` được miễn), nên đăng nhập sẽ "thành công" nhưng phiên không bao giờ được giữ.

Vì vậy `pilot.env` đặt:

```text
ARCHPILOT_ENV=pilot
ARCHPILOT_COOKIE_SECURE=false
```

Hệ quả cần biết (đã chấp nhận cho pilot trong LAN nội bộ):

1. Với `ARCHPILOT_ENV` khác `production`, trang Swagger `/api/docs` và `/api/openapi.json` **được bật** (mọi API dữ liệu vẫn yêu cầu đăng nhập).
2. Không có TLS: mật khẩu và cookie đi qua LAN dưới dạng HTTP thường. Chỉ dùng trong mạng nội bộ tin cậy; **không** mở cổng này ra Internet.
3. Khi đưa TLS vào (reverse proxy), đặt lại `ARCHPILOT_COOKIE_SECURE=true` và `ARCHPILOT_ENV=production`.

`smoke.ps1` kiểm tra tự động rằng cookie phiên/CSRF **không** có cờ `Secure`.

## 4. Tạo 30 người dùng pilot

1. Tạo file danh sách từ mẫu:

   ```powershell
   Copy-Item .\scripts\pilot\users.sample.csv .\pilot-data\users.csv
   notepad .\pilot-data\users.csv
   ```

2. Định dạng CSV (dòng đầu là tiêu đề):

   ```csv
   username,display_name,role
   admin.pilot,Pilot Admin,admin
   an.nguyen,Nguyễn Văn An,editor
   binh.tran,Trần Thị Bình,member
   ```

   - `role` là một trong `member`, `editor`, `admin`. Để trống = `member`.
   - `username`: 2–63 ký tự gồm chữ, số, `.`, `_`, `@`, `-`; bắt đầu bằng chữ hoặc số; không phân biệt hoa thường; không trùng nhau.
   - Lưu file ở dạng **CSV UTF-8** để tên tiếng Việt không bị lỗi font. Dấu phân cách `,` hoặc `;` (Excel tiếng Việt hay dùng `;`) đều được nhận diện.
   - `pilot-data\` đã nằm trong `.gitignore`: danh sách tên thật không bị commit.

3. Chạy thử không tạo gì (chỉ kiểm tra CSV), rồi chạy thật:

   ```powershell
   .\scripts\pilot\create-users.ps1 -DryRun
   .\scripts\pilot\create-users.ps1
   ```

Cách hoạt động và bảo mật:

- Mỗi dòng được kiểm tra **trước**; chỉ cần một dòng sai là không tạo user nào.
- Mật khẩu 16 ký tự ngẫu nhiên (bộ sinh số ngẫu nhiên mật mã, bỏ các ký tự dễ nhầm như `0 O 1 l I`) được gửi vào `backend/scripts/create_user.py` trong container qua **stdin** (không nằm trên dòng lệnh, không in ra, không vào log).
- Mật khẩu chỉ được ghi vào **`pilot-data\secrets\pilot-users.secret.csv`** (cột `username,display_name,role,password,created_utc`, UTF-8 có BOM để Excel mở đúng). File này bị `.gitignore`.
- Chạy lại an toàn: user đã tồn tại sẽ bị bỏ qua, mật khẩu cũ không đổi.
- Tạo 30 user mất khoảng 35–40 giây.

**Phát mật khẩu:** gửi riêng cho từng người (không gửi cả file), sau đó chuyển file secret vào nơi cất an toàn hoặc xóa. Ứng dụng **chưa có chức năng tự đổi mật khẩu** trong giao diện.

**Quên mật khẩu:** `.\scripts\pilot\reset-password.ps1 -Username an.nguyen` — đặt mật khẩu ngẫu nhiên mới, thu hồi các phiên đang đăng nhập của user đó và ghi mật khẩu mới vào `pilot-data\secrets\pilot-password-resets.secret.csv`.

Tài khoản `pilot-smoke` (admin, dùng cho `smoke.ps1`) là tài khoản kỹ thuật; đổi mật khẩu bằng `reset-password.ps1 -Username pilot-smoke` nếu cần (khi đó chạy `smoke.ps1 -SecretFile pilot-data\secrets\pilot-password-resets.secret.csv`).

## 5. Index tham chiếu SysDesAi (crawl)

Backend có hai lệnh (do work package WP-B cung cấp):

```text
python -m app.reference crawl --out <thư mục dữ liệu>/reference/sysdesai-snapshot.jsonl.gz [--limit N]
python -m app.reference load  --snapshot <file>
```

Backend **tự nạp snapshot khi khởi động** nếu file tồn tại. Đường dẫn được cố định trong `pilot.env` bằng `ARCHPILOT_REFERENCE_SNAPSHOT=/data/reference/sysdesai-snapshot.jsonl.gz` (trên host: `pilot-data\reference\sysdesai-snapshot.jsonl.gz`).

Script `crawl-reference.ps1` chạy crawl **bên trong container, ở chế độ nền**, nên:

- **Ứng dụng vẫn hoạt động bình thường** trong lúc crawl.
- Đóng cửa sổ PowerShell hoặc nhấn `Ctrl+C` **không** dừng crawl.
- Tốc độ lịch sự (≈ 1 request / 3 giây, tôn trọng `robots.txt`) do crawler tự thực thi; script không và không được tăng tốc độ này (Terms of Service của SysDesAi cấm gây quá tải; xem `docs/v3/03-kh-phase1-sysdesai-reference-search.md`).

```powershell
# 1) Chạy thử ~1–2 phút để chắc crawler hoạt động
.\scripts\pilot\crawl-reference.ps1 -Limit 20

# 2) Crawl đầy đủ, ~45 phút
.\scripts\pilot\crawl-reference.ps1
```

Trình tự: kiểm tra module `app.reference` có trong image → chạy crawl nền, ghi `pilot-data\reference\crawl.log` và hiện log trực tiếp → crawl thành công thì **di chuyển nguyên tử** file tạm thành `sysdesai-snapshot.jsonl.gz` (bản cũ giữ lại thành `sysdesai-snapshot.prev.jsonl.gz`) → chạy `load` → **restart container** (~15 giây) để backend nạp snapshot đúng như mỗi lần khởi động. Thêm `-NoRestart` để bỏ bước restart.

| Việc | Lệnh |
|---|---|
| Gắn lại để xem log crawl đang chạy | `.\scripts\pilot\crawl-reference.ps1 -Follow` |
| Xem trạng thái | `.\scripts\pilot\crawl-reference.ps1 -Status` |
| Hủy crawl đang chạy (snapshot hiện có không bị đụng tới) | `.\scripts\pilot\crawl-reference.ps1 -Stop` |
| Làm mới (hằng tuần/tháng) | chạy lại không tham số |

Lưu ý:

- **Không** chạy `stop.ps1`/`start.ps1` hoặc restore trong lúc crawl đang chạy: container dừng thì crawl chết (snapshot cũ vẫn an toàn vì file tạm chưa được đổi tên).
- Để PC không sleep suốt ~45 phút.
- `-Limit N` cho ra snapshot **nhỏ và thay thế** snapshot hiện tại (bản cũ còn ở `.prev`); sau khi thử xong hãy chạy crawl đầy đủ.
- Nếu script báo *"The running image has no usable crawler (module app.reference)"*: image hiện tại chưa chứa WP-B. Lấy nhánh có `backend\app\reference`, rồi `.\scripts\pilot\start.ps1 -Rebuild`.
- Nhớ ghi nguồn SysDesAi và nhãn AI-generated khi hiển thị (yêu cầu của Terms §4; do giao diện WP-B đảm nhiệm).

## 6. Backup và restore hằng ngày

### Backup

```powershell
.\scripts\pilot\backup.ps1                          # backup + kiểm tra toàn vẹn, giữ 14 bản
.\scripts\pilot\backup.ps1 -CopyTo E:\ArchPilotBackups   # kèm sao chép sang ổ/thư mục khác
```

- Dùng script backup của chính ứng dụng (`VACUUM INTO`): an toàn khi app đang chạy. **Không bao giờ chép tay** file `archpilot.db` đang chạy (chế độ WAL có thể cho bản chép hỏng).
- Kết quả: `pilot-data\backups\archpilot-<UTC>.db` (giờ UTC). Giữ 14 bản gần nhất; các bản `*-premigrate.db` (ứng dụng tự chụp trước mỗi lần đổi schema) **không bao giờ bị xóa tự động**.
- Chạy được cả khi container đang dừng (script dùng một container tạm).
- Backup **không** gồm `pilot-data\secrets\` (mật khẩu đã phát) và `pilot.env`; sao chép riêng nếu cần.

**Lên lịch hằng ngày** (lệnh để bạn tự chạy, không cần quyền admin; chạy khi bạn đã đăng nhập Windows và Docker Desktop đang chạy):

```powershell
schtasks /Create /TN "ArchPilot-Backup" /SC DAILY /ST 12:30 /F /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\ClaudCode\Sub-agents\ArchPilot\scripts\pilot\backup.ps1 -CopyTo E:\ArchPilotBackups"
```

Xóa lịch: `schtasks /Delete /TN "ArchPilot-Backup" /F`. Kiểm tra: `schtasks /Query /TN "ArchPilot-Backup"` và `.\scripts\pilot\status.ps1` (cảnh báo nếu bản backup mới nhất cũ hơn 26 giờ).

### Restore

```powershell
.\scripts\pilot\restore.ps1                                   # liệt kê các backup
.\scripts\pilot\restore.ps1 -Backup archpilot-20261015T053000Z.db
.\scripts\pilot\restore.ps1 -Backup latest
```

Script: kiểm tra toàn vẹn file backup → bắt bạn gõ `RESTORE` (bỏ qua bằng `-Force`) → `docker compose down` → **chuyển** DB hiện tại (kèm `-wal`/`-shm`) vào `pilot-data\backups\replaced-before-restore-<thời gian>\` → chép backup thành `pilot-data\archpilot.db` → `up -d` và chờ `/api/health`.

- Dữ liệu phát sinh sau thời điểm backup sẽ không có trong bản khôi phục (nhưng DB cũ vẫn còn trong thư mục `replaced-before-restore-...`).
- Hoàn tác restore: `stop.ps1`, xóa `pilot-data\archpilot.db`, chuyển các file từ thư mục `replaced-before-restore-...` về `pilot-data\`, `start.ps1`.
- Backup từ phiên bản schema cũ hơn sẽ được ứng dụng tự nâng cấp khi khởi động (có chụp `premigrate` trước).
- Có thể restore từ file nằm ngoài thư mục backups: `-Backup E:\ArchPilotBackups\archpilot-....db` (script tự chép vào `pilot-data\backups\imported-...`).

## 7. Cập nhật lên bản build mới

Migration SQL **chỉ đi tới** (forward-only) và được áp dụng tự động khi khởi động; ứng dụng tự chụp `...-premigrate.db` trước khi áp dụng. Vì không có migration ngược, **rollback = khôi phục backup + chạy lại image cũ**. Do đó luôn backup trước khi cập nhật.

```powershell
Set-Location D:\ClaudCode\Sub-agents\ArchPilot

# 1. Backup và giữ lại image đang chạy để còn đường lui
.\scripts\pilot\backup.ps1
docker tag archpilot-pilot:local archpilot-pilot:prev

# 2. Lấy mã nguồn mới (nhánh/tag do nhóm phát triển cung cấp)
git pull

# 3. Build lại và khởi động lại (mất ~1 phút, người dùng bị ngắt ~15 giây)
.\scripts\pilot\start.ps1

# 4. Kiểm tra
.\scripts\pilot\smoke.ps1
.\scripts\pilot\status.ps1
```

`start.ps1` đồng thời build và tạo lại container nếu image đổi. `start.ps1 -Rebuild` build không dùng cache (khi nghi ngờ cache hỏng hoặc cần cập nhật image nền).

**Rollback nếu bản mới lỗi:**

```powershell
.\scripts\pilot\stop.ps1
git checkout <commit-hoặc-tag-cũ>
docker tag archpilot-pilot:prev archpilot-pilot:local
.\scripts\pilot\restore.ps1 -Backup <file backup tạo ở bước 1>
.\scripts\pilot\start.ps1 -SkipBuild
```

Nếu migration mới chưa kịp chạy (DB vẫn ở schema cũ) thì có thể bỏ bước `restore`.

## 8. Xử lý sự cố

Xem nhanh: `.\scripts\pilot\status.ps1` và `.\scripts\pilot\logs.ps1 -Tail 200` (log là JSON mỗi dòng; `-Errors` chỉ hiện WARNING/ERROR).

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| **Cổng đã bị dùng** (`start.ps1` báo *Port 8000 is already in use*) | Chương trình khác (hoặc container cũ) đang giữ cổng 8000 | `netstat -ano \| findstr :8000` để biết PID, `tasklist /FI "PID eq <PID>"` để biết chương trình. Tắt chương trình đó, hoặc đổi `ARCHPILOT_PILOT_PORT` trong `pilot.env` sang cổng trống (vd. 8080) rồi `start.ps1` (nhớ đổi rule firewall). |
| **Docker chưa chạy** (*Docker engine is not running*) | Docker Desktop chưa mở hoặc đang khởi động | Mở Docker Desktop, chờ biểu tượng cá voi báo *Engine running* (30–90 giây), chạy lại `start.ps1`. Nếu treo: *Docker Desktop → Troubleshoot → Restart*. Nếu `wsl` lỗi: `wsl --status`. |
| **Build lỗi** | Không có Internet (npm/pip), đầy ổ đĩa, Docker thiếu RAM | Đọc lỗi đầu tiên phía trên; kiểm tra mạng và `docker system df`; giải phóng dung lượng bằng `docker image prune` (chỉ xóa image không dùng; cẩn thận, tự xem trước). |
| **Container không khỏe / `start.ps1` báo app không sẵn sàng** | App lỗi khi khởi động (migration lỗi, file DB hỏng/khóa, thiếu file contract) | `logs.ps1 -Tail 100` — tìm `ERROR`/`Traceback`. Migration lỗi: DB được giữ ở version trước, dùng backup `premigrate` hoặc restore. Cấu hình sai: kiểm tra `pilot.env` (ví dụ `ARCHPILOT_ENV=production` mà `COOKIE_SECURE=false` làm app từ chối chạy). |
| **`database is locked` / health trả 503** | Một tiến trình khác giữ khóa ghi quá lâu (ví dụ lệnh thủ công, backup đang chạy, hoặc ổ đĩa chậm) | Chờ 1–2 phút rồi `status.ps1`. App chờ khóa tối đa 5 giây mỗi truy vấn. Nếu kéo dài: `docker compose -f docker-compose.pilot.yml --env-file pilot.env restart`. Không bao giờ mở `archpilot.db` bằng công cụ SQLite khác ở chế độ ghi khi app chạy. |
| **Đăng nhập xong vẫn bị đẩy về trang login** | Cookie `Secure` bị trình duyệt bỏ (dùng HTTP) | `pilot.env` phải có `ARCHPILOT_COOKIE_SECURE=false` (và `ARCHPILOT_ENV=pilot`); sau khi sửa: `stop.ps1`, `start.ps1`. Chạy `smoke.ps1` để xác nhận. |
| **Báo 429 *too many failed attempts*** | Nhập sai mật khẩu ≥ 8 lần trong 5 phút (tính theo username) | Chờ 5 phút hoặc restart container (bộ đếm nằm trong bộ nhớ). |
| **Máy khác không vào được** | Firewall; sai loại mạng (Public); PC đổi IP; khác subnet | Mục 3. Trên PC chủ: `http://localhost:8000/` vào được nhưng máy khác không ⇒ firewall/mạng. Chạy `status.ps1` để xem IP hiện tại. |
| **Giao diện trắng sau khi cập nhật** | Trình duyệt giữ bản JS cũ | `Ctrl+F5`. |
| **Quên mật khẩu** | — | `reset-password.ps1 -Username <user>` (mục 4). |
| **`start.ps1` báo *running scripts is disabled*** | Execution Policy mặc định của Windows | Xem khung lưu ý ở mục 0 (`-ExecutionPolicy Bypass` chỉ cho tiến trình đó). |
| **Crawl báo thiếu module `app.reference`** | Image chưa có WP-B | Mục 5, cuối. |
| **Ổ đĩa đầy** | Log Docker, backup, image cũ | Log đã giới hạn 5×10 MB. Xóa bớt backup cũ trong `pilot-data\backups\` (giữ bản mới và `premigrate`), `docker image prune`. |
| **Sau khi PC reboot app không chạy** | Docker Desktop chưa khởi động | Bật Docker Desktop (hoặc cho tự chạy khi đăng nhập). Container tự lên nhờ `restart: unless-stopped`; nếu trước đó bạn chạy `stop.ps1` thì cần `start.ps1`. |

Dọn sạch hoàn toàn để làm lại từ đầu (**xóa mọi dữ liệu pilot**, hãy `backup.ps1 -CopyTo ...` trước): `.\scripts\pilot\stop.ps1`, rồi xóa thư mục `pilot-data\` và `pilot.env`, rồi `.\scripts\pilot\start.ps1`.

## 9. Dữ liệu nằm ở đâu

| Dữ liệu | Trên host (Windows) | Trong container |
|---|---|---|
| Database SQLite (WAL) | `pilot-data\archpilot.db` (khi app chạy có thêm `-wal`, `-shm`) | `/data/archpilot.db` |
| Backup | `pilot-data\backups\archpilot-<UTC>.db`, `*-premigrate.db`, `replaced-before-restore-*\` | `/data/backups` |
| Snapshot tham chiếu SysDesAi | `pilot-data\reference\sysdesai-snapshot.jsonl.gz` (+ `.prev`, `crawl.log`) | `/data/reference` |
| Mật khẩu đã phát (bí mật) | `pilot-data\secrets\*.secret.csv` | `/data/secrets` |
| Danh sách user đầu vào | `pilot-data\users.csv` | — |
| Cấu hình | `pilot.env` (từ `pilot.env.example`) | biến môi trường |
| Log ứng dụng | `docker logs archpilot-pilot` (JSON; xoay vòng 5 × 10 MB) | stdout |
| Image | `archpilot-pilot:local` (và `:prev` nếu bạn gắn tag) | — |

Toàn bộ `pilot-data\` và `pilot.env` đã nằm trong `.gitignore` và `.dockerignore`: không bị commit và không bị gửi vào build context. Chuyển pilot sang PC khác: dừng pilot, chép mã nguồn + `pilot-data\` + `pilot.env`, rồi `start.ps1`.

## 10. Giới hạn đã biết của pilot

- **HTTP không mã hóa** trong LAN và `/api/docs` mở (mục 3). Cần TLS trước khi mở rộng ngoài pilot.
- Địa chỉ IP trong log/bảng phiên là IP cổng của Docker Desktop (mọi máy LAN trông như cùng một IP). Bộ chống dò mật khẩu tính theo **username**, nên một người nhập sai nhiều lần chỉ khóa chính username đó.
- Một tiến trình uvicorn + SQLite: đủ cho 3 người đồng thời. Đã thử tải 6 phiên song song (1.080 request, gồm ghi) trên cấu hình này: không lỗi.
- Chưa có chức năng tự đổi mật khẩu; dùng `reset-password.ps1`.
- Không sleep: lệnh tùy chọn để bạn tự chạy (cần admin cho một số máy): `powercfg /change standby-timeout-ac 0` và `powercfg /change hibernate-timeout-ac 0`.
- Giao diện hiện còn `@import` Google Fonts; máy không có Internet vẫn chạy nhưng dùng font thay thế.

## 11. Danh sách kiểm tra buổi sáng (trước khi mời người dùng)

1. Docker Desktop đang chạy; `.\scripts\pilot\start.ps1` xong, in URL LAN.
2. Firewall đã mở TCP 8000 (mục 3); từ **một máy khác** mở URL LAN thấy trang đăng nhập.
3. `.\scripts\pilot\smoke.ps1` → `SMOKE PASSED`.
4. `.\scripts\pilot\create-users.ps1` → `created=30`; phát mật khẩu riêng cho từng người.
5. `.\scripts\pilot\backup.ps1` chạy được; đã tạo lịch `schtasks` (mục 6).
6. (Tùy chọn, chạy nền) `.\scripts\pilot\crawl-reference.ps1 -Limit 20` rồi crawl đầy đủ ngoài giờ cao điểm.
7. PC không sleep, cắm điện, IP không đổi.

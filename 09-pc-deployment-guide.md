# ArchPilot — Hướng dẫn chạy trên PC Windows

## 1. Yêu cầu môi trường

Cài các phần mềm sau:

- Git
- Node.js LTS, khuyến nghị Node.js 20 hoặc mới hơn
- npm, được cài kèm Node.js
- Tùy chọn: Docker Desktop

Kiểm tra trong PowerShell:

```powershell
node --version
npm --version
git --version
```

## 2. Chạy development bằng Node.js

Mở PowerShell và chạy:

```powershell
Set-Location D:\ClaudCode\Sub-agents\ArchPilot
npm install
npm run dev -- --host 127.0.0.1
```

Mở trình duyệt tại:

```text
http://127.0.0.1:5173/
```

Để truy cập từ máy khác trong cùng mạng LAN, dùng:

```powershell
npm run dev -- --host 0.0.0.0
```

Sau đó kiểm tra IP máy tính bằng:

```powershell
ipconfig
```

Mở:

```text
http://<IP-PC>:5173/
```

Chỉ mở port trên Windows Firewall nếu bạn thực sự cần truy cập từ máy khác.

## 3. Build production

```powershell
Set-Location D:\ClaudCode\Sub-agents\ArchPilot
npm install
npm run build
```

Kết quả nằm trong thư mục `dist/`.

Kiểm tra bản build bằng Vite preview:

```powershell
npm run preview -- --host 127.0.0.1
```

Mở:

```text
http://127.0.0.1:4173/
```

Preview server phù hợp để kiểm tra bản build, không phải web server production lâu dài.

## 4. Chạy bằng Docker Desktop

Từ thư mục `ArchPilot`:

```powershell
docker build -t archpilot:local .
docker run --rm -p 8080:80 --name archpilot archpilot:local
```

Mở:

```text
http://127.0.0.1:8080/
```

Dừng container bằng `Ctrl+C` hoặc terminal khác:

```powershell
docker stop archpilot
```

## 5. Cập nhật code và chạy lại

Nếu chạy development:

```powershell
Set-Location D:\ClaudCode\Sub-agents\ArchPilot
npm run dev -- --host 127.0.0.1
```

Vite sẽ tự reload khi file trong `src/` thay đổi.

Nếu chạy Docker, build lại image:

```powershell
docker build -t archpilot:local .
docker rm -f archpilot 2>$null
docker run --rm -p 8080:80 --name archpilot archpilot:local
```

## 6. Xử lý lỗi thường gặp

### npm không tìm thấy package.json

Bạn đang đứng ở workspace root thay vì thư mục sản phẩm. Dùng một trong hai cách:

```powershell
Set-Location D:\ClaudCode\Sub-agents\ArchPilot
npm run dev -- --host 127.0.0.1
```

hoặc:

```powershell
npm --prefix D:\ClaudCode\Sub-agents\ArchPilot run dev -- --host 127.0.0.1
```

### Port 5173 đã được sử dụng

Chạy port khác:

```powershell
npm --prefix D:\ClaudCode\Sub-agents\ArchPilot run dev -- --host 127.0.0.1 --port 5174
```

### Xóa dependency và cài lại

```powershell
Set-Location D:\ClaudCode\Sub-agents\ArchPilot
Remove-Item -Recurse -Force node_modules
Remove-Item -Force package-lock.json
npm install
npm run build
```

## 7. Lưu ý về dữ liệu hiện tại

Bản demo hiện là frontend local:

- Workspace, Requirements và Architecture components lưu trong `localStorage` của trình duyệt.
- Chưa có PostgreSQL backend.
- Chưa có user authentication.
- Chưa có GitLab/Confluence live integration.
- Chưa nên dùng dữ liệu production hoặc dữ liệu tài chính nhạy cảm.

## 8. Kiểm tra trước khi chia sẻ demo

```powershell
Set-Location D:\ClaudCode\Sub-agents\ArchPilot
npm run build
```

Sau đó dùng Docker hoặc `npm run preview` để kiểm tra artifact trong `dist/`.

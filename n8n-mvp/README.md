# n8n MVP – Tự động trả lời tin nhắn Facebook

Bản demo để khách hàng (cửa hàng nhỏ) thấy n8n tự động hoá được gì: khách nhắn vào Facebook Page → bot trả lời theo từ khoá ("giá", "ship", "địa chỉ", "đặt hàng").

- n8n **2.2.4 Community** (image Docker chính thức, miễn phí – Sustainable Use License)
- Postgres 16 lưu dữ liệu n8n
- ngrok (free) cấp link HTTPS public cho webhook Facebook

Chi phí giai đoạn demo: **0đ**.

```
n8n-mvp/
├── docker-compose.yml          # n8n + Postgres + ngrok (profile "tunnel")
├── .env.example                # mẫu cấu hình -> copy thành .env
├── workflows/fb-auto-reply.json
└── scripts/import-workflows.sh # import + publish workflow vào n8n
```

---

## 1. Yêu cầu máy

- Linux / macOS / Windows (WSL2) có **Docker** + **Docker Compose v2** (`docker compose version`)
- `git`, `openssl`, `python3`
- RAM trống ≥ 2GB, cổng **5679** chưa bị dùng (đổi `N8N_PORT` nếu trùng)

## 2. Cài đặt trên máy mới

```bash
git clone git@github.com:GodsPatch/StoreWorkflowSupport.git
cd StoreWorkflowSupport/n8n-mvp

# .env đã có sẵn trong repo (repo private). Nếu không có: cp .env.example .env rồi điền.

docker compose up -d
# đợi ~30s
curl http://localhost:5679/healthz        # -> {"status":"ok"}

./scripts/import-workflows.sh             # import + publish workflow FB
```

Mở http://localhost:5679 → tạo tài khoản **owner** (email + mật khẩu) → thấy workflow **"FB Messenger - Tự động trả lời"**.

> Server từ xa mà không mở được cổng 5679 (firewall): dùng SSH tunnel
> `ssh -L 5679:localhost:5679 <user>@<ip-server>` rồi mở http://localhost:5679.

## 3. Bật ngrok (link HTTPS public)

1. Đăng ký https://dashboard.ngrok.com/signup
2. Lấy **Authtoken**: https://dashboard.ngrok.com/get-started/your-authtoken
3. Lấy **domain free**: https://dashboard.ngrok.com/domains (dạng `xxx.ngrok-free.dev`)
4. Sửa `.env`:
   ```
   NGROK_AUTHTOKEN=<token>
   NGROK_DOMAIN=xxx.ngrok-free.dev
   WEBHOOK_URL=https://xxx.ngrok-free.dev/
   ```
5. Chạy:
   ```bash
   docker compose --profile tunnel up -d
   ```
6. Kiểm tra (phải trả về `OK`):
   ```bash
   curl "https://xxx.ngrok-free.dev/webhook/fb-messenger?hub.verify_token=cuahang_verify_123&hub.challenge=OK"
   ```

> 1 tài khoản ngrok free chỉ chạy được **1 tunnel cùng lúc** – máy mới nên dùng tài khoản ngrok khác, hoặc tắt tunnel ở máy cũ.

## 4. Facebook Page + Meta App

**4.1 Tạo Page:** Facebook → Menu → **Trang** → **Tạo Trang mới** (vd "Shop Demo").

**4.2 Tạo App:**
1. https://developers.facebook.com → **My Apps → Create App**
2. Use case: **"Engage with customers on Messenger from Meta"** → không kết nối business portfolio → Create.
3. **Messenger API Settings**:
   - **Generate access tokens** → Connect Page → **Generate** → copy **Page Access Token** (`EAA...`).
   - **Configure webhooks**:
     - Callback URL: `https://<NGROK_DOMAIN>/webhook/fb-messenger`
     - Verify token: `cuahang_verify_123`
     - **Verify and save**
   - Ở dòng Page → **Add subscriptions** → tick **messages** → Save.

**4.3 Dán token vào n8n:** mở workflow → node **"Chọn câu trả lời"** → thay `DAN_PAGE_ACCESS_TOKEN_VAO_DAY` bằng token → **Save** → **Publish**.

## 5. Demo

- Dùng Facebook admin của Page nhắn: `giá`, `ship`, `địa chỉ`, `đặt hàng` → bot trả lời.
- Lịch sử chạy: n8n → **Executions**.
- Cho khách nhắn thử: Meta App → **App roles → Roles → Add People** → thêm khách làm **Tester** (khách phải chấp nhận). App ở Development mode chỉ trả lời người có vai trò; **không cần App Review** cho demo.

Sửa kịch bản trả lời: mảng `rules` trong node **"Chọn câu trả lời"**.

## 6. Vận hành

| Việc | Lệnh |
|---|---|
| Xem trạng thái | `docker compose --profile tunnel ps` |
| Xem log | `docker compose logs -f n8n` |
| Dừng | `docker compose --profile tunnel down` |
| Chạy lại | `docker compose --profile tunnel up -d` |
| Xoá sạch dữ liệu | `docker compose --profile tunnel down -v` ⚠️ |

## 7. Lưu ý

- **`.env` không có trong repo** (chứa mật khẩu DB, token ngrok): chép `.env.example` thành `.env` rồi điền giá trị, không commit file này. `N8N_ENCRYPTION_KEY` phải giữ cố định cho 1 cài đặt.
- **Page Access Token không có trong repo** – sau khi cài trên máy mới phải dán lại (bước 4.3).
- Chạy lại `import-workflows.sh` sẽ **ghi đè** workflow bằng file JSON trong repo → token đã dán bị mất, phải dán lại. Muốn lưu thay đổi làm trên giao diện: n8n → workflow → **⋯ → Download** → ghi đè `workflows/fb-auto-reply.json` (xoá token khỏi file trước khi commit).
- Máy chạy n8n + ngrok phải bật suốt buổi demo.
- Lỗi thường gặp:
  - `Verify and save` thất bại → workflow chưa Publish hoặc ngrok chưa chạy (thử lệnh curl ở bước 3.6).
  - Bot không trả lời → n8n → Executions xem node nào đỏ; `Invalid OAuth access token` = token sai/chưa dán.
  - Facebook không gửi sự kiện → quên tick **messages** ở Add subscriptions, hoặc người nhắn không phải admin/tester.

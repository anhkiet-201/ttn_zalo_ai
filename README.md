# 🤖 Zalo Bot - Realtime Message Listener (Dựa trên `zca-js`)

Hệ thống lắng nghe và phản hồi tin nhắn Zalo thời gian thực (Message Listener) được xây dựng trên nền tảng thư viện mã nguồn mở **[zca-js](https://github.com/RFS-ADRENO/zca-js)** (v2.x) kết hợp với **TypeScript** và **Clean Architecture**.

---

## 🌟 Tính Năng Nổi Bật

- ⚡ **Lắng nghe sự kiện Realtime (WebSocket):** Bắt ngay lập tức mọi tin nhắn cá nhân (1-1), tin nhắn nhóm, sự kiện nhóm (thêm/bớt thành viên, đổi tên), thả cảm xúc (reactions), và thu hồi tin nhắn (undo).
- 📱 **Đăng nhập linh hoạt (Dual Auth):**
  - **Quét mã QR trực tiếp trên Terminal** (hoặc mở file ảnh `qr_login.png`). Tự động lưu phiên vào `session.json` để tái sử dụng ở các lần chạy sau mà không cần quét lại.
  - **Đăng nhập bằng Cookie + IMEI** cấu hình qua file `.env` hoặc `session.json` (thích hợp cho VPS/Server).
- 🧩 **Kiến trúc Clean Architecture & Dispatcher:** Tách biệt rõ ràng giữa quản lý kết nối, bộ điều phối sự kiện (Event Dispatcher), dịch vụ tương tác Zalo (ZaloService), và các tầng xử lý nghiệp vụ (Handlers).
- 🛠️ **Hệ thống Lệnh (Command System):** Sẵn có các lệnh mẫu (`/ping`, `/help`, `/echo`, `/info`), dễ dàng đăng ký thêm lệnh tùy biến hoặc tích hợp AI LLM (Gemini, ChatGPT).
- 🛡️ **Type Safety & Reconnection:** 100% Strict TypeScript, tự động xử lý và cảnh báo khi mất kết nối mạng.

---

## 📁 Cấu Trúc Dự Án

```
Zalo_AI_Bot/
├── src/
│   ├── auth/
│   │   └── sessionManager.ts   # Quản lý phiên đăng nhập (QR code / Cookie + IMEI)
│   ├── config/
│   │   └── index.ts            # Nạp và quản lý cấu hình từ biến môi trường (.env)
│   ├── handlers/
│   │   ├── commandHandler.ts   # Xử lý các câu lệnh Bot (/help, /ping, /info, /echo)
│   │   ├── groupHandler.ts     # Xử lý sự kiện trong nhóm chat (chào thành viên mới)
│   │   ├── messageHandler.ts   # Xử lý và ghi log tin nhắn văn bản, kiểm tra command
│   │   └── reactionHandler.ts  # Xử lý khi có người thả cảm xúc vào tin nhắn
│   ├── listener/
│   │   ├── eventDispatcher.ts  # Định tuyến các sự kiện Zalo tới các Handler
│   │   └── messageListener.ts  # Khởi chạy và quản lý vòng đời WebSocket Listener
│   ├── services/
│   │   └── zaloService.ts      # Đóng gói các hàm gọi API Zalo (gửi tin, reply, thả reaction)
│   ├── types/
│   │   └── zalo.types.ts       # Định nghĩa các Interface & Data Types
│   └── index.ts                # Entrypoint khởi động toàn bộ hệ thống
├── .env.example                # Mẫu biến môi trường
├── package.json                # Dependencies & Scripts
├── tsconfig.json               # Cấu hình TypeScript NodeNext
└── README.md
```

---

## 🚀 Hướng Dẫn Cài Đặt & Khởi Chạy

### 1. Yêu cầu hệ thống
- **Node.js**: Phiên bản 18.0.0 trở lên.
- **npm** hoặc **yarn** / **pnpm**.

### 2. Cài đặt dependencies
```bash
npm install
```

### 3. Cấu hình biến môi trường
Sao chép file `.env.example` thành `.env`:
```bash
cp .env.example .env
```

Nội dung `.env`:
```env
SELF_LISTEN=false
CHECK_UPDATE=true
BOT_PREFIX=/
SESSION_FILE_PATH=./session.json
```

---

## 🔑 Hướng Dẫn Đăng Nhập

### Cách 1: Đăng nhập bằng quét mã QR (Khuyến nghị cho chạy cục bộ)
1. Chạy lệnh:
   ```bash
   npm run dev
   ```
2. Terminal sẽ hiển thị một mã QR (hoặc tạo file ảnh `qr_login.png` tại thư mục gốc).
3. Mở ứng dụng Zalo trên điện thoại ➡️ **Quét mã QR** ➡️ Nhấn **Xác nhận đăng nhập**.
4. Bot sẽ tự động lưu thông tin phiên vào file `session.json`. Từ các lần khởi động tiếp theo, Bot sẽ tự động đăng nhập mà không cần quét lại mã.

---

### Cách 2: Đăng nhập bằng Cookie & IMEI (Cho VPS / Server)
Nếu bạn không muốn quét QR trên server:
1. Mở trình duyệt và đăng nhập vào [chat.zalo.me](https://chat.zalo.me).
2. Nhấn `F12` ➡️ Vào tab **Console** hoặc **Application / Cookies** để lấy danh sách Cookie và IMEI của tài khoản.
3. Điền vào `.env`:
   ```env
   ZALO_COOKIE='[{"key":"_zlang","value":"vn",...}]'
   ZALO_IMEI=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   ZALO_USER_AGENT=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ...
   ```
4. Khởi động bot: `npm start`.

---

## 💬 Các Lệnh Bot Mặc Định

| Lệnh | Viết tắt | Mô tả |
| :--- | :--- | :--- |
| `/help` | `/h`, `/menu` | Hiển thị menu danh sách các lệnh của Bot |
| `/ping` | `/p` | Kiểm tra độ trễ (latency) và trạng thái hoạt động |
| `/info` | `/bot`, `/about` | Hiển thị thông tin Bot ID và thời gian Uptime |
| `/echo <nội dung>` | - | Bot lặp lại tin nhắn bạn vừa gửi |

---

## 🛠️ Hướng Dẫn Mở Rộng / Thêm Lệnh Mới

Để thêm một lệnh mới cho Bot, bạn chỉ cần mở file [src/handlers/commandHandler.ts](file:///Volumes/aki/workspace/Zalo_AI_Bot/src/handlers/commandHandler.ts) và đăng ký thêm lệnh trong phương thức `registerDefaultCommands()`:

```typescript
this.register({
  name: "chucmung",
  aliases: ["cm"],
  description: "Gửi lời chúc mừng sinh nhật",
  usage: `${config.botPrefix}chucmung`,
  execute: async ({ reply, parsedMessage }) => {
    await reply(`🎉 Chúc mừng ${parsedMessage.senderName} có một ngày thật tuyệt vời! 🎂`);
  },
});
```

---

## ⚠️ Lưu Ý Quan Trọng (Disclaimer)

1. **Giới hạn 1 Listener / Tài khoản:** Zalo chỉ cho phép **duy nhất 1 kết nối listener hoạt động cùng một lúc**. Nếu bạn đăng nhập Zalo Web trên trình duyệt trong khi Bot đang chạy, kết nối của Bot sẽ bị ngắt (Mã `CloseReason: 3000`).
2. **Rủi ro tài khoản:** `zca-js` là giải pháp mô phỏng không chính thức (Unofficial API). Bạn nên sử dụng **tài khoản Zalo phụ (clone)** để thử nghiệm phát triển tính năng, tránh gửi tin nhắn spam quá nhanh làm ảnh hưởng đến tài khoản.

import http from "node:http";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import { config } from "../config/index.js";
import { handleChatRoute } from "../server/chatRouter.js";
import { type ZaloService } from "../services/zaloService.js";

/**
 * QRWebServer: Chuyên trách phục vụ Mini Web Server quản lý phiên, mã QR và Web Portal Dashboard.
 * SRP: Tách toàn bộ Web Server / HTTP listener ra khỏi logic session và authentication.
 */

let qrServer: http.Server | null = null;
let currentQrBase64: string | null = null;
let qrStatus: "waiting" | "scanned" | "expired" | "declined" | "success" = "waiting";
let scannedUserName: string | null = null;
let loggedInAccount: {
  id: string;
  loginTime: string;
} | null = null;

let logoutCallback: (() => Promise<void> | void) | null = null;
let activeZaloService: ZaloService | null = null;

export function setZaloService(service: ZaloService): void {
  activeZaloService = service;
}

export function onLogout(callback: () => Promise<void> | void): void {
  logoutCallback = callback;
}

export function setLoggedInAccount(ownId: string): void {
  loggedInAccount = {
    id: ownId,
    loginTime: new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
  };
  qrStatus = "success";
}

export function setQrState(state: {
  image?: string | null;
  status?: "waiting" | "scanned" | "expired" | "declined" | "success";
  scannedUserName?: string | null;
}): void {
  if (state.image !== undefined) currentQrBase64 = state.image;
  if (state.status !== undefined) qrStatus = state.status;
  if (state.scannedUserName !== undefined) scannedUserName = state.scannedUserName;
}

export function startQrWebServer(port: number = config.qrPort): void {
  if (qrServer) return;

  qrServer = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url || "/", `http://localhost:${port}`);
    const pathname = parsedUrl.pathname;

    // 1. Kiểm tra và ủy quyền cho Chat Router xử lý nếu là Web Chat hoặc Static Files
    const handledByChat = await handleChatRoute(
      req,
      res,
      pathname,
      parsedUrl,
      activeZaloService,
      loggedInAccount
    );
    if (handledByChat) return;

    // 2. API GET: Trạng thái phiên & mã QR
    if (pathname === "/api/status" || pathname === "/api/qr") {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate",
      });
      res.end(
        JSON.stringify({
          isLoggedIn: !!loggedInAccount,
          account: loggedInAccount,
          status: qrStatus,
          image: currentQrBase64,
          scannedUser: scannedUserName,
        })
      );
      return;
    }

    // 3. API POST: Đăng xuất tài khoản
    if (req.method === "POST" && pathname === "/api/logout") {
      try {
        if (fsSync.existsSync(config.sessionFilePath)) {
          await fs.unlink(config.sessionFilePath);
          console.log(`\n🗑️ [LOGOUT] Đã xóa file phiên: ${config.sessionFilePath}`);
        }
        loggedInAccount = null;
        currentQrBase64 = null;
        qrStatus = "waiting";
        scannedUserName = null;

        console.log("👋 [LOGOUT] Đã đăng xuất tài khoản qua Web Portal!");
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(
          JSON.stringify({
            success: true,
            message: "Đã đăng xuất thành công. Đang tạo mã QR mới...",
          })
        );

        if (logoutCallback) {
          setTimeout(async () => {
            try {
              await logoutCallback?.();
            } catch (error) {
              console.error("❌ Lỗi khi khởi động lại sau đăng xuất:", error);
            }
          }, 300);
        }
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ success: false, error: String(err) }));
      }
      return;
    }

    // 4. Giao diện Web Portal Dashboard
    const html = `
      <!DOCTYPE html>
      <html lang="vi">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Zalo AI Bot - Quản Lý Phiên Đăng Nhập</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f0f2f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; color: #1e293b; }
          .card { background: white; border-radius: 20px; padding: 32px; box-shadow: 0 12px 40px rgba(0,0,0,0.08); text-align: center; max-width: 440px; width: 100%; transition: all 0.3s ease; }
          .logo { font-size: 26px; font-weight: 800; color: #0068ff; margin-bottom: 6px; display: flex; align-items: center; justify-content: center; gap: 8px; }
          .subtitle { color: #64748b; font-size: 14px; margin-bottom: 24px; }
          
          .status-badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 600; margin-bottom: 20px; }
          .status-waiting { background: #eff6ff; color: #1d4ed8; }
          .status-scanned { background: #fef3c7; color: #b45309; }
          .status-success { background: #dcfce7; color: #15803d; }
          .status-expired { background: #fee2e2; color: #b91c1c; }

          .qr-wrapper { background: #fff; padding: 12px; border-radius: 16px; border: 2px solid #0068ff; display: inline-block; margin-bottom: 20px; min-width: 250px; min-height: 250px; position: relative; }
          .qr-wrapper img { width: 250px; height: 250px; display: block; border-radius: 8px; }
          .qr-placeholder { width: 250px; height: 250px; display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 14px; }

          .instructions { background: #f8fafc; border-radius: 12px; padding: 14px; text-align: left; font-size: 13px; color: #334155; line-height: 1.6; margin-bottom: 16px; }
          .instructions ol { padding-left: 20px; }

          .info-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 18px; text-align: left; margin-bottom: 24px; }
          .info-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; font-size: 14px; }
          .info-row:last-child { margin-bottom: 0; }
          .info-label { color: #64748b; font-weight: 500; }
          .info-value { color: #0f172a; font-weight: 700; word-break: break-all; }

          .btn-logout { width: 100%; padding: 12px 20px; background: #ef4444; color: white; border: none; border-radius: 12px; font-size: 15px; font-weight: 600; cursor: pointer; transition: background 0.2s; display: flex; align-items: center; justify-content: center; gap: 8px; }
          .btn-logout:hover { background: #dc2626; }
          .btn-logout:disabled { background: #94a3b8; cursor: not-allowed; }

          .btn-chat-portal { width: 100%; padding: 12px 20px; background: #0068ff; color: white; border: none; border-radius: 12px; font-size: 15px; font-weight: 600; cursor: pointer; transition: background 0.2s; display: inline-flex; align-items: center; justify-content: center; gap: 8px; text-decoration: none; margin-bottom: 12px; }
          .btn-chat-portal:hover { background: #0056d6; }

          .footer { margin-top: 24px; font-size: 12px; color: #94a3b8; }
          .spinner { border: 2px solid #f3f3f3; border-top: 2px solid #0068ff; border-radius: 50%; width: 14px; height: 14px; animation: spin 1s linear infinite; display: inline-block; }
          @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="logo">🤖 Zalo AI Bot</div>
          <div class="subtitle" id="subTitle">Hệ thống Trợ lý Tuyển dụng Tự động</div>

          <!-- Giao diện khi CHƯA đăng nhập -->
          <div id="loginView">
            <div id="statusBadge" class="status-badge status-waiting">⏳ Đang khởi tạo mã QR...</div>
            <div class="qr-wrapper">
              <div id="qrPlaceholder" class="qr-placeholder">Đang tải mã QR...</div>
              <img id="qrImage" style="display: none;" alt="Zalo Login QR Code">
            </div>
            <div class="instructions">
              <ol>
                <li>Mở ứng dụng <strong>Zalo</strong> trên điện thoại</li>
                <li>Chọn biểu tượng <strong>Quét mã QR</strong> 📷</li>
                <li>Hướng camera vào mã QR ở trên</li>
                <li>Nhấn <strong>Đăng nhập</strong> trên điện thoại để xác nhận</li>
              </ol>
            </div>
          </div>

          <!-- Giao diện khi ĐÃ đăng nhập -->
          <div id="dashboardView" style="display: none;">
            <div class="status-badge status-success">🟢 Đang hoạt động (Online)</div>
            <div class="info-box">
              <div class="info-row">
                <span class="info-label">👤 Tài khoản Zalo ID:</span>
                <span class="info-value" id="accId">---</span>
              </div>
              <div class="info-row">
                <span class="info-label">⏱️ Đăng nhập lúc:</span>
                <span class="info-value" id="accLoginTime">---</span>
              </div>
              <div class="info-row">
                <span class="info-label">🤖 Model AI:</span>
                <span class="info-value">${config.geminiModel}</span>
              </div>
            </div>
            <a href="/chat" class="btn-chat-portal">💬 Mở Giao Diện Web Chat Trực Tiếp</a>
            <button id="btnLogout" class="btn-logout" onclick="handleLogout()">
              🚪 Đăng Xuất Tài Khoản
            </button>
          </div>

          <div class="footer">Web Portal đang chạy trên cổng ${port}.</div>
        </div>

        <script>
          let checkInterval = null;

          async function checkStatus() {
            try {
              const res = await fetch('/api/status');
              const data = await res.json();

              const loginView = document.getElementById('loginView');
              const dashboardView = document.getElementById('dashboardView');
              const statusEl = document.getElementById('statusBadge');
              const qrImg = document.getElementById('qrImage');
              const qrPlaceholder = document.getElementById('qrPlaceholder');

              if (data.isLoggedIn) {
                loginView.style.display = 'none';
                dashboardView.style.display = 'block';
                document.getElementById('accId').textContent = data.account.id;
                document.getElementById('accLoginTime').textContent = data.account.loginTime;
                return;
              }

              loginView.style.display = 'block';
              dashboardView.style.display = 'none';

              if (data.image) {
                qrImg.src = 'data:image/png;base64,' + data.image;
                qrImg.style.display = 'block';
                qrPlaceholder.style.display = 'none';
              }

              if (data.status === 'waiting') {
                statusEl.textContent = '⏳ Vui lòng quét mã QR...';
                statusEl.className = 'status-badge status-waiting';
              } else if (data.status === 'scanned') {
                statusEl.textContent = '👀 Đã quét! Vui lòng xác nhận trên điện thoại...';
                statusEl.className = 'status-badge status-scanned';
              } else if (data.status === 'expired') {
                statusEl.textContent = '⌛ Mã QR đã hết hạn. Đang làm mới...';
                statusEl.className = 'status-badge status-expired';
              }
            } catch (err) {
              console.error('Lỗi khi kiểm tra trạng thái:', err);
            }
          }

          async function handleLogout() {
            if (!confirm('Bạn có chắc chắn muốn đăng xuất tài khoản Zalo này không?')) return;
            const btn = document.getElementById('btnLogout');
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span> Đang đăng xuất...';
            try {
              await fetch('/api/logout', { method: 'POST' });
              setTimeout(() => {
                location.reload();
              }, 1000);
            } catch (err) {
              alert('Lỗi đăng xuất: ' + err.message);
              btn.disabled = false;
              btn.innerHTML = '🚪 Đăng Xuất Tài Khoản';
            }
          }

          checkStatus();
          checkInterval = setInterval(checkStatus, 2000);
        </script>
      </body>
      </html>
    `;

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });

  qrServer.listen(port, () => {
    console.log(`\n======================================================`);
    console.log(`🌐 [Web Portal] Sẵn sàng tại: http://localhost:${port}`);
    console.log(`💬 [Web Chat] Trò chuyện trực tiếp: http://localhost:${port}/chat`);
    console.log(`======================================================\n`);
  });
}

export function stopQrWebServer(): void {
  if (qrServer) {
    try {
      qrServer.close();
    } catch {}
    qrServer = null;
    currentQrBase64 = null;
    qrStatus = "waiting";
    scannedUserName = null;
    loggedInAccount = null;
  }
}

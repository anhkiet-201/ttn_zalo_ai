import {
  Zalo,
  type API,
  type Credentials,
  LoginQRCallbackEventType,
  type LoginQRCallbackEvent,
} from "zca-js";
import sharp from "sharp";
import jsQR from "jsqr";
import qrcode from "qrcode-terminal";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import http from "node:http";
import { config } from "../config/index.js";

/**
 * Trích xuất kích thước và metadata ảnh cho zca-js v2+
 */
export async function imageMetadataGetter(filePath: string) {
  try {
    const data = await fs.readFile(filePath);
    const metadata = await sharp(data).metadata();
    return {
      height: metadata.height ?? 0,
      width: metadata.width ?? 0,
      size: metadata.size ?? data.length,
    };
  } catch (error) {
    console.error(`❌ Lỗi khi đọc metadata ảnh (${filePath}):`, error);
    throw error;
  }
}

/**
 * Giải mã chuỗi URL Zalo thực sự trong ảnh PNG và hiển thị mã QR chuẩn trên Terminal
 */
export async function renderQrToTerminal(pngBase64: string): Promise<boolean> {
  try {
    const buffer = Buffer.from(pngBase64, "base64");
    const { data, info } = await sharp(buffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const decoded = jsQR(new Uint8ClampedArray(data), info.width, info.height);
    if (decoded && decoded.data) {
      qrcode.generate(decoded.data, { small: true });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Quản lý trạng thái và Web Portal Server
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

/**
 * Đăng ký callback khi có sự kiện Đăng xuất từ Web Portal
 */
export function onLogout(callback: () => Promise<void> | void): void {
  logoutCallback = callback;
}

/**
 * Cập nhật thông tin tài khoản sau khi đăng nhập thành công
 */
export function setLoggedInAccount(ownId: string): void {
  loggedInAccount = {
    id: ownId,
    loginTime: new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
  };
  qrStatus = "success";
}

/**
 * Khởi động Web Server quản lý phiên và mã QR
 */
export function startQrWebServer(port: number = config.qrPort): void {
  if (qrServer) return;

  qrServer = http.createServer(async (req, res) => {
    // API GET: Trả về trạng thái phiên đăng nhập & mã QR
    if (req.url === "/api/status" || req.url === "/api/qr") {
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

    // API POST: Xử lý Đăng xuất (Logout)
    if (req.method === "POST" && req.url === "/api/logout") {
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

        // Kích hoạt callback khởi động lại luồng quét mã QR mới ngay trong ứng dụng
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

    // Trang Web Portal UI
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
          
          /* Status Badges */
          .status-badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 600; margin-bottom: 20px; }
          .status-waiting { background: #eff6ff; color: #1d4ed8; }
          .status-scanned { background: #fef3c7; color: #b45309; }
          .status-success { background: #dcfce7; color: #15803d; }
          .status-expired { background: #fee2e2; color: #b91c1c; }

          /* QR Code Wrapper */
          .qr-wrapper { background: #fff; padding: 12px; border-radius: 16px; border: 2px solid #0068ff; display: inline-block; margin-bottom: 20px; min-width: 250px; min-height: 250px; position: relative; }
          .qr-wrapper img { width: 250px; height: 250px; display: block; border-radius: 8px; }
          .qr-placeholder { width: 250px; height: 250px; display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 14px; }

          /* Instructions */
          .instructions { background: #f8fafc; border-radius: 12px; padding: 14px; text-align: left; font-size: 13px; color: #334155; line-height: 1.6; margin-bottom: 16px; }
          .instructions ol { padding-left: 20px; }

          /* Dashboard Info */
          .info-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 18px; text-align: left; margin-bottom: 24px; }
          .info-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; font-size: 14px; }
          .info-row:last-child { margin-bottom: 0; }
          .info-label { color: #64748b; font-weight: 500; }
          .info-value { color: #0f172a; font-weight: 700; word-break: break-all; }

          /* Logout Button */
          .btn-logout { width: 100%; padding: 12px 20px; background: #ef4444; color: white; border: none; border-radius: 12px; font-size: 15px; font-weight: 600; cursor: pointer; transition: background 0.2s; display: flex; align-items: center; justify-content: center; gap: 8px; }
          .btn-logout:hover { background: #dc2626; }
          .btn-logout:disabled { background: #94a3b8; cursor: not-allowed; }

          .footer { font-size: 12px; color: #94a3b8; margin-top: 16px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="logo">🤖 Zalo AI Bot</div>
          <div class="subtitle" id="subTitle">Hệ thống Trợ lý Tuyển dụng Tự động</div>

          <!-- 1. GIAO DIỆN KHI CHƯA ĐĂNG NHẬP (QUÉT MÃ QR) -->
          <div id="loginView">
            <div id="statusBadge" class="status-badge status-waiting">⏳ Đang khởi tạo mã QR...</div>

            <div class="qr-wrapper">
              <div id="qrPlaceholder" class="qr-placeholder">Đang tải mã QR...</div>
              <img id="qrImage" src="" alt="Zalo Login QR Code" style="display: none;" />
            </div>

            <div class="instructions">
              <ol>
                <li>Mở app <strong>Zalo</strong> trên điện thoại.</li>
                <li>Chọn biểu tượng <strong>Quét mã QR</strong> ở góc trên.</li>
                <li>Hướng camera vào mã trên và nhấn <strong>Xác nhận đăng nhập</strong>.</li>
              </ol>
            </div>
          </div>

          <!-- 2. GIAO DIỆN KHI ĐÃ ĐĂNG NHẬP THÀNH CÔNG (DASHBOARD) -->
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

            <button id="btnLogout" class="btn-logout" onclick="handleLogout()">
              🚪 Đăng xuất tài khoản
            </button>
          </div>

          <div class="footer">Web Portal đang chạy trên cổng ${port}.</div>
        </div>

        <script>
          let lastImage = "";

          async function checkStatus() {
            try {
              const res = await fetch("/api/status");
              const data = await res.json();

              const loginView = document.getElementById("loginView");
              const dashboardView = document.getElementById("dashboardView");
              const subTitle = document.getElementById("subTitle");

              if (data.isLoggedIn && data.account) {
                // Đã đăng nhập thành công -> Hiện Dashboard
                loginView.style.display = "none";
                dashboardView.style.display = "block";
                subTitle.innerText = "Phiên hoạt động của Bot đang kết nối";
                document.getElementById("accId").innerText = data.account.id;
                document.getElementById("accLoginTime").innerText = data.account.loginTime;
              } else {
                // Chưa đăng nhập -> Hiện QR Code
                loginView.style.display = "block";
                dashboardView.style.display = "none";
                subTitle.innerText = "Quét mã QR bằng ứng dụng Zalo trên điện thoại để cấp quyền";

                const imgEl = document.getElementById("qrImage");
                const placeholderEl = document.getElementById("qrPlaceholder");
                const statusEl = document.getElementById("statusBadge");

                if (data.image && data.image !== lastImage) {
                  lastImage = data.image;
                  imgEl.src = "data:image/png;base64," + data.image;
                  imgEl.style.display = "block";
                  placeholderEl.style.display = "none";
                }

                if (data.status === "waiting") {
                  statusEl.className = "status-badge status-waiting";
                  statusEl.innerHTML = "⏳ Vui lòng quét mã QR";
                } else if (data.status === "scanned") {
                  statusEl.className = "status-badge status-scanned";
                  statusEl.innerHTML = "👀 Đã quét bởi <strong>" + (data.scannedUser || "bạn") + "</strong>! Hãy nhấn Xác nhận.";
                } else if (data.status === "expired") {
                  statusEl.className = "status-badge status-expired";
                  statusEl.innerHTML = "⌛ Mã đã hết hạn. Đang làm mới...";
                }
              }
            } catch (err) {
              console.error("Lỗi khi kiểm tra trạng thái:", err);
            }
          }

          async function handleLogout() {
            if (!confirm("Bạn có chắc chắn muốn đăng xuất tài khoản Zalo Bot này?")) {
              return;
            }

            const btn = document.getElementById("btnLogout");
            btn.disabled = true;
            btn.innerText = "⏳ Đang đăng xuất...";

            try {
              const res = await fetch("/api/logout", { method: "POST" });
              const data = await res.json();
              alert(data.message || "Đã đăng xuất thành công!");
              location.reload();
            } catch (err) {
              alert("Lỗi khi đăng xuất: " + err.message);
              btn.disabled = false;
              btn.innerText = "🚪 Đăng xuất tài khoản";
            }
          }

          setInterval(checkStatus, 1500);
          checkStatus();
        </script>
      </body>
      </html>
    `;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });

  qrServer.listen(port, () => {
    console.log(`🌐 [WEB PORTAL]: Đang mở tại http://localhost:${port} để quét mã QR và quản lý phiên`);
  });
}

function stopQrWebServer(): void {
  if (qrServer) {
    try {
      qrServer.close();
    } catch {
      // Bỏ qua
    }
    qrServer = null;
    currentQrBase64 = null;
    qrStatus = "waiting";
    scannedUserName = null;
    loggedInAccount = null;
  }
}

/**
 * Đọc file session lưu trữ trên đĩa
 */
export async function loadSession(
  sessionFilePath: string = config.sessionFilePath
): Promise<Credentials | null> {
  try {
    if (!fsSync.existsSync(sessionFilePath)) {
      return null;
    }
    const content = await fs.readFile(sessionFilePath, "utf-8");
    const parsed = JSON.parse(content) as Credentials;
    if (parsed.cookie && parsed.imei) {
      return parsed;
    }
    return null;
  } catch (error) {
    console.warn("⚠️ Không thể đọc file session hiện tại:", error);
    return null;
  }
}

/**
 * Lưu credentials vào file session
 */
export async function saveSession(
  credentials: Credentials,
  sessionFilePath: string = config.sessionFilePath
): Promise<void> {
  try {
    const dir = path.dirname(sessionFilePath);
    if (!fsSync.existsSync(dir)) {
      await fs.mkdir(dir, { recursive: true });
    }
    await fs.writeFile(
      sessionFilePath,
      JSON.stringify(credentials, null, 2),
      "utf-8"
    );
    console.log(`💾 Đã lưu session vào: ${sessionFilePath}`);
  } catch (error) {
    console.error("❌ Lỗi khi lưu file session:", error);
  }
}

/**
 * Khởi tạo instance Zalo Client
 */
export function createZaloClient(): Zalo {
  return new Zalo({
    imageMetadataGetter,
    selfListen: config.selfListen,
    checkUpdate: config.checkUpdate,
  });
}

/**
 * Tiến hành đăng nhập vào Zalo:
 * 1. Ưu tiên Credentials từ biến môi trường (.env)
 * 2. Đọc Session từ file session.json
 * 3. Nếu chưa có / hết hạn -> Hiển thị QR Code qua:
 *    - Render chuẩn trực tiếp trên SSH Terminal
 *    - Web Server mở cổng trên VPS (http://<IP_VPS>:3000)
 *    - Tự động bật ảnh trên máy nếu có Desktop GUI
 */
export async function authenticateZalo(): Promise<API> {
  const zalo = createZaloClient();

  // 1. Thử đăng nhập bằng biến môi trường
  if (config.credentials) {
    try {
      console.log("🔐 Đang thử đăng nhập bằng thông tin từ biến môi trường...");
      const api = await zalo.login(config.credentials);
      console.log("✅ Đăng nhập thành công từ biến môi trường!");
      setLoggedInAccount(api.getOwnId());
      startQrWebServer(config.qrPort);
      return api;
    } catch (error) {
      console.warn("⚠️ Đăng nhập bằng biến môi trường thất bại:", error);
    }
  }

  // 2. Thử đăng nhập bằng file session.json
  const savedSession = await loadSession(config.sessionFilePath);
  if (savedSession) {
    try {
      console.log(`🔐 Đang đăng nhập bằng file session (${config.sessionFilePath})...`);
      const api = await zalo.login(savedSession);
      console.log("✅ Đăng nhập thành công từ file session!");
      setLoggedInAccount(api.getOwnId());
      startQrWebServer(config.qrPort);
      return api;
    } catch (error) {
      console.warn("⚠️ Session đã lưu không còn hợp lệ hoặc đã hết hạn:", error);
    }
  }

  // 3. Fallback: Đăng nhập bằng mã QR
  console.log("📱 Không tìm thấy phiên hợp lệ. Khởi tạo mã QR để đăng nhập...");

  // Khởi động Mini Web Server trên VPS / Local
  startQrWebServer(config.qrPort);

  try {
    const api = await zalo.loginQR(
      {
        userAgent: config.userAgent,
      },
      async (event: LoginQRCallbackEvent) => {
        switch (event.type) {
          case LoginQRCallbackEventType.QRCodeGenerated: {
            currentQrBase64 = event.data.image;
            qrStatus = "waiting";
            scannedUserName = null;

            console.log("\n=======================================================");
            console.log("👉 VUI LÒNG QUÉT MÃ QR ĐĂNG NHẬP ZALO:");
            console.log("=======================================================\n");

            // Hướng dẫn dành cho VPS / Headless Server / Local Web
            console.log(`🌐 [WEB PORTAL]: Mở trình duyệt tại http://localhost:${config.qrPort} (hoặc http://<IP_VPS>:${config.qrPort}) để quét mã QR`);

            // Hiển thị mã QR chuẩn trên SSH Terminal
            console.log("\n📺 [TRÊN TERMINAL SSH]: Bạn có thể quét trực tiếp mã QR dưới đây:\n");
            await renderQrToTerminal(event.data.image);
            break;
          }

          case LoginQRCallbackEventType.QRCodeScanned: {
            qrStatus = "scanned";
            scannedUserName = event.data.display_name;
            console.log(
              `\n👀 Đã quét mã QR bởi người dùng: ${event.data.display_name}. Vui lòng nhấn "Xác nhận đăng nhập" trên điện thoại...`
            );
            break;
          }

          case LoginQRCallbackEventType.QRCodeExpired: {
            qrStatus = "expired";
            console.log("⌛ Mã QR đã hết hạn. Đang tự động tạo lại mã mới...");
            break;
          }

          case LoginQRCallbackEventType.QRCodeDeclined: {
            qrStatus = "declined";
            console.log("❌ Bạn đã từ chối xác nhận đăng nhập trên điện thoại.");
            break;
          }

          case LoginQRCallbackEventType.GotLoginInfo: {
            qrStatus = "success";
            console.log("🎉 Đã nhận thông tin đăng nhập thành công!");
            const newCredentials: Credentials = {
              cookie: event.data.cookie,
              imei: event.data.imei,
              userAgent: event.data.userAgent || config.userAgent,
            };
            await saveSession(newCredentials, config.sessionFilePath);
            break;
          }
        }
      }
    );

    setLoggedInAccount(api.getOwnId());
    console.log("🚀 Đăng nhập Zalo hoàn tất! Web Portal đang hoạt động làm Dashboard quản lý.");
    return api;
  } catch (error) {
    throw error;
  }
}

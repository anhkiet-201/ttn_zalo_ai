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
import { exec } from "node:child_process";
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
 * Mini Web Server phục vụ hiển thị mã QR trực tiếp qua trình duyệt trên VPS
 */
let qrServer: http.Server | null = null;
let currentQrBase64: string | null = null;

function startQrWebServer(port: number): void {
  if (qrServer) return;

  qrServer = http.createServer((req, res) => {
    if (!currentQrBase64) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h3>⏳ Đang khởi tạo mã QR hoặc đã đăng nhập thành công.</h3>");
      return;
    }

    const html = `
      <!DOCTYPE html>
      <html lang="vi">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Đăng nhập Zalo Bot - QR Code</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #eef2f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
          .card { background: white; border-radius: 16px; padding: 32px; box-shadow: 0 10px 30px rgba(0,0,0,0.08); text-align: center; max-width: 400px; width: 100%; }
          .logo { font-size: 24px; font-weight: 700; color: #0068ff; margin-bottom: 8px; }
          .subtitle { color: #555; font-size: 14px; margin-bottom: 24px; }
          .qr-wrapper { background: #fff; padding: 12px; border-radius: 12px; border: 2px solid #0068ff; display: inline-block; margin-bottom: 20px; }
          .qr-wrapper img { width: 250px; height: 250px; display: block; }
          .instructions { background: #f8fafc; border-radius: 8px; padding: 12px; text-align: left; font-size: 13px; color: #334155; line-height: 1.6; }
          .instructions ol { padding-left: 20px; }
          .footer { font-size: 12px; color: #94a3b8; margin-top: 16px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="logo">🤖 Zalo Bot Login</div>
          <div class="subtitle">Quét mã QR bằng ứng dụng Zalo trên điện thoại để cấp quyền cho Bot</div>
          <div class="qr-wrapper">
            <img src="data:image/png;base64,${currentQrBase64}" alt="Zalo Login QR Code" />
          </div>
          <div class="instructions">
            <ol>
              <li>Mở app <strong>Zalo</strong> trên điện thoại.</li>
              <li>Chọn biểu tượng <strong>Quét mã QR</strong>.</li>
              <li>Hướng camera vào mã trên và nhấn <strong>Xác nhận đăng nhập</strong>.</li>
            </ol>
          </div>
          <div class="footer">Trang sẽ tự đóng sau khi đăng nhập thành công.</div>
        </div>
      </body>
      </html>
    `;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });

  qrServer.listen(port, () => {
    // Server lắng nghe trên tất cả network interfaces
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
      return api;
    } catch (error) {
      console.warn("⚠️ Session đã lưu không còn hợp lệ hoặc đã hết hạn:", error);
    }
  }

  // 3. Fallback: Đăng nhập bằng mã QR
  console.log("📱 Không tìm thấy phiên hợp lệ. Khởi tạo mã QR để đăng nhập...");
  const qrImagePath = path.resolve(process.cwd(), "qr_login.png");

  // Khởi động Mini Web Server trên VPS
  startQrWebServer(config.qrPort);

  try {
    const api = await zalo.loginQR(
      {
        userAgent: config.userAgent,
        qrPath: qrImagePath,
      },
      async (event: LoginQRCallbackEvent) => {
        switch (event.type) {
          case LoginQRCallbackEventType.QRCodeGenerated: {
            currentQrBase64 = event.data.image;

            console.log("\n=======================================================");
            console.log("👉 VUI LÒNG QUÉT MÃ QR ĐĂNG NHẬP ZALO:");
            console.log("=======================================================\n");

            // Lưu ảnh PNG
            if (event.actions?.saveToFile) {
              await event.actions.saveToFile(qrImagePath);
            }

            // Hướng dẫn dành cho VPS / Headless Server
            console.log(`🌐 [CHO VPS]: Mở trình duyệt tại: http://<IP_VPS_CỦA_BẠN>:${config.qrPort} để xem ảnh QR`);
            console.log(`🖼️  [FILE ẢNH]: ${qrImagePath}`);

            // Thử tự động mở ảnh nếu đang chạy trên macOS / Windows có màn hình
            try {
              if (process.platform === "darwin") {
                exec(`open "${qrImagePath}"`);
              } else if (process.platform === "win32") {
                exec(`start "" "${qrImagePath}"`);
              }
            } catch {
              // Bỏ qua nếu là headless VPS
            }

            // Hiển thị mã QR chuẩn trên SSH Terminal
            console.log("\n📺 [TRÊN TERMINAL SSH]: Bạn có thể quét trực tiếp mã QR dưới đây:\n");
            await renderQrToTerminal(event.data.image);
            break;
          }

          case LoginQRCallbackEventType.QRCodeScanned: {
            console.log(
              `\n👀 Đã quét mã QR bởi người dùng: ${event.data.display_name}. Vui lòng nhấn "Xác nhận đăng nhập" trên điện thoại...`
            );
            break;
          }

          case LoginQRCallbackEventType.QRCodeExpired: {
            console.log("⌛ Mã QR đã hết hạn. Đang tự động tạo lại mã mới...");
            break;
          }

          case LoginQRCallbackEventType.QRCodeDeclined: {
            console.log("❌ Bạn đã từ chối xác nhận đăng nhập trên điện thoại.");
            break;
          }

          case LoginQRCallbackEventType.GotLoginInfo: {
            console.log("🎉 Đã nhận thông tin đăng nhập thành công!");
            const newCredentials: Credentials = {
              cookie: event.data.cookie,
              imei: event.data.imei,
              userAgent: event.data.userAgent || config.userAgent,
            };
            await saveSession(newCredentials, config.sessionFilePath);

            // Dọn dẹp
            stopQrWebServer();
            if (fsSync.existsSync(qrImagePath)) {
              try {
                await fs.unlink(qrImagePath);
              } catch {
                // Bỏ qua
              }
            }
            break;
          }
        }
      }
    );

    stopQrWebServer();
    console.log("🚀 Đăng nhập Zalo hoàn tất!");
    return api;
  } catch (error) {
    stopQrWebServer();
    throw error;
  }
}

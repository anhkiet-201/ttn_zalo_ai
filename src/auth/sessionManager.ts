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
import { config } from "../config/index.js";
import {
  startQrWebServer,
  setLoggedInAccount,
  setQrState,
} from "./qrWebServer.js";

// Re-export functions để giữ backward compatibility
export {
  setZaloService,
  onLogout,
  setLoggedInAccount,
  startQrWebServer,
  stopQrWebServer,
  updateConnectionInfo,
  getConnectionInfo,
  type ConnectionInfo,
  type ConnectionState,
} from "./qrWebServer.js";

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
 * 3. Nếu chưa có / hết hạn -> Hiển thị QR Code qua Terminal và Web Server
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
  startQrWebServer(config.qrPort);

  try {
    const api = await zalo.loginQR(
      {
        userAgent: config.userAgent,
      },
      async (event: LoginQRCallbackEvent) => {
        switch (event.type) {
          case LoginQRCallbackEventType.QRCodeGenerated: {
            setQrState({
              image: event.data.image,
              status: "waiting",
              scannedUserName: null,
            });

            console.log("\n=======================================================");
            console.log("👉 VUI LÒNG QUÉT MÃ QR ĐĂNG NHẬP ZALO:");
            console.log("=======================================================\n");
            console.log(`🌐 [WEB PORTAL]: Mở trình duyệt tại http://localhost:${config.qrPort} để quét mã QR`);
            console.log("\n📺 [TRÊN TERMINAL SSH]: Quét trực tiếp mã QR dưới đây:\n");
            await renderQrToTerminal(event.data.image);
            break;
          }

          case LoginQRCallbackEventType.QRCodeScanned: {
            setQrState({
              status: "scanned",
              scannedUserName: event.data.display_name,
            });
            console.log(
              `\n👀 Đã quét mã QR bởi: ${event.data.display_name}. Vui lòng nhấn "Xác nhận đăng nhập" trên điện thoại...`
            );
            break;
          }

          case LoginQRCallbackEventType.QRCodeExpired: {
            setQrState({ status: "expired" });
            console.log("⌛ Mã QR đã hết hạn. Đang tự động tạo lại mã mới...");
            break;
          }

          case LoginQRCallbackEventType.QRCodeDeclined: {
            setQrState({ status: "declined" });
            console.log("❌ Bạn đã từ chối xác nhận đăng nhập trên điện thoại.");
            break;
          }

          case LoginQRCallbackEventType.GotLoginInfo: {
            setQrState({ status: "success" });
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

/**
 * Kiểm tra tính hợp lệ của phiên đăng nhập qua API nhẹ (fetchAccountInfo)
 */
export async function validateSessionHealth(api: API): Promise<boolean> {
  try {
    if (!api || typeof api.fetchAccountInfo !== "function") {
      return false;
    }
    const info = await api.fetchAccountInfo();
    // Nếu API trả về dữ liệu profile hợp lệ
    return !!info && !!info.profile;
  } catch (error) {
    console.warn("⚠️ [Session Health Check] Phiên đăng nhập không phản hồi hoặc đã hết hạn:", error);
    return false;
  }
}


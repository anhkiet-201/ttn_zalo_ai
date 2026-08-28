import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import fs from "node:fs/promises";
import { Zalo, type Credentials } from "zca-js";
import { imageMetadataGetter } from "./auth/sessionManager.js";
import { config } from "./config/index.js";

/**
 * Công cụ hỗ trợ cấu hình và kiểm tra Session Zalo trực tiếp qua Cookie + IMEI
 */
async function setupSession() {
  const rl = readline.createInterface({ input, output });

  console.log("===============================================================");
  console.log("🛠️  CÔNG CỤ CẤU HÌNH PHIÊN ĐĂNG NHẬP ZALO (COOKIE + IMEI)");
  console.log("===============================================================");
  console.log(
    "💡 Hướng dẫn lấy Cookie & IMEI từ Zalo Web (chat.zalo.me):\n" +
      "  1. Đăng nhập Zalo trên trình duyệt (Chrome/Edge/Cốc Cốc) tại https://chat.zalo.me\n" +
      "  2. Cài extension 'Cookie-Editor' -> Bấm Export -> Chọn 'Export as JSON' và dán vào đây.\n" +
      "  3. Nhấn F12 -> Tab Application -> Storage -> Cookies (hoặc Network) để lấy IMEI.\n" +
      "===============================================================\n"
  );

  try {
    const imei = (
      await rl.question("🔑 1. Nhập IMEI của tài khoản Zalo (hoặc chuỗi UUID ngẫu nhiên): ")
    ).trim();

    if (!imei) {
      console.error("❌ IMEI không được để trống!");
      process.exit(1);
    }

    const userAgent =
      (
        await rl.question(
          `🌐 2. Nhập User-Agent (Nhấn Enter để dùng mặc định: "${config.userAgent}"): `
        )
      ).trim() || config.userAgent;

    console.log("\n🍪 3. Dán JSON Cookie (Sau khi dán xong, nhấn Enter 2 lần hoặc kết thúc dòng):");
    let cookieInput = "";
    for await (const line of rl) {
      if (line.trim() === "" && cookieInput.length > 0) {
        break;
      }
      cookieInput += line;
      try {
        JSON.parse(cookieInput);
        break;
      } catch {
        // Tiếp tục đọc nếu JSON chưa hoàn chỉnh
      }
    }

    let parsedCookies;
    try {
      parsedCookies = JSON.parse(cookieInput);
    } catch (err) {
      console.error("❌ JSON Cookie không hợp lệ. Vui lòng kiểm tra lại!", err);
      process.exit(1);
    }

    const credentials: Credentials = {
      cookie: parsedCookies,
      imei,
      userAgent,
      language: "vi",
    };

    console.log("\n⏳ Đang kiểm tra đăng nhập tới máy chủ Zalo...");
    const zalo = new Zalo({
      imageMetadataGetter,
      selfListen: false,
      checkUpdate: false,
    });

    const api = await zalo.login(credentials);
    const ownId = api.getOwnId();
    console.log(`🎉 ĐĂNG NHẬP THÀNH CÔNG! Tài khoản Zalo ID: ${ownId}`);

    // Lưu vào session.json
    await fs.writeFile(
      config.sessionFilePath,
      JSON.stringify(credentials, null, 2),
      "utf-8"
    );
    console.log(`💾 Đã lưu session vào: ${config.sessionFilePath}`);
    console.log("🚀 Bây giờ bạn có thể chạy: 'npm run dev' hoặc 'npm start' để bắt đầu lắng nghe tin nhắn!");
  } catch (error) {
    console.error("❌ Đăng nhập thất bại:", error);
  } finally {
    rl.close();
  }
}

setupSession();

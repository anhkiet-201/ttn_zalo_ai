import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";
import { type BotConfig, type Credentials, ThreadType } from "../types/zalo.types.js";

// Nạp các biến môi trường từ file .env
dotenv.config();

/**
 * Trích xuất credentials từ biến môi trường (nếu có)
 */
function getCredentialsFromEnv(): Credentials | undefined {
  const cookieStr = process.env.ZALO_COOKIE;
  const imei = process.env.ZALO_IMEI;
  const userAgent =
    process.env.ZALO_USER_AGENT ||
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

  if (!cookieStr || !imei) {
    return undefined;
  }

  try {
    const cookie = JSON.parse(cookieStr);
    return {
      cookie,
      imei,
      userAgent,
    };
  } catch (error) {
    console.warn("⚠️ Không thể phân tích JSON từ ZALO_COOKIE trong .env:", error);
    return undefined;
  }
}

export const config: BotConfig = {
  selfListen: process.env.SELF_LISTEN !== "false", // Mặc định là true để bắt cả tin nhắn gửi đến và gửi đi
  checkUpdate: process.env.CHECK_UPDATE !== "false",
  botPrefix: process.env.BOT_PREFIX || "/",
  sessionFilePath: path.resolve(
    process.cwd(),
    process.env.SESSION_FILE_PATH || "./session.json"
  ),
  userAgent:
    process.env.ZALO_USER_AGENT ||
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  qrPort: Number(process.env.QR_PORT) || 5000,
  credentials: getCredentialsFromEnv(),
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
  geminiFlashLiteModel: process.env.GEMINI_FLASH_LITE_MODEL || "gemini-3.5-flash-lite",
  messageDebounceSeconds: Number(process.env.MESSAGE_DEBOUNCE_SECONDS) || 30,
  minDebounceSeconds: Number(process.env.MIN_DEBOUNCE_SECONDS) || 10,
  maxDebounceSeconds:
    Number(process.env.MAX_DEBOUNCE_SECONDS) ||
    Number(process.env.MESSAGE_DEBOUNCE_SECONDS) ||
    30,
  groupDebounceSeconds: Number(process.env.GROUP_DEBOUNCE_SECONDS) || 30,
  groupIgnoreKeywords: process.env.GROUP_IGNORE_KEYWORDS
    ? process.env.GROUP_IGNORE_KEYWORDS.split(",").map((k) => k.trim().toLowerCase())
    : ["mai pv", "mai nv"],
  hrRecipientId: process.env.HR_RECIPIENT_ID || "",
  hrThreadType:
    (process.env.HR_THREAD_TYPE || "group").toLowerCase() === "user"
      ? ThreadType.User
      : ThreadType.Group,
  chatHistoryLimit: Number(process.env.CHAT_HISTORY_LIMIT) || 20,
};

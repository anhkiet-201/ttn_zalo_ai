import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";
import { type BotConfig, type Credentials } from "../types/zalo.types.js";

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

/**
 * Đọc nội dung System Instruction từ file Markdown hoặc biến môi trường
 */
export function getSystemInstruction(): string {
  const instructionPath = path.resolve(
    process.cwd(),
    process.env.GEMINI_SYSTEM_INSTRUCTION_PATH || "./system_instruction.md"
  );

  if (fs.existsSync(instructionPath)) {
    try {
      const content = fs.readFileSync(instructionPath, "utf-8").trim();
      if (content) {
        return content;
      }
    } catch (error) {
      console.warn(`⚠️ Không thể đọc file instruction (${instructionPath}):`, error);
    }
  }

  return (
    process.env.GEMINI_SYSTEM_INSTRUCTION ||
    "Bạn là một trợ lý AI thông minh, thân thiện trên Zalo. Hãy trả lời ngắn gọn, lịch sự, tự nhiên, súc tích và đúng trọng tâm bằng tiếng Việt."
  );
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
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  geminiSystemInstruction: getSystemInstruction(),
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
  chatHistoryLimit: Number(process.env.CHAT_HISTORY_LIMIT) || 20,
  erpBaseUrl: process.env.ERP_BASE_URL || "https://erp.vieclamhr.com",
  erpApiKey: process.env.ERP_API_KEY || "ttn_live_PLMxxxx",
};

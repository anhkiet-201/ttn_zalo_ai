import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { type BotConfig, type Credentials, ThreadType } from "../types/zalo.types.js";

// Nạp các biến môi trường từ file .env
dotenv.config();

/**
 * Tự động tạo chuỗi User-Agent chuẩn phù hợp với hệ điều hành và kiến trúc máy hiện tại
 */
export function buildDefaultUserAgent(): string {
  const platform = os.platform();
  const arch = os.arch();

  let osToken = "Macintosh; Intel Mac OS X 10_15_7";

  if (platform === "win32") {
    const is64 = arch === "x64" || arch === "arm64";
    osToken = is64 ? "Windows NT 10.0; Win64; x64" : "Windows NT 10.0";
  } else if (platform === "linux") {
    const linuxArch = arch === "arm64" ? "aarch64" : arch === "arm" ? "armv7l" : "x86_64";
    osToken = `X11; Linux ${linuxArch}`;
  } else if (platform === "darwin") {
    osToken = "Macintosh; Intel Mac OS X 10_15_7";
  }

  return `Mozilla/5.0 (${osToken}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36`;
}

export const DEFAULT_USER_AGENT = buildDefaultUserAgent();

/**
 * Trích xuất credentials từ biến môi trường (nếu có)
 */
function getCredentialsFromEnv(): Credentials | undefined {
  const cookieStr = process.env.ZALO_COOKIE;
  const imei = process.env.ZALO_IMEI;
  const userAgent = process.env.ZALO_USER_AGENT || DEFAULT_USER_AGENT;

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
 * Danh sách các mẫu biểu thức chính quy (Regex) mặc định dùng để lọc bỏ các tin nhắn
 * trao đổi nội bộ, hỏi thăm, đón người, phỏng vấn/nhận việc lại trong nhóm.
 */
export const DEFAULT_GROUP_IGNORE_PATTERNS: RegExp[] = [
  /mai\s+(?:pv|nv|phỏng\s+vấn|nhận\s+việc)/i,
  /(?:pv|nv|phỏng\s+vấn|nhận\s+việc)\s+lại/i,
  /(?:danh\s+sách|ds)\s+(?:pv|nv|phỏng\s+vấn|nhận\s+việc)/i,
  /(?:liên\s+hệ.*(?:ứng\s+viên|uv)|(?:ứng\s+viên|uv).*liên\s+hệ)/i,
  /đón\s+(?:dùm|giùm|giúp|hộ)/i,
];

/**
 * Phân tách chuỗi danh sách các mẫu lọc từ .env một cách thông minh,
 * không làm gãy các biểu thức regex chứa dấu phẩy (như lượng từ \d{3,5}).
 */
export function splitIgnorePatterns(input: string): string[] {
  const results: string[] = [];
  let current = "";
  let inRegex = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (char === "/" && (i === 0 || input[i - 1] !== "\\")) {
      inRegex = !inRegex;
      current += char;
    } else if (char === "," && !inRegex) {
      if (current.trim()) {
        results.push(current.trim());
      }
      current = "";
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    results.push(current.trim());
  }

  return results;
}

/**
 * Chuyển đổi chuỗi cấu hình (từ khóa thường hoặc regex) thành danh sách RegExp an toàn.
 */
export function parseIgnorePatterns(rawInput?: string): {
  keywords: string[];
  patterns: RegExp[];
} {
  const patterns: RegExp[] = [...DEFAULT_GROUP_IGNORE_PATTERNS];
  const keywords: string[] = [
    "mai pv",
    "mai nv",
    "pv lại",
    "nv lại",
    "danh sách pv",
    "danh sách nv",
    "liên hệ ứng viên",
    "đón dùm",
  ];

  if (!rawInput || !rawInput.trim()) {
    return { keywords, patterns };
  }

  const items = splitIgnorePatterns(rawInput);

  for (const item of items) {
    if (!item) continue;
    keywords.push(item);

    // Dạng regex: /pattern/flags
    const slashMatch = item.match(/^\/(.+)\/([a-z]*)$/i);
    if (slashMatch) {
      try {
        const regex = new RegExp(slashMatch[1], slashMatch[2] || "i");
        patterns.push(regex);
        continue;
      } catch (err) {
        console.warn(`⚠️ [Config] Biểu thức regex không hợp lệ trong GROUP_IGNORE_KEYWORDS: "${item}"`, err);
        continue;
      }
    }

    // Dạng prefix: regex:...
    if (item.toLowerCase().startsWith("regex:")) {
      const patternStr = item.slice(6).trim();
      try {
        const regex = new RegExp(patternStr, "i");
        patterns.push(regex);
        continue;
      } catch (err) {
        console.warn(`⚠️ [Config] Biểu thức regex không hợp lệ: "${item}"`, err);
        continue;
      }
    }

    // Từ khóa chuỗi thông thường: escape ký tự đặc biệt để match an toàn
    try {
      const escaped = item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      patterns.push(new RegExp(escaped, "i"));
    } catch {
      // Bỏ qua nếu có lỗi
    }
  }

  return { keywords, patterns };
}

const parsedIgnore = parseIgnorePatterns(process.env.GROUP_IGNORE_KEYWORDS);

export const config: BotConfig = {
  selfListen: process.env.SELF_LISTEN !== "false", // Mặc định là true để bắt cả tin nhắn gửi đến và gửi đi
  checkUpdate: process.env.CHECK_UPDATE !== "false",
  botPrefix: process.env.BOT_PREFIX || "/",
  sessionFilePath: path.resolve(
    process.cwd(),
    process.env.SESSION_FILE_PATH || "./session.json"
  ),
  userAgent: process.env.ZALO_USER_AGENT || DEFAULT_USER_AGENT,
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
  groupIgnoreKeywords: parsedIgnore.keywords,
  groupIgnorePatterns: parsedIgnore.patterns,
  groupMinMessageLength: Number(process.env.GROUP_MIN_MESSAGE_LENGTH) || 30,
  hrRecipientId: process.env.HR_RECIPIENT_ID || "",
  hrThreadType:
    (process.env.HR_THREAD_TYPE || "group").toLowerCase() === "user"
      ? ThreadType.User
      : ThreadType.Group,
  chatHistoryLimit: Number(process.env.CHAT_HISTORY_LIMIT) || 20,
};

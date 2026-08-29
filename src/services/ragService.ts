/**
 * Trách nhiệm: Đọc và build RAG context string từ các file JSON dữ liệu
 * Tương đương tts/core/rag_loader.py
 */
import fs from "node:fs";
import path from "node:path";

export function loadRagContext(baseDir: string = process.cwd()): string {
  try {
    const dataDir = path.join(baseDir, "data");

    const jobData = JSON.parse(
      fs.readFileSync(path.join(dataDir, "job_rag.json"), "utf-8")
    );
    const policyData = JSON.parse(
      fs.readFileSync(path.join(dataDir, "policy_rag.json"), "utf-8")
    );
    const locationData = JSON.parse(
      fs.readFileSync(path.join(dataDir, "location_rag.json"), "utf-8")
    );

    const ragData = [...jobData, ...policyData, ...locationData];
    const ragContextList: string[] = [];

    for (const item of ragData) {
      let content = "";
      if (item.raw_content && typeof item.raw_content === "string") {
        content = item.raw_content;

        if (item.ai_pronunciation_guide) {
          content += `\nLƯU Ý CÁCH ĐỌC: Bắt buộc viết tên khu này là '${item.ai_pronunciation_guide}' để máy đọc đúng.`;
        }

        if (item.nearby_suggestions && Array.isArray(item.nearby_suggestions)) {
          const suggestStr = item.nearby_suggestions.join(", ");
          content += `\nKHU VỰC / CỤM LIỀN KỀ LÂN CẬN: ${suggestStr}. (Lưu ý: Chỉ mở rộng gợi ý các khu vực lân cận này khi khu vực chính có dưới 2 công ty đang tuyển).`;
        }
      } else {
        content = JSON.stringify(item, null, 2);
      }

      ragContextList.push(`--- Thông tin: ${item.id || "unknown"} ---\n${content}`);
    }

    return ragContextList.join("\n\n");
  } catch (error) {
    return `Lỗi đọc file RAG: ${error}`;
  }
}

export type RagTargetFile = "job_rag" | "policy_rag" | "location_rag";

export interface RagUpdateArgs {
  action: "update_existing" | "create_new";
  targetFile: RagTargetFile;
  targetId?: string;
  updatedFields?: Record<string, unknown>;
  newEntry?: Record<string, unknown>;
  reason: string;
}

export interface RagUpdateResult {
  success: boolean;
  message: string;
  entry?: Record<string, unknown>;
}

function normalizeText(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function generateNextId(targetFile: RagTargetFile, data: Record<string, unknown>[]): string {
  const prefix =
    targetFile === "job_rag"
      ? "job"
      : targetFile === "policy_rag"
      ? "policy"
      : "location";
  let maxNum = 0;
  for (const item of data) {
    const idStr = String(item["id"] || "");
    const match = idStr.match(/_(\d+)$/);
    if (match && match[1]) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }
  }
  return `${prefix}_${String(maxNum + 1).padStart(2, "0")}`;
}

export class RAGService {
  private readonly baseDir: string;
  private readonly dataDir: string;

  // In-memory cache cho RAG context string và job data
  private cachedContext: string | null = null;
  private cachedJobRag: Record<string, unknown>[] | null = null;
  private watchers: import("fs").FSWatcher[] = [];

  private readonly RAG_FILES: RagTargetFile[] = ["job_rag", "policy_rag", "location_rag"];

  constructor(baseDir: string = process.cwd()) {
    this.baseDir = baseDir;
    this.dataDir = path.join(baseDir, "data");
    this.setupWatchers();
  }

  /**
   * Theo dõi real-time các file RAG JSON bằng fs.watch.
   * Mỗi khi file thay đổi, cache bị invalidate ngay lập tức.
   */
  private setupWatchers(): void {
    for (const ragFile of this.RAG_FILES) {
      const filePath = path.join(this.dataDir, `${ragFile}.json`);
      if (!fs.existsSync(filePath)) continue;

      try {
        const watcher = fs.watch(filePath, (eventType) => {
          if (eventType === "change" || eventType === "rename") {
            this.cachedContext = null;
            if (ragFile === "job_rag") {
              this.cachedJobRag = null;
            }
          }
        });
        this.watchers.push(watcher);
      } catch (err) {
        console.warn(`⚠️ [RAGService] Không thể theo dõi ${ragFile}.json:`, err);
      }
    }
  }

  /**
   * Đóng tất cả fs.watch watchers khi service không còn cần thiết
   */
  public destroy(): void {
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];
  }

  public buildPromptContext(): string {
    // Trả về từ cache nếu còn hợp lệ (chưa bị invalidate bởi fs.watch)
    if (this.cachedContext !== null) {
      return this.cachedContext;
    }
    const context = loadRagContext(this.baseDir);
    this.cachedContext = context;
    return context;
  }

  /**
   * Lấy trực tiếp danh sách công ty và thông tin tuyển dụng từ job_rag.json
   */
  public getJobRag(): Record<string, unknown>[] {
    if (this.cachedJobRag !== null) {
      return this.cachedJobRag;
    }
    try {
      const filePath = path.join(this.dataDir, "job_rag.json");
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      this.cachedJobRag = data;
      return data;
    } catch (err) {
      console.error("❌ Lỗi đọc job_rag.json:", err);
      return [];
    }
  }

  /**
   * Thực thi lệnh cập nhật RAG khi Gemini fire tool call "update_rag".
   * Hỗ trợ cả 3 RAG file: job_rag, policy_rag, location_rag.
   * Sau khi ghi file thành công, cache sẽ tự động được invalidate bởi fs.watch.
   */
  public executeRagUpdate(args: RagUpdateArgs): RagUpdateResult {
    const filePath = path.join(this.baseDir, "data", `${args.targetFile}.json`);

    let data: Record<string, unknown>[];
    try {
      data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch (err) {
      return { success: false, message: `Không đọc được file ${args.targetFile}.json: ${err}` };
    }

    if (args.action === "update_existing") {
      if (!args.targetId) {
        return { success: false, message: "action=update_existing nhưng thiếu targetId." };
      }
      if (!args.updatedFields || Object.keys(args.updatedFields).length === 0) {
        return { success: false, message: "action=update_existing nhưng updatedFields rỗng." };
      }

      const idx = data.findIndex((entry) => entry["id"] === args.targetId);
      if (idx === -1) {
        return {
          success: false,
          message: `Không tìm thấy entry id="${args.targetId}" trong ${args.targetFile}.json.`,
        };
      }

      // Merge fields thông minh
      const existing = data[idx] as Record<string, unknown>;
      for (const [key, value] of Object.entries(args.updatedFields)) {
        if (value === undefined || value === null || value === "") continue;

        if (key === "raw_content") {
          const valStr = String(value).trim();
          const existStr = String(existing["raw_content"] || "").trim();
          if (valStr && !existStr.includes(valStr)) {
            existing["raw_content"] = existStr ? `${existStr}\n\n[Cập nhật]: ${valStr}` : valStr;
          }
        } else if (key === "aliases" && Array.isArray(value)) {
          const curAliases = Array.isArray(existing["aliases"]) ? existing["aliases"] : [];
          existing["aliases"] = Array.from(new Set([...curAliases, ...value]));
        } else if (key !== "id") {
          existing[key] = value;
        }
      }
      data[idx] = existing;

      try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
        const msg = `✅ [RAG Update] Merge "${args.targetId}" trong ${args.targetFile}.json (${args.reason})`;
        console.log(msg);
        return { success: true, message: msg, entry: existing };
      } catch (err) {
        return { success: false, message: `Lỗi ghi file: ${err}` };
      }
    }

    if (args.action === "create_new") {
      if (!args.newEntry || Object.keys(args.newEntry).length === 0) {
        return { success: false, message: "action=create_new nhưng newEntry rỗng." };
      }

      const newEntry = { ...args.newEntry } as Record<string, unknown>;
      const newTitle = String(newEntry["title"] || "").trim();
      const normNewTitle = normalizeText(newTitle);

      // Smart Merge: Kiểm tra xem công ty/đối tượng này đã có trong file RAG chưa
      if (normNewTitle) {
        const existingIdx = data.findIndex((entry) => {
          const title = normalizeText(String(entry["title"] || ""));
          if (title && (title.includes(normNewTitle) || normNewTitle.includes(title))) {
            return true;
          }
          const aliases = Array.isArray(entry["aliases"]) ? entry["aliases"] : [];
          for (const a of aliases) {
            const normA = normalizeText(String(a));
            if (normA && (normA === normNewTitle || normNewTitle.includes(normA) || normA.includes(normNewTitle))) {
              return true;
            }
          }
          return false;
        });

        if (existingIdx !== -1) {
          const existing = data[existingIdx] as Record<string, unknown>;
          const targetId = String(existing["id"]);
          console.log(`🔄 [Smart Merge] Phát hiện "${newTitle}" đã có trong RAG (${targetId}) → Chuyển sang update_existing`);
          return this.executeRagUpdate({
            action: "update_existing",
            targetFile: args.targetFile,
            targetId,
            updatedFields: newEntry,
            reason: `Smart merge: ${args.reason}`,
          });
        }
      }

      // Sinh ID an toàn dựa trên max ID hiện tại
      if (!newEntry["id"]) {
        newEntry["id"] = generateNextId(args.targetFile, data);
      }

      data.push(newEntry);

      try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
        const msg = `✅ [RAG Create] Tạo mới "${newEntry["id"]}" trong ${args.targetFile}.json (${args.reason})`;
        console.log(msg);
        return { success: true, message: msg, entry: newEntry };
      } catch (err) {
        return { success: false, message: `Lỗi ghi file: ${err}` };
      }
    }

    return { success: false, message: `action không hợp lệ: ${args.action}` };
  }
}

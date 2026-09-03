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
      } else if (item.details) {
        content = formatRagDetailsToText(item.details);
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

export function buildRagDirectoryIndex(baseDir: string = process.cwd()): string {
  try {
    const dataDir = path.join(baseDir, "data");
    const jobData: Record<string, any>[] = JSON.parse(
      fs.readFileSync(path.join(dataDir, "job_rag.json"), "utf-8")
    );
    const policyData: Record<string, any>[] = JSON.parse(
      fs.readFileSync(path.join(dataDir, "policy_rag.json"), "utf-8")
    );
    const locationData: Record<string, any>[] = JSON.parse(
      fs.readFileSync(path.join(dataDir, "location_rag.json"), "utf-8")
    );

    const lines: string[] = [];
    lines.push("📋 [BẢNG TRA CỨU TOÀN DIỆN KHO DỮ LIỆU RAG] (BẮT BUỘC ĐỐI CHIẾU ID TẠI ĐÂY):");
    
    lines.push("\n--- 1. CÔNG TY TUYỂN DỤNG (targetFile: 'job_rag') ---");
    for (const item of jobData) {
      const aliases = Array.isArray(item.aliases) ? item.aliases.join(", ") : "";
      const loc = item.location ? ` | Địa chỉ: ${item.location}` : "";
      const map = item.map_url ? ` | Map: ${item.map_url}` : "";
      const schedule = item.interview_schedule ? ` | Hẹn: ${item.interview_schedule}` : "";
      const vacancies = item.vacancies !== undefined ? ` | Chỉ tiêu: ${item.vacancies}` : "";
      const jobType = item.job_type ? ` | Ngành: ${item.job_type}` : "";
      lines.push(`• ID [${item.id}]: ${item.title || "Chưa có tên"}${loc}${map}${schedule}${jobType} | Aliases: [${aliases}]${vacancies}`);
    }

    lines.push("\n--- 2. CHÍNH SÁCH & QUY ĐỊNH CHUNG (targetFile: 'policy_rag') ---");
    for (const item of policyData) {
      const aliases = Array.isArray(item.aliases) ? item.aliases.join(", ") : "";
      let detailStr = "";
      if (item.details && typeof item.details === "object") {
        detailStr = Object.entries(item.details)
          .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
          .join(" ; ");
      } else if (item.raw_content) {
        detailStr = String(item.raw_content);
      }
      lines.push(`• ID [${item.id}]: ${item.title || "Chính sách"} | Nội dung quy định: [${detailStr}] | Từ khóa/Aliases: [${aliases}]`);
    }

    lines.push("\n--- 3. ĐỊA ĐIỂM & KHU CÔNG NGHIỆP (targetFile: 'location_rag') ---");
    for (const item of locationData) {
      const aliases = Array.isArray(item.aliases) ? item.aliases.join(", ") : "";
      const loc = ` | Tỉnh/Huyện: ${item.district || ""}, ${item.province || ""}`;
      const nearby = Array.isArray(item.nearby_suggestions) && item.nearby_suggestions.length > 0
        ? ` | Khu lân cận: [${item.nearby_suggestions.join(", ")}]`
        : "";
      const kcn = Array.isArray(item.notable_kcn) && item.notable_kcn.length > 0
        ? ` | KCN tiêu biểu: [${item.notable_kcn.join(", ")}]`
        : "";
      const desc = item.description ? ` | Mô tả: ${item.description}` : item.raw_content ? ` | Chi tiết: ${item.raw_content}` : "";
      lines.push(`• ID [${item.id}]: ${item.title || item.location_name || "Địa điểm"}${loc}${desc}${nearby}${kcn} | Aliases: [${aliases}]`);
    }

    return lines.join("\n");
  } catch (error) {
    return `Lỗi tạo Directory Index: ${error}`;
  }
}

export type RagTargetFile = "job_rag" | "policy_rag" | "location_rag";

export interface RagUpdateArgs {
  action: "update_existing" | "create_new";
  targetFile: RagTargetFile;
  targetId?: string;
  matchedCompanyName?: string;
  matchingReason?: string;
  updatedFields?: Record<string, unknown>;
  newEntry?: Record<string, unknown>;
  reason: string;
}

export interface RagUpdateResult {
  success: boolean;
  message: string;
  entry?: Record<string, unknown>;
}

export function normalizeText(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Chuyển đổi object details (ví dụ trong policy_rag) thành văn bản có gạch đầu dòng rõ ràng, dễ đọc trên Zalo, không in ra JSON thô.
 */
export function formatRagDetailsToText(details: unknown): string {
  if (!details || typeof details !== "object") return String(details || "");

  const labelMap: Record<string, string> = {
    official_employee: "Nhân viên chính thức",
    seasonal_employee: "Lao động thời vụ",
    contribution_rate: "Tỷ lệ đóng góp",
    company: "Công ty",
    employee: "Người lao động",
    luat_ap_dung: "Luật áp dụng",
    cac_loai_hinh_bhxh: "Các loại hình BHXH",
    dieu_kien_huong_luong_huu: "Điều kiện hưởng lương hưu",
    muc_dong_bhxh_bat_buoc: "Mức đóng BHXH bắt buộc",
    nguoi_lao_dong: "Người lao động",
    nguoi_su_dung_lao_dong: "Người sử dụng lao động",
    tong_cong: "Tổng cộng",
    nghi_huu_truoc_tuoi: "Nghỉ hưu trước tuổi",
    dieu_kien_nhan_luong: "Điều kiện nhận lương",
    luong_thang: "Lương tháng",
    luong_tuan: "Lương tuần",
    luong_3_ngay: "Lương 3 ngày",
    ung_luong_tuan: "Ứng lương tuần",
    quy_dinh_xin_nghi: "Quy định xin nghỉ",
  };

  const formatLabel = (key: string) =>
    labelMap[key] ||
    key
      .replace(/_/g, " ")
      .replace(/^./, (c) => c.toUpperCase());

  const lines: string[] = [];

  if (Array.isArray(details)) {
    for (const item of details) {
      if (typeof item === "object" && item !== null) {
        lines.push(formatRagDetailsToText(item));
      } else {
        lines.push(`• ${item}`);
      }
    }
    return lines.join("\n");
  }

  for (const [key, value] of Object.entries(details as Record<string, unknown>)) {
    const label = formatLabel(key);
    if (value === undefined || value === null || value === "") continue;

    if (Array.isArray(value)) {
      lines.push(`• ${label}:`);
      for (const it of value) {
        lines.push(`  - ${it}`);
      }
    } else if (typeof value === "object") {
      lines.push(`• ${label}:`);
      for (const [subK, subV] of Object.entries(value as Record<string, unknown>)) {
        lines.push(`  - ${formatLabel(subK)}: ${subV}`);
      }
    } else {
      lines.push(`• ${label}: ${value}`);
    }
  }

  return lines.join("\n");
}

/**
 * Trích xuất nội dung văn bản tự nhiên từ một entry RAG (ưu tiên raw_content, nếu không có thì format details).
 */
export function extractRagContent(entry: Record<string, unknown> | undefined): string {
  if (!entry) return "";
  if (entry["raw_content"] && typeof entry["raw_content"] === "string" && entry["raw_content"].trim()) {
    return entry["raw_content"].trim();
  }
  if (entry["details"]) {
    return formatRagDetailsToText(entry["details"]);
  }
  return "";
}

/**
 * Hợp nhất thông minh tin tuyển dụng raw_content hiện tại với thông tin cập nhật mới.
 * Bảo toàn các trường cốt lõi (Bản đồ, địa chỉ, lương, bao cơm), đồng bộ trạng thái tuyển dụng và lịch hẹn,
 * loại bỏ triệt để tiền tố và các khối lặp "[Cập nhật]:".
 */
export function consolidateJobRawContent(
  currentRaw: string,
  newUpdateText: string,
  updatedFields: Record<string, unknown> = {}
): string {
  // 1. Làm sạch currentRaw: nếu đã bị nối nhiều đoạn [Cập nhật]: thì lấy phần gốc sạch
  let cleanBase = (currentRaw || "").trim();
  if (cleanBase.includes("[Cập nhật]:")) {
    const parts = cleanBase.split(/\[Cập nhật\]:\s*/i);
    cleanBase = parts[0].trim();
  }

  const cleanUpdate = (newUpdateText || "").trim().replace(/^\[Cập nhật\]:\s*/i, "");

  // Trích xuất map_url và location từ cleanBase nếu có để bảo toàn
  const mapMatch = cleanBase.match(/(?:📍\s*)?(?:Bản đồ\/Vị trí|Bản đồ|Map):\s*(https?:\/\/[^\s\n]+)/i);
  const existingMap = mapMatch ? mapMatch[1] : (updatedFields["map_url"] as string) || "";

  const addressMatch = cleanBase.match(/(?:📍\s*)?(?:Địa chỉ|Địa điểm|Vị trí):\s*([^\n]+)/i);
  const existingAddress = addressMatch ? addressMatch[1].trim() : (updatedFields["location"] as string) || "";

  const isFullPost =
    cleanUpdate.includes("LƯƠNG") ||
    cleanUpdate.includes("luong") ||
    cleanUpdate.includes("Lương") ||
    cleanUpdate.includes("THU NHẬP") ||
    (cleanUpdate.split("\n").filter((l) => l.trim().length > 0).length >= 4 &&
      (cleanUpdate.includes("📢") || cleanUpdate.includes("🏢") || cleanUpdate.includes("🏭") || cleanUpdate.includes("CÔNG TY")));

  let result = "";

  if (isFullPost) {
    result = cleanUpdate;
    // Đảm bảo map_url được bảo lưu nếu bài viết mới thiếu link bản đồ
    if (existingMap && !result.includes("http") && !result.includes("maps")) {
      const lines = result.split("\n");
      const insertIdx = lines.findIndex((l) => l.includes("Địa chỉ") || l.includes("Địa điểm"));
      if (insertIdx !== -1) {
        lines.splice(insertIdx + 1, 0, `- Bản đồ/Vị trí: ${existingMap}`);
        result = lines.join("\n");
      } else {
        result += `\n- Bản đồ/Vị trí: ${existingMap}`;
      }
    }
  } else {
    // cleanUpdate là thông báo ngắn hoặc cập nhật lịch hẹn/yêu cầu
    result = cleanBase;

    // Bổ sung các lưu ý mới vào bài viết
    if (cleanUpdate && !result.includes(cleanUpdate)) {
      result += `\n- Lưu ý / Yêu cầu: ${cleanUpdate}`;
    }
  }

  // 2. Đồng bộ hóa trạng thái tuyển dụng (vacancies)
  const vacancies = updatedFields["vacancies"];
  if (vacancies !== undefined && vacancies !== null) {
    const vacNum = Number(vacancies);
    if (vacNum === 0) {
      // Tạm ngưng tuyển
      if (!result.includes("TẠM NGƯNG TUYỂN")) {
        const lines = result.split("\n");
        if (lines.length > 0 && !lines[0].includes("TẠM NGƯNG")) {
          lines[0] = `${lines[0]} (HIỆN TẠI TẠM NGƯNG TUYỂN)`;
        }
        result = lines.join("\n");
      }
      result = result.replace(
        /(?:-\s*)?Số lượng (?:cần|đang) tuyển:\s*[^\n]+/i,
        "- Số lượng cần tuyển: 0 người (Tạm ngưng tuyển)"
      );
    } else {
      // Đang tuyển lại -> Xóa bỏ toàn bộ nhãn tạm ngưng
      result = result
        .replace(/\(HIỆN TẠI TẠM NGƯNG TUYỂN\)/gi, "")
        .replace(/\(Tạm ngưng tuyển\)/gi, "")
        .replace(/\(TẠM NGƯNG[^\)]*\)/gi, "")
        .trim();

      const vacStr = `- Số lượng cần tuyển: ${vacNum} người (Đang tuyển)`;
      if (/(?:-\s*)?Số lượng (?:cần|đang) tuyển:/i.test(result)) {
        result = result.replace(/(?:-\s*)?Số lượng (?:cần|đang) tuyển:[^\n]*/i, vacStr);
      }
    }
  }

  // 3. Đồng bộ hóa lịch hẹn (interview_schedule)
  const interviewSchedule = (updatedFields["interview_schedule"] as string) || "";
  if (interviewSchedule) {
    const schedStr = `- Lịch hẹn nhận việc: ${interviewSchedule}`;
    if (/(?:-\s*)?Lịch hẹn(?: nhận việc)?:/i.test(result)) {
      result = result.replace(/(?:-\s*)?Lịch hẹn(?: nhận việc)?:[^\n]*/i, schedStr);
    } else {
      const lines = result.split("\n");
      const vacIdx = lines.findIndex((l) => l.includes("Số lượng"));
      if (vacIdx !== -1) {
        lines.splice(vacIdx + 1, 0, schedStr);
        result = lines.join("\n");
      } else {
        result += `\n${schedStr}`;
      }
    }
  }

  // 4. Làm sạch triệt để: xóa khoảng trắng thừa, xóa mọi chuỗi [Cập nhật]: còn sót và emoji
  result = result
    .replace(/\[Cập nhật\]:\s*/gi, "")
    .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E0}-\u{1F1FF}]/gu, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return result;
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
  private static instance: RAGService | null = null;

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
   * Singleton pattern để tái sử dụng một instance duy nhất trong toàn hệ thống
   */
  public static getInstance(baseDir?: string): RAGService {
    if (!RAGService.instance) {
      RAGService.instance = new RAGService(baseDir);
    }
    return RAGService.instance;
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
    if (RAGService.instance === this) {
      RAGService.instance = null;
    }
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
   * Tạo bảng tóm tắt danh mục toàn bộ ID, tên công ty và từ khóa để AI tra cứu đối chiếu chuẩn xác
   */
  public buildDirectoryIndex(): string {
    return buildRagDirectoryIndex(this.baseDir);
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
   * Lấy danh sách tên công ty và các tên viết tắt / bí danh để hỗ trợ nhận diện giọng nói (Audio STT)
   */
  public getCompanyHints(): string[] {
    const jobs = this.getJobRag();
    const hints = new Set<string>();
    for (const job of jobs) {
      if (job.title && typeof job.title === "string") {
        hints.add(job.title.trim());
      }
      if (Array.isArray(job.aliases)) {
        for (const alias of job.aliases) {
          if (alias && typeof alias === "string") {
            hints.add(alias.trim());
          }
        }
      }
    }
    return Array.from(hints);
  }

  /**
   * Lấy chi tiết một entry theo targetFile và id
   */
  public getEntryById(targetFile: RagTargetFile, id: string): Record<string, unknown> | null {
    try {
      const filePath = path.join(this.baseDir, "data", `${targetFile}.json`);
      if (!fs.existsSync(filePath)) return null;
      const data: Record<string, unknown>[] = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      return data.find((entry) => entry["id"] === id) || null;
    } catch (err) {
      console.error(`❌ [RAGService] Lỗi khi getEntryById(${targetFile}, ${id}):`, err);
      return null;
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

      // Merge fields thông minh: CẬP NHẬT đè nội dung mới, tuyệt đối không nối chuỗi
      const existing = data[idx] as Record<string, unknown>;
      for (const [key, value] of Object.entries(args.updatedFields)) {
        if (value === undefined || value === null || value === "") continue;

        if (key === "raw_content") {
          const valStr = String(value).trim();
          if (valStr) {
            existing["raw_content"] = valStr;
          }
        } else if (key === "aliases" && Array.isArray(value)) {
          const curAliases = Array.isArray(existing["aliases"]) ? existing["aliases"] : [];
          existing["aliases"] = Array.from(new Set([...curAliases, ...value]));
        } else if (key !== "id") {
          existing[key] = value;
        }
      }

      // Tự động đồng bộ trạng thái và lịch hẹn trong raw_content nếu raw_content chưa được cập nhật trực tiếp
      if (args.targetFile === "job_rag" && typeof existing["raw_content"] === "string") {
        existing["raw_content"] = consolidateJobRawContent(
          existing["raw_content"] as string,
          "",
          args.updatedFields
        );
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

  /**
   * Xóa một hoặc nhiều mục trong kho RAG theo ID hoặc từ khóa tìm kiếm (tên công ty, aliases)
   */
  public deleteRagEntry(params: {
    targetFile?: "job_rag" | "policy_rag" | "location_rag" | "all" | string;
    targetId?: string;
    keyword?: string;
    reason?: string;
  }): {
    success: boolean;
    message: string;
    deletedItems: Array<{
      targetFile: string;
      id: string;
      title: string;
      aliases?: string[];
    }>;
  } {
    const { targetFile = "all", targetId, keyword, reason } = params;
    const filesToSearch =
      targetFile === "all" || !targetFile
        ? this.RAG_FILES
        : [targetFile.replace(/\.json$/i, "")];

    const cleanKeyword = (keyword || "").trim();
    const normKeyword = cleanKeyword ? normalizeText(cleanKeyword) : "";
    const cleanTargetId = (targetId || "").trim().toLowerCase();

    if (!cleanKeyword && !cleanTargetId) {
      return {
        success: false,
        message: "Vui lòng cung cấp ID hoặc từ khóa tên công ty/chính sách cần xóa.",
        deletedItems: [],
      };
    }

    const deletedItems: Array<{
      targetFile: string;
      id: string;
      title: string;
      aliases?: string[];
    }> = [];

    for (const rFile of filesToSearch) {
      const filePath = path.join(this.baseDir, "data", `${rFile}.json`);
      if (!fs.existsSync(filePath)) continue;

      let data: Record<string, unknown>[];
      try {
        data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      } catch {
        continue;
      }

      const keptEntries: Record<string, unknown>[] = [];
      let fileModified = false;

      for (const entry of data) {
        const entryId = String(entry["id"] || "").toLowerCase();
        const entryTitle = String(entry["title"] || "");
        const normTitle = normalizeText(entryTitle);
        const aliases = Array.isArray(entry["aliases"]) ? (entry["aliases"] as string[]) : [];

        let isMatch = false;

        // 1. So khớp theo targetId hoặc ID
        if (cleanTargetId && (entryId === cleanTargetId || entryId === cleanKeyword)) {
          isMatch = true;
        }

        // 2. So khớp theo keyword tên công ty / title
        if (!isMatch && normKeyword) {
          if (entryId === normKeyword) {
            isMatch = true;
          } else if (normTitle && (normTitle === normKeyword || normTitle.includes(normKeyword) || normKeyword.includes(normTitle))) {
            isMatch = true;
          } else {
            // So khớp theo danh sách aliases
            for (const a of aliases) {
              const normA = normalizeText(String(a));
              if (normA && (normA === normKeyword || normKeyword.includes(normA) || normA.includes(normKeyword))) {
                isMatch = true;
                break;
              }
            }
          }
        }

        if (isMatch) {
          fileModified = true;
          deletedItems.push({
            targetFile: `${rFile}.json`,
            id: String(entry["id"] || "N/A"),
            title: entryTitle || String(entry["id"] || "Không rõ"),
            aliases,
          });
        } else {
          keptEntries.push(entry);
        }
      }

      if (fileModified) {
        try {
          fs.writeFileSync(filePath, JSON.stringify(keptEntries, null, 2), "utf-8");
          this.cachedContext = null;
          if (rFile === "job_rag") {
            this.cachedJobRag = null;
          }
        } catch (err) {
          console.error(`❌ Lỗi ghi file sau khi xóa trong ${rFile}.json:`, err);
        }
      }
    }

    if (deletedItems.length > 0) {
      const summaryTitles = deletedItems.map((it) => `"${it.title}" (${it.id})`).join(", ");
      const msg = `🗑️ [RAG Delete] Đã xóa ${deletedItems.length} mục: ${summaryTitles} (${reason || "Yêu cầu xóa từ HR"})`;
      console.log(msg);
      return {
        success: true,
        message: msg,
        deletedItems,
      };
    }

    return {
      success: false,
      message: `Không tìm thấy mục nào khớp với từ khóa "${keyword || targetId}".`,
      deletedItems: [],
    };
  }
}

import { GoogleGenAI, type FunctionDeclaration, Type } from "@google/genai";
import { config, getSystemInstruction } from "../config/index.js";
import { RAGService, type RagUpdateArgs } from "./ragService.js";
import { ChatHistoryRepository } from "../database/index.js";
import { type GroupQueuedMessage } from "../handlers/groupMessageBatcher.js";

export interface CCCDAnalysisResult {
  isCCCD: boolean;
  fullName?: string;
  idNumber?: string;
  dob?: string;
  gender?: string;
  nationality?: string;
  homeTown?: string;
  residence?: string;
  expiryDate?: string;
  description?: string;
  rawText?: string;
}

export type ToolExecutionHandler = (
  toolName: string,
  args: Record<string, any>
) => Promise<Record<string, any>>;

export interface GenerateReplyOptions {
  senderId?: string;
  isGroup?: boolean;
  quoteContext?: string;
  imageUrls?: string[];
  userContextText?: string;
  onToolCall?: ToolExecutionHandler;
}

export interface RagUpdateItemReport {
  targetFile: string;
  action: "create_new" | "update_existing";
  targetId?: string;
  title?: string;
  reason?: string;
  entry?: Record<string, unknown>;
  summary: string;
  success: boolean;
  message?: string;
}

export interface RagUpdateReport {
  success: boolean;
  message: string;
  updatedCount: number;
  items: RagUpdateItemReport[];
}

/**
 * Danh sách các Tools (Function Declarations) cho AI đưa ra quyết định nghiệp vụ tuyển dụng
 */
export const recruitmentTools: FunctionDeclaration[] = [
  {
    name: "register_candidate",
    description:
      "CỰC KỲ QUAN TRỌNG — QUY TRÌNH XÁC NHẬN 2 BƯỚC BẮT BUỘC: " +
      "Bước 1: Khi ứng viên đã có giấy tờ định danh (CCCD/VNeID) và chọn công ty, bot phải hỏi xác nhận lại với ứng viên (VD: 'Dạ vậy em đặt lịch hẹn cho anh vào sáng mai lúc 7h30 ở cty Chervon nha?') và TUYỆT ĐỐI CHƯA GỌI TOOL. " +
      "Bước 2: CHỈ GỌI TOOL NÀY KHI VÀ CHỈ KHI ứng viên PHẢN HỒI ĐỒNG Ý / XÁC NHẬN (VD: 'Đúng rồi em', 'Ok em', 'Chốt đi', 'Xác nhận nha', 'Uhm em') với câu hỏi xác nhận trước đó của bot. " +
      "Nếu người dùng gửi nhiều CCCD cho nhiều người khác nhau, hãy chỉ định candidateIdNumber hoặc candidateFullName của người cần đăng ký (hoặc gọi tool cho từng người). " +
      "TUYỆT ĐỐI CẤM GỌI khi ứng viên chỉ đang hỏi thăm hoặc chưa qua bước xác nhận đồng ý.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        targetCompany: {
          type: Type.STRING,
          description:
            "Tên chuẩn của công ty mà người tìm việc ĐĂNG KÝ (vd: Chervon, Kaiser, Supor, Leader, Sanaky, Gỗ Wangshun, Sofa Hằng Phong, Dân Ôn, CMT, Gỗ Minh Huy, New Fortune).",
        },
        phoneNumber: {
          type: Type.STRING,
          description: "Số điện thoại của người tìm việc nếu họ cung cấp.",
        },
        interviewDate: {
          type: Type.STRING,
          description:
            "Thời gian hẹn nhận việc / phỏng vấn. BẮT BUỘC quy đổi ra NGÀY CỤ THỂ theo lịch dương kèm giờ (VD: '7h30 sáng Thứ Sáu, ngày 28/08/2026' nếu hẹn sáng mai, hoặc '7h30 sáng Thứ Bảy, ngày 29/08/2026' nếu hẹn 2 ngày sau). Tuyệt đối không để chữ tương đối mơ hồ.",
        },
        candidateIdNumber: {
          type: Type.STRING,
          description:
            "Số CCCD của ứng viên cần đăng ký (trích xuất từ User Context). Dùng khi người dùng gửi nhiều CCCD để đăng ký cho người cụ thể.",
        },
        candidateFullName: {
          type: Type.STRING,
          description:
            "Họ tên của ứng viên cần đăng ký (trích xuất từ User Context).",
        },
        notes: {
          type: Type.STRING,
          description: "Ghi chú thêm nếu có.",
        },
      },
      required: ["targetCompany", "interviewDate"],
    },
  },
  {
    name: "switch_company",
    description:
      "CỰC KỲ QUAN TRỌNG — QUY TRÌNH XÁC NHẬN 2 BƯỚC BẮT BUỘC: " +
      "Bước 1: Khi ứng viên nói muốn đổi công ty, bot phải hỏi xác nhận lại (VD: 'Dạ vậy anh muốn đổi sang làm bên cty Chervon đúng ko ạ?') và TUYỆT ĐỐI CHƯA GỌI TOOL. " +
      "Bước 2: CHỈ GỌI TOOL NÀY KHI VÀ CHỈ KHI ứng viên PHẢN HỒI ĐỒNG Ý / XÁC NHẬN (VD: 'Đúng rồi em', 'Ok em', 'Chốt đổi qua đó nha', 'Uhm em') với câu hỏi xác nhận trước đó của bot. " +
      "TUYỆT ĐỐI CẤM GỌI TOOL NÀY KHI ứng viên chỉ đang HỎI THÔNG TIN / THẮC MẮC (VD: 'Cty jinxin thì sao', 'Cty Kaiser lương sao', 'Bên Chervon làm gì em', 'Còn công ty nào khác ko').",
    parameters: {
      type: Type.OBJECT,
      properties: {
        newCompany: {
          type: Type.STRING,
          description: "Tên chuẩn của công ty MỚI mà ứng viên khẳng định muốn chuyển sang.",
        },
        oldCompany: {
          type: Type.STRING,
          description: "Tên công ty cũ mà ứng viên muốn đổi đi (nếu biết).",
        },
        reason: {
          type: Type.STRING,
          description: "Lý do đổi công ty nếu ứng viên có chia sẻ.",
        },
      },
      required: ["newCompany"],
    },
  },
  {
    name: "reschedule_interview",
    description:
      "CỰC KỲ QUAN TRỌNG — QUY TRÌNH XÁC NHẬN 2 BƯỚC BẮT BUỘC: " +
      "Bước 1: Khi ứng viên muốn dời lịch, bot hỏi xác nhận mốc thời gian hẹn mới (VD: 'Dạ vậy em dời lịch hẹn cho anh sang 7h30 sáng Thứ Hai ngày 31/08 nha?') và TUYỆT ĐỐI CHƯA GỌI TOOL. " +
      "Bước 2: CHỈ GỌI TOOL NÀY KHI VÀ CHỈ KHI ứng viên PHẢN HỒI ĐỒNG Ý / XÁC NHẬN (VD: 'Ok em', 'Đúng rồi em', 'Chốt ngày đó nha') với câu hỏi xác nhận trước đó của bot.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        newDate: {
          type: Type.STRING,
          description:
            "Mốc thời gian hẹn mới. BẮT BUỘC quy đổi ra NGÀY CỤ THỂ theo lịch dương kèm giờ (VD: '7h30 sáng Thứ Bảy, ngày 29/08/2026' nếu hẹn 2 ngày nữa, '7h30 sáng Thứ Hai, ngày 31/08/2026' nếu hẹn đầu tuần sau). Tuyệt đối không để chữ tương đối mơ hồ.",
        },
        targetCompany: {
          type: Type.STRING,
          description: "Tên công ty mà ứng viên đang hẹn nhận việc.",
        },
        reason: {
          type: Type.STRING,
          description: "Lý do dời lịch nếu ứng viên có nói.",
        },
      },
      required: ["newDate"],
    },
  },
];

/**
 * Tool Declarations cho phân tích tin nhắn nhóm và cập nhật kho RAG.
 * Tách biệt hoàn toàn với recruitmentTools (dùng cho luồng ứng viên cá nhân).
 */
export const groupRagTools: FunctionDeclaration[] = [
  {
    name: "update_rag",
    description:
      "BẮT BUỘC GỌI TOOL NÀY khi phát hiện bất kỳ thông tin nào về tuyển dụng (số lượng người, ca làm, vị trí, công ty), link Google Maps, địa chỉ, chính sách hoặc địa điểm trong tin nhắn nhóm. " +
      "Trích xuất đầy đủ các trường: title, location, map_url, vacancies, interview_schedule, job_type, aliases, raw_content.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description:
            '"update_existing": khi công ty/chính sách/địa điểm ĐÃ CÓ trong kho RAG hiện tại (hoặc vừa được tạo trước đó). ' +
            '"create_new": khi công ty/chính sách/địa điểm HOÀN TOÀN MỚI chưa từng có trong kho RAG.',
        },
        targetFile: {
          type: Type.STRING,
          description:
            'File RAG mục tiêu: "job_rag" (tuyển dụng, số lượng người, link map, địa chỉ), "policy_rag" (chính sách, quy định), "location_rag" (địa điểm).',
        },
        targetId: {
          type: Type.STRING,
          description:
            'ID của entry cần cập nhật khi action="update_existing" (ví dụ: "job_13" cho Công ty ADC, "job_06" cho Sanaky). Bỏ qua nếu action="create_new".',
        },
        updatedFields: {
          type: Type.OBJECT,
          description:
            'Các trường cần merge/cập nhật khi action="update_existing" (vd: map_url, location, vacancies, interview_schedule, raw_content...).',
          properties: {
            title: { type: Type.STRING, description: "Tên công ty kèm khu vực (vd: 'Công ty ADC – Đồng An 2')" },
            location: { type: Type.STRING, description: "Địa chỉ cụ thể hoặc Khu công nghiệp (vd: 'Đối diện KCN Đồng An 2, Bình Dương')" },
            map_url: { type: Type.STRING, description: "Đường link Google Maps (vd: 'https://maps.app.goo.gl/...')" },
            vacancies: { type: Type.INTEGER, description: "Số lượng người cần tuyển (số nguyên)" },
            interview_schedule: { type: Type.STRING, description: "Lịch hẹn phỏng vấn / nhận việc (vd: 'Cổng công ty 7h30 sáng')" },
            job_type: { type: Type.STRING, description: "Ngành nghề sản xuất hoặc loại công việc (vd: 'Sản xuất, thời vụ')" },
            aliases: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Các tên viết tắt, gọi tắt (vd: ['adc', 'công ty adc'])" },
            raw_content: { type: Type.STRING, description: "Nội dung tin nhắn bổ sung" },
          },
        },
        newEntry: {
          type: Type.OBJECT,
          description:
            'Dữ liệu entry mới khi action="create_new". Bắt buộc trích xuất đầy đủ: title, location, map_url, vacancies, interview_schedule, job_type, aliases, raw_content.',
          properties: {
            title: { type: Type.STRING, description: "Tên công ty kèm khu vực (vd: 'Công ty ADC – Đồng An 2')" },
            location: { type: Type.STRING, description: "Địa chỉ cụ thể hoặc Khu công nghiệp (vd: 'Đối diện KCN Đồng An 2, Bình Dương')" },
            map_url: { type: Type.STRING, description: "Đường link Google Maps (nếu có)" },
            vacancies: { type: Type.INTEGER, description: "Số lượng người cần tuyển (số nguyên)" },
            interview_schedule: { type: Type.STRING, description: "Lịch hẹn phỏng vấn / nhận việc (vd: 'Cổng công ty 7h30 sáng')" },
            job_type: { type: Type.STRING, description: "Ngành nghề sản xuất hoặc loại công việc" },
            aliases: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Các tên viết tắt, gọi tắt của công ty" },
            raw_content: { type: Type.STRING, description: "Toàn bộ nội dung thông báo tuyển dụng chi tiết (lương, ca làm, phụ cấp, yêu cầu)" },
          },
        },
        reason: {
          type: Type.STRING,
          description: "Lý do cập nhật (ví dụ: 'Cập nhật link map cho Công ty ADC' hoặc 'Tạo mới Công ty ADC tuyển 30 người').",
        },
      },
      required: ["action", "targetFile", "reason"],
    },
  },
];

interface TextPart {
  text: string;
}

interface InlineDataPart {
  inlineData: {
    mimeType: string;
    data: string;
  };
}

type ChatMessagePart = TextPart | InlineDataPart;

interface ChatContent {
  role: "user" | "model";
  parts: ChatMessagePart[];
}

/**
 * AIService: Quản lý tích hợp Google Gemini AI, RAG Knowledge Base và Lịch sử trò chuyện trên SQLite Database
 */
export class AIService {
  private ai: GoogleGenAI | null = null;
  private ragService: RAGService;
  private chatHistoryRepo: ChatHistoryRepository;
  private readonly maxHistoryLength: number = 20; // Lấy tối đa 20 lượt tin nhắn gần nhất từ SQLite để AI nắm trọn ngữ cảnh

  constructor(ragService?: RAGService, chatHistoryRepo?: ChatHistoryRepository) {
    this.ragService = ragService || new RAGService();
    this.chatHistoryRepo = chatHistoryRepo || new ChatHistoryRepository();

    if (config.geminiApiKey) {
      this.ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
      console.log(`🧠 [Gemini AI] Đã khởi tạo thành công Model: ${config.geminiModel}`);
    } else {
      console.warn(
        "⚠️ [Gemini AI] Chưa cấu hình GEMINI_API_KEY trong file .env. Vui lòng thêm GEMINI_API_KEY để kích hoạt tính năng tự động trả lời bằng AI!"
      );
    }
  }

  /**
   * Lấy instance RAG Service
   */
  public get rag(): RAGService {
    return this.ragService;
  }

  /**
   * Lấy instance Chat History Repository
   */
  public get chatHistory(): ChatHistoryRepository {
    return this.chatHistoryRepo;
  }

  /**
   * Kiểm tra xem Gemini AI đã sẵn sàng hoạt động hay chưa
   */
  public isReady(): boolean {
    return Boolean(this.ai);
  }

  /**
   * Tải hình ảnh từ URL và chuyển thành Base64 kèm timeout 60s và cơ chế retry
   */
  private async downloadImageAsBase64(
    url: string,
    retryCount: number = 1
  ): Promise<{ mimeType: string; data: string } | null> {
    if (!url || typeof url !== "string") {
      return null;
    }

    const trimmedUrl = url.trim();

    // 1. Kiểm tra tính hợp lệ của URL (chỉ chấp nhận http hoặc https)
    try {
      const parsedUrl = new URL(trimmedUrl);
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        console.warn(`⚠️ [Gemini AI] Bỏ qua URL không hợp lệ (sai protocol): ${trimmedUrl}`);
        return null;
      }
    } catch {
      console.warn(`⚠️ [Gemini AI] URL hình ảnh sai định dạng: ${trimmedUrl}`);
      return null;
    }

    // 2. Fetch ảnh bất đồng bộ với timeout 60 giây (60000ms)
    for (let attempt = 0; attempt <= retryCount; attempt++) {
      try {
        const res = await fetch(trimmedUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
            Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          },
          signal: AbortSignal.timeout(60000),
        });

        if (!res.ok) {
          console.warn(`⚠️ [Gemini AI] Không thể tải ảnh (HTTP ${res.status}): ${trimmedUrl}`);
          if (attempt < retryCount) {
            await new Promise((r) => setTimeout(r, 1000));
            continue;
          }
          return null;
        }

        // 3. Kiểm tra Content-Type
        const rawContentType = res.headers.get("content-type") || "";
        const mimeType = rawContentType.split(";")[0].trim().toLowerCase();

        const isImage =
          mimeType.startsWith("image/") || mimeType === "application/octet-stream";
        if (!isImage && mimeType) {
          console.warn(
            `⚠️ [Gemini AI] URL không phải là hình ảnh (Content-Type: ${mimeType}): ${trimmedUrl}`
          );
          return null;
        }

        const buffer = await res.arrayBuffer();
        if (buffer.byteLength === 0) {
          console.warn(`⚠️ [Gemini AI] Ảnh tải về bị rỗng (0 bytes): ${trimmedUrl}`);
          return null;
        }

        return {
          mimeType: mimeType.startsWith("image/") ? mimeType : "image/jpeg",
          data: Buffer.from(buffer).toString("base64"),
        };
      } catch (error: any) {
        if (attempt < retryCount) {
          console.warn(
            `🔄 [Gemini AI] Thử lại tải ảnh lần ${attempt + 1} (${trimmedUrl})...`
          );
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }

        if (error?.name === "TimeoutError") {
          console.warn(
            `⏱️ [Gemini AI] Tải ảnh bị quá thời gian (Timeout 60s): ${trimmedUrl}`
          );
        } else {
          console.warn(`⚠️ [Gemini AI] Không thể tải ảnh từ URL: ${trimmedUrl}`, error);
        }
        return null;
      }
    }
    return null;
  }

  /**
   * Định dạng thời gian theo chuẩn tiếng Việt (vd: "Thứ Năm, 27/08/2026 16:39:05")
   */
  public formatTimestamp(ts?: number): string {
    const date = ts ? new Date(ts) : new Date();
    return date.toLocaleString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      weekday: "long",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  /**
   * Cung cấp ngữ cảnh thời gian chi tiết (Hôm nay, Ngày mai, Ngày mốt, Thứ trong tuần) để AI tính toán chính xác
   */
  public getCurrentDateTimeContext(): string {
    const now = new Date();
    const formatter = (d: Date) =>
      d.toLocaleDateString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        weekday: "long",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });

    const timeFormatter = (d: Date) =>
      d.toLocaleTimeString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const dayAfterTomorrow = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
    const threeDaysLater = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    return `📅 THỜI GIAN THỰC HỆ THỐNG:
• Bây giờ là: ${timeFormatter(now)}
• Hôm nay là: ${formatter(now)}
• Ngày mai là: ${formatter(tomorrow)}
• Ngày mốt (2 ngày nữa) là: ${formatter(dayAfterTomorrow)}
• 3 ngày nữa là: ${formatter(threeDaysLater)}`;
  }

  /**
   * Phân tích và kiểm tra xem hình ảnh có phải là thẻ CCCD hay không, nếu có trích xuất chi tiết
   */
  public async analyzeCCCD(
    imageUrls: string[]
  ): Promise<CCCDAnalysisResult | null> {
    if (!this.ai || imageUrls.length === 0) return null;

    try {
      const userParts: ChatMessagePart[] = [
        {
          text: `Bạn là hệ thống OCR nhận diện tài liệu Căn cước công dân (CCCD / Thẻ căn cước / CMND) Việt Nam chuyên nghiệp.
Hãy phân tích các hình ảnh đính kèm:
1. Xác định xem các hình ảnh có chứa Căn cước công dân (CCCD / CMND / Thẻ căn cước) của Việt Nam không (kể cả ảnh mặt trước, mặt sau, hoặc cả 2 mặt).
2. Nếu là CCCD/CMND (mặt trước hoặc mặt sau hoặc cả hai), hãy trích xuất toàn bộ các trường thông tin có thể đọc được và trả về định dạng JSON:
{
  "isCCCD": true,
  "fullName": "Họ và tên in hoa (nếu đọc được)",
  "idNumber": "Số định danh / Số CCCD gồm 12 hoặc 9 số (nếu đọc được)",
  "dob": "Ngày tháng năm sinh (dd/mm/yyyy)",
  "gender": "Nam hoặc Nữ",
  "nationality": "Quốc tịch (Việt Nam)",
  "homeTown": "Quê quán / Nơi sinh",
  "residence": "Nơi thường trú / Địa chỉ cư trú",
  "expiryDate": "Có giá trị đến / Hạn sử dụng"
}
3. Nếu không phải là CCCD (ví dụ: ảnh phong cảnh, giấy tờ khác, bảng tin, meme, selfie...):
{
  "isCCCD": false,
  "description": "Tóm tắt nội dung bức ảnh"
}
LƯU Ý: Chỉ trả về JSON thuần túy, không bao bọc bằng markdown, không thêm bất kỳ văn bản nào ngoài JSON.`,
        },
      ];

      // Chạy process bất đồng bộ song song để tải tất cả hình ảnh cùng lúc
      const downloadResults = await Promise.all(
        imageUrls.map((url) => this.downloadImageAsBase64(url))
      );

      for (const img of downloadResults) {
        if (img) {
          userParts.push({
            inlineData: {
              mimeType: img.mimeType,
              data: img.data,
            },
          });
        }
      }

      const response = await this.ai.models.generateContent({
        model: config.geminiModel,
        contents: [{ role: "user", parts: userParts }],
      });

      const responseText = response.text?.trim() || "";
      const cleanJson = responseText
        .replace(/^```(?:json)?/i, "")
        .replace(/```$/, "")
        .trim();

      const parsed: CCCDAnalysisResult = JSON.parse(cleanJson);
      parsed.rawText = responseText;
      return parsed;
    } catch (error) {
      console.error("❌ [Gemini AI] Lỗi khi phân tích CCCD từ ảnh:", error);
      return null;
    }
  }

  /**
   * Sinh câu trả lời tự động dựa trên câu hỏi người dùng và tri thức RAG từ SQLite Database
   * AI đưa ra quyết định bằng Tool Call (register_candidate, switch_company, reschedule_interview)
   */
  public async generateReply(
    threadId: string,
    senderName: string,
    userText: string,
    options?: GenerateReplyOptions
  ): Promise<string> {
    if (!this.ai) {
      console.warn(
        "⚠️ [Gemini AI] Bot chưa được cấu hình GEMINI_API_KEY trong .env. Dừng phản hồi."
      );
      return "";
    }

    try {
      const isGroup = options?.isGroup ?? false;
      const senderId = options?.senderId || "";
      const quoteContext = options?.quoteContext;
      const imageUrls = options?.imageUrls || [];
      const userContextText = options?.userContextText || "";

      // 1. Lấy toàn bộ kho tri thức RAG từ thư mục data/
      const ragContext = this.ragService.buildPromptContext();

      // 2. Lấy 20 lượt lịch sử hội thoại gần nhất từ SQLite Database của threadId này
      const dbRecords = this.chatHistoryRepo.getRecentHistory(
        threadId,
        this.maxHistoryLength
      );

      const history: ChatContent[] = dbRecords.map((rec) => {
        const timeStr = this.formatTimestamp(rec.timestamp);
        let resolvedName = rec.senderName || "";
        if (rec.role === "user") {
          if (!isGroup) {
            // Trong luồng 1-1: luôn dùng tên người gửi hiện hành mới nhất
            resolvedName = senderName || resolvedName || "Ứng viên";
          } else {
            // Trong nhóm: nếu cùng senderId với tin nhắn hiện tại -> dùng senderName hiện hành
            if (rec.senderId === senderId && senderName) {
              resolvedName = senderName;
            } else if (!resolvedName) {
              resolvedName = `Thành viên ${rec.senderId}`;
            }
          }
        }

        const prefix =
          rec.role === "user"
            ? isGroup
              ? `[${timeStr}] [Thành viên: ${resolvedName}]`
              : `[${timeStr}] [${resolvedName}]`
            : `[${timeStr}] [Bot]`;
        return {
          role: rec.role,
          parts: [{ text: `${prefix}: ${rec.content}` }],
        };
      });

      // 3. Chuẩn bị nội dung câu hỏi thuần túy của người dùng kèm thời gian hiện tại
      const timeContext = this.getCurrentDateTimeContext();
      const currentTimeStr = this.formatTimestamp();
      const senderHeader = isGroup
        ? `[Thành viên Nhóm: ${senderName} (ID: ${senderId})]`
        : `[Người dùng: ${senderName}]`;

      let promptText = `[${currentTimeStr}] ${senderHeader}:\n${userText}`;
      if (quoteContext) {
        promptText = `[Đang trả lời tin nhắn trước: "${quoteContext}"]\n${promptText}`;
      }

      const userParts: ChatMessagePart[] = [{ text: promptText }];

      // Tải bất đồng bộ song song tất cả các hình ảnh gửi đến (nếu có)
      if (imageUrls.length > 0) {
        console.log(`🖼️ [Gemini AI] Đang tải song song ${imageUrls.length} hình ảnh gửi kèm (Timeout 60s)...`);
        const downloadResults = await Promise.all(
          imageUrls.map((url) => this.downloadImageAsBase64(url))
        );

        for (const imgData of downloadResults) {
          if (imgData) {
            userParts.push({
              inlineData: {
                mimeType: imgData.mimeType,
                data: imgData.data,
              },
            });
          }
        }
      }

      const userContent: ChatContent = {
        role: "user",
        parts: userParts,
      };

      // 4. Toàn bộ System Instruction chuẩn: Thời gian thực + Hướng dẫn nhân cách + User Context + Kho tri thức RAG
      let fullSystemInstruction = `[${timeContext}]\n\n${getSystemInstruction()}`;
      if (userContextText) {
        fullSystemInstruction += `\n\n${userContextText}`;
      }
      fullSystemInstruction += `\n\n--- BẮT ĐẦU NGỮ CẢNH (RAG CONTEXT) ---\n${ragContext}\n--- KẾT THÚC NGỮ CẢNH ---`;
      const contents: any[] = [...history, userContent];

      let response = await this.ai.models.generateContent({
        model: config.geminiModel,
        contents,
        config: {
          systemInstruction: fullSystemInstruction,
          tools: [{ functionDeclarations: recruitmentTools }],
        },
      });

      // 5. Vòng lặp xử lý Function Calls khi AI quyết định gọi Tool
      let turns = 0;
      while (response.functionCalls && response.functionCalls.length > 0 && turns < 3) {
        turns++;
        const functionCalls = response.functionCalls;
        console.log(
          `🛠️ [Gemini Tool Call]: AI đưa ra quyết định gọi ${functionCalls.length} tool:`,
          JSON.stringify(functionCalls, null, 2)
        );

        // Lưu lượt model vào contents
        const modelContent = response.candidates?.[0]?.content;
        if (modelContent) {
          contents.push(modelContent);
        }

        const functionResponseParts: any[] = [];
        for (const call of functionCalls) {
          const functionName = call.name || "unknown_tool";
          let toolResult: Record<string, any> = { success: true };
          if (options?.onToolCall) {
            try {
              toolResult = await options.onToolCall(
                functionName,
                (call.args as Record<string, any>) || {}
              );
            } catch (err: any) {
              console.error(`❌ Lỗi thực thi tool [${functionName}]:`, err);
              toolResult = { success: false, error: err.message };
            }
          }

          functionResponseParts.push({
            functionResponse: {
              name: functionName,
              response: toolResult,
            },
          });
        }

        // Gửi kết quả thực thi tool lại cho Gemini để sinh câu trả lời tự nhiên
        contents.push({
          role: "user",
          parts: functionResponseParts,
        });

        response = await this.ai.models.generateContent({
          model: config.geminiModel,
          contents,
          config: {
            systemInstruction: fullSystemInstruction,
            tools: [{ functionDeclarations: recruitmentTools }],
          },
        });
      }

      const replyText = response.text?.trim() || "";

      if (!replyText) {
        console.warn("⚠️ [Gemini AI] Phản hồi từ mô hình AI bị rỗng. Dừng phản hồi.");
        return "";
      }

      // 6. Dọn dẹp tin nhắn quá cũ nếu cần (giữ lại 50 tin gần nhất)
      this.chatHistoryRepo.trimOldMessages(threadId, 50);

      return replyText;
    } catch (error) {
      console.error("❌ [Gemini AI] Gặp lỗi khi tạo câu trả lời:", error);
      throw error;
    }
  }

  /**
   * Xóa lịch sử ngữ cảnh của một luồng chat cụ thể trong SQLite
   */
  public clearHistory(threadId: string): void {
    this.chatHistoryRepo.clearHistory(threadId);
  }

  /**
   * Phân tích batch tin nhắn nhóm bằng Gemini Tool Calling.
   * Nếu AI phát hiện thông tin nghiệp vụ → fire tool call "update_rag" → ragService.executeRagUpdate().
   * Không gửi reply, chỉ cập nhật RAG.
   */
  public async analyzeGroupBatch(
    groupName: string,
    messages: GroupQueuedMessage[],
    ragService: RAGService
  ): Promise<boolean> {
    if (!this.ai) {
      console.warn("⚠️ [Group RAG] Gemini AI chưa được cấu hình, bỏ qua phân tích nhóm.");
      return false;
    }
    if (messages.length === 0) return false;

    // 1. Đọc RAG context hiện tại để AI biết các entry id đã tồn tại
    const ragContext = ragService.buildPromptContext();

    // 2. Build prompt từ danh sách tin nhắn
    const timeFormatter = (ts: number) =>
      new Date(ts).toLocaleTimeString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        hour: "2-digit",
        minute: "2-digit",
      });

    const messagesText = messages
      .map((m) => `[${timeFormatter(m.timestamp)}] ${m.senderName}: ${m.text}`)
      .join("\n");

    const systemInstruction =
      `Bạn là AI chuyên trách tự động phân tích tin nhắn nhóm Zalo nội bộ để cập nhật cơ sở dữ liệu tuyển dụng (RAG) qua tool call 'update_rag'.\n` +
      `\nQUY TẮC CỐT LÕI (BẮT BUỘC PHẢI GỌI TOOL KHI CÓ DỮ LIỆU):\n` +
      `1. TÊN NHÓM CUNG CẤP TÊN CÔNG TY / ĐỐI TƯỢNG: Luôn kết hợp Tên nhóm ("${groupName}") và nội dung tin nhắn để xác định công ty tuyển dụng. Ví dụ: Tên nhóm là "Tuyển dụng ADC" hoặc "ADC", nội dung tin nhắn nói về tuyển dụng/địa chỉ/link map -> Đối tượng là "Công ty ADC".\n` +
      `2. KHI CÔNG TY ĐÃ CÓ TRONG KHO RAG (Xem danh sách RAG bên dưới): Nếu tin nhắn gửi link Google Maps, địa chỉ, bổ sung số lượng tuyển, hoặc lịch hẹn -> BẮT BUỘC dùng action='update_existing', targetFile='job_rag', targetId='id của công ty đó trong RAG' (ví dụ: 'job_13'), và truyền các trường cần cập nhật (map_url, location, vacancies, interview_schedule, raw_content...). TUYỆT ĐỐI KHÔNG TẠO MỚI (create_new) nếu công ty đã có trong danh sách RAG!\n` +
      `3. QUY TẮC QUAN TRỌNG VỀ TRẠNG THÁI TUYỂN DỤNG & CHỈ TIÊU (vacancies):\n` +
      `   - Khi tin nhắn báo "tạm ngưng tuyển", "ngưng tuyển", "đủ người", "hết chỗ", "dừng nhận hồ sơ", "hết chỉ tiêu": BẮT BUỘC phải truyền trường 'vacancies': 0 trong updatedFields để hệ thống nhận biết công ty đã ngưng tuyển!\n` +
      `   - Khi tin nhắn thông báo tuyển lại hoặc có số lượng chỉ tiêu mới: BẮT BUỘC cập nhật 'vacancies' thành số nguyên tương ứng (ví dụ: 20, 50...).\n` +
      `4. KHI CÔNG TY HOÀN TOÀN MỚI CHƯA CÓ TRONG RAG: Dùng action='create_new', targetFile='job_rag', trích xuất đầy đủ: title, location, map_url, vacancies, interview_schedule, job_type, aliases, raw_content.\n` +
      `5. TRÍCH XUẤT ĐẦY ĐỦ TRƯỜNG THÔNG TIN: Hãy đọc kỹ tin nhắn để bóc tách: location (địa chỉ/KCN), map_url (link maps.app.goo.gl nếu có), vacancies (số lượng), interview_schedule (giờ giấc), job_type (loại việc), aliases (tên gọi khác).\n` +
      `6. CHỈ BỎ QUA KHÔNG GỌI TOOL khi tin nhắn hoàn toàn là tán gẫu, chào hỏi xã giao không có số lượng hay thông tin tuyển dụng nào (ví dụ: "Ok", "Chào cả nhà", "Cafe ko").`;

    const userPrompt =
      `[TÊN NHÓM]: "${groupName}"\n` +
      `[DANH SÁCH TIN NHẮN]:\n${messagesText}\n\n` +
      `[KHO DỮ LIỆU RAG HIỆN TẠI (Tra cứu ID để dùng update_existing)]:\n${ragContext}\n\n` +
      `Hãy phân tích ngay và gọi tool 'update_rag' để cập nhật dữ liệu nếu có thông tin tuyển dụng/link map/địa chỉ/chính sách/địa điểm!`;

    const contents: any[] = [{ role: "user", parts: [{ text: userPrompt }] }];

    console.log(`\n🔍 [Group RAG] Phân tích ${messages.length} tin nhắn từ nhóm "${groupName}"...`);

    let updatedCount = 0;

    try {
      let response = await this.ai.models.generateContent({
        model: config.geminiModel,
        contents,
        config: {
          systemInstruction,
          tools: [{ functionDeclarations: groupRagTools }],
        },
      });

      // 3. Vòng lặp xử lý tool calls — giống pattern recruitmentTools
      let turns = 0;
      while (response.functionCalls && response.functionCalls.length > 0 && turns < 5) {
        turns++;
        const functionCalls = response.functionCalls;
        console.log(
          `🛠️ [Group RAG Tool] Gemini gọi ${functionCalls.length} tool(s):`,
          JSON.stringify(functionCalls.map((c) => ({ name: c.name, args: c.args })), null, 2)
        );

        const modelContent = response.candidates?.[0]?.content;
        if (modelContent) {
          contents.push(modelContent);
        }

        const functionResponseParts: any[] = [];
        for (const call of functionCalls) {
          if (call.name !== "update_rag") continue;

          const args = (call.args as unknown) as RagUpdateArgs;
          const result = ragService.executeRagUpdate(args);
          if (result.success) {
            updatedCount++;
          }

          functionResponseParts.push({
            functionResponse: {
              name: "update_rag",
              response: result,
            },
          });
        }

        if (functionResponseParts.length === 0) break;

        contents.push({ role: "user", parts: functionResponseParts });

        response = await this.ai.models.generateContent({
          model: config.geminiModel,
          contents,
          config: {
            systemInstruction,
            tools: [{ functionDeclarations: groupRagTools }],
          },
        });
      }

      if (turns === 0) {
        const textResp = response.text?.trim();
        if (textResp) {
          console.log(`⏭️ [Group RAG] AI không gọi tool mà phản hồi text: "${textResp}"`);
        } else {
          console.log(`⏭️ [Group RAG] Không phát hiện thông tin nghiệp vụ, bỏ qua.`);
        }
      } else {
        console.log(`✅ [Group RAG] Hoàn tất phân tích — đã thực thi thành công ${updatedCount} thao tác cập nhật RAG.`);
      }

      return updatedCount > 0;
    } catch (error) {
      console.error("❌ [Group RAG] Lỗi khi phân tích tin nhắn nhóm:", error);
      return false;
    }
  }

  /**
   * Phân tích văn bản nội dung từ HR, tự động phân loại chính xác (job_rag, policy_rag, location_rag)
   * và gọi tool update_rag để cập nhật kho tri thức RAG.
   */
  public async updateRagFromText(
    rawText: string,
    ragService: RAGService
  ): Promise<RagUpdateReport> {
    if (!this.ai) {
      return {
        success: false,
        message: "Bot chưa được cấu hình GEMINI_API_KEY.",
        updatedCount: 0,
        items: [],
      };
    }

    const ragContext = ragService.buildPromptContext();

    const systemInstruction =
      `Bạn là AI chuyên gia tự động phân loại và cập nhật cơ sở dữ liệu tuyển dụng (RAG) qua tool call 'update_rag'.\n` +
      `\nNHIỆM VỤ CỦA BẠN: Phân tích nội dung văn bản từ HR, tự động phân loại đúng vào 1 trong 3 nhóm file sau:\n` +
      `1. 'job_rag': Khi nội dung là tin tuyển dụng công ty, thông tin vị trí việc làm, mức lương, ca làm việc, tăng ca, quyền lợi, lịch hẹn nhận việc... Phải trích xuất đầy đủ: title (Tên công ty), aliases (mảng tên gọi khác/viết tắt/không dấu), location (Địa chỉ cụ thể/KCN), map_url (Link Google Maps nếu có), vacancies (Chỉ tiêu tuyển, số nguyên), interview_schedule (Giờ giấc/địa điểm hẹn phỏng vấn), job_type (Ngành nghề/loại việc), raw_content (Toàn bộ bài viết gốc đã format rõ ràng).\n` +
      `   - ĐẶC BIỆT LƯU Ý VỀ TRẠNG THÁI TUYỂN DỤNG & CHỈ TIÊU (vacancies):\n` +
      `     + Khi nội dung báo công ty "tạm ngưng tuyển", "ngưng tuyển", "đủ người", "hết chỗ", "dừng nhận hồ sơ", "hết chỉ tiêu": BẮT BUỘC phải truyền trường 'vacancies': 0 trong updatedFields để hệ thống ghi nhận công ty đã ngưng tuyển!\n` +
      `     + Khi nội dung thông báo mở tuyển lại hoặc có số lượng chỉ tiêu mới: BẮT BUỘC cập nhật 'vacancies' thành số nguyên tương ứng (ví dụ: 20, 50...).\n` +
      `2. 'policy_rag': Khi nội dung là quy định chính sách chung, chế độ bảo hiểm, thủ tục hồ sơ, điều kiện độ tuổi, quy chế ứng lương, nội quy chung... Schema: title, details (object chứa các quy định chi tiết).\n` +
      `3. 'location_rag': Khi nội dung là thông tin khu vực địa lý, khu công nghiệp, tuyến đường, khu vực lân cận, gợi ý địa điểm... Schema: title, aliases, nearby_suggestions, district, province, description, raw_content.\n` +
      `\nQUY TẮC BẮT BUỘC:\n` +
      `- Nếu đối tượng ĐÃ CÓ trong danh sách RAG bên dưới -> Dùng action='update_existing', targetId='id của đối tượng trong RAG' (ví dụ: 'job_01', 'policy_01'...), truyền updatedFields chứa các trường cần sửa/bổ sung (bao gồm vacancies: 0 nếu ngưng tuyển).\n` +
      `- Nếu đối tượng HOÀN TOÀN MỚI -> Dùng action='create_new', truyền newEntry chứa đầy đủ các trường theo schema tương ứng.\n` +
      `- BẮT BUỘC PHẢI GỌI TOOL 'update_rag' để thực hiện lưu dữ liệu.`;

    const userPrompt =
      `[NỘI DUNG TUYỂN DỤNG / QUY ĐỊNH / ĐỊA BÀN CẦN CẬP NHẬT RAG TỪ HR]:\n${rawText}\n\n` +
      `[KHO DỮ LIỆU RAG HIỆN TẠI (Để tra cứu ID nếu đã tồn tại)]:\n${ragContext}\n\n` +
      `Hãy phân tích ngay, tự động phân loại chính xác và gọi tool 'update_rag' để cập nhật dữ liệu!`;

    const contents: any[] = [{ role: "user", parts: [{ text: userPrompt }] }];

    console.log(`\n🔍 [HR RAG Update] Đang phân tích và tự động phân loại văn bản RAG từ HR...`);

    const items: Array<{
      targetFile: string;
      action: "create_new" | "update_existing";
      targetId?: string;
      title?: string;
      reason?: string;
      entry?: Record<string, unknown>;
      summary: string;
      success: boolean;
      message?: string;
    }> = [];

    try {
      let response = await this.ai.models.generateContent({
        model: config.geminiModel,
        contents,
        config: {
          systemInstruction,
          tools: [{ functionDeclarations: groupRagTools }],
        },
      });

      let turns = 0;
      while (response.functionCalls && response.functionCalls.length > 0 && turns < 5) {
        turns++;
        const functionCalls = response.functionCalls;
        console.log(
          `🛠️ [HR RAG Tool] Gemini gọi ${functionCalls.length} tool(s):`,
          JSON.stringify(functionCalls.map((c) => ({ name: c.name, args: c.args })), null, 2)
        );

        const modelContent = response.candidates?.[0]?.content;
        if (modelContent) {
          contents.push(modelContent);
        }

        const functionResponseParts: any[] = [];
        for (const call of functionCalls) {
          if (call.name !== "update_rag") continue;

          const args = (call.args as unknown) as RagUpdateArgs;
          const result = ragService.executeRagUpdate(args);
          const currentEntry = result.entry || args.newEntry || args.updatedFields || {};

          const title =
            (currentEntry["title"] as string) ||
            (args.newEntry?.title as string) ||
            (args.updatedFields?.title as string) ||
            args.targetId ||
            "Không rõ";

          const targetId = (currentEntry["id"] as string) || args.targetId;

          let summary = "";
          if (args.action === "create_new" || (result.entry && !args.targetId)) {
            summary = `Tạo mới "${title}" (ID: ${targetId || "Mới"})`;
          } else {
            summary = `Cập nhật "${title}" (ID: ${targetId})`;
          }

          items.push({
            targetFile: `${args.targetFile}.json`,
            action: args.action,
            targetId,
            title,
            reason: args.reason,
            entry: result.entry,
            summary,
            success: result.success,
            message: result.message,
          });

          functionResponseParts.push({
            functionResponse: {
              name: "update_rag",
              response: result,
            },
          });
        }

        if (functionResponseParts.length === 0) break;

        contents.push({ role: "user", parts: functionResponseParts });

        response = await this.ai.models.generateContent({
          model: config.geminiModel,
          contents,
          config: {
            systemInstruction,
            tools: [{ functionDeclarations: groupRagTools }],
          },
        });
      }

      const successfulCount = items.filter((i) => i.success).length;

      return {
        success: successfulCount > 0,
        message:
          successfulCount > 0
            ? `Đã cập nhật thành công ${successfulCount} mục vào cơ sở dữ liệu RAG.`
            : "Không trích xuất hoặc cập nhật được dữ liệu nào.",
        updatedCount: successfulCount,
        items,
      };
    } catch (error: any) {
      console.error("❌ [HR RAG Update] Lỗi khi cập nhật RAG từ HR:", error);
      return {
        success: false,
        message: error?.message || String(error),
        updatedCount: 0,
        items,
      };
    }
  }
}

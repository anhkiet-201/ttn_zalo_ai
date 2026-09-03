import { type FunctionDeclaration, Type } from "@google/genai";

export interface CCCDCardResult {
  fullName?: string;
  idNumber?: string;
  dob?: string;
  gender?: string;
  nationality?: string;
  homeTown?: string;
  residence?: string;
  expiryDate?: string;
  imageUrls: string[];
}

export interface CCCDAnalysisResult {
  isCCCD: boolean;
  cards?: CCCDCardResult[];
  fullName?: string;
  idNumber?: string;
  dob?: string;
  gender?: string;
  nationality?: string;
  homeTown?: string;
  residence?: string;
  expiryDate?: string;
  imageUrls?: string[];
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
  quoteSenderName?: string;
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

export interface TextPart {
  text: string;
}

export interface InlineDataPart {
  inlineData: {
    mimeType: string;
    data: string;
  };
}

export type ChatMessagePart = TextPart | InlineDataPart;

export interface ChatContent {
  role: "user" | "model";
  parts: ChatMessagePart[];
}

/**
 * Danh sách các Tools (Function Declarations) cho AI đưa ra quyết định nghiệp vụ tuyển dụng
 */
export const recruitmentTools: FunctionDeclaration[] = [
  {
    name: "register_candidate",
    description:
      "CRITICAL — TOP PRIORITY MANDATORY RULE (PRE-CONFIRMATION IS STRICTLY REQUIRED BEFORE BOOKING):\n" +
      "1. PREREQUISITE: Candidate MUST have citizen ID card (CCCD/VNeID) in User Context. If User Context indicates 'NO CCCD', calling this tool is STRICTLY FORBIDDEN and setting appointments is prohibited!\n" +
      "2. STRICT PRE-CONFIRMATION: NEVER unilaterally confirm appointments or call this tool when the candidate is only asking questions or testing feasibility (e.g., 'Tôi nay đưocj không?', 'Mai đi làm được ko?', 'Còn nhận không?', 'Có ca đêm không?', messages containing 'được không', 'được ko', 'còn nhận ko', or ending with '?'). You MUST answer their inquiry first and ask: 'Em đăng ký lịch hẹn này cho mình luôn nha anh/chị?'.\n" +
      "3. EXECUTE ONLY UPON EXPLICIT AFFIRMATION: Call this tool ONLY IF you have already asked the confirmation question (Step 1) AND the candidate explicitly responded with a clear affirmative confirmation in Step 2 (e.g., 'Ok em', 'Đúng rồi em', 'Chốt đi', 'Đồng ý', 'Đăng ký giúp anh').",
    parameters: {
      type: Type.OBJECT,
      properties: {
        targetCompany: {
          type: Type.STRING,
          description:
            "Standard name of the company the candidate is registering for (e.g., Sowin Group, Chervon, Kaiser, Supor, Leader, Sanaky, Gỗ Wangshun, Sofa Hằng Phong, Dân Ôn, CMT, Gỗ Minh Huy, New Fortune).",
        },
        phoneNumber: {
          type: Type.STRING,
          description: "Candidate's phone number if provided.",
        },
        interviewDate: {
          type: Type.STRING,
          description:
            "Appointment arrival time/interview date. MUST be converted to a SPECIFIC CALENDAR DATE with exact hour (e.g., '19h20 tối Thứ Năm, ngày 03/09/2026', '7h30 sáng Thứ Sáu, ngày 04/09/2026'). Never use vague relative text.",
        },
        candidateIdNumber: {
          type: Type.STRING,
          description:
            "Candidate's citizen ID number (CCCD) extracted from User Context.",
        },
        candidateFullName: {
          type: Type.STRING,
          description:
            "Full name of the candidate extracted from User Context.",
        },
        notes: {
          type: Type.STRING,
          description: "Additional notes if any.",
        },
      },
      required: ["targetCompany", "interviewDate"],
    },
  },
  {
    name: "switch_company",
    description:
      "CRITICAL — PRE-CONFIRMATION IS REQUIRED BEFORE SWITCHING COMPANIES:\n" +
      "1. Applies only when the candidate ALREADY has a CCCD profile and was previously registered.\n" +
      "2. Step 1: When candidate expresses interest in switching companies, ask for confirmation first (e.g., 'Dạ vậy anh muốn đổi sang làm bên cty Chervon đúng ko ạ?') and DO NOT CALL THIS TOOL YET.\n" +
      "3. Step 2: Call this tool ONLY AND ONLY IF the candidate explicitly confirms (e.g., 'Đúng rồi em', 'Ok em', 'Chốt đổi qua đó nha').\n" +
      "STRICTLY FORBIDDEN to call if no CCCD exists or if the candidate is merely comparing companies.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        newCompany: {
          type: Type.STRING,
          description: "Standard name of the NEW company the candidate explicitly confirmed switching to.",
        },
        oldCompany: {
          type: Type.STRING,
          description: "Name of the previous company the candidate is switching from (if known).",
        },
        reason: {
          type: Type.STRING,
          description: "Reason for switching if mentioned by the candidate.",
        },
      },
      required: ["newCompany"],
    },
  },
  {
    name: "reschedule_interview",
    description:
      "CRITICAL — PRE-CONFIRMATION IS REQUIRED BEFORE RESCHEDULING:\n" +
      "1. Applies only when the candidate ALREADY has a CCCD profile and an existing appointment.\n" +
      "2. Step 1: When candidate asks to reschedule or inquires about another date, clarify and ask for confirmation of the new time (e.g., 'Dạ vậy em dời lịch hẹn cho anh sang 7h30 sáng Thứ Hai ngày 31/08 nha?') and DO NOT CALL THIS TOOL YET.\n" +
      "3. Step 2: Call this tool ONLY AND ONLY IF the candidate gives an explicit affirmative confirmation.\n" +
      "STRICTLY FORBIDDEN to call if the candidate has no appointment or is merely asking about schedules.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        newDate: {
          type: Type.STRING,
          description:
            "New appointment arrival time. MUST be converted to a SPECIFIC CALENDAR DATE with exact hour (e.g., '7h30 sáng Thứ Bảy, ngày 05/09/2026'). Never use vague relative text.",
        },
        targetCompany: {
          type: Type.STRING,
          description: "Company name where the candidate has an appointment.",
        },
        reason: {
          type: Type.STRING,
          description: "Reason for rescheduling if mentioned.",
        },
      },
      required: ["newDate"],
    },
  },
];

/**
 * Tool Declarations cho phân tích tin nhắn nhóm và cập nhật kho RAG.
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
        matchedCompanyName: {
          type: Type.STRING,
          description:
            'Tên công ty hoặc đối tượng xác định được từ Tên Nhóm hoặc Nội dung tin nhắn (vd: "Công ty Leader - Sông Mây", "Công ty Sanaky", "Gỗ Wangshun").',
        },
        targetId: {
          type: Type.STRING,
          description:
            'BẮT BUỘC ĐỐI CHIẾU ID TỪ BẢNG TRA CỨU: ID của entry tương ứng với matchedCompanyName khi action="update_existing" (vd: "job_04" cho Leader, "job_06" cho Sanaky, "job_01" cho Wangshun). Tuyệt đối không chọn bừa job_01!',
        },
        matchingReason: {
          type: Type.STRING,
          description:
            'Giải trình logic vì sao chọn targetId này (vd: "Tên nhóm là CÔNG TY LEADER KCN SÔNG MÂY -> Khớp với Công ty Leader ID job_04").',
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
  {
    name: "delete_rag",
    description:
      "GỌI TOOL NÀY khi người dùng hoặc HR yêu cầu xóa bỏ hoàn toàn một công ty, chính sách, hoặc địa điểm khỏi cơ sở dữ liệu RAG.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        targetFile: {
          type: Type.STRING,
          description:
            'File RAG: "job_rag" (công ty tuyển dụng), "policy_rag" (chính sách), "location_rag" (địa điểm), hoặc "all" để tìm và xóa trong tất cả file.',
        },
        targetId: {
          type: Type.STRING,
          description: "ID của entry cần xóa nếu biết rõ (ví dụ: 'job_05', 'job_13').",
        },
        keyword: {
          type: Type.STRING,
          description: "Tên công ty hoặc từ khóa cần xóa (ví dụ: 'cmt', 'sanaky', 'chervon').",
        },
        reason: {
          type: Type.STRING,
          description: "Lý do xóa bỏ.",
        },
      },
      required: ["reason"],
    },
  },
];

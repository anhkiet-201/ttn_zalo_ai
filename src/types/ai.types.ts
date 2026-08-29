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
      "CỰC KỲ QUAN TRỌNG — ĐIỀU KIỆN TIÊN QUYẾT BẮT BUỘC:\n" +
      "1. BẮT BUỘC ĐÃ CÓ CCCD TRONG USER CONTEXT: Chỉ được kích hoạt quy trình chốt khi User Context đã ghi nhận ứng viên có tài liệu CCCD/VNeID. NẾU USER CONTEXT BÁO 'CHƯA CÓ CCCD', TUYỆT ĐỐI CẤM GỌI TOOL NÀY VÀ TUYỆT ĐỐI CẤM TỰ HẸN LỊCH!\n" +
      "2. QUY TRÌNH XÁC NHẬN 2 BƯỚC: Khi đã có CCCD và công ty, bot phải hỏi xác nhận lại (Bước 1, chưa gọi tool). CHỈ GỌI TOOL NÀY (Bước 2) khi và chỉ khi ứng viên phản hồi ĐỒNG Ý/XÁC NHẬN (VD: 'Ok em', 'Đúng rồi em', 'Chốt đi').\n" +
      "TUYỆT ĐỐI CẤM GỌI khi ứng viên chưa gửi ảnh CCCD/VNeID hoặc chỉ đang hỏi thăm.",
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
      "CỰC KỲ QUAN TRỌNG: Chỉ áp dụng khi ứng viên ĐÃ CÓ HỒ SƠ CCCD và đã được đăng ký trước đó.\n" +
      "Bước 1: Khi ứng viên nói muốn đổi công ty, bot phải hỏi xác nhận lại (VD: 'Dạ vậy anh muốn đổi sang làm bên cty Chervon đúng ko ạ?') và TUYỆT ĐỐI CHƯA GỌI TOOL.\n" +
      "Bước 2: CHỈ GỌI TOOL NÀY KHI VÀ CHỈ KHI ứng viên PHẢN HỒI ĐỒNG Ý / XÁC NHẬN (VD: 'Đúng rồi em', 'Ok em', 'Chốt đổi qua đó nha').\n" +
      "TUYỆT ĐỐI CẤM GỌI khi chưa có CCCD hoặc ứng viên chỉ đang hỏi thăm so sánh các công ty.",
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
      "CỰC KỲ QUAN TRỌNG: Chỉ áp dụng khi ứng viên ĐÃ CÓ HỒ SƠ CCCD và đã có lịch hẹn trước đó.\n" +
      "Bước 1: Khi ứng viên muốn dời lịch, bot hỏi xác nhận mốc thời gian hẹn mới (VD: 'Dạ vậy em dời lịch hẹn cho anh sang 7h30 sáng Thứ Hai ngày 31/08 nha?') và TUYỆT ĐỐI CHƯA GỌI TOOL.\n" +
      "Bước 2: CHỈ GỌI TOOL NÀY KHI VÀ CHỈ KHI ứng viên PHẢN HỒI ĐỒNG Ý / XÁC NHẬN.\n" +
      "TUYỆT ĐỐI CẤM GỌI khi ứng viên chưa có CCCD/chưa đăng ký mà chỉ đang hỏi lịch làm.",
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

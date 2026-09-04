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
  action: "create_new" | "update_existing" | "delete";
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
      "Register an interview/work appointment for a candidate. " +
      "PREREQUISITES: Candidate MUST have citizen ID card (CCCD/VNeID) in User Context. " +
      "MANDATORY PRE-CONFIRMATION: Call ONLY after asking confirmation (Step 1) AND candidate explicitly gave affirmative confirmation in Step 2 (e.g., 'Ok em', 'Đồng ý', 'Chốt đi'). " +
      "STRICTLY FORBIDDEN if candidate only asked questions ('được không?', 'còn nhận ko?') or has NO CCCD.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        targetCompany: {
          type: Type.STRING,
          description:
            "Standard name of the company the candidate is registering for (e.g., Sowin Group, Chervon, Kaiser, Supor, Leader, Sanaky, Dân Ôn, CMT).",
        },
        phoneNumber: {
          type: Type.STRING,
          description: "Candidate's phone number if provided.",
        },
        interviewDate: {
          type: Type.STRING,
          description:
            "Appointment arrival time/interview date converted to a specific calendar date with exact hour (e.g., '19h20 tối Thứ Năm, ngày 03/09/2026', '7h30 sáng Thứ Sáu, ngày 04/09/2026').",
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
      "Switch candidate's registration to a different company. " +
      "PREREQUISITES: Candidate has CCCD profile and was previously registered. " +
      "Call ONLY after candidate explicitly confirms switching (e.g., 'Đúng rồi em', 'Chốt đổi qua đó nha'). " +
      "STRICTLY FORBIDDEN if no CCCD exists or candidate merely compares companies.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        newCompany: {
          type: Type.STRING,
          description: "Standard name of the NEW company the candidate confirmed switching to.",
        },
        oldCompany: {
          type: Type.STRING,
          description: "Name of previous company candidate is switching from (if known).",
        },
        reason: {
          type: Type.STRING,
          description: "Reason for switching if mentioned.",
        },
      },
      required: ["newCompany"],
    },
  },
  {
    name: "reschedule_interview",
    description:
      "Reschedule candidate's interview/arrival date. " +
      "PREREQUISITES: Candidate has CCCD profile and existing appointment. " +
      "Call ONLY after candidate explicitly confirms new appointment time (e.g., 'Ok em', 'Đổi qua ngày đó đi'). " +
      "STRICTLY FORBIDDEN if candidate has no appointment or merely asks about schedules.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        newDate: {
          type: Type.STRING,
          description:
            "New appointment arrival time converted to a specific calendar date with exact hour (e.g., '7h30 sáng Thứ Bảy, ngày 05/09/2026').",
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
      "MANDATORY: Call this tool whenever hiring information, policies, or locations are created, updated, or edited. " +
      "CRITICAL: You MUST call this tool when HR wants to edit, update, replace, or remove/delete specific details, requirements, notes, or wording WITHIN a job post " +
      "(e.g., 'xóa photo trong yêu cầu chervon mỹ phước 4', 'xóa dòng lưu ý trong...', 'chervon mp3 chỉ nhận CCCD gốc', 'bỏ phụ cấp...', 'đổi giờ phỏng vấn'). " +
      "Extract all fields comprehensively: title, location, map_url, vacancies, interview_schedule, job_type, aliases, raw_content.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description:
            '"update_existing": when the company/policy/location ALREADY EXISTS in the current RAG database (or was created previously). ' +
            '"create_new": when the company/policy/location is BRAND NEW and has never existed in the RAG database.',
        },
        targetFile: {
          type: Type.STRING,
          description:
            'Target RAG file: "job_rag" (recruitment, vacancies, map link, address), "policy_rag" (policies, regulations), "location_rag" (locations).',
        },
        matchedCompanyName: {
          type: Type.STRING,
          description:
            'Company name or entity identified from Group Name or message text (e.g., "Công ty Leader - Sông Mây", "Công ty Sanaky", "Gỗ Wangshun").',
        },
        targetId: {
          type: Type.STRING,
          description:
            'MANDATORY BRAND MATCHING: The entry ID corresponding to matchedCompanyName when action="update_existing" (e.g., "job_04" for Leader, "job_06" for Sanaky, "job_01" for Wangshun, "job_21" for Chervon). MUST match by company brand name; STRICTLY FORBIDDEN to match solely based on industrial park / location (e.g., FORBIDDEN to assign company Kahong to Chervon just because both are in VSIP 2A)!',
        },
        matchingReason: {
          type: Type.STRING,
          description:
            'Logical justification explaining why this targetId was chosen (e.g., "Group name is CÔNG TY LEADER -> Matches brand of Company Leader ID job_04").',
        },
        updatedFields: {
          type: Type.OBJECT,
          description:
            'Fields to merge/update when action="update_existing" (e.g., map_url, location, vacancies, interview_schedule, raw_content...).',
          properties: {
            title: { type: Type.STRING, description: "Company name with region/area (e.g., 'Công ty ADC – Đồng An 2')" },
            location: { type: Type.STRING, description: "Specific address or Industrial Park (e.g., 'Opposite KCN Đồng An 2, Bình Dương')" },
            map_url: { type: Type.STRING, description: "Google Maps link (e.g., 'https://maps.app.goo.gl/...')" },
            vacancies: { type: Type.INTEGER, description: "Number of job vacancies needed (integer)" },
            interview_schedule: { type: Type.STRING, description: "Interview / onboarding schedule (e.g., 'Company gate at 7:30 AM')" },
            job_type: { type: Type.STRING, description: "Industry, manufacturing sector, or job type (e.g., 'Manufacturing, seasonal')" },
            aliases: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Abbreviations, aliases, or alternative names (e.g., ['adc', 'công ty adc'])" },
            raw_content: {
              type: Type.STRING,
              description:
                "Latest updated recruitment post content (merged with existing content to form a complete updated post; NEVER use '[Cập nhật]:' prefix, do not repeat outdated text)",
            },
          },
        },
        newEntry: {
          type: Type.OBJECT,
          description:
            'New entry data when action="create_new". Must extract completely: title, location, map_url, vacancies, interview_schedule, job_type, aliases, raw_content.',
          properties: {
            title: { type: Type.STRING, description: "Company name with region/area (e.g., 'Công ty ADC – Đồng An 2')" },
            location: { type: Type.STRING, description: "Specific address or Industrial Park (e.g., 'Opposite KCN Đồng An 2, Bình Dương')" },
            map_url: { type: Type.STRING, description: "Google Maps link (if available)" },
            vacancies: { type: Type.INTEGER, description: "Number of job vacancies needed (integer)" },
            interview_schedule: { type: Type.STRING, description: "Interview / onboarding schedule (e.g., 'Company gate at 7:30 AM')" },
            job_type: { type: Type.STRING, description: "Industry, manufacturing sector, or job type" },
            aliases: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Abbreviations, aliases, or alternative names of the company" },
            raw_content: { type: Type.STRING, description: "Comprehensive recruitment post details (salary, shifts, allowances, requirements)" },
          },
        },
        reason: {
          type: Type.STRING,
          description: "Reason for update (e.g., 'Update document requirements for Chervon' or 'Remove photo requirement from post').",
        },
      },
      required: ["action", "targetFile", "reason"],
    },
  },
  {
    name: "delete_rag",
    description:
      "CALL THIS TOOL ONLY when the user or HR explicitly requests to completely delete/remove an ENTIRE company, policy, or location entity from the RAG database " +
      "(e.g., 'xóa cty sanaky', 'xóa job_05', 'xoa cmt', 'công ty này giải thể hãy xóa khỏi database'). " +
      "STRICTLY FORBIDDEN to call this tool if HR is only asking to edit, remove, or delete specific words, requirements, or sentences WITHIN a job post " +
      "(e.g., 'xóa photo trong yêu cầu chervon', 'xóa dòng lưu ý...'). In those editing cases, you MUST call 'update_rag' instead!",
    parameters: {
      type: Type.OBJECT,
      properties: {
        targetFile: {
          type: Type.STRING,
          description:
            'RAG file: "job_rag" (hiring companies), "policy_rag" (policies), "location_rag" (locations), or "all" to find and delete across all files.',
        },
        targetId: {
          type: Type.STRING,
          description: "Entry ID to delete if specifically known (e.g., 'job_05', 'job_13').",
        },
        keyword: {
          type: Type.STRING,
          description: "Company name or keyword to delete (e.g., 'cmt', 'sanaky', 'chervon').",
        },
        reason: {
          type: Type.STRING,
          description: "Reason for deletion.",
        },
      },
      required: ["reason"],
    },
  },
];

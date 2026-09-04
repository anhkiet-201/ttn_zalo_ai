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
      "MANDATORY: Call this tool whenever hiring information (vacancies, shifts, positions, companies), Google Maps links, addresses, policies, or locations are detected in group chat messages. " +
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
          description: "Reason for update (e.g., 'Update map link for Company ADC' or 'Create new Company ADC hiring 30 workers').",
        },
      },
      required: ["action", "targetFile", "reason"],
    },
  },
  {
    name: "delete_rag",
    description:
      "CALL THIS TOOL when the user or HR explicitly requests to completely remove a company, policy, or location from the RAG database.",
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

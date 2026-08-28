import {
  CandidateRepository,
  type CandidateRecord,
  type UserContextData,
} from "../database/index.js";
import { type HRNotifier } from "./hrNotifier.js";
import { UserContextManager } from "./userContextManager.js";
import { config } from "../config/index.js";

export interface ToolExecutionContext {
  threadId: string;
  senderId: string;
  senderName: string;
  userContext: UserContextData;
  candidateData?: CandidateRecord;
}

export interface ToolExecutionResponse {
  result: Record<string, any>;
  updatedCandidate: CandidateRecord;
}

/**
 * ToolExecutor: Chuyên trách thực thi các nghiệp vụ khi Gemini AI quyết định gọi Tool.
 * Đảm bảo chỉ khi AI quyết định đủ điều kiện qua Tool Call thì mới upsertCandidate vào SQLite DB.
 */
export class ToolExecutor {
  constructor(
    private readonly candidateRepo: CandidateRepository,
    private readonly hrNotifier: HRNotifier,
    private readonly userContextManager?: UserContextManager
  ) {}

  private get contextManager(): UserContextManager {
    return this.userContextManager || UserContextManager.getInstance();
  }

  /**
   * Điều phối thực thi Tool theo tên Tool tương ứng
   */
  public async execute(
    toolName: string,
    args: Record<string, any>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResponse> {
    console.log(`⚡ [Thực thi Tool]: ${toolName} với tham số:`, args);

    switch (toolName) {
      case "register_candidate":
        return this.register_candidate(args, context);
      case "switch_company":
        return this.switch_company(args, context);
      case "reschedule_interview":
        return this.reschedule_interview(args, context);
      default:
        return {
          result: { status: "unknown_tool" },
          updatedCandidate: context.candidateData || {
            threadId: context.threadId,
            senderId: context.senderId,
            senderName: context.senderName,
            imageUrls: [],
            forwardedTo: config.hrRecipientId,
          },
        };
    }
  }

  /**
   * TOOL 1: register_candidate (Đăng ký / Chốt công ty nhận việc)
   * Lấy thông tin ứng viên và ảnh CCCD 2 mặt tương ứng từ User Context để lưu DB và báo HR
   */
  public async register_candidate(
    args: Record<string, any>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResponse> {
    const targetCompany = String(args.targetCompany || "").trim();
    const phoneNumber = args.phoneNumber ? String(args.phoneNumber).trim() : undefined;
    const interviewDate = args.interviewDate
      ? String(args.interviewDate).trim()
      : context.candidateData?.interviewDate || "";
    const candidateIdNumber = args.candidateIdNumber
      ? String(args.candidateIdNumber).trim()
      : undefined;
    const candidateFullName = args.candidateFullName
      ? String(args.candidateFullName).trim()
      : undefined;

    // 1. Tìm tài liệu CCCD tương ứng trong User Context (hỗ trợ trường hợp 1 user gửi nhiều CCCD)
    const docs = context.userContext.documents || [];
    let selectedDoc = docs.find((d) => {
      if (candidateIdNumber && d.idNumber === candidateIdNumber) return true;
      if (
        candidateFullName &&
        d.fullName &&
        d.fullName.trim().toLowerCase() === candidateFullName.toLowerCase()
      )
        return true;
      return false;
    });

    // Nếu không tìm thấy theo id/tên cụ thể, chọn CCCD chưa đăng ký đầu tiên
    if (!selectedDoc) {
      selectedDoc = docs.find((d) => d.status !== "registered") || docs[0];
    }

    const docIndex = selectedDoc ? docs.indexOf(selectedDoc) : 0;
    const finalPhone =
      phoneNumber ||
      (context.userContext.phoneNumbers.length > docIndex
        ? context.userContext.phoneNumbers[docIndex]
        : context.userContext.phoneNumbers[0] || context.candidateData?.phoneNumber);

    // Xác định ID bản ghi cũ (chỉ tái sử dụng nếu đúng cùng số CCCD / họ tên)
    let candidateRecordId: string | undefined = undefined;
    if (selectedDoc?.idNumber) {
      candidateRecordId = this.candidateRepo.findByIdNumber(selectedDoc.idNumber)?.id;
    } else if (candidateIdNumber) {
      candidateRecordId = this.candidateRepo.findByIdNumber(candidateIdNumber)?.id;
    } else if (context.candidateData?.id && !context.candidateData.idNumber) {
      candidateRecordId = context.candidateData.id;
    }

    // 2. Gom toàn bộ thông tin + đúng ảnh CCCD của ứng viên này để thực hiện upsertCandidate vào SQLite
    const candidateImages = selectedDoc?.imageUrls && selectedDoc.imageUrls.length > 0
      ? selectedDoc.imageUrls
      : [];

    const candidateData = this.candidateRepo.upsertCandidate({
      id: candidateRecordId,
      threadId: context.threadId,
      senderId: context.senderId,
      senderName: context.senderName,
      targetCompany,
      interviewDate,
      phoneNumber: finalPhone,
      fullName:
        selectedDoc?.fullName ||
        candidateFullName ||
        context.candidateData?.fullName ||
        context.senderName,
      idNumber:
        selectedDoc?.idNumber ||
        candidateIdNumber ||
        context.candidateData?.idNumber,
      dob: selectedDoc?.dob || context.candidateData?.dob,
      gender: selectedDoc?.gender || context.candidateData?.gender,
      homeTown: selectedDoc?.homeTown || context.candidateData?.homeTown,
      residence: selectedDoc?.residence || context.candidateData?.residence,
      expiryDate: selectedDoc?.expiryDate || context.candidateData?.expiryDate,
      imageUrls: candidateImages,
      forwardedTo: config.hrRecipientId,
    });

    console.log(
      `🚀 [Tool: register_candidate] Chuyển tiếp hồ sơ ứng viên [${
        candidateData.fullName || context.senderName
      }] (CCCD: ${candidateData.idNumber || "Chưa rõ"}, ${
        candidateData.imageUrls.length
      } ảnh) đăng ký công ty [${targetCompany}] sang HR...`
    );

    // 3. Đánh dấu trạng thái đã đăng ký trong User Context và đồng bộ
    if (selectedDoc) {
      this.contextManager.markDocumentRegistered(
        context.threadId,
        context.senderId,
        selectedDoc.idNumber || selectedDoc.fullName || "",
        targetCompany,
        interviewDate
      );
    }
    this.contextManager.updateTargetCompany(
      context.threadId,
      context.senderId,
      context.senderName,
      targetCompany
    );

    // 4. Chuyển tiếp thông tin + toàn bộ ảnh CCCD 2 mặt sang tài khoản HR
    await this.hrNotifier.notifyCandidateRegistration(candidateData);
    this.candidateRepo.markAsForwarded(candidateData.id!);

    return {
      result: {
        status: "success",
        action: "register_candidate",
        candidateName: candidateData.fullName,
        candidateIdNumber: candidateData.idNumber,
        targetCompany,
        interviewDate,
        forwardedToHR: true,
      },
      updatedCandidate: candidateData,
    };
  }

  /**
   * TOOL 2: switch_company (Đổi ý sang công ty khác)
   */
  public async switch_company(
    args: Record<string, any>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResponse> {
    const newCompany = String(args.newCompany || "").trim();
    const oldCompany =
      args.oldCompany ||
      context.candidateData?.targetCompany ||
      context.userContext.targetCompany ||
      "công ty trước";
    const interviewDate =
      context.candidateData?.interviewDate || "Theo lịch hẹn";

    // Tìm tài liệu CCCD từ UserContext để đảm bảo có đầy đủ ảnh và thông tin định danh
    const docs = context.userContext.documents || [];
    const selectedDoc = docs.find((d) => d.status === "registered") || docs[0];
    const docImages = docs.flatMap((d) => d.imageUrls || []).filter(Boolean);
    const existingImages = context.candidateData?.imageUrls || [];
    const finalImages = existingImages.length > 0 ? existingImages : (selectedDoc?.imageUrls || docImages);

    const candidateData = this.candidateRepo.upsertCandidate({
      ...(context.candidateData || {
        threadId: context.threadId,
        senderId: context.senderId,
        senderName: context.senderName,
        imageUrls: [],
        forwardedTo: config.hrRecipientId,
      }),
      targetCompany: newCompany,
      imageUrls: finalImages,
      fullName: context.candidateData?.fullName || selectedDoc?.fullName || context.senderName,
      idNumber: context.candidateData?.idNumber || selectedDoc?.idNumber,
      dob: context.candidateData?.dob || selectedDoc?.dob,
      gender: context.candidateData?.gender || selectedDoc?.gender,
    });

    this.contextManager.updateTargetCompany(
      context.threadId,
      context.senderId,
      context.senderName,
      newCompany
    );

    await this.hrNotifier.notifyCompanyChange({
      candidate: candidateData,
      oldCompany: String(oldCompany),
      newCompany,
      interviewDate,
    });

    return {
      result: {
        status: "success",
        action: "switch_company",
        oldCompany,
        newCompany,
        interviewDate,
        notifiedHR: true,
      },
      updatedCandidate: candidateData,
    };
  }

  /**
   * TOOL 3: reschedule_interview (Dời lịch nhận việc / phỏng vấn)
   */
  public async reschedule_interview(
    args: Record<string, any>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResponse> {
    const newDate = String(args.newDate || "").trim();
    const targetCompany =
      args.targetCompany ||
      context.candidateData?.targetCompany ||
      context.userContext.targetCompany ||
      "công ty đã đăng ký";

    // Tìm tài liệu CCCD từ UserContext để đảm bảo có đầy đủ ảnh và thông tin định danh
    const docs = context.userContext.documents || [];
    const selectedDoc = docs.find((d) => d.status === "registered") || docs[0];
    const docImages = docs.flatMap((d) => d.imageUrls || []).filter(Boolean);
    const existingImages = context.candidateData?.imageUrls || [];
    const finalImages = existingImages.length > 0 ? existingImages : (selectedDoc?.imageUrls || docImages);

    const candidateData = this.candidateRepo.upsertCandidate({
      ...(context.candidateData || {
        threadId: context.threadId,
        senderId: context.senderId,
        senderName: context.senderName,
        imageUrls: [],
        forwardedTo: config.hrRecipientId,
      }),
      interviewDate: newDate,
      imageUrls: finalImages,
      fullName: context.candidateData?.fullName || selectedDoc?.fullName || context.senderName,
      idNumber: context.candidateData?.idNumber || selectedDoc?.idNumber,
      dob: context.candidateData?.dob || selectedDoc?.dob,
      gender: context.candidateData?.gender || selectedDoc?.gender,
    });

    await this.hrNotifier.notifyReschedule({
      candidate: candidateData,
      targetCompany: String(targetCompany),
      newDate,
    });

    return {
      result: {
        status: "success",
        action: "reschedule_interview",
        newDate,
        targetCompany,
        notifiedHR: true,
      },
      updatedCandidate: candidateData,
    };
  }
}

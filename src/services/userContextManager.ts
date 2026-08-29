import {
  UserContextRepository,
  type UserContextData,
  type UserCCCDDocument,
} from "../database/index.js";
import { type CCCDAnalysisResult, type CCCDCardResult } from "./aiService.js";

/**
 * UserContextManager: Quản lý bộ nhớ đệm (RAM Cache) kết hợp lưu trữ bền vững SQLite (Write-Through)
 * Hỗ trợ lưu trữ đa ứng viên (1 người gửi nhiều CCCD 2 mặt) và cung cấp ngữ cảnh đầy đủ cho AI.
 */
export class UserContextManager {
  private static instance: UserContextManager | null = null;
  private readonly cache = new Map<string, UserContextData>();
  private readonly userContextRepo: UserContextRepository;

  constructor(userContextRepo?: UserContextRepository) {
    this.userContextRepo = userContextRepo || new UserContextRepository();
  }

  /**
   * Singleton pattern để chia sẻ cùng một cache RAM trong toàn bộ ứng dụng
   */
  public static getInstance(repo?: UserContextRepository): UserContextManager {
    if (!UserContextManager.instance) {
      UserContextManager.instance = new UserContextManager(repo);
      // Chỉ đăng ký shutdown hook một lần duy nhất khi Singleton được khởi tạo lần đầu
      UserContextManager.instance.setupGracefulShutdown();
    }
    return UserContextManager.instance;
  }

  /**
   * Đăng ký hook tự động lưu toàn bộ cache RAM xuống SQLite khi tiến trình dừng.
   * Chỉ được gọi đúng 1 lần từ getInstance() để tránh duplicate listeners.
   */
  private setupGracefulShutdown(): void {
    const handleExit = () => {
      this.flushAll();
    };
    process.once("SIGINT", handleExit);
    process.once("SIGTERM", handleExit);
    process.once("beforeExit", handleExit);
  }

  /**
   * Lấy UserContext từ RAM Cache (Read-through từ SQLite nếu cache miss)
   */
  public getContext(
    threadId: string,
    senderId: string,
    senderName?: string
  ): UserContextData {
    const key = `${threadId}:${senderId}`;

    // 1. Kiểm tra RAM cache trước
    let context = this.cache.get(key);
    if (context) {
      if (senderName && senderName !== context.senderName) {
        context.senderName = senderName;
        this.saveAndSync(context);
      }
      return context;
    }

    // 2. Nếu miss cache, nạp từ SQLite Database
    const dbContext = this.userContextRepo.get(threadId, senderId);
    if (dbContext) {
      if (senderName && senderName !== dbContext.senderName) {
        dbContext.senderName = senderName;
        this.userContextRepo.save(dbContext);
      }
      this.cache.set(key, dbContext);
      return dbContext;
    }

    // 3. Nếu chưa có trong DB, khởi tạo mới và lưu Write-Through
    const newContext: UserContextData = {
      id: key,
      threadId,
      senderId,
      senderName: senderName || "Ứng viên",
      phoneNumbers: [],
      documents: [],
      updatedAt: Date.now(),
    };

    this.cache.set(key, newContext);
    this.userContextRepo.save(newContext);
    return newContext;
  }

  /**
   * Lưu context vào RAM Cache và Write-Through ngay lập tức xuống SQLite DB
   */
  public saveAndSync(context: UserContextData): void {
    context.updatedAt = Date.now();
    const key = context.id || `${context.threadId}:${context.senderId}`;
    this.cache.set(key, context);
    this.userContextRepo.save(context);
  }

  /**
   * Thêm hoặc cập nhật hình ảnh và thông tin CCCD (mặt trước / mặt sau / nhiều CCCD)
   */
  public addOrUpdateCCCD(
    threadId: string,
    senderId: string,
    senderName: string,
    cccdResult: CCCDAnalysisResult | CCCDCardResult,
    imageUrls: string[]
  ): UserCCCDDocument {
    const context = this.getContext(threadId, senderId, senderName);

    // 1. Tìm CCCD đã tồn tại trong danh sách documents
    let targetDoc: UserCCCDDocument | undefined = undefined;

    if (cccdResult.idNumber) {
      targetDoc = context.documents.find(
        (doc) => doc.idNumber && doc.idNumber === cccdResult.idNumber
      );
    }

    if (!targetDoc && cccdResult.fullName) {
      targetDoc = context.documents.find(
        (doc) =>
          doc.fullName &&
          doc.fullName.trim().toLowerCase() ===
            cccdResult.fullName!.trim().toLowerCase()
      );
    }

    // Nếu chỉ có 1 tài liệu pending và ảnh gửi tới không có số CCCD rõ ràng (ví dụ ảnh mặt sau),
    // gộp vào tài liệu pending gần nhất
    if (!targetDoc && context.documents.length === 1 && !cccdResult.idNumber) {
      targetDoc = context.documents[0];
    }

    if (targetDoc) {
      // Cập nhật tài liệu CCCD đã có (gộp ảnh mặt trước + mặt sau, giữ tối đa 2 ảnh gần nhất)
      const mergedUrls = Array.from(
        new Set([...targetDoc.imageUrls, ...imageUrls])
      );
      targetDoc.imageUrls = mergedUrls.slice(-2);
      if (cccdResult.fullName) targetDoc.fullName = cccdResult.fullName;
      if (cccdResult.idNumber) targetDoc.idNumber = cccdResult.idNumber;
      if (cccdResult.dob) targetDoc.dob = cccdResult.dob;
      if (cccdResult.gender) targetDoc.gender = cccdResult.gender;
      if (cccdResult.nationality) targetDoc.nationality = cccdResult.nationality;
      if (cccdResult.homeTown) targetDoc.homeTown = cccdResult.homeTown;
      if (cccdResult.residence) targetDoc.residence = cccdResult.residence;
      if (cccdResult.expiryDate) targetDoc.expiryDate = cccdResult.expiryDate;
      targetDoc.extractedAt = Date.now();

      console.log(
        `🔄 [UserContext] Đã cập nhật ảnh CCCD (${targetDoc.imageUrls.length} ảnh) cho [${
          targetDoc.fullName || targetDoc.idNumber || "Ứng viên"
        }] của user [${senderName}]`
      );
    } else {
      // Thêm mới tài liệu CCCD của ứng viên (tối đa 2 ảnh)
      targetDoc = {
        fullName: cccdResult.fullName,
        idNumber: cccdResult.idNumber,
        dob: cccdResult.dob,
        gender: cccdResult.gender,
        nationality: cccdResult.nationality,
        homeTown: cccdResult.homeTown,
        residence: cccdResult.residence,
        expiryDate: cccdResult.expiryDate,
        imageUrls: Array.from(new Set(imageUrls)).slice(-2),
        extractedAt: Date.now(),
        status: "pending",
      };
      context.documents.push(targetDoc);

      console.log(
        `➕ [UserContext] Đã thêm CCCD mới thứ ${context.documents.length} cho [${
          targetDoc.fullName || targetDoc.idNumber || "Ứng viên"
        }] trong hồ sơ user [${senderName}]`
      );
    }

    this.saveAndSync(context);
    return targetDoc;
  }

  /**
   * Tự động quét và lưu số điện thoại người dùng cung cấp trong nội dung chat
   */
  public extractAndAddPhoneNumbers(
    threadId: string,
    senderId: string,
    senderName: string,
    text: string
  ): void {
    if (!text) return;

    // Biểu thức chính quy tìm số điện thoại Việt Nam (10 số, đầu 03, 05, 07, 08, 09 hoặc +84)
    // Lưu ý: dùng [689] thay vì [6|8|9] vì | trong character class là ký tự literal, không phải alternation
    const phoneRegex = /(?:\+84|0)(?:3[2-9]|5[689]|7[06-9]|8[1-9]|9[0-9])[0-9]{7}\b/g;
    const matches = text.match(phoneRegex);

    if (matches && matches.length > 0) {
      const context = this.getContext(threadId, senderId, senderName);
      let changed = false;

      for (const phone of matches) {
        const cleanPhone = phone.startsWith("+84") ? "0" + phone.slice(3) : phone;
        if (!context.phoneNumbers.includes(cleanPhone)) {
          context.phoneNumbers.push(cleanPhone);
          changed = true;
          console.log(
            `📞 [UserContext] Đã ghi nhận SĐT mới [${cleanPhone}] từ user [${senderName}]`
          );
        }
      }

      if (changed) {
        this.saveAndSync(context);
      }
    }
  }

  /**
   * Cập nhật công ty người dùng đang quan tâm hoặc chốt
   */
  public updateTargetCompany(
    threadId: string,
    senderId: string,
    senderName: string,
    company: string
  ): void {
    const context = this.getContext(threadId, senderId, senderName);
    context.targetCompany = company.trim();
    this.saveAndSync(context);
  }

  /**
   * Đánh dấu hồ sơ CCCD đã được đăng ký thành công qua Tool
   */
  public markDocumentRegistered(
    threadId: string,
    senderId: string,
    idNumberOrName: string,
    company: string,
    interviewDate: string
  ): void {
    const context = this.getContext(threadId, senderId);
    const doc = context.documents.find(
      (d) =>
        (d.idNumber && d.idNumber === idNumberOrName) ||
        (d.fullName &&
          d.fullName.trim().toLowerCase() === idNumberOrName.trim().toLowerCase())
    );

    if (doc) {
      doc.status = "registered";
      doc.registeredCompany = company;
      doc.interviewDate = interviewDate;
      this.saveAndSync(context);
    }
  }

  /**
   * Định dạng toàn bộ User Context thành chuỗi văn bản trực quan nạp vào AI Prompt
   */
  public formatForPrompt(context: UserContextData): string {
    const lines: string[] = [
      `--- THÔNG TIN USER CONTEXT (HỒ SƠ ĐÃ GHI NHẬN TỪ NGƯỜI DÙNG) ---`,
      `• Người gửi: ${context.senderName} (ID: ${context.senderId})`,
      `• SĐT đã cung cấp: ${
        context.phoneNumbers.length > 0
          ? context.phoneNumbers.join(", ")
          : "Chưa cung cấp"
      }`,
      `• Công ty đang trao đổi / quan tâm: ${
        context.targetCompany || "Chưa chọn công ty"
      }`,
    ];

    if (context.documents.length === 0) {
      lines.push(
        `• Giấy tờ định danh / CCCD: [CHƯA CÓ CCCD - CẤM TỰ HẸN GIỜ, CẤM GỬI LINK MAP, CẤM GỌI TOOL register_candidate. BẮT BUỘC YÊU CẦU ỨNG VIÊN GỬI ẢNH CCCD + SĐT ĐỂ ĐĂNG KÝ PV].`
      );
    } else {
      lines.push(
        `• Danh sách CCCD đã gửi (${context.documents.length} ứng viên):`
      );
      context.documents.forEach((doc, idx) => {
        const regStatus =
          doc.status === "registered"
            ? `[ĐÃ ĐĂNG KÝ CTY: ${doc.registeredCompany} - LỊCH HẸN: ${doc.interviewDate}]`
            : `[CHƯA ĐĂNG KÝ]`;
        const imagesDesc =
          doc.imageUrls.length > 1
            ? `${doc.imageUrls.length} ảnh (đầy đủ mặt trước & mặt sau)`
            : `${doc.imageUrls.length} ảnh`;

        lines.push(
          `  [${idx + 1}] Họ tên: ${doc.fullName || "Chưa rõ"} | Số CCCD: ${
            doc.idNumber || "Chưa rõ"
          } | Ngày sinh: ${doc.dob || "Chưa rõ"} | Giới tính: ${
            doc.gender || "Chưa rõ"
          } | Quê quán: ${doc.homeTown || "Chưa rõ"} | Ảnh CCCD: ${imagesDesc} | Trạng thái: ${regStatus}`
        );
      });
    }

    lines.push(`-----------------------------------------------------------------`);
    return lines.join("\n");
  }

  /**
   * Flush toàn bộ dữ liệu từ RAM Cache xuống SQLite DB
   */
  public flushAll(): void {
    console.log(`💾 [UserContext] Đang đồng bộ toàn bộ RAM Cache xuống SQLite DB...`);
    for (const context of this.cache.values()) {
      try {
        this.userContextRepo.save(context);
      } catch (err) {
        console.error(`❌ Lỗi đồng bộ user context [${context.id}]:`, err);
      }
    }
    console.log(`✅ [UserContext] Đồng bộ hoàn tất.`);
  }
}

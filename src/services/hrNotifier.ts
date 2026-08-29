import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ThreadType } from "../types/zalo.types.js";
import { type ZaloService } from "./zaloService.js";
import { type CandidateRecord } from "../database/index.js";
import { config } from "../config/index.js";

export interface HrNotificationResult {
  success: boolean;
  requireFreshPhoto: boolean;
  message?: string;
}

/**
 * HRNotifier: Quản lý việc đóng gói và chuyển tiếp thông tin ứng viên, đổi công ty, dời lịch sang tài khoản Zalo HR
 */
export class HRNotifier {
  private readonly hrRecipientId: string;

  constructor(
    private readonly zaloService: ZaloService,
    hrRecipientId?: string
  ) {
    this.hrRecipientId = hrRecipientId || config.hrRecipientId;
  }

  /**
   * Tải ảnh từ URL về file tạm trên ổ cứng để gửi đính kèm qua Zalo (Timeout 60s)
   */
  private async downloadImageToTempFile(url: string): Promise<string | null> {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
          Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) return null;

      const arrayBuffer = await response.arrayBuffer();
      const tempFilePath = path.join(
        os.tmpdir(),
        `cccd_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`
      );
      fs.writeFileSync(tempFilePath, Buffer.from(arrayBuffer));
      return tempFilePath;
    } catch (error) {
      console.error("❌ Lỗi tải ảnh về file tạm (Timeout 60s):", error);
      return null;
    }
  }

  /**
   * Helper gửi tin nhắn kèm ảnh CCCD đính kèm (nếu có) tới HR.
   * BẮT BUỘC: Nếu link ảnh hết hạn hoặc không tải được ảnh thực tế nào -> Từ chối gửi và báo lỗi requireFreshPhoto.
   */
  private async sendMessageWithAttachments(
    msg: string,
    imageUrls?: string[]
  ): Promise<HrNotificationResult> {
    if (!imageUrls || imageUrls.length === 0) {
      console.warn("⚠️ [HRNotifier] Không có link ảnh CCCD nào để gửi cho HR.");
      return {
        success: false,
        requireFreshPhoto: true,
        message: "Chưa có ảnh CCCD hợp lệ.",
      };
    }

    const results = await Promise.all(
      imageUrls.map((imgUrl) => this.downloadImageToTempFile(imgUrl))
    );
    const tempFiles = results.filter((t): t is string => Boolean(t));

    // BẮT BUỘC: Nếu toàn bộ link ảnh đều hết hạn (Zalo CDN 403) hoặc không tải được ảnh nào -> CHẶN gửi tin nhắn thiếu ảnh
    if (tempFiles.length === 0) {
      console.warn(
        "⚠️ [HRNotifier] Toàn bộ link ảnh CCCD đã hết hạn hoặc không tải được. Từ chối gửi tin nhắn thiếu ảnh sang HR."
      );
      return {
        success: false,
        requireFreshPhoto: true,
        message: "Ảnh CCCD cũ đã hết hạn hoặc không khả dụng trên Zalo CDN.",
      };
    }

    try {
      await this.zaloService.sendMessage(
        this.hrRecipientId,
        {
          msg,
          attachments: tempFiles,
        },
        config.hrThreadType
      );
      return { success: true, requireFreshPhoto: false };
    } catch (err: any) {
      console.error(`❌ [HRNotifier] Lỗi gửi tin nhắn sang HR:`, err);
      return {
        success: false,
        requireFreshPhoto: false,
        message: err.message || "Lỗi gửi tin nhắn sang HR",
      };
    } finally {
      for (const tmp of tempFiles) {
        try {
          fs.unlinkSync(tmp);
        } catch {}
      }
    }
  }

  /**
   * Chuyển tiếp toàn bộ hồ sơ ứng viên (kèm ảnh CCCD thực tế nếu có) sang tài khoản HR
   */
  public async notifyCandidateRegistration(
    candidate: CandidateRecord,
    notes?: string
  ): Promise<HrNotificationResult> {
    const interviewTime = candidate.interviewDate || "Sáng mai lúc 7h30 tại cổng công ty";
    const company = candidate.targetCompany?.toUpperCase() || "CHƯA RÕ";
    const fullName = candidate.fullName || candidate.senderName || "Chưa rõ";
    const phone = candidate.phoneNumber || "Chưa cung cấp";
    const timeNow = new Date().toLocaleString("vi-VN");

    const cccdLines: string[] = [
      `• Họ và tên: ${fullName.toUpperCase()}`,
      `• Số CCCD: ${candidate.idNumber || "Chưa rõ"}`,
      `• Ngày sinh: ${candidate.dob || "Chưa rõ"}${candidate.gender ? ` (${candidate.gender})` : ""}`,
    ];

    if (candidate.homeTown) {
      cccdLines.push(`• Quê quán: ${candidate.homeTown}`);
    }
    if (candidate.residence) {
      cccdLines.push(`• Thường trú: ${candidate.residence}`);
    }
    if (candidate.expiryDate) {
      cccdLines.push(`• Hạn CCCD: ${candidate.expiryDate}`);
    }

    const cccdReport = `🟢 [HỒ SƠ ỨNG VIÊN ĐĂNG KÝ NHẬN VIỆC]
━━━━━━━━━━━━━━━━━━━━
🏭 CÔNG TY: ${company}
⏰ LỊCH HẸN: ${interviewTime.toUpperCase()}
📞 SỐ ĐIỆN THOẠI: ${phone}
👤 Zalo gửi: ${candidate.senderName} (ID: ${candidate.senderId})

📋 THÔNG TIN TRÍCH XUẤT TỪ CCCD:
${cccdLines.join("\n")}
${notes ? `\n📝 Ghi chú: ${notes}` : ""}
⏱️ Thời gian gửi: ${timeNow}`;

    try {
      const res = await this.sendMessageWithAttachments(cccdReport, candidate.imageUrls);
      if (res.success) {
        console.log(
          `📤 [Chuyển tiếp CCCD] Đã gửi ${candidate.imageUrls?.length || 0} ảnh CCCD đính kèm + thông tin công ty [${company}] của [${fullName}] tới HR (${this.hrRecipientId}) thành công!`
        );
        // Nghỉ 500ms để đảm bảo các tin nhắn chuyển tiếp đa ứng viên được gửi tuần tự
        await new Promise((r) => setTimeout(r, 500));
      }
      return res;
    } catch (forwardErr: any) {
      console.error(
        `❌ Lỗi khi gửi thông tin hồ sơ CCCD tới HR (${this.hrRecipientId}):`,
        forwardErr
      );
      return {
        success: false,
        requireFreshPhoto: false,
        message: forwardErr.message || "Lỗi gửi thông tin tới HR",
      };
    }
  }

  /**
   * Gửi thông báo khi ứng viên đổi công ty sang HR (kèm ảnh CCCD)
   */
  public async notifyCompanyChange(params: {
    candidate: CandidateRecord;
    oldCompany: string;
    newCompany: string;
    interviewDate: string;
    reason?: string;
  }): Promise<HrNotificationResult> {
    const { candidate, oldCompany, newCompany, interviewDate, reason } = params;
    const fullName = (candidate.fullName || candidate.senderName || "Chưa rõ").toUpperCase();
    const phone = candidate.phoneNumber || "Chưa cung cấp";
    const idNumber = candidate.idNumber || "Đã lưu trong hệ thống";
    const timeNow = new Date().toLocaleString("vi-VN");

    const changeReport = `🟡 [CẬP NHẬT: ỨNG VIÊN ĐỔI CÔNG TY]
━━━━━━━━━━━━━━━━━━━━
👤 Ứng viên: ${fullName} (ID: ${candidate.senderId})
📞 Điện thoại: ${phone} | CCCD: ${idNumber}

🔄 THAY ĐỔI CÔNG TY:
   [CŨ]: ${String(oldCompany).toUpperCase()}
   ➔ [MỚI]: ${newCompany.toUpperCase()}
⏰ LỊCH HẸN MỚI: ${interviewDate.toUpperCase()}
${reason ? `📝 Lý do đổi: ${reason}\n` : ""}
⏱️ Thời gian đổi: ${timeNow}`;

    try {
      const res = await this.sendMessageWithAttachments(changeReport, candidate.imageUrls);
      if (res.success) {
        console.log(
          `📤 [Tool: switch_company] Đã báo HR đổi sang [${newCompany}] kèm ${candidate.imageUrls?.length || 0} ảnh CCCD thành công!`
        );
      }
      return res;
    } catch (err: any) {
      console.error("❌ Lỗi gửi thông báo đổi công ty tới HR:", err);
      return {
        success: false,
        requireFreshPhoto: false,
        message: err.message || "Lỗi gửi thông báo đổi công ty tới HR",
      };
    }
  }

  /**
   * Gửi thông báo khi ứng viên dời lịch hẹn sang HR (kèm ảnh CCCD)
   */
  public async notifyReschedule(params: {
    candidate: CandidateRecord;
    targetCompany: string;
    newDate: string;
    reason?: string;
  }): Promise<HrNotificationResult> {
    const { candidate, targetCompany, newDate, reason } = params;
    const fullName = (candidate.fullName || candidate.senderName || "Chưa rõ").toUpperCase();
    const phone = candidate.phoneNumber || "Chưa cung cấp";
    const idNumber = candidate.idNumber || "Đã lưu trong hệ thống";
    const timeNow = new Date().toLocaleString("vi-VN");

    const rescheduleReport = `🟠 [CẬP NHẬT: ỨNG VIÊN DỜI LỊCH HẸN]
━━━━━━━━━━━━━━━━━━━━
👤 Ứng viên: ${fullName} (ID: ${candidate.senderId})
🏢 Công ty: ${String(targetCompany).toUpperCase()}
📞 Điện thoại: ${phone} | CCCD: ${idNumber}

⏰ THỜI GIAN HẸN MỚI: ${newDate.toUpperCase()}
${reason ? `📝 Lý do dời lịch: ${reason}\n` : ""}
⏱️ Thời gian báo: ${timeNow}`;

    try {
      const res = await this.sendMessageWithAttachments(rescheduleReport, candidate.imageUrls);
      if (res.success) {
        console.log(
          `📤 [Tool: reschedule_interview] Đã báo HR dời lịch sang [${newDate}] kèm ${candidate.imageUrls?.length || 0} ảnh CCCD thành công!`
        );
      }
      return res;
    } catch (err: any) {
      console.error("❌ Lỗi gửi thông báo dời lịch tới HR:", err);
      return {
        success: false,
        requireFreshPhoto: false,
        message: err.message || "Lỗi gửi thông báo dời lịch tới HR",
      };
    }
  }

  /**
   * Gửi thông báo cảnh báo sự cố kỹ thuật / lỗi API AI sang tài khoản HR
   */
  public async notifySystemError(params: {
    threadId: string;
    senderName: string;
    error: string;
  }): Promise<void> {
    const timeNow = new Date().toLocaleString("vi-VN");
    const errorReport = `🚨 [CẢNH BÁO: SỰ CỐ KẾT NỐI GEMINI AI]
━━━━━━━━━━━━━━━━━━━━
👤 Luồng chat: ${params.senderName} (Thread ID: ${params.threadId})
⏱️ Thời gian: ${timeNow}
❌ Chi tiết lỗi: ${params.error}

👉 TRẠNG THÁI: Bot đã TỰ ĐỘNG DỪNG và KHÔNG gửi phản hồi sai lệch tới ứng viên.
🛠️ HÀNH ĐỘNG: Vui lòng kiểm tra API Key hoặc vào Web Chat để nhắn tin hỗ trợ thủ công!`;

    try {
      await this.zaloService.sendMessage(
        this.hrRecipientId,
        errorReport,
        config.hrThreadType
      );
      console.log(
        `🚨 [HR Notifier] Đã gửi cảnh báo lỗi hệ thống AI tới HR (${this.hrRecipientId}) thành công!`
      );
    } catch (err) {
      console.error("❌ Lỗi khi gửi cảnh báo lỗi AI tới HR:", err);
    }
  }

  /**
   * Gửi thông báo khi cơ sở dữ liệu RAG được tự động cập nhật từ phân tích tin nhắn nhóm
   */
  public async notifyRagUpdate(params: {
    groupName: string;
    action: string;
    targetFile: string;
    targetId?: string;
    title?: string;
    reason?: string;
    message?: string;
    updatedFields?: Record<string, any>;
    newEntry?: Record<string, any>;
  }): Promise<void> {
    const { groupName, action, targetFile, targetId, title, reason, message, updatedFields, newEntry } = params;
    const actionText = action === "create_new" ? "TẠO MỚI ENTRY" : "CẬP NHẬT ENTRY";
    const dataObj = updatedFields || newEntry || {};
    const timeNow = new Date().toLocaleString("vi-VN");

    const detailLines: string[] = [];

    // 1. Trạng thái / Chỉ tiêu
    if (dataObj.vacancies !== undefined) {
      if (dataObj.vacancies === 0) {
        detailLines.push(`• Trạng thái / Chỉ tiêu: 🔴 TẠM NGƯNG TUYỂN`);
      } else {
        detailLines.push(`• Trạng thái / Chỉ tiêu: 🟢 Đang tuyển ${dataObj.vacancies} người`);
      }
    }

    // 2. Lịch hẹn
    if (dataObj.interview_schedule) {
      detailLines.push(`• Lịch hẹn nhận việc: ${dataObj.interview_schedule}`);
    }

    // 3. Vị trí / Ngành nghề
    if (dataObj.job_type) {
      detailLines.push(`• Vị trí / Ngành nghề: ${dataObj.job_type}`);
    }

    // 4. Địa chỉ
    if (dataObj.location) {
      detailLines.push(`• Địa điểm: ${dataObj.location}`);
    }

    // 5. Link Google Maps
    if (dataObj.map_url) {
      detailLines.push(`• Link Google Maps: ${dataObj.map_url}`);
    }

    // 6. Tên gọi khác
    if (Array.isArray(dataObj.aliases) && dataObj.aliases.length > 0) {
      detailLines.push(`• Tên gọi khác: ${dataObj.aliases.join(", ")}`);
    }

    const report = `📢 [TỰ ĐỘNG CẬP NHẬT DỮ LIỆU TỪ NHÓM]
━━━━━━━━━━━━━━━━━━━━
👥 Nhóm nguồn: ${groupName}
🔄 Thao tác: ${actionText} (${targetFile} · ${targetId ? `ID: ${targetId}` : "Mới"})
🏷️ Đối tượng: ${(title || "Chưa rõ").toUpperCase()}
${detailLines.length > 0 ? `\n📊 CHI TIẾT CẬP NHẬT:\n${detailLines.join("\n")}\n` : ""}
📝 Ghi chú/Lý do: ${reason || message || "Phân tích tự động từ tin nhắn nhóm"}
⏱️ Thời gian: ${timeNow}`;

    try {
      await this.zaloService.sendMessage(
        this.hrRecipientId,
        report,
        config.hrThreadType
      );
      console.log(
        `📤 [HR Notifier] Đã gửi thông báo cập nhật RAG từ nhóm [${groupName}] tới HR (${this.hrRecipientId}) thành công!`
      );
    } catch (err) {
      console.error(
        `❌ Lỗi gửi thông báo cập nhật RAG tới HR (${this.hrRecipientId}):`,
        err
      );
    }
  }
}

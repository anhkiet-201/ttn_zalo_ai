import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ThreadType } from "../types/zalo.types.js";
import { type ZaloService } from "./zaloService.js";
import { type CandidateRecord } from "../database/index.js";
import { config } from "../config/index.js";

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
   * Chuyển tiếp toàn bộ hồ sơ ứng viên (kèm ảnh CCCD thực tế nếu có) sang tài khoản HR
   */
  public async notifyCandidateRegistration(candidate: CandidateRecord): Promise<void> {
    const interviewTime = candidate.interviewDate || "Sáng mai lúc 7h30 tại cổng công ty";
    const cccdReport = `🔔 [HỒ SƠ ỨNG VIÊN ĐĂNG KÝ NHẬN VIỆC]
🏭 Công ty ứng tuyển: ${candidate.targetCompany?.toUpperCase() || "CHƯA RÕ"}
⏰ THỜI GIAN HẸN: ${interviewTime.toUpperCase()}
👤 Người gửi: ${candidate.senderName} (ID: ${candidate.senderId})
📞 Số điện thoại: ${candidate.phoneNumber || "Chưa cung cấp"}
📅 Thời gian gửi hồ sơ: ${new Date().toLocaleString("vi-VN")}

📋 THÔNG TIN TRÍCH XUẤT CCCD:
• Họ và tên: ${candidate.fullName || "Chưa rõ"}
• Số CCCD: ${candidate.idNumber || "Chưa rõ"}
• Ngày sinh: ${candidate.dob || "Chưa rõ"}
• Giới tính: ${candidate.gender || "Chưa rõ"}`;

    // Tải bất đồng bộ song song tất cả các file ảnh CCCD thực tế về máy để chuyển tiếp đính kèm
    let tempFiles: string[] = [];
    if (candidate.imageUrls && candidate.imageUrls.length > 0) {
      const results = await Promise.all(
        candidate.imageUrls.map((imgUrl) => this.downloadImageToTempFile(imgUrl))
      );
      tempFiles = results.filter((t): t is string => Boolean(t));
    }

    try {
      if (tempFiles.length > 0) {
        // Gửi cả ảnh CCCD đính kèm thực tế + nội dung trích xuất sang HR
        await this.zaloService.sendMessage(
          this.hrRecipientId,
          {
            msg: cccdReport,
            attachments: tempFiles,
          },
          ThreadType.User
        );
        console.log(
          `📤 [Chuyển tiếp CCCD] Đã gửi ${tempFiles.length} ảnh CCCD đính kèm + thông tin công ty [${candidate.targetCompany}] của [${candidate.senderName}] tới HR (${this.hrRecipientId}) thành công!`
        );
      } else {
        await this.zaloService.sendMessage(
          this.hrRecipientId,
          cccdReport,
          ThreadType.User
        );
        console.log(
          `📤 [Chuyển tiếp Đăng ký] Đã gửi thông tin công ty [${candidate.targetCompany}] của [${candidate.senderName}] tới HR (${this.hrRecipientId}) thành công!`
        );
      }
    } catch (forwardErr) {
      console.error(
        `❌ Lỗi khi gửi thông tin hồ sơ CCCD tới HR (${this.hrRecipientId}):`,
        forwardErr
      );
    } finally {
      // Dọn dẹp file tạm sau khi gửi
      for (const tmp of tempFiles) {
        try {
          fs.unlinkSync(tmp);
        } catch {}
      }
    }
  }

  /**
   * Gửi thông báo khi ứng viên đổi công ty sang HR
   */
  public async notifyCompanyChange(params: {
    candidate: CandidateRecord;
    oldCompany: string;
    newCompany: string;
    interviewDate: string;
  }): Promise<void> {
    const { candidate, oldCompany, newCompany, interviewDate } = params;
    const changeReport = `🔔 [CẬP NHẬT: ỨNG VIÊN ĐỔI CÔNG TY ỨNG TUYỂN]
👤 Ứng viên: ${candidate.fullName || candidate.senderName} (ID: ${candidate.senderId})
🔄 ĐỔI CÔNG TY: ${String(oldCompany).toUpperCase()} ➔ ${newCompany.toUpperCase()}
⏰ THỜI GIAN HẸN: ${interviewDate.toUpperCase()}
📞 Số điện thoại: ${candidate.phoneNumber || "Chưa cung cấp"}
📋 Số CCCD: ${candidate.idNumber || "Đã lưu trong hệ thống"}
📅 Thời gian đổi: ${new Date().toLocaleString("vi-VN")}`;

    try {
      await this.zaloService.sendMessage(this.hrRecipientId, changeReport, ThreadType.User);
      console.log(`📤 [Tool: switch_company] Đã báo HR đổi sang [${newCompany}] thành công!`);
    } catch (err) {
      console.error("❌ Lỗi gửi thông báo đổi công ty tới HR:", err);
    }
  }

  /**
   * Gửi thông báo khi ứng viên dời lịch hẹn sang HR
   */
  public async notifyReschedule(params: {
    candidate: CandidateRecord;
    targetCompany: string;
    newDate: string;
  }): Promise<void> {
    const { candidate, targetCompany, newDate } = params;
    const rescheduleReport = `🔔 [CẬP NHẬT: ỨNG VIÊN DỜI LỊCH NHẬN VIỆC]
👤 Ứng viên: ${candidate.fullName || candidate.senderName} (ID: ${candidate.senderId})
🏢 CÔNG TY: ${String(targetCompany).toUpperCase()}
⏰ THỜI GIAN HẸN MỚI: ${newDate.toUpperCase()}
📞 Số điện thoại: ${candidate.phoneNumber || "Chưa cung cấp"}
📋 Số CCCD: ${candidate.idNumber || "Đã lưu trong hệ thống"}
📅 Thời gian báo: ${new Date().toLocaleString("vi-VN")}`;

    try {
      await this.zaloService.sendMessage(this.hrRecipientId, rescheduleReport, ThreadType.User);
      console.log(
        `📤 [Tool: reschedule_interview] Đã báo HR dời lịch sang [${newDate}] thành công!`
      );
    } catch (err) {
      console.error("❌ Lỗi gửi thông báo dời lịch tới HR:", err);
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
    const errorReport = `⚠️ [CẢNH BÁO HỆ THỐNG: LỖI KẾT NỐI GEMINI AI]
👤 Luồng chat: ${params.senderName} (Thread ID: ${params.threadId})
⏱️ Thời gian: ${new Date().toLocaleString("vi-VN")}
❌ Chi tiết lỗi: ${params.error}

👉 Hệ thống đã TỰ ĐỘNG DỪNG và KHÔNG GỬI phản hồi tới ứng viên. Vui lòng kiểm tra API Key hoặc hỗ trợ thủ công!`;

    try {
      await this.zaloService.sendMessage(
        this.hrRecipientId,
        errorReport,
        ThreadType.User
      );
      console.log(
        `🚨 [HR Notifier] Đã gửi cảnh báo lỗi hệ thống AI tới HR (${this.hrRecipientId}) thành công!`
      );
    } catch (err) {
      console.error("❌ Lỗi khi gửi cảnh báo lỗi AI tới HR:", err);
    }
  }
}

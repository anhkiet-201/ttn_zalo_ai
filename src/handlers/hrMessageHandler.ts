import { type ParsedMessage, ThreadType } from "../types/zalo.types.js";
import { type ZaloService } from "../services/zaloService.js";
import { type AIService } from "../services/aiService.js";
import { CandidateRepository, ChatHistoryRepository } from "../database/index.js";
import { type RAGService } from "../services/ragService.js";
import { config } from "../config/index.js";

/**
 * HRMessageHandler: Chuyên trách xử lý lệnh từ tài khoản HR Quản trị viên.
 * SRP: Chỉ biết về HR commands — không biết gì về AI reply cho ứng viên.
 */
export class HRMessageHandler {
  constructor(
    private readonly zaloService: ZaloService,
    private readonly aiService: AIService,
    private readonly ragService: RAGService,
    private readonly candidateRepo: CandidateRepository,
    private readonly chatHistoryRepo: ChatHistoryRepository
  ) {}

  /** Xử lý tin nhắn do chính Bot / thiết bị cùng tài khoản gửi đi (Outgoing) */
  public async handleOutgoing(parsedMessage: ParsedMessage): Promise<void> {
    const threadTypeStr = parsedMessage.isGroup ? "👥 NHÓM" : "👤 CÁ NHÂN";
    console.log(
      `\n📤 [GỬI ĐI - ${threadTypeStr}] Tại [${parsedMessage.threadId}] | Tự gửi từ tài khoản Bot`
    );
    console.log(`💬 Nội dung: "${parsedMessage.text}"`);
    if (parsedMessage.hasQuote && parsedMessage.quoteText) {
      console.log(`   ↪️ Quote tin nhắn: "${parsedMessage.quoteText}"`);
    }
  }

  /** Entry point cho mọi tin nhắn từ HR Admin */
  public async handle(parsedMessage: ParsedMessage): Promise<void> {
    const senderInfo = `${parsedMessage.senderName} (${parsedMessage.senderId})`;
    const targetThreadType = parsedMessage.isGroup ? ThreadType.Group : ThreadType.User;

    console.log(
      `\n👑 [HR ADMIN 🛠️] Nhận tin nhắn từ: ${senderInfo} (Thread: ${parsedMessage.threadId}, Loại: ${
        parsedMessage.isGroup ? "👥 NHÓM" : "👤 CÁ NHÂN"
      })`
    );
    console.log(`💬 Nội dung: "${parsedMessage.text}"`);

    if (!parsedMessage.text) return;

    const rawText = parsedMessage.text.trim();
    const lowerText = rawText.toLowerCase();

    try {
      if (await this.handleCandidateList(parsedMessage, rawText, lowerText)) return;
      if (await this.handleRagCommand(parsedMessage, rawText, lowerText, targetThreadType)) return;
      if (await this.handlePing(parsedMessage, lowerText)) return;
      if (await this.handleHelp(parsedMessage, lowerText)) return;
      await this.handleDefault(parsedMessage);
    } catch (err) {
      console.error(`❌ [HR Admin] Lỗi khi reply tới HR [${parsedMessage.threadId}]:`, err);
    }
  }

  // ── Private command handlers ────────────────────────────────────────────

  private async handleCandidateList(
    parsedMessage: ParsedMessage,
    rawText: string,
    lowerText: string
  ): Promise<boolean> {
    const isListCmd =
      lowerText === "ds" || lowerText === "/ds" || lowerText === "danhsach" ||
      lowerText === "/danhsach" || lowerText.startsWith("ds ") || lowerText.startsWith("/ds ") ||
      lowerText.startsWith("danhsach ") || lowerText.startsWith("/danhsach ");

    if (!isListCmd) return false;

    // Trích xuất tham số ngày phía sau lệnh /ds (nếu có)
    const dateArg = rawText.replace(/^\/?(?:ds|danhsach)\s*/i, "").trim();

    // Lấy thời gian hiện tại theo GMT+7 (Asia/Ho_Chi_Minh)
    const now = new Date();
    const vnTimeStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }); // YYYY-MM-DD
    const [curYear, curMonth, curDay] = vnTimeStr.split("-").map(Number);

    let targetDay = curDay;
    let targetMonth = curMonth;
    let targetYear = curYear;
    let isToday = false;

    if (!dateArg) {
      // /ds -> Hôm nay
      isToday = true;
    } else if (/^\d{1,2}$/.test(dateArg)) {
      // /ds 10 -> Ngày 10 của tháng hiện tại, năm hiện tại
      targetDay = Number(dateArg);
      targetMonth = curMonth;
      targetYear = curYear;
    } else if (/^(\d{1,2})[\/\-](\d{1,2})$/.test(dateArg)) {
      // /ds 10/08 hoặc /ds 10/8 -> Ngày 10 tháng 8 năm hiện tại
      const parts = dateArg.split(/[\/\-]/).map(Number);
      targetDay = parts[0];
      targetMonth = parts[1];
      targetYear = curYear;
    } else if (/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.test(dateArg)) {
      // /ds 10/08/2026 -> Ngày 10/08/2026
      const parts = dateArg.split(/[\/\-]/).map(Number);
      targetDay = parts[0];
      targetMonth = parts[1];
      targetYear = parts[2];
    } else {
      await this.zaloService.replyMessage(
        parsedMessage.raw,
        `⚠️ [LỖI CÚ PHÁP NGÀY]\nTham số ngày "${dateArg}" không hợp lệ.\n\nHướng dẫn sử dụng:\n• /ds: Xem ứng viên hôm nay\n• /ds 10: Xem ứng viên ngày 10 tháng này\n• /ds 10/08: Xem ứng viên ngày 10 tháng 8\n• /ds 10/08/2026: Xem ứng viên ngày cụ thể`
      );
      return true;
    }

    // Kiểm tra tính hợp lệ của ngày tháng
    if (targetMonth < 1 || targetMonth > 12 || targetDay < 1 || targetDay > 31) {
      await this.zaloService.replyMessage(
        parsedMessage.raw,
        `⚠️ [NGÀY THÁNG KHÔNG HỢP LỆ]\nNgày: ${targetDay}, Tháng: ${targetMonth} không tồn tại trên lịch.`
      );
      return true;
    }

    const pad = (n: number) => String(n).padStart(2, "0");
    const startIso = `${targetYear}-${pad(targetMonth)}-${pad(targetDay)}T00:00:00.000+07:00`;
    const endIso = `${targetYear}-${pad(targetMonth)}-${pad(targetDay)}T23:59:59.999+07:00`;

    const startTimestamp = new Date(startIso).getTime();
    const endTimestamp = new Date(endIso).getTime();

    if (isNaN(startTimestamp) || isNaN(endTimestamp)) {
      await this.zaloService.replyMessage(
        parsedMessage.raw,
        `⚠️ [LỖI NGÀY THÁNG]\nKhông thể tính toán mốc thời gian cho ngày: ${targetDay}/${targetMonth}/${targetYear}`
      );
      return true;
    }

    if (targetDay === curDay && targetMonth === curMonth && targetYear === curYear) {
      isToday = true;
    }

    const dateLabel = `${pad(targetDay)}/${pad(targetMonth)}/${targetYear}`;
    const candidates = this.candidateRepo.getCandidatesByDateRange(startTimestamp, endTimestamp);

    if (candidates.length === 0) {
      const emptyMsg = isToday
        ? `📋 Hôm nay (${dateLabel}) chưa có ứng viên nào đăng ký trong cơ sở dữ liệu.`
        : `📋 Không có ứng viên nào đăng ký vào ngày ${dateLabel}.`;
      await this.zaloService.replyMessage(parsedMessage.raw, emptyMsg);
      this.chatHistoryRepo.addMessage({
        threadId: parsedMessage.threadId,
        senderId: "bot",
        senderName: "TTN HR Assistant (Bot)",
        role: "model",
        content: emptyMsg,
        timestamp: Date.now(),
      });
      return true;
    }

    const titleHeader = isToday
      ? `📋 DANH SÁCH ỨNG VIÊN HÔM NAY (${dateLabel}) - ${candidates.length} NGƯỜI:\n━━━━━━━━━━━━━━━━━━━━`
      : `📋 DANH SÁCH ỨNG VIÊN NGÀY ${dateLabel} - ${candidates.length} NGƯỜI:\n━━━━━━━━━━━━━━━━━━━━`;

    let report = titleHeader;
    candidates.forEach((c, idx) => {
      const name = (c.fullName || c.senderName || "Chưa rõ").toUpperCase();
      const phone = c.phoneNumber || "Chưa có";
      const company = c.targetCompany || "Chưa chọn cty";
      const interview = c.interviewDate || "Chưa hẹn";
      const idNum = c.idNumber || "Chưa rõ";
      const cccdExtra: string[] = [idNum];
      if (c.gender) cccdExtra.push(c.gender);
      if (c.dob) cccdExtra.push(c.dob);

      const timeStr = c.createdAt
        ? new Date(c.createdAt).toLocaleTimeString("vi-VN", {
            timeZone: "Asia/Ho_Chi_Minh",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "";

      report += `\n\n${idx + 1}. 👤 ${name} (${phone})\n`;
      report += `   🏭 Công ty: ${company}\n`;
      report += `   ⏰ Lịch hẹn: ${interview}\n`;
      report += `   📋 CCCD: ${cccdExtra.join(" · ")}`;
      if (timeStr) {
        report += `\n   ⏱️ Đăng ký: ${timeStr}`;
      }
    });

    report += `\n\n👉 Gõ "/ds" để xem hôm nay hoặc "/ds <ngày>" (vd: /ds 10, /ds 10/08) để tra cứu ngày khác.`;

    const replyContent = report.trim();
    await this.zaloService.replyMessage(parsedMessage.raw, replyContent);
    this.chatHistoryRepo.addMessage({
      threadId: parsedMessage.threadId,
      senderId: "bot",
      senderName: "TTN HR Assistant (Bot)",
      role: "model",
      content: replyContent,
      timestamp: Date.now(),
    });
    console.log(`📤 [HR Admin] Đã reply danh sách ${candidates.length} ứng viên ngày ${dateLabel}`);
    return true;
  }

  private async handleRagCommand(
    parsedMessage: ParsedMessage, rawText: string, lowerText: string, targetThreadType: ThreadType
  ): Promise<boolean> {
    const isRagCmd =
      lowerText === "rag" || lowerText === "/rag" ||
      lowerText.startsWith("rag ") || lowerText.startsWith("/rag ");

    if (!isRagCmd) return false;

    const ragContent = rawText.replace(/^\/?rag\s*/i, "").trim();

    // 1. Xử lý lệnh XÓA RAG trực tiếp (vd: /rag xóa cmt, /rag xoa sanaky, /rag delete job_05)
    const deleteMatch = ragContent.match(/^(?:xóa|xoa|delete|del|remove)\s+(.+)$/i);
    if (deleteMatch) {
      const keyword = deleteMatch[1].trim();
      console.log(`📥 [HR Admin] Nhận lệnh xóa RAG với từ khóa: "${keyword}"`);
      const deleteResult = this.ragService.deleteRagEntry({ keyword, targetFile: "all" });

      if (deleteResult.success && deleteResult.deletedItems.length > 0) {
        let replyText = `🗑️ [ĐÃ XÓA DỮ LIỆU RAG THÀNH CÔNG]\n━━━━━━━━━━━━━━━━━━━━\nĐã xóa ${deleteResult.deletedItems.length} mục khỏi cơ sở dữ liệu:\n\n`;
        deleteResult.deletedItems.forEach((it, idx) => {
          replyText += `${idx + 1}. 🏢 ${it.title.toUpperCase()} (ID: ${it.id})\n`;
          replyText += `   📁 File: ${it.targetFile}\n`;
          if (it.aliases && it.aliases.length > 0) {
            replyText += `   🏷️ Tên khác: ${it.aliases.join(", ")}\n`;
          }
          replyText += "\n";
        });
        replyText += `👉 Bot sẽ không còn tư vấn hoặc hiển thị các mục này cho ứng viên nữa!`;
        await this.zaloService.replyMessage(parsedMessage.raw, replyText.trim());
      } else {
        await this.zaloService.replyMessage(
          parsedMessage.raw,
          `⚠️ [KHÔNG TÌM THẤY DỮ LIỆU ĐỂ XÓA]\n━━━━━━━━━━━━━━━━━━━━\nKhông tìm thấy công ty hay chính sách nào khớp với từ khóa: "${keyword}"\n\n👉 Gõ "/rag" để xem danh sách toàn bộ ID và tên công ty hiện có.`
        );
      }
      return true;
    }

    // 2. Xử lý cập nhật/tạo mới RAG qua văn bản tự nhiên
    if (ragContent.length > 5 && ragContent.toLowerCase() !== "ds") {
      console.log(`📥 [HR Admin] Nhận yêu cầu cập nhật RAG (${ragContent.length} ký tự)...`);
      const report = await this.aiService.updateRagFromText(ragContent, this.ragService);

      if (report.success && report.items.length > 0) {
        let replyText = `✅ [CẬP NHẬT KHO TRI THỨC RAG THÀNH CÔNG]\nĐã cập nhật ${report.updatedCount} mục:\n\n`;
        report.items.forEach((it, idx) => {
          const e = it.entry || {};
          replyText += `${idx + 1}. 🏢 ${it.title} (ID: ${it.targetId || "Mới"})\n`;
          replyText += `   📁 ${it.targetFile} | 📝 ${it.action === "create_new" ? "Tạo mới" : "Cập nhật"}\n`;
          if (it.targetFile === "job_rag.json") {
            const vac = e["vacancies"];
            const vacStr = vac !== undefined && vac !== null
              ? (Number(vac) === 0 ? "⛔ TẠM NGƯNG TUYỂN" : `✅ Tuyển ${vac} người`) : "Đang tuyển";
            replyText += `   👥 Chỉ tiêu: ${vacStr}\n`;
            if (e["location"]) replyText += `   📍 ${e["location"]}\n`;
            if (e["interview_schedule"]) replyText += `   ⏰ ${e["interview_schedule"]}\n`;
          } else if (it.targetFile === "location_rag.json" && Array.isArray(e["nearby_suggestions"])) {
            replyText += `   🔄 Lân cận: ${(e["nearby_suggestions"] as string[]).join(", ")}\n`;
          }
          if (it.reason) replyText += `   📌 ${it.reason}\n`;
          replyText += "\n";
        });
        replyText += `👉 Bot đã sẵn sàng tư vấn theo dữ liệu mới nhất!`;
        await this.zaloService.replyMessage(parsedMessage.raw, replyText.trim());
      } else {
        await this.zaloService.replyMessage(
          parsedMessage.raw,
          `⚠️ [CẬP NHẬT RAG THẤT BẠI]\n❌ ${report.message || "Không thể trích xuất thông tin hợp lệ."}\n👉 Kiểm tra lại cấu trúc bài viết!`
        );
      }
      return true;
    }

    const jobRag = this.ragService.getJobRag();
    if (jobRag.length === 0) {
      await this.zaloService.replyMessage(parsedMessage.raw, "🏢 Chưa có thông tin tuyển dụng trong kho RAG.");
      return true;
    }

    const pageSize = 10;
    const totalPages = Math.ceil(jobRag.length / pageSize);
    for (let p = 0; p < totalPages; p++) {
      const pageJobs = jobRag.slice(p * pageSize, (p + 1) * pageSize);
      let text = `🏢 KHO DỮ LIỆU RAG (${p + 1}/${totalPages}) - ${jobRag.length} CÔNG TY:\n\n`;
      pageJobs.forEach((job: Record<string, unknown>, idx: number) => {
        const globalIdx = p * pageSize + idx + 1;
        const vacStr = job["vacancies"] !== undefined && job["vacancies"] !== null
          ? (Number(job["vacancies"]) === 0 ? "⛔ Tạm ngưng" : `✅ Tuyển ${job["vacancies"]}`) : "Đang tuyển";
        const schedule = job["interview_schedule"] ? ` | ⏰ ${job["interview_schedule"]}` : "";
        text += `${globalIdx}. ${job["title"] || job["id"]} [${vacStr}${schedule}]\n`;
      });
      if (p === 0) {
        await this.zaloService.replyMessage(parsedMessage.raw, text.trim());
      } else {
        await new Promise((r) => setTimeout(r, 400));
        await this.zaloService.sendMessage(parsedMessage.threadId, text.trim(), targetThreadType);
      }
    }
    console.log(`📤 [HR Admin] Đã reply RAG ${jobRag.length} công ty (${totalPages} phần)`);
    return true;
  }

  private async handlePing(parsedMessage: ParsedMessage, lowerText: string): Promise<boolean> {
    if (lowerText !== "ping" && lowerText !== "/ping") return false;
    await this.zaloService.replyMessage(
      parsedMessage.raw,
      `🏓 Pong! Bot trợ lý tuyển dụng AI đang hoạt động bình thường.\n🤖 Model: ${config.geminiModel}`
    );
    return true;
  }

  private async handleHelp(parsedMessage: ParsedMessage, lowerText: string): Promise<boolean> {
    if (lowerText !== "help" && lowerText !== "/help" && lowerText !== "menu") return false;
    const helpText =
      `👑 MENU LỆNH DÀNH CHO HR QUẢN TRỊ VIÊN:\n\n` +
      `• /ds: Xem danh sách ứng viên hôm nay\n` +
      `• /ds <ngày>: Xem ứng viên ngày trong tháng này (VD: /ds 10)\n` +
      `• /ds <ngày/tháng>: Xem ứng viên theo ngày tháng (VD: /ds 10/08)\n` +
      `• rag / /rag: Xem danh sách công ty đang tuyển\n` +
      `• /rag <bài viết>: Cập nhật / tạo mới công ty từ bài viết\n` +
      `• /rag xóa <tên/id>: Xóa công ty khỏi cơ sở dữ liệu (VD: /rag xóa cmt)\n` +
      `• ping: Kiểm tra trạng thái hoạt động của bot\n` +
      `• help: Xem hướng dẫn các câu lệnh quản trị`;
    await this.zaloService.replyMessage(parsedMessage.raw, helpText);
    return true;
  }

  private async handleDefault(parsedMessage: ParsedMessage): Promise<void> {
    await this.zaloService.replyMessage(
      parsedMessage.raw,
      `👋 Chào HR! Em là Trợ lý AI Quản trị Tuyển dụng.\n` +
      `Anh/chị có thể gõ "ds" để xem ứng viên mới hoặc "rag" để kiểm tra danh sách công ty đang tuyển nhé! 😊`
    );
  }
}

import { type ParsedMessage, ThreadType } from "../types/zalo.types.js";
import { type ZaloService } from "../services/zaloService.js";
import { type AIService } from "../services/aiService.js";
import { CandidateRepository, ChatHistoryRepository } from "../database/index.js";
import { type RAGService, normalizeText, extractRagContent } from "../services/ragService.js";
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
      lowerText === "xem rag" || lowerText === "kho rag" ||
      lowerText.startsWith("rag ") || lowerText.startsWith("/rag ") ||
      lowerText.startsWith("xem rag ") || lowerText.startsWith("kho rag ");

    if (!isRagCmd) return false;

    const ragContent = rawText.replace(/^(?:\/?rag|xem\s+rag|kho\s+rag)\s*/i, "").trim();

    // 1. Tra cứu chi tiết một công ty cụ thể nếu tên/ID khớp chính xác trong kho RAG (vd: xem rag sanaky, rag kaiser)
    if (ragContent && ragContent.length < 35 && !ragContent.includes("\n")) {
      const jobs = this.ragService.getJobRag();
      const normKeyword = normalizeText(ragContent);
      const matchedJob = jobs.find((j) => {
        const normTitle = normalizeText(String(j["title"] || ""));
        const normId = normalizeText(String(j["id"] || ""));
        if (normId === normKeyword || normTitle === normKeyword) return true;
        const aliases = Array.isArray(j["aliases"]) ? (j["aliases"] as string[]) : [];
        return aliases.some((a) => normalizeText(String(a)) === normKeyword);
      });

      if (matchedJob) {
        const vac = matchedJob["vacancies"];
        const vacStr = vac !== undefined && vac !== null
          ? (Number(vac) === 0 ? "🔴 TẠM NGƯNG TUYỂN" : `🟢 Đang tuyển ${vac} người`)
          : "Đang tuyển";
        const loc = matchedJob["location"] ? `\n📍 Địa chỉ: ${matchedJob["location"]}` : "";
        const map = matchedJob["map_url"] ? `\n🗺️ Map: ${matchedJob["map_url"]}` : "";
        const schedule = matchedJob["interview_schedule"] ? `\n⏰ Lịch hẹn: ${matchedJob["interview_schedule"]}` : "";
        const jobType = matchedJob["job_type"] ? `\n💼 Vị trí: ${matchedJob["job_type"]}` : "";

        const jobName = String(matchedJob["title"] || matchedJob["id"] || "").toUpperCase();
        const headerMsg =
          `🏢 [THÔNG TIN TUYỂN DỤNG: ${jobName}]\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `• Trạng thái: ${vacStr}${schedule}${jobType}${loc}${map}`;

        // Tin nhắn 1: Header/thông tin tổng quan
        await this.zaloService.replyMessage(parsedMessage.raw, headerMsg.trim());

        // Tin nhắn 2: Chỉ chứa rawContent
        const rawContent = extractRagContent(matchedJob);
        if (rawContent) {
          await new Promise((r) => setTimeout(r, 400));
          await this.zaloService.sendMessage(parsedMessage.threadId, rawContent, targetThreadType);
        }
        return true;
      }
    }

    // 2. Chuyển toàn bộ văn bản/lệnh RAG cho AI phân tích và tự quyết định (update_rag vs delete_rag)
    if (ragContent.length > 0 && ragContent.toLowerCase() !== "ds") {
      console.log(`📥 [HR Admin] Chuyển nội dung RAG cho AI phân tích (${ragContent.length} ký tự)...`);
      const report = await this.aiService.updateRagFromText(ragContent, this.ragService);

      if (report.success && report.items.length > 0) {
        const deletedItems = report.items.filter((i) => i.action === "delete");
        const updatedItems = report.items.filter((i) => i.action !== "delete");

        let replyText = "";
        if (deletedItems.length > 0 && updatedItems.length === 0) {
          replyText = `🗑️ [ĐÃ XÓA DỮ LIỆU RAG THÀNH CÔNG]\n━━━━━━━━━━━━━━━━━━━━\nĐã xóa ${deletedItems.length} mục khỏi cơ sở dữ liệu:\n\n`;
          deletedItems.forEach((it, idx) => {
            replyText += `${idx + 1}. 🏢 ${it.title || it.targetId} (ID: ${it.targetId || "N/A"})\n`;
            replyText += `   📁 File: ${it.targetFile}\n`;
            if (it.reason) replyText += `   📌 Lý do: ${it.reason}\n`;
            replyText += "\n";
          });
          replyText += `👉 Bot sẽ không còn tư vấn mục này cho ứng viên nữa!`;
        } else {
          replyText = `✅ [XỬ LÝ KHO TRI THỨC RAG THÀNH CÔNG]\nĐã xử lý ${report.updatedCount} mục:\n\n`;
          report.items.forEach((it, idx) => {
            const actionLabel =
              it.action === "create_new" ? "Tạo mới" : it.action === "delete" ? "Đã xóa" : "Cập nhật";
            replyText += `${idx + 1}. 🏢 ${it.title || it.targetId} (ID: ${it.targetId || "Mới"})\n`;
            replyText += `   📁 ${it.targetFile} | 📝 ${actionLabel}\n`;
            if (it.reason) replyText += `   📌 ${it.reason}\n`;
            replyText += "\n";
          });
          replyText += `👉 Bot đã sẵn sàng tư vấn theo dữ liệu mới nhất!`;
        }

        // Tin nhắn 1: Header báo cáo kết quả
        await this.zaloService.replyMessage(parsedMessage.raw, replyText.trim());

        // Tin nhắn 2: Gửi rawContent cho các mục vừa cập nhật/tạo mới (nếu có)
        for (const it of updatedItems) {
          const e = (it.entry || {}) as Record<string, any>;
          const raw = extractRagContent(e);
          if (raw) {
            await new Promise((r) => setTimeout(r, 400));
            await this.zaloService.sendMessage(parsedMessage.threadId, raw, targetThreadType);
          }
        }
      } else {
        await this.zaloService.replyMessage(
          parsedMessage.raw,
          `⚠️ [XỬ LÝ RAG THẤT BẠI]\n❌ ${report.message || "Không thể trích xuất thông tin hợp lệ."}\n👉 Vui lòng kiểm tra lại câu lệnh hoặc cấu trúc bài viết!`
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
      `• xem rag / /rag: Xem danh sách công ty đang tuyển\n` +
      `• xem rag <tên cty>: Xem chi tiết nội dung công ty (VD: xem rag sanaky)\n` +
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

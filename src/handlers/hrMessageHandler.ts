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
      if (await this.handleCandidateList(parsedMessage, lowerText)) return;
      if (await this.handleRagCommand(parsedMessage, rawText, lowerText, targetThreadType)) return;
      if (await this.handlePing(parsedMessage, lowerText)) return;
      if (await this.handleHelp(parsedMessage, lowerText)) return;
      await this.handleDefault(parsedMessage);
    } catch (err) {
      console.error(`❌ [HR Admin] Lỗi khi reply tới HR [${parsedMessage.threadId}]:`, err);
    }
  }

  // ── Private command handlers ────────────────────────────────────────────

  private async handleCandidateList(parsedMessage: ParsedMessage, lowerText: string): Promise<boolean> {
    const isListCmd =
      lowerText === "ds" || lowerText === "/ds" || lowerText === "danhsach" ||
      lowerText === "/danhsach" || lowerText.startsWith("tim ") || lowerText.startsWith("/uv");

    if (!isListCmd) return false;

    const candidates = this.candidateRepo.getRecentCandidates(5);

    if (candidates.length === 0) {
      const emptyMsg = "📋 Hiện tại chưa có ứng viên nào đăng ký trong cơ sở dữ liệu.";
      await this.zaloService.replyMessage(parsedMessage.raw, emptyMsg);
      this.chatHistoryRepo.addMessage({
        threadId: parsedMessage.threadId, senderId: "bot", senderName: "TTN HR Assistant (Bot)",
        role: "model", content: emptyMsg, timestamp: Date.now(),
      });
      return true;
    }

    let report = `📋 DANH SÁCH ỨNG VIÊN GẦN NHẤT (${candidates.length} người):\n\n`;
    candidates.forEach((c, idx) => {
      report += `${idx + 1}. ${c.fullName || c.senderName} - Cty: ${c.targetCompany || "Chưa rõ"}\n`;
      report += `   • SĐT: ${c.phoneNumber || "Chưa có"} | CCCD: ${c.idNumber || "Chưa có"}\n`;
      report += `   • Lịch hẹn: ${c.interviewDate || "Chưa có"} | Trạng thái: ${c.status}\n\n`;
    });

    const replyContent = report.trim();
    await this.zaloService.replyMessage(parsedMessage.raw, replyContent);
    this.chatHistoryRepo.addMessage({
      threadId: parsedMessage.threadId, senderId: "bot", senderName: "TTN HR Assistant (Bot)",
      role: "model", content: replyContent, timestamp: Date.now(),
    });
    console.log(`📤 [HR Admin] Đã reply danh sách ${candidates.length} ứng viên`);
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
      `• ds / /ds: Xem danh sách ứng viên mới nhất\n` +
      `• rag / /rag: Xem/cập nhật kho dữ liệu tuyển dụng RAG\n` +
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

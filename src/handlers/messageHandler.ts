import { type ParsedMessage, ThreadType, Reactions } from "../types/zalo.types.js";
import { type ZaloService } from "../services/zaloService.js";
import { type AIService, type CCCDAnalysisResult } from "../services/aiService.js";
import { CandidateRepository, ChatHistoryRepository, type CandidateRecord } from "../database/index.js";
import { HRNotifier } from "../services/hrNotifier.js";
import { ToolExecutor } from "../services/toolExecutor.js";
import { MessageBatcher, type MessageBatch } from "./messageBatcher.js";
import { GroupMessageBatcher } from "./groupMessageBatcher.js";
import { RAGService } from "../services/ragService.js";
import { UserContextManager } from "../services/userContextManager.js";
import { config } from "../config/index.js";

/**
 * MessageHandler: Điều phối luồng xử lý tin nhắn (Cá nhân & Nhóm),
 * kết hợp MessageBatcher (Debounce), AI Vision OCR, User Context (RAM + SQLite), AI Tool Calling và HR Notification.
 */
export class MessageHandler {
  private readonly candidateRepo: CandidateRepository;
  private readonly chatHistoryRepo: ChatHistoryRepository;
  private readonly hrNotifier: HRNotifier;
  private readonly userContextManager: UserContextManager;
  private readonly toolExecutor: ToolExecutor;
  private readonly batcher: MessageBatcher;
  private readonly groupBatcher: GroupMessageBatcher;
  private readonly ragService: RAGService;

  constructor(
    private readonly zaloService: ZaloService,
    private readonly aiService: AIService,
    candidateRepo?: CandidateRepository,
    hrNotifier?: HRNotifier,
    toolExecutor?: ToolExecutor,
    userContextManager?: UserContextManager
  ) {
    this.candidateRepo = candidateRepo || new CandidateRepository();
    this.chatHistoryRepo = new ChatHistoryRepository();
    this.hrNotifier = hrNotifier || new HRNotifier(this.zaloService);
    this.userContextManager =
      userContextManager || UserContextManager.getInstance();
    this.toolExecutor =
      toolExecutor ||
      new ToolExecutor(
        this.candidateRepo,
        this.hrNotifier,
        this.userContextManager
      );
    this.batcher = new MessageBatcher(async (batch) => this.processBatch(batch));
    this.ragService = new RAGService();
    this.groupBatcher = new GroupMessageBatcher(
      async (batch) => this.processGroupBatch(batch),
      config.groupDebounceSeconds
    );
  }

  /**
   * Phương thức xử lý chính cho tất cả tin nhắn (gửi đến & gửi đi)
   */
  public async handle(parsedMessage: ParsedMessage): Promise<void> {
    // 0. Tự động lưu tin nhắn vào SQLite và kích hoạt Realtime SSE Stream tới Web Chat
    const isSticker =
      parsedMessage.raw?.data?.msgType === "chat.sticker" ||
      parsedMessage.text === "[Sticker]" ||
      Boolean(parsedMessage.text && parsedMessage.text.includes("[Sticker]"));

    if (parsedMessage.text || parsedMessage.hasImage || isSticker) {
      try {
        this.chatHistoryRepo.addMessage({
          threadId: parsedMessage.threadId,
          senderId: parsedMessage.senderId,
          senderName:
            parsedMessage.senderName ||
            (parsedMessage.isSelf
              ? "Admin (Tôi)"
              : parsedMessage.isGroup
              ? "Thành viên nhóm"
              : "Ứng viên"),
          role: parsedMessage.isSelf ? "model" : "user",
          content:
            parsedMessage.text ||
            (isSticker
              ? "[Sticker]"
              : parsedMessage.hasImage
              ? "[Hình ảnh đính kèm]"
              : ""),
          hasImage: parsedMessage.hasImage,
          imageUrls: parsedMessage.imageUrls,
          timestamp: parsedMessage.timestamp || Date.now(),
        });
      } catch (err) {
        console.warn("⚠️ Không thể lưu tin nhắn vào chat_messages:", err);
      }
    }

    if (parsedMessage.isSelf) {
      // 1. Xử lý tin nhắn do chính tài khoản Bot / Thiết bị khác cùng tài khoản gửi đi (Outgoing Message)
      await this.handleOutgoingMessage(parsedMessage);
      return;
    } else if (
      parsedMessage.threadId === config.hrRecipientId ||
      parsedMessage.senderId === config.hrRecipientId
    ) {
      // 2. Xử lý tin nhắn từ / tới tài khoản HR Quản trị viên (HR Admin Message)
      await this.handleHRMessage(parsedMessage);
    } else if (parsedMessage.isGroup) {
      // 3. Xử lý tin nhắn từ NHÓM CHAT gửi đến (Group Message)
      await this.handleGroupMessage(parsedMessage);
    } else {
      // 4. Xử lý tin nhắn CÁ NHÂN 1-1 gửi đến (Direct Message)
      await this.handleDirectMessage(parsedMessage);
    }
  }

  /**
   * Xử lý tin nhắn gửi đi (Outgoing Message)
   */
  private async handleOutgoingMessage(
    parsedMessage: ParsedMessage
  ): Promise<void> {
    const threadTypeStr = parsedMessage.isGroup ? "👥 NHÓM" : "👤 CÁ NHÂN";
    const threadInfo = parsedMessage.threadId;

    console.log(
      `\n📤 [GỬI ĐI - ${threadTypeStr}] Tại [${threadInfo}] | Tự gửi từ tài khoản Bot`
    );
    console.log(`💬 Nội dung: "${parsedMessage.text}"`);

    if (parsedMessage.hasQuote && parsedMessage.quoteText) {
      console.log(`   ↪️ Quote tin nhắn: "${parsedMessage.quoteText}"`);
    }
  }

  /**
   * Xử lý tin nhắn từ / tới tài khoản HR Quản trị viên (HR Admin Message)
   * Tách biệt 100% khỏi luồng ứng viên tìm việc.
   */
  private async handleHRMessage(
    parsedMessage: ParsedMessage
  ): Promise<void> {
    const senderInfo = `${parsedMessage.senderName} (${parsedMessage.senderId})`;
    const threadInfo = parsedMessage.threadId;
    const targetThreadType = parsedMessage.isGroup
      ? ThreadType.Group
      : ThreadType.User;

    console.log(
      `\n👑 [HR ADMIN 🛠️] Nhận tin nhắn từ tài khoản HR: ${senderInfo} (Thread: ${threadInfo}, Loại: ${
        parsedMessage.isGroup ? "👥 NHÓM" : "👤 CÁ NHÂN"
      })`
    );
    console.log(`💬 Nội dung: "${parsedMessage.text}"`);

    if (!parsedMessage.text) {
      return;
    }

    const rawText = parsedMessage.text.trim();
    const lowerText = rawText.toLowerCase();

    try {
      // 1. Lệnh kiểm tra danh sách ứng viên gần nhất (ds, /ds, /uv, tim...)
      if (
        lowerText === "ds" ||
        lowerText === "/ds" ||
        lowerText === "danhsach" ||
        lowerText === "/danhsach" ||
        lowerText.startsWith("tim ") ||
        lowerText.startsWith("/uv")
      ) {
        const candidates = this.candidateRepo.getRecentCandidates(5);

        if (candidates.length === 0) {
          const emptyMsg = "📋 Hiện tại chưa có ứng viên nào đăng ký trong cơ sở dữ liệu.";
          await this.zaloService.replyMessage(
            parsedMessage.raw,
            emptyMsg
          );
          this.chatHistoryRepo.addMessage({
            threadId: parsedMessage.threadId,
            senderId: "bot",
            senderName: "TTN HR Assistant (Bot)",
            role: "model",
            content: emptyMsg,
            timestamp: Date.now(),
          });
          console.log(
            `📤 [HR Admin] Đã reply danh sách ứng viên (trống) tới [${parsedMessage.threadId}]`
          );
          return;
        }

        let report = `📋 DANH SÁCH ỨNG VIÊN GẦN NHẤT (${candidates.length} người):\n\n`;
        candidates.forEach((c, idx) => {
          report += `${idx + 1}. ${c.fullName || c.senderName} - Cty: ${c.targetCompany || "Chưa rõ"}\n`;
          report += `   • SĐT: ${c.phoneNumber || "Chưa có"} | CCCD: ${c.idNumber || "Chưa có"}\n`;
          report += `   • Lịch hẹn: ${c.interviewDate || "Chưa có"} | Trạng thái: ${c.status}\n\n`;
        });

        const replyContent = report.trim();
        await this.zaloService.replyMessage(
          parsedMessage.raw,
          replyContent
        );
        this.chatHistoryRepo.addMessage({
          threadId: parsedMessage.threadId,
          senderId: "bot",
          senderName: "TTN HR Assistant (Bot)",
          role: "model",
          content: replyContent,
          timestamp: Date.now(),
        });
        console.log(
          `📤 [HR Admin] Đã reply danh sách ${candidates.length} ứng viên tới [${parsedMessage.threadId}]`
        );
        return;
      }

      // 2. Lệnh tra cứu hoặc Cập nhật kho dữ liệu tuyển dụng RAG (rag, /rag)
      if (lowerText === "rag" || lowerText === "/rag" || lowerText.startsWith("rag ") || lowerText.startsWith("/rag ")) {
        const ragContent = rawText.replace(/^\/?rag\s*/i, "").trim();

        // 2.1. Nếu HR gửi kèm nội dung JD/quy định/địa bàn -> Tự động phân loại và cập nhật vào RAG
        if (ragContent.length > 5 && ragContent.toLowerCase() !== "ds") {
          console.log(`📥 [HR Admin] Nhận yêu cầu cập nhật RAG với nội dung (${ragContent.length} ký tự)...`);
          const report = await this.aiService.updateRagFromText(ragContent, this.ragService);

          if (report.success && report.items.length > 0) {
            let replyText = `✅ [CẬP NHẬT KHO TRI THỨC RAG THÀNH CÔNG]\n`;
            replyText += `Đã tự động phân loại và cập nhật ${report.updatedCount} mục vào cơ sở dữ liệu:\n\n`;

            report.items.forEach((it, idx) => {
              const actionLabel = it.action === "create_new" ? "Tạo mới" : "Cập nhật";
              const e = it.entry || {};

              replyText += `${idx + 1}. 🏢 ${it.title} (ID: ${it.targetId || "Mới"})\n`;
              replyText += `   📁 Phân loại: ${it.targetFile}\n`;
              replyText += `   📝 Thao tác: ${actionLabel}\n`;

              if (it.targetFile === "job_rag.json") {
                const vac = e["vacancies"];
                let vacStr = "Đang tuyển";
                if (vac !== undefined && vac !== null) {
                  const numVac = Number(vac);
                  vacStr = numVac === 0 ? "0 người (⛔ TẠM NGƯNG TUYỂN / HẾT CHỈ TIÊU)" : `${numVac} người (✅ ĐANG TUYỂN)`;
                }
                replyText += `   👥 Chỉ tiêu: ${vacStr}\n`;
                if (e["location"]) replyText += `   📍 Địa điểm: ${e["location"]}\n`;
                if (e["map_url"]) replyText += `   🗺️ Bản đồ: ${e["map_url"]}\n`;
                if (e["interview_schedule"]) replyText += `   ⏰ Giờ hẹn phỏng vấn: ${e["interview_schedule"]}\n`;
                if (e["job_type"]) replyText += `   💼 Loại công việc: ${e["job_type"]}\n`;
              } else if (it.targetFile === "location_rag.json") {
                if (e["district"] || e["province"]) replyText += `   📍 Địa bàn: ${[e["district"], e["province"]].filter(Boolean).join(", ")}\n`;
                if (Array.isArray(e["nearby_suggestions"])) replyText += `   🔄 Gợi ý lân cận: ${e["nearby_suggestions"].join(", ")}\n`;
              }

              if (it.reason) {
                replyText += `   📌 Ghi chú: ${it.reason}\n`;
              }
              replyText += `\n`;
            });

            replyText += `👉 Bot đã sẵn sàng tư vấn chính xác cho tất cả ứng viên theo dữ liệu mới nhất!`;

            await this.zaloService.replyMessage(parsedMessage.raw, replyText.trim());
            console.log(
              `📤 [HR Admin] Đã reply kết quả cập nhật RAG (${report.updatedCount} mục) tới [${parsedMessage.threadId}]`
            );
          } else {
            const failText = `⚠️ [CẬP NHẬT RAG THẤT BẠI]\n❌ Lý do: ${
              report.message || "Không thể trích xuất thông tin hợp lệ từ nội dung đã gửi."
            }\n👉 Vui lòng kiểm tra lại cấu trúc bài viết tuyển dụng!`;

            await this.zaloService.replyMessage(parsedMessage.raw, failText);
            console.log(
              `📤 [HR Admin] Đã reply thông báo thất bại cập nhật RAG tới [${parsedMessage.threadId}]`
            );
          }
          return;
        }

        // 2.2. Nếu chỉ gõ /rag hoặc rag đơn thuần -> Hiển thị danh sách tổng hợp công ty ngắn gọn theo nhiều phần
        const jobRag = this.ragService.getJobRag();
        if (jobRag.length === 0) {
          await this.zaloService.replyMessage(
            parsedMessage.raw,
            "🏢 Chưa có thông tin tuyển dụng nào trong kho dữ liệu RAG (job_rag.json)."
          );
          return;
        }

        const pageSize = 10;
        const totalPages = Math.ceil(jobRag.length / pageSize);

        for (let p = 0; p < totalPages; p++) {
          const pageJobs = jobRag.slice(p * pageSize, (p + 1) * pageSize);
          let text = `🏢 KHO DỮ LIỆU RAG (${p + 1}/${totalPages}) - ${jobRag.length} CÔNG TY:\n\n`;

          pageJobs.forEach((job: any, idx: number) => {
            const globalIdx = p * pageSize + idx + 1;
            let vacStr = "Đang tuyển";
            if (job.vacancies !== undefined && job.vacancies !== null) {
              vacStr = Number(job.vacancies) === 0 ? "⛔ Tạm ngưng" : `✅ Tuyển ${job.vacancies}`;
            }
            const schedule = job.interview_schedule ? ` | ⏰ ${job.interview_schedule}` : "";
            text += `${globalIdx}. ${job.title || job.id} [${vacStr}${schedule}]\n`;
          });

          if (p === 0) {
            await this.zaloService.replyMessage(parsedMessage.raw, text.trim());
          } else {
            await new Promise((resolve) => setTimeout(resolve, 400));
            await this.zaloService.sendMessage(
              parsedMessage.threadId,
              text.trim(),
              targetThreadType
            );
          }
        }

        console.log(
          `📤 [HR Admin] Đã reply thông tin RAG ${jobRag.length} công ty (${totalPages} phần) tới [${parsedMessage.threadId}]`
        );
        return;
      }

      // 3. Lệnh /ping hoặc /help
      if (lowerText === "ping" || lowerText === "/ping") {
        await this.zaloService.replyMessage(
          parsedMessage.raw,
          `🏓 Pong! Bot trợ lý tuyển dụng AI đang hoạt động bình thường.\n🤖 Model: ${config.geminiModel}`
        );
        console.log(`📤 [HR Admin] Đã reply Pong tới [${parsedMessage.threadId}]`);
        return;
      }

      if (lowerText === "help" || lowerText === "/help" || lowerText === "menu") {
        const helpText =
          `👑 MENU LỆNH DÀNH CHO HR QUẢN TRỊ VIÊN:\n\n` +
          `• ds / /ds: Xem danh sách ứng viên mới nhất\n` +
          `• rag / /rag: Xem danh sách các công ty đang tuyển dụng trong RAG\n` +
          `• ping: Kiểm tra trạng thái hoạt động của bot\n` +
          `• help: Xem hướng dẫn các câu lệnh quản trị`;
        await this.zaloService.replyMessage(
          parsedMessage.raw,
          helpText
        );
        console.log(`📤 [HR Admin] Đã reply Menu trợ giúp tới [${parsedMessage.threadId}]`);
        return;
      }

      // 4. Phản hồi tự nhiên với vai trò Trợ lý Quản trị Tuyển dụng
      const hrReply =
        `👋 Chào HR! Em là Trợ lý AI Quản trị Tuyển dụng.\n` +
        `Anh/chị có thể gõ "ds" để xem ứng viên mới hoặc "rag" để kiểm tra danh sách công ty đang tuyển nhé! 😊`;
      await this.zaloService.replyMessage(
        parsedMessage.raw,
        hrReply
      );
      console.log(`📤 [HR Admin] Đã reply chào hỏi tới [${parsedMessage.threadId}]`);
    } catch (err) {
      console.error(
        `❌ [HR Admin] Lỗi khi reply tin nhắn tới HR [${parsedMessage.threadId}]:`,
        err
      );
    }
  }

  /**
   * Xử lý tin nhắn CÁ NHÂN 1-1 (Direct Message)
   */
  private async handleDirectMessage(
    parsedMessage: ParsedMessage
  ): Promise<void> {
    const senderInfo = `${parsedMessage.senderName} (${parsedMessage.senderId})`;
    const threadInfo = parsedMessage.threadId;

    console.log(
      `\n📥 [CÁ NHÂN 👤] Nhận tin nhắn từ: ${senderInfo} (Thread: ${threadInfo})`
    );
    console.log(`💬 Nội dung: "${parsedMessage.text}"`);

    if (parsedMessage.hasQuote && parsedMessage.quoteText) {
      console.log(`   ↪️ Đang Reply tin nhắn trước: "${parsedMessage.quoteText}"`);
    }

    // Bỏ qua nếu senderName hoặc tên Zalo bắt đầu bằng -M hoặc -m (chế độ Thủ công Manual / tài khoản nội bộ)
    const senderNameTrimmed = (parsedMessage.senderName || "").trim();
    let isManual =
      senderNameTrimmed.startsWith("-M") ||
      senderNameTrimmed.startsWith("-m");

    if (!isManual) {
      const liveName = await this.zaloService.getUserName(parsedMessage.threadId);
      if (liveName && (liveName.startsWith("-M") || liveName.startsWith("-m"))) {
        isManual = true;
      }
    }

    if (isManual) {
      console.log(
        `🛑 [Chế độ Thủ Công (-M)] Bỏ qua phản hồi AI cho [${senderInfo}] (tên bắt đầu bằng -M/-m)`
      );
      return;
    }

    if (!parsedMessage.text && !parsedMessage.hasImage) {
      return;
    }

    if (parsedMessage.hasImage && parsedMessage.imageUrls?.length) {
      console.log(
        `🖼️ [Ảnh Cá Nhân] Nhận được ${parsedMessage.imageUrls.length} hình ảnh từ ứng viên ${senderInfo}`
      );
    }

    this.batcher.enqueue(parsedMessage, ThreadType.User);
  }

  /**
   * Xử lý tin nhắn NHÓM CHAT (Group Message)
   * Bỏ qua: ảnh, sticker (text rỗng), từ khóa nội bộ, nhóm ở chế độ Manual (-M).
   * Chỉ xử lý văn bản thuần → enqueue vào GroupMessageBatcher để phân tích RAG.
   */
  private async handleGroupMessage(
    parsedMessage: ParsedMessage
  ): Promise<void> {
    const senderInfo = `${parsedMessage.senderName} (${parsedMessage.senderId})`;
    const groupInfo = parsedMessage.threadId;

    // 2. Bỏ qua sticker / voice / reaction (text === "")
    if (!parsedMessage.text) {
      return;
    }

    // 3. Lọc từ khóa nội bộ (mai pv, mai nv, pv, nv...) khi độ dài ngắn hơn 10 ký tự
    const lowerText = parsedMessage.text.toLowerCase().trim();
    const matchedKeyword = config.groupIgnoreKeywords.find((kw) =>
      lowerText.includes(kw)
    );
    if (matchedKeyword || lowerText.length < 10) {
      const reason = matchedKeyword
        ? `từ khóa "${matchedKeyword}"`
        : `độ dài ngắn (${lowerText.length} < 10 ký tự)`;
      console.log(
        `🚫 [Nhóm-Skip] Bỏ qua ${reason} từ ${senderInfo} trong nhóm [${groupInfo}]`
      );
      return;
    }

    // 4. Lấy tên nhóm từ ZaloService (có cache)
    const groupName = await this.zaloService.getGroupName(groupInfo);

    // Bỏ qua nếu nhóm đang ở chế độ Manual (-M)
    if (groupName.startsWith("-M") || groupName.startsWith("-m")) {
      console.log(
        `🛑 [Nhóm Thủ Công (-M)] Bỏ qua phân tích AI cho Nhóm [${groupName}] (bắt đầu bằng -M/-m)`
      );
      return;
    }

    console.log(
      `\n📥 [NHÓM CHAT 👥] Tại Nhóm: "${groupName}" [${groupInfo}] | Thành viên: ${senderInfo}`
    );
    console.log(`💬 Nội dung: "${parsedMessage.text}"`);

    if (parsedMessage.hasQuote && parsedMessage.quoteText) {
      console.log(`   ↪️ Đang Reply trong nhóm: "${parsedMessage.quoteText}"`);
    }

    // 5. Đưa vào GroupMessageBatcher kèm tên nhóm để debounce 30s rồi phân tích RAG
    this.groupBatcher.enqueue(parsedMessage, groupName);
  }

  /**
   * Xử lý batch tin nhắn nhóm sau debounce:
   * Gọi Gemini analyzeGroupBatch để phân tích và cập nhật kho RAG.
   * Nếu có thông tin hợp lệ (đã cập nhật RAG thành công) -> Thả tim vào các tin nhắn đó.
   */
  private async processGroupBatch(
    batch: import("./groupMessageBatcher.js").GroupMessageBatch
  ): Promise<void> {
    console.log(
      `\n🚀 [Nhóm-RAG] Bắt đầu phân tích ${batch.messages.length} tin nhắn từ nhóm: "${batch.groupName}" [${batch.threadId}]`
    );
    const hasUpdated = await this.aiService.analyzeGroupBatch(
      batch.groupName,
      batch.messages,
      this.ragService
    );

    // Nếu thông tin hợp lệ và đã cập nhật RAG thành công -> Thả tim xác nhận
    if (hasUpdated) {
      console.log(`❤️ [Nhóm-Tim] Thả tim xác nhận vào các tin nhắn cập nhật RAG...`);
      for (const msg of batch.messages) {
        if (msg.rawMessage) {
          try {
            await this.zaloService.sendReaction(msg.rawMessage, Reactions.HEART);
          } catch (err) {
            console.error("❌ Lỗi khi thả tim tin nhắn nhóm:", err);
          }
        }
      }
    }
  }

  /**
   * Xử lý gửi batch tin nhắn đã gom sang Gemini AI và gửi phản hồi
   */
  private async processBatch(batch: MessageBatch): Promise<void> {
    // Thu thập tất cả hình ảnh từ các tin nhắn trong batch
    const allImageUrls: string[] = [];
    for (const msg of batch.messages) {
      if (msg.imageUrls && msg.imageUrls.length > 0) {
        allImageUrls.push(...msg.imageUrls);
      }
    }

    // 1. Quét và ghi nhận số điện thoại người dùng cung cấp vào User Context
    for (const msg of batch.messages) {
      if (msg.text) {
        this.userContextManager.extractAndAddPhoneNumbers(
          batch.threadId,
          batch.senderId,
          batch.senderName,
          msg.text
        );
      }
    }

    // 2. Kiểm tra và phân tích CCCD (mặt trước / mặt sau / cả 2 mặt) nếu có ảnh đính kèm
    let cccdResult: CCCDAnalysisResult | null = null;
    if (allImageUrls.length > 0) {
      console.log(`🔍 [AI Vision] Đang đọc và phân tích ${allImageUrls.length} hình ảnh gửi đến...`);
      cccdResult = await this.aiService.analyzeCCCD(allImageUrls);

      if (cccdResult && cccdResult.isCCCD) {
        console.log(
          `✅ [CCCD Hợp lệ] Trích xuất: ${cccdResult.fullName || "Chưa rõ"} - CCCD: ${
            cccdResult.idNumber || "Chưa rõ"
          }`
        );
        // Lưu và gộp ảnh CCCD 2 mặt vào User Context (RAM Cache & Write-Through SQLite)
        this.userContextManager.addOrUpdateCCCD(
          batch.threadId,
          batch.senderId,
          batch.senderName,
          cccdResult,
          allImageUrls
        );
      }

      // Thả tim vào các tin nhắn ảnh sau khi AI đã đọc xong ảnh
      for (const msg of batch.messages) {
        if (msg.rawMessage && msg.imageUrls && msg.imageUrls.length > 0) {
          try {
            await this.zaloService.sendReaction(
              msg.rawMessage,
              Reactions.HEART
            );
          } catch {}
        }
      }
    }

    // 3. Lấy User Context mới nhất từ RAM cache để nạp vào prompt cho AI
    const userContext = this.userContextManager.getContext(
      batch.threadId,
      batch.senderId,
      batch.senderName
    );
    const userContextText = this.userContextManager.formatForPrompt(userContext);

    // 4. Lấy dữ liệu hồ sơ candidate in-memory (tuyệt đối KHÔNG upsertCandidate vào DB ở đây)
    let candidateData: CandidateRecord =
      this.candidateRepo.getPendingCandidate(batch.threadId, batch.senderId) ||
      this.candidateRepo.getLatestCandidate(batch.threadId, batch.senderId) || {
        threadId: batch.threadId,
        senderId: batch.senderId,
        senderName: batch.senderName,
        imageUrls: allImageUrls,
        forwardedTo: config.hrRecipientId,
      };

    // 5. Gom nội dung text của các tin nhắn trong batch
    const textLines: string[] = [];
    let lastQuote: string | undefined = undefined;

    for (const msg of batch.messages) {
      if (msg.text) {
        const timeStr = this.aiService.formatTimestamp(msg.timestamp);
        textLines.push(`[Gửi lúc ${timeStr}]: ${msg.text}`);
      }
      if (msg.quoteText) {
        lastQuote = msg.quoteText;
      }
    }

    if (cccdResult && cccdResult.isCCCD) {
      textLines.push(
        `[Hệ thống OCR CCCD]: Ứng viên vừa gửi ảnh Căn cước công dân (hoặc mặt CCCD). Họ tên: ${
          cccdResult.fullName || "Chưa rõ"
        }, Số CCCD: ${cccdResult.idNumber || "Chưa rõ"}, Giới tính: ${
          cccdResult.gender || "Chưa rõ"
        }, Năm sinh: ${cccdResult.dob || "Chưa rõ"}.`
      );
    }

    const formattedText = textLines.join("\n");
    if (!formattedText && allImageUrls.length === 0) {
      return;
    }

    console.log(
      `\n🚀 [Kích hoạt Batch] Bắt đầu tạo phản hồi cho ${batch.messages.length} tin nhắn từ [${batch.threadId}]:\n${formattedText}`
    );

    // 6. Gửi sang Gemini AI và xử lý Tool Calling
    try {
      console.log("🤔 [Gemini AI] Đang suy nghĩ câu trả lời & kiểm tra Tool Calls...");
      const aiReply = await this.aiService.generateReply(
        batch.threadId,
        batch.senderName,
        formattedText,
        {
          senderId: batch.senderId,
          isGroup: batch.threadType === ThreadType.Group,
          quoteContext: lastQuote,
          imageUrls: allImageUrls.length > 0 ? allImageUrls : undefined,
          userContextText,
          onToolCall: async (toolName, args) => {
            const res = await this.toolExecutor.execute(toolName, args, {
              threadId: batch.threadId,
              senderId: batch.senderId,
              senderName: batch.senderName,
              userContext,
              candidateData,
            });
            candidateData = res.updatedCandidate;
            return res.result;
          },
        }
      );

      if (!aiReply || !aiReply.trim()) {
        console.log(
          `⏸️ [Gemini AI] Không có phản hồi hợp lệ hoặc gặp sự cố -> Dừng, không gửi tin nhắn tới ứng viên.`
        );
        return;
      }

      console.log(`🤖 [Gemini AI Phản hồi]:\n${aiReply}`);

      // 7. Tách thành nhiều tin nhắn ngắn (bằng ký hiệu |||) và gửi lần lượt
      const messageParts = this.splitMessages(aiReply);

      for (let i = 0; i < messageParts.length; i++) {
        const part = messageParts[i];
        if (i > 0) {
          await new Promise((resolve) => setTimeout(resolve, 800));
        }

        await this.zaloService.sendMessage(
          batch.threadId,
          part,
          batch.threadType
        );
      }
    } catch (error: any) {
      console.error("❌ Lỗi khi xử lý phản hồi AI:", error);
      // Gửi cảnh báo sự cố kỹ thuật tới tài khoản HR_RECIPIENT_ID và KHÔNG gửi gì tới ứng viên
      try {
        await this.hrNotifier.notifySystemError({
          threadId: batch.threadId,
          senderName: batch.senderName,
          error: error?.message || String(error),
        });
      } catch (hrErr) {
        console.error("❌ Không thể gửi cảnh báo lỗi tới HR:", hrErr);
      }
    }
  }

  /**
   * Tách câu trả lời thành danh sách các tin nhắn ngắn riêng biệt
   * Chuẩn hóa và loại bỏ hoàn toàn các ký tự thừa như [, ], (, ) xung quanh dấu phân cách |||
   */
  private splitMessages(text: string): string[] {
    if (!text || !text.trim()) return [];

    // 0. Bóc tách pattern lịch sử chat mà AI đôi khi tự thêm vào phản hồi thay vì dùng |||
    //    VD: "...câu 1[14:24:08 Thứ Sáu, 28/08/2026] [Bot]: câu 2..." → "...câu 1|||câu 2..."
    const stripHistoryPrefixes = (s: string): string =>
      s.replace(/\[\d{1,2}:\d{2}(?::\d{2})?\s[^\]]*\]\s*\[Bot\]:/g, "|||");

    const stripped = stripHistoryPrefixes(text);

    // 1. Chuẩn hóa tất cả các biến thể [|||], (|||), {|||}, |||| thành |||
    const normalized = stripped
      .replace(/\[\s*\|{2,}\s*\]/g, "|||")
      .replace(/\(\s*\|{2,}\s*\)/g, "|||")
      .replace(/\{\s*\|{2,}\s*\}/g, "|||")
      .replace(/\|{2,}/g, "|||");

    const cleanSnippet = (s: string): string => {
      let res = s.trim();
      // Bóc tách các dấu đóng/mở ngoặc đơn lẻ còn sót lại ở đầu hoặc cuối tin nhắn
      res = res
        .replace(/^[\]\)\}\>\s]+/, "")
        .replace(/[\[\(\{\<\s]+$/, "")
        .trim();
      return res;
    };

    if (normalized.includes("|||")) {
      return normalized
        .split("|||")
        .map(cleanSnippet)
        .filter((s) => s.length > 0);
    }

    const parts = normalized
      .split(/\n\s*\n/)
      .map(cleanSnippet)
      .filter((s) => s.length > 0);

    if (parts.length > 1) {
      return parts;
    }

    const single = cleanSnippet(normalized);
    return single ? [single] : [];
  }
}

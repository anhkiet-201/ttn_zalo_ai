import { type ParsedMessage, ThreadType, Reactions } from "../types/zalo.types.js";
import { type ZaloService } from "../services/zaloService.js";
import { type AIService, type CCCDAnalysisResult } from "../services/aiService.js";
import { CandidateRepository, ThreadMetadataRepository, ChatHistoryRepository, type CandidateRecord } from "../database/index.js";
import { type HRNotifier } from "../services/hrNotifier.js";
import { type ToolExecutor } from "../services/toolExecutor.js";
import { UserContextManager } from "../services/userContextManager.js";
import { MessageBatcher, type MessageBatch } from "./messageBatcher.js";
import { config } from "../config/index.js";

/**
 * DirectMessageHandler: Chuyên trách xử lý tin nhắn cá nhân 1-1 từ ứng viên.
 * SRP: Quản lý debounce batch DM, OCR CCCD flow, gọi AI generateReply và gửi kết quả.
 * Mỗi phiên chat (threadId) hoàn toàn độc lập — không chồng chéo context giữa các ứng viên.
 */
export class DirectMessageHandler {
  private readonly batcher: MessageBatcher;
  private readonly chatHistoryRepo: ChatHistoryRepository;

  constructor(
    private readonly zaloService: ZaloService,
    private readonly aiService: AIService,
    private readonly candidateRepo: CandidateRepository,
    private readonly hrNotifier: HRNotifier,
    private readonly toolExecutor: ToolExecutor,
    private readonly userContextManager: UserContextManager,
    private readonly threadMetaRepo: ThreadMetadataRepository,
    chatHistoryRepo?: ChatHistoryRepository
  ) {
    this.chatHistoryRepo = chatHistoryRepo || new ChatHistoryRepository();
    // Mỗi DirectMessageHandler có batcher riêng — batch được phân vùng theo threadId
    // nên phiên của từng ứng viên hoàn toàn độc lập
    this.batcher = new MessageBatcher(async (batch) => this.processBatch(batch));
  }

  /**
   * Entry point: enqueue tin nhắn vào debounce batcher theo threadId ứng viên
   */
  public async handle(parsedMessage: ParsedMessage): Promise<void> {
    const senderInfo = `${parsedMessage.senderName} (${parsedMessage.senderId})`;

    console.log(`\n📥 [CÁ NHÂN 👤] Nhận tin nhắn từ: ${senderInfo} (Thread: ${parsedMessage.threadId})`);
    console.log(`💬 Nội dung: "${parsedMessage.text}"`);
    if (parsedMessage.hasQuote && parsedMessage.quoteText) {
      console.log(`   ↪️ Đang Reply tin nhắn trước: "${parsedMessage.quoteText}"`);
    }

    // Bỏ qua nếu là chế độ Manual (-M) — kiểm tra tên và DB
    const senderNameTrimmed = (parsedMessage.senderName || "").trim();
    let isManual =
      senderNameTrimmed.startsWith("-M") ||
      senderNameTrimmed.startsWith("-m") ||
      this.threadMetaRepo.isManual(parsedMessage.threadId);

    if (!isManual) {
      const liveName = await this.zaloService.getUserName(parsedMessage.threadId);
      if (liveName && (liveName.startsWith("-M") || liveName.startsWith("-m"))) {
        isManual = true;
      }
    }

    if (isManual) {
      console.log(`🛑 [Chế độ Thủ Công (-M)] Bỏ qua phản hồi AI cho [${senderInfo}]`);
      return;
    }

    if (!parsedMessage.text && !parsedMessage.hasImage && !parsedMessage.hasVoice && !parsedMessage.hasSticker) return;

    if (parsedMessage.hasImage && parsedMessage.imageUrls?.length) {
      console.log(`🖼️ [Ảnh Cá Nhân] Nhận ${parsedMessage.imageUrls.length} hình ảnh từ ${senderInfo}`);
    }

    if (parsedMessage.hasVoice && parsedMessage.voiceUrl) {
      console.log(`🎙️ [Tin Nhắn Thoại] Nhận ghi âm (${parsedMessage.voiceDuration || 0}ms) từ ${senderInfo}`);
    }

    if (parsedMessage.hasSticker) {
      console.log(`🏷️ [Nhãn Dán / Sticker] Nhận sticker từ ${senderInfo}`);
    }

    // Enqueue vào batcher — mỗi threadId có 1 batch riêng biệt
    this.batcher.enqueue(parsedMessage, ThreadType.User);
  }

  // ── Batch processing ────────────────────────────────────────────────────

  /**
   * Callback sau debounce: xử lý batch tin nhắn, phiên âm Voice STT, OCR CCCD, đọc hiểu Sticker, gọi AI, gửi reply
   */
  private async processBatch(batch: MessageBatch): Promise<void> {
    // 0.1 Xử lý phân tích nhãn dán Sticker nếu có
    for (const msg of batch.messages) {
      if (msg.hasSticker && (msg.stickerUrl || msg.stickerId || msg.stickerText)) {
        console.log(`🏷️ [StickerService] Đang đọc hiểu ý nghĩa sticker từ [${batch.senderName}]...`);
        const stickerMeaning = await this.aiService.sticker.understandSticker(
          msg.stickerUrl,
          msg.stickerText
        );
        console.log(`✅ [Sticker AI] Ý nghĩa nhãn dán: "${stickerMeaning}"`);
        msg.text = `[🏷️ Nhãn dán / Sticker]: "${stickerMeaning}"`;
        msg.stickerText = stickerMeaning;

        // Lưu bản ghi hoàn chỉnh với stickerUrl và ý nghĩa vào ChatHistory
        try {
          this.chatHistoryRepo.addMessage({
            threadId: batch.threadId,
            senderId: batch.senderId,
            senderName: batch.senderName,
            role: "user",
            content: msg.text,
            hasSticker: true,
            stickerId: msg.stickerId,
            stickerCateId: msg.stickerCateId,
            stickerUrl: msg.stickerUrl,
            stickerText: stickerMeaning,
            hasQuote: msg.hasQuote,
            quoteText: msg.quoteText,
            quoteSenderName: msg.quoteSenderName,
            quoteSenderId: msg.quoteSenderId,
            isGroup: false,
            timestamp: msg.timestamp,
          });
        } catch (err) {
          console.warn("⚠️ Lỗi lưu tin nhắn sticker vào chat_messages:", err);
        }

        // Thả tim xác nhận đã nhận sticker
        if (msg.rawMessage) {
          try {
            await this.zaloService.sendReaction(msg.rawMessage, Reactions.HEART);
          } catch {}
        }
      }
    }

    // 0.2 Xử lý phiên âm tin nhắn thoại (Audio Speech-to-Text) nếu có
    const companyHints = this.aiService.rag.getCompanyHints();
    for (const msg of batch.messages) {
      if (msg.hasVoice && msg.voiceUrl) {
        console.log(`🎙️ [AudioService] Đang phiên âm tin nhắn thoại từ [${batch.senderName}]...`);
        const transcribedText = await this.aiService.audio.transcribeAudio(msg.voiceUrl, companyHints);
        console.log(`✅ [Audio STT] Phiên âm: "${transcribedText}"`);
        msg.text = `[🎙️ Tin nhắn thoại]: "${transcribedText}"`;

        // Lưu/cập nhật bản ghi hoàn chỉnh với nội dung STT và voiceUrl vào ChatHistory
        try {
          this.chatHistoryRepo.addMessage({
            threadId: batch.threadId,
            senderId: batch.senderId,
            senderName: batch.senderName,
            role: "user",
            content: msg.text,
            hasVoice: true,
            voiceUrl: msg.voiceUrl,
            voiceDuration: msg.voiceDuration,
            hasQuote: msg.hasQuote,
            quoteText: msg.quoteText,
            quoteSenderName: msg.quoteSenderName,
            quoteSenderId: msg.quoteSenderId,
            isGroup: false,
            timestamp: msg.timestamp,
          });
        } catch (err) {
          console.warn("⚠️ Lỗi lưu tin nhắn thoại vào chat_messages:", err);
        }

        // Thả tim xác nhận đã nhận tin nhắn thoại
        if (msg.rawMessage) {
          try {
            await this.zaloService.sendReaction(msg.rawMessage, Reactions.HEART);
          } catch {}
        }
      }
    }

    // Thu thập tất cả hình ảnh từ batch
    const allImageUrls: string[] = [];
    for (const msg of batch.messages) {
      if (msg.imageUrls?.length) allImageUrls.push(...msg.imageUrls);
    }

    // 1. Quét và ghi nhận số điện thoại vào User Context (phân biệt theo senderId)
    for (const msg of batch.messages) {
      if (msg.text) {
        this.userContextManager.extractAndAddPhoneNumbers(
          batch.threadId, batch.senderId, batch.senderName, msg.text
        );
      }
    }

    // 2. Phân tích CCCD nếu có ảnh đính kèm
    let cccdResult: CCCDAnalysisResult | null = null;
    if (allImageUrls.length > 0) {
      console.log(`🔍 [AI Vision] Đang phân tích ${allImageUrls.length} hình ảnh...`);
      cccdResult = await this.aiService.analyzeCCCD(allImageUrls);

      if (cccdResult?.isCCCD) {
        if (cccdResult.cards && cccdResult.cards.length > 0) {
          for (const card of cccdResult.cards) {
            console.log(`✅ [CCCD] ${card.fullName || "Chưa rõ"} - ${card.idNumber || "Chưa rõ"} (${card.imageUrls.length} ảnh)`);
            // Lưu vào context của đúng threadId:senderId này — không ảnh hưởng ứng viên khác
            this.userContextManager.addOrUpdateCCCD(
              batch.threadId, batch.senderId, batch.senderName, card, card.imageUrls
            );
          }
        } else {
          console.log(`✅ [CCCD] ${cccdResult.fullName || "Chưa rõ"} - ${cccdResult.idNumber || "Chưa rõ"}`);
          this.userContextManager.addOrUpdateCCCD(
            batch.threadId, batch.senderId, batch.senderName, cccdResult, allImageUrls
          );
        }
      }

      // Thả tim xác nhận đã đọc ảnh
      for (const msg of batch.messages) {
        if (msg.rawMessage && msg.imageUrls?.length) {
          try {
            await this.zaloService.sendReaction(msg.rawMessage, Reactions.HEART);
          } catch {}
        }
      }
    }

    // 3. Lấy User Context của đúng phiên này (threadId:senderId) — không chồng chéo
    const userContext = this.userContextManager.getContext(
      batch.threadId, batch.senderId, batch.senderName
    );
    const userContextText = this.userContextManager.formatForPrompt(userContext);

    // 4. Lấy dữ liệu candidate hiện tại từ DB (read-only ở đây, chỉ Tool mới write)
    let candidateData: CandidateRecord =
      this.candidateRepo.getPendingCandidate(batch.threadId, batch.senderId) ||
      this.candidateRepo.getLatestCandidate(batch.threadId, batch.senderId) || {
        threadId: batch.threadId, senderId: batch.senderId, senderName: batch.senderName,
        imageUrls: allImageUrls, forwardedTo: config.hrRecipientId,
      };

    // 5. Gom nội dung text có timestamp và ngữ cảnh quote
    const textLines: string[] = [];
    let lastQuote: string | undefined;
    let lastQuoteSender: string | undefined;

    for (const msg of batch.messages) {
      if (msg.text) {
        const timeStr = this.aiService.formatTimestamp(msg.timestamp);
        if (msg.hasQuote && msg.quoteText) {
          const qSender = msg.quoteSenderName || (msg.quoteSenderId === config.hrRecipientId ? "Admin" : "Tin nhắn trước");
          textLines.push(`[Gửi lúc ${timeStr}]: (↪️ Trả lời [${qSender}]: "${msg.quoteText}") ${msg.text}`);
        } else {
          textLines.push(`[Gửi lúc ${timeStr}]: ${msg.text}`);
        }
      }
      if (msg.quoteText) { lastQuote = msg.quoteText; lastQuoteSender = msg.quoteSenderName; }
    }

    // Thêm thông tin CCCD vào text context
    if (cccdResult?.isCCCD) {
      if (cccdResult.cards && cccdResult.cards.length > 0) {
        const descList = cccdResult.cards.map(
          (c, idx) => `  [Ứng viên ${idx + 1}]: ${c.fullName || "Chưa rõ"}, CCCD: ${c.idNumber || "Chưa rõ"}, Giới tính: ${c.gender || "Chưa rõ"}, Ngày sinh: ${c.dob || "Chưa rõ"}`
        );
        textLines.push(`[Hệ thống OCR CCCD]: ${cccdResult.cards.length} người:\n${descList.join("\n")}`);
      } else {
        textLines.push(
          `[Hệ thống OCR CCCD]: Họ tên: ${cccdResult.fullName || "Chưa rõ"}, CCCD: ${cccdResult.idNumber || "Chưa rõ"}, Giới tính: ${cccdResult.gender || "Chưa rõ"}, Năm sinh: ${cccdResult.dob || "Chưa rõ"}.`
        );
      }
    }

    const formattedText = textLines.join("\n");
    if (!formattedText && allImageUrls.length === 0) return;

    console.log(`📥 [DM: "${batch.senderName}"] ${formattedText.length > 100 ? formattedText.slice(0, 100) + "..." : formattedText}`);

    // 6. Gọi AI generateReply — context hoàn toàn riêng theo threadId (không share)
    try {
      const aiReply = await this.aiService.generateReply(
        batch.threadId,
        batch.senderName,
        formattedText,
        {
          senderId: batch.senderId,
          isGroup: false,
          quoteContext: lastQuote,
          quoteSenderName: lastQuoteSender,
          imageUrls: allImageUrls.length > 0 ? allImageUrls : undefined,
          userContextText,
          onToolCall: async (toolName, args) => {
            const res = await this.toolExecutor.execute(toolName, args, {
              threadId: batch.threadId, senderId: batch.senderId,
              senderName: batch.senderName, userContext, candidateData,
            });
            candidateData = res.updatedCandidate;
            return res.result;
          },
        }
      );

      if (!aiReply?.trim()) {
        return;
      }

      console.log(`📤 [AI Reply ➔ ${batch.senderName}] "${aiReply.length > 120 ? aiReply.slice(0, 120) + "..." : aiReply}"`);

      // 7. Tách và gửi lần lượt các phần tin nhắn
      const messageParts = this.splitMessages(aiReply);
      for (let i = 0; i < messageParts.length; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, 800));
        await this.zaloService.sendMessage(batch.threadId, messageParts[i], batch.threadType);
      }
    } catch (error: unknown) {
      console.error("❌ Lỗi khi xử lý phản hồi AI:", error);
      try {
        await this.hrNotifier.notifySystemError({
          threadId: batch.threadId,
          senderName: batch.senderName,
          error: error instanceof Error ? error.message : String(error),
        });
      } catch (hrErr) {
        console.error("❌ Không thể gửi cảnh báo lỗi tới HR:", hrErr);
      }
    }
  }

  /**
   * Tách câu trả lời thành danh sách các tin nhắn ngắn riêng biệt theo ký hiệu |||
   */
  private splitMessages(text: string): string[] {
    if (!text?.trim()) return [];

    const stripHistoryPrefixes = (s: string): string =>
      s.replace(/\[\d{1,2}:\d{2}(?::\d{2})?\s[^\]]*\]\s*\[Bot\]:/g, "|||");

    const stripped = stripHistoryPrefixes(text);
    const normalized = stripped
      .replace(/\[\s*\|{2,}\s*\]/g, "|||")
      .replace(/\(\s*\|{2,}\s*\)/g, "|||")
      .replace(/\{\s*\|{2,}\s*\}/g, "|||")
      .replace(/\|{2,}/g, "|||");

    const cleanSnippet = (s: string): string =>
      s.trim()
        .replace(/^[\]\)\}>\s]+/, "")
        .replace(/[\[\(\{<\s]+$/, "")
        .trim();

    if (normalized.includes("|||")) {
      return normalized.split("|||").map(cleanSnippet).filter((s) => s.length > 0);
    }

    const parts = normalized.split(/\n\s*\n/).map(cleanSnippet).filter((s) => s.length > 0);
    if (parts.length > 1) return parts;

    const single = cleanSnippet(normalized);
    return single ? [single] : [];
  }
}

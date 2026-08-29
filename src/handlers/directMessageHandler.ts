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

    if (
      !parsedMessage.text &&
      !parsedMessage.mediaType &&
      (!parsedMessage.mediaUrls || parsedMessage.mediaUrls.length === 0)
    ) {
      return;
    }

    if (parsedMessage.mediaType === "photo" && parsedMessage.mediaUrls?.length) {
      console.log(`🖼️ [Ảnh Cá Nhân] Nhận ${parsedMessage.mediaUrls.length} hình ảnh từ ${senderInfo}`);
    }

    if (parsedMessage.mediaType === "voice" && parsedMessage.mediaUrls?.length) {
      console.log(`🎙️ [Tin Nhắn Thoại] Nhận ghi âm (${parsedMessage.mediaUrls[0].duration || 0}ms) từ ${senderInfo}`);
    }

    if (parsedMessage.mediaType === "sticker") {
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
      if (msg.mediaType === "sticker" && msg.mediaUrls?.[0]) {
        const item = msg.mediaUrls[0];
        console.log(`🏷️ [StickerService] Đang đọc hiểu ý nghĩa sticker từ [${batch.senderName}]...`);
        const stickerMeaning = await this.aiService.sticker.understandSticker(
          item.url,
          item.description
        );
        console.log(`✅ [Sticker AI] Ý nghĩa nhãn dán: "${stickerMeaning}"`);
        msg.text = `[🏷️ Sticker Emotion & Meaning]: "${stickerMeaning}"`;
        item.description = stickerMeaning;

        // Lưu/cập nhật bản ghi hoàn chỉnh với stickerUrl và ý nghĩa vào ChatHistory
        try {
          const msgId = String(msg.rawMessage?.data?.msgId || msg.rawMessage?.data?.cliMsgId || "");
          if (msgId) {
            this.chatHistoryRepo.updateMessageContentAndMedia(msgId, msg.text, [item]);
          } else {
            this.chatHistoryRepo.addMessage({
              threadId: batch.threadId,
              senderId: batch.senderId,
              senderName: batch.senderName,
              role: "user",
              content: msg.text,
              mediaType: "sticker",
              mediaUrls: [item],
              hasQuote: msg.hasQuote,
              quoteText: msg.quoteText,
              quoteSenderName: msg.quoteSenderName,
              quoteSenderId: msg.quoteSenderId,
              isGroup: false,
              timestamp: msg.timestamp,
            });
          }
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
      if (msg.mediaType === "voice" && msg.mediaUrls?.[0]?.url) {
        const item = msg.mediaUrls[0];
        console.log(`🎙️ [AudioService] Đang phiên âm tin nhắn thoại từ [${batch.senderName}]...`);
        const transcribedText = await this.aiService.audio.transcribeAudio(item.url, companyHints);
        console.log(`✅ [Audio STT] Phiên âm: "${transcribedText}"`);
        msg.text = `[🎙️ Voice Message Audio Transcription]: "${transcribedText}"`;
        item.description = transcribedText;

        // Lưu/cập nhật bản ghi hoàn chỉnh với nội dung STT và voiceUrl vào ChatHistory
        try {
          const msgId = String(msg.rawMessage?.data?.msgId || msg.rawMessage?.data?.cliMsgId || "");
          if (msgId) {
            this.chatHistoryRepo.updateMessageContentAndMedia(msgId, msg.text, [item]);
          } else {
            this.chatHistoryRepo.addMessage({
              threadId: batch.threadId,
              senderId: batch.senderId,
              senderName: batch.senderName,
              role: "user",
              content: msg.text,
              mediaType: "voice",
              mediaUrls: [item],
              hasQuote: msg.hasQuote,
              quoteText: msg.quoteText,
              quoteSenderName: msg.quoteSenderName,
              quoteSenderId: msg.quoteSenderId,
              isGroup: false,
              timestamp: msg.timestamp,
            });
          }
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
      if (msg.mediaType === "photo" && msg.mediaUrls) {
        for (const item of msg.mediaUrls) {
          if (item.url) allImageUrls.push(item.url);
        }
      }
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
        let cccdSummary = "";
        if (cccdResult.cards && cccdResult.cards.length > 0) {
          const cardDescriptions = cccdResult.cards.map(
            (c, idx) =>
              `[CCCD Card #${idx + 1}]: Full Name: ${c.fullName || "Unknown"}, ID Number: ${c.idNumber || "Unknown"}, Gender: ${c.gender || "Unknown"}, DOB: ${c.dob || "Unknown"}, Origin: ${c.homeTown || "Unknown"}, Residence: ${c.residence || "Unknown"}`
          );
          cccdSummary = `[Citizen ID Card (CCCD) Documents (${cccdResult.cards.length} persons)]: ${cardDescriptions.join("; ")}`;

          for (const card of cccdResult.cards) {
            console.log(`✅ [CCCD] ${card.fullName || "Chưa rõ"} - ${card.idNumber || "Chưa rõ"} (${card.imageUrls.length} ảnh)`);
            this.userContextManager.addOrUpdateCCCD(
              batch.threadId, batch.senderId, batch.senderName, card, card.imageUrls
            );
          }

          // Cập nhật description chi tiết của từng ảnh cụ thể vào SQLite
          const cards = cccdResult.cards;
          for (const msg of batch.messages) {
            if (msg.mediaType === "photo" && msg.mediaUrls) {
              const cardLines: string[] = [];
              msg.mediaUrls.forEach((item, imgIdx) => {
                const matchedCard = cards?.find((c) => c.imageUrls.includes(item.url));
                if (matchedCard) {
                  const cardDesc = `[Image #${imgIdx + 1} - CCCD Card]: Full Name: ${matchedCard.fullName || "Unknown"}, ID Number: ${matchedCard.idNumber || "Unknown"}, Gender: ${matchedCard.gender || "Unknown"}, DOB: ${matchedCard.dob || "Unknown"}, Origin: ${matchedCard.homeTown || "Unknown"}, Residence: ${matchedCard.residence || "Unknown"}`;
                  item.description = cardDesc;
                  cardLines.push(cardDesc);
                } else {
                  item.description = `[Image #${imgIdx + 1} - Attached CCCD Document]`;
                  cardLines.push(item.description);
                }
              });

              const summaryText = cardLines.join("\n");
              msg.text = msg.text ? `${msg.text}\n${summaryText}` : summaryText;
              const msgId = String(msg.rawMessage?.data?.msgId || msg.rawMessage?.data?.cliMsgId || "");
              if (msgId) {
                this.chatHistoryRepo.updateMessageContentAndMedia(msgId, msg.text, msg.mediaUrls);
              }
            }
          }
        } else {
          cccdSummary = `[Citizen ID Card (CCCD) Document]: Full Name: ${cccdResult.fullName || "Unknown"}, ID Number: ${cccdResult.idNumber || "Unknown"}, Gender: ${cccdResult.gender || "Unknown"}, DOB: ${cccdResult.dob || "Unknown"}, Origin: ${cccdResult.homeTown || "Unknown"}, Residence: ${cccdResult.residence || "Unknown"}`;

          console.log(`✅ [CCCD] ${cccdResult.fullName || "Chưa rõ"} - ${cccdResult.idNumber || "Chưa rõ"}`);
          this.userContextManager.addOrUpdateCCCD(
            batch.threadId, batch.senderId, batch.senderName, cccdResult, allImageUrls
          );

          for (const msg of batch.messages) {
            if (msg.mediaType === "photo" && msg.mediaUrls) {
              msg.mediaUrls.forEach((item, imgIdx) => {
                item.description = `[Image #${imgIdx + 1}]: ${cccdSummary}`;
              });
              msg.text = msg.text ? `${msg.text}\n${cccdSummary}` : cccdSummary;
              const msgId = String(msg.rawMessage?.data?.msgId || msg.rawMessage?.data?.cliMsgId || "");
              if (msgId) {
                this.chatHistoryRepo.updateMessageContentAndMedia(msgId, msg.text, msg.mediaUrls);
              }
            }
          }
        }
      } else {
        // Ảnh thông thường (không phải CCCD) -> Trích xuất description từ Vision AI nếu có
        const visionDesc = cccdResult?.description
          ? `[Image Content]: ${cccdResult.description}`
          : `[Attached Images (${allImageUrls.length} photos)]`;

        for (const msg of batch.messages) {
          if (msg.mediaType === "photo" && msg.mediaUrls) {
            if (!msg.text || !msg.text.trim()) {
              msg.text = visionDesc;
            } else if (cccdResult?.description && !msg.text.includes(cccdResult.description)) {
              msg.text = `${msg.text}\n${visionDesc}`;
            }
            msg.mediaUrls.forEach((item, imgIdx) => {
              if (!item.description) {
                item.description = `[Image #${imgIdx + 1}]: ${visionDesc}`;
              }
            });
            const msgId = String(msg.rawMessage?.data?.msgId || msg.rawMessage?.data?.cliMsgId || "");
            if (msgId) {
              this.chatHistoryRepo.updateMessageContentAndMedia(msgId, msg.text, msg.mediaUrls);
            }
          }
        }
      }

      // Thả tim xác nhận đã đọc ảnh
      for (const msg of batch.messages) {
        if (msg.rawMessage && msg.mediaType === "photo") {
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
    const allQuotedImageUrls: string[] = [];
    let lastQuote: string | undefined;
    let lastQuoteSender: string | undefined;

    for (const msg of batch.messages) {
      if (msg.hasQuote) {
        // Tra cứu tin nhắn gốc được trích dẫn trong database để khôi phục description và ảnh gốc
        const quotedMsg = this.chatHistoryRepo.findQuotedMessage(
          batch.threadId,
          msg.quoteData?.msgId,
          msg.quoteSenderId,
          msg.timestamp
        );

        if (quotedMsg) {
          if (quotedMsg.content && quotedMsg.content.trim()) {
            msg.quoteText = quotedMsg.content.trim();
          } else if (quotedMsg.mediaUrls?.[0]?.description) {
            msg.quoteText = quotedMsg.mediaUrls[0].description;
          }

          if (quotedMsg.mediaType === "photo" && quotedMsg.mediaUrls) {
            for (const item of quotedMsg.mediaUrls) {
              if (item.url && !allQuotedImageUrls.includes(item.url)) {
                allQuotedImageUrls.push(item.url);
              }
            }
          }
        }
      }

      if (msg.text) {
        const timeStr = this.aiService.formatTimestamp(msg.timestamp);
        if (msg.hasQuote && msg.quoteText) {
          const qSender = msg.quoteSenderName || (msg.quoteSenderId === config.hrRecipientId ? "Recruiter" : "Previous message");
          textLines.push(`[Sent at ${timeStr}]: (↪️ In reply to [${qSender}]: "${msg.quoteText}") ${msg.text}`);
        } else {
          textLines.push(`[Sent at ${timeStr}]: ${msg.text}`);
        }
      }
      if (msg.quoteText) {
        lastQuote = msg.quoteText;
        lastQuoteSender = msg.quoteSenderName;
      }
    }

    // Thêm thông tin CCCD vào text context nếu vừa phân tích
    if (cccdResult?.isCCCD) {
      if (cccdResult.cards && cccdResult.cards.length > 0) {
        const descList = cccdResult.cards.map(
          (c, idx) => `  [Candidate #${idx + 1}]: ${c.fullName || "Unknown"}, CCCD: ${c.idNumber || "Unknown"}, Gender: ${c.gender || "Unknown"}, DOB: ${c.dob || "Unknown"}`
        );
        textLines.push(`[System OCR CCCD Extraction]: ${cccdResult.cards.length} person(s):\n${descList.join("\n")}`);
      } else {
        textLines.push(
          `[System OCR CCCD Extraction]: Full Name: ${cccdResult.fullName || "Unknown"}, CCCD: ${cccdResult.idNumber || "Unknown"}, Gender: ${cccdResult.gender || "Unknown"}, DOB: ${cccdResult.dob || "Unknown"}.`
        );
      }
    }

    let formattedText = textLines.join("\n");
    if (!formattedText && allImageUrls.length > 0) {
      formattedText = "[Candidate attached image(s)]";
    }
    if (!formattedText && allImageUrls.length === 0) return;

    console.log(`📥 [DM: "${batch.senderName}"] ${formattedText.length > 100 ? formattedText.slice(0, 100) + "..." : formattedText}`);

    // 6. Gọi AI generateReply — truyền đầy đủ description, ảnh kèm theo và ảnh trích dẫn (Quoted Images)
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
          quotedImageUrls: allQuotedImageUrls.length > 0 ? allQuotedImageUrls : undefined,
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

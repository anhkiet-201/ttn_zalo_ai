import { type ParsedMessage, Reactions } from "../types/zalo.types.js";
import { type ZaloService } from "../services/zaloService.js";
import { type AIService } from "../services/aiService.js";
import { ThreadMetadataRepository } from "../database/index.js";
import { type RAGService } from "../services/ragService.js";
import { type HRNotifier } from "../services/hrNotifier.js";
import { GroupMessageBatcher } from "./groupMessageBatcher.js";
import { type GroupMessageBatch } from "./groupMessageBatcher.js";
import { config } from "../config/index.js";

/**
 * GroupMessageHandler: Chuyên trách xử lý tin nhắn từ các nhóm chat Zalo.
 * SRP: Debounce gom batch tin nhắn nhóm → gọi AI analyzeGroupBatch → cập nhật RAG → thông báo HR.
 * Không xử lý DM ứng viên cá nhân, không gọi Tool Executor.
 */
export class GroupMessageHandler {
  private readonly groupBatcher: GroupMessageBatcher;

  constructor(
    private readonly zaloService: ZaloService,
    private readonly aiService: AIService,
    private readonly ragService: RAGService,
    private readonly threadMetaRepo: ThreadMetadataRepository,
    private readonly hrNotifier?: HRNotifier
  ) {
    this.groupBatcher = new GroupMessageBatcher(
      async (batch) => this.processGroupBatch(batch),
      config.groupDebounceSeconds
    );
  }

  /**
   * Entry point: lọc và enqueue tin nhắn nhóm vào batcher
   */
  public async handle(parsedMessage: ParsedMessage): Promise<void> {
    const senderInfo = `${parsedMessage.senderName} (${parsedMessage.senderId})`;
    const groupInfo = parsedMessage.threadId;

    // Bỏ qua tin nhắn không có text, không có ảnh/voice/sticker
    if (
      !parsedMessage.text &&
      !parsedMessage.mediaType &&
      (!parsedMessage.mediaUrls || parsedMessage.mediaUrls.length === 0)
    ) {
      return;
    }

    // Bỏ qua ảnh nhóm — không có nội dung text để AI phân tích nghiệp vụ RAG
    if (parsedMessage.mediaType === "photo") {
      return;
    }

    // Lọc từ khóa nội bộ hoặc tin nhắn văn bản quá ngắn (bỏ qua im lặng)
    if (parsedMessage.text && parsedMessage.mediaType !== "sticker") {
      const lowerText = parsedMessage.text.toLowerCase().trim();
      const matchedKeyword = config.groupIgnoreKeywords.find((kw) => lowerText.includes(kw));
      if (matchedKeyword || lowerText.length < 25) {
        return;
      }
    }

    // Kiểm tra chế độ Manual (-M) của nhóm (bỏ qua im lặng)
    const isGroupManual = this.threadMetaRepo.isManual(groupInfo);
    const groupName = await this.zaloService.getGroupName(groupInfo);

    if (isGroupManual || groupName.startsWith("-M") || groupName.startsWith("-m")) {
      return;
    }

    const mediaLabel =
      parsedMessage.mediaType === "voice"  ? "[Tin nhắn thoại]"     :
      parsedMessage.mediaType === "sticker"? "[Nhãn dán / Sticker]" :
      "[Đính kèm]";
    const displayText = parsedMessage.text
      ? (parsedMessage.text.length > 80 ? parsedMessage.text.slice(0, 80) + "..." : parsedMessage.text)
      : mediaLabel;
    console.log(`👥 [Nhóm: "${groupName}"] ${senderInfo}: "${displayText}"`);

    this.groupBatcher.enqueue(parsedMessage, groupName);
  }

  // ── Batch processing ────────────────────────────────────────────────────

  /**
   * Callback sau debounce: gọi AI analyzeGroupBatch để phân tích và cập nhật RAG
   */
  private async processGroupBatch(batch: GroupMessageBatch): Promise<void> {
    // Đọc hiểu nhãn dán trong nhóm nếu có
    for (const msg of batch.messages) {
      if (msg.mediaType === "sticker" && msg.mediaUrls?.[0]) {
        const item = msg.mediaUrls[0];
        try {
          const meaning = await this.aiService.sticker.understandSticker(item.url, item.description);
          msg.text = `[Nhãn dán]: ${meaning}`;
        } catch {}
      }
    }

    // Phiên âm các tin nhắn thoại trong nhóm nếu có
    const companyHints = this.ragService.getCompanyHints();
    for (const msg of batch.messages) {
      if (msg.mediaType === "voice" && msg.mediaUrls?.[0]?.url) {
        const item = msg.mediaUrls[0];
        try {
          const transcribed = await this.aiService.audio.transcribeAudio(item.url, companyHints);
          msg.text = `[Tin nhắn thoại]: ${transcribed}`;
        } catch {}
      }
    }

    console.log(
      `🚀 [Nhóm-RAG] Đang phân tích ${batch.messages.length} tin nhắn từ nhóm: "${batch.groupName}"`
    );

    const hasUpdated = await this.aiService.analyzeGroupBatch(
      batch.groupName,
      batch.messages,
      this.ragService,
      this.hrNotifier
    );

    // Nếu RAG được cập nhật thành công → thả tim xác nhận
    if (hasUpdated) {
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
}

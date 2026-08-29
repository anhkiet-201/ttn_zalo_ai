import { type ParsedMessage, Reactions } from "../types/zalo.types.js";
import { type ZaloService } from "../services/zaloService.js";
import { type AIService } from "../services/aiService.js";
import { ThreadMetadataRepository } from "../database/index.js";
import { type RAGService } from "../services/ragService.js";
import { GroupMessageBatcher } from "./groupMessageBatcher.js";
import { type GroupMessageBatch } from "./groupMessageBatcher.js";
import { config } from "../config/index.js";

/**
 * GroupMessageHandler: Chuyên trách xử lý tin nhắn từ các nhóm chat Zalo.
 * SRP: Debounce gom batch tin nhắn nhóm → gọi AI analyzeGroupBatch → cập nhật RAG.
 * Không xử lý DM ứng viên cá nhân, không gọi Tool Executor.
 */
export class GroupMessageHandler {
  private readonly groupBatcher: GroupMessageBatcher;

  constructor(
    private readonly zaloService: ZaloService,
    private readonly aiService: AIService,
    private readonly ragService: RAGService,
    private readonly threadMetaRepo: ThreadMetadataRepository
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

    // Bỏ qua sticker / voice / reaction (text rỗng)
    if (!parsedMessage.text) return;

    // Lọc từ khóa nội bộ hoặc tin nhắn quá ngắn
    const lowerText = parsedMessage.text.toLowerCase().trim();
    const matchedKeyword = config.groupIgnoreKeywords.find((kw) => lowerText.includes(kw));
    if (matchedKeyword || lowerText.length < 25) {
      const reason = matchedKeyword
        ? `từ khóa "${matchedKeyword}"`
        : `độ dài ngắn (${lowerText.length} < 25 ký tự)`;
      console.log(`🚫 [Nhóm-Skip] Bỏ qua ${reason} từ ${senderInfo} trong nhóm [${groupInfo}]`);
      return;
    }

    // Kiểm tra chế độ Manual (-M) của nhóm
    const isGroupManual = this.threadMetaRepo.isManual(groupInfo);
    const groupName = await this.zaloService.getGroupName(groupInfo);

    if (isGroupManual || groupName.startsWith("-M") || groupName.startsWith("-m")) {
      console.log(`🛑 [Nhóm Thủ Công (-M)] Bỏ qua phân tích AI cho Nhóm [${groupName}]`);
      return;
    }

    console.log(`\n📥 [NHÓM CHAT 👥] Nhóm: "${groupName}" [${groupInfo}] | ${senderInfo}`);
    console.log(`💬 Nội dung: "${parsedMessage.text}"`);
    if (parsedMessage.hasQuote && parsedMessage.quoteText) {
      console.log(`   ↪️ Đang Reply trong nhóm: "${parsedMessage.quoteText}"`);
    }

    this.groupBatcher.enqueue(parsedMessage, groupName);
  }

  // ── Batch processing ────────────────────────────────────────────────────

  /**
   * Callback sau debounce: gọi AI analyzeGroupBatch để phân tích và cập nhật RAG
   */
  private async processGroupBatch(batch: GroupMessageBatch): Promise<void> {
    console.log(
      `\n🚀 [Nhóm-RAG] Phân tích ${batch.messages.length} tin nhắn từ nhóm: "${batch.groupName}" [${batch.threadId}]`
    );

    const hasUpdated = await this.aiService.analyzeGroupBatch(
      batch.groupName,
      batch.messages,
      this.ragService
    );

    // Nếu RAG được cập nhật thành công → thả tim xác nhận
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
}

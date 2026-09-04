import { type ParsedMessage } from "../types/zalo.types.js";
import { type ZaloService } from "../services/zaloService.js";
import { type AIService } from "../services/aiService.js";
import { CandidateRepository, ChatHistoryRepository, ThreadMetadataRepository } from "../database/index.js";
import { HRNotifier } from "../services/hrNotifier.js";
import { ToolExecutor } from "../services/toolExecutor.js";
import { RAGService } from "../services/ragService.js";
import { UserContextManager } from "../services/userContextManager.js";
import { config } from "../config/index.js";

import { HRMessageHandler } from "./hrMessageHandler.js";
import { DirectMessageHandler } from "./directMessageHandler.js";
import { GroupMessageHandler } from "./groupMessageHandler.js";

/**
 * MessageHandler: Router trung tâm — phân luồng tin nhắn đến đúng sub-handler.
 * SRP: Chỉ chịu trách nhiệm:
 *   1. Lưu tin nhắn vào lịch sử (cross-cutting concern)
 *   2. Phân luồng đến HRMessageHandler | DirectMessageHandler | GroupMessageHandler
 */
export class MessageHandler {
  private readonly chatHistoryRepo: ChatHistoryRepository;
  private readonly threadMetaRepo: ThreadMetadataRepository;

  private readonly hrHandler: HRMessageHandler;
  private readonly directHandler: DirectMessageHandler;
  private readonly groupHandler: GroupMessageHandler;

  constructor(
    private readonly zaloService: ZaloService,
    private readonly aiService: AIService,
    candidateRepo?: CandidateRepository,
    hrNotifier?: HRNotifier,
    toolExecutor?: ToolExecutor,
    userContextManager?: UserContextManager
  ) {
    const resolvedCandidateRepo = candidateRepo || new CandidateRepository();
    const resolvedHRNotifier = hrNotifier || new HRNotifier(this.zaloService);
    const resolvedUserCtxMgr = userContextManager || UserContextManager.getInstance();
    const resolvedToolExecutor =
      toolExecutor ||
      new ToolExecutor(resolvedCandidateRepo, resolvedHRNotifier, resolvedUserCtxMgr);

    this.chatHistoryRepo = new ChatHistoryRepository();
    this.threadMetaRepo = new ThreadMetadataRepository();

    const ragService = RAGService.getInstance();

    this.hrHandler = new HRMessageHandler(
      this.zaloService,
      this.aiService,
      ragService,
      resolvedCandidateRepo,
      this.chatHistoryRepo
    );

    this.directHandler = new DirectMessageHandler(
      this.zaloService,
      this.aiService,
      resolvedCandidateRepo,
      resolvedHRNotifier,
      resolvedToolExecutor,
      resolvedUserCtxMgr,
      this.threadMetaRepo,
      this.chatHistoryRepo
    );

    this.groupHandler = new GroupMessageHandler(
      this.zaloService,
      this.aiService,
      ragService,
      this.threadMetaRepo,
      resolvedHRNotifier
    );
  }

  /**
   * Entry point duy nhất: lưu lịch sử rồi phân luồng
   */
  public async handle(parsedMessage: ParsedMessage): Promise<void> {
    // 0. Lưu tin nhắn vào SQLite và kích hoạt SSE stream tới Web Chat
    await this.persistMessage(parsedMessage);

    // 1. Phân luồng đến đúng sub-handler
    if (parsedMessage.isSelf) {
      await this.hrHandler.handleOutgoing(parsedMessage);
    } else if (
      parsedMessage.threadId === config.hrRecipientId ||
      parsedMessage.senderId === config.hrRecipientId
    ) {
      await this.hrHandler.handle(parsedMessage);
    } else if (parsedMessage.isGroup) {
      await this.groupHandler.handle(parsedMessage);
    } else {
      await this.directHandler.handle(parsedMessage);
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private async persistMessage(parsedMessage: ParsedMessage): Promise<void> {
    if (
      !parsedMessage.text &&
      !parsedMessage.mediaType &&
      (!parsedMessage.mediaUrls || parsedMessage.mediaUrls.length === 0)
    ) {
      return;
    }

    try {
      this.chatHistoryRepo.addMessage({
        id: parsedMessage.id,
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
        content: parsedMessage.text || "",
        mediaType: parsedMessage.mediaType,
        mediaUrls: parsedMessage.mediaUrls,
        hasQuote: parsedMessage.hasQuote,
        quoteText: parsedMessage.quoteText,
        quoteSenderName: parsedMessage.quoteSenderName,
        quoteSenderId: parsedMessage.quoteSenderId,
        isGroup: parsedMessage.isGroup,
        timestamp: parsedMessage.timestamp || Date.now(),
      });
    } catch (err) {
      console.warn("⚠️ Không thể lưu tin nhắn vào chat_messages:", err);
    }
  }
}

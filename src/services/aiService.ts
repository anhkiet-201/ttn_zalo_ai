import { GoogleGenAI } from "@google/genai";
import { config } from "../config/index.js";
import { RAGService } from "./ragService.js";
import { ChatHistoryRepository } from "../database/index.js";
import { CCCDService } from "./cccdService.js";
import { ReplyService } from "./replyService.js";
import { GroupAnalysisService } from "./groupAnalysisService.js";
import { type HRNotifier } from "./hrNotifier.js";
import { type GroupQueuedMessage } from "../handlers/groupMessageBatcher.js";
import { type ZaloService } from "./zaloService.js";
import {
  type CCCDAnalysisResult,
  type GenerateReplyOptions,
  type RagUpdateReport,
} from "../types/ai.types.js";

// Re-export types để backward compatibility cho toàn bộ codebase
export {
  type CCCDCardResult,
  type CCCDAnalysisResult,
  type ToolExecutionHandler,
  type GenerateReplyOptions,
  type RagUpdateItemReport,
  type RagUpdateReport,
  recruitmentTools,
  groupRagTools,
} from "../types/ai.types.js";

/**
 * AIService: Gateway tích hợp AI tổng thể.
 * SRP: Quản lý vòng đời GoogleGenAI client và điều phối đến các sub-services chuyên biệt:
 *   - CCCDService: Xử lý OCR và trích xuất CCCD
 *   - ReplyService: Xử lý ngữ cảnh và sinh câu trả lời cho ứng viên/nhóm
 *   - GroupAnalysisService: Xử lý phân tích nhóm & cập nhật RAG
 */
export class AIService {
  private readonly ai: GoogleGenAI | null = null;
  private readonly ragService: RAGService;
  private readonly chatHistoryRepo: ChatHistoryRepository;

  private readonly cccdService: CCCDService;
  private readonly replyService: ReplyService;
  private readonly groupAnalysisService: GroupAnalysisService;

  constructor(
    ragService?: RAGService,
    chatHistoryRepo?: ChatHistoryRepository,
    zaloService?: ZaloService
  ) {
    this.ragService = ragService || RAGService.getInstance();
    this.chatHistoryRepo = chatHistoryRepo || new ChatHistoryRepository();

    if (config.geminiApiKey) {
      this.ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
      console.log(`🧠 [Gemini AI Gateway] Khởi tạo Model: ${config.geminiModel}`);
    } else {
      console.warn(
        "⚠️ [Gemini AI Gateway] Chưa cấu hình GEMINI_API_KEY trong file .env."
      );
    }

    // Dependency Injection cho các sub-services chuyên biệt
    this.cccdService = new CCCDService(this.ai);
    this.replyService = new ReplyService(
      this.ai,
      this.ragService,
      this.chatHistoryRepo,
      zaloService
    );
    this.groupAnalysisService = new GroupAnalysisService(this.ai);
  }

  public setZaloService(service: ZaloService): void {
    this.replyService.setZaloService(service);
  }

  public get rag(): RAGService {
    return this.ragService;
  }

  public get chatHistory(): ChatHistoryRepository {
    return this.chatHistoryRepo;
  }

  public isReady(): boolean {
    return Boolean(this.ai);
  }

  public formatTimestamp(ts?: number): string {
    return this.replyService.formatTimestamp(ts);
  }

  public getCurrentDateTimeContext(): string {
    return this.replyService.getCurrentDateTimeContext();
  }

  public clearHistory(threadId: string): void {
    this.chatHistoryRepo.clearHistory(threadId);
  }

  /** Delegate to CCCDService */
  public async analyzeCCCD(imageUrls: string[]): Promise<CCCDAnalysisResult | null> {
    return this.cccdService.analyzeCCCD(imageUrls);
  }

  /** Delegate to ReplyService */
  public async generateReply(
    threadId: string,
    senderName: string,
    userText: string,
    options?: GenerateReplyOptions
  ): Promise<string> {
    return this.replyService.generateReply(threadId, senderName, userText, options);
  }

  /** Delegate to GroupAnalysisService */
  public async analyzeGroupBatch(
    groupName: string,
    messages: GroupQueuedMessage[],
    ragService: RAGService,
    hrNotifier?: HRNotifier
  ): Promise<boolean> {
    return this.groupAnalysisService.analyzeGroupBatch(groupName, messages, ragService, hrNotifier);
  }

  /** Delegate to GroupAnalysisService */
  public async updateRagFromText(
    rawText: string,
    ragService: RAGService
  ): Promise<RagUpdateReport> {
    return this.groupAnalysisService.updateRagFromText(rawText, ragService);
  }
}

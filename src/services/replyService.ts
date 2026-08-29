import { GoogleGenAI, type Content, type Part } from "@google/genai";
import { config } from "../config/index.js";
import { buildSystemInstruction } from "../prompts/index.js";
import { type RAGService } from "./ragService.js";
import { type ChatHistoryRepository } from "../database/index.js";
import { downloadImageAsBase64 } from "./imageHelper.js";
import {
  type GenerateReplyOptions,
  type ChatContent,
  type ChatMessagePart,
  recruitmentTools,
} from "../types/ai.types.js";

import { type ZaloService, type BotProfile } from "./zaloService.js";

/**
 * ReplyService: Chuyên trách tạo phản hồi hội thoại bằng Gemini AI cho ứng viên (1-1) và nhóm chat.
 * SRP: Quản lý context hội thoại, system instructions, và tool calling loop cho tuyển dụng.
 * Mỗi threadId (phiên chat) hoàn toàn độc lập, không chia sẻ trạng thái in-memory.
 */
export class ReplyService {
  private readonly maxHistoryLength: number = 20;

  constructor(
    private readonly ai: GoogleGenAI | null,
    private readonly ragService: RAGService,
    private readonly chatHistoryRepo: ChatHistoryRepository,
    private zaloService?: ZaloService
  ) {}

  public setZaloService(service: ZaloService): void {
    this.zaloService = service;
  }

  /**
   * Định dạng thời gian theo chuẩn tiếng Việt (vd: "Thứ Năm, 27/08/2026 16:39:05")
   */
  public formatTimestamp(ts?: number): string {
    const date = ts ? new Date(ts) : new Date();
    return date.toLocaleString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      weekday: "long",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  /**
   * Cung cấp ngữ cảnh thời gian chi tiết (Hôm nay, Ngày mai, Ngày mốt, Thứ trong tuần)
   */
  public getCurrentDateTimeContext(): string {
    const now = new Date();
    const formatter = (d: Date) =>
      d.toLocaleDateString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        weekday: "long",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });

    const timeFormatter = (d: Date) =>
      d.toLocaleTimeString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const dayAfterTomorrow = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
    const threeDaysLater = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    return `📅 THỜI GIAN THỰC HỆ THỐNG:
• Bây giờ là: ${timeFormatter(now)}
• Hôm nay là: ${formatter(now)}
• Ngày mai là: ${formatter(tomorrow)}
• Ngày mốt (2 ngày nữa) là: ${formatter(dayAfterTomorrow)}
• 3 ngày nữa là: ${formatter(threeDaysLater)}`;
  }

  /**
   * Sinh câu trả lời tự động dựa trên câu hỏi người dùng và tri thức RAG từ SQLite Database
   */
  public async generateReply(
    threadId: string,
    senderName: string,
    userText: string,
    options?: GenerateReplyOptions
  ): Promise<string> {
    if (!this.ai) {
      console.warn("⚠️ [ReplyService] Bot chưa được cấu hình GEMINI_API_KEY. Dừng phản hồi.");
      return "";
    }

    try {
      const isGroup = options?.isGroup ?? false;
      const senderId = options?.senderId || "";
      const quoteContext = options?.quoteContext;
      const quoteSenderName = options?.quoteSenderName;
      const imageUrls = options?.imageUrls || [];
      const userContextText = options?.userContextText || "";

      // 1. Lấy toàn bộ kho tri thức RAG
      const ragContext = this.ragService.buildPromptContext();

      // 2. Lấy 20 lượt lịch sử hội thoại gần nhất của đúng threadId này
      const dbRecords = this.chatHistoryRepo.getRecentHistory(
        threadId,
        this.maxHistoryLength
      );

      const history: ChatContent[] = dbRecords.map((rec) => {
        const timeStr = this.formatTimestamp(rec.timestamp);
        let resolvedName = rec.senderName || "";
        if (rec.role === "user") {
          if (!isGroup) {
            resolvedName = senderName || resolvedName || "Candidate";
          } else {
            if (rec.senderId === senderId && senderName) {
              resolvedName = senderName;
            } else if (!resolvedName) {
              resolvedName = `Member ${rec.senderId}`;
            }
          }
        }

        const prefix =
          rec.role === "user"
            ? isGroup
              ? `[${timeStr}] [Group Member: ${resolvedName}]`
              : `[${timeStr}] [Candidate: ${resolvedName}]`
            : `[${timeStr}] [Recruiter / Bot]`;

        let msgBody = rec.content;

        // Nếu msgBody rỗng, kiểm tra xem có media không và trích xuất description
        if (!msgBody || !msgBody.trim()) {
          if (rec.mediaUrls && rec.mediaUrls.length > 0) {
            const firstDesc = rec.mediaUrls[0]?.description;
            if (firstDesc) {
              msgBody = firstDesc;
            } else if (rec.mediaType === "photo") {
              msgBody = `[Attached Images (${rec.mediaUrls.length} photos)]`;
            } else if (rec.mediaType === "voice") {
              msgBody = `[Voice Message Audio]`;
            } else if (rec.mediaType === "sticker") {
              msgBody = `[Sticker]`;
            }
          }
        }

        // Bổ sung mô tả chi tiết nếu có mediaUrls chứa description chưa nằm trong msgBody
        if (rec.mediaUrls && rec.mediaUrls.length > 0) {
          const descriptions = rec.mediaUrls
            .map((m) => m.description)
            .filter((d): d is string => Boolean(d && d.trim()));
          if (descriptions.length > 0 && !descriptions.some((d) => msgBody.includes(d))) {
            msgBody += ` (Details: ${descriptions.join("; ")})`;
          }
        }

        if (rec.hasQuote && rec.quoteText) {
          const qSender = rec.quoteSenderName || (rec.quoteSenderId === config.hrRecipientId ? "Recruiter" : "Previous message");
          msgBody = `(↪️ In reply to [${qSender}]: "${rec.quoteText}") ${msgBody}`;
        }

        return {
          role: rec.role,
          parts: [{ text: `${prefix}: ${msgBody}` }],
        };
      });

      // 3. Chuẩn bị nội dung câu hỏi kèm thời gian hiện tại
      const timeContext = this.getCurrentDateTimeContext();
      const currentTimeStr = this.formatTimestamp();
      const senderHeader = isGroup
        ? `[Group Member: ${senderName} (ID: ${senderId})]`
        : `[Candidate: ${senderName}]`;

      let promptText = `[${currentTimeStr}] ${senderHeader}:\n${userText}`;
      if (quoteContext && !userText.includes("↪️")) {
        const qSender = quoteSenderName || "Previous message";
        promptText = `[↪️ In reply to message from [${qSender}]: "${quoteContext}"]\n${promptText}`;
      }

      const userParts: ChatMessagePart[] = [{ text: promptText }];
      const quotedImageUrls = options?.quotedImageUrls || [];

      // Tải song song tất cả các hình ảnh gửi kèm hoặc được trích dẫn (Quote) nếu có
      if (imageUrls.length > 0 || quotedImageUrls.length > 0) {
        if (imageUrls.length > 0) {
          console.log(`🖼️ [ReplyService] Đang tải song song ${imageUrls.length} hình ảnh gửi kèm...`);
          const downloadResults = await Promise.all(
            imageUrls.map((url) => downloadImageAsBase64(url))
          );

          downloadResults.forEach((imgData, idx) => {
            if (imgData) {
              userParts.push({
                text: `[Attached Image #${idx + 1}]:`,
              });
              userParts.push({
                inlineData: {
                  mimeType: imgData.mimeType,
                  data: imgData.data,
                },
              });
            }
          });
        }

        if (quotedImageUrls.length > 0) {
          console.log(`🖼️ [ReplyService] Đang tải song song ${quotedImageUrls.length} hình ảnh được trích dẫn (Quote)...`);
          const quotedDownloadResults = await Promise.all(
            quotedImageUrls.map((url) => downloadImageAsBase64(url))
          );

          quotedDownloadResults.forEach((imgData, idx) => {
            if (imgData) {
              userParts.push({
                text: `[Quoted Image via Reply #${idx + 1}]:`,
              });
              userParts.push({
                inlineData: {
                  mimeType: imgData.mimeType,
                  data: imgData.data,
                },
              });
            }
          });
        }
      }

      const userContent: ChatContent = {
        role: "user",
        parts: userParts,
      };

      // 4. System Instruction chuẩn: Thời gian thực + Hướng dẫn nhân cách (từ Zalo Session) + User Context + RAG
      const botProfile: BotProfile = (await this.zaloService?.getBotProfile()) || {
        displayName: "",
        gender: "female",
        age: 22,
      };

      const systemInstruction = buildSystemInstruction({
        displayName: botProfile.displayName,
        gender: botProfile.gender,
        age: botProfile.age,
      });

      let fullSystemInstruction = `[${timeContext}]\n\n${systemInstruction}`;
      if (userContextText) {
        fullSystemInstruction += `\n\n${userContextText}`;
      }
      fullSystemInstruction += `\n\n--- BEGIN RAG CONTEXT (KNOWLEDGE BASE) ---\n${ragContext}\n--- END RAG CONTEXT ---`;
      const contents: Content[] = [...history, userContent];

      const timeoutMs = 45000;
      const generateWithTimeout = (payload: any) =>
        Promise.race([
          this.ai!.models.generateContent(payload),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Timeout (${timeoutMs}ms) khi gọi Gemini AI`)),
              timeoutMs
            )
          ),
        ]);

      let response = await generateWithTimeout({
        model: config.geminiModel,
        contents,
        config: {
          systemInstruction: fullSystemInstruction,
          tools: [{ functionDeclarations: recruitmentTools }],
        },
      });

      // 5. Vòng lặp xử lý Function Calls khi AI quyết định gọi Tool
      let turns = 0;
      while (response.functionCalls && response.functionCalls.length > 0 && turns < 3) {
        turns++;
        const functionCalls = response.functionCalls;
        const callsSummary = functionCalls.map(c => `${c.name}(${JSON.stringify(c.args)})`).join(", ");
        console.log(`🛠️ [Tool Call] ${callsSummary}`);

        const modelContent = response.candidates?.[0]?.content;
        if (modelContent) {
          contents.push(modelContent);
        }

        const functionResponseParts: Part[] = [];
        for (const call of functionCalls) {
          const functionName = call.name || "unknown_tool";
          let toolResult: Record<string, any> = { success: true };
          if (options?.onToolCall) {
            try {
              toolResult = await options.onToolCall(
                functionName,
                (call.args as Record<string, any>) || {}
              );
            } catch (err: any) {
              console.error(`❌ Lỗi thực thi tool [${functionName}]:`, err);
              toolResult = { success: false, error: err.message };
            }
          }

          functionResponseParts.push({
            functionResponse: {
              name: functionName,
              response: toolResult,
            },
          });
        }

        contents.push({
          role: "user",
          parts: functionResponseParts,
        });

        response = await generateWithTimeout({
          model: config.geminiModel,
          contents,
          config: {
            systemInstruction: fullSystemInstruction,
            tools: [{ functionDeclarations: recruitmentTools }],
          },
        });
      }

      const replyText = response.text?.trim() || "";
      if (!replyText) {
        console.warn("⚠️ [ReplyService] Phản hồi từ mô hình AI bị rỗng. Dừng phản hồi.");
        return "";
      }

      // 6. Dọn dẹp tin nhắn quá cũ của thread này
      this.chatHistoryRepo.cleanupOldMessages(threadId, 50);

      return replyText;
    } catch (error) {
      console.error("❌ [ReplyService] Gặp lỗi khi tạo câu trả lời:", error);
      throw error;
    }
  }
}

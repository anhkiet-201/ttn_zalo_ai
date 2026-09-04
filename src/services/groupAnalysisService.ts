import { GoogleGenAI, type Content, type Part } from "@google/genai";
import { config } from "../config/index.js";
import { type RAGService, type RagUpdateArgs, consolidateJobRawContent } from "./ragService.js";
import { type HRNotifier } from "./hrNotifier.js";
import { type GroupQueuedMessage } from "../handlers/groupMessageBatcher.js";
import {
  type RagUpdateReport,
  type RagUpdateItemReport,
  groupRagTools,
} from "../types/ai.types.js";
import {
  buildGroupAnalysisSystemInstruction,
  buildGroupAnalysisUserPrompt,
  buildHrRagUpdateSystemInstruction,
  buildHrRagUpdateUserPrompt,
} from "../prompts/index.js";

/**
 * GroupAnalysisService: Chuyên trách phân tích tin nhắn nhóm & văn bản HR để cập nhật cơ sở tri thức RAG.
 * SRP: Chỉ xử lý AI Tool Calling liên quan đến update_rag và phân loại dữ liệu RAG.
 */
export class GroupAnalysisService {
  constructor(private readonly ai: GoogleGenAI | null) {}

  /**
   * Kết hợp bài viết tuyển dụng hiện tại trong RAG với thông tin cập nhật mới để tạo thành bài viết mới hoàn chỉnh.
   * Sử dụng Gemini AI và fallback về hàm consolidateJobRawContent nếu AI gặp sự cố.
   */
  public async synthesizeJobAnnouncement(
    currentRaw: string,
    newUpdateText: string,
    updatedFields: Record<string, unknown> = {}
  ): Promise<string> {
    const fallbackResult = consolidateJobRawContent(currentRaw, newUpdateText, updatedFields);

    if (!this.ai) {
      return fallbackResult;
    }

    try {
      const prompt =
        `You are an expert recruitment senior editor for factory and blue-collar labor in Binh Duong, Vietnam.\n` +
        `TASK: Synthesize the [EXISTING RECRUITMENT POST] according strictly to the [HR INSTRUCTION / UPDATE] into A SINGLE, COHESIVE, COMPLETE, AND ACCURATE NEW JOB POST IN VIETNAMESE.\n\n` +
        `[EXISTING RECRUITMENT POST IN RAG KNOWLEDGE BASE]:\n${currentRaw}\n\n` +
        `[HR INSTRUCTION / UPDATE]:\n${newUpdateText}\n\n` +
        `MANDATORY EDITING RULES (SENIOR EDITOR STANDARDS):\n` +
        `1. OMISSION MEANS REMOVAL (NHỮNG THỨ KHÔNG ĐỀ CẬP TỨC LÀ CẦN LOẠI BỎ TRIỆT ĐỂ):\n` +
        `   - When HR specifies a revised requirement (documents, CCCD/ID card, attire, age, etc.), any previous options, alternative documents, or conditions in the existing post that are NOT mentioned in the HR instruction MUST BE COMPLETELY REMOVED.\n` +
        `   - Specific Example: If existing post has "Yêu cầu: CCCD gốc hoặc photo, hoặc hình chụp trong điện thoại", and HR instructs "chỉ chấp nhận CCCD gốc" (or "phải có CCCD gốc") -> The revised line MUST BE: "Yêu cầu: Chỉ chấp nhận CCCD gốc" (or "CCCD gốc"). The phrases "hoặc photo", "hình chụp trong điện thoại" MUST BE PURGED COMPLETELY.\n` +
        `2. ABSOLUTE BAN ON LOOPING NEGATIONS (CẤM PHỦ ĐỊNH LUẨN QUẨN):\n` +
        `   - NEVER preserve an obsolete requirement and invert it into a confusing negative phrase like "(bắt buộc, không bắt buộc photo hay hình chụp)", "(bắt buộc không nhận photo)", etc. Only output clean, affirmative rules as instructed by HR.\n` +
        `3. REMOVAL INSTRUCTION (LỆNH XÓA CÂU CHỮ / DÒNG LƯU Ý):\n` +
        `   - If HR asks to delete, remove, or drop a specific phrase, sentence, or note (e.g., 'xóa (bắt buộc, không bắt buộc photo hay hình chụp) trong...', 'xóa dòng lưu ý...'), DELETE that exact phrase/sentence entirely from the post without leaving any trace.\n` +
        `4. ZERO HALLUCINATION (CẤM TỰ BỊA):\n` +
        `   - Strictly forbidden to fabricate alternative documents, photo allowances, or requirements not explicitly specified by HR.\n` +
        `5. PRESERVE FOUNDATIONAL DETAILS:\n` +
        `   - Company address, Google Maps link ("- Bản đồ/Vị trí: https://..."), salary rates for day/night/overtime shifts, allowances, meal support (bao cơm), and work conditions MUST BE PRESERVED unless HR specifically changes them.\n` +
        `6. SYNCHRONIZE HIRING STATUS:\n` +
        `   - If the update states they are hiring or resuming onboarding, REMOVE all phrases like '(HIỆN TẠI TẠM NGƯNG TUYỂN)' or '0 người', and set to actively hiring. If the update states hiring is paused completely, update status accordingly.\n` +
        `   - Gender-Specific Hiring (CRITICAL): If the update states 'chỉ nhận nam, không nhận nữ' / 'đã đủ nữ, chỉ nhận nam', the company IS ACTIVELY HIRING (do NOT mark as temporarily stopped; update to actively hiring men and pausing women, e.g., '- Số lượng cần tuyển: Đang tuyển Nam (đã đủ nữ, tạm ngưng Nữ)'). Vice versa, if 'chỉ nhận nữ, không nhận nam' / 'đã đủ nam, chỉ nhận nữ', mark as actively hiring women and pausing men.\n` +
        `7. STRICTLY FORBIDDEN to use the prefix '[Cập nhật]:'. NEVER simply concatenate old text with new text. NEVER duplicate sections or paragraphs.\n` +
        `8. STRICTLY FORBIDDEN to use decorative icons or emojis (such as 🚨, 🔥, 🆙, 📌, ⏰, 👥, 💰, 📍...). Format the post professionally with standard dash bullets ('-').\n` +
        `9. Output language MUST be Vietnamese. Return ONLY the final synthesized job post without any introduction, explanations, or conversational filler.`;

      const response = await this.ai.models.generateContent({
        model: config.geminiModel,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });

      let text = response.text ? response.text.trim() : "";
      if (text && text.length > 50) {
        text = text.replace(/\[Cập nhật\]:\s*/gi, "").trim();
        const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E0}-\u{1F1FF}]/gu;
        text = text.replace(emojiRegex, "").trim();
        return text;
      }
      return fallbackResult;
    } catch (err) {
      console.warn("⚠️ [GroupAnalysisService] Lỗi khi AI tổng hợp bài viết mới, dùng fallback:", err);
      return fallbackResult;
    }
  }

  /**
   * Phân tích batch tin nhắn nhóm bằng Gemini Tool Calling.
   * Nếu AI phát hiện thông tin nghiệp vụ → fire tool call "update_rag" → ragService.executeRagUpdate().
   * Tự động gửi thông báo chi tiết sang HR_RECIPIENT_ID qua hrNotifier.
   */
  public async analyzeGroupBatch(
    groupName: string,
    messages: GroupQueuedMessage[],
    ragService: RAGService,
    hrNotifier?: HRNotifier
  ): Promise<boolean> {
    if (!this.ai) {
      console.warn("⚠️ [GroupAnalysisService] Gemini AI chưa được cấu hình, bỏ qua phân tích nhóm.");
      return false;
    }
    if (messages.length === 0) return false;

    // 1. Đọc Bảng danh mục tra cứu tóm tắt ID và thông tin cốt lõi
    const directoryIndex = ragService.buildDirectoryIndex();

    // 2. Build prompt từ danh sách tin nhắn
    const timeFormatter = (ts: number) =>
      new Date(ts).toLocaleTimeString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        hour: "2-digit",
        minute: "2-digit",
      });

    const messagesText = messages
      .map((m) => `[${timeFormatter(m.timestamp)}] ${m.senderName}: ${m.text}`)
      .join("\n");

    const systemInstruction = buildGroupAnalysisSystemInstruction(groupName);
    const userPrompt = buildGroupAnalysisUserPrompt(groupName, messagesText, directoryIndex);

    const contents: Content[] = [{ role: "user", parts: [{ text: userPrompt }] }];

    console.log(`\n🔍 [GroupAnalysisService] Phân tích ${messages.length} tin nhắn từ nhóm "${groupName}"...`);

    let updatedCount = 0;

    try {
      const timeoutMs = 45000;
      const generateWithTimeout = (payload: any) =>
        Promise.race([
          this.ai!.models.generateContent(payload),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Timeout (${timeoutMs}ms) khi phân tích tin nhắn nhóm`)),
              timeoutMs
            )
          ),
        ]);

      let response = await generateWithTimeout({
        model: config.geminiModel,
        contents,
        config: {
          systemInstruction,
          tools: [{ functionDeclarations: groupRagTools }],
        },
      });

      let turns = 0;
      while (response.functionCalls && response.functionCalls.length > 0 && turns < 5) {
        turns++;
        const functionCalls = response.functionCalls;
        const callsSummary = functionCalls.map((c) => `${c.name}(${JSON.stringify(c.args)})`).join(", ");
        console.log(`🛠️ [Group RAG Tool] ${callsSummary}`);

        const modelContent = response.candidates?.[0]?.content;
        if (modelContent) {
          contents.push(modelContent);
        }

        const functionResponseParts: Part[] = [];
        for (const call of functionCalls) {
          if (call.name === "delete_rag") {
            const args = (call.args as unknown) as {
              targetFile?: string;
              targetId?: string;
              keyword?: string;
              reason?: string;
            };
            const deleteRes = ragService.deleteRagEntry(args);
            if (deleteRes.success) {
              updatedCount += deleteRes.deletedItems.length;
            }

            functionResponseParts.push({
              functionResponse: {
                name: "delete_rag",
                response: {
                  success: deleteRes.success,
                  message: deleteRes.message,
                  deletedItems: deleteRes.deletedItems,
                },
              },
            });
            continue;
          }

          if (call.name !== "update_rag") continue;

          const args = (call.args as unknown) as RagUpdateArgs;

          // Kết hợp tin tuyển hiện tại với cập nhật mới để tạo bài viết mới hoàn chỉnh
          if (args.action === "update_existing" && args.targetFile === "job_rag" && args.targetId) {
            const existingEntry = ragService.getEntryById(args.targetFile, args.targetId);
            if (existingEntry) {
              const currentRaw = (existingEntry["raw_content"] as string) || "";
              const updateSnippet =
                (args.updatedFields?.raw_content as string) ||
                (args.newEntry?.raw_content as string) ||
                (args.reason as string) ||
                "";

              if (currentRaw && updateSnippet) {
                const synthesized = await this.synthesizeJobAnnouncement(
                  currentRaw,
                  updateSnippet,
                  args.updatedFields || {}
                );
                if (!args.updatedFields) args.updatedFields = {};
                args.updatedFields.raw_content = synthesized;
              }
            }
          }

          const result = ragService.executeRagUpdate(args);
          if (result.success) {
            updatedCount++;

            // Gửi thông báo tự động tới HR_RECIPIENT_ID
            if (hrNotifier) {
              const currentEntry = result.entry || args.newEntry || args.updatedFields || {};
              const title =
                (currentEntry["title"] as string) ||
                (args.newEntry?.title as string) ||
                (args.updatedFields?.title as string) ||
                args.targetId ||
                "Không rõ";

              const targetId = (currentEntry["id"] as string) || args.targetId;
              const actualAction =
                args.action === "update_existing" || (result.message && result.message.includes("Merge"))
                  ? "update_existing"
                  : args.action;

              await hrNotifier.notifyRagUpdate({
                groupName,
                action: actualAction,
                targetFile: `${args.targetFile}.json`,
                targetId,
                title,
                reason: args.reason,
                message: result.message,
                updatedFields: args.updatedFields,
                newEntry: args.newEntry,
                entry: result.entry,
                rawContent: (result.entry?.raw_content || args.updatedFields?.raw_content || args.newEntry?.raw_content) as string | undefined,
              });
            }
          }

          functionResponseParts.push({
            functionResponse: {
              name: "update_rag",
              response: { success: result.success, message: result.message },
            },
          });
        }

        if (functionResponseParts.length === 0) break;

        contents.push({ role: "user", parts: functionResponseParts });

        response = await generateWithTimeout({
          model: config.geminiModel,
          contents,
          config: {
            systemInstruction,
            tools: [{ functionDeclarations: groupRagTools }],
          },
        });
      }

      if (turns === 0) {
        const textResp = response.text?.trim();
        if (textResp) {
          console.log(`⏭️ [GroupAnalysisService] AI không gọi tool mà phản hồi text: "${textResp}"`);
        } else {
          console.log(`⏭️ [GroupAnalysisService] Không phát hiện thông tin nghiệp vụ, bỏ qua.`);
        }
      } else {
        console.log(`✅ [GroupAnalysisService] Hoàn tất — cập nhật thành công ${updatedCount} mục RAG.`);
      }

      return updatedCount > 0;
    } catch (error) {
      console.error("❌ [GroupAnalysisService] Lỗi khi phân tích tin nhắn nhóm:", error);
      return false;
    }
  }

  /**
   * Phân tích văn bản nội dung từ HR, tự động phân loại và gọi tool update_rag để cập nhật RAG.
   */
  public async updateRagFromText(
    rawText: string,
    ragService: RAGService
  ): Promise<RagUpdateReport> {
    if (!this.ai) {
      return {
        success: false,
        message: "Bot chưa được cấu hình GEMINI_API_KEY.",
        updatedCount: 0,
        items: [],
      };
    }

    const directoryIndex = ragService.buildDirectoryIndex();

    const systemInstruction = buildHrRagUpdateSystemInstruction();
    const userPrompt = buildHrRagUpdateUserPrompt(rawText, directoryIndex);

    const contents: Content[] = [{ role: "user", parts: [{ text: userPrompt }] }];

    console.log(`\n🔍 [GroupAnalysisService] Đang phân tích văn bản RAG từ HR...`);

    const items: RagUpdateItemReport[] = [];

    try {
      const timeoutMs = 45000;
      const generateWithTimeout = (payload: any) =>
        Promise.race([
          this.ai!.models.generateContent(payload),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Timeout (${timeoutMs}ms) khi cập nhật RAG từ văn bản HR`)),
              timeoutMs
            )
          ),
        ]);

      let response = await generateWithTimeout({
        model: config.geminiModel,
        contents,
        config: {
          systemInstruction,
          tools: [{ functionDeclarations: groupRagTools }],
        },
      });

      let turns = 0;
      while (response.functionCalls && response.functionCalls.length > 0 && turns < 5) {
        turns++;
        const functionCalls = response.functionCalls;
        const callsSummary = functionCalls.map((c) => `${c.name}(${JSON.stringify(c.args)})`).join(", ");
        console.log(`🛠️ [HR RAG Tool] ${callsSummary}`);

        const modelContent = response.candidates?.[0]?.content;
        if (modelContent) {
          contents.push(modelContent);
        }

        const functionResponseParts: Part[] = [];
        for (const call of functionCalls) {
          if (call.name === "delete_rag") {
            const args = (call.args as unknown) as {
              targetFile?: string;
              targetId?: string;
              keyword?: string;
              reason?: string;
            };
            const deleteRes = ragService.deleteRagEntry(args);
            if (deleteRes.success && deleteRes.deletedItems.length > 0) {
              for (const it of deleteRes.deletedItems) {
                items.push({
                  targetFile: it.targetFile,
                  action: "delete",
                  targetId: it.id,
                  title: it.title,
                  reason: args.reason,
                  summary: `Đã xóa "${it.title}" (ID: ${it.id})`,
                  success: true,
                  message: deleteRes.message,
                });
              }
            } else {
              items.push({
                targetFile: `${args.targetFile || "job_rag"}.json`,
                action: "delete",
                targetId: args.targetId,
                title: args.keyword || args.targetId || "Dữ liệu RAG",
                reason: args.reason,
                summary: `Xóa thất bại`,
                success: false,
                message: deleteRes.message,
              });
            }

            functionResponseParts.push({
              functionResponse: {
                name: "delete_rag",
                response: {
                  success: deleteRes.success,
                  message: deleteRes.message,
                  deletedItems: deleteRes.deletedItems,
                },
              },
            });
            continue;
          }

          if (call.name !== "update_rag") continue;

          const args = (call.args as unknown) as RagUpdateArgs;

          // Kết hợp tin tuyển hiện tại với chỉ đạo gốc từ HR để tạo bài viết mới hoàn chỉnh
          if (args.action === "update_existing" && args.targetFile === "job_rag" && args.targetId) {
            const existingEntry = ragService.getEntryById(args.targetFile, args.targetId);
            if (existingEntry) {
              const currentRaw = (existingEntry["raw_content"] as string) || "";
              // Ưu tiên câu chỉ đạo gốc của HR (rawText) để AI đối chiếu trực tiếp với bài cũ
              const updateSnippet =
                rawText ||
                (args.updatedFields?.raw_content as string) ||
                (args.newEntry?.raw_content as string) ||
                (args.reason as string) ||
                "";

              if (currentRaw && updateSnippet) {
                const synthesized = await this.synthesizeJobAnnouncement(
                  currentRaw,
                  updateSnippet,
                  args.updatedFields || {}
                );
                if (!args.updatedFields) args.updatedFields = {};
                args.updatedFields.raw_content = synthesized;
              }
            }
          }

          const result = ragService.executeRagUpdate(args);
          const currentEntry = result.entry || args.newEntry || args.updatedFields || {};

          const title =
            (currentEntry["title"] as string) ||
            (args.newEntry?.title as string) ||
            (args.updatedFields?.title as string) ||
            args.targetId ||
            "Không rõ";

          const targetId = (currentEntry["id"] as string) || args.targetId;
          const actualAction =
            args.action === "update_existing" || (result.message && result.message.includes("Merge"))
              ? "update_existing"
              : args.action;

          let summary = "";
          if (actualAction === "create_new" || (result.entry && !args.targetId)) {
            summary = `Tạo mới "${title}" (ID: ${targetId || "Mới"})`;
          } else {
            summary = `Cập nhật "${title}" (ID: ${targetId})`;
          }

          items.push({
            targetFile: `${args.targetFile}.json`,
            action: actualAction,
            targetId,
            title,
            reason: args.reason,
            entry: result.entry,
            summary,
            success: result.success,
            message: result.message,
          });

          functionResponseParts.push({
            functionResponse: {
              name: "update_rag",
              response: { success: result.success, message: result.message },
            },
          });
        }

        if (functionResponseParts.length === 0) break;

        contents.push({ role: "user", parts: functionResponseParts });

        response = await generateWithTimeout({
          model: config.geminiModel,
          contents,
          config: {
            systemInstruction,
            tools: [{ functionDeclarations: groupRagTools }],
          },
        });
      }

      const successfulCount = items.filter((i) => i.success).length;

      return {
        success: successfulCount > 0,
        message:
          successfulCount > 0
            ? `Đã xử lý thành công ${successfulCount} mục trong cơ sở dữ liệu RAG.`
            : items.length > 0 && items[0].message
            ? items[0].message
            : "Không trích xuất hoặc cập nhật được dữ liệu nào.",
        updatedCount: successfulCount,
        items,
      };
    } catch (error: any) {
      console.error("❌ [GroupAnalysisService] Lỗi khi cập nhật RAG từ HR:", error);
      return {
        success: false,
        message: error?.message || String(error),
        updatedCount: 0,
        items,
      };
    }
  }
}

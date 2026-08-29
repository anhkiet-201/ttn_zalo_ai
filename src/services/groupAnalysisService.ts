import { GoogleGenAI, type Content, type Part } from "@google/genai";
import { config } from "../config/index.js";
import { type RAGService, type RagUpdateArgs } from "./ragService.js";
import { type HRNotifier } from "./hrNotifier.js";
import { type GroupQueuedMessage } from "../handlers/groupMessageBatcher.js";
import {
  type RagUpdateReport,
  type RagUpdateItemReport,
  groupRagTools,
} from "../types/ai.types.js";

/**
 * GroupAnalysisService: Chuyên trách phân tích tin nhắn nhóm & văn bản HR để cập nhật cơ sở tri thức RAG.
 * SRP: Chỉ xử lý AI Tool Calling liên quan đến update_rag và phân loại dữ liệu RAG.
 */
export class GroupAnalysisService {
  constructor(private readonly ai: GoogleGenAI | null) {}

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

    // 1. Đọc RAG context hiện tại để AI biết các entry id đã tồn tại
    const ragContext = ragService.buildPromptContext();

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

    const systemInstruction =
      `Bạn là AI chuyên trách tự động phân tích tin nhắn nhóm Zalo nội bộ để cập nhật cơ sở dữ liệu tuyển dụng (RAG) qua tool call 'update_rag'.\n` +
      `\nQUY TẮC CỐT LÕI (BẮT BUỘC PHẢI GỌI TOOL KHI CÓ DỮ LIỆU):\n` +
      `1. TÊN NHÓM CUNG CẤP TÊN CÔNG TY / ĐỐI TƯỢNG: Luôn kết hợp Tên nhóm ("${groupName}") và nội dung tin nhắn để xác định công ty tuyển dụng.\n` +
      `2. KHI CÔNG TY ĐÃ CÓ TRONG KHO RAG: Nếu tin nhắn gửi link Google Maps, địa chỉ, bổ sung số lượng tuyển, hoặc lịch hẹn -> BẮT BUỘC dùng action='update_existing', targetFile='job_rag', targetId='id của công ty trong RAG', và truyền các trường cần cập nhật.\n` +
      `3. QUY TẮC VỀ TRẠNG THÁI TUYỂN DỤNG & CHỈ TIÊU (vacancies):\n` +
      `   - Khi tin nhắn báo "tạm ngưng tuyển", "ngưng tuyển", "đủ người", "hết chỗ": BẮT BUỘC phải truyền 'vacancies': 0 trong updatedFields!\n` +
      `   - Khi tin nhắn thông báo tuyển lại: BẮT BUỘC cập nhật 'vacancies' thành số nguyên tương ứng.\n` +
      `4. KHI CÔNG TY HOÀN TOÀN MỚI: Dùng action='create_new', targetFile='job_rag', trích xuất đầy đủ các trường.\n` +
      `5. CHỈ BỎ QUA KHÔNG GỌI TOOL khi tin nhắn hoàn toàn là tán gẫu, xã giao.`;

    const userPrompt =
      `[TÊN NHÓM]: "${groupName}"\n` +
      `[DANH SÁCH TIN NHẮN]:\n${messagesText}\n\n` +
      `[KHO DỮ LIỆU RAG HIỆN TẠI (Tra cứu ID để dùng update_existing)]:\n${ragContext}\n\n` +
      `Hãy phân tích ngay và gọi tool 'update_rag' để cập nhật dữ liệu nếu có thông tin tuyển dụng/link map/địa chỉ/chính sách/địa điểm!`;

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

              await hrNotifier.notifyRagUpdate({
                groupName,
                action: args.action,
                targetFile: `${args.targetFile}.json`,
                targetId,
                title,
                reason: args.reason,
                message: result.message,
                updatedFields: args.updatedFields,
                newEntry: args.newEntry,
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

    const ragContext = ragService.buildPromptContext();

    const systemInstruction =
      `Bạn là AI chuyên gia tự động phân loại và cập nhật cơ sở dữ liệu tuyển dụng (RAG) qua tool call 'update_rag'.\n` +
      `\nNHIỆM VỤ CỦA BẠN: Phân tích nội dung văn bản từ HR, tự động phân loại đúng vào 1 trong 3 nhóm file sau:\n` +
      `1. 'job_rag': Khi nội dung là tin tuyển dụng công ty, vị trí, lương, ca, tăng ca, quyền lợi, lịch hẹn nhận việc... (Nếu báo ngưng tuyển -> vacancies: 0).\n` +
      `2. 'policy_rag': Khi nội dung là quy định chính sách chung, chế độ bảo hiểm, hồ sơ, độ tuổi, ứng lương...\n` +
      `3. 'location_rag': Khi nội dung là thông tin khu vực địa lý, khu công nghiệp, tuyến đường, lân cận...\n` +
      `\nQUY TẮC BẮT BUỘC:\n` +
      `- Nếu đối tượng ĐÃ CÓ trong RAG -> dùng action='update_existing', targetId, updatedFields.\n` +
      `- Nếu đối tượng HOÀN TOÀN MỚI -> dùng action='create_new', newEntry.\n` +
      `- BẮT BUỘC PHẢI GỌI TOOL 'update_rag' để thực hiện lưu dữ liệu.`;

    const userPrompt =
      `[NỘI DUNG TUYỂN DỤNG / QUY ĐỊNH / ĐỊA BÀN CẦN CẬP NHẬT RAG TỪ HR]:\n${rawText}\n\n` +
      `[KHO DỮ LIỆU RAG HIỆN TẠI (Để tra cứu ID nếu đã tồn tại)]:\n${ragContext}\n\n` +
      `Hãy phân tích ngay, tự động phân loại chính xác và gọi tool 'update_rag' để cập nhật dữ liệu!`;

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
            if (deleteRes.success) {
              for (const it of deleteRes.deletedItems) {
                items.push({
                  targetFile: it.targetFile,
                  action: "update_existing",
                  targetId: it.id,
                  title: it.title,
                  reason: args.reason,
                  summary: `Đã xóa "${it.title}" (ID: ${it.id})`,
                  success: true,
                  message: deleteRes.message,
                });
              }
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
          const result = ragService.executeRagUpdate(args);
          const currentEntry = result.entry || args.newEntry || args.updatedFields || {};

          const title =
            (currentEntry["title"] as string) ||
            (args.newEntry?.title as string) ||
            (args.updatedFields?.title as string) ||
            args.targetId ||
            "Không rõ";

          const targetId = (currentEntry["id"] as string) || args.targetId;

          let summary = "";
          if (args.action === "create_new" || (result.entry && !args.targetId)) {
            summary = `Tạo mới "${title}" (ID: ${targetId || "Mới"})`;
          } else {
            summary = `Cập nhật "${title}" (ID: ${targetId})`;
          }

          items.push({
            targetFile: `${args.targetFile}.json`,
            action: args.action,
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
            ? `Đã cập nhật thành công ${successfulCount} mục vào cơ sở dữ liệu RAG.`
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

import { GoogleGenAI, type Content } from "@google/genai";
import { config } from "../config/index.js";
import { downloadAudioAsBase64 } from "./audioHelper.js";
import { buildAudioTranscriptionPrompt } from "../prompts/index.js";

/**
 * AudioService: Chuyên trách nhận diện và phiên âm giọng nói (Speech-to-Text)
 * SRP: Tải audio từ Zalo và sử dụng Gemini Multimodal Audio để chuyển đổi thành văn bản tiếng Việt chính xác.
 */
export class AudioService {
  constructor(private readonly ai: GoogleGenAI | null) {}

  /**
   * Phiên âm một tệp âm thanh (Voice Message) thành văn bản tiếng Việt
   * @param voiceUrl Đường dẫn tệp âm thanh từ tin nhắn Zalo
   * @param companyHints Danh sách tên công ty/KCN tham chiếu để tăng độ chính xác
   */
  public async transcribeAudio(
    voiceUrl: string,
    companyHints?: string[]
  ): Promise<string> {
    if (!voiceUrl || typeof voiceUrl !== "string") {
      return "[Tin nhắn thoại: Không có URL âm thanh hợp lệ]";
    }

    if (!this.ai) {
      console.warn(
        "⚠️ [AudioService] Gemini AI chưa được khởi tạo (thiếu API Key), không thể phiên âm audio."
      );
      return "[Tin nhắn thoại: Chưa cấu hình Gemini API Key để phiên âm]";
    }

    try {
      // 1. Tải tệp âm thanh dạng Base64
      const audio = await downloadAudioAsBase64(voiceUrl);
      if (!audio) {
        return "[Tin nhắn thoại: Không thể tải tệp âm thanh]";
      }

      // 2. Chuẩn bị Prompt và Nội dung gửi Gemini
      const prompt = buildAudioTranscriptionPrompt(companyHints);

      const contents: Content[] = [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: audio.mimeType,
                data: audio.data,
              },
            },
            {
              text: prompt,
            },
          ],
        },
      ];

      // 3. Gọi Gemini với timeout 35 giây
      const timeoutMs = 35000;
      const response = await Promise.race([
        this.ai.models.generateContent({
          model: config.geminiFlashLiteModel || "gemini-2.5-flash-lite",
          contents,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Timeout (${timeoutMs}ms) khi phiên âm audio qua Gemini`)),
            timeoutMs
          )
        ),
      ]);

      const rawText = response.text ? response.text.trim() : "";
      if (!rawText) {
        return "[Không nghe rõ lời nói]";
      }

      // 4. Làm sạch văn bản (loại bỏ dấu ngoặc kép bọc ngoài nếu có)
      let cleanedText = rawText.replace(/^["'`]+|["'`]+$/g, "").trim();

      // Nếu AI trả về tiền tố thường gặp, dọn dẹp nhẹ
      cleanedText = cleanedText
        .replace(/^(Nội dung|Audio|Văn bản|Transcription|Text):\s*/i, "")
        .trim();

      return cleanedText || "[Không nghe rõ lời nói]";
    } catch (error) {
      console.error(
        "❌ [AudioService] Lỗi khi phiên âm tin nhắn thoại:",
        error instanceof Error ? error.message : String(error)
      );
      return "[Tin nhắn thoại: Lỗi khi xử lý phiên âm]";
    }
  }
}

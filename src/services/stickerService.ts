import { GoogleGenAI, type Content } from "@google/genai";
import { config } from "../config/index.js";
import { downloadImageAsBase64 } from "./imageHelper.js";

/**
 * StickerService: Nhận diện và đọc hiểu ý nghĩa Sticker Zalo
 * SRP: Sử dụng metadata từ Zalo payload hoặc Gemini Flash Vision để trích xuất ý nghĩa cảm xúc/thông điệp ngắn gọn (1-4 từ)
 */
export class StickerService {
  constructor(private readonly ai: GoogleGenAI | null) {}

  /**
   * Đọc hiểu ý nghĩa của một Sticker
   * @param stickerUrl URL hình ảnh sticker
   * @param caption Text hoặc caption có sẵn từ Zalo payload (nếu có)
   */
  public async understandSticker(
    stickerUrl?: string,
    caption?: string
  ): Promise<string> {
    // 1. Nếu payload đã có caption/text rõ ràng thì dùng ngay, không cần gọi AI
    if (
      caption &&
      caption.trim() &&
      caption.trim() !== "[Sticker]" &&
      caption.trim() !== "[Nhãn dán]"
    ) {
      return caption.trim();
    }

    if (!stickerUrl || typeof stickerUrl !== "string") {
      return "Nhãn dán biểu cảm";
    }

    if (!this.ai) {
      return "Nhãn dán biểu cảm";
    }

    try {
      // 2. Tải hình ảnh sticker
      const image = await downloadImageAsBase64(stickerUrl);
      if (!image) {
        return "Nhãn dán biểu cảm";
      }

      // 3. Prompt tiếng Anh súc tích yêu cầu Gemini Flash tóm tắt hành động/cảm xúc của sticker bằng 1-4 từ tiếng Việt
      const prompt = `Describe the concise intent, gesture, or emotion of this Vietnamese chat sticker in 1 to 4 Vietnamese words (for example: 'Vẫy tay chào', 'Cảm ơn', 'Đồng ý', 'Thả tim', 'Like 👍', 'Xin lỗi', 'Vui mừng', 'Ngạc nhiên', 'Thắc mắc', 'Chúc mừng'). Output ONLY the short Vietnamese phrase, no explanation, no quotation marks.`;

      const contents: Content[] = [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: image.mimeType || "image/png",
                data: image.data,
              },
            },
            {
              text: prompt,
            },
          ],
        },
      ];

      const response = await this.ai.models.generateContent({
        model: config.geminiModel || "gemini-2.5-flash",
        contents,
      });

      const resultText = response.text
        ? response.text.trim().replace(/^["'\s]+|["'\s]+$/g, "")
        : "";
      if (resultText && resultText.length < 50) {
        return resultText;
      }

      return "Nhãn dán biểu cảm";
    } catch (error) {
      console.warn(
        "⚠️ [StickerService] Lỗi khi phân tích sticker qua Gemini Vision:",
        error
      );
      return "Nhãn dán biểu cảm";
    }
  }
}

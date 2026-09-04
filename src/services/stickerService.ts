import { GoogleGenAI, type Content } from "@google/genai";
import { config } from "../config/index.js";
import { downloadImageAsBase64 } from "./imageHelper.js";

/**
 * StickerService: Nhận diện và đọc hiểu ý nghĩa Sticker Zalo
 * SRP: Sử dụng metadata từ Zalo payload hoặc Gemini Flash Vision để trích xuất ý nghĩa cảm xúc/thông điệp ngắn gọn (1-4 từ)
 */
export class StickerService {
  private readonly cache = new Map<string, string>();
  private readonly maxCacheSize = 500;

  constructor(private readonly ai: GoogleGenAI | null) {}

  /**
   * Đọc hiểu ý nghĩa của một Sticker
   * @param stickerUrl URL hình ảnh sticker
   * @param caption Text hoặc caption có sẵn từ Zalo payload (nếu có)
   * @param stickerId ID nhãn dán sticker từ Zalo payload (ưu tiên dùng làm cache key)
   */
  public async understandSticker(
    stickerUrl?: string,
    caption?: string,
    stickerId?: string
  ): Promise<string> {
    const cacheKey = stickerId ? `id:${stickerId}` : stickerUrl ? `url:${stickerUrl}` : "";

    // 1. Kiểm tra cache trước (0 token, 0ms)
    if (cacheKey && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    // 2. Nếu payload đã có caption/text rõ ràng thì dùng ngay, không cần gọi AI
    if (caption && typeof caption === "string") {
      const clean = caption
        .replace(/\[.*?\]/g, "")
        .trim()
        .replace(/^["':\s]+|["':\s]+$/g, "");
      if (
        clean &&
        clean.length > 0 &&
        clean !== "Sticker" &&
        clean !== "Nhãn dán" &&
        clean !== "Nhãn dán biểu cảm"
      ) {
        if (cacheKey) this.setCache(cacheKey, clean);
        return clean;
      }
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

      // 3. Prompt phân tích biểu cảm, ý nghĩa và chữ viết trên sticker qua Gemini Vision
      const prompt = `You are an AI assistant analyzing a chat sticker/emoticon in Vietnamese.
Carefully examine the character, action, facial expression, and especially any written text or caption visible inside this sticker image.

Rules:
1. If there is text written in the sticker image (e.g. 'Ủa alo', 'Chờ tí', 'Dạ em nghe', 'Ok nha', 'Gửi CV', 'Tuyệt vời', 'Mệt mỏi', 'Cảm ơn sếp', 'Hihi', 'Huhu'):
   - Include or extract that exact text (e.g. 'Chờ tí', 'Thắc mắc: Ủa alo', 'Đồng ý: Ok nha', 'Vẫy tay: Hello', 'Cảm ơn sếp').
2. If there is no text in the image:
   - Describe the concise intent or emotion in 1 to 4 Vietnamese words (e.g. 'Vẫy tay chào', 'Cảm ơn', 'Dạ vâng', 'Đồng ý', 'Thả tim', 'Like 👍', 'Xin chào', 'Hỏi thăm', 'Chúc mừng', 'Xin lỗi', 'Buồn bã', 'Ngạc nhiên', 'Ủng hộ').
3. Output format: Return ONLY the short Vietnamese phrase (under 50 characters), no quotes, no conversational filler, no markdown.`;

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
        model: config.geminiFlashLiteModel || "gemini-3.5-flash-lite",
        contents,
      });

      const resultText = response.text
        ? response.text.trim().replace(/^["'`\s]+|["'`\s]+$/g, "")
        : "";
      if (resultText && resultText.length < 80) {
        if (cacheKey) this.setCache(cacheKey, resultText);
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

  private setCache(key: string, value: string): void {
    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  public clearCache(): void {
    this.cache.clear();
  }

  public getCacheSize(): number {
    return this.cache.size;
  }
}

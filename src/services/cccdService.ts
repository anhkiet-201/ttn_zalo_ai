import { GoogleGenAI } from "@google/genai";
import { config } from "../config/index.js";
import { downloadImageAsBase64 } from "./imageHelper.js";
import {
  type CCCDAnalysisResult,
  type CCCDCardResult,
  type ChatMessagePart,
} from "../types/ai.types.js";
import { buildCccdOcrPrompt } from "../prompts/index.js";

/**
 * CCCDService: Chuyên trách phân tích và nhận diện tài liệu Căn cước công dân (CCCD / VNeID / CMND)
 * SRP: Chỉ xử lý AI Vision OCR trích xuất thông tin CCCD từ tập ảnh.
 */
export class CCCDService {
  constructor(private readonly ai: GoogleGenAI | null) {}

  /**
   * Phân tích và kiểm tra xem hình ảnh có phải là thẻ CCCD hay không, nếu có trích xuất chi tiết.
   * Hỗ trợ nhận diện đồng thời nhiều thẻ CCCD của nhiều người và gắn đúng ảnh cho từng thẻ.
   */
  public async analyzeCCCD(imageUrls: string[]): Promise<CCCDAnalysisResult | null> {
    if (!this.ai || imageUrls.length === 0) return null;

    try {
      // 1. Tải song song tất cả các hình ảnh gửi đến
      const downloadResults = await Promise.all(
        imageUrls.map((url) => downloadImageAsBase64(url))
      );

      const validItems: { url: string; img: { mimeType: string; data: string } }[] = [];
      imageUrls.forEach((url, i) => {
        const img = downloadResults[i];
        if (img) {
          validItems.push({ url, img });
        }
      });

      if (validItems.length === 0) return null;

      const userParts: ChatMessagePart[] = [
        {
          text: buildCccdOcrPrompt(validItems.length),
        },
      ];

      validItems.forEach((item) => {
        userParts.push({
          inlineData: {
            mimeType: item.img.mimeType,
            data: item.img.data,
          },
        });
      });

      const timeoutMs = 45000;
      const response = await Promise.race([
        this.ai.models.generateContent({
          model: config.geminiFlashLiteModel || "gemini-2.5-flash-lite",
          contents: [{ role: "user", parts: userParts }],
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Timeout (${timeoutMs}ms) khi phân tích CCCD từ ảnh`)),
            timeoutMs
          )
        ),
      ]);

      const responseText = response.text?.trim() || "";
      const cleanJson = responseText
        .replace(/^```(?:json)?/i, "")
        .replace(/```$/, "")
        .trim();

      const parsed: any = JSON.parse(cleanJson);
      parsed.rawText = responseText;

      if (parsed.isCCCD) {
        let cards: CCCDCardResult[] = [];
        if (Array.isArray(parsed.cards) && parsed.cards.length > 0) {
          cards = parsed.cards.map((c: any) => {
            const cardImgUrls: string[] = [];
            if (Array.isArray(c.imageIndices)) {
              c.imageIndices.forEach((idx: number) => {
                if (validItems[idx]) {
                  cardImgUrls.push(validItems[idx].url);
                }
              });
            }
            if (cardImgUrls.length === 0) {
              cardImgUrls.push(...validItems.map((v) => v.url));
            }
            return {
              fullName: c.fullName,
              idNumber: c.idNumber,
              dob: c.dob,
              gender: c.gender,
              nationality: c.nationality,
              homeTown: c.homeTown,
              residence: c.residence,
              expiryDate: c.expiryDate,
              imageUrls: Array.from(new Set(cardImgUrls)),
            };
          });
        } else if (parsed.fullName || parsed.idNumber) {
          cards = [
            {
              fullName: parsed.fullName,
              idNumber: parsed.idNumber,
              dob: parsed.dob,
              gender: parsed.gender,
              nationality: parsed.nationality,
              homeTown: parsed.homeTown,
              residence: parsed.residence,
              expiryDate: parsed.expiryDate,
              imageUrls: validItems.map((v) => v.url),
            },
          ];
        }

        parsed.cards = cards;
        if (cards.length > 0) {
          parsed.fullName = cards[0].fullName;
          parsed.idNumber = cards[0].idNumber;
          parsed.dob = cards[0].dob;
          parsed.gender = cards[0].gender;
          parsed.nationality = cards[0].nationality;
          parsed.homeTown = cards[0].homeTown;
          parsed.residence = cards[0].residence;
          parsed.expiryDate = cards[0].expiryDate;
          parsed.imageUrls = cards[0].imageUrls;
        }
      }

      return parsed;
    } catch (error) {
      console.error("❌ [CCCDService] Lỗi khi phân tích CCCD từ ảnh:", error);
      return null;
    }
  }
}

import { GoogleGenAI } from "@google/genai";
import { config } from "../config/index.js";
import { downloadImageAsBase64 } from "./imageHelper.js";
import {
  type CCCDAnalysisResult,
  type CCCDCardResult,
  type ChatMessagePart,
} from "../types/ai.types.js";

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
          text: `Bạn là hệ thống OCR nhận diện tài liệu Căn cước công dân (CCCD / Thẻ căn cước / CMND) Việt Nam chuyên nghiệp.
Có ${validItems.length} hình ảnh đính kèm theo thứ tự từ Ảnh 0 đến Ảnh ${validItems.length - 1}.
Nhiệm vụ:
1. Nhận diện tất cả các thẻ Căn cước công dân (CCCD / CMND / Thẻ căn cước) xuất hiện trong các ảnh (có thể 1 người gửi 2 mặt trước sau, HOẶC nhiều người gửi CCCD khác nhau).
2. Trả về JSON theo cấu trúc danh sách "cards":
{
  "isCCCD": true,
  "cards": [
    {
      "fullName": "Họ và tên in hoa",
      "idNumber": "Số định danh / Số CCCD gồm 12 hoặc 9 số",
      "dob": "Ngày tháng năm sinh (dd/mm/yyyy)",
      "gender": "Nam hoặc Nữ",
      "nationality": "Quốc tịch",
      "homeTown": "Quê quán",
      "residence": "Nơi thường trú / Địa chỉ",
      "expiryDate": "Hạn sử dụng",
      "imageIndices": [0] // Mảng index của các ảnh thuộc về thẻ này (ví dụ [0] cho ảnh 0, hoặc [0, 1] nếu ảnh 0 là mặt trước và ảnh 1 là mặt sau của cùng 1 người)
    }
  ]
}
3. Nếu không có ảnh nào là CCCD:
{
  "isCCCD": false,
  "description": "Mô tả nội dung các ảnh"
}
LƯU Ý: Phải phân biệt rõ ràng nếu có NHIỀU NGƯỜI / NHIỀU THẺ CCCD KHÁC NHAU, hãy tạo từng phần tử riêng trong mảng "cards". Chỉ trả về JSON thuần túy, không dùng markdown.`,
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

      const response = await this.ai.models.generateContent({
        model: config.geminiModel,
        contents: [{ role: "user", parts: userParts }],
      });

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

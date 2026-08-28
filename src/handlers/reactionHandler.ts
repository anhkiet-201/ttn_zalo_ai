import { type Reaction } from "zca-js";
import { type ZaloService } from "../services/zaloService.js";

/**
 * ReactionHandler: Xử lý và ghi log khi có người thả cảm xúc vào tin nhắn
 */
export class ReactionHandler {
  constructor(private readonly zaloService: ZaloService) {}

  /**
   * Phương thức xử lý sự kiện cảm xúc
   */
  public async handle(reaction: Reaction): Promise<void> {
    const threadTypeStr = reaction.isGroup ? "👥 NHÓM" : "👤 CÁ NHÂN";
    const sender = reaction.data.dName || reaction.data.uidFrom;
    const icon = reaction.data.content?.rIcon || "Cảm xúc";
    const msgId = reaction.data.msgId;

    console.log(
      `\n💖 [CẢM XÚC - ${threadTypeStr}] Người dùng ${sender} đã thả [${icon}] vào tin nhắn ID: ${msgId} tại luồng [${reaction.threadId}]`
    );
  }
}

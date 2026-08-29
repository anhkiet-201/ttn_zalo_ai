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
    // Silent handle reaction events to prevent terminal spam
  }
}

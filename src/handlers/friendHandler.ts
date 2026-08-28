import { type FriendEvent, FriendEventType } from "zca-js";
import { type ZaloService } from "../services/zaloService.js";

/**
 * FriendHandler: Xử lý các sự kiện liên quan đến Bạn bè trên Zalo (kết bạn, hủy kết bạn...)
 */
export class FriendHandler {
  constructor(private readonly zaloService: ZaloService) {}

  /**
   * Phương thức điều phối và xử lý sự kiện bạn bè
   */
  public async handle(event: FriendEvent): Promise<void> {
    switch (event.type) {
      case FriendEventType.REQUEST: {
        // Lấy User ID người gửi lời mời kết bạn
        const fromUid =
          typeof event.data === "object" && "fromUid" in event.data
            ? event.data.fromUid
            : event.threadId;

        if (!fromUid) {
          console.warn("⚠️ [KẾT BẠN] Nhận sự kiện kết bạn nhưng không trích xuất được fromUid:", event);
          return;
        }

        // Lấy thông tin người dùng nếu có thể để hiển thị log thân thiện
        let senderDisplayName = fromUid;
        try {
          const userInfo = await this.zaloService.getUserInfo(fromUid);
          const profile = userInfo?.changed_profiles?.[fromUid];
          const name = profile?.displayName || profile?.zaloName;
          if (name) {
            senderDisplayName = `${name} (${fromUid})`;
          }
        } catch {
          // Bỏ qua lỗi lấy userInfo
        }

        console.log(`\n🤝 [LỜI MỜI KẾT BẠN] Nhận yêu cầu kết bạn từ: ${senderDisplayName}`);

        // Tự động chấp nhận lời mời kết bạn
        const isSuccess = await this.zaloService.acceptFriendRequest(fromUid);
        if (isSuccess) {
          console.log(`✅ [KẾT BẠN THÀNH CÔNG] Đã tự động chấp nhận kết bạn với: ${senderDisplayName}`);
        } else {
          console.warn(`❌ [KẾT BẠN THẤT BẠI] Không thể chấp nhận kết bạn với: ${senderDisplayName}`);
        }
        break;
      }

      case FriendEventType.ADD: {
        console.log(`\n🎉 [BẠN MỚI] Đã trở thành bạn bè với User ID: ${event.threadId}`);
        break;
      }

      default: {
        // Các sự kiện khác (BLOCK, UNBLOCK, REMOVE...)
        break;
      }
    }
  }
}

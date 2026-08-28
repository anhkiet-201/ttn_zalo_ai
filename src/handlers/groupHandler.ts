import { type GroupEvent, GroupEventType, ThreadType } from "zca-js";
import { type ZaloService } from "../services/zaloService.js";

/**
 * GroupHandler: Xử lý các sự kiện diễn ra trong nhóm chat Zalo
 */
export class GroupHandler {
  constructor(private readonly zaloService: ZaloService) {}

  /**
   * Phương thức xử lý sự kiện nhóm
   */
  public async handle(event: GroupEvent): Promise<void> {
    const threadId = event.threadId;

    switch (event.type) {
      case GroupEventType.JOIN: {
        const members = "updateMembers" in event.data ? event.data.updateMembers : [];
        const memberNames = members?.map((m) => m.dName).join(", ") || "Thành viên mới";
        console.log(`\n🎉 [SỰ KIỆN NHÓM] Có thành viên mới tham gia nhóm [${threadId}]: ${memberNames}`);

        // Gửi tin nhắn chào mừng thành viên mới
        try {
          await this.zaloService.sendMessage(
            threadId,
            `👋 Chào mừng ${memberNames} đã tham gia nhóm! Chúc bạn có những trải nghiệm vui vẻ! 🎉`,
            ThreadType.Group
          );
        } catch (error) {
          console.error("❌ Lỗi khi gửi tin nhắn chào mừng:", error);
        }
        break;
      }

      case GroupEventType.LEAVE:
      case GroupEventType.REMOVE_MEMBER: {
        const members = "updateMembers" in event.data ? event.data.updateMembers : [];
        const memberNames = members?.map((m) => m.dName).join(", ") || "Thành viên";
        console.log(`\n🚪 [SỰ KIỆN NHÓM] Thành viên rời/bị xóa khỏi nhóm [${threadId}]: ${memberNames}`);
        break;
      }

      case GroupEventType.UPDATE: {
        if ("groupName" in event.data && event.data.groupName) {
          console.log(
            `\n✏️ [SỰ KIỆN NHÓM] Nhóm [${threadId}] đã đổi tên thành: "${event.data.groupName}"`
          );
        }
        break;
      }

      default: {
        console.log(`\n📢 [SỰ KIỆN NHÓM] Loại sự kiện: ${event.type} tại nhóm [${threadId}]`);
        break;
      }
    }
  }
}

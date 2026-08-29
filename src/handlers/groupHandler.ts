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
        console.log(`🎉 [Nhóm: ${threadId}] Thành viên mới: ${memberNames}`);
        break;
      }

      case GroupEventType.LEAVE:
      case GroupEventType.REMOVE_MEMBER: {
        const members = "updateMembers" in event.data ? event.data.updateMembers : [];
        const memberNames = members?.map((m) => m.dName).join(", ") || "Thành viên";
        console.log(`🚪 [Nhóm: ${threadId}] Thành viên rời/bị xóa: ${memberNames}`);
        break;
      }

      case GroupEventType.UPDATE: {
        if ("groupName" in event.data && event.data.groupName) {
          console.log(`✏️ [Nhóm: ${threadId}] Đổi tên thành: "${event.data.groupName}"`);
        }
        break;
      }

      default: {
        break;
      }
    }
  }
}

import { type GroupEvent, GroupEventType, ThreadType } from "zca-js";
import { type ZaloService } from "../services/zaloService.js";
import { type UserRenameEvent } from "../types/zalo.types.js";

/**
 * GroupHandler: Xử lý các sự kiện diễn ra trong nhóm chat Zalo
 */
export class GroupHandler {
  private onRenameCallback?: (event: UserRenameEvent) => Promise<void> | void;

  constructor(
    private readonly zaloService: ZaloService,
    onRename?: (event: UserRenameEvent) => Promise<void> | void
  ) {
    this.onRenameCallback = onRename;
  }

  /**
   * Đăng ký callback khi phát hiện nhóm đổi tên
   */
  public setOnRename(callback: (event: UserRenameEvent) => Promise<void> | void): void {
    this.onRenameCallback = callback;
  }

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
          const newGroupName = event.data.groupName;
          console.log(`✏️ [Nhóm: ${threadId}] Đổi tên thành: "${newGroupName}"`);
          if (this.onRenameCallback) {
            try {
              await this.onRenameCallback({
                threadId,
                senderId: ("creatorId" in event.data ? String(event.data.creatorId) : "") || "0",
                newName: newGroupName,
                isGroup: true,
                timestamp: Date.now(),
              });
            } catch (err) {
              console.error("❌ Lỗi trong callback onRename của GroupHandler:", err);
            }
          }
        }
        break;
      }

      default: {
        break;
      }
    }
  }
}

import { type UserRenameEvent } from "../types/zalo.types.js";
import { type ZaloService } from "../services/zaloService.js";
import { ThreadMetadataRepository, CandidateRepository } from "../database/index.js";
import { UserContextManager } from "../services/userContextManager.js";
import { chatBroadcaster } from "../server/chatBroadcaster.js";

/**
 * RenameHandler: Chuyên trách xử lý sự kiện đổi tên hiển thị (Cá nhân hoặc Nhóm).
 * SRP: Đồng bộ tên mới vào SQLite Database (thread_metadata, candidates, user_contexts),
 * cập nhật RAM cache của ZaloService và phát sự kiện realtime SSE tới Web Portal.
 */
export class RenameHandler {
  constructor(
    private readonly zaloService: ZaloService,
    private readonly threadMetaRepo: ThreadMetadataRepository = new ThreadMetadataRepository(),
    private readonly candidateRepo: CandidateRepository = new CandidateRepository(),
    private readonly userContextManager: UserContextManager = UserContextManager.getInstance()
  ) {}

  /**
   * Xử lý sự kiện đổi tên luồng hội thoại
   */
  public async handle(event: UserRenameEvent): Promise<void> {
    const trimmedNewName = (event.newName || "").trim();
    if (!trimmedNewName || trimmedNewName === "Unknown" || trimmedNewName === "Admin (Tôi)") {
      return;
    }

    const targetType = event.isGroup ? "NHÓM 👥" : "CÁ NHÂN 👤";
    console.log(
      `\n✏️ [SỰ KIỆN ĐỔI TÊN ${targetType}] Luồng [${event.threadId}]: "${event.oldName || "Chưa có tên"}" ➡️ "${trimmedNewName}"`
    );

    // 1. Cập nhật SQLite: Bảng thread_metadata (tự động nhận diện -M và đồng bộ is_manual)
    this.threadMetaRepo.upsertMetadata(
      event.threadId,
      trimmedNewName,
      undefined,
      event.isGroup
    );

    if (!event.isGroup) {
      // 2. Cập nhật SQLite: Bảng candidates (cập nhật sender_name cho ứng viên)
      this.candidateRepo.updateSenderName(event.threadId, trimmedNewName);

      // 3. Cập nhật SQLite & RAM cache: Bảng user_contexts
      this.userContextManager.updateSenderName(
        event.threadId,
        event.senderId,
        trimmedNewName
      );

      // 4. Cập nhật in-memory cache trong ZaloService
      this.zaloService.updateUserNameCache(event.threadId, trimmedNewName);
    } else {
      // Cập nhật in-memory cache nhóm trong ZaloService
      this.zaloService.updateGroupNameCache(event.threadId, trimmedNewName);
    }

    // 5. Phát sự kiện SSE realtime tới Web Portal Dashboard / Web Chat
    chatBroadcaster.broadcastThreadRenamed(event.threadId, trimmedNewName);
  }
}

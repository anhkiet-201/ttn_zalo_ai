import {
  type API,
  type Message,
  type GroupEvent,
  type FriendEvent,
  type Reaction,
  type Undo,
  type Typing,
  CloseReason,
} from "zca-js";
import { EventDispatcher } from "./eventDispatcher.js";

/**
 * MessageListener: Quản lý vòng đời lắng nghe WebSocket thời gian thực từ Zalo
 */
export class MessageListener {
  private isRunning: boolean = false;

  constructor(
    private readonly api: API,
    private readonly dispatcher: EventDispatcher
  ) {}

  /**
   * Khởi chạy Listener
   */
  public start(): void {
    if (this.isRunning) {
      console.warn("⚠️ Listener đang chạy!");
      return;
    }

    console.log("🌐 Đang khởi động Zalo WebSocket Listener...");

    // 1. Sự kiện kết nối thành công
    this.api.listener.on("connected", () => {
      this.isRunning = true;
      console.log("🟢 [Zalo Listener] Đã kết nối thành công tới máy chủ Zalo!");
      console.log("👂 Bot đang lắng nghe mọi tin nhắn và sự kiện thời gian thực...");
    });

    // 2. Sự kiện ngắt kết nối
    this.api.listener.on("disconnected", (code: CloseReason, reason: string) => {
      console.warn(
        `🟡 [Zalo Listener] Đã ngắt kết nối tạm thời. Code: ${code}, Lý do: ${reason || "Không rõ"}`
      );
    });

    // 3. Sự kiện đóng kết nối hoàn toàn
    this.api.listener.on("closed", (code: CloseReason, reason: string) => {
      this.isRunning = false;
      let explanation = "";
      if (code === CloseReason.DuplicateConnection) {
        explanation =
          " (Tài khoản đang được đăng nhập hoặc mở Web Zalo ở một nơi khác)";
      } else if (code === CloseReason.KickConnection) {
        explanation = " (Kết nối bị Zalo máy chủ đóng)";
      }

      console.error(
        `🔴 [Zalo Listener] Kết nối đã bị đóng. Code: ${code} - ${reason}${explanation}`
      );
    });

    // 4. Bắt lỗi từ Listener
    this.api.listener.on("error", (error: unknown) => {
      console.error("❌ [Zalo Listener] Gặp lỗi trong luồng WebSocket:", error);
    });

    // 5. Sự kiện nhận tin nhắn mới
    this.api.listener.on("message", (message: Message) => {
      this.dispatcher.dispatchMessage(message);
    });

    // 6. Sự kiện nhóm chat
    this.api.listener.on("group_event", (event: GroupEvent) => {
      this.dispatcher.dispatchGroupEvent(event);
    });

    // 7. Sự kiện bạn bè
    this.api.listener.on("friend_event", (event: FriendEvent) => {
      this.dispatcher.dispatchFriendEvent(event);
    });

    // 8. Sự kiện cảm xúc
    this.api.listener.on("reaction", (reaction: Reaction) => {
      this.dispatcher.dispatchReaction(reaction);
    });

    // 9. Sự kiện thu hồi tin nhắn
    this.api.listener.on("undo", (undo: Undo) => {
      this.dispatcher.dispatchUndo(undo);
    });

    // 10. Sự kiện đang gõ phím
    this.api.listener.on("typing", (typing: Typing) => {
      this.dispatcher.dispatchTyping(typing);
    });

    // Bắt đầu lắng nghe, bật tự động retry khi kết nối bị đóng
    this.api.listener.start({ retryOnClose: true });
  }

  /**
   * Dừng Listener
   */
  public stop(): void {
    if (!this.isRunning) {
      return;
    }
    console.log("🛑 Đang dừng Zalo WebSocket Listener...");
    this.api.listener.stop();
    this.isRunning = false;
    console.log("⏹️ Đã dừng Listener thành công.");
  }
}

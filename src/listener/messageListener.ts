import {
  type API,
  type Message,
  type GroupEvent,
  type FriendEvent,
  type Reaction,
  type Undo,
  type Typing,
  ThreadType,
  CloseReason,
} from "zca-js";
import { EventDispatcher } from "./eventDispatcher.js";
import { validateSessionHealth } from "../auth/sessionManager.js";
import { type ConnectionInfo, type ConnectionState } from "../auth/qrWebServer.js";

/**
 * MessageListener: Quản lý vòng đời lắng nghe WebSocket thời gian thực từ Zalo
 * Tích hợp cơ chế Tự Phục Hồi (Self-Healing Resilience):
 * - Tự động kết nối lại khi gặp lỗi 1006 (AbnormalClosure), rớt mạng, hoặc timeout
 * - Áp dụng thuật toán Exponential Backoff kèm Jitter
 * - Xử lý đặc biệt cho mã 3000 (DuplicateConnection) với cooldown 30s tránh xung đột
 * - Tự động kiểm tra Session Health và thông báo khi Cookie/Phiên hết hạn
 * - Chống rò rỉ Event Listener (Listener Leak Prevention)
 */
export class MessageListener {
  private isRunning: boolean = false;
  private isDestroyed: boolean = false;
  private listenersConfigured: boolean = false;

  private connectionState: ConnectionState = "disconnected";
  private reconnectAttempt: number = 0;
  private readonly maxReconnectAttempts: number = 10;
  private readonly baseDelayMs: number = 3000;
  private readonly maxDelayMs: number = 60000;
  private readonly duplicateCooldownMs: number = 30000;

  private reconnectTimer: NodeJS.Timeout | null = null;
  private stableTimer: NodeJS.Timeout | null = null;
  private lastConnectedAt: string | null = null;
  private lastError: string | null = null;
  private cooldownReason: string | null = null;

  private stateChangeCallbacks: Array<(info: ConnectionInfo) => void> = [];
  private sessionExpiredCallbacks: Array<() => Promise<void> | void> = [];

  constructor(
    private readonly api: API,
    private readonly dispatcher: EventDispatcher
  ) {}

  /**
   * Đăng ký callback theo dõi trạng thái kết nối
   */
  public onStateChange(cb: (info: ConnectionInfo) => void): void {
    this.stateChangeCallbacks.push(cb);
    // Bắn trạng thái hiện tại ngay khi đăng ký
    cb(this.getConnectionInfo());
  }

  /**
   * Đăng ký callback khi phát hiện phiên đăng nhập (Cookie) đã hết hạn/bị huỷ
   */
  public onSessionExpired(cb: () => Promise<void> | void): void {
    this.sessionExpiredCallbacks.push(cb);
  }

  /**
   * Lấy thông tin trạng thái kết nối hiện tại
   */
  public getConnectionInfo(override?: Partial<ConnectionInfo>): ConnectionInfo {
    return {
      state: this.connectionState,
      reconnectAttempts: this.reconnectAttempt,
      maxAttempts: this.maxReconnectAttempts,
      lastError: this.lastError,
      lastConnectedAt: this.lastConnectedAt,
      cooldownReason: this.cooldownReason,
      ...override,
    };
  }

  /**
   * Phát thông báo cập nhật trạng thái tới tất cả observer (Dashboard, Logs)
   */
  private emitState(override?: Partial<ConnectionInfo>): void {
    const info = this.getConnectionInfo(override);
    for (const cb of this.stateChangeCallbacks) {
      try {
        cb(info);
      } catch (err) {
        console.error("❌ Lỗi trong callback onStateChange:", err);
      }
    }
  }

  /**
   * Đăng ký các sự kiện từ WebSocket Listener (Chỉ thực hiện duy nhất 1 lần để chống memory leak)
   */
  private setupEventListeners(): void {
    if (this.listenersConfigured) {
      return;
    }
    this.listenersConfigured = true;

    // 1. Sự kiện kết nối thành công
    this.api.listener.on("connected", () => {
      this.isRunning = true;
      this.connectionState = "connected";
      this.lastError = null;
      this.cooldownReason = null;
      this.lastConnectedAt = new Date().toLocaleString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
      });

      console.log("\n🟢 [Zalo Listener] Đã kết nối thành công tới máy chủ Zalo!");
      console.log("👂 Bot đang lắng nghe mọi tin nhắn và sự kiện thời gian thực...");

      // Dọn dẹp timer reconnect nếu có
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }

      // Thiết lập bộ đếm ổn định: Nếu kết nối duy trì liên tục quá 30 giây -> reset số lần thử lại
      if (this.stableTimer) {
        clearTimeout(this.stableTimer);
      }
      this.stableTimer = setTimeout(() => {
        if (this.connectionState === "connected") {
          this.reconnectAttempt = 0;
          this.emitState({ reconnectAttempts: 0 });
        }
      }, 30000);

      this.emitState({ nextRetryInMs: null, cooldownReason: null });
    });

    // 2. Sự kiện ngắt kết nối tạm thời
    this.api.listener.on("disconnected", (code: CloseReason, reason: string) => {
      console.warn(
        `🟡 [Zalo Listener] Đã ngắt kết nối tạm thời. Code: ${code}, Lý do: ${reason || "Không rõ"}`
      );
      this.emitState();
    });

    // 3. Sự kiện đóng kết nối hoàn toàn
    this.api.listener.on("closed", (code: CloseReason, reason: string) => {
      this.isRunning = false;
      if (this.stableTimer) {
        clearTimeout(this.stableTimer);
        this.stableTimer = null;
      }

      if (this.isDestroyed) {
        this.connectionState = "disconnected";
        this.emitState();
        return;
      }

      let explanation = "";
      if (code === CloseReason.DuplicateConnection) {
        explanation = "Tài khoản đang được đăng nhập hoặc mở Web Zalo ở một nơi khác";
        this.cooldownReason = explanation;
      } else if (code === CloseReason.KickConnection) {
        explanation = "Kết nối bị Zalo máy chủ đóng";
      } else if (code === CloseReason.AbnormalClosure) {
        explanation = "Mất kết nối mạng hoặc Socket bị đóng đột ngột (Code 1006)";
      }

      this.lastError = explanation || reason || `Đóng kết nối (Code: ${code})`;

      console.error(
        `\n🔴 [Zalo Listener] Kết nối đã bị đóng. Code: ${code} - ${reason || "Không có mô tả"}${
          explanation ? ` (${explanation})` : ""
        }`
      );

      // Kích hoạt quy trình Tự Động Phục Hồi (Self-Healing)
      this.scheduleReconnect(code, reason);
    });

    // 4. Bắt lỗi từ Listener
    this.api.listener.on("error", (error: unknown) => {
      console.error("❌ [Zalo Listener] Gặp lỗi trong luồng WebSocket:", error);
      this.lastError = String(error);
      this.emitState();
    });

    // 5. Sự kiện nhận tin nhắn mới
    this.api.listener.on("message", (message: Message) => {
      this.dispatcher.dispatchMessage(message);
    });

    // 5.1. Sự kiện nhận tin nhắn đồng bộ / tin nhắn cũ
    this.api.listener.on("old_messages", (messages: Message[]) => {
      for (const msg of messages) {
        this.dispatcher.dispatchMessage(msg);
      }
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
  }

  /**
   * Lập lịch tự động kết nối lại với thuật toán Exponential Backoff + Jitter
   */
  private async scheduleReconnect(code: CloseReason, reason: string): Promise<void> {
    if (this.isDestroyed) {
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Nếu đã thử nhiều lần liên tiếp thất bại: Kiểm tra xem session còn hợp lệ không
    if (this.reconnectAttempt >= 3) {
      console.log("🔍 [Zalo Listener] Đang kiểm tra tính hợp lệ của Cookie/Session...");
      const isSessionAlive = await validateSessionHealth(this.api);
      if (!isSessionAlive) {
        console.error(
          "🚨 [Zalo Listener] Cookie/Session đã hết hạn hoặc bị đăng xuất từ thiết bị khác!"
        );
        this.connectionState = "session_expired";
        this.lastError = "Session đã hết hạn hoặc bị thu hồi";
        this.emitState();

        // Kích hoạt các callback yêu cầu cấp lại phiên
        for (const cb of this.sessionExpiredCallbacks) {
          try {
            await cb();
          } catch (err) {
            console.error("❌ Lỗi khi thực thi callback onSessionExpired:", err);
          }
        }
        return;
      }
    }

    // Tính toán thời gian chờ Backoff
    let delay: number;
    let reasonText: string | null = null;

    if (code === CloseReason.DuplicateConnection) {
      // Nếu là mã 3000 (xung đột Zalo Web): Chờ cooldown an toàn để tránh kick loop
      delay = this.duplicateCooldownMs;
      reasonText = "Phát hiện Zalo Web đang mở ở thiết bị khác";
      this.cooldownReason = reasonText;
      console.warn(
        `⏳ [Zalo Listener] Tạm dừng kết nối trong ${delay / 1000}s để tránh xung đột với Zalo Web...`
      );
    } else {
      this.cooldownReason = null;
      // Exponential Backoff: delay = base * 1.8^attempt + random_jitter
      const exponent = Math.min(this.reconnectAttempt, 6);
      const jitter = Math.floor(Math.random() * 1000);
      delay = Math.min(
        Math.floor(this.baseDelayMs * Math.pow(1.8, exponent)) + jitter,
        this.maxDelayMs
      );
    }

    // Kiểm tra ngưỡng thử lại
    if (this.reconnectAttempt >= this.maxReconnectAttempts) {
      console.warn(
        `⚠️ [Zalo Listener] Đã đạt giới hạn thử lại (${this.maxReconnectAttempts} lần). Sẽ thử lại sau chu kỳ ${
          this.maxDelayMs / 1000
        }s...`
      );
      delay = this.maxDelayMs;
      this.reconnectAttempt = 1;
    } else {
      this.reconnectAttempt++;
    }

    this.connectionState = "reconnecting";
    this.emitState({ nextRetryInMs: delay, cooldownReason: reasonText });

    console.log(
      `🔄 [Zalo Listener] Tự động kết nối lại lần ${this.reconnectAttempt}/${this.maxReconnectAttempts} sau ${(
        delay / 1000
      ).toFixed(1)} giây...`
    );

    this.reconnectTimer = setTimeout(async () => {
      await this.performReconnect();
    }, delay);
  }

  /**
   * Thực hiện khởi động lại WebSocket Socket
   */
  private async performReconnect(): Promise<void> {
    if (this.isDestroyed) {
      return;
    }

    console.log("🌐 [Zalo Listener] Đang kích hoạt lại kết nối WebSocket...");

    try {
      // 1. Reset bộ đếm retry nội bộ của zca-js nếu có để tránh bị zca-js canRetry chặn
      const listenerAny = this.api.listener as unknown as {
        ws?: unknown;
        retryCount?: Record<string, { count: number }>;
      };
      if (listenerAny && listenerAny.retryCount) {
        for (const key of Object.keys(listenerAny.retryCount)) {
          if (listenerAny.retryCount[key]) {
            listenerAny.retryCount[key].count = 0;
          }
        }
      }

      // 2. Dọn dẹp socket cũ nếu chưa đóng hoàn toàn
      if (listenerAny && listenerAny.ws) {
        try {
          this.api.listener.stop();
        } catch {}
      }

      // 3. Bắt đầu lắng nghe lại
      this.api.listener.start({ retryOnClose: true });
    } catch (error: unknown) {
      const err = error as Error;
      console.error("❌ [Zalo Listener] Thử kết nối lại thất bại:", err.message);
      this.lastError = err.message;
      this.scheduleReconnect(CloseReason.AbnormalClosure, err.message);
    }
  }

  /**
   * Khởi chạy Listener lần đầu
   */
  public start(): void {
    if (this.isRunning) {
      console.warn("⚠️ Listener đang chạy!");
      return;
    }

    this.isDestroyed = false;
    this.setupEventListeners();

    console.log("🌐 Đang khởi động Zalo WebSocket Listener...");
    try {
      this.api.listener.start({ retryOnClose: true });
    } catch (error: unknown) {
      const err = error as Error;
      console.error("❌ Lỗi khi khởi động Listener ban đầu:", err.message);
      this.lastError = err.message;
      this.scheduleReconnect(CloseReason.AbnormalClosure, err.message);
    }
  }

  /**
   * Dừng Listener an toàn (Graceful Shutdown)
   */
  public stop(): void {
    this.isDestroyed = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }

    if (!this.isRunning) {
      this.connectionState = "disconnected";
      this.emitState();
      return;
    }

    console.log("🛑 Đang dừng Zalo WebSocket Listener...");
    try {
      this.api.listener.stop();
    } catch {}
    this.isRunning = false;
    this.connectionState = "disconnected";
    this.emitState();
    console.log("⏹️ Đã dừng Listener thành công.");
  }
}


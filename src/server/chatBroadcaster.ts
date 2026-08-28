import { EventEmitter } from "node:events";
import type { ChatMessageRecord } from "../database/repositories/chatHistoryRepository.js";

/**
 * ChatBroadcaster: Quản lý phát sự kiện tin nhắn thời gian thực (Realtime Event Bus)
 * Hỗ trợ Server-Sent Events (SSE) đẩy tin nhắn tức thì tới trình duyệt mà không cần polling.
 */
class ChatBroadcasterEmitter extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
  }

  /**
   * Phát sự kiện tin nhắn mới (cho cả toàn bộ hệ thống và riêng từng thread)
   */
  public broadcast(record: ChatMessageRecord): void {
    this.emit("message", record);
    if (record.threadId) {
      this.emit(`message:${record.threadId}`, record);
    }
  }

  /**
   * Đăng ký lắng nghe tin nhắn của một thread cụ thể
   * @returns Hàm huỷ đăng ký (unsubscribe)
   */
  public onThreadMessage(
    threadId: string,
    listener: (record: ChatMessageRecord) => void
  ): () => void {
    const eventName = `message:${threadId}`;
    this.on(eventName, listener);
    return () => {
      this.off(eventName, listener);
    };
  }

  /**
   * Phát sự kiện đổi tên thread thời gian thực
   */
  public broadcastThreadRenamed(threadId: string, newName: string): void {
    const data = { type: "thread_renamed", threadId, newName };
    this.emit("thread_renamed", data);
    if (threadId) {
      this.emit(`thread_renamed:${threadId}`, data);
    }
  }

  /**
   * Đăng ký lắng nghe sự kiện đổi tên của một thread cụ thể
   */
  public onThreadRename(
    threadId: string,
    listener: (data: { type: string; threadId: string; newName: string }) => void
  ): () => void {
    const eventName = `thread_renamed:${threadId}`;
    this.on(eventName, listener);
    return () => {
      this.off(eventName, listener);
    };
  }
}

export const chatBroadcaster = new ChatBroadcasterEmitter();

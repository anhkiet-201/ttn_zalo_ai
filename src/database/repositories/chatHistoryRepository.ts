import { SQLiteDatabase } from "../sqliteDb.js";
import { config } from "../../config/index.js";
import { chatBroadcaster } from "../../server/chatBroadcaster.js";
import crypto from "node:crypto";

export interface ChatMessageRecord {
  id?: string;
  threadId: string;
  senderId: string;
  senderName: string;
  role: "user" | "model";
  content: string;
  hasImage?: boolean;
  imageUrls?: string[];
  timestamp: number;
}

/**
 * ChatHistoryRepository: Quản lý đọc/ghi lịch sử hội thoại trên SQLite Database
 */
export class ChatHistoryRepository {
  private db: SQLiteDatabase;

  constructor(db?: SQLiteDatabase) {
    this.db = db || SQLiteDatabase.getInstance();
  }

  /**
   * Lưu một tin nhắn mới vào SQLite và phát sự kiện Realtime tới Web Chat
   */
  public addMessage(record: ChatMessageRecord): void {
    // Chống duplicate: kiểm tra xem tin nhắn cùng thread, cùng role và nội dung/ảnh đã tồn tại chưa
    try {
      let existing: any = null;
      if (record.hasImage) {
        // Đối với tin nhắn có ảnh, chống trùng lặp trong vòng 15 giây
        const checkImageStmt = this.db.connection.prepare(`
          SELECT id FROM chat_messages 
          WHERE thread_id = ? AND role = ? AND has_image = 1 AND abs(timestamp - ?) < 15000 
          LIMIT 1
        `);
        existing = checkImageStmt.get(record.threadId, record.role, record.timestamp);
      } else if (record.content && record.content.trim()) {
        // Đối với tin nhắn chữ, chống trùng lặp cùng nội dung trong vòng 10 giây
        const checkTextStmt = this.db.connection.prepare(`
          SELECT id FROM chat_messages 
          WHERE thread_id = ? AND role = ? AND content = ? AND abs(timestamp - ?) < 10000 
          LIMIT 1
        `);
        existing = checkTextStmt.get(record.threadId, record.role, record.content, record.timestamp);
      }

      if (existing) {
        // Đã có tin nhắn này, bỏ qua để tránh trùng lặp bản ghi và duplicate SSE
        return;
      }
    } catch {
      // Bỏ qua lỗi check
    }

    const id = record.id || crypto.randomUUID();
    const stmt = this.db.connection.prepare(`
      INSERT INTO chat_messages (
        id, thread_id, sender_id, sender_name, role, content, has_image, image_urls, timestamp
      ) VALUES (
        @id, @thread_id, @sender_id, @sender_name, @role, @content, @has_image, @image_urls, @timestamp
      )
    `);

    stmt.run({
      id,
      thread_id: record.threadId,
      sender_id: record.senderId,
      sender_name: record.senderName,
      role: record.role,
      content: record.content,
      has_image: record.hasImage ? 1 : 0,
      image_urls: record.imageUrls ? JSON.stringify(record.imageUrls) : null,
      timestamp: record.timestamp,
    });

    // Phát sự kiện Realtime tới tất cả các client đang kết nối SSE
    try {
      chatBroadcaster.broadcast({
        ...record,
        id,
      });
    } catch (err) {
      console.warn("⚠️ Lỗi khi phát sự kiện Realtime tin nhắn:", err);
    }
  }

  /**
   * Lấy danh sách N tin nhắn gần nhất của một thread (được sắp xếp theo thứ tự thời gian tăng dần từ cũ đến mới)
   */
  public getRecentHistory(
    threadId: string,
    limit: number = config.chatHistoryLimit
  ): ChatMessageRecord[] {
    const stmt = this.db.connection.prepare(`
      SELECT 
        id, thread_id as threadId, sender_id as senderId, sender_name as senderName,
        role, content, has_image as hasImage, image_urls as imageUrls, timestamp
      FROM chat_messages
      WHERE thread_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    const rows = stmt.all(threadId, limit) as Array<{
      id: string;
      threadId: string;
      senderId: string;
      senderName: string;
      role: "user" | "model";
      content: string;
      hasImage: number;
      imageUrls: string | null;
      timestamp: number;
    }>;

    // Đảo ngược mảng để trả về thứ tự từ cũ đến mới phục vụ Gemini Context và Web Chat
    return rows
      .reverse()
      .map((row) => {
        let parsedUrls: string[] | undefined = undefined;
        try {
          if (row.imageUrls) {
            const raw = JSON.parse(row.imageUrls);
            parsedUrls = Array.isArray(raw) ? raw : [String(raw)];
          }
        } catch {
          if (row.imageUrls) {
            parsedUrls = [row.imageUrls];
          }
        }

        return {
          id: row.id,
          threadId: row.threadId,
          senderId: row.senderId,
          senderName: row.senderName,
          role: row.role,
          content: row.content || "",
          hasImage: Boolean(row.hasImage),
          imageUrls: parsedUrls,
          timestamp: row.timestamp,
        };
      });
  }

  /**
   * Xóa toàn bộ lịch sử trò chuyện của một thread
   */
  public clearHistory(threadId: string): void {
    const stmt = this.db.connection.prepare(`
      DELETE FROM chat_messages WHERE thread_id = ?
    `);
    stmt.run(threadId);
  }

  /**
   * Dọn dẹp các tin nhắn quá cũ, chỉ giữ lại số lượng tin nhắn mới nhất
   */
  public trimOldMessages(threadId: string, keepCount: number = 50): void {
    const stmt = this.db.connection.prepare(`
      DELETE FROM chat_messages 
      WHERE thread_id = ? AND id NOT IN (
        SELECT id FROM chat_messages 
        WHERE thread_id = ? 
        ORDER BY timestamp DESC 
        LIMIT ?
      )
    `);
    stmt.run(threadId, threadId, keepCount);
  }
}

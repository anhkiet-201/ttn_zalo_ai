import { SQLiteDatabase } from "../sqliteDb.js";
import { config } from "../../config/index.js";
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
   * Lưu một tin nhắn mới vào SQLite
   */
  public addMessage(record: ChatMessageRecord): void {
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

    // Đảo ngược mảng để trả về thứ tự từ cũ đến mới phục vụ Gemini Context
    return rows
      .reverse()
      .map((row) => ({
        id: row.id,
        threadId: row.threadId,
        senderId: row.senderId,
        senderName: row.senderName,
        role: row.role,
        content: row.content,
        hasImage: Boolean(row.hasImage),
        imageUrls: row.imageUrls ? JSON.parse(row.imageUrls) : undefined,
        timestamp: row.timestamp,
      }));
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

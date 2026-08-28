import { SQLiteDatabase } from "../sqliteDb.js";
import { config } from "../../config/index.js";
import { chatBroadcaster } from "../../server/chatBroadcaster.js";
import crypto from "node:crypto";

export interface ChatMessageRecord {
  id?: string;
  threadId: string;
  senderId: string;
  senderName?: string;
  role: "user" | "model";
  content: string;
  hasImage?: boolean;
  imageUrls?: string[];
  hasQuote?: boolean;
  quoteText?: string;
  quoteSenderName?: string;
  quoteSenderId?: string;
  timestamp: number;
}

export interface ThreadListItem {
  threadId: string;
  senderName: string;
  senderId: string;
  lastContent: string;
  lastHasImage: boolean;
  lastTimestamp: number;
  lastRole: "user" | "model";
  candidateName?: string;
  targetCompany?: string;
  phoneNumber?: string;
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
        id, thread_id, sender_id, sender_name, role, content, has_image, image_urls,
        has_quote, quote_text, quote_sender_name, quote_sender_id, timestamp
      ) VALUES (
        @id, @thread_id, @sender_id, @sender_name, @role, @content, @has_image, @image_urls,
        @has_quote, @quote_text, @quote_sender_name, @quote_sender_id, @timestamp
      )
    `);

    stmt.run({
      id,
      thread_id: record.threadId,
      sender_id: record.senderId,
      sender_name: record.senderName || "",
      role: record.role,
      content: record.content,
      has_image: record.hasImage ? 1 : 0,
      image_urls: record.imageUrls ? JSON.stringify(record.imageUrls) : null,
      has_quote: record.hasQuote ? 1 : 0,
      quote_text: record.quoteText || null,
      quote_sender_name: record.quoteSenderName || null,
      quote_sender_id: record.quoteSenderId || null,
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
        role, content, has_image as hasImage, image_urls as imageUrls,
        has_quote as hasQuote, quote_text as quoteText,
        quote_sender_name as quoteSenderName, quote_sender_id as quoteSenderId,
        timestamp
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
      hasQuote: number;
      quoteText: string | null;
      quoteSenderName: string | null;
      quoteSenderId: string | null;
      timestamp: number;
    }>;

    return rows.reverse().map((row) => this.mapMessageRow(row));
  }

  /**
   * Lấy danh sách tin nhắn cũ hơn một mốc thời gian (phục vụ Lazy Load khi cuộn lên trên)
   */
  public getHistoryBefore(
    threadId: string,
    beforeTimestamp: number,
    limit: number = 30
  ): ChatMessageRecord[] {
    const stmt = this.db.connection.prepare(`
      SELECT 
        id, thread_id as threadId, sender_id as senderId, sender_name as senderName,
        role, content, has_image as hasImage, image_urls as imageUrls,
        has_quote as hasQuote, quote_text as quoteText,
        quote_sender_name as quoteSenderName, quote_sender_id as quoteSenderId,
        timestamp
      FROM chat_messages
      WHERE thread_id = ? AND timestamp < ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    const rows = stmt.all(threadId, beforeTimestamp, limit) as Array<{
      id: string;
      threadId: string;
      senderId: string;
      senderName: string;
      role: "user" | "model";
      content: string;
      hasImage: number;
      imageUrls: string | null;
      hasQuote: number;
      quoteText: string | null;
      quoteSenderName: string | null;
      quoteSenderId: string | null;
      timestamp: number;
    }>;

    return rows.reverse().map((row) => this.mapMessageRow(row));
  }

  /**
   * Lấy danh sách các cuộc trò chuyện (Threads) phân trang có tin nhắn mới nhất
   */
  public getThreadList(
    limit: number = 20,
    offset: number = 0,
    search?: string
  ): ThreadListItem[] {
    let query = `
      SELECT 
        m.thread_id as threadId,
        m.sender_name as senderName,
        m.sender_id as senderId,
        m.content as lastContent,
        m.has_image as lastHasImage,
        m.timestamp as lastTimestamp,
        m.role as lastRole,
        c.full_name as candidateName,
        c.target_company as targetCompany,
        c.phone_number as phoneNumber
      FROM chat_messages m
      INNER JOIN (
        SELECT thread_id, MAX(timestamp) as max_ts
        FROM chat_messages
        GROUP BY thread_id
      ) latest ON m.thread_id = latest.thread_id AND m.timestamp = latest.max_ts
      LEFT JOIN candidates c ON m.thread_id = c.thread_id
    `;

    const params: any[] = [];
    if (search && search.trim()) {
      const searchTerm = `%${search.trim().toLowerCase()}%`;
      query += `
        WHERE (
          LOWER(m.thread_id) LIKE ? OR
          LOWER(m.sender_name) LIKE ? OR
          LOWER(m.content) LIKE ? OR
          LOWER(COALESCE(c.full_name, '')) LIKE ? OR
          LOWER(COALESCE(c.phone_number, '')) LIKE ? OR
          LOWER(COALESCE(c.target_company, '')) LIKE ?
        )
      `;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    query += `
      GROUP BY m.thread_id
      ORDER BY latest.max_ts DESC
      LIMIT ? OFFSET ?
    `;
    params.push(limit, offset);

    const stmt = this.db.connection.prepare(query);
    const rows = stmt.all(...params) as Array<{
      threadId: string;
      senderName: string;
      senderId: string;
      lastContent: string;
      lastHasImage: number;
      lastTimestamp: number;
      lastRole: "user" | "model";
      candidateName?: string;
      targetCompany?: string;
      phoneNumber?: string;
    }>;

    return rows.map((r) => ({
      threadId: r.threadId,
      senderName: r.senderName || "",
      senderId: r.senderId || "",
      lastContent: r.lastContent || "",
      lastHasImage: Boolean(r.lastHasImage),
      lastTimestamp: r.lastTimestamp,
      lastRole: r.lastRole,
      candidateName: r.candidateName || undefined,
      targetCompany: r.targetCompany || undefined,
      phoneNumber: r.phoneNumber || undefined,
    }));
  }

  /**
   * Đếm tổng số lượng cuộc trò chuyện duy nhất
   */
  public getTotalThreadsCount(search?: string): number {
    let query = `
      SELECT COUNT(DISTINCT m.thread_id) as total
      FROM chat_messages m
      LEFT JOIN candidates c ON m.thread_id = c.thread_id
    `;
    const params: any[] = [];
    if (search && search.trim()) {
      const searchTerm = `%${search.trim().toLowerCase()}%`;
      query += `
        WHERE (
          LOWER(m.thread_id) LIKE ? OR
          LOWER(m.sender_name) LIKE ? OR
          LOWER(m.content) LIKE ? OR
          LOWER(COALESCE(c.full_name, '')) LIKE ? OR
          LOWER(COALESCE(c.phone_number, '')) LIKE ? OR
          LOWER(COALESCE(c.target_company, '')) LIKE ?
        )
      `;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    const stmt = this.db.connection.prepare(query);
    const result = stmt.get(...params) as { total: number } | undefined;
    return result?.total || 0;
  }

  /**
   * Helper parse row SQLite sang ChatMessageRecord
   */
  private mapMessageRow(row: {
    id: string;
    threadId: string;
    senderId: string;
    senderName: string;
    role: "user" | "model";
    content: string;
    hasImage: number;
    imageUrls: string | null;
    hasQuote?: number;
    quoteText?: string | null;
    quoteSenderName?: string | null;
    quoteSenderId?: string | null;
    timestamp: number;
  }): ChatMessageRecord {
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
      hasQuote: Boolean(row.hasQuote),
      quoteText: row.quoteText || undefined,
      quoteSenderName: row.quoteSenderName || undefined,
      quoteSenderId: row.quoteSenderId || undefined,
      timestamp: row.timestamp,
    };
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

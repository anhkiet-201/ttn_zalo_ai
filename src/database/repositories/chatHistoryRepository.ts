import { SQLiteDatabase } from "../sqliteDb.js";
import { config } from "../../config/index.js";
import { chatBroadcaster } from "../../server/chatBroadcaster.js";
import crypto from "node:crypto";
import { type MediaType, type MediaItem } from "../../types/zalo.types.js";

export type ThreadFilter = "all" | "personal" | "direct" | "group" | "manual";

export interface ChatMessageRecord {
  id?: string;
  threadId: string;
  senderId: string;
  senderName?: string;
  role: "user" | "model";
  content: string;
  mediaType?: MediaType;
  mediaUrls?: MediaItem[];
  hasQuote?: boolean;
  quoteText?: string;
  quoteSenderName?: string;
  quoteSenderId?: string;
  isGroup?: boolean;
  timestamp: number;
}

export interface ThreadListItem {
  threadId: string;
  senderName: string;
  senderId: string;
  lastContent: string;
  lastMediaType?: MediaType;
  lastTimestamp: number;
  lastRole: "user" | "model";
  isGroup: boolean;
  isManual?: boolean;
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
    const id = record.id || crypto.randomUUID();
    const mediaType = record.mediaType || null;
    const mediaUrls = record.mediaUrls && record.mediaUrls.length > 0 ? record.mediaUrls : undefined;

    // Chống duplicate: kiểm tra xem tin nhắn cùng thread, cùng role và nội dung/media đã tồn tại trong 5s chưa
    try {
      let existing: { id: string } | undefined;

      if (record.id) {
        const checkIdStmt = this.db.connection.prepare(`
          SELECT id FROM chat_messages WHERE id = ? LIMIT 1
        `);
        existing = checkIdStmt.get(record.id) as { id: string } | undefined;
      }

      if (!existing) {
        if (mediaType && mediaUrls && mediaUrls.length > 0) {
          const primaryUrl = mediaUrls[0]?.url || mediaUrls[0]?.id;
          if (primaryUrl) {
            const checkMediaStmt = this.db.connection.prepare(`
              SELECT id FROM chat_messages 
              WHERE thread_id = ? AND role = ? AND media_type = ? AND media_urls LIKE ? AND abs(timestamp - ?) < 5000 
              LIMIT 1
            `);
            existing = checkMediaStmt.get(
              record.threadId,
              record.role,
              mediaType,
              `%${primaryUrl}%`,
              record.timestamp
            ) as { id: string } | undefined;
          }
        } else if (record.content && record.content.trim()) {
          const checkTextStmt = this.db.connection.prepare(`
            SELECT id FROM chat_messages 
            WHERE thread_id = ? AND role = ? AND TRIM(content) = ? AND abs(timestamp - ?) < 5000 
            LIMIT 1
          `);
          existing = checkTextStmt.get(
            record.threadId,
            record.role,
            record.content.trim(),
            record.timestamp
          ) as { id: string } | undefined;
        }
      }

      if (existing) {
        const updateStmt = this.db.connection.prepare(`
          UPDATE chat_messages SET
            content = @content,
            media_type = @media_type,
            media_urls = @media_urls
          WHERE id = @id
        `);
        updateStmt.run({
          id: existing.id,
          content: record.content || "",
          media_type: mediaType,
          media_urls: mediaUrls ? JSON.stringify(mediaUrls) : null,
        });

        try {
          chatBroadcaster.broadcast({
            ...record,
            id: existing.id,
            mediaType,
            mediaUrls,
          });
        } catch {}
        return;
      }
    } catch {}

    const stmt = this.db.connection.prepare(`
      INSERT INTO chat_messages (
        id, thread_id, sender_id, sender_name, role, content,
        media_type, media_urls,
        has_quote, quote_text, quote_sender_name, quote_sender_id, is_group, timestamp
      ) VALUES (
        @id, @thread_id, @sender_id, @sender_name, @role, @content,
        @media_type, @media_urls,
        @has_quote, @quote_text, @quote_sender_name, @quote_sender_id, @is_group, @timestamp
      )
    `);

    stmt.run({
      id,
      thread_id: record.threadId,
      sender_id: record.senderId,
      sender_name: record.senderName || "",
      role: record.role,
      content: record.content || "",
      media_type: mediaType,
      media_urls: mediaUrls ? JSON.stringify(mediaUrls) : null,
      has_quote: record.hasQuote ? 1 : 0,
      quote_text: record.quoteText || null,
      quote_sender_name: record.quoteSenderName || null,
      quote_sender_id: record.quoteSenderId || null,
      is_group: record.isGroup ? 1 : 0,
      timestamp: record.timestamp,
    });

    try {
      chatBroadcaster.broadcast({
        ...record,
        id,
        mediaType,
        mediaUrls,
      });
    } catch (err) {
      console.warn("⚠️ Lỗi khi phát sự kiện Realtime tin nhắn:", err);
    }
  }

  /**
   * Cập nhật cờ is_group cho toàn bộ tin nhắn thuộc một thread
   */
  public updateThreadIsGroup(threadId: string, isGroup: boolean): void {
    try {
      const stmt = this.db.connection.prepare(`
        UPDATE chat_messages 
        SET is_group = ? 
        WHERE thread_id = ? AND is_group != ?
      `);
      stmt.run(isGroup ? 1 : 0, threadId, isGroup ? 1 : 0);
    } catch (err) {
      console.warn(`⚠️ Không thể cập nhật is_group cho thread ${threadId}:`, err);
    }
  }

  /**
   * Lấy danh sách N tin nhắn gần nhất của một thread
   */
  public getRecentHistory(
    threadId: string,
    limit: number = config.chatHistoryLimit
  ): ChatMessageRecord[] {
    const stmt = this.db.connection.prepare(`
      SELECT 
        id, thread_id as threadId, sender_id as senderId, sender_name as senderName,
        role, content, media_type as mediaType, media_urls as mediaUrls,
        has_quote as hasQuote, quote_text as quoteText,
        quote_sender_name as quoteSenderName, quote_sender_id as quoteSenderId,
        is_group as isGroup, timestamp
      FROM chat_messages
      WHERE thread_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    const rows = stmt.all(threadId, limit) as Array<any>;
    return rows.reverse().map((row) => this.mapMessageRow(row));
  }

  /**
   * Lấy một tin nhắn theo ID
   */
  public getMessageById(id: string): ChatMessageRecord | null {
    if (!id) return null;
    try {
      const stmt = this.db.connection.prepare(`
        SELECT 
          id, thread_id as threadId, sender_id as senderId, sender_name as senderName,
          role, content, media_type as mediaType, media_urls as mediaUrls,
          has_quote as hasQuote, quote_text as quoteText,
          quote_sender_name as quoteSenderName, quote_sender_id as quoteSenderId,
          is_group as isGroup, timestamp
        FROM chat_messages
        WHERE id = ?
        LIMIT 1
      `);
      const row = stmt.get(id) as any;
      return row ? this.mapMessageRow(row) : null;
    } catch {
      return null;
    }
  }

  /**
   * Tìm tin nhắn được trích dẫn (Quote) trong cùng một thread:
   * 1. Tìm theo msgId / cliMsgId / globalMsgId
   * 2. Nếu không thấy ID, tìm tin nhắn gần nhất của người được trích dẫn (quoteOwnerId)
   */
  public findQuotedMessage(
    threadId: string,
    quoteMsgId?: string,
    quoteOwnerId?: string,
    quoteTs?: number
  ): ChatMessageRecord | null {
    if (!threadId) return null;

    // 1. Thử tìm bằng quoteMsgId nếu có
    if (quoteMsgId) {
      const msg = this.getMessageById(quoteMsgId);
      if (msg && msg.threadId === threadId) {
        return msg;
      }
    }

    // 2. Thử tìm tin nhắn theo senderId và timestamp xấp xỉ
    if (quoteOwnerId && quoteTs) {
      try {
        const stmt = this.db.connection.prepare(`
          SELECT 
            id, thread_id as threadId, sender_id as senderId, sender_name as senderName,
            role, content, media_type as mediaType, media_urls as mediaUrls,
            has_quote as hasQuote, quote_text as quoteText,
            quote_sender_name as quoteSenderName, quote_sender_id as quoteSenderId,
            is_group as isGroup, timestamp
          FROM chat_messages
          WHERE thread_id = ? AND sender_id = ? AND abs(timestamp - ?) < 30000
          ORDER BY abs(timestamp - ?) ASC
          LIMIT 1
        `);
        const row = stmt.get(threadId, quoteOwnerId, quoteTs, quoteTs) as any;
        if (row) return this.mapMessageRow(row);
      } catch {}
    }

    // 3. Fallback: Lấy tin nhắn gần nhất của người gửi đó trong thread
    if (quoteOwnerId) {
      try {
        const stmt = this.db.connection.prepare(`
          SELECT 
            id, thread_id as threadId, sender_id as senderId, sender_name as senderName,
            role, content, media_type as mediaType, media_urls as mediaUrls,
            has_quote as hasQuote, quote_text as quoteText,
            quote_sender_name as quoteSenderName, quote_sender_id as quoteSenderId,
            is_group as isGroup, timestamp
          FROM chat_messages
          WHERE thread_id = ? AND sender_id = ?
          ORDER BY timestamp DESC
          LIMIT 1
        `);
        const row = stmt.get(threadId, quoteOwnerId) as any;
        if (row) return this.mapMessageRow(row);
      } catch {}
    }

    return null;
  }

  /**
   * Cập nhật content và media_urls cho một tin nhắn đã lưu (sau khi AI phân tích xong)
   */
  public updateMessageContentAndMedia(
    id: string,
    content: string,
    mediaUrls?: MediaItem[]
  ): void {
    if (!id) return;
    try {
      const stmt = this.db.connection.prepare(`
        UPDATE chat_messages
        SET content = ?, media_urls = ?
        WHERE id = ?
      `);
      stmt.run(
        content || "",
        mediaUrls && mediaUrls.length > 0 ? JSON.stringify(mediaUrls) : null,
        id
      );
    } catch (err) {
      console.warn(`⚠️ Không thể cập nhật content/media cho message ${id}:`, err);
    }
  }

  /**
   * Lấy danh sách tin nhắn cũ hơn một mốc thời gian (phục vụ Lazy Load)
   */
  public getHistoryBefore(
    threadId: string,
    beforeTimestamp: number,
    limit: number = 30
  ): ChatMessageRecord[] {
    const stmt = this.db.connection.prepare(`
      SELECT 
        id, thread_id as threadId, sender_id as senderId, sender_name as senderName,
        role, content, media_type as mediaType, media_urls as mediaUrls,
        has_quote as hasQuote, quote_text as quoteText,
        quote_sender_name as quoteSenderName, quote_sender_id as quoteSenderId,
        is_group as isGroup, timestamp
      FROM chat_messages
      WHERE thread_id = ? AND timestamp < ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    const rows = stmt.all(threadId, beforeTimestamp, limit) as Array<any>;
    return rows.reverse().map((row) => this.mapMessageRow(row));
  }

  /**
   * Lấy danh sách các cuộc trò chuyện (Threads) phân trang có tin nhắn mới nhất
   */
  public getThreadList(
    limit: number = 20,
    offset: number = 0,
    search?: string,
    filter: ThreadFilter = "all"
  ): ThreadListItem[] {
    let query = `
      SELECT 
        m.thread_id as threadId,
        COALESCE(tm.custom_name, c.full_name, m.sender_name) as senderName,
        m.sender_id as senderId,
        m.content as lastContent,
        m.media_type as lastMediaType,
        m.timestamp as lastTimestamp,
        m.role as lastRole,
        COALESCE(tm.is_group, m.is_group) as isGroup,
        COALESCE(tm.is_manual, CASE WHEN COALESCE(tm.custom_name, '') LIKE '-M%' OR COALESCE(tm.custom_name, '') LIKE '-m%' OR COALESCE(c.full_name, '') LIKE '-M%' OR COALESCE(c.full_name, '') LIKE '-m%' THEN 1 ELSE 0 END) as isManual,
        c.full_name as candidateName,
        c.target_company as targetCompany,
        c.phone_number as phoneNumber
      FROM (
        SELECT 
          id, thread_id, sender_id, sender_name, content, media_type,
          MAX(timestamp) as timestamp, role, is_group
        FROM chat_messages
        GROUP BY thread_id
      ) m
      LEFT JOIN (
        SELECT thread_id, full_name, target_company, phone_number, MAX(created_at)
        FROM candidates
        GROUP BY thread_id
      ) c ON m.thread_id = c.thread_id
      LEFT JOIN thread_metadata tm ON m.thread_id = tm.thread_id
      WHERE 1=1
    `;

    const params: (string | number)[] = [];

    if (search && search.trim()) {
      const searchTerm = `%${search.trim().toLowerCase()}%`;
      query += `
        AND (
          LOWER(m.thread_id) LIKE ? OR
          LOWER(COALESCE(tm.custom_name, '')) LIKE ? OR
          LOWER(COALESCE(m.sender_name, '')) LIKE ? OR
          LOWER(COALESCE(m.content, '')) LIKE ? OR
          LOWER(COALESCE(c.full_name, '')) LIKE ? OR
          LOWER(COALESCE(c.phone_number, '')) LIKE ? OR
          LOWER(COALESCE(c.target_company, '')) LIKE ?
        )
      `;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    if (filter === "direct" || filter === "personal") {
      query += ` 
        AND COALESCE(tm.is_group, m.is_group) = 0 
        AND COALESCE(tm.is_manual, 0) = 0
        AND COALESCE(tm.custom_name, '') NOT LIKE '-M%'
        AND COALESCE(tm.custom_name, '') NOT LIKE '-m%'
        AND COALESCE(c.full_name, '') NOT LIKE '-M%'
        AND COALESCE(c.full_name, '') NOT LIKE '-m%'
      `;
    } else if (filter === "group") {
      query += ` 
        AND COALESCE(tm.is_group, m.is_group) = 1 
      `;
    } else if (filter === "manual") {
      query += ` 
        AND COALESCE(tm.is_group, m.is_group) = 0
        AND (
          COALESCE(tm.is_manual, 0) = 1 OR
          COALESCE(tm.custom_name, '') LIKE '-M%' OR
          COALESCE(tm.custom_name, '') LIKE '-m%' OR
          COALESCE(c.full_name, '') LIKE '-M%' OR
          COALESCE(c.full_name, '') LIKE '-m%'
        )
      `;
    }

    query += `
      ORDER BY m.timestamp DESC
      LIMIT ? OFFSET ?
    `;
    params.push(limit, offset);

    const stmt = this.db.connection.prepare(query);
    const rows = stmt.all(...params) as Array<{
      threadId: string;
      senderName: string;
      senderId: string;
      lastContent: string;
      lastMediaType?: MediaType;
      lastTimestamp: number;
      lastRole: "user" | "model";
      isGroup: number;
      isManual: number;
      candidateName?: string;
      targetCompany?: string;
      phoneNumber?: string;
    }>;

    return rows.map((r) => ({
      threadId: r.threadId,
      senderName: r.senderName || "",
      senderId: r.senderId || "",
      lastContent: r.lastContent || "",
      lastMediaType: r.lastMediaType || null,
      lastTimestamp: r.lastTimestamp,
      lastRole: r.lastRole,
      isGroup: Boolean(r.isGroup),
      isManual: Boolean(r.isManual),
      candidateName: r.candidateName || undefined,
      targetCompany: r.targetCompany || undefined,
      phoneNumber: r.phoneNumber || undefined,
    }));
  }

  /**
   * Đếm tổng số lượng cuộc trò chuyện duy nhất theo bộ lọc
   */
  public getTotalThreadsCount(search?: string, filter: ThreadFilter = "all"): number {
    let query = `
      SELECT COUNT(DISTINCT m.thread_id) as total
      FROM (
        SELECT thread_id, sender_name, content, MAX(timestamp) as timestamp, is_group
        FROM chat_messages
        GROUP BY thread_id
      ) m
      LEFT JOIN (
        SELECT thread_id, full_name, target_company, phone_number, MAX(created_at)
        FROM candidates
        GROUP BY thread_id
      ) c ON m.thread_id = c.thread_id
      LEFT JOIN thread_metadata tm ON m.thread_id = tm.thread_id
      WHERE 1=1
    `;
    const params: (string | number)[] = [];
    if (search && search.trim()) {
      const searchTerm = `%${search.trim().toLowerCase()}%`;
      query += `
        AND (
          LOWER(m.thread_id) LIKE ? OR
          LOWER(COALESCE(tm.custom_name, '')) LIKE ? OR
          LOWER(COALESCE(m.sender_name, '')) LIKE ? OR
          LOWER(COALESCE(m.content, '')) LIKE ? OR
          LOWER(COALESCE(c.full_name, '')) LIKE ? OR
          LOWER(COALESCE(c.phone_number, '')) LIKE ? OR
          LOWER(COALESCE(c.target_company, '')) LIKE ?
        )
      `;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    if (filter === "direct" || filter === "personal") {
      query += ` 
        AND COALESCE(tm.is_group, m.is_group) = 0 
        AND COALESCE(tm.is_manual, 0) = 0
        AND COALESCE(tm.custom_name, '') NOT LIKE '-M%'
        AND COALESCE(tm.custom_name, '') NOT LIKE '-m%'
        AND COALESCE(c.full_name, '') NOT LIKE '-M%'
        AND COALESCE(c.full_name, '') NOT LIKE '-m%'
      `;
    } else if (filter === "group") {
      query += ` 
        AND COALESCE(tm.is_group, m.is_group) = 1 
      `;
    } else if (filter === "manual") {
      query += ` 
        AND COALESCE(tm.is_group, m.is_group) = 0
        AND (
          COALESCE(tm.is_manual, 0) = 1 OR
          COALESCE(tm.custom_name, '') LIKE '-M%' OR
          COALESCE(tm.custom_name, '') LIKE '-m%' OR
          COALESCE(c.full_name, '') LIKE '-M%' OR
          COALESCE(c.full_name, '') LIKE '-m%'
        )
      `;
    }

    const stmt = this.db.connection.prepare(query);
    const result = stmt.get(...params) as { total: number } | undefined;
    return result?.total || 0;
  }

  /**
   * Helper map SQLite row -> ChatMessageRecord
   */
  private mapMessageRow(row: {
    id: string;
    threadId: string;
    senderId: string;
    senderName: string;
    role: "user" | "model";
    content: string;
    mediaType?: MediaType;
    mediaUrls?: string | null;
    hasQuote?: number;
    quoteText?: string | null;
    quoteSenderName?: string | null;
    quoteSenderId?: string | null;
    isGroup?: number;
    timestamp: number;
  }): ChatMessageRecord {
    let resolvedMediaItems: MediaItem[] | undefined = undefined;
    if (row.mediaUrls) {
      try {
        const parsed = JSON.parse(row.mediaUrls);
        if (Array.isArray(parsed)) {
          resolvedMediaItems = parsed;
        }
      } catch {}
    }

    return {
      id: row.id,
      threadId: row.threadId,
      senderId: row.senderId,
      senderName: row.senderName,
      role: row.role,
      content: row.content || "",
      mediaType: row.mediaType || null,
      mediaUrls: resolvedMediaItems,
      hasQuote: Boolean(row.hasQuote),
      quoteText: row.quoteText || undefined,
      quoteSenderName: row.quoteSenderName || undefined,
      quoteSenderId: row.quoteSenderId || undefined,
      isGroup: Boolean(row.isGroup),
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
  public cleanupOldMessages(threadId: string, keepCount: number = config.chatHistoryLimit): void {
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

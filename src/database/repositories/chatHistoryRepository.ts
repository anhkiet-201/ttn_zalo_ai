import { SQLiteDatabase } from "../sqliteDb.js";
import { config } from "../../config/index.js";
import { chatBroadcaster } from "../../server/chatBroadcaster.js";
import crypto from "node:crypto";

export type ThreadFilter = "all" | "personal" | "direct" | "group" | "manual";

export interface ChatMessageRecord {
  id?: string;
  threadId: string;
  senderId: string;
  senderName?: string;
  role: "user" | "model";
  content: string;
  hasImage?: boolean;
  imageUrls?: string[];
  hasVoice?: boolean;
  voiceUrl?: string;
  voiceDuration?: number;
  hasSticker?: boolean;
  stickerId?: string;
  stickerCateId?: string;
  stickerUrl?: string;
  stickerText?: string;
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
  lastHasImage: boolean;
  lastHasVoice?: boolean;
  lastHasSticker?: boolean;
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
    // Chống duplicate: kiểm tra xem tin nhắn cùng thread, cùng role và nội dung/ảnh/voice/sticker đã tồn tại chưa
    try {
      let existing: { id: string } | undefined;

      // 1. Nếu có record.id, kiểm tra xem tin nhắn đã có trong DB chưa
      if (record.id) {
        const checkIdStmt = this.db.connection.prepare(`
          SELECT id FROM chat_messages WHERE id = ? LIMIT 1
        `);
        existing = checkIdStmt.get(record.id) as { id: string } | undefined;
      }

      // 2. Nếu chưa có id hoặc chưa tìm thấy theo id, kiểm tra deduplication trong 5s
      if (!existing) {
        if (record.hasImage && record.imageUrls && record.imageUrls.length > 0) {
          const checkImageStmt = this.db.connection.prepare(`
            SELECT id FROM chat_messages 
            WHERE thread_id = ? AND role = ? AND has_image = 1 AND image_urls = ? AND abs(timestamp - ?) < 5000 
            LIMIT 1
          `);
          existing = checkImageStmt.get(
            record.threadId,
            record.role,
            JSON.stringify(record.imageUrls),
            record.timestamp
          ) as { id: string } | undefined;
        } else if (record.hasVoice && record.voiceUrl) {
          const checkVoiceStmt = this.db.connection.prepare(`
            SELECT id FROM chat_messages 
            WHERE thread_id = ? AND role = ? AND has_voice = 1 AND voice_url = ? AND abs(timestamp - ?) < 5000 
            LIMIT 1
          `);
          existing = checkVoiceStmt.get(
            record.threadId,
            record.role,
            record.voiceUrl,
            record.timestamp
          ) as { id: string } | undefined;
        } else if (record.hasSticker) {
          const checkStickerStmt = this.db.connection.prepare(`
            SELECT id FROM chat_messages 
            WHERE thread_id = ? AND role = ? AND (has_sticker = 1 OR content LIKE '%[Sticker]%' OR content LIKE '%[🏷️ Sticker]%') AND abs(timestamp - ?) < 5000 
            LIMIT 1
          `);
          existing = checkStickerStmt.get(
            record.threadId,
            record.role,
            record.timestamp
          ) as { id: string } | undefined;
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
        // Đã có bản ghi -> Cập nhật thông tin chi tiết (ví dụ: bổ sung ý nghĩa sticker / STT voice)
        const updateStmt = this.db.connection.prepare(`
          UPDATE chat_messages SET
            content = @content,
            has_voice = @has_voice,
            voice_url = @voice_url,
            voice_duration = @voice_duration,
            has_sticker = @has_sticker,
            sticker_id = @sticker_id,
            sticker_cate_id = @sticker_cate_id,
            sticker_url = @sticker_url,
            sticker_text = @sticker_text
          WHERE id = @id
        `);

        updateStmt.run({
          id: existing.id,
          content: record.content,
          has_voice: record.hasVoice ? 1 : 0,
          voice_url: record.voiceUrl || null,
          voice_duration: record.voiceDuration || 0,
          has_sticker: record.hasSticker ? 1 : 0,
          sticker_id: record.stickerId || null,
          sticker_cate_id: record.stickerCateId || null,
          sticker_url: record.stickerUrl || null,
          sticker_text: record.stickerText || null,
        });

        try {
          chatBroadcaster.broadcast({
            ...record,
            id: existing.id,
          });
        } catch {}
        return;
      }
    } catch {
      // Bỏ qua lỗi check
    }

    const id = record.id || crypto.randomUUID();
    const stmt = this.db.connection.prepare(`
      INSERT INTO chat_messages (
        id, thread_id, sender_id, sender_name, role, content, has_image, image_urls,
        has_voice, voice_url, voice_duration,
        has_sticker, sticker_id, sticker_cate_id, sticker_url, sticker_text,
        has_quote, quote_text, quote_sender_name, quote_sender_id, is_group, timestamp
      ) VALUES (
        @id, @thread_id, @sender_id, @sender_name, @role, @content, @has_image, @image_urls,
        @has_voice, @voice_url, @voice_duration,
        @has_sticker, @sticker_id, @sticker_cate_id, @sticker_url, @sticker_text,
        @has_quote, @quote_text, @quote_sender_name, @quote_sender_id, @is_group, @timestamp
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
      has_voice: record.hasVoice ? 1 : 0,
      voice_url: record.voiceUrl || null,
      voice_duration: record.voiceDuration || 0,
      has_sticker: record.hasSticker ? 1 : 0,
      sticker_id: record.stickerId || null,
      sticker_cate_id: record.stickerCateId || null,
      sticker_url: record.stickerUrl || null,
      sticker_text: record.stickerText || null,
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
        has_voice as hasVoice, voice_url as voiceUrl, voice_duration as voiceDuration,
        has_sticker as hasSticker, sticker_id as stickerId, sticker_cate_id as stickerCateId,
        sticker_url as stickerUrl, sticker_text as stickerText,
        has_quote as hasQuote, quote_text as quoteText,
        quote_sender_name as quoteSenderName, quote_sender_id as quoteSenderId,
        is_group as isGroup, timestamp
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
      hasVoice?: number;
      voiceUrl?: string | null;
      voiceDuration?: number | null;
      hasSticker?: number;
      stickerId?: string | null;
      stickerCateId?: string | null;
      stickerUrl?: string | null;
      stickerText?: string | null;
      hasQuote: number;
      quoteText: string | null;
      quoteSenderName: string | null;
      quoteSenderId: string | null;
      isGroup: number;
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
        has_voice as hasVoice, voice_url as voiceUrl, voice_duration as voiceDuration,
        has_sticker as hasSticker, sticker_id as stickerId, sticker_cate_id as stickerCateId,
        sticker_url as stickerUrl, sticker_text as stickerText,
        has_quote as hasQuote, quote_text as quoteText,
        quote_sender_name as quoteSenderName, quote_sender_id as quoteSenderId,
        is_group as isGroup, timestamp
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
      hasVoice?: number;
      voiceUrl?: string | null;
      voiceDuration?: number | null;
      hasSticker?: number;
      stickerId?: string | null;
      stickerCateId?: string | null;
      stickerUrl?: string | null;
      stickerText?: string | null;
      hasQuote: number;
      quoteText: string | null;
      quoteSenderName: string | null;
      quoteSenderId: string | null;
      isGroup: number;
      timestamp: number;
    }>;

    return rows.reverse().map((row) => this.mapMessageRow(row));
  }

  /**
   * Lấy danh sách các cuộc trò chuyện (Threads) phân trang có tin nhắn mới nhất
   * Hỗ trợ lọc theo tab: "all" | "personal" | "group" | "manual"
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
        m.has_image as lastHasImage,
        m.has_voice as lastHasVoice,
        m.has_sticker as lastHasSticker,
        m.timestamp as lastTimestamp,
        m.role as lastRole,
        COALESCE(tm.is_group, m.is_group) as isGroup,
        COALESCE(tm.is_manual, CASE WHEN COALESCE(tm.custom_name, '') LIKE '-M%' OR COALESCE(tm.custom_name, '') LIKE '-m%' OR COALESCE(c.full_name, '') LIKE '-M%' OR COALESCE(c.full_name, '') LIKE '-m%' THEN 1 ELSE 0 END) as isManual,
        c.full_name as candidateName,
        c.target_company as targetCompany,
        c.phone_number as phoneNumber
      FROM (
        SELECT 
          id, thread_id, sender_id, sender_name, content, has_image, has_voice, has_sticker,
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

    // 1. Điều kiện tìm kiếm (Search)
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

    // 2. Điều kiện lọc theo Tab Filter (all, direct/personal, group, manual)
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
      lastHasImage: number;
      lastHasVoice?: number;
      lastHasSticker?: number;
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
      lastHasImage: Boolean(r.lastHasImage),
      lastHasVoice: Boolean(r.lastHasVoice),
      lastHasSticker: Boolean(r.lastHasSticker),
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
    hasVoice?: number;
    voiceUrl?: string | null;
    voiceDuration?: number | null;
    hasSticker?: number;
    stickerId?: string | null;
    stickerCateId?: string | null;
    stickerUrl?: string | null;
    stickerText?: string | null;
    hasQuote?: number;
    quoteText?: string | null;
    quoteSenderName?: string | null;
    quoteSenderId?: string | null;
    isGroup?: number;
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
      hasVoice: Boolean(row.hasVoice),
      voiceUrl: row.voiceUrl || undefined,
      voiceDuration: row.voiceDuration || undefined,
      hasSticker: Boolean(row.hasSticker),
      stickerId: row.stickerId || undefined,
      stickerCateId: row.stickerCateId || undefined,
      stickerUrl: row.stickerUrl || undefined,
      stickerText: row.stickerText || undefined,
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

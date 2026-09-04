import { SQLiteDatabase } from "../sqliteDb.js";

export interface UserCCCDDocument {
  idNumber?: string;
  fullName?: string;
  dob?: string;
  gender?: string;
  nationality?: string;
  homeTown?: string;
  residence?: string;
  expiryDate?: string;
  imageUrls: string[];
  extractedAt: number;
  status?: "pending" | "registered";
  registeredCompany?: string;
  interviewDate?: string;
}

export interface UserContextData {
  id: string; // `${threadId}:${senderId}`
  threadId: string;
  senderId: string;
  senderName: string;
  phoneNumbers: string[];
  targetCompany?: string;
  documents: UserCCCDDocument[];
  notes?: string;
  metadata?: Record<string, any>;
  updatedAt: number;
}

/**
 * UserContextRepository: Lưu trữ và truy vấn ngữ cảnh tổng hợp của người dùng trên SQLite Database
 */
export class UserContextRepository {
  private db: SQLiteDatabase;

  constructor(db?: SQLiteDatabase) {
    this.db = db || SQLiteDatabase.getInstance();
  }

  /**
   * Lấy UserContext theo threadId và senderId
   */
  public get(threadId: string, senderId: string): UserContextData | null {
    const id = `${threadId}:${senderId}`;
    const stmt = this.db.connection.prepare(`
      SELECT id, thread_id as threadId, sender_id as senderId, sender_name as senderName, data, updated_at as updatedAt
      FROM user_contexts
      WHERE id = ?
    `);

    const row = stmt.get(id) as
      | {
          id: string;
          threadId: string;
          senderId: string;
          senderName: string;
          data: string;
          updatedAt: number;
        }
      | undefined;

    if (!row) return null;

    try {
      const parsedData = JSON.parse(row.data);
      return {
        id: row.id,
        threadId: row.threadId,
        senderId: row.senderId,
        senderName: row.senderName,
        phoneNumbers: parsedData.phoneNumbers || [],
        targetCompany: parsedData.targetCompany,
        documents: parsedData.documents || [],
        notes: parsedData.notes,
        metadata: parsedData.metadata,
        updatedAt: row.updatedAt,
      };
    } catch (error) {
      console.error(`❌ [UserContextRepo] Lỗi phân tích JSON dữ liệu cho user [${id}]:`, error);
      return null;
    }
  }

  /**
   * Lưu hoặc cập nhật UserContext vào SQLite Database (Write-Through)
   */
  public save(context: UserContextData): void {
    const id = context.id || `${context.threadId}:${context.senderId}`;
    const updatedAt = context.updatedAt || Date.now();

    const dataPayload = {
      phoneNumbers: context.phoneNumbers || [],
      targetCompany: context.targetCompany,
      documents: context.documents || [],
      notes: context.notes,
      metadata: context.metadata,
    };

    const stmt = this.db.connection.prepare(`
      INSERT OR REPLACE INTO user_contexts (
        id, thread_id, sender_id, sender_name, data, updated_at
      ) VALUES (
        @id, @thread_id, @sender_id, @sender_name, @data, @updated_at
      )
    `);

    stmt.run({
      id,
      thread_id: context.threadId,
      sender_id: context.senderId,
      sender_name: context.senderName,
      data: JSON.stringify(dataPayload),
      updated_at: updatedAt,
    });
  }

  /**
   * Cập nhật tên người gửi (sender_name) trong bảng user_contexts
   */
  public updateSenderName(threadId: string, senderId: string, newSenderName: string): void {
    try {
      const id = `${threadId}:${senderId}`;
      const stmt = this.db.connection.prepare(`
        UPDATE user_contexts
        SET sender_name = ?, updated_at = ?
        WHERE id = ? OR (thread_id = ? AND sender_id = ?)
      `);
      stmt.run(newSenderName, Date.now(), id, threadId, senderId);
    } catch (err) {
      console.warn(`⚠️ [UserContextRepo] Không thể cập nhật sender_name cho [${threadId}:${senderId}]:`, err);
    }
  }

  /**
   * Lấy toàn bộ UserContexts (khi cần warmup cache hoặc báo cáo)
   */
  public getAll(): UserContextData[] {
    const stmt = this.db.connection.prepare(`
      SELECT id, thread_id as threadId, sender_id as senderId, sender_name as senderName, data, updated_at as updatedAt
      FROM user_contexts
      ORDER BY updated_at DESC
    `);

    const rows = stmt.all() as Array<{
      id: string;
      threadId: string;
      senderId: string;
      senderName: string;
      data: string;
      updatedAt: number;
    }>;

    const list: UserContextData[] = [];
    for (const row of rows) {
      try {
        const parsedData = JSON.parse(row.data);
        list.push({
          id: row.id,
          threadId: row.threadId,
          senderId: row.senderId,
          senderName: row.senderName,
          phoneNumbers: parsedData.phoneNumbers || [],
          targetCompany: parsedData.targetCompany,
          documents: parsedData.documents || [],
          notes: parsedData.notes,
          metadata: parsedData.metadata,
          updatedAt: row.updatedAt,
        });
      } catch {}
    }
    return list;
  }
}

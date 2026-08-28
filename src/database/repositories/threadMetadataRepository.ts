import { SQLiteDatabase } from "../sqliteDb.js";

export interface ThreadMetadataRecord {
  threadId: string;
  customName?: string;
  isManual: boolean;
  isGroup: boolean;
  updatedAt: number;
}

/**
 * ThreadMetadataRepository: Quản lý tên hiển thị tùy chỉnh và trạng thái Thủ công (-M)
 * của từng cuộc trò chuyện trên SQLite Database một cách bền vững.
 */
export class ThreadMetadataRepository {
  private db: SQLiteDatabase;

  constructor(db?: SQLiteDatabase) {
    this.db = db || SQLiteDatabase.getInstance();
  }

  /**
   * Lấy metadata của một thread
   */
  public getMetadata(threadId: string): ThreadMetadataRecord | null {
    try {
      const stmt = this.db.connection.prepare(`
        SELECT 
          thread_id as threadId,
          custom_name as customName,
          is_manual as isManual,
          is_group as isGroup,
          updated_at as updatedAt
        FROM thread_metadata
        WHERE thread_id = ?
        LIMIT 1
      `);

      const row = stmt.get(threadId) as {
        threadId: string;
        customName: string | null;
        isManual: number;
        isGroup: number;
        updatedAt: number;
      } | undefined;

      if (!row) return null;

      return {
        threadId: row.threadId,
        customName: row.customName || undefined,
        isManual: Boolean(row.isManual),
        isGroup: Boolean(row.isGroup),
        updatedAt: row.updatedAt,
      };
    } catch (err) {
      console.warn(`⚠️ Lỗi khi lấy metadata cho thread ${threadId}:`, err);
      return null;
    }
  }

  /**
   * Kiểm tra nhanh xem thread có đang ở chế độ Thủ công (-M) không
   */
  public isManual(threadId: string): boolean {
    const meta = this.getMetadata(threadId);
    return meta ? meta.isManual : false;
  }

  /**
   * Cập nhật hoặc thêm mới metadata cho thread
   */
  public upsertMetadata(
    threadId: string,
    customName?: string,
    isManual?: boolean,
    isGroup?: boolean
  ): void {
    try {
      const current = this.getMetadata(threadId);
      const newCustomName = customName !== undefined ? customName : current?.customName;
      let newIsManual = isManual !== undefined ? isManual : current?.isManual || false;
      const newIsGroup = isGroup !== undefined ? isGroup : current?.isGroup || false;

      // Nếu customName có tiền tố -M thì tự động đặt isManual = true
      if (newCustomName) {
        if (/^-M(\s|_|-|$)/i.test(newCustomName)) {
          newIsManual = true;
        } else if (isManual === undefined && current?.isManual) {
          // Nếu không truyền isManual rõ ràng mà customName bỏ -M
          newIsManual = false;
        }
      }

      const stmt = this.db.connection.prepare(`
        INSERT INTO thread_metadata (thread_id, custom_name, is_manual, is_group, updated_at)
        VALUES (@thread_id, @custom_name, @is_manual, @is_group, @updated_at)
        ON CONFLICT(thread_id) DO UPDATE SET
          custom_name = excluded.custom_name,
          is_manual = excluded.is_manual,
          is_group = excluded.is_group,
          updated_at = excluded.updated_at
      `);

      stmt.run({
        thread_id: threadId,
        custom_name: newCustomName || null,
        is_manual: newIsManual ? 1 : 0,
        is_group: newIsGroup ? 1 : 0,
        updated_at: Date.now(),
      });
    } catch (err) {
      console.warn(`⚠️ Lỗi khi upsert metadata cho thread ${threadId}:`, err);
    }
  }

  /**
   * Cập nhật riêng chế độ isManual
   */
  public setManualMode(threadId: string, isManual: boolean, customName?: string): void {
    this.upsertMetadata(threadId, customName, isManual);
  }
}

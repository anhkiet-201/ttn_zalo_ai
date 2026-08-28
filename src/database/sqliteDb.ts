import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

/**
 * SQLiteDatabase: Quản lý kết nối cơ sở dữ liệu nhúng SQLite hiệu năng cao cho Chat History & Candidates
 */
export class SQLiteDatabase {
  private static instance: SQLiteDatabase | null = null;
  private db: Database.Database;

  private constructor(dbPath?: string) {
    const dataDir = path.resolve(process.cwd(), "data");
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const finalPath = dbPath || path.join(dataDir, "zalo_bot.db");
    console.log(`🗄️ [SQLite Database] Đang khởi tạo cơ sở dữ liệu tại: ${finalPath}`);

    this.db = new Database(finalPath);

    // Kích hoạt các cấu hình tối ưu hiệu năng và an toàn dữ liệu
    this.db.pragma("journal_mode = WAL"); // Write-Ahead Logging: hỗ trợ đọc ghi song song không nghẽn
    this.db.pragma("synchronous = NORMAL"); // Tối ưu hóa I/O đĩa
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("cache_size = -64000"); // 64MB Cache RAM cho SQLite

    this.initTables();
  }

  /**
   * Singleton pattern để tái sử dụng một connection duy nhất
   */
  public static getInstance(dbPath?: string): SQLiteDatabase {
    if (!SQLiteDatabase.instance) {
      SQLiteDatabase.instance = new SQLiteDatabase(dbPath);
    }
    return SQLiteDatabase.instance;
  }

  /**
   * Lấy instance Database gốc của better-sqlite3
   */
  public get connection(): Database.Database {
    return this.db;
  }

  /**
   * Khởi tạo các bảng dữ liệu và Index cần thiết
   */
  private initTables(): void {
    this.db.exec(`
      -- 1. Bảng lưu trữ lịch sử tin nhắn
      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        sender_name TEXT DEFAULT '',
        role TEXT NOT NULL CHECK(role IN ('user', 'model')),
        content TEXT NOT NULL,
        has_image INTEGER DEFAULT 0,
        image_urls TEXT,
        has_quote INTEGER DEFAULT 0,
        quote_text TEXT,
        quote_sender_name TEXT,
        quote_sender_id TEXT,
        is_group INTEGER DEFAULT 0,
        timestamp INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Index tăng tốc truy vấn lịch sử 20 tin nhắn gần nhất theo thread
      CREATE INDEX IF NOT EXISTS idx_chat_thread_ts 
      ON chat_messages(thread_id, timestamp DESC);

      -- 2. Bảng lưu trữ hồ sơ ứng viên & dữ liệu trích xuất CCCD
      CREATE TABLE IF NOT EXISTS candidates (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        target_company TEXT,
        phone_number TEXT,
        interview_date TEXT,
        full_name TEXT,
        id_number TEXT,
        dob TEXT,
        gender TEXT,
        home_town TEXT,
        residence TEXT,
        expiry_date TEXT,
        image_urls TEXT,
        status TEXT DEFAULT 'pending',
        forwarded_to TEXT,
        created_at INTEGER NOT NULL,
        forwarded_at INTEGER
      );

      -- Index tra cứu ứng viên theo số CCCD, Sender ID và Thread ID
      CREATE INDEX IF NOT EXISTS idx_candidate_id_number ON candidates(id_number);
      CREATE INDEX IF NOT EXISTS idx_candidate_sender ON candidates(sender_id);
      CREATE INDEX IF NOT EXISTS idx_candidate_thread ON candidates(thread_id);

      -- 3. Bảng lưu trữ ngữ cảnh tổng hợp của người dùng (User Context)
      CREATE TABLE IF NOT EXISTS user_contexts (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Index tra cứu User Context
      CREATE INDEX IF NOT EXISTS idx_user_context_sender ON user_contexts(sender_id);
      CREATE INDEX IF NOT EXISTS idx_user_context_thread ON user_contexts(thread_id);

      -- 4. Bảng lưu trữ Metadata cuộc trò chuyện (Tên tùy chỉnh, Chế độ Manual -M, Loại nhóm)
      CREATE TABLE IF NOT EXISTS thread_metadata (
        thread_id TEXT PRIMARY KEY,
        custom_name TEXT,
        is_manual INTEGER DEFAULT 0,
        is_group INTEGER DEFAULT 0,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_thread_meta_manual ON thread_metadata(is_manual);
    `);

    // Migration bổ sung các cột mới nếu bảng chat_messages hoặc candidates đã tồn tại từ trước
    try {
      const msgColumns = this.db
        .prepare("PRAGMA table_info(chat_messages)")
        .all() as Array<{ name: string }>;
      const msgColNames = msgColumns.map((c) => c.name);

      if (!msgColNames.includes("has_quote")) {
        this.db.exec("ALTER TABLE chat_messages ADD COLUMN has_quote INTEGER DEFAULT 0");
      }
      if (!msgColNames.includes("quote_text")) {
        this.db.exec("ALTER TABLE chat_messages ADD COLUMN quote_text TEXT");
      }
      if (!msgColNames.includes("quote_sender_name")) {
        this.db.exec("ALTER TABLE chat_messages ADD COLUMN quote_sender_name TEXT");
      }
      if (!msgColNames.includes("quote_sender_id")) {
        this.db.exec("ALTER TABLE chat_messages ADD COLUMN quote_sender_id TEXT");
      }
      if (!msgColNames.includes("is_group")) {
        this.db.exec("ALTER TABLE chat_messages ADD COLUMN is_group INTEGER DEFAULT 0");
      }

      // Tạo Index sau khi đảm bảo cột is_group đã tồn tại
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_chat_is_group
        ON chat_messages(is_group, timestamp DESC);
      `);

      const columns = this.db
        .prepare("PRAGMA table_info(candidates)")
        .all() as Array<{ name: string }>;
      const columnNames = columns.map((c) => c.name);

      if (!columnNames.includes("target_company")) {
        this.db.exec("ALTER TABLE candidates ADD COLUMN target_company TEXT");
      }
      if (!columnNames.includes("phone_number")) {
        this.db.exec("ALTER TABLE candidates ADD COLUMN phone_number TEXT");
      }
      if (!columnNames.includes("interview_date")) {
        this.db.exec("ALTER TABLE candidates ADD COLUMN interview_date TEXT");
      }
      if (!columnNames.includes("status")) {
        this.db.exec("ALTER TABLE candidates ADD COLUMN status TEXT DEFAULT 'pending'");
      }
      if (!columnNames.includes("forwarded_at")) {
        this.db.exec("ALTER TABLE candidates ADD COLUMN forwarded_at INTEGER");
      }
    } catch {
      // Bỏ qua nếu bảng chưa tồn tại
    }

    console.log("✅ [SQLite Database] Đã khởi tạo hoàn tất bảng chat_messages, candidates và user_contexts.");
  }

  /**
   * Đóng kết nối an toàn khi ứng dụng dừng
   */
  public close(): void {
    if (this.db.open) {
      this.db.close();
      console.log("🔒 [SQLite Database] Đã đóng kết nối an toàn.");
    }
  }
}

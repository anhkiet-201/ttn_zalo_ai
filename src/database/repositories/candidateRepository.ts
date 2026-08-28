import { SQLiteDatabase } from "../sqliteDb.js";
import { config } from "../../config/index.js";
import crypto from "node:crypto";

export interface CandidateRecord {
  id?: string;
  threadId: string;
  senderId: string;
  senderName: string;
  targetCompany?: string;
  phoneNumber?: string;
  interviewDate?: string;
  fullName?: string;
  idNumber?: string;
  dob?: string;
  gender?: string;
  homeTown?: string;
  residence?: string;
  expiryDate?: string;
  imageUrls: string[];
  status?: "pending" | "forwarded";
  forwardedTo: string;
  createdAt?: number;
  forwardedAt?: number;
}

/**
 * CandidateRepository: Quản lý hồ sơ ứng viên và thông tin CCCD trên SQLite Database
 */
export class CandidateRepository {
  private db: SQLiteDatabase;

  constructor(db?: SQLiteDatabase) {
    this.db = db || SQLiteDatabase.getInstance();
  }

  /**
   * Lấy hồ sơ mới nhất (bất kể pending hay forwarded) của một luồng chat / ứng viên
   */
  public getLatestCandidate(
    threadId: string,
    senderId?: string
  ): CandidateRecord | null {
    let query = `
      SELECT 
        id, thread_id as threadId, sender_id as senderId, sender_name as senderName,
        target_company as targetCompany, phone_number as phoneNumber, interview_date as interviewDate,
        full_name as fullName, id_number as idNumber, dob, gender,
        home_town as homeTown, residence, expiry_date as expiryDate,
        image_urls as imageUrls, status, forwarded_to as forwardedTo,
        created_at as createdAt, forwarded_at as forwardedAt
      FROM candidates
      WHERE thread_id = ?
    `;

    const params: unknown[] = [threadId];
    if (senderId) {
      query += " AND sender_id = ?";
      params.push(senderId);
    }
    query += " ORDER BY created_at DESC LIMIT 1";

    const stmt = this.db.connection.prepare(query);
    const row = stmt.get(...params) as Record<string, unknown> | undefined;
    if (!row) return null;

    return this.mapRowToRecord(row);
  }

  /**
   * Lấy hồ sơ đang chờ xử lý (chưa chuyển tiếp) của một luồng chat / ứng viên
   */
  public getPendingCandidate(
    threadId: string,
    senderId?: string
  ): CandidateRecord | null {
    let query = `
      SELECT 
        id, thread_id as threadId, sender_id as senderId, sender_name as senderName,
        target_company as targetCompany, phone_number as phoneNumber, interview_date as interviewDate,
        full_name as fullName, id_number as idNumber, dob, gender,
        home_town as homeTown, residence, expiry_date as expiryDate,
        image_urls as imageUrls, status, forwarded_to as forwardedTo,
        created_at as createdAt, forwarded_at as forwardedAt
      FROM candidates
      WHERE thread_id = ? AND status = 'pending'
    `;

    const params: unknown[] = [threadId];
    if (senderId) {
      query += " AND sender_id = ?";
      params.push(senderId);
    }
    query += " ORDER BY created_at DESC LIMIT 1";

    const stmt = this.db.connection.prepare(query);
    const row = stmt.get(...params) as Record<string, unknown> | undefined;
    if (!row) return null;

    return this.mapRowToRecord(row);
  }

  /**
   * Thêm mới hoặc cập nhật nối tiếp hồ sơ ứng viên
   */
  public upsertCandidate(data: CandidateRecord): CandidateRecord {
    // 1. Tìm xem đã có hồ sơ nào của thread này chưa (ưu tiên pending, nếu không lấy latest)
    const existing =
      this.getPendingCandidate(data.threadId, data.senderId) ||
      this.getLatestCandidate(data.threadId, data.senderId);

    const id = existing?.id || data.id || crypto.randomUUID();
    const createdAt = existing?.createdAt || data.createdAt || Date.now();
    const targetCompany = data.targetCompany || existing?.targetCompany || null;
    const phoneNumber = data.phoneNumber || existing?.phoneNumber || null;
    const interviewDate = data.interviewDate || existing?.interviewDate || null;
    const fullName = data.fullName || existing?.fullName || null;
    const idNumber = data.idNumber || existing?.idNumber || null;
    const dob = data.dob || existing?.dob || null;
    const gender = data.gender || existing?.gender || null;
    const homeTown = data.homeTown || existing?.homeTown || null;
    const residence = data.residence || existing?.residence || null;
    const expiryDate = data.expiryDate || existing?.expiryDate || null;

    // Gộp ảnh cũ và ảnh mới
    const combinedImages = Array.from(
      new Set([...(existing?.imageUrls || []), ...(data.imageUrls || [])])
    );
    const status = data.status || existing?.status || "pending";
    const forwardedTo = data.forwardedTo || existing?.forwardedTo || config.hrRecipientId;
    const forwardedAt = data.forwardedAt || existing?.forwardedAt || null;

    const stmt = this.db.connection.prepare(`
      INSERT OR REPLACE INTO candidates (
        id, thread_id, sender_id, sender_name, target_company, phone_number, interview_date,
        full_name, id_number, dob, gender, home_town, residence, expiry_date,
        image_urls, status, forwarded_to, created_at, forwarded_at
      ) VALUES (
        @id, @thread_id, @sender_id, @sender_name, @target_company, @phone_number, @interview_date,
        @full_name, @id_number, @dob, @gender, @home_town, @residence, @expiry_date,
        @image_urls, @status, @forwarded_to, @created_at, @forwarded_at
      )
    `);

    stmt.run({
      id,
      thread_id: data.threadId,
      sender_id: data.senderId,
      sender_name: data.senderName,
      target_company: targetCompany,
      phone_number: phoneNumber,
      interview_date: interviewDate,
      full_name: fullName,
      id_number: idNumber,
      dob,
      gender,
      home_town: homeTown,
      residence,
      expiry_date: expiryDate,
      image_urls: JSON.stringify(combinedImages),
      status,
      forwarded_to: forwardedTo,
      created_at: createdAt,
      forwarded_at: forwardedAt,
    });

    return {
      id,
      threadId: data.threadId,
      senderId: data.senderId,
      senderName: data.senderName,
      targetCompany: targetCompany || undefined,
      phoneNumber: phoneNumber || undefined,
      interviewDate: interviewDate || undefined,
      fullName: fullName || undefined,
      idNumber: idNumber || undefined,
      dob: dob || undefined,
      gender: gender || undefined,
      homeTown: homeTown || undefined,
      residence: residence || undefined,
      expiryDate: expiryDate || undefined,
      imageUrls: combinedImages,
      status: status as "pending" | "forwarded",
      forwardedTo,
      createdAt,
      forwardedAt: forwardedAt || undefined,
    };
  }

  /**
   * Đánh dấu hồ sơ đã được chuyển tiếp thành công sang HR
   */
  public markAsForwarded(id: string): void {
    const stmt = this.db.connection.prepare(`
      UPDATE candidates
      SET status = 'forwarded', forwarded_at = ?
      WHERE id = ?
    `);
    stmt.run(Date.now(), id);
    console.log(`✅ [Candidate DB] Đã cập nhật trạng thái hồ sơ [ID: ${id}] -> FORWARDED.`);
  }

  /**
   * Tra cứu ứng viên theo Số CCCD
   */
  public findByIdNumber(idNumber: string): CandidateRecord | null {
    const stmt = this.db.connection.prepare(`
      SELECT 
        id, thread_id as threadId, sender_id as senderId, sender_name as senderName,
        target_company as targetCompany, phone_number as phoneNumber, interview_date as interviewDate,
        full_name as fullName, id_number as idNumber, dob, gender,
        home_town as homeTown, residence, expiry_date as expiryDate,
        image_urls as imageUrls, status, forwarded_to as forwardedTo,
        created_at as createdAt, forwarded_at as forwardedAt
      FROM candidates
      WHERE id_number = ?
      ORDER BY created_at DESC
      LIMIT 1
    `);

    const row = stmt.get(idNumber) as Record<string, unknown> | undefined;
    if (!row) return null;

    return this.mapRowToRecord(row);
  }

  /**
   * Lấy danh sách hồ sơ ứng viên mới nhất
   */
  public getRecentCandidates(limit: number = 50): CandidateRecord[] {
    const stmt = this.db.connection.prepare(`
      SELECT 
        id, thread_id as threadId, sender_id as senderId, sender_name as senderName,
        target_company as targetCompany, phone_number as phoneNumber, interview_date as interviewDate,
        full_name as fullName, id_number as idNumber, dob, gender,
        home_town as homeTown, residence, expiry_date as expiryDate,
        image_urls as imageUrls, status, forwarded_to as forwardedTo,
        created_at as createdAt, forwarded_at as forwardedAt
      FROM candidates
      ORDER BY created_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapRowToRecord(row));
  }

  private mapRowToRecord(row: Record<string, unknown>): CandidateRecord {
    return {
      id: String(row.id),
      threadId: String(row.threadId),
      senderId: String(row.senderId),
      senderName: String(row.senderName),
      targetCompany: row.targetCompany ? String(row.targetCompany) : undefined,
      phoneNumber: row.phoneNumber ? String(row.phoneNumber) : undefined,
      interviewDate: row.interviewDate ? String(row.interviewDate) : undefined,
      fullName: row.fullName ? String(row.fullName) : undefined,
      idNumber: row.idNumber ? String(row.idNumber) : undefined,
      dob: row.dob ? String(row.dob) : undefined,
      gender: row.gender ? String(row.gender) : undefined,
      homeTown: row.homeTown ? String(row.homeTown) : undefined,
      residence: row.residence ? String(row.residence) : undefined,
      expiryDate: row.expiryDate ? String(row.expiryDate) : undefined,
      imageUrls: row.imageUrls ? JSON.parse(String(row.imageUrls)) : [],
      status: (row.status as "pending" | "forwarded") || "pending",
      forwardedTo: String(row.forwardedTo),
      createdAt: Number(row.createdAt),
      forwardedAt: row.forwardedAt ? Number(row.forwardedAt) : undefined,
    };
  }
}

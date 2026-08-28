import { config } from "../config/index.js";
import type { CandidateRecord } from "../database/repositories/candidateRepository.js";

export type TrangThaiTuyen = "CHO_PHONG_VAN";
export type HinhThucTuyen = "CHINH_THUC" | "THOI_VU";
export type GioiTinh = "NAM" | "NU";

/**
 * Interface cho Request Body gửi lên ERP Endpoint: POST /api/ung-tuyen
 */
export interface CreateUngTuyenRequest {
  cccd: string;
  tenNguoiLaoDong?: string;
  soDienThoai?: string;
  namSinh?: number;
  gioiTinh?: GioiTinh;
  congTyId: string;
  ngayPhongVan?: string; // Định dạng ISO: YYYY-MM-DD
  trangThaiTuyen?: TrangThaiTuyen;
  hinhThucTuyen?: HinhThucTuyen;
  ghiChu?: string;
}

export interface ERPResponse {
  success: boolean;
  data?: any;
  error?: string;
  statusCode?: number;
}

/**
 * ERPService: Quản lý đồng bộ dữ liệu ứng tuyển trực tiếp sang hệ thống Việc Làm HR ERP
 */
export class ERPService {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(baseUrl?: string, apiKey?: string) {
    this.baseUrl = (baseUrl || config.erpBaseUrl || "https://erp.vieclamhr.com").replace(/\/+$/, "");
    this.apiKey = apiKey || config.erpApiKey || "ttn_live_PLMxxxx";
  }

  /**
   * Gọi API POST https://erp.vieclamhr.com/api/ung-tuyen để tạo hoặc cập nhật hồ sơ ứng tuyển
   */
  public async upsertUngTuyen(payload: CreateUngTuyenRequest): Promise<ERPResponse> {
    const url = `${this.baseUrl}/api/ung-tuyen`;

    // Chuẩn hóa CCCD (chỉ giữ lại ký tự số)
    const cleanCccd = String(payload.cccd || "").replace(/\D/g, "");
    if (!cleanCccd) {
      const err = "Thiếu số CCCD hợp lệ để đồng bộ lên ERP";
      console.warn(`⚠️ [ERP Service] ${err}`);
      return { success: false, error: err };
    }

    const requestBody: CreateUngTuyenRequest = {
      cccd: cleanCccd,
      tenNguoiLaoDong: payload.tenNguoiLaoDong ? payload.tenNguoiLaoDong.trim().toUpperCase() : undefined,
      soDienThoai: payload.soDienThoai ? payload.soDienThoai.trim() : undefined,
      namSinh: payload.namSinh,
      gioiTinh: payload.gioiTinh,
      congTyId: payload.congTyId ? String(payload.congTyId).trim() : "CHUA_RO",
      ngayPhongVan: payload.ngayPhongVan,
      trangThaiTuyen: "CHO_PHONG_VAN",
      hinhThucTuyen: payload.hinhThucTuyen,
      ghiChu: payload.ghiChu,
    };

    console.log(
      `📤 [ERP API] Đang gửi đồng bộ ứng tuyển lên ERP [${url}]: CCCD=${requestBody.cccd}, Họ tên=${requestBody.tenNguoiLaoDong || "Chưa rõ"}, Công ty=${requestBody.congTyId}, Ghi chú=${requestBody.ghiChu}`
    );

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "X-API-Key": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(10000), // Timeout 10s
      });

      const responseText = await response.text();
      let responseData: any = null;
      try {
        responseData = JSON.parse(responseText);
      } catch {
        responseData = responseText;
      }

      if (response.ok) {
        console.log(
          `✅ [ERP API] Đồng bộ thành công hồ sơ ứng tuyển lên ERP (CCCD: ${cleanCccd}, Status: ${response.status})`
        );
        return {
          success: true,
          statusCode: response.status,
          data: responseData,
        };
      } else {
        console.warn(
          `⚠️ [ERP API] Máy chủ ERP trả về lỗi (${response.status}):`,
          responseText
        );
        return {
          success: false,
          statusCode: response.status,
          error: responseText,
        };
      }
    } catch (error: any) {
      console.error(`❌ [ERP API] Lỗi kết nối khi gửi dữ liệu sang ERP:`, error?.message || error);
      return {
        success: false,
        error: error?.message || String(error),
      };
    }
  }

  /**
   * Helper: Trích xuất năm sinh (Int) từ trường ngày sinh hoặc số CCCD 12 số
   */
  public parseNamSinh(dob?: string, cccd?: string): number | undefined {
    if (dob) {
      const match = dob.match(/\b(19\d{2}|20\d{2})\b/);
      if (match) {
        return parseInt(match[1], 10);
      }
    }

    if (cccd) {
      const clean = cccd.replace(/\D/g, "");
      if (clean.length === 12) {
        const centuryCode = parseInt(clean[3], 10);
        const year2Digits = parseInt(clean.substring(4, 6), 10);
        if (!isNaN(centuryCode) && !isNaN(year2Digits)) {
          let baseCentury = 1900;
          if (centuryCode === 0 || centuryCode === 1) baseCentury = 1900;
          else if (centuryCode === 2 || centuryCode === 3) baseCentury = 2000;
          else if (centuryCode === 4 || centuryCode === 5) baseCentury = 2100;
          return baseCentury + year2Digits;
        }
      }
    }

    return undefined;
  }

  /**
   * Helper: Chuẩn hóa giới tính ("NAM" | "NU")
   */
  public parseGioiTinh(gender?: string): GioiTinh | undefined {
    if (!gender) return undefined;
    const g = gender.trim().toLowerCase();
    if (g.includes("nam") || g === "1") return "NAM";
    if (g.includes("nữ") || g.includes("nu") || g === "0") return "NU";
    return undefined;
  }

  /**
   * Helper: Chuyển đổi định dạng ngày phỏng vấn sang YYYY-MM-DD
   */
  public parseNgayPhongVan(dateStr?: string): string | undefined {
    if (!dateStr) return undefined;
    const trimmed = dateStr.trim();

    // 1. Dạng YYYY-MM-DD
    const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (isoMatch) {
      const year = isoMatch[1];
      const month = isoMatch[2].padStart(2, "0");
      const day = isoMatch[3].padStart(2, "0");
      return `${year}-${month}-${day}`;
    }

    // 2. Dạng DD/MM/YYYY
    const vnMatch = trimmed.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
    if (vnMatch) {
      const day = vnMatch[1].padStart(2, "0");
      const month = vnMatch[2].padStart(2, "0");
      const year = vnMatch[3];
      return `${year}-${month}-${day}`;
    }

    // 3. Phân tích ngữ nghĩa tự nhiên (ngày mai, mai)
    const lower = trimmed.toLowerCase();
    if (lower.includes("mai") || lower.includes("ngày mai")) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow.toISOString().split("T")[0];
    }

    return undefined;
  }

  /**
   * Phương thức Fire-and-Run: Tự động gom dữ liệu từ CandidateRecord & ThreadId để gửi sang ERP ngầm
   * Hoàn toàn không chặn luồng chính, không làm chậm bot hay gián đoạn phản hồi.
   */
  public syncCandidateToErp(
    candidate: Partial<CandidateRecord>,
    threadId: string,
    overrides?: {
      congTyId?: string;
      ngayPhongVan?: string;
      hinhThucTuyen?: HinhThucTuyen;
    }
  ): void {
    const rawCccd = candidate.idNumber;
    if (!rawCccd) {
      console.log(
        `ℹ️ [ERP Fire-and-Run] Ứng viên [${candidate.fullName || candidate.senderName}] chưa có CCCD -> Bỏ qua đồng bộ ERP.`
      );
      return;
    }

    const payload: CreateUngTuyenRequest = {
      cccd: rawCccd,
      tenNguoiLaoDong: candidate.fullName || candidate.senderName,
      soDienThoai: candidate.phoneNumber || undefined,
      namSinh: this.parseNamSinh(candidate.dob, rawCccd),
      gioiTinh: this.parseGioiTinh(candidate.gender),
      congTyId: overrides?.congTyId || candidate.targetCompany || "CHUA_RO",
      ngayPhongVan: this.parseNgayPhongVan(overrides?.ngayPhongVan || candidate.interviewDate),
      trangThaiTuyen: "CHO_PHONG_VAN",
      hinhThucTuyen: overrides?.hinhThucTuyen || "THOI_VU",
      ghiChu: `zalo:${threadId}`,
    };

    // Chạy ngầm (Fire-and-forget)
    this.upsertUngTuyen(payload).catch((err) => {
      console.error("❌ [ERP Fire-and-Run] Lỗi khi thực hiện đồng bộ ngầm:", err);
    });
  }
}

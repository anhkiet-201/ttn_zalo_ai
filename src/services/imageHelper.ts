import { config } from "../config/index.js";

/**
 * Tải hình ảnh từ URL và chuyển thành Base64 kèm timeout 60s và cơ chế retry
 */
export async function downloadImageAsBase64(
  url: string,
  retryCount: number = 1
): Promise<{ mimeType: string; data: string } | null> {
  if (!url || typeof url !== "string") {
    return null;
  }

  const trimmedUrl = url.trim();

  // 1. Kiểm tra tính hợp lệ của URL (chỉ chấp nhận http hoặc https)
  try {
    const parsedUrl = new URL(trimmedUrl);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return null;
    }
  } catch {
    return null;
  }

  // 2. Fetch ảnh bất đồng bộ với timeout 60 giây (60000ms)
  for (let attempt = 0; attempt <= retryCount; attempt++) {
    try {
      const res = await fetch(trimmedUrl, {
        headers: {
          "User-Agent": config.userAgent,
          Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(60000),
      });

      if (!res.ok) {
        if (attempt < retryCount) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        return null;
      }

      // 3. Kiểm tra Content-Type và kích thước tối đa 15MB
      const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15MB
      const rawContentLength = Number(res.headers.get("content-length")) || 0;
      if (rawContentLength > MAX_IMAGE_BYTES) {
        console.warn(`⚠️ [ImageHelper] Ảnh vượt quá giới hạn 15MB (${rawContentLength} bytes), từ chối tải.`);
        return null;
      }

      const rawContentType = res.headers.get("content-type") || "";
      const mimeType = rawContentType.split(";")[0].trim().toLowerCase();

      // Kiểm tra sơ bộ Content-Type
      if (mimeType.includes("html") || mimeType.includes("json") || mimeType.includes("text")) {
        return null;
      }

      const buffer = await res.arrayBuffer();
      if (buffer.byteLength < 12 || buffer.byteLength > MAX_IMAGE_BYTES) {
        return null;
      }

      const u8 = new Uint8Array(buffer);

      // Kiểm tra Magic Bytes thực sự của file ảnh
      const detectedMime = detectImageMimeType(u8, mimeType);
      if (!detectedMime) {
        return null;
      }

      return {
        mimeType: detectedMime,
        data: Buffer.from(buffer).toString("base64"),
      };
    } catch {
      if (attempt < retryCount) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      return null;
    }
  }
  return null;
}

/**
 * Kiểm tra Magic Bytes đầu file buffer để xác thực file ảnh thực sự (JPEG, PNG, GIF, WEBP, HEIC, AVIF)
 */
function detectImageMimeType(buf: Uint8Array, headerMime: string): string | null {
  if (buf.length < 12) return null;

  // 1. JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }

  // 2. PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return "image/png";
  }

  // 3. GIF: 47 49 46
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return "image/gif";
  }

  // 4. WEBP: 52 49 46 46 .... 57 45 42 50 (RIFF....WEBP)
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "image/webp";
  }

  // 5. HEIC / HEIF / AVIF: ftypheic, ftypmif1, ftypavif
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    if (headerMime.startsWith("image/")) return headerMime;
    return "image/heic";
  }

  // 6. Nếu header đã xác định là image/ hợp lệ và không chứa HTML/XML/Text
  if (
    headerMime.startsWith("image/") &&
    !headerMime.includes("html") &&
    !headerMime.includes("svg")
  ) {
    return headerMime;
  }

  return null;
}

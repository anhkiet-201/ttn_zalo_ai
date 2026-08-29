import { config } from "../config/index.js";

/**
 * audioHelper.ts: Module hỗ trợ tải và chuẩn hóa tệp âm thanh (Voice Message) từ Zalo
 * Chuyển đổi thành Base64 kèm MIME Type chuẩn để đưa trực tiếp vào Gemini AI Model.
 */

/**
 * Tải tệp âm thanh từ URL và chuyển thành Base64 kèm MIME Type chuẩn cho Gemini
 */
export async function downloadAudioAsBase64(
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

  // 2. Fetch tệp âm thanh bất đồng bộ với timeout 45 giây (45000ms)
  for (let attempt = 0; attempt <= retryCount; attempt++) {
    try {
      const res = await fetch(trimmedUrl, {
        headers: {
          "User-Agent": config.userAgent,
          Accept: "audio/*,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(45000),
      });

      if (!res.ok) {
        if (attempt < retryCount) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        return null;
      }

      // 3. Kiểm tra kích thước tối đa 25MB (chuẩn Gemini Multimodal Audio)
      const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
      const rawContentLength = Number(res.headers.get("content-length")) || 0;
      if (rawContentLength > MAX_AUDIO_BYTES) {
        console.warn(
          `⚠️ [AudioHelper] Tệp âm thanh vượt quá 25MB (${rawContentLength} bytes), từ chối tải.`
        );
        return null;
      }

      // 4. Nhận diện MIME Type (từ header Content-Type hoặc đuôi mở rộng URL)
      const rawContentType = res.headers.get("content-type") || "";
      let mimeType = rawContentType.split(";")[0].trim().toLowerCase();

      // Nếu Content-Type là generic hoặc thiếu, suy luận từ đuôi URL
      if (!mimeType || mimeType === "application/octet-stream" || !mimeType.startsWith("audio/")) {
        const pathname = new URL(trimmedUrl).pathname.toLowerCase();
        if (pathname.endsWith(".m4a")) {
          mimeType = "audio/m4a";
        } else if (pathname.endsWith(".aac")) {
          mimeType = "audio/aac";
        } else if (pathname.endsWith(".mp3")) {
          mimeType = "audio/mp3";
        } else if (pathname.endsWith(".wav")) {
          mimeType = "audio/wav";
        } else if (pathname.endsWith(".amr")) {
          mimeType = "audio/amr";
        } else if (pathname.endsWith(".ogg")) {
          mimeType = "audio/ogg";
        } else {
          // Zalo voice messages mặc định là M4A/AAC
          mimeType = "audio/m4a";
        }
      }

      // Chuẩn hóa một số biến thể MIME type cho Gemini
      if (mimeType === "audio/x-m4a") mimeType = "audio/m4a";
      if (mimeType === "audio/mpeg") mimeType = "audio/mp3";
      if (mimeType === "audio/x-wav") mimeType = "audio/wav";

      // 5. Đọc ArrayBuffer và chuyển thành Base64
      const arrayBuffer = await res.arrayBuffer();
      if (!arrayBuffer || arrayBuffer.byteLength === 0) {
        return null;
      }

      const base64Data = Buffer.from(arrayBuffer).toString("base64");
      return {
        mimeType,
        data: base64Data,
      };
    } catch (error) {
      if (attempt === retryCount) {
        console.warn(
          `⚠️ [AudioHelper] Thất bại khi tải tệp âm thanh (${trimmedUrl}):`,
          error instanceof Error ? error.message : String(error)
        );
      } else {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  return null;
}

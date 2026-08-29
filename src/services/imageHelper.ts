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
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
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

      // 3. Kiểm tra Content-Type
      const rawContentType = res.headers.get("content-type") || "";
      const mimeType = rawContentType.split(";")[0].trim().toLowerCase();

      const isImage =
        mimeType.startsWith("image/") || mimeType === "application/octet-stream";
      if (!isImage && mimeType) {
        return null;
      }

      const buffer = await res.arrayBuffer();
      if (buffer.byteLength === 0) {
        return null;
      }

      return {
        mimeType: mimeType.startsWith("image/") ? mimeType : "image/jpeg",
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

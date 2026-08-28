import {
  Zalo,
  type API,
  type Credentials,
  LoginQRCallbackEventType,
  type LoginQRCallbackEvent,
} from "zca-js";
import sharp from "sharp";
import jsQR from "jsqr";
import qrcode from "qrcode-terminal";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import http from "node:http";
import { config } from "../config/index.js";
import { renderChatPage } from "../server/chatUi.js";
import { ChatHistoryRepository } from "../database/repositories/chatHistoryRepository.js";
import { CandidateRepository } from "../database/repositories/candidateRepository.js";
import { ZaloService } from "../services/zaloService.js";
import { ThreadType } from "../types/zalo.types.js";
import { chatBroadcaster } from "../server/chatBroadcaster.js";
import { UserContextManager } from "../services/userContextManager.js";

/**
 * Trích xuất kích thước và metadata ảnh cho zca-js v2+
 */
export async function imageMetadataGetter(filePath: string) {
  try {
    const data = await fs.readFile(filePath);
    const metadata = await sharp(data).metadata();
    return {
      height: metadata.height ?? 0,
      width: metadata.width ?? 0,
      size: metadata.size ?? data.length,
    };
  } catch (error) {
    console.error(`❌ Lỗi khi đọc metadata ảnh (${filePath}):`, error);
    throw error;
  }
}

/**
 * Giải mã chuỗi URL Zalo thực sự trong ảnh PNG và hiển thị mã QR chuẩn trên Terminal
 */
export async function renderQrToTerminal(pngBase64: string): Promise<boolean> {
  try {
    const buffer = Buffer.from(pngBase64, "base64");
    const { data, info } = await sharp(buffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const decoded = jsQR(new Uint8ClampedArray(data), info.width, info.height);
    if (decoded && decoded.data) {
      qrcode.generate(decoded.data, { small: true });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Quản lý trạng thái và Web Portal Server
 */
let qrServer: http.Server | null = null;
let currentQrBase64: string | null = null;
let qrStatus: "waiting" | "scanned" | "expired" | "declined" | "success" = "waiting";
let scannedUserName: string | null = null;
let loggedInAccount: {
  id: string;
  loginTime: string;
} | null = null;

let logoutCallback: (() => Promise<void> | void) | null = null;
let activeZaloService: ZaloService | null = null;

/**
 * Cung cấp tham chiếu ZaloService cho Web Server để gửi tin nhắn từ Web UI
 */
export function setZaloService(service: ZaloService): void {
  activeZaloService = service;
}

/**
 * Đăng ký callback khi có sự kiện Đăng xuất từ Web Portal
 */
export function onLogout(callback: () => Promise<void> | void): void {
  logoutCallback = callback;
}

/**
 * Cập nhật thông tin tài khoản sau khi đăng nhập thành công
 */
export function setLoggedInAccount(ownId: string): void {
  loggedInAccount = {
    id: ownId,
    loginTime: new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
  };
  qrStatus = "success";
}

/**
 * Khởi động Web Server quản lý phiên, mã QR và giao diện Web Chat
 */
export function startQrWebServer(port: number = config.qrPort): void {
  if (qrServer) return;

  qrServer = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url || "/", `http://localhost:${port}`);
    const pathname = parsedUrl.pathname;

    // 1. Giao diện Web Chat (/chat?thread=...)
    if (pathname === "/chat") {
      const threadId = parsedUrl.searchParams.get("thread") || "";
      const ownId = loggedInAccount?.id || (activeZaloService ? activeZaloService.getOwnId() : "");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderChatPage(threadId, ownId));
      return;
    }

    // 2. Server-Sent Events (SSE) Stream thời gian thực cho tin nhắn
    if (pathname === "/api/chat/events") {
      const threadId = parsedUrl.searchParams.get("thread") || "";
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });

      // Gửi event chào ban đầu
      res.write(`: connected\n\n`);

      const unsubscribeMessage = chatBroadcaster.onThreadMessage(threadId, (record) => {
        try {
          res.write(`data: ${JSON.stringify(record)}\n\n`);
        } catch {
          // Bỏ qua nếu socket đã đóng
        }
      });

      const unsubscribeRename = chatBroadcaster.onThreadRename(threadId, (data) => {
        try {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch {
          // Bỏ qua nếu socket đã đóng
        }
      });

      const keepAlive = setInterval(() => {
        try {
          res.write(`: ping\n\n`);
        } catch {
          // ignore
        }
      }, 15000);

      req.on("close", () => {
        unsubscribeMessage();
        unsubscribeRename();
        clearInterval(keepAlive);
      });
      return;
    }

    // 2.5. API GET: Lấy danh sách các cuộc trò chuyện (Threads List) phân trang phục vụ Lazy Load
    if (pathname === "/api/chat/threads") {
      try {
        const limitParam = Number(parsedUrl.searchParams.get("limit")) || 20;
        const limit = Math.min(Math.max(limitParam, 1), 100);
        const offset = Math.max(Number(parsedUrl.searchParams.get("offset")) || 0, 0);
        const search = parsedUrl.searchParams.get("search") || "";
        const filter = (parsedUrl.searchParams.get("filter") || "all") as import("../database/repositories/chatHistoryRepository.js").ThreadFilter;

        const chatHistoryRepo = new ChatHistoryRepository();
        const candidateRepo = new CandidateRepository();
        const { ThreadMetadataRepository } = await import("../database/repositories/threadMetadataRepository.js");
        const threadMetaRepo = new ThreadMetadataRepository();
        const total = chatHistoryRepo.getTotalThreadsCount(search, filter);
        const threadItems = chatHistoryRepo.getThreadList(limit, offset, search, filter);

        // Làm giàu thông tin từng thread với tên hiển thị, isGroup và isManual
        const enrichedThreads = await Promise.all(
          threadItems.map(async (item) => {
            let threadName = "";
            let isGroup = item.isGroup;

            if (activeZaloService) {
              try {
                const timeoutPromise = <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
                  Promise.race([p, new Promise<T>((res) => setTimeout(() => res(fallback), ms))]);

                const detectedGroup = await timeoutPromise(activeZaloService.isGroupThread(item.threadId), 300, isGroup);
                if (detectedGroup !== item.isGroup) {
                  isGroup = detectedGroup;
                  chatHistoryRepo.updateThreadIsGroup(item.threadId, detectedGroup);
                }

                if (isGroup) {
                  threadName = await timeoutPromise(activeZaloService.getGroupName(item.threadId), 300, "");
                } else {
                  threadName = await timeoutPromise(activeZaloService.getUserName(item.threadId), 300, "");
                }
              } catch {
                // Bỏ qua lỗi ZaloService
              }
            }

            if (!threadName) {
              if (item.candidateName) {
                threadName = item.candidateName;
              } else if (item.senderName && item.senderName !== "Unknown" && item.senderName !== "Ứng viên") {
                threadName = item.senderName;
              } else {
                threadName = isGroup ? `Nhóm ${item.threadId}` : `Người dùng ${item.threadId}`;
              }
            }

            const isManual = Boolean(item.isManual || threadMetaRepo.isManual(item.threadId) || /^-M(\s|_|-|$)/i.test(threadName));
            if (isManual && !/^-M(\s|_|-|$)/i.test(threadName)) {
              threadName = `-M ${threadName}`;
            }

            const avatarLetter = (threadName || "U").trim().charAt(0).toUpperCase();

            return {
              threadId: item.threadId,
              threadName,
              avatarLetter,
              isGroup,
              isManual,
              lastContent: item.lastContent,
              lastHasImage: item.lastHasImage,
              lastTimestamp: item.lastTimestamp,
              lastRole: item.lastRole,
              candidateName: item.candidateName,
              targetCompany: item.targetCompany,
              phoneNumber: item.phoneNumber,
            };
          })
        );

        const hasMore = threadItems.length === limit && offset + threadItems.length < total;
        const nextOffset = offset + threadItems.length;

        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-cache, no-store, must-revalidate",
        });
        res.end(
          JSON.stringify({
            success: true,
            threads: enrichedThreads,
            total,
            limit,
            offset,
            filter,
            hasMore,
            nextOffset,
          })
        );
      } catch (err) {
        console.error("❌ [API Chat Threads] Lỗi khi lấy danh sách cuộc trò chuyện:", err);
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ success: false, error: String(err) }));
      }
      return;
    }

    // 3. API GET: Lấy lịch sử chat và thông tin ứng viên của thread (hỗ trợ lazy load tin cũ với ?before=)
    if (pathname === "/api/chat/history") {
      const threadId = parsedUrl.searchParams.get("thread");
      if (!threadId) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ success: false, error: "Thiếu tham số thread" }));
        return;
      }

      try {
        const chatHistoryRepo = new ChatHistoryRepository();
        const candidateRepo = new CandidateRepository();
        const beforeParam = parsedUrl.searchParams.get("before");
        const limitParam = Number(parsedUrl.searchParams.get("limit")) || 30;
        const limit = Math.min(Math.max(limitParam, 5), 100);

        let messages: import("../database/repositories/chatHistoryRepository.js").ChatMessageRecord[] = [];
        if (beforeParam && !isNaN(Number(beforeParam))) {
          messages = chatHistoryRepo.getHistoryBefore(threadId, Number(beforeParam), limit);
        } else {
          messages = chatHistoryRepo.getRecentHistory(threadId, limit);
        }

        const candidate = candidateRepo.getLatestCandidate(threadId);

        const { ThreadMetadataRepository } = await import("../database/repositories/threadMetadataRepository.js");
        const threadMetaRepo = new ThreadMetadataRepository();
        const meta = threadMetaRepo.getMetadata(threadId);

        let threadName = meta?.customName || "";
        let isGroup = meta ? meta.isGroup : false;

        if (activeZaloService) {
          try {
            isGroup = await activeZaloService.isGroupThread(threadId);
            if (!threadName) {
              if (isGroup) {
                threadName = await activeZaloService.getGroupName(threadId);
              } else {
                threadName = await activeZaloService.getUserName(threadId);
              }
            }
          } catch {
            // Bỏ qua
          }
        }

        // Fallback tên hiển thị nếu API chưa trả về
        if (!threadName) {
          if (candidate?.fullName || candidate?.senderName) {
            threadName = candidate.fullName || candidate.senderName;
          } else if (messages && messages.length > 0) {
            const userMsg = messages.find(
              (m) =>
                m.role === "user" &&
                m.senderName &&
                m.senderName !== "Unknown" &&
                m.senderName !== "Ứng viên" &&
                m.senderName !== "Thành viên nhóm"
            );
            if (userMsg?.senderName) {
              threadName = userMsg.senderName;
            }
          }
        }

        if (!threadName) {
          threadName = isGroup ? `Nhóm ${threadId}` : `Người dùng ${threadId}`;
        }

        const isManual = Boolean(meta?.isManual || /^-M(\s|_|-|$)/i.test(threadName));
        if (isManual && !/^-M(\s|_|-|$)/i.test(threadName)) {
          threadName = `-M ${threadName}`;
        }

        const ownId = loggedInAccount?.id || (activeZaloService ? activeZaloService.getOwnId() : "");
        const enrichedMessages = messages.map((m) => {
          if (m.role === "model" || (ownId && m.senderId === ownId) || m.senderId === "admin") {
            return {
              ...m,
              senderName: "Admin (Tôi)",
            };
          }
          if (!isGroup) {
            return {
              ...m,
              senderName: threadName || m.senderName || "Ứng viên",
            };
          }
          return {
            ...m,
            senderName: m.senderName || `Thành viên (${m.senderId})`,
          };
        });

        // Kiểm tra xem còn tin cũ hơn mốc tin nhắn đầu tiên không
        const oldestTimestamp = enrichedMessages.length > 0 ? enrichedMessages[0].timestamp : 0;
        let hasMoreOlder = false;
        if (oldestTimestamp > 0) {
          const olderRows = chatHistoryRepo.getHistoryBefore(threadId, oldestTimestamp, 1);
          hasMoreOlder = olderRows.length > 0;
        }

        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-cache, no-store, must-revalidate",
        });
        res.end(
          JSON.stringify({
            success: true,
            threadId,
            threadName,
            isGroup,
            isManual,
            candidate,
            messages: enrichedMessages,
            history: enrichedMessages,
            hasMoreOlder,
            oldestTimestamp,
          })
        );
      } catch (err) {
        console.error("❌ [API Chat History] Lỗi khi lấy dữ liệu:", err);
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ success: false, error: String(err) }));
      }
      return;
    }

    // 4. API POST: Gửi tin nhắn trực tiếp từ Web Chat tới Zalo của thread
    if (req.method === "POST" && pathname === "/api/chat/send") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", async () => {
        try {
          const payload = JSON.parse(body || "{}");
          const { threadId, message, type } = payload;

          if (!threadId || !message) {
            res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
            res.end(
              JSON.stringify({
                success: false,
                error: "Thiếu tham số threadId hoặc message",
              })
            );
            return;
          }

          if (!activeZaloService) {
            res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
            res.end(
              JSON.stringify({
                success: false,
                error: "Dịch vụ Zalo Bot chưa sẵn sàng hoặc chưa hoàn tất đăng nhập",
              })
            );
            return;
          }

          // Gửi tin nhắn tự động phân biệt ThreadType và fallback
          const sendType = type !== undefined ? type : undefined;
          await activeZaloService.sendMessageAuto(threadId, message, sendType);

          console.log(`📤 [Web Chat] Đã gửi tin nhắn trực tiếp tới thread [${threadId}]: "${message}"`);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(
            JSON.stringify({
              success: true,
              message: "Đã gửi tin nhắn thành công",
            })
          );
        } catch (err) {
          console.error("❌ [Web Chat] Lỗi khi gửi tin nhắn:", err);
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ success: false, error: String(err) }));
        }
      });
      return;
    }

    // 3.1. API POST: Gửi hình ảnh trực tiếp tới thread Zalo qua Web Chat
    if (req.method === "POST" && pathname === "/api/chat/send-image") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 30 * 1024 * 1024) {
          // Max 30MB
          req.destroy();
        }
      });
      req.on("end", async () => {
        try {
          const { threadId, imageBase64, filename } = JSON.parse(body || "{}");
          if (!threadId || !imageBase64) {
            res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ success: false, error: "Thiếu threadId hoặc imageBase64" }));
            return;
          }

          if (!activeZaloService) {
            res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ success: false, error: "Zalo client chưa sẵn sàng hoặc chưa đăng nhập." }));
            return;
          }

          // Ghi buffer tạm thời ra thư mục uploads
          const uploadDir = path.resolve("./data/uploads");
          if (!fsSync.existsSync(uploadDir)) {
            fsSync.mkdirSync(uploadDir, { recursive: true });
          }

          const rawExt = (filename && path.extname(filename).toLowerCase()) || ".png";
          const validExts = [".jpg", ".jpeg", ".png", ".webp"];
          const safeExt = validExts.includes(rawExt) ? rawExt : ".png";
          const tempFileName = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${safeExt}`;
          const tempFilePath = path.join(uploadDir, tempFileName);

          // Loại bỏ tiền tố data:image/...;base64, nếu có
          const cleanBase64 = imageBase64.includes(",")
            ? imageBase64.split(",")[1]
            : imageBase64;
          await fs.writeFile(tempFilePath, Buffer.from(cleanBase64.trim(), "base64"));

          // Gửi qua Zalo API
          let sendResult: any = null;
          try {
            sendResult = await activeZaloService.sendAttachmentAuto(threadId, tempFilePath);
          } catch (sendErr) {
            console.error("⚠️ Lỗi gửi attachment qua Zalo API:", sendErr);
            res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ success: false, error: "Zalo API từ chối gửi ảnh: " + String(sendErr) }));
            return;
          }

          // Lấy URL ảnh nếu có từ kết quả Zalo API
          let remoteUrl = "";
          if (Array.isArray(sendResult) && sendResult[0]?.normalUrl) {
            remoteUrl = sendResult[0].normalUrl;
          } else if (sendResult?.normalUrl) {
            remoteUrl = sendResult.normalUrl;
          }
          const finalImageUrl = remoteUrl || `data:image/png;base64,${cleanBase64}`;

          // Lưu vào cơ sở dữ liệu SQLite
          const chatHistoryRepo = new ChatHistoryRepository();
          chatHistoryRepo.addMessage({
            threadId,
            senderId: loggedInAccount?.id || "admin",
            senderName: "Admin (Tôi)",
            role: "model",
            content: "",
            hasImage: true,
            imageUrls: [finalImageUrl],
            timestamp: Date.now(),
          });

          console.log(`🖼️ [Web Chat] Đã gửi hình ảnh đính kèm tới thread [${threadId}]`);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(
            JSON.stringify({
              success: true,
              message: "Đã gửi ảnh thành công",
              imageUrl: finalImageUrl,
            })
          );
        } catch (err) {
          console.error("❌ [Web Chat] Lỗi khi xử lý gửi ảnh:", err);
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ success: false, error: String(err) }));
        }
      });
      return;
    }

    // 5. API POST: Đổi tên hiển thị / Đặt tên gợi nhớ nhanh như Zalo
    if (req.method === "POST" && pathname === "/api/chat/rename") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", async () => {
        try {
          const payload = JSON.parse(body || "{}");
          const { threadId, newName, isGroup } = payload;

          if (!threadId || !newName || !newName.trim()) {
            res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
            res.end(
              JSON.stringify({
                success: false,
                error: "Thiếu thông tin threadId hoặc tên mới (newName)",
              })
            );
            return;
          }

          const trimmedName = newName.trim();
          let zaloResult: { success: boolean; error?: string } = { success: true };

          // 1. Đồng bộ lên Zalo API (đổi tên nhóm hoặc đặt tên gợi nhớ bạn bè)
          if (activeZaloService) {
            zaloResult = await activeZaloService.changeThreadName(
              threadId,
              trimmedName,
              isGroup
            );
          }

          // 2. Cập nhật UserContext bộ nhớ
          try {
            const userContextMgr = UserContextManager.getInstance();
            const ctx = userContextMgr.getContext(threadId, threadId, trimmedName);
            if (ctx) {
              ctx.senderName = trimmedName;
              userContextMgr.saveAndSync(ctx);
            }
          } catch (ucErr) {
            // ignore
          }

          // 3. Phát sự kiện Realtime tới Web Chat SSE
          chatBroadcaster.broadcastThreadRenamed(threadId, trimmedName);

          console.log(
            `✏️ [Web Chat] Đã đổi tên nhanh thread [${threadId}] thành "${trimmedName}" (Zalo Sync: ${
              zaloResult.success ? "OK" : "Lỗi: " + zaloResult.error
            })`
          );

          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(
            JSON.stringify({
              success: true,
              threadId,
              newName: trimmedName,
              zaloSynced: zaloResult.success,
              zaloError: zaloResult.error || undefined,
            })
          );
        } catch (err: any) {
          console.error("❌ [API Chat Rename] Lỗi khi xử lý đổi tên:", err);
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ success: false, error: err?.message || String(err) }));
        }
      });
      return;
    }

    // 6. API POST: Chuyển đổi nhanh chế độ AI / Manual (Thủ công) với tiền tố -M
    if (req.method === "POST" && pathname === "/api/chat/toggle-mode") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", async () => {
        try {
          const payload = JSON.parse(body || "{}");
          const { threadId, targetMode, isGroup } = payload;

          if (!threadId) {
            res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ success: false, error: "Thiếu tham số threadId" }));
            return;
          }

          let currentName = "";
          let checkGroup = isGroup;
          if (activeZaloService) {
            if (checkGroup === undefined) {
              checkGroup = await activeZaloService.isGroupThread(threadId);
            }
            currentName = checkGroup
              ? await activeZaloService.getGroupName(threadId)
              : await activeZaloService.getUserName(threadId);
          }

          if (!currentName || currentName.startsWith("Người dùng ") || currentName.startsWith("Nhóm ")) {
            const candidateRepo = new CandidateRepository();
            const candidate = candidateRepo.getLatestCandidate(threadId);
            if (candidate?.fullName || candidate?.senderName) {
              currentName = candidate.fullName || candidate.senderName;
            }
          }

          if (!currentName) {
            currentName = checkGroup ? `Nhóm_${threadId.slice(-4)}` : `Khách_${threadId.slice(-4)}`;
          }

          let newName = currentName.trim();
          let newMode: "ai" | "manual" = targetMode;

          if (targetMode === "manual") {
            if (!/^-M(\s|_|-|$)/i.test(newName)) {
              newName = `-M ${newName}`;
            }
            newMode = "manual";
          } else if (targetMode === "ai") {
            newName = newName.replace(/^-M[\s\-_]*/i, "").trim();
            if (!newName) {
              newName = checkGroup ? `Nhóm ${threadId}` : `Khách ${threadId}`;
            }
            newMode = "ai";
          } else {
            // Tự động đảo mode nếu không truyền targetMode
            if (/^-M(\s|_|-|$)/i.test(newName)) {
              newName = newName.replace(/^-M[\s\-_]*/i, "").trim();
              newMode = "ai";
            } else {
              newName = `-M ${newName}`;
              newMode = "manual";
            }
          }

          let zaloResult: { success: boolean; error?: string } = { success: true };
          if (activeZaloService) {
            zaloResult = await activeZaloService.changeThreadName(threadId, newName, checkGroup);
          }

          // Cập nhật UserContext
          try {
            const userContextMgr = UserContextManager.getInstance();
            const ctx = userContextMgr.getContext(threadId, threadId, newName);
            if (ctx) {
              ctx.senderName = newName;
              userContextMgr.saveAndSync(ctx);
            }
          } catch {}

          // Phát sự kiện Realtime SSE
          chatBroadcaster.broadcastThreadRenamed(threadId, newName);

          console.log(
            `🔄 [Chuyển chế độ] Thread [${threadId}] -> Mode: ${newMode.toUpperCase()} | Tên mới: "${newName}" (Zalo: ${
              zaloResult.success ? "OK" : "Lỗi: " + zaloResult.error
            })`
          );

          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(
            JSON.stringify({
              success: true,
              threadId,
              mode: newMode,
              newName,
              zaloSynced: zaloResult.success,
              zaloError: zaloResult.error || undefined,
            })
          );
        } catch (err: any) {
          console.error("❌ [API Toggle Mode] Lỗi khi chuyển chế độ:", err);
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ success: false, error: err?.message || String(err) }));
        }
      });
      return;
    }

    // 7. API GET: Trả về trạng thái phiên đăng nhập & mã QR
    if (pathname === "/api/status" || pathname === "/api/qr") {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate",
      });
      res.end(
        JSON.stringify({
          isLoggedIn: !!loggedInAccount,
          account: loggedInAccount,
          status: qrStatus,
          image: currentQrBase64,
          scannedUser: scannedUserName,
        })
      );
      return;
    }

    // 5. API POST: Xử lý Đăng xuất (Logout)
    if (req.method === "POST" && pathname === "/api/logout") {
      try {
        if (fsSync.existsSync(config.sessionFilePath)) {
          await fs.unlink(config.sessionFilePath);
          console.log(`\n🗑️ [LOGOUT] Đã xóa file phiên: ${config.sessionFilePath}`);
        }
        loggedInAccount = null;
        currentQrBase64 = null;
        qrStatus = "waiting";
        scannedUserName = null;

        console.log("👋 [LOGOUT] Đã đăng xuất tài khoản qua Web Portal!");
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(
          JSON.stringify({
            success: true,
            message: "Đã đăng xuất thành công. Đang tạo mã QR mới...",
          })
        );

        // Kích hoạt callback khởi động lại luồng quét mã QR mới ngay trong ứng dụng
        if (logoutCallback) {
          setTimeout(async () => {
            try {
              await logoutCallback?.();
            } catch (error) {
              console.error("❌ Lỗi khi khởi động lại sau đăng xuất:", error);
            }
          }, 300);
        }
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ success: false, error: String(err) }));
      }
      return;
    }

    // 6. Trang Web Portal Dashboard UI
    const html = `
      <!DOCTYPE html>
      <html lang="vi">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Zalo AI Bot - Quản Lý Phiên Đăng Nhập</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f0f2f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; color: #1e293b; }
          .card { background: white; border-radius: 20px; padding: 32px; box-shadow: 0 12px 40px rgba(0,0,0,0.08); text-align: center; max-width: 440px; width: 100%; transition: all 0.3s ease; }
          .logo { font-size: 26px; font-weight: 800; color: #0068ff; margin-bottom: 6px; display: flex; align-items: center; justify-content: center; gap: 8px; }
          .subtitle { color: #64748b; font-size: 14px; margin-bottom: 24px; }
          
          /* Status Badges */
          .status-badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 600; margin-bottom: 20px; }
          .status-waiting { background: #eff6ff; color: #1d4ed8; }
          .status-scanned { background: #fef3c7; color: #b45309; }
          .status-success { background: #dcfce7; color: #15803d; }
          .status-expired { background: #fee2e2; color: #b91c1c; }

          /* QR Code Wrapper */
          .qr-wrapper { background: #fff; padding: 12px; border-radius: 16px; border: 2px solid #0068ff; display: inline-block; margin-bottom: 20px; min-width: 250px; min-height: 250px; position: relative; }
          .qr-wrapper img { width: 250px; height: 250px; display: block; border-radius: 8px; }
          .qr-placeholder { width: 250px; height: 250px; display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 14px; }

          /* Instructions */
          .instructions { background: #f8fafc; border-radius: 12px; padding: 14px; text-align: left; font-size: 13px; color: #334155; line-height: 1.6; margin-bottom: 16px; }
          .instructions ol { padding-left: 20px; }

          /* Dashboard Info */
          .info-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 18px; text-align: left; margin-bottom: 24px; }
          .info-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; font-size: 14px; }
          .info-row:last-child { margin-bottom: 0; }
          .info-label { color: #64748b; font-weight: 500; }
          .info-value { color: #0f172a; font-weight: 700; word-break: break-all; }

          /* Logout Button */
          .btn-logout { width: 100%; padding: 12px 20px; background: #ef4444; color: white; border: none; border-radius: 12px; font-size: 15px; font-weight: 600; cursor: pointer; transition: background 0.2s; display: flex; align-items: center; justify-content: center; gap: 8px; }
          .btn-logout:hover { background: #dc2626; }
          .btn-logout:disabled { background: #94a3b8; cursor: not-allowed; }

          .footer { font-size: 12px; color: #94a3b8; margin-top: 16px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="logo">🤖 Zalo AI Bot</div>
          <div class="subtitle" id="subTitle">Hệ thống Trợ lý Tuyển dụng Tự động</div>

          <!-- 1. GIAO DIỆN KHI CHƯA ĐĂNG NHẬP (QUÉT MÃ QR) -->
          <div id="loginView">
            <div id="statusBadge" class="status-badge status-waiting">⏳ Đang khởi tạo mã QR...</div>

            <div class="qr-wrapper">
              <div id="qrPlaceholder" class="qr-placeholder">Đang tải mã QR...</div>
              <img id="qrImage" src="" alt="Zalo Login QR Code" style="display: none;" />
            </div>

            <div class="instructions">
              <ol>
                <li>Mở app <strong>Zalo</strong> trên điện thoại.</li>
                <li>Chọn biểu tượng <strong>Quét mã QR</strong> ở góc trên.</li>
                <li>Hướng camera vào mã trên và nhấn <strong>Xác nhận đăng nhập</strong>.</li>
              </ol>
            </div>
          </div>

          <!-- 2. GIAO DIỆN KHI ĐÃ ĐĂNG NHẬP THÀNH CÔNG (DASHBOARD) -->
          <div id="dashboardView" style="display: none;">
            <div class="status-badge status-success">🟢 Đang hoạt động (Online)</div>

            <div class="info-box">
              <div class="info-row">
                <span class="info-label">👤 Tài khoản Zalo ID:</span>
                <span class="info-value" id="accId">---</span>
              </div>
              <div class="info-row">
                <span class="info-label">⏱️ Đăng nhập lúc:</span>
                <span class="info-value" id="accLoginTime">---</span>
              </div>
              <div class="info-row">
                <span class="info-label">🤖 Model AI:</span>
                <span class="info-value">${config.geminiModel}</span>
              </div>
            </div>

            <a href="/chat" style="display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; padding: 12px 20px; background: #0068ff; color: white; border-radius: 12px; font-size: 15px; font-weight: 600; text-decoration: none; margin-bottom: 12px; transition: background 0.2s;">
              💬 Mở giao diện Chat Trực Tiếp (/chat)
            </a>

            <button id="btnLogout" class="btn-logout" onclick="handleLogout()">
              🚪 Đăng xuất tài khoản
            </button>
          </div>

          <div class="footer">Web Portal đang chạy trên cổng ${port}.</div>
        </div>

        <script>
          let lastImage = "";

          async function checkStatus() {
            try {
              const res = await fetch("/api/status");
              const data = await res.json();

              const loginView = document.getElementById("loginView");
              const dashboardView = document.getElementById("dashboardView");
              const subTitle = document.getElementById("subTitle");

              if (data.isLoggedIn && data.account) {
                // Đã đăng nhập thành công -> Hiện Dashboard
                loginView.style.display = "none";
                dashboardView.style.display = "block";
                subTitle.innerText = "Phiên hoạt động của Bot đang kết nối";
                document.getElementById("accId").innerText = data.account.id;
                document.getElementById("accLoginTime").innerText = data.account.loginTime;
              } else {
                // Chưa đăng nhập -> Hiện QR Code
                loginView.style.display = "block";
                dashboardView.style.display = "none";
                subTitle.innerText = "Quét mã QR bằng ứng dụng Zalo trên điện thoại để cấp quyền";

                const imgEl = document.getElementById("qrImage");
                const placeholderEl = document.getElementById("qrPlaceholder");
                const statusEl = document.getElementById("statusBadge");

                if (data.image && data.image !== lastImage) {
                  lastImage = data.image;
                  imgEl.src = "data:image/png;base64," + data.image;
                  imgEl.style.display = "block";
                  placeholderEl.style.display = "none";
                }

                if (data.status === "waiting") {
                  statusEl.className = "status-badge status-waiting";
                  statusEl.innerHTML = "⏳ Vui lòng quét mã QR";
                } else if (data.status === "scanned") {
                  statusEl.className = "status-badge status-scanned";
                  statusEl.innerHTML = "👀 Đã quét bởi <strong>" + (data.scannedUser || "bạn") + "</strong>! Hãy nhấn Xác nhận.";
                } else if (data.status === "expired") {
                  statusEl.className = "status-badge status-expired";
                  statusEl.innerHTML = "⌛ Mã đã hết hạn. Đang làm mới...";
                }
              }
            } catch (err) {
              console.error("Lỗi khi kiểm tra trạng thái:", err);
            }
          }

          async function handleLogout() {
            if (!confirm("Bạn có chắc chắn muốn đăng xuất tài khoản Zalo Bot này?")) {
              return;
            }

            const btn = document.getElementById("btnLogout");
            btn.disabled = true;
            btn.innerText = "⏳ Đang đăng xuất...";

            try {
              const res = await fetch("/api/logout", { method: "POST" });
              const data = await res.json();
              alert(data.message || "Đã đăng xuất thành công!");
              location.reload();
            } catch (err) {
              alert("Lỗi khi đăng xuất: " + err.message);
              btn.disabled = false;
              btn.innerText = "🚪 Đăng xuất tài khoản";
            }
          }

          setInterval(checkStatus, 1500);
          checkStatus();
        </script>
      </body>
      </html>
    `;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });

  qrServer.listen(port, () => {
    console.log(`🌐 [WEB PORTAL]: Đang mở tại http://localhost:${port} để quét mã QR và quản lý phiên`);
  });
}

function stopQrWebServer(): void {
  if (qrServer) {
    try {
      qrServer.close();
    } catch {
      // Bỏ qua
    }
    qrServer = null;
    currentQrBase64 = null;
    qrStatus = "waiting";
    scannedUserName = null;
    loggedInAccount = null;
  }
}

/**
 * Đọc file session lưu trữ trên đĩa
 */
export async function loadSession(
  sessionFilePath: string = config.sessionFilePath
): Promise<Credentials | null> {
  try {
    if (!fsSync.existsSync(sessionFilePath)) {
      return null;
    }
    const content = await fs.readFile(sessionFilePath, "utf-8");
    const parsed = JSON.parse(content) as Credentials;
    if (parsed.cookie && parsed.imei) {
      return parsed;
    }
    return null;
  } catch (error) {
    console.warn("⚠️ Không thể đọc file session hiện tại:", error);
    return null;
  }
}

/**
 * Lưu credentials vào file session
 */
export async function saveSession(
  credentials: Credentials,
  sessionFilePath: string = config.sessionFilePath
): Promise<void> {
  try {
    const dir = path.dirname(sessionFilePath);
    if (!fsSync.existsSync(dir)) {
      await fs.mkdir(dir, { recursive: true });
    }
    await fs.writeFile(
      sessionFilePath,
      JSON.stringify(credentials, null, 2),
      "utf-8"
    );
    console.log(`💾 Đã lưu session vào: ${sessionFilePath}`);
  } catch (error) {
    console.error("❌ Lỗi khi lưu file session:", error);
  }
}

/**
 * Khởi tạo instance Zalo Client
 */
export function createZaloClient(): Zalo {
  return new Zalo({
    imageMetadataGetter,
    selfListen: config.selfListen,
    checkUpdate: config.checkUpdate,
  });
}

/**
 * Tiến hành đăng nhập vào Zalo:
 * 1. Ưu tiên Credentials từ biến môi trường (.env)
 * 2. Đọc Session từ file session.json
 * 3. Nếu chưa có / hết hạn -> Hiển thị QR Code qua:
 *    - Render chuẩn trực tiếp trên SSH Terminal
 *    - Web Server mở cổng trên VPS (http://<IP_VPS>:3000)
 *    - Tự động bật ảnh trên máy nếu có Desktop GUI
 */
export async function authenticateZalo(): Promise<API> {
  const zalo = createZaloClient();

  // 1. Thử đăng nhập bằng biến môi trường
  if (config.credentials) {
    try {
      console.log("🔐 Đang thử đăng nhập bằng thông tin từ biến môi trường...");
      const api = await zalo.login(config.credentials);
      console.log("✅ Đăng nhập thành công từ biến môi trường!");
      setLoggedInAccount(api.getOwnId());
      startQrWebServer(config.qrPort);
      return api;
    } catch (error) {
      console.warn("⚠️ Đăng nhập bằng biến môi trường thất bại:", error);
    }
  }

  // 2. Thử đăng nhập bằng file session.json
  const savedSession = await loadSession(config.sessionFilePath);
  if (savedSession) {
    try {
      console.log(`🔐 Đang đăng nhập bằng file session (${config.sessionFilePath})...`);
      const api = await zalo.login(savedSession);
      console.log("✅ Đăng nhập thành công từ file session!");
      setLoggedInAccount(api.getOwnId());
      startQrWebServer(config.qrPort);
      return api;
    } catch (error) {
      console.warn("⚠️ Session đã lưu không còn hợp lệ hoặc đã hết hạn:", error);
    }
  }

  // 3. Fallback: Đăng nhập bằng mã QR
  console.log("📱 Không tìm thấy phiên hợp lệ. Khởi tạo mã QR để đăng nhập...");

  // Khởi động Mini Web Server trên VPS / Local
  startQrWebServer(config.qrPort);

  try {
    const api = await zalo.loginQR(
      {
        userAgent: config.userAgent,
      },
      async (event: LoginQRCallbackEvent) => {
        switch (event.type) {
          case LoginQRCallbackEventType.QRCodeGenerated: {
            currentQrBase64 = event.data.image;
            qrStatus = "waiting";
            scannedUserName = null;

            console.log("\n=======================================================");
            console.log("👉 VUI LÒNG QUÉT MÃ QR ĐĂNG NHẬP ZALO:");
            console.log("=======================================================\n");

            // Hướng dẫn dành cho VPS / Headless Server / Local Web
            console.log(`🌐 [WEB PORTAL]: Mở trình duyệt tại http://localhost:${config.qrPort} (hoặc http://<IP_VPS>:${config.qrPort}) để quét mã QR`);

            // Hiển thị mã QR chuẩn trên SSH Terminal
            console.log("\n📺 [TRÊN TERMINAL SSH]: Bạn có thể quét trực tiếp mã QR dưới đây:\n");
            await renderQrToTerminal(event.data.image);
            break;
          }

          case LoginQRCallbackEventType.QRCodeScanned: {
            qrStatus = "scanned";
            scannedUserName = event.data.display_name;
            console.log(
              `\n👀 Đã quét mã QR bởi người dùng: ${event.data.display_name}. Vui lòng nhấn "Xác nhận đăng nhập" trên điện thoại...`
            );
            break;
          }

          case LoginQRCallbackEventType.QRCodeExpired: {
            qrStatus = "expired";
            console.log("⌛ Mã QR đã hết hạn. Đang tự động tạo lại mã mới...");
            break;
          }

          case LoginQRCallbackEventType.QRCodeDeclined: {
            qrStatus = "declined";
            console.log("❌ Bạn đã từ chối xác nhận đăng nhập trên điện thoại.");
            break;
          }

          case LoginQRCallbackEventType.GotLoginInfo: {
            qrStatus = "success";
            console.log("🎉 Đã nhận thông tin đăng nhập thành công!");
            const newCredentials: Credentials = {
              cookie: event.data.cookie,
              imei: event.data.imei,
              userAgent: event.data.userAgent || config.userAgent,
            };
            await saveSession(newCredentials, config.sessionFilePath);
            break;
          }
        }
      }
    );

    setLoggedInAccount(api.getOwnId());
    console.log("🚀 Đăng nhập Zalo hoàn tất! Web Portal đang hoạt động làm Dashboard quản lý.");
    return api;
  } catch (error) {
    throw error;
  }
}

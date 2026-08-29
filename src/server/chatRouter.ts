import http from "node:http";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultPublicDir = path.join(__dirname, "public");
import { renderChatPage } from "./chatUi.js";
import { chatBroadcaster } from "./chatBroadcaster.js";
import { ChatHistoryRepository, CandidateRepository, ThreadMetadataRepository, type ThreadFilter, type ChatMessageRecord } from "../database/index.js";
import { UserContextManager } from "../services/userContextManager.js";
import { type ZaloService } from "../services/zaloService.js";

/**
 * ChatRouter: Chuyên trách điều phối và xử lý toàn bộ các routes của Web Chat:
 * - Phục vụ Static Files (/static/chat.css, /static/chat.js)
 * - Render giao diện Web Chat (/chat)
 * - Server-Sent Events (SSE) Realtime (/api/chat/events)
 * - APIs: Threads list, History, Send message, Send image, Rename, Toggle mode
 *
 * SRP: Tách toàn bộ logic HTTP Web Chat ra khỏi auth và session management.
 */
export async function handleChatRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
  parsedUrl: URL,
  activeZaloService: ZaloService | null,
  loggedInAccount: { id: string; loginTime?: string; name?: string } | null
): Promise<boolean> {
  // 1. Phục vụ Static Files (/static/...)
  if (pathname.startsWith("/static/")) {
    const relativePath = pathname.replace(/^\/static\//, "");
    const publicDir = fsSync.existsSync(defaultPublicDir)
      ? defaultPublicDir
      : path.resolve("./src/server/public");
    const filePath = path.normalize(path.join(publicDir, relativePath));

    if (!filePath.startsWith(publicDir)) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Forbidden");
      return true;
    }

    if (fsSync.existsSync(filePath) && fsSync.statSync(filePath).isFile()) {
      try {
        const content = await fs.readFile(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const contentType =
          ext === ".css"
            ? "text/css; charset=utf-8"
            : ext === ".js"
            ? "application/javascript; charset=utf-8"
            : ext === ".svg"
            ? "image/svg+xml"
            : "text/plain; charset=utf-8";

        res.writeHead(200, {
          "Content-Type": contentType,
          "Cache-Control": "no-cache, no-store, must-revalidate",
        });
        res.end(content);
        return true;
      } catch (err) {
        console.error("❌ [Static Server] Lỗi đọc file:", err);
      }
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
    return true;
  }

  // 2. Giao diện Web Chat (/chat?thread=...)
  if (pathname === "/chat") {
    const threadId = parsedUrl.searchParams.get("thread") || "";
    const ownId = loggedInAccount?.id || (activeZaloService ? activeZaloService.getOwnId() : "");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderChatPage(threadId, ownId));
    return true;
  }

  // 3. Server-Sent Events (SSE) Stream thời gian thực cho tin nhắn & threads
  if (pathname === "/api/chat/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    res.write(`: connected\n\n`);

    // Lắng nghe tất cả tin nhắn mới trong hệ thống
    const onMessage = (record: ChatMessageRecord) => {
      try {
        res.write(`data: ${JSON.stringify({ type: "new_message", data: record })}\n\n`);
      } catch {}
    };

    // Lắng nghe sự kiện đổi tên thread
    const onRename = (data: { threadId: string; newName: string }) => {
      try {
        res.write(`data: ${JSON.stringify({ type: "thread_renamed", data })}\n\n`);
      } catch {}
    };

    chatBroadcaster.on("message", onMessage);
    chatBroadcaster.on("thread_renamed", onRename);

    const keepAlive = setInterval(() => {
      try {
        res.write(`: ping\n\n`);
      } catch {}
    }, 15000);

    req.on("close", () => {
      chatBroadcaster.off("message", onMessage);
      chatBroadcaster.off("thread_renamed", onRename);
      clearInterval(keepAlive);
    });
    return true;
  }

  // 4. API GET: Danh sách cuộc trò chuyện phân trang
  if (pathname === "/api/chat/threads") {
    try {
      const limitParam = Number(parsedUrl.searchParams.get("limit")) || 20;
      const limit = Math.min(Math.max(limitParam, 1), 100);
      const offset = Math.max(Number(parsedUrl.searchParams.get("offset")) || 0, 0);
      const search = parsedUrl.searchParams.get("search") || "";
      const filter = (parsedUrl.searchParams.get("filter") || "all") as ThreadFilter;

      const chatHistoryRepo = new ChatHistoryRepository();
      const threadMetaRepo = new ThreadMetadataRepository();
      const total = chatHistoryRepo.getTotalThreadsCount(search, filter);
      const threadItems = chatHistoryRepo.getThreadList(limit, offset, search, filter);

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
            } catch {}
          }

          if (!threadName) {
            if (item.candidateName) {
              threadName = item.candidateName;
            } else if (item.senderName && item.senderName !== "Unknown" && item.senderName !== "Ứng viên") {
              threadName = item.senderName;
            } else {
              threadName = isGroup ? `Nhóm ${item.threadId}` : `Người dùng ${item.threadId}`;
            }
          } else if (!threadName.startsWith("Nhóm ") && !threadName.startsWith("Người dùng ")) {
            // Tự động lưu tên nhóm / tên người dùng vào DB để tìm kiếm nhanh
            threadMetaRepo.upsertMetadata(item.threadId, threadName, undefined, isGroup);
          }

          const isManual = !isGroup && Boolean(
            item.isManual ||
            threadMetaRepo.isManual(item.threadId) ||
            /^-M(\s|_|-|$)/i.test(threadName)
          );
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
    return true;
  }

  // 5. API GET: Lịch sử tin nhắn và thông tin ứng viên
  if (pathname === "/api/chat/history") {
    const threadId = parsedUrl.searchParams.get("thread");
    if (!threadId) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ success: false, error: "Thiếu tham số thread" }));
      return true;
    }

    try {
      const chatHistoryRepo = new ChatHistoryRepository();
      const candidateRepo = new CandidateRepository();
      const threadMetaRepo = new ThreadMetadataRepository();
      const beforeParam = parsedUrl.searchParams.get("before");
      const limitParam = Number(parsedUrl.searchParams.get("limit")) || 30;
      const limit = Math.min(Math.max(limitParam, 5), 100);

      let messages = beforeParam && !isNaN(Number(beforeParam))
        ? chatHistoryRepo.getHistoryBefore(threadId, Number(beforeParam), limit)
        : chatHistoryRepo.getRecentHistory(threadId, limit);

      const candidate = candidateRepo.getLatestCandidate(threadId);
      const meta = threadMetaRepo.getMetadata(threadId);

      let threadName = meta?.customName || "";
      let isGroup = meta ? meta.isGroup : false;

      if (activeZaloService) {
        try {
          isGroup = await activeZaloService.isGroupThread(threadId);
          if (!threadName) {
            threadName = isGroup
              ? await activeZaloService.getGroupName(threadId)
              : await activeZaloService.getUserName(threadId);
          }
        } catch {}
      }

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

      const isManual = !isGroup && Boolean(
        meta?.isManual || /^-M(\s|_|-|$)/i.test(threadName)
      );
      if (isManual && !/^-M(\s|_|-|$)/i.test(threadName)) {
        threadName = `-M ${threadName}`;
      }

      const ownId = loggedInAccount?.id || (activeZaloService ? activeZaloService.getOwnId() : "");
      const enrichedMessages = messages.map((m) => {
        if (m.role === "model" || (ownId && m.senderId === ownId) || m.senderId === "admin") {
          return { ...m, senderName: "Admin (Tôi)" };
        }
        if (!isGroup) {
          return { ...m, senderName: threadName || m.senderName || "Ứng viên" };
        }
        return { ...m, senderName: m.senderName || `Thành viên (${m.senderId})` };
      });

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
    return true;
  }

  // 6. API POST: Gửi tin nhắn
  if (req.method === "POST" && pathname === "/api/chat/send") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}");
        const { threadId, message, type } = payload;

        if (!threadId || !message) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ success: false, error: "Thiếu tham số threadId hoặc message" }));
          return;
        }

        if (!activeZaloService) {
          res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ success: false, error: "Zalo client chưa sẵn sàng" }));
          return;
        }

        await activeZaloService.sendMessageAuto(threadId, message, type);
        console.log(`📤 [Web Chat] Đã gửi tin nhắn tới [${threadId}]: "${message}"`);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ success: true, message: "Đã gửi tin nhắn thành công" }));
      } catch (err) {
        console.error("❌ [Web Chat] Lỗi gửi tin nhắn:", err);
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ success: false, error: String(err) }));
      }
    });
    return true;
  }

  // 7. API POST: Gửi ảnh đính kèm (hỗ trợ cả 1 ảnh và nhiều ảnh cùng lúc)
  if (req.method === "POST" && pathname === "/api/chat/send-image") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 50 * 1024 * 1024) req.destroy();
    });
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}");
        const { threadId, imageBase64, imageData, images, content } = payload;
        
        const rawImages: string[] = [];
        if (Array.isArray(images) && images.length > 0) {
          rawImages.push(...images);
        } else if (imageBase64) {
          rawImages.push(imageBase64);
        } else if (imageData) {
          rawImages.push(imageData);
        }

        if (!threadId || rawImages.length === 0) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ success: false, error: "Thiếu threadId hoặc hình ảnh" }));
          return;
        }

        if (!activeZaloService) {
          res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ success: false, error: "Zalo client chưa sẵn sàng." }));
          return;
        }

        const uploadDir = path.resolve("./data/uploads");
        if (!fsSync.existsSync(uploadDir)) {
          fsSync.mkdirSync(uploadDir, { recursive: true });
        }

        const finalImageUrls: string[] = [];

        for (let i = 0; i < rawImages.length; i++) {
          const rawBase64 = rawImages[i];
          const cleanBase64 = rawBase64.includes(",") ? rawBase64.split(",")[1] : rawBase64;
          const tempFileName = `upload_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 8)}.png`;
          const tempFilePath = path.join(uploadDir, tempFileName);

          await fs.writeFile(tempFilePath, Buffer.from(cleanBase64.trim(), "base64"));

          try {
            const sendResult: any = await activeZaloService.sendAttachmentAuto(threadId, tempFilePath);
            let remoteUrl = "";
            if (Array.isArray(sendResult) && sendResult[0]?.normalUrl) {
              remoteUrl = sendResult[0].normalUrl;
            } else if (sendResult?.normalUrl) {
              remoteUrl = sendResult.normalUrl;
            }
            finalImageUrls.push(remoteUrl || `data:image/png;base64,${cleanBase64}`);
          } catch (sendErr) {
            console.error(`⚠️ Lỗi gửi ảnh thứ ${i + 1}:`, sendErr);
            finalImageUrls.push(`data:image/png;base64,${cleanBase64}`);
          }
        }

        const chatHistoryRepo = new ChatHistoryRepository();
        chatHistoryRepo.addMessage({
          threadId,
          senderId: loggedInAccount?.id || "admin",
          senderName: "Admin (Tôi)",
          role: "model",
          content: content || "",
          hasImage: true,
          imageUrls: finalImageUrls,
          timestamp: Date.now(),
        });

        console.log(`🖼️ [Web Chat] Đã gửi ${finalImageUrls.length} hình ảnh tới [${threadId}]`);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({
          success: true,
          message: `Đã gửi ${finalImageUrls.length} ảnh thành công`,
          imageUrls: finalImageUrls,
        }));
      } catch (err) {
        console.error("❌ [Web Chat] Lỗi gửi ảnh:", err);
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ success: false, error: String(err) }));
      }
    });
    return true;
  }

  // 8. API POST: Đổi tên hiển thị
  if (req.method === "POST" && pathname === "/api/chat/rename") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}");
        const { threadId, newName, isGroup } = payload;

        if (!threadId || !newName || !newName.trim()) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ success: false, error: "Thiếu thông tin threadId hoặc newName" }));
          return;
        }

        const trimmedName = newName.trim();
        let zaloResult: { success: boolean; error?: string } = { success: true };

        if (activeZaloService) {
          zaloResult = await activeZaloService.changeThreadName(threadId, trimmedName, isGroup);
        }

        // 2. Cập nhật SQLite metadata và UserContext bộ nhớ
        try {
          const threadMetaRepo = new ThreadMetadataRepository();
          threadMetaRepo.upsertMetadata(threadId, trimmedName, undefined, isGroup);

          const userContextMgr = UserContextManager.getInstance();
          const ctx = userContextMgr.getContext(threadId, threadId, trimmedName);
          if (ctx) {
            ctx.senderName = trimmedName;
            userContextMgr.saveAndSync(ctx);
          }
        } catch (ucErr) {
          // ignore
        }

        chatBroadcaster.broadcastThreadRenamed(threadId, trimmedName);
        console.log(`✏️ [Web Chat] Đã đổi tên thread [${threadId}] -> "${trimmedName}"`);

        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({
          success: true,
          threadId,
          newName: trimmedName,
          zaloSynced: zaloResult.success,
          zaloError: zaloResult.error || undefined,
        }));
      } catch (err: any) {
        console.error("❌ [API Chat Rename] Lỗi:", err);
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ success: false, error: err?.message || String(err) }));
      }
    });
    return true;
  }

  // 9. API POST: Chuyển đổi chế độ AI / Manual
  if (req.method === "POST" && pathname === "/api/chat/toggle-mode") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
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
          if (!/^-M(\s|_|-|$)/i.test(newName)) newName = `-M ${newName}`;
          newMode = "manual";
        } else if (targetMode === "ai") {
          newName = newName.replace(/^-M[\s\-_]*/i, "").trim();
          if (!newName) newName = checkGroup ? `Nhóm ${threadId}` : `Khách ${threadId}`;
          newMode = "ai";
        } else {
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

        // Cập nhật SQLite metadata và UserContext
        try {
          const threadMetaRepo = new ThreadMetadataRepository();
          threadMetaRepo.setManualMode(threadId, newMode === "manual", newName);

          const userContextMgr = UserContextManager.getInstance();
          const ctx = userContextMgr.getContext(threadId, threadId, newName);
          if (ctx) {
            ctx.senderName = newName;
            userContextMgr.saveAndSync(ctx);
          }
        } catch {}

        chatBroadcaster.broadcastThreadRenamed(threadId, newName);
        console.log(`🔄 [Chuyển chế độ] Thread [${threadId}] -> Mode: ${newMode.toUpperCase()} | Tên: "${newName}"`);

        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({
          success: true,
          threadId,
          mode: newMode,
          newName,
          zaloSynced: zaloResult.success,
          zaloError: zaloResult.error || undefined,
        }));
      } catch (err: any) {
        console.error("❌ [API Toggle Mode] Lỗi:", err);
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ success: false, error: err?.message || String(err) }));
      }
    });
    return true;
  }

  return false;
}

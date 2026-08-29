import {
  type Message,
  type GroupEvent,
  type FriendEvent,
  type Reaction,
  type Undo,
  type Typing,
  ThreadType,
} from "zca-js";
import { type ParsedMessage, type MediaType, type MediaItem } from "../types/zalo.types.js";
import { config } from "../config/index.js";

export type MessageHandlerCallback = (parsedMessage: ParsedMessage) => Promise<void> | void;
export type GroupEventHandlerCallback = (event: GroupEvent) => Promise<void> | void;
export type FriendEventHandlerCallback = (event: FriendEvent) => Promise<void> | void;
export type ReactionHandlerCallback = (reaction: Reaction) => Promise<void> | void;
export type UndoHandlerCallback = (undo: Undo) => Promise<void> | void;
export type TypingHandlerCallback = (typing: Typing) => Promise<void> | void;

/**
 * EventDispatcher: Nhận và định tuyến các sự kiện từ Zalo Listener tới các Handler
 */
export class EventDispatcher {
  private ownId: string = "";
  private messageHandlers: MessageHandlerCallback[] = [];
  private groupEventHandlers: GroupEventHandlerCallback[] = [];
  private friendEventHandlers: FriendEventHandlerCallback[] = [];
  private reactionHandlers: ReactionHandlerCallback[] = [];
  private undoHandlers: UndoHandlerCallback[] = [];
  private typingHandlers: TypingHandlerCallback[] = [];

  public setOwnId(id: string): void {
    this.ownId = id;
  }

  public onMessage(handler: MessageHandlerCallback): void {
    this.messageHandlers.push(handler);
  }

  public onGroupEvent(handler: GroupEventHandlerCallback): void {
    this.groupEventHandlers.push(handler);
  }

  public onFriendEvent(handler: FriendEventHandlerCallback): void {
    this.friendEventHandlers.push(handler);
  }

  public onReaction(handler: ReactionHandlerCallback): void {
    this.reactionHandlers.push(handler);
  }

  public onUndo(handler: UndoHandlerCallback): void {
    this.undoHandlers.push(handler);
  }

  public onTyping(handler: TypingHandlerCallback): void {
    this.typingHandlers.push(handler);
  }

  /**
   * Chuẩn hoá Message thô từ Zalo SDK thành ParsedMessage
   */
  public parseMessage(
    rawMessage: Message,
    prefix: string = config.botPrefix
  ): ParsedMessage {
    const isGroup = rawMessage.type === ThreadType.Group;
    const uidFrom = String(rawMessage.data?.uidFrom ?? "");
    const idTo = String(rawMessage.data?.idTo ?? "");

    const isSelf =
      rawMessage.isSelf === true ||
      uidFrom === "0" ||
      (this.ownId !== "" && uidFrom === this.ownId);

    let threadId = rawMessage.threadId;
    if (!isGroup) {
      if (isSelf) {
        threadId = idTo && idTo !== "0" && idTo !== this.ownId ? idTo : rawMessage.threadId || idTo;
      } else {
        threadId = uidFrom && uidFrom !== "0" && uidFrom !== this.ownId ? uidFrom : rawMessage.threadId;
      }
    } else {
      threadId = idTo && idTo !== "0" ? idTo : rawMessage.threadId;
    }

    const senderId = isSelf ? this.ownId || uidFrom || "0" : uidFrom;
    const senderName = isSelf ? "Admin (Tôi)" : rawMessage.data.dName || "Unknown";

    const msgType = String(rawMessage.data?.msgType || "");
    const rawData = rawMessage.data as any;
    const content = rawMessage.data?.content;

    let mediaType: MediaType = null;
    let mediaUrls: MediaItem[] | undefined = undefined;
    let text = "";

    // ── PHÂN LOẠI TƯỜNG MINH THEO MSGTYPE CỦA ZALO ─────────────────────────
    switch (msgType) {
      case "chat.photo":
      case "chat.image": {
        let photoUrl: string | undefined = undefined;
        let photoDesc: string | undefined = undefined;
        const photoItems: MediaItem[] = [];

        // 1. Phân tích content nếu là string
        if (typeof content === "string" && content.trim()) {
          try {
            const parsed = JSON.parse(content);
            if (Array.isArray(parsed)) {
              for (const item of parsed) {
                const u = item?.hdUrl || item?.normalUrl || item?.rawUrl || item?.url || item?.href || item?.thumb;
                const d = item?.description || item?.title;
                if (u) photoItems.push({ url: u, description: d || undefined });
              }
            } else if (typeof parsed === "object" && parsed) {
              const rawList = parsed.photos || parsed.images || parsed.urls;
              if (Array.isArray(rawList)) {
                for (const item of rawList) {
                  const u = typeof item === "string" ? item : item?.hdUrl || item?.normalUrl || item?.rawUrl || item?.url || item?.href || item?.thumb;
                  const d = typeof item === "object" ? item?.description || item?.title : undefined;
                  if (u) photoItems.push({ url: u, description: d || undefined });
                }
              } else {
                photoUrl = parsed.hdUrl || parsed.normalUrl || parsed.rawUrl || parsed.url || parsed.href || parsed.thumb;
                photoDesc = parsed.description || parsed.title;
              }
            }
          } catch {
            if (content.startsWith("http")) photoUrl = content.trim();
            else text = content;
          }
        }
        // 2. Phân tích content nếu là object (chuẩn TAttachmentContent của zca-js)
        else if (content && typeof content === "object") {
          const attach = content as any;
          if (Array.isArray(attach)) {
            for (const item of attach) {
              const u = item?.hdUrl || item?.normalUrl || item?.rawUrl || item?.url || item?.href || item?.thumb;
              const d = item?.description || item?.title;
              if (u) photoItems.push({ url: u, description: d || undefined });
            }
          } else {
            const rawList = attach.photos || attach.images || attach.urls;
            if (Array.isArray(rawList)) {
              for (const item of rawList) {
                const u = typeof item === "string" ? item : item?.hdUrl || item?.normalUrl || item?.rawUrl || item?.url || item?.href || item?.thumb;
                const d = typeof item === "object" ? item?.description || item?.title : undefined;
                if (u) photoItems.push({ url: u, description: d || undefined });
              }
            } else {
              photoUrl = attach.hdUrl || attach.normalUrl || attach.rawUrl || attach.url || attach.href || attach.thumb;
              photoDesc = attach.description || attach.title;
              if (attach.params) {
                let p = attach.params;
                if (typeof p === "string" && p.trim()) {
                  try { p = JSON.parse(p); } catch {}
                }
                if (typeof p === "object" && p) {
                  photoUrl = photoUrl || p.hdUrl || p.normalUrl || p.rawUrl || p.url || p.href || p.thumb;
                  photoDesc = photoDesc || p.description || p.title;
                }
              }
            }
          }
        }

        // 3. Thử quét rawData.params
        if (!photoUrl && photoItems.length === 0 && rawData?.params) {
          let p = rawData.params;
          if (typeof p === "string" && p.trim()) {
            try { p = JSON.parse(p); } catch {
              if (p.startsWith("http")) photoUrl = p.trim();
            }
          }
          if (typeof p === "object" && p) {
            photoUrl = p.hdUrl || p.normalUrl || p.rawUrl || p.url || p.href || p.thumb;
            photoDesc = photoDesc || p.description || p.title;
          }
        }

        if (!photoUrl && photoItems.length === 0) {
          photoUrl = rawData?.hdUrl || rawData?.normalUrl || rawData?.rawUrl || rawData?.url || rawData?.href || rawData?.thumb;
        }

        mediaType = "photo";
        if (photoItems.length > 0) {
          mediaUrls = photoItems;
          text = photoDesc || photoItems[0]?.description || text;
        } else if (photoUrl) {
          mediaUrls = [{ url: photoUrl, description: photoDesc || undefined }];
          text = photoDesc || text;
        }
        break;
      }

      case "chat.sticker": {
        let stickerData: any = null;
        if (typeof content === "string" && content.trim()) {
          try { stickerData = JSON.parse(content); } catch {}
        } else if (content && typeof content === "object") {
          stickerData = content;
        }

        if (!stickerData && rawData?.paramsExt) {
          if (typeof rawData.paramsExt === "string" && rawData.paramsExt.trim()) {
            try { stickerData = JSON.parse(rawData.paramsExt); } catch {}
          } else if (typeof rawData.paramsExt === "object") {
            stickerData = rawData.paramsExt;
          }
        }

        if (!stickerData && rawData?.params) {
          if (typeof rawData.params === "string" && rawData.params.trim()) {
            try { stickerData = JSON.parse(rawData.params); } catch {}
          } else if (typeof rawData.params === "object") {
            stickerData = rawData.params;
          }
        }

        const id = stickerData?.id ? String(stickerData.id) : stickerData?.stickerId ? String(stickerData.stickerId) : undefined;
        const url = stickerData?.spriteUrl || stickerData?.url || (id ? `https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=${id}&size=130` : undefined);
        const description = stickerData?.text || stickerData?.description || undefined;

        mediaType = "sticker";
        if (url) {
          mediaUrls = [{ url, id, description }];
        }
        text = ""; // Sticker không có text
        break;
      }

      case "chat.voice":
      case "chat.audio": {
        let voiceUrl: string | undefined = undefined;
        let voiceDuration: number | undefined = undefined;

        // 1. Phân tích content nếu là string
        if (typeof content === "string" && content.trim()) {
          try {
            const parsedContent = JSON.parse(content);
            if (typeof parsedContent === "object" && parsedContent) {
              voiceUrl = parsedContent.voiceUrl || parsedContent.m4aUrl || parsedContent.url || parsedContent.href || parsedContent.audioUrl;
              voiceDuration = Number(parsedContent.duration || parsedContent.voiceDuration) || undefined;
            }
          } catch {
            if (content.startsWith("http")) {
              voiceUrl = content.trim();
            }
          }
        }
        // 2. Phân tích content nếu là object (chuẩn TAttachmentContent của zca-js)
        else if (content && typeof content === "object") {
          const attach = content as any;
          voiceUrl = attach.voiceUrl || attach.m4aUrl || attach.url || attach.href || attach.audioUrl;
          voiceDuration = Number(attach.duration || attach.voiceDuration) || undefined;

          if (attach.params) {
            let p = attach.params;
            if (typeof p === "string" && p.trim()) {
              try { p = JSON.parse(p); } catch {}
            }
            if (typeof p === "object" && p) {
              voiceUrl = voiceUrl || p.voiceUrl || p.m4aUrl || p.url || p.href || p.audioUrl;
              voiceDuration = voiceDuration || Number(p.duration || p.voiceDuration) || undefined;
            }
          }
        }

        // 3. Phân tích rawData.params nếu voiceUrl chưa có
        if (!voiceUrl && rawData?.params) {
          let p = rawData.params;
          if (typeof p === "string" && p.trim()) {
            try { p = JSON.parse(p); } catch {
              if (p.startsWith("http")) voiceUrl = p.trim();
            }
          }
          if (typeof p === "object" && p) {
            voiceUrl = voiceUrl || p.voiceUrl || p.m4aUrl || p.url || p.href || p.audioUrl;
            voiceDuration = voiceDuration || Number(p.duration || p.voiceDuration) || undefined;
          }
        }

        // 4. Phân tích rawData.paramsExt nếu voiceUrl chưa có
        if (!voiceUrl && rawData?.paramsExt) {
          let p = rawData.paramsExt;
          if (typeof p === "string" && p.trim()) {
            try { p = JSON.parse(p); } catch {}
          }
          if (typeof p === "object" && p) {
            voiceUrl = voiceUrl || p.voiceUrl || p.m4aUrl || p.url || p.href || p.audioUrl;
            voiceDuration = voiceDuration || Number(p.duration || p.voiceDuration) || undefined;
          }
        }

        // 5. Quét trực tiếp các trường trên rawData
        if (!voiceUrl) {
          voiceUrl = rawData?.voiceUrl || rawData?.m4aUrl || rawData?.url || rawData?.href || rawData?.audioUrl;
          if (!voiceDuration) {
            voiceDuration = Number(rawData?.duration || rawData?.voiceDuration) || undefined;
          }
        }

        mediaType = "voice";
        if (voiceUrl) {
          mediaUrls = [{ url: voiceUrl, duration: voiceDuration }];
        }
        text = ""; // Voice không có text
        break;
      }

      default: {
        if (rawData?.paramsExt?.containType === 36) {
          const stickerData: any = rawData.paramsExt;
          const id = stickerData.id ? String(stickerData.id) : undefined;
          const url = stickerData.spriteUrl || stickerData.url || (id ? `https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=${id}&size=130` : undefined);
          const description = stickerData.description || stickerData.text || undefined;

          mediaType = "sticker";
          if (url) {
            mediaUrls = [{ url, id, description }];
          }
          text = "";
          break;
        }

        mediaType = null;
        mediaUrls = undefined;
        if (typeof content === "string") {
          text = content;
        } else if (content && typeof content === "object") {
          const attach = content as any;
          text = attach.text || attach.msg || attach.title || "";
        }
        break;
      }
    }

    const trimmedText = text.trim();
    let command: string | undefined;
    const args: string[] = [];

    if (trimmedText.startsWith(prefix)) {
      const parts = trimmedText.slice(prefix.length).trim().split(/\s+/);
      if (parts.length > 0 && parts[0]) {
        command = parts[0].toLowerCase();
        args.push(...parts.slice(1));
      }
    }

    const rawQuote = rawMessage.data.quote as any;
    const hasQuote = Boolean(rawQuote);
    let quoteText: string | undefined = undefined;
    let quoteSenderId: string | undefined = undefined;
    let quoteSenderName: string | undefined = undefined;
    let quoteMsgType: string | undefined = undefined;
    let quoteMsgId: string | undefined = undefined;
    let quoteTimestamp: number | undefined = undefined;
    const quotedMediaUrls: MediaItem[] = [];

    if (hasQuote && rawQuote) {
      quoteMsgId =
        String(rawQuote.globalMsgId || rawQuote.cliMsgId || rawQuote.msgId || rawQuote.id || "") ||
        undefined;
      quoteText = typeof rawQuote.msg === "string" ? rawQuote.msg.trim() : undefined;
      quoteSenderId = rawQuote.ownerId ? String(rawQuote.ownerId) : undefined;
      quoteMsgType = rawQuote.msgType ? String(rawQuote.msgType) : undefined;
      quoteTimestamp = Number(rawQuote.ts || rawQuote.timestamp) || undefined;

      if ((this.ownId && quoteSenderId === this.ownId) || quoteSenderId === "admin") {
        quoteSenderName = "Bot";
      } else if (rawQuote.fromDName || rawQuote.dName) {
        quoteSenderName = String(rawQuote.fromDName || rawQuote.dName);
      } else if (quoteSenderId) {
        quoteSenderName = isGroup ? `Thành viên (${quoteSenderId})` : "Ứng viên";
      }

      if (rawQuote.attach) {
        try {
          const parsedAttach =
            typeof rawQuote.attach === "string"
              ? JSON.parse(rawQuote.attach)
              : rawQuote.attach;
          if (Array.isArray(parsedAttach)) {
            for (const item of parsedAttach) {
              const u = item?.hdUrl || item?.normalUrl || item?.rawUrl || item?.url || item?.href || item?.thumb;
              const d = item?.description || item?.title;
              if (u) quotedMediaUrls.push({ url: u, description: d || undefined });
            }
          } else if (parsedAttach && typeof parsedAttach === "object") {
            const u = parsedAttach?.hdUrl || parsedAttach?.normalUrl || parsedAttach?.rawUrl || parsedAttach?.url || parsedAttach?.href || parsedAttach?.thumb;
            const d = parsedAttach?.description || parsedAttach?.title;
            if (u) quotedMediaUrls.push({ url: u, description: d || undefined });
            if (d && !quoteText) {
              quoteText = `[Hình ảnh: ${d}]`;
            }
          }
        } catch {}
      }

      if (rawQuote.href || rawQuote.url || rawQuote.hdUrl) {
        const u = rawQuote.hdUrl || rawQuote.normalUrl || rawQuote.rawUrl || rawQuote.url || rawQuote.href;
        if (u && !quotedMediaUrls.some((m) => m.url === u)) {
          quotedMediaUrls.push({ url: u, description: quoteText });
        }
      }

      if (!quoteText) {
        if (quoteMsgType === "chat.photo" || rawQuote.attach || quotedMediaUrls.length > 0) {
          quoteText = "[Hình ảnh]";
        } else if (quoteMsgType === "chat.sticker") {
          quoteText = "[Nhãn dán / Sticker]";
        } else if (quoteMsgType === "chat.voice" || quoteMsgType === "chat.audio") {
          quoteText = "[Tin nhắn thoại]";
        }
      }
    }

    const messageId = String(rawMessage.data?.msgId || rawMessage.data?.cliMsgId || "") || undefined;

    return {
      id: messageId,
      raw: rawMessage,
      threadId,
      senderId,
      senderName,
      isGroup,
      isSelf,
      text: trimmedText,
      timestamp: Number(rawMessage.data.ts) || Date.now(),
      mediaType,
      mediaUrls,
      hasQuote,
      quoteText,
      quoteSenderName,
      quoteSenderId,
      quoteMsgType,
      quoteTimestamp,
      quotedMediaUrls: quotedMediaUrls.length > 0 ? quotedMediaUrls : undefined,
      quoteData: hasQuote && quoteText ? {
        msg: quoteText,
        msgId: quoteMsgId,
        senderId: quoteSenderId,
        senderName: quoteSenderName,
        msgType: quoteMsgType,
        timestamp: quoteTimestamp,
        quotedMediaUrls: quotedMediaUrls.length > 0 ? quotedMediaUrls : undefined,
      } : undefined,
      command,
      args,
    };
  }

  public async dispatchMessage(rawMessage: Message): Promise<void> {
    const parsed = this.parseMessage(rawMessage);
    for (const handler of this.messageHandlers) {
      try {
        await handler(parsed);
      } catch (error) {
        console.error("❌ Lỗi trong MessageHandler:", error);
      }
    }
  }

  public async dispatchGroupEvent(event: GroupEvent): Promise<void> {
    for (const handler of this.groupEventHandlers) {
      try {
        await handler(event);
      } catch (error) {
        console.error("❌ Lỗi trong GroupEventHandler:", error);
      }
    }
  }

  public async dispatchFriendEvent(event: FriendEvent): Promise<void> {
    for (const handler of this.friendEventHandlers) {
      try {
        await handler(event);
      } catch (error) {
        console.error("❌ Lỗi trong FriendEventHandler:", error);
      }
    }
  }

  public async dispatchReaction(reaction: Reaction): Promise<void> {
    for (const handler of this.reactionHandlers) {
      try {
        await handler(reaction);
      } catch (error) {
        console.error("❌ Lỗi trong ReactionHandler:", error);
      }
    }
  }

  public async dispatchUndo(undo: Undo): Promise<void> {
    for (const handler of this.undoHandlers) {
      try {
        await handler(undo);
      } catch (error) {
        console.error("❌ Lỗi trong UndoHandler:", error);
      }
    }
  }

  public async dispatchTyping(typing: Typing): Promise<void> {
    for (const handler of this.typingHandlers) {
      try {
        await handler(typing);
      } catch (error) {
        console.error("❌ Lỗi trong TypingHandler:", error);
      }
    }
  }
}

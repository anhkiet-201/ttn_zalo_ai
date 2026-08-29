import {
  type Message,
  type GroupEvent,
  type FriendEvent,
  type Reaction,
  type Undo,
  type Typing,
  ThreadType,
  type TAttachmentContent,
} from "zca-js";
import { type ParsedMessage } from "../types/zalo.types.js";
import { config } from "../config/index.js";

export type MessageHandlerCallback = (
  parsedMessage: ParsedMessage
) => Promise<void> | void;
export type GroupEventHandlerCallback = (
  event: GroupEvent
) => Promise<void> | void;
export type FriendEventHandlerCallback = (
  event: FriendEvent
) => Promise<void> | void;
export type ReactionHandlerCallback = (
  reaction: Reaction
) => Promise<void> | void;
export type UndoHandlerCallback = (undo: Undo) => Promise<void> | void;
export type TypingHandlerCallback = (typing: Typing) => Promise<void> | void;

/**
 * Kiểm tra xem một chuỗi có phải là URL HTTP/HTTPS hợp lệ hay không
 */
export function isValidHttpUrl(urlString: unknown): boolean {
  if (!urlString || typeof urlString !== "string") return false;
  try {
    const url = new URL(urlString.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Kiểm tra xem một URL có phải là file âm thanh (Audio/Voice) hay không
 */
export function isAudioUrl(urlString: unknown): boolean {
  if (!urlString || typeof urlString !== "string") return false;
  const lower = urlString.toLowerCase();
  return (
    lower.endsWith(".m4a") ||
    lower.endsWith(".aac") ||
    lower.endsWith(".mp3") ||
    lower.endsWith(".wav") ||
    lower.endsWith(".amr") ||
    lower.endsWith(".ogg") ||
    lower.includes("/voice/") ||
    lower.includes("voicemsg")
  );
}

/**
 * Trích xuất URL hình ảnh có chất lượng tốt nhất từ object attachment (ưu tiên hdUrl > url > normalUrl > href > thumb)
 */
export function extractBestImageUrl(obj: Record<string, unknown>): string | null {
  // Nếu object là voice/audio message, bỏ qua không trích xuất thành ảnh
  if (obj.voiceUrl || obj.m4aUrl || obj.audioUrl || obj.msgType === "chat.voice" || obj.msgType === "chat.audio") {
    return null;
  }

  const candidates = [
    obj.hdUrl,
    obj.url,
    obj.normalUrl,
    obj.href,
    obj.thumb,
    obj.spriteUrl,
    obj.webUrl,
    obj.fullUrl,
    obj.stickerUrl,
    obj.previewUrl,
  ];
  for (const candidate of candidates) {
    if (isValidHttpUrl(candidate) && !isAudioUrl(candidate)) {
      return (candidate as string).trim();
    }
  }
  return null;
}

/**
 * Trích xuất TẤT CẢ các URL hình ảnh từ một object hoặc mảng attachments/album
 */
export function extractAllImageUrls(obj: unknown): string[] {
  const urls: string[] = [];
  if (!obj) return urls;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      urls.push(...extractAllImageUrls(item));
    }
    return urls.filter((u) => !isAudioUrl(u));
  }

  if (typeof obj === "object" && obj !== null) {
    const record = obj as Record<string, unknown>;
    const best = extractBestImageUrl(record);
    if (best && !isAudioUrl(best)) urls.push(best);

    const listKeys = ["attachments", "photos", "images", "items", "list", "grid", "media", "subImages", "elements"];
    for (const key of listKeys) {
      if (Array.isArray(record[key])) {
        urls.push(...extractAllImageUrls(record[key]));
      }
    }
  } else if (typeof obj === "string" && isValidHttpUrl(obj) && !isAudioUrl(obj)) {
    urls.push(obj.trim());
  }

  return urls.filter((u) => !isAudioUrl(u));
}

/**
 * Trích xuất URL âm thanh (Voice Message) và thời lượng từ payload Zalo
 */
function extractVoiceInfo(data: any): { voiceUrl?: string; duration?: number } {
  if (!data) return {};

  let voiceUrl: string | undefined = undefined;
  let duration: number | undefined = undefined;

  // Nếu data là chuỗi JSON
  let target = data;
  if (typeof data === "string" && data.trim().startsWith("{") && data.trim().endsWith("}")) {
    try {
      target = JSON.parse(data.trim());
    } catch {
      target = data;
    }
  }

  if (typeof target === "object" && target !== null) {
    const urlKeys = [
      "voiceUrl",
      "voice_url",
      "m4aUrl",
      "m4a_url",
      "audioUrl",
      "audio_url",
      "href",
      "url",
      "directUrl",
    ];

    for (const key of urlKeys) {
      if (typeof target[key] === "string" && isValidHttpUrl(target[key])) {
        voiceUrl = target[key].trim();
        break;
      }
    }

    if (typeof target.duration === "number") {
      duration = target.duration;
    } else if (typeof target.duration === "string" && !isNaN(Number(target.duration))) {
      duration = Number(target.duration);
    }
  }

  return { voiceUrl, duration };
}

/**
 * Trích xuất thông tin Nhãn dán / Sticker (Sticker ID, Category, URL, Description) từ payload Zalo
 */
export function extractStickerInfo(
  content: any,
  params: any,
  paramsExt: any,
  msgType: string
): {
  isSticker: boolean;
  stickerId?: string;
  stickerCateId?: string;
  stickerUrl?: string;
  stickerText?: string;
} {
  let isSticker =
    msgType === "chat.sticker" ||
    msgType.includes("sticker") ||
    paramsExt?.containType === 36 ||
    params?.type === "chat.sticker";

  let target = content;
  if (typeof content === "string" && content.trim().startsWith("{") && content.trim().endsWith("}")) {
    try {
      target = JSON.parse(content.trim());
    } catch {
      target = content;
    }
  }

  const sources = [
    typeof target === "object" && target !== null ? target : {},
    typeof params === "object" && params !== null ? params : {},
    typeof paramsExt === "object" && paramsExt !== null ? paramsExt : {},
  ];

  let stickerId: string | undefined = undefined;
  let stickerCateId: string | undefined = undefined;
  let stickerUrl: string | undefined = undefined;
  let stickerText: string | undefined = undefined;

  for (const src of sources) {
    if (!stickerId && (src.eid || src.id || src.stickerId || src.sticker_id)) {
      stickerId = String(src.eid || src.id || src.stickerId || src.sticker_id);
    }
    if (!stickerCateId && (src.cateId || src.cate_id || src.catId || src.categoryId)) {
      stickerCateId = String(src.cateId || src.cate_id || src.catId || src.categoryId);
    }
    if (!stickerUrl) {
      const urlCandidates = [src.stickerUrl, src.spriteUrl, src.url, src.webUrl, src.hdUrl, src.thumb, src.href];
      for (const u of urlCandidates) {
        if (typeof u === "string" && isValidHttpUrl(u) && !isAudioUrl(u)) {
          stickerUrl = u.trim();
          break;
        }
      }
    }
    if (!stickerText) {
      const textCandidates = [src.text, src.description, src.caption, src.title, src.alt, src.stickerText];
      for (const t of textCandidates) {
        if (
          typeof t === "string" &&
          t.trim() &&
          t.trim() !== "[Sticker]" &&
          t.trim() !== "[Nhãn dán]" &&
          t.trim() !== "[🏷️ Sticker]" &&
          t.trim() !== "[🏷️ Nhãn dán / Sticker]" &&
          t.trim() !== "Nhãn dán biểu cảm"
        ) {
          stickerText = t.trim();
          break;
        }
      }
    }
  }

  // Nếu có stickerId mà chưa có URL, tạo URL Zalo Sticker CDN tiêu chuẩn hỗ trợ ảnh PNG sắc nét
  if (stickerId) {
    isSticker = true;
    if (!stickerUrl) {
      stickerUrl = `https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=${stickerId}&size=130`;
    }
  }

  return {
    isSticker,
    stickerId,
    stickerCateId,
    stickerUrl,
    stickerText,
  };
}

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

  /**
   * Cập nhật ID của tài khoản đang đăng nhập để nhận diện chính xác tin nhắn gửi từ thiết bị khác
   */
  public setOwnId(id: string): void {
    this.ownId = id;
  }

  /**
   * Đăng ký xử lý tin nhắn
   */
  public onMessage(handler: MessageHandlerCallback): void {
    this.messageHandlers.push(handler);
  }

  /**
   * Đăng ký xử lý sự kiện nhóm
   */
  public onGroupEvent(handler: GroupEventHandlerCallback): void {
    this.groupEventHandlers.push(handler);
  }

  /**
   * Đăng ký xử lý sự kiện kết bạn
   */
  public onFriendEvent(handler: FriendEventHandlerCallback): void {
    this.friendEventHandlers.push(handler);
  }

  /**
   * Đăng ký xử lý cảm xúc tin nhắn
   */
  public onReaction(handler: ReactionHandlerCallback): void {
    this.reactionHandlers.push(handler);
  }

  /**
   * Đăng ký xử lý sự kiện thu hồi tin nhắn
   */
  public onUndo(handler: UndoHandlerCallback): void {
    this.undoHandlers.push(handler);
  }

  /**
   * Đăng ký xử lý sự kiện đang gõ phím
   */
  public onTyping(handler: TypingHandlerCallback): void {
    this.typingHandlers.push(handler);
  }

  /**
   * Chuẩn hoá đối tượng Message thô thành ParsedMessage dễ thao tác
   * Đồng bộ chính xác tin nhắn gửi từ điện thoại, máy tính và các thiết bị khác cùng tài khoản.
   */
  public parseMessage(
    rawMessage: Message,
    prefix: string = config.botPrefix
  ): ParsedMessage {
    const isGroup = rawMessage.type === ThreadType.Group;
    const uidFrom = String(rawMessage.data?.uidFrom ?? "");
    const idTo = String(rawMessage.data?.idTo ?? "");

    // Nhận diện tin nhắn do chính tài khoản này gửi đi từ bất kỳ thiết bị nào (Mobile App, PC, Web, Bot)
    const isSelf =
      rawMessage.isSelf === true ||
      uidFrom === "0" ||
      (this.ownId !== "" && uidFrom === this.ownId);

    let threadId = rawMessage.threadId;
    if (!isGroup) {
      if (isSelf) {
        // Chat 1-1 tự gửi từ điện thoại/PC: idTo là ID người nhận (ứng viên)
        threadId =
          idTo && idTo !== "0" && idTo !== this.ownId
            ? idTo
            : rawMessage.threadId || idTo;
      } else {
        // Chat 1-1 nhận từ ứng viên: uidFrom là ID người gửi (ứng viên)
        threadId =
          uidFrom && uidFrom !== "0" && uidFrom !== this.ownId
            ? uidFrom
            : rawMessage.threadId;
      }
    } else {
      // Chat nhóm: threadId luôn là ID của nhóm
      threadId = idTo && idTo !== "0" ? idTo : rawMessage.threadId;
    }

    const senderId = isSelf ? this.ownId || uidFrom || "0" : uidFrom;
    const senderName = isSelf ? "Admin (Tôi)" : rawMessage.data.dName || "Unknown";

    // Trích xuất nội dung văn bản và hình ảnh đính kèm
    let text = "";
    const rawImageUrls: string[] = [];
    let imageDescription = "";

    if (typeof rawMessage.data.content === "string") {
      const contentStr = rawMessage.data.content.trim();
      // Kiểm tra nếu nội dung là chuỗi JSON chứa thông tin ảnh/tệp
      if (contentStr.startsWith("{") && contentStr.endsWith("}")) {
        try {
          const parsed = JSON.parse(contentStr);
          rawImageUrls.push(...extractAllImageUrls(parsed));
          if (parsed.description) imageDescription = parsed.description;
          if (parsed.title) text = parsed.title;
        } catch {
          text = contentStr;
        }
      } else {
        text = contentStr;
      }
    } else if (
      rawMessage.data.content &&
      typeof rawMessage.data.content === "object"
    ) {
      const attach = rawMessage.data.content as Record<string, unknown>;
      rawImageUrls.push(...extractAllImageUrls(attach));
      if (typeof attach.description === "string") imageDescription = attach.description;
      if (typeof attach.title === "string") text = attach.title;
    }

    // Kiểm tra thêm params & paramsExt từ Zalo
    const rawData = rawMessage.data as any;
    if (rawData?.params) {
      rawImageUrls.push(...extractAllImageUrls(rawData.params));
    }
    if (rawData?.paramsExt) {
      rawImageUrls.push(...extractAllImageUrls(rawData.paramsExt));
    }

    // Trích xuất thông tin Voice / Audio nếu có
    let voiceUrl: string | undefined = undefined;
    let voiceDuration: number | undefined = undefined;

    const voiceFromContent = extractVoiceInfo(rawMessage.data.content);
    if (voiceFromContent.voiceUrl) {
      voiceUrl = voiceFromContent.voiceUrl;
      voiceDuration = voiceFromContent.duration;
    }

    if (!voiceUrl && rawData?.params) {
      const voiceFromParams = extractVoiceInfo(rawData.params);
      if (voiceFromParams.voiceUrl) {
        voiceUrl = voiceFromParams.voiceUrl;
        voiceDuration = voiceFromParams.duration;
      }
    }

    if (!voiceUrl && rawData?.paramsExt) {
      const voiceFromParamsExt = extractVoiceInfo(rawData.paramsExt);
      if (voiceFromParamsExt.voiceUrl) {
        voiceUrl = voiceFromParamsExt.voiceUrl;
        voiceDuration = voiceFromParamsExt.duration;
      }
    }

    const msgType = String(rawMessage.data?.msgType || "");
    const isPhoto = msgType === "chat.photo";
    const isVoice = msgType === "chat.voice" || msgType === "chat.audio" || Boolean(voiceUrl);
    const hasVoice = Boolean(voiceUrl);

    // Trích xuất thông tin Sticker / Nhãn dán
    const stickerInfo = extractStickerInfo(
      rawMessage.data.content,
      rawData?.params,
      rawData?.paramsExt,
      msgType
    );
    const isSticker = stickerInfo.isSticker;
    const hasSticker = stickerInfo.isSticker;
    const stickerId = stickerInfo.stickerId;
    const stickerCateId = stickerInfo.stickerCateId;
    const stickerUrl = stickerInfo.stickerUrl;
    const stickerText = stickerInfo.stickerText;

    // Lọc trùng lặp URL và chỉ giữ các URL hình ảnh hợp lệ (loại bỏ voiceUrl, stickerUrl và file âm thanh)
    const validImageUrls = isVoice || isSticker
      ? []
      : Array.from(new Set(rawImageUrls)).filter((u) => isValidHttpUrl(u) && !isAudioUrl(u) && u !== voiceUrl && u !== stickerUrl);

    const hasImage = !isVoice && !isSticker && (isPhoto || validImageUrls.length > 0);
    const imageUrls = validImageUrls;

    // Nếu là sticker:
    if (isSticker) {
      if (stickerText) {
        text = `[🏷️ Sticker]: "${stickerText}"`;
      } else if (!text || text === "[Sticker]") {
        text = "[🏷️ Sticker]";
      }
    }

    // Nếu tin nhắn chỉ gửi ảnh mà không có chữ, giữ text rỗng hoặc theo mô tả ảnh
    if (hasImage && !isSticker && !text) {
      text = imageDescription || "";
    }

    const trimmedText = text.trim();
    let command: string | undefined;
    const args: string[] = [];

    // Kiểm tra xem tin nhắn có phải là Command không
    if (trimmedText.startsWith(prefix)) {
      const parts = trimmedText.slice(prefix.length).trim().split(/\s+/);
      if (parts.length > 0 && parts[0]) {
        command = parts[0].toLowerCase();
        args.push(...parts.slice(1));
      }
    }

    // Kiểm tra thông tin tin nhắn được Reply/Quote
    const rawQuote = rawMessage.data.quote as any;
    const hasQuote = Boolean(rawQuote);
    let quoteText: string | undefined = undefined;
    let quoteSenderId: string | undefined = undefined;
    let quoteSenderName: string | undefined = undefined;
    let quoteMsgType: string | undefined = undefined;

    if (hasQuote && rawQuote) {
      quoteText = typeof rawQuote.msg === "string" ? rawQuote.msg.trim() : undefined;
      quoteSenderId = rawQuote.ownerId ? String(rawQuote.ownerId) : undefined;
      quoteMsgType = rawQuote.msgType ? String(rawQuote.msgType) : undefined;

      // Nhận diện tên người gửi tin nhắn gốc được quote
      if ((this.ownId && quoteSenderId === this.ownId) || quoteSenderId === "admin") {
        quoteSenderName = "Bot";
      } else if (rawQuote.fromDName || rawQuote.dName) {
        quoteSenderName = String(rawQuote.fromDName || rawQuote.dName);
      } else if (quoteSenderId) {
        quoteSenderName = isGroup ? `Thành viên (${quoteSenderId})` : "Ứng viên";
      }

      // Nếu tin nhắn gốc là ảnh/sticker/voice mà msg rỗng
      if (!quoteText) {
        if (quoteMsgType === "chat.photo" || rawQuote.attach) {
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
      hasQuote,
      quoteText,
      quoteSenderName,
      quoteSenderId,
      quoteMsgType,
      quoteData: hasQuote && quoteText ? {
        msg: quoteText,
        senderId: quoteSenderId,
        senderName: quoteSenderName,
        msgType: quoteMsgType,
      } : undefined,
      command,
      args,
      hasImage,
      imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
      hasVoice,
      voiceUrl,
      voiceUrls: voiceUrl ? [voiceUrl] : undefined,
      voiceDuration,
      hasSticker,
      isSticker,
      stickerId,
      stickerCateId,
      stickerUrl,
      stickerText,
    };
  }

  /**
   * Kích hoạt xử lý sự kiện Tin Nhắn
   */
  public async dispatchMessage(rawMessage: Message): Promise<void> {
    const parsed = this.parseMessage(rawMessage);

    // Chạy qua tất cả các message handler đã đăng ký
    for (const handler of this.messageHandlers) {
      try {
        await handler(parsed);
      } catch (error) {
        console.error("❌ Lỗi trong MessageHandler:", error);
      }
    }
  }

  /**
   * Kích hoạt xử lý sự kiện Nhóm
   */
  public async dispatchGroupEvent(event: GroupEvent): Promise<void> {
    for (const handler of this.groupEventHandlers) {
      try {
        await handler(event);
      } catch (error) {
        console.error("❌ Lỗi trong GroupEventHandler:", error);
      }
    }
  }

  /**
   * Kích hoạt xử lý sự kiện Bạn Bè
   */
  public async dispatchFriendEvent(event: FriendEvent): Promise<void> {
    for (const handler of this.friendEventHandlers) {
      try {
        await handler(event);
      } catch (error) {
        console.error("❌ Lỗi trong FriendEventHandler:", error);
      }
    }
  }

  /**
   * Kích hoạt xử lý sự kiện Cảm Xúc
   */
  public async dispatchReaction(reaction: Reaction): Promise<void> {
    for (const handler of this.reactionHandlers) {
      try {
        await handler(reaction);
      } catch (error) {
        console.error("❌ Lỗi trong ReactionHandler:", error);
      }
    }
  }

  /**
   * Kích hoạt xử lý sự kiện Thu Hồi Tin Nhắn
   */
  public async dispatchUndo(undo: Undo): Promise<void> {
    for (const handler of this.undoHandlers) {
      try {
        await handler(undo);
      } catch (error) {
        console.error("❌ Lỗi trong UndoHandler:", error);
      }
    }
  }

  /**
   * Kích hoạt xử lý sự kiện Đang Gõ
   */
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

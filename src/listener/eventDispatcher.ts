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
 * Trích xuất URL hình ảnh có chất lượng tốt nhất từ object attachment (ưu tiên hdUrl > url > normalUrl > href > thumb)
 */
export function extractBestImageUrl(obj: Record<string, unknown>): string | null {
  const candidates = [obj.hdUrl, obj.url, obj.normalUrl, obj.href, obj.thumb];
  for (const candidate of candidates) {
    if (isValidHttpUrl(candidate)) {
      return (candidate as string).trim();
    }
  }
  return null;
}

/**
 * EventDispatcher: Nhận và định tuyến các sự kiện từ Zalo Listener tới các Handler
 */
export class EventDispatcher {
  private messageHandlers: MessageHandlerCallback[] = [];
  private groupEventHandlers: GroupEventHandlerCallback[] = [];
  private friendEventHandlers: FriendEventHandlerCallback[] = [];
  private reactionHandlers: ReactionHandlerCallback[] = [];
  private undoHandlers: UndoHandlerCallback[] = [];
  private typingHandlers: TypingHandlerCallback[] = [];

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
   */
  public parseMessage(
    rawMessage: Message,
    prefix: string = config.botPrefix
  ): ParsedMessage {
    const isGroup = rawMessage.type === ThreadType.Group;
    const isSelf = rawMessage.isSelf ?? false;
    const threadId = rawMessage.threadId;
    const senderId = rawMessage.data.uidFrom;
    const senderName = rawMessage.data.dName || "Unknown";

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
          const bestImg = extractBestImageUrl(parsed);
          if (bestImg) rawImageUrls.push(bestImg);
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
      const bestImg = extractBestImageUrl(attach);
      if (bestImg) rawImageUrls.push(bestImg);
      if (typeof attach.description === "string") imageDescription = attach.description;
      if (typeof attach.title === "string") text = attach.title;
    }

    // Lọc trùng lặp URL và chỉ giữ các URL hợp lệ
    const imageUrls = Array.from(new Set(rawImageUrls)).filter((u) => isValidHttpUrl(u));

    const isPhoto = rawMessage.data.msgType === "chat.photo";
    const hasImage = isPhoto || imageUrls.length > 0;

    // Nếu tin nhắn chỉ gửi ảnh mà không có chữ, gán chú thích mô tả
    if (hasImage && !text) {
      text = imageDescription || "[Người dùng gửi một hình ảnh]";
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
    const hasQuote = Boolean(rawMessage.data.quote);
    const quoteText = rawMessage.data.quote?.msg;

    return {
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
      command,
      args,
      hasImage,
      imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
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

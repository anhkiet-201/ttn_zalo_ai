import {
  type API,
  type Message,
  ThreadType,
  Reactions,
  type SendMessageResponse,
  type MessageContent,
  type SendMessageQuote,
  type ForwardMessagePayload,
  type ForwardMessageResponse,
} from "zca-js";
import { SQLiteDatabase } from "../database/sqliteDb.js";

/**
 * Tách một chuỗi văn bản dài thành nhiều đoạn ngắn (mặc định <= 1500 ký tự)
 * Ưu tiên ngắt tại dòng mới (\n) để giữ nguyên cấu trúc văn bản.
 */
export function splitTextIntoChunks(
  text: string,
  maxChunkLength: number = 1500
): string[] {
  if (!text || text.length <= maxChunkLength) {
    return [text];
  }

  const chunks: string[] = [];
  const lines = text.split("\n");
  let currentChunk = "";

  for (const line of lines) {
    if (currentChunk.length + line.length + 1 > maxChunkLength) {
      if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = "";
      }
      if (line.length > maxChunkLength) {
        let remainingLine = line;
        while (remainingLine.length > maxChunkLength) {
          chunks.push(remainingLine.slice(0, maxChunkLength));
          remainingLine = remainingLine.slice(maxChunkLength);
        }
        currentChunk = remainingLine;
      } else {
        currentChunk = line;
      }
    } else {
      currentChunk = currentChunk ? `${currentChunk}\n${line}` : line;
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Service đóng gói các thao tác gọi API Zalo thuận tiện và an toàn
 */
export class ZaloService {
  private readonly groupNameCache: Map<string, string> = new Map();

  constructor(private readonly api: API) {}

  /**
   * Lấy instance API gốc của zca-js
   */
  public get rawApi(): API {
    return this.api;
  }

  /**
   * Lấy ID tài khoản Zalo của chính Bot
   */
  public getOwnId(): string {
    return this.api.getOwnId();
  }

  /**
   * Gửi tin nhắn văn bản hoặc tin nhắn có định dạng đến người dùng/nhóm
   * Tự động chia nhỏ nếu nội dung văn bản vượt quá 1500 ký tự.
   */
  public async sendMessage(
    threadId: string,
    content: string | MessageContent,
    type: ThreadType = ThreadType.User
  ): Promise<SendMessageResponse> {
    try {
      if (typeof content === "string" && content.length > 1500) {
        const chunks = splitTextIntoChunks(content, 1500);
        let lastRes: SendMessageResponse | null = null;
        for (let i = 0; i < chunks.length; i++) {
          if (i > 0) {
            await new Promise((resolve) => setTimeout(resolve, 400));
          }
          lastRes = await this.api.sendMessage(chunks[i], threadId, type);
        }
        return lastRes!;
      }
      return await this.api.sendMessage(content, threadId, type);
    } catch (error) {
      console.error(`❌ Lỗi khi gửi tin nhắn tới ${threadId} (type=${type}):`, error);
      throw error;
    }
  }

  private groupCheckCache = new Map<string, boolean>();

  /**
   * Kiểm tra xem threadId có phải là Nhóm Zalo (Group) hay không
   */
  public async isGroupThread(threadId: string): Promise<boolean> {
    if (this.groupCheckCache.has(threadId)) {
      return this.groupCheckCache.get(threadId)!;
    }

    try {
      const gInfo = (await this.api.getGroupInfo(threadId)) as any;
      if (gInfo && gInfo.gridInfoMap && gInfo.gridInfoMap[threadId]) {
        this.groupCheckCache.set(threadId, true);
        return true;
      }
    } catch {
      // Không phải nhóm
    }

    this.groupCheckCache.set(threadId, false);
    return false;
  }

  /**
   * Gửi tin nhắn thông minh tự động phát hiện ThreadType và fallback
   * Đảm bảo gửi tin nhắn thành công cho cả tin nhắn 1-1 và tin nhắn Nhóm mà không bị lỗi tham số.
   */
  public async sendMessageAuto(
    threadId: string,
    content: string | MessageContent,
    preferredType?: ThreadType
  ): Promise<SendMessageResponse> {
    let primaryType = preferredType;

    // Tự động kiểm tra loại thread qua Zalo API và SQLite nếu chưa chỉ định
    if (primaryType === undefined) {
      const isGroup = await this.isGroupThread(threadId);
      primaryType = isGroup ? ThreadType.Group : ThreadType.User;
    }

    const secondaryType =
      primaryType === ThreadType.User ? ThreadType.Group : ThreadType.User;

    try {
      return await this.sendMessage(threadId, content, primaryType);
    } catch (err) {
      console.warn(
        `⚠️ [SendMessageAuto] Gửi với ThreadType=${primaryType} thất bại tới [${threadId}], đang tự động fallback sang ThreadType=${secondaryType}:`,
        err
      );
      return await this.sendMessage(threadId, content, secondaryType);
    }
  }

  /**
   * Tự động gửi hình ảnh/tập tin đính kèm tới thread với cơ chế fallback thông minh
   */
  public async sendAttachmentAuto(
    threadId: string,
    sources: string | string[],
    caption: string = "",
    preferredType?: ThreadType
  ): Promise<any> {
    let primaryType = preferredType;

    if (primaryType === undefined) {
      const isGroup = await this.isGroupThread(threadId);
      primaryType = isGroup ? ThreadType.Group : ThreadType.User;
    }

    const secondaryType =
      primaryType === ThreadType.User ? ThreadType.Group : ThreadType.User;

    const sourceList = Array.isArray(sources) ? sources : [sources];

    try {
      return await this.api.sendMessage(
        {
          msg: caption,
          attachments: sourceList,
        },
        threadId,
        primaryType
      );
    } catch (err) {
      console.warn(
        `⚠️ [SendAttachmentAuto] Gửi ảnh với ThreadType=${primaryType} thất bại tới [${threadId}], đang tự động fallback sang ThreadType=${secondaryType}:`,
        err
      );
      return await this.api.sendMessage(
        {
          msg: caption,
          attachments: sourceList,
        },
        threadId,
        secondaryType
      );
    }
  }

  /**
   * Trả lời (Reply/Quote) một tin nhắn cụ thể
   * - Tự động chia nhỏ nếu replyText vượt quá 1500 ký tự.
   * - Đối với Nhóm (Group): Gửi kèm trích dẫn (quote), có fallback tự động nếu Zalo từ chối quote.
   * - Đối với Cá nhân (User 1-1): Gửi trực tiếp tin nhắn thường (do Zalo Web API không hỗ trợ /api/message/quote).
   */
  public async replyMessage(
    message: Message,
    replyText: string
  ): Promise<SendMessageResponse> {
    const chunks = splitTextIntoChunks(replyText, 1500);
    const firstChunk = chunks[0];
    const isGroup = message.type === ThreadType.Group;
    let firstResponse: SendMessageResponse;

    if (isGroup) {
      try {
        const quote: SendMessageQuote = {
          content: message.data.content,
          msgType: message.data.msgType,
          propertyExt: message.data.propertyExt,
          uidFrom: message.data.uidFrom,
          msgId: message.data.msgId,
          cliMsgId: message.data.cliMsgId,
          ts: message.data.ts,
          ttl: message.data.ttl,
        };

        const messageContent: MessageContent = {
          msg: firstChunk,
          quote,
        };

        firstResponse = await this.api.sendMessage(
          messageContent,
          message.threadId,
          ThreadType.Group
        );
      } catch (quoteError) {
        console.warn(
          `⚠️ Quote tin nhắn nhóm ${message.data.msgId} thất bại, fallback sang gửi tin nhắn thường:`,
          quoteError
        );
        firstResponse = await this.api.sendMessage(
          firstChunk,
          message.threadId,
          ThreadType.Group
        );
      }
    } else {
      // Tin nhắn cá nhân 1-1 (ThreadType.User): gửi trực tiếp tin nhắn thường
      try {
        firstResponse = await this.api.sendMessage(
          firstChunk,
          message.threadId,
          ThreadType.User
        );
      } catch (error) {
        console.error(
          `❌ Lỗi khi gửi tin nhắn phản hồi tới ${message.threadId}:`,
          error
        );
        throw error;
      }
    }

    // Nếu có các đoạn tiếp theo, gửi lần lượt nối tiếp
    for (let i = 1; i < chunks.length; i++) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await this.sendMessage(message.threadId, chunks[i], message.type);
    }

    return firstResponse;
  }

  /**
   * Thả cảm xúc vào tin nhắn (Like, Love, Haha, Wow, Sad, Angry)
   */
  public async sendReaction(
    message: Message,
    reaction: Reactions = Reactions.HEART
  ): Promise<void> {
    try {
      await this.api.addReaction(reaction, {
        threadId: message.threadId,
        type: message.type,
        data: {
          msgId: message.data.msgId,
          cliMsgId: message.data.cliMsgId,
        },
      });
    } catch (error) {
      console.error("❌ Lỗi khi thả cảm xúc vào tin nhắn:", error);
    }
  }

  /**
   * Lấy thông tin người dùng theo User ID
   */
  public async getUserInfo(userId: string) {
    try {
      return await this.api.getUserInfo(userId);
    } catch (error) {
      console.error(`❌ Lỗi khi lấy thông tin user ${userId}:`, error);
      return null;
    }
  }

  /**
   * Lấy thông tin nhóm chat theo Group ID
   */
  public async getGroupInfo(groupId: string) {
    try {
      return await this.api.getGroupInfo(groupId);
    } catch (error) {
      console.error(`❌ Lỗi khi lấy thông tin nhóm ${groupId}:`, error);
      return null;
    }
  }

  /**
   * Lấy tên nhóm chat (có kèm in-memory cache và database metadata)
   */
  public async getGroupName(groupId: string): Promise<string> {
    const threadMetaRepo = new (await import("../database/repositories/threadMetadataRepository.js")).ThreadMetadataRepository();
    const meta = threadMetaRepo.getMetadata(groupId);
    if (meta?.customName) {
      this.groupNameCache.set(groupId, meta.customName);
      return meta.customName;
    }

    const cached = this.groupNameCache.get(groupId);
    if (cached) return cached;

    try {
      const info = await this.api.getGroupInfo(groupId);
      let name = info?.gridInfoMap?.[groupId]?.name;
      if (name) {
        if (meta?.isManual && !/^-M(\s|_|-|$)/i.test(name)) {
          name = `-M ${name}`;
        }
        this.groupNameCache.set(groupId, name);
        return name;
      }
    } catch (error) {
      console.warn(`⚠️ Không thể lấy tên nhóm [${groupId}]:`, error);
    }

    if (meta?.isManual) {
      return `-M Nhóm ${groupId}`;
    }
    return groupId;
  }

  /**
   * Lấy tên hiển thị của người dùng (Zalo cá nhân 1-1 kèm in-memory cache và database metadata)
   */
  public async getUserName(userId: string): Promise<string> {
    const threadMetaRepo = new (await import("../database/repositories/threadMetadataRepository.js")).ThreadMetadataRepository();
    const meta = threadMetaRepo.getMetadata(userId);
    if (meta?.customName) {
      this.groupNameCache.set(`user_${userId}`, meta.customName);
      return meta.customName;
    }

    const cacheKey = `user_${userId}`;
    const cached = this.groupNameCache.get(cacheKey);
    if (cached) return cached;

    try {
      const info: any = await this.api.getUserInfo(userId);
      const profile =
        info?.changed_profiles?.[userId] ||
        info?.unchanged_profiles?.[userId] ||
        info?.[userId];
      let name = profile?.displayName || profile?.zaloName || profile?.username;
      if (name) {
        if (meta?.isManual && !/^-M(\s|_|-|$)/i.test(name)) {
          name = `-M ${name}`;
        }
        this.groupNameCache.set(cacheKey, name);
        return name;
      }
    } catch (error) {
      console.warn(`⚠️ Không thể lấy tên user [${userId}]:`, error);
    }

    if (meta?.isManual) {
      return `-M Khách ${userId}`;
    }
    return "";
  }

  /**
   * Chuyển tiếp (Forward) tin nhắn sang các threadId khác
   */
  public async forwardMessage(
    payload: ForwardMessagePayload,
    threadIds: string[],
    type: ThreadType = ThreadType.User
  ): Promise<ForwardMessageResponse | null> {
    try {
      return await this.api.forwardMessage(payload, threadIds, type);
    } catch (error) {
      console.error(`❌ Lỗi khi forward tin nhắn tới ${threadIds.join(", ")}:`, error);
      return null;
    }
  }

  /**
   * Chấp nhận lời mời kết bạn từ một User ID
   */
  public async acceptFriendRequest(userId: string): Promise<boolean> {
    try {
      await this.api.acceptFriendRequest(userId);
      return true;
    } catch (error) {
      console.error(`❌ Lỗi khi chấp nhận lời mời kết bạn từ ${userId}:`, error);
      return false;
    }
  }

  /**
   * Đổi tên hiển thị / Đặt tên gợi nhớ (Alias) cho bạn bè hoặc đổi tên Nhóm
   */
  public async changeThreadName(
    threadId: string,
    newName: string,
    isGroup?: boolean
  ): Promise<{ success: boolean; error?: string }> {
    const trimmedName = newName.trim();
    if (!trimmedName) {
      return { success: false, error: "Tên mới không được để trống" };
    }

    const checkGroup =
      isGroup !== undefined ? isGroup : await this.isGroupThread(threadId);

    const isManual = /^-M(\s|_|-|$)/i.test(trimmedName);

    // 1. Lưu bền vững vào SQLite database trước tiên
    try {
      const { ThreadMetadataRepository } = await import("../database/repositories/threadMetadataRepository.js");
      const threadMetaRepo = new ThreadMetadataRepository();
      threadMetaRepo.upsertMetadata(threadId, trimmedName, isManual, checkGroup);
    } catch (dbErr) {
      console.warn(`⚠️ Không thể lưu metadata cho thread ${threadId}:`, dbErr);
    }

    try {
      if (checkGroup) {
        await this.api.changeGroupName(trimmedName, threadId);
        this.groupNameCache.set(threadId, trimmedName);
        console.log(`✅ [Zalo API] Đã đổi tên nhóm [${threadId}] thành: "${trimmedName}"`);
      } else {
        await this.api.changeFriendAlias(trimmedName, threadId);
        this.groupNameCache.set(`user_${threadId}`, trimmedName);
        console.log(`✅ [Zalo API] Đã đặt tên gợi nhớ cho bạn bè [${threadId}] thành: "${trimmedName}"`);
      }
      return { success: true };
    } catch (err: any) {
      console.error(`❌ Lỗi khi đổi tên cho thread ${threadId}:`, err);
      // Dù Zalo API có lỗi (ví dụ chưa là bạn bè nên không đặt alias được), ta vẫn lưu thành công trong bot DB
      return { success: false, error: err?.message || String(err) };
    }
  }
}

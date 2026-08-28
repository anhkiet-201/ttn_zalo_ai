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
   */
  public async sendMessage(
    threadId: string,
    content: string | MessageContent,
    type: ThreadType = ThreadType.User
  ): Promise<SendMessageResponse> {
    try {
      return await this.api.sendMessage(content, threadId, type);
    } catch (error) {
      console.error(`❌ Lỗi khi gửi tin nhắn tới ${threadId}:`, error);
      throw error;
    }
  }

  /**
   * Trả lời (Reply/Quote) một tin nhắn cụ thể
   * - Đối với Nhóm (Group): Gửi kèm trích dẫn (quote), có fallback tự động nếu Zalo từ chối quote.
   * - Đối với Cá nhân (User 1-1): Gửi trực tiếp tin nhắn thường (do Zalo Web API không hỗ trợ /api/message/quote).
   */
  public async replyMessage(
    message: Message,
    replyText: string
  ): Promise<SendMessageResponse> {
    const isGroup = message.type === ThreadType.Group;

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
          msg: replyText,
          quote,
        };

        return await this.api.sendMessage(
          messageContent,
          message.threadId,
          ThreadType.Group
        );
      } catch (quoteError) {
        console.warn(
          `⚠️ Quote tin nhắn nhóm ${message.data.msgId} thất bại, fallback sang gửi tin nhắn thường:`,
          quoteError
        );
        return await this.api.sendMessage(
          replyText,
          message.threadId,
          ThreadType.Group
        );
      }
    }

    // Tin nhắn cá nhân 1-1 (ThreadType.User): gửi trực tiếp tin nhắn thường
    try {
      return await this.api.sendMessage(
        replyText,
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
   * Lấy tên nhóm chat (có kèm in-memory cache để tối ưu hiệu năng)
   */
  public async getGroupName(groupId: string): Promise<string> {
    const cached = this.groupNameCache.get(groupId);
    if (cached) return cached;

    try {
      const info = await this.api.getGroupInfo(groupId);
      const name = info?.gridInfoMap?.[groupId]?.name;
      if (name) {
        this.groupNameCache.set(groupId, name);
        return name;
      }
    } catch (error) {
      console.warn(`⚠️ Không thể lấy tên nhóm [${groupId}]:`, error);
    }

    return groupId;
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
}

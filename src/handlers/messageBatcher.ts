import { type ParsedMessage, type MediaType, type MediaItem, ThreadType } from "../types/zalo.types.js";
import { config } from "../config/index.js";

export interface QueuedMessage {
  text: string;
  mediaType?: MediaType;
  mediaUrls?: MediaItem[];
  hasQuote?: boolean;
  quoteText?: string;
  quoteSenderName?: string;
  quoteSenderId?: string;
  quoteMsgId?: string;
  quoteData?: ParsedMessage["quoteData"];
  timestamp: number;
  rawMessage?: ParsedMessage["raw"];
}

export interface MessageBatch {
  threadId: string;
  threadType: ThreadType;
  senderName: string;
  senderId: string;
  messages: QueuedMessage[];
  timer: NodeJS.Timeout | null;
}

export type BatchProcessor = (batch: MessageBatch) => Promise<void>;

/**
 * MessageBatcher: Quản lý hàng đợi gom tin nhắn và cơ chế Debounce ngẫu nhiên
 * Giúp Bot phản hồi tự nhiên, tránh spam tin nhắn liên tục khi người dùng gửi nhiều tin nhắn ngắn.
 */
export class MessageBatcher {
  private messageBatches: Map<string, MessageBatch> = new Map();
  private readonly minDebounceSeconds: number;
  private readonly maxDebounceSeconds: number;

  constructor(
    private readonly processor: BatchProcessor,
    minDebounceSeconds: number = config.minDebounceSeconds,
    maxDebounceSeconds: number = config.maxDebounceSeconds
  ) {
    this.minDebounceSeconds = minDebounceSeconds;
    this.maxDebounceSeconds = maxDebounceSeconds;
  }

  /**
   * Sinh thời gian debounce ngẫu nhiên từ 10 đến 30 giây
   */
  private getRandomDebounceMs(): number {
    const seconds =
      Math.floor(
        Math.random() *
          (this.maxDebounceSeconds - this.minDebounceSeconds + 1)
      ) + this.minDebounceSeconds;
    return seconds * 1000;
  }

  /**
   * Đưa tin nhắn vào hàng đợi gom batch theo từng threadId
   */
  public enqueue(parsedMessage: ParsedMessage, threadType: ThreadType): void {
    const threadId = parsedMessage.threadId;

    let batch = this.messageBatches.get(threadId);

    if (!batch) {
      batch = {
        threadId,
        threadType,
        senderName: parsedMessage.senderName,
        senderId: parsedMessage.senderId,
        messages: [],
        timer: null,
      };
      this.messageBatches.set(threadId, batch);
    }

    if (parsedMessage.senderName) {
      batch.senderName = parsedMessage.senderName;
      batch.senderId = parsedMessage.senderId;
    }

    batch.messages.push({
      text: parsedMessage.text,
      mediaType: parsedMessage.mediaType,
      mediaUrls: parsedMessage.mediaUrls,
      hasQuote: parsedMessage.hasQuote,
      quoteText: parsedMessage.quoteText,
      quoteSenderName: parsedMessage.quoteSenderName,
      quoteSenderId: parsedMessage.quoteSenderId,
      quoteMsgId: parsedMessage.quoteData?.msgId,
      quoteData: parsedMessage.quoteData,
      timestamp: parsedMessage.timestamp,
      rawMessage: parsedMessage.raw,
    });

    if (batch.timer) {
      clearTimeout(batch.timer);
    }

    const debounceMs = this.getRandomDebounceMs();

    batch.timer = setTimeout(async () => {
      const capturedBatch = this.messageBatches.get(threadId);
      if (capturedBatch && capturedBatch.messages.length > 0) {
        if (this.messageBatches.get(threadId) === capturedBatch) {
          this.messageBatches.delete(threadId);
        }

        try {
          await this.processor(capturedBatch);
        } catch (error) {
          console.error(
            `❌ [MessageBatcher] Lỗi khi xử lý batch tin nhắn cho luồng [${threadId}]:`,
            error
          );
        }
      }
    }, debounceMs);
  }

  /**
   * Hủy toàn bộ hàng đợi gom tin nhắn đang chờ (Graceful Cleanup)
   */
  public destroy(): void {
    for (const batch of this.messageBatches.values()) {
      if (batch.timer) {
        clearTimeout(batch.timer);
      }
    }
    this.messageBatches.clear();
  }
}

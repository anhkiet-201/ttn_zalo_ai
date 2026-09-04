import { type ParsedMessage, type MediaType, type MediaItem, ThreadType } from "../types/zalo.types.js";
import { config } from "../config/index.js";

export interface QueuedMessage {
  id?: string;
  text: string;
  mediaType?: MediaType;
  mediaUrls?: MediaItem[];
  hasQuote?: boolean;
  quoteText?: string;
  quoteSenderName?: string;
  quoteSenderId?: string;
  quoteMsgId?: string;
  quoteMsgType?: string;
  quoteTimestamp?: number;
  quotedMediaUrls?: MediaItem[];
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
  typingDelayTimer?: NodeJS.Timeout | null;
  typingInterval?: NodeJS.Timeout | null;
}

export type BatchProcessor = (batch: MessageBatch) => Promise<void>;
export type TypingHandler = (threadId: string, threadType: ThreadType) => Promise<void> | void;

/**
 * MessageBatcher: Quản lý hàng đợi gom tin nhắn và cơ chế Debounce ngẫu nhiên
 * Giúp Bot phản hồi tự nhiên, tránh spam tin nhắn liên tục khi người dùng gửi nhiều tin nhắn ngắn.
 */
export class MessageBatcher {
  private messageBatches: Map<string, MessageBatch> = new Map();
  private readonly minDebounceSeconds: number;
  private readonly maxDebounceSeconds: number;
  private readonly typingHandler?: TypingHandler;
  private readonly typingIntervalSeconds: number;
  private readonly minTypingDelaySeconds: number;
  private readonly maxTypingDelaySeconds: number;

  constructor(
    private readonly processor: BatchProcessor,
    minDebounceSeconds: number = config.minDebounceSeconds,
    maxDebounceSeconds: number = config.maxDebounceSeconds,
    typingHandler?: TypingHandler,
    typingIntervalSeconds: number = config.typingIntervalSeconds,
    minTypingDelaySeconds: number = config.minTypingDelaySeconds,
    maxTypingDelaySeconds: number = config.maxTypingDelaySeconds
  ) {
    this.minDebounceSeconds = minDebounceSeconds;
    this.maxDebounceSeconds = maxDebounceSeconds;
    this.typingHandler = typingHandler;
    this.typingIntervalSeconds = typingIntervalSeconds;
    this.minTypingDelaySeconds = minTypingDelaySeconds;
    this.maxTypingDelaySeconds = maxTypingDelaySeconds;
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
   * Sinh thời gian delay ngẫu nhiên trước khi bắt đầu gõ phím (mô phỏng người thật đọc tin)
   */
  private getRandomTypingDelayMs(maxCapMs?: number): number {
    const min = Math.max(0, this.minTypingDelaySeconds);
    const max = Math.max(min, this.maxTypingDelaySeconds);
    let ms = Math.floor((Math.random() * (max - min) + min) * 1000);
    if (maxCapMs !== undefined && maxCapMs > 0 && ms >= maxCapMs) {
      ms = Math.floor(maxCapMs * 0.5);
    }
    return ms;
  }

  /**
   * Dọn dẹp toàn bộ timer delay và interval typing của một batch
   */
  public clearBatchTyping(batch: MessageBatch): void {
    if (batch.typingDelayTimer) {
      clearTimeout(batch.typingDelayTimer);
      batch.typingDelayTimer = null;
    }
    if (batch.typingInterval) {
      clearInterval(batch.typingInterval);
      batch.typingInterval = null;
    }
  }

  /**
   * Dừng typing indicator cho một threadId cụ thể hoặc theo batch
   */
  public stopTyping(target: string | MessageBatch): void {
    if (typeof target === "string") {
      const batch = this.messageBatches.get(target);
      if (batch) {
        this.clearBatchTyping(batch);
      }
    } else if (target) {
      this.clearBatchTyping(target);
    }
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
        typingDelayTimer: null,
        typingInterval: null,
      };
      this.messageBatches.set(threadId, batch);
    }

    if (parsedMessage.senderName) {
      batch.senderName = parsedMessage.senderName;
      batch.senderId = parsedMessage.senderId;
    }

    batch.messages.push({
      id: parsedMessage.id,
      text: parsedMessage.text,
      mediaType: parsedMessage.mediaType,
      mediaUrls: parsedMessage.mediaUrls,
      hasQuote: parsedMessage.hasQuote,
      quoteText: parsedMessage.quoteText,
      quoteSenderName: parsedMessage.quoteSenderName,
      quoteSenderId: parsedMessage.quoteSenderId,
      quoteMsgId: parsedMessage.quoteData?.msgId || parsedMessage.id,
      quoteMsgType: parsedMessage.quoteMsgType || parsedMessage.quoteData?.msgType,
      quoteTimestamp: parsedMessage.quoteTimestamp || parsedMessage.quoteData?.timestamp,
      quotedMediaUrls: parsedMessage.quotedMediaUrls || parsedMessage.quoteData?.quotedMediaUrls,
      quoteData: parsedMessage.quoteData,
      timestamp: parsedMessage.timestamp,
      rawMessage: parsedMessage.raw,
    });

    if (batch.timer) {
      clearTimeout(batch.timer);
    }

    const debounceMs = this.getRandomDebounceMs();

    // Khởi tạo cơ chế gõ phím (typing indicator) nếu có typingHandler
    if (this.typingHandler) {
      if (!batch.typingDelayTimer && !batch.typingInterval) {
        const delayMs = this.getRandomTypingDelayMs(debounceMs);
        const currentBatch = batch;
        currentBatch.typingDelayTimer = setTimeout(async () => {
          currentBatch.typingDelayTimer = null;
          // Gửi typing lần đầu tiên sau delay ngẫu nhiên
          try {
            await this.typingHandler!(threadId, threadType);
          } catch (err) {
            console.warn(`⚠️ [MessageBatcher] Lỗi khi gửi typing cho [${threadId}]:`, err);
          }
          // Tiếp tục duy trì typing định kỳ mỗi X giây cho đến khi xử lý xong phản hồi
          if (!currentBatch.typingInterval) {
            currentBatch.typingInterval = setInterval(async () => {
              try {
                await this.typingHandler!(threadId, threadType);
              } catch (err) {
                console.warn(`⚠️ [MessageBatcher] Lỗi khi gửi typing định kỳ cho [${threadId}]:`, err);
              }
            }, this.typingIntervalSeconds * 1000);
          }
        }, delayMs);
      }
    }

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
        } finally {
          this.clearBatchTyping(capturedBatch);
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
      this.clearBatchTyping(batch);
    }
    this.messageBatches.clear();
  }
}

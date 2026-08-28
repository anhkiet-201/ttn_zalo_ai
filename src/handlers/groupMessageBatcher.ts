import { type ParsedMessage } from "../types/zalo.types.js";

export interface GroupQueuedMessage {
  text: string;
  senderName: string;
  senderId: string;
  timestamp: number;
  rawMessage?: ParsedMessage["raw"];
}

export interface GroupMessageBatch {
  threadId: string;
  groupName: string;
  messages: GroupQueuedMessage[];
  timer: NodeJS.Timeout | null;
}

export type GroupBatchProcessor = (batch: GroupMessageBatch) => Promise<void>;

/**
 * GroupMessageBatcher: Gom tin nhắn nhóm với debounce CỐ ĐỊNH (không random như MessageBatcher).
 * Mỗi nhóm chat (threadId) có một hàng đợi độc lập.
 * Sau khi hết debounce mà không có tin nhắn mới → fire GroupBatchProcessor để phân tích RAG.
 */
export class GroupMessageBatcher {
  private batches: Map<string, GroupMessageBatch> = new Map();
  private readonly debounceMs: number;

  constructor(
    private readonly processor: GroupBatchProcessor,
    debounceSeconds: number = 30
  ) {
    this.debounceMs = debounceSeconds * 1000;
  }

  /**
   * Đưa tin nhắn vào hàng đợi của nhóm tương ứng
   */
  public enqueue(parsedMessage: ParsedMessage, groupName?: string): void {
    const threadId = parsedMessage.threadId;

    let batch = this.batches.get(threadId);

    if (!batch) {
      batch = {
        threadId,
        groupName: groupName || parsedMessage.threadId,
        messages: [],
        timer: null,
      };
      this.batches.set(threadId, batch);
    } else if (groupName && (batch.groupName === threadId || !batch.groupName)) {
      batch.groupName = groupName;
    }

    batch.messages.push({
      text: parsedMessage.text,
      senderName: parsedMessage.senderName,
      senderId: parsedMessage.senderId,
      timestamp: parsedMessage.timestamp,
      rawMessage: parsedMessage.raw,
    });

    // Reset debounce timer mỗi khi có tin nhắn mới
    if (batch.timer) {
      clearTimeout(batch.timer);
    }

    const waitSec = Math.round(this.debounceMs / 1000);
    console.log(
      `⏳ [Nhóm-Batch ${waitSec}s] Gom ${batch.messages.length} tin nhắn từ nhóm [${threadId}]. Chờ tin nhắn tiếp theo...`
    );

    batch.timer = setTimeout(async () => {
      const currentBatch = this.batches.get(threadId);
      if (currentBatch && currentBatch.messages.length > 0) {
        this.batches.delete(threadId);
        await this.processor(currentBatch);
      } else {
        this.batches.delete(threadId);
      }
    }, this.debounceMs);
  }

  /**
   * Hủy tất cả timer khi dừng ứng dụng
   */
  public clearAll(): void {
    for (const batch of this.batches.values()) {
      if (batch.timer) {
        clearTimeout(batch.timer);
      }
    }
    this.batches.clear();
  }
}

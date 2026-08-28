import {
  type API,
  type Message,
  type UserMessage,
  type GroupMessage,
  type GroupEvent,
  type FriendEvent,
  type Reaction,
  Reactions,
  type Undo,
  type Typing,
  ThreadType,
  type SendMessageResponse,
  type MessageContent,
  type Credentials,
} from "zca-js";

export {
  type API,
  type Message,
  type UserMessage,
  type GroupMessage,
  type GroupEvent,
  type FriendEvent,
  type Reaction,
  Reactions,
  type Undo,
  type Typing,
  ThreadType,
  type SendMessageResponse,
  type MessageContent,
  type Credentials,
};

/**
 * Cấu hình hệ thống Bot Zalo
 */
export interface BotConfig {
  selfListen: boolean;
  checkUpdate: boolean;
  botPrefix: string;
  sessionFilePath: string;
  userAgent: string;
  qrPort: number;
  credentials?: Credentials;
  geminiApiKey?: string;
  geminiModel: string;
  geminiSystemInstruction: string;
  messageDebounceSeconds: number;
  minDebounceSeconds: number;
  maxDebounceSeconds: number;
  groupDebounceSeconds: number;
  groupIgnoreKeywords: string[];
  hrRecipientId: string;
  chatHistoryLimit: number;
  erpBaseUrl: string;
  erpApiKey: string;
}

/**
 * Dữ liệu tin nhắn đã được chuẩn hoá để các handler dễ xử lý
 */
export interface ParsedMessage {
  raw: Message;
  threadId: string;
  senderId: string;
  senderName: string;
  isGroup: boolean;
  isSelf: boolean;
  text: string;
  timestamp: number;
  hasQuote: boolean;
  quoteText?: string;
  command?: string;
  args: string[];
  hasImage?: boolean;
  imageUrls?: string[];
}

/**
 * Context gửi kèm cho các Command Handler
 */
export interface CommandContext {
  parsedMessage: ParsedMessage;
  reply: (text: string) => Promise<SendMessageResponse>;
  api: API;
}

/**
 * Định nghĩa một Command cho Bot
 */
export interface BotCommand {
  name: string;
  aliases?: string[];
  description: string;
  usage?: string;
  execute: (ctx: CommandContext) => Promise<void> | void;
}

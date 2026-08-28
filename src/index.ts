import { authenticateZalo } from "./auth/sessionManager.js";
import { ZaloService } from "./services/zaloService.js";
import { AIService } from "./services/aiService.js";
import { EventDispatcher } from "./listener/eventDispatcher.js";
import { MessageListener } from "./listener/messageListener.js";
import { MessageHandler } from "./handlers/messageHandler.js";
import { GroupHandler } from "./handlers/groupHandler.js";
import { ReactionHandler } from "./handlers/reactionHandler.js";
import { FriendHandler } from "./handlers/friendHandler.js";
import { config } from "./config/index.js";

/**
 * Hàm khởi động chính của ứng dụng Zalo AI Bot
 */
async function main() {
  console.log("==================================================");
  console.log("🚀 KHỞI ĐỘNG ZALO BOT - AI GEMINI AUTO-REPLY SYSTEM");
  console.log("📦 Dựa trên thư viện: zca-js v2.x & @google/genai");
  console.log(`🤖 Model AI: ${config.geminiModel}`);
  console.log("==================================================");

  try {
    // 1. Xác thực và đăng nhập Zalo (Session / QR)
    const api = await authenticateZalo();

    // 2. Khởi tạo các Service và Dispatcher
    const zaloService = new ZaloService(api);
    const aiService = new AIService();
    const dispatcher = new EventDispatcher();

    // 3. Khởi tạo các bộ xử lý (Handlers)
    const messageHandler = new MessageHandler(zaloService, aiService);
    const groupHandler = new GroupHandler(zaloService);
    const reactionHandler = new ReactionHandler(zaloService);
    const friendHandler = new FriendHandler(zaloService);

    // 4. Đăng ký các sự kiện vào Dispatcher
    dispatcher.onMessage(async (msg) => {
      await messageHandler.handle(msg);
    });

    dispatcher.onGroupEvent(async (event) => {
      await groupHandler.handle(event);
    });

    dispatcher.onReaction(async (reaction) => {
      await reactionHandler.handle(reaction);
    });

    dispatcher.onFriendEvent(async (event) => {
      await friendHandler.handle(event);
    });

    dispatcher.onUndo((undo) => {
      console.log(
        `\n🗑️ [THU HỒI TIN NHẮN] Tin nhắn ID: ${undo.data.msgId} tại luồng [${undo.threadId}] đã bị thu hồi.`
      );
    });

    // 5. Khởi tạo và kích hoạt Message Listener
    const messageListener = new MessageListener(api, dispatcher);
    messageListener.start();

    // 6. Xử lý tắt ứng dụng một cách an toàn (Graceful Shutdown)
    const handleShutdown = (signal: string) => {
      console.log(`\n🛑 Nhận tín hiệu ${signal}. Đang tiến hành dừng Bot...`);
      messageListener.stop();
      process.exit(0);
    };

    process.on("SIGINT", () => handleShutdown("SIGINT"));
    process.on("SIGTERM", () => handleShutdown("SIGTERM"));
  } catch (error) {
    console.error("❌ Lỗi nghiêm trọng khi khởi động Zalo Bot:", error);
    process.exit(1);
  }
}

// Bắt đầu chạy
main();

import { authenticateZalo, onLogout, setZaloService, updateConnectionInfo } from "./auth/sessionManager.js";
import { stopQrWebServer } from "./auth/qrWebServer.js";
import { SQLiteDatabase } from "./database/sqliteDb.js";
import { RAGService } from "./services/ragService.js";
import { ZaloService } from "./services/zaloService.js";
import { AIService } from "./services/aiService.js";
import { EventDispatcher } from "./listener/eventDispatcher.js";
import { MessageListener } from "./listener/messageListener.js";
import { MessageHandler } from "./handlers/messageHandler.js";
import { GroupHandler } from "./handlers/groupHandler.js";
import { ReactionHandler } from "./handlers/reactionHandler.js";
import { FriendHandler } from "./handlers/friendHandler.js";
import { RenameHandler } from "./handlers/renameHandler.js";
import { config } from "./config/index.js";

let currentListener: MessageListener | null = null;

/**
 * Hàm khởi động và quản lý vòng đời của Zalo Bot
 */
async function startBot() {
  try {
    // 1. Xác thực và đăng nhập Zalo (Session / QR)
    const api = await authenticateZalo();

    // 2. Khởi tạo các Service và Dispatcher
    const zaloService = new ZaloService(api);
    setZaloService(zaloService);
    const aiService = new AIService(undefined, undefined, zaloService);
    const dispatcher = new EventDispatcher();
    dispatcher.setOwnId(api.getOwnId());

    // 3. Khởi tạo các bộ xử lý (Handlers)
    const messageHandler = new MessageHandler(zaloService, aiService);
    const groupHandler = new GroupHandler(zaloService);
    const reactionHandler = new ReactionHandler(zaloService);
    const friendHandler = new FriendHandler(zaloService);
    const renameHandler = new RenameHandler(zaloService);

    // Kết nối bộ phát hiện đổi tên Nhóm vào Dispatcher
    groupHandler.setOnRename(async (event) => {
      await dispatcher.dispatchUserRename(event);
    });

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

    dispatcher.onUserRename(async (event) => {
      await renameHandler.handle(event);
    });

    dispatcher.onUndo((undo) => {
      console.log(
        `\n🗑️ [THU HỒI TIN NHẮN] Tin nhắn ID: ${undo.data.msgId} tại luồng [${undo.threadId}] đã bị thu hồi.`
      );
    });

    // 5. Khởi tạo và kích hoạt Message Listener với cơ chế Tự Phục Hồi (Self-Healing)
    currentListener = new MessageListener(api, dispatcher);

    // Đồng bộ trạng thái kết nối lên Web Portal Dashboard thời gian thực
    currentListener.onStateChange((connInfo) => {
      updateConnectionInfo(connInfo);
    });

    // Kích hoạt đồng bộ alias khi nhận được socket control từ app Zalo điện thoại
    currentListener.onSyncAlias(async () => {
      await zaloService.syncAliases(true);
    });

    // Tự động phục hồi khi phiên/cookie hết hạn (bị logout từ app điện thoại)
    currentListener.onSessionExpired(async () => {
      console.warn(
        "\n🔄 [Index] Phát hiện phiên hết hạn/bị đăng xuất. Đang dừng Listener và khởi tạo phiên đăng nhập mới..."
      );
      if (currentListener) {
        currentListener.stop();
        currentListener = null;
      }
      await startBot();
    });

    currentListener.start();
  } catch (error) {
    console.error("❌ Lỗi khi khởi động Zalo Bot:", error);
  }
}

/**
 * Đăng ký callback khi người dùng bấm Đăng xuất từ Web Portal
 */
onLogout(async () => {
  if (currentListener) {
    console.log("🛑 Đang dừng Message Listener cũ...");
    currentListener.stop();
    currentListener = null;
  }
  console.log("🔄 Đang khởi tạo lại phiên đăng nhập Zalo mới...");
  await startBot();
});

// Xử lý tắt ứng dụng một cách an toàn (Graceful Shutdown)
const handleShutdown = async (signal: string) => {
  console.log(`\n🛑 Nhận tín hiệu ${signal}. Đang tiến hành dừng Bot...`);
  if (currentListener) {
    try {
      currentListener.stop();
    } catch {}
    currentListener = null;
  }
  try {
    RAGService.getInstance().destroy();
  } catch {}
  try {
    stopQrWebServer();
  } catch {}
  try {
    SQLiteDatabase.getInstance().close();
  } catch {}
  process.exit(0);
};

process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("SIGTERM", () => handleShutdown("SIGTERM"));

// Bắt đầu chạy
console.log("==================================================");
console.log("🚀 KHỞI ĐỘNG ZALO BOT - AI GEMINI AUTO-REPLY SYSTEM");
console.log("📦 Dựa trên thư viện: zca-js v2.x & @google/genai");
console.log(`🤖 Model AI: ${config.geminiModel}`);
console.log("==================================================");

startBot();


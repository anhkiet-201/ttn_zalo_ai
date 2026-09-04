import { EventDispatcher } from "../listener/eventDispatcher.js";
import { MessageHandler } from "../handlers/messageHandler.js";
import { GroupHandler } from "../handlers/groupHandler.js";
import { RenameHandler } from "../handlers/renameHandler.js";
import { ZaloService } from "../services/zaloService.js";
import { AIService } from "../services/aiService.js";
import {
  ThreadMetadataRepository,
  CandidateRepository,
  SQLiteDatabase,
} from "../database/index.js";
import { UserContextManager } from "../services/userContextManager.js";
import { chatBroadcaster } from "../server/chatBroadcaster.js";
import { type ParsedMessage, ThreadType } from "../types/zalo.types.js";
import { GroupEventType } from "zca-js";

async function runTest() {
  console.log("==================================================================");
  console.log("🧪 BẮT ĐẦU KIỂM THỬ TỰ ĐỘNG: PHÁT HIỆN ĐỔI TÊN & ĐỒNG BỘ DATABASE");
  console.log("==================================================================\n");

  const db = SQLiteDatabase.getInstance();
  const threadMetaRepo = new ThreadMetadataRepository(db);
  const candidateRepo = new CandidateRepository(db);
  const userCtxManager = UserContextManager.getInstance();

  const testThreadId = `test_rename_user_${Date.now()}`;
  const testSenderId = `sender_${Date.now()}`;
  const testGroupId = `test_rename_group_${Date.now()}`;

  // Mock API và Services
  const mockApi = {
    getOwnId: () => "bot_own_id_9999",
    listener: { on: () => {} },
    sendMessage: async () => ({ message: "ok" }),
    getUserInfo: async () => null,
    getGroupInfo: async () => null,
    changeFriendAlias: async () => {},
    changeGroupName: async () => {},
  } as any;

  const zaloService = new ZaloService(mockApi);
  const aiService = new AIService(undefined, undefined, zaloService);
  const dispatcher = new EventDispatcher();
  dispatcher.setOwnId(mockApi.getOwnId());

  const messageHandler = new MessageHandler(zaloService, aiService);
  const groupHandler = new GroupHandler(zaloService);
  const renameHandler = new RenameHandler(
    zaloService,
    threadMetaRepo,
    candidateRepo,
    userCtxManager
  );

  // Kết nối Dispatcher như trong src/index.ts
  messageHandler.setOnRename(async (event) => {
    await dispatcher.dispatchUserRename(event);
  });
  groupHandler.setOnRename(async (event) => {
    await dispatcher.dispatchUserRename(event);
  });

  let renameEventReceived: any = null;
  dispatcher.onUserRename(async (event) => {
    renameEventReceived = event;
    await renameHandler.handle(event);
  });

  let broadcastReceived: any = null;
  const unsubBroadcast = chatBroadcaster.onThreadRename(testThreadId, (data) => {
    broadcastReceived = data;
  });

  try {
    // --------------------------------------------------------------------------
    // Test Case 1: Lần đầu nhận tin nhắn cá nhân -> Khởi tạo tên ban đầu vào DB
    // --------------------------------------------------------------------------
    console.log("👉 Test 1: Khởi tạo tên ban đầu từ tin nhắn đầu tiên...");
    const msg1: ParsedMessage = {
      id: `msg_1_${Date.now()}`,
      raw: {} as any,
      threadId: testThreadId,
      senderId: testSenderId,
      senderName: "Lê Thị Ngọc Bích",
      isGroup: false,
      isSelf: false,
      text: "Chào bot, em muốn ứng tuyển ạ",
      timestamp: Date.now(),
      args: [],
      hasQuote: false,
    };

    await messageHandler.handle(msg1);

    const meta1 = threadMetaRepo.getMetadata(testThreadId);
    if (!meta1 || meta1.customName !== "Lê Thị Ngọc Bích") {
      throw new Error(`❌ Test 1 thất bại: Tên ban đầu chưa lưu đúng. Thực tế: ${meta1?.customName}`);
    }
    console.log(`✅ Test 1 thành công: Metadata khởi tạo tên: "${meta1.customName}", isManual: ${meta1.isManual}`);

    // Giả lập lưu trước 1 hồ sơ ứng viên và 1 user context để kiểm tra đồng bộ
    candidateRepo.upsertCandidate({
      threadId: testThreadId,
      senderId: testSenderId,
      senderName: "Lê Thị Ngọc Bích",
      targetCompany: "Công ty Cổ phần Chế biến Thực phẩm ABC",
      forwardedTo: "hr_admin",
      imageUrls: [],
    });

    userCtxManager.getContext(testThreadId, testSenderId, "Lê Thị Ngọc Bích");

    // --------------------------------------------------------------------------
    // Test Case 2: Ứng viên đổi tên có gắn tiền tố -M -> Tự động chuyển sang Thủ công
    // --------------------------------------------------------------------------
    console.log("\n👉 Test 2: Đổi tên cá nhân sang '-M Lê Thị Ngọc Bích (Thủ công)'...");
    renameEventReceived = null;
    broadcastReceived = null;

    const msg2: ParsedMessage = {
      id: `msg_2_${Date.now()}`,
      raw: {} as any,
      threadId: testThreadId,
      senderId: testSenderId,
      senderName: "-M Lê Thị Ngọc Bích (Thủ công)",
      isGroup: false,
      isSelf: false,
      text: "Dạ chị ơi",
      timestamp: Date.now(),
      args: [],
      hasQuote: false,
    };

    await messageHandler.handle(msg2);

    if (!renameEventReceived) {
      throw new Error("❌ Test 2 thất bại: Không nhận được sự kiện onUserRename!");
    }
    if (
      renameEventReceived.oldName !== "Lê Thị Ngọc Bích" ||
      renameEventReceived.newName !== "-M Lê Thị Ngọc Bích (Thủ công)"
    ) {
      throw new Error(
        `❌ Test 2 thất bại: Dữ liệu sự kiện không đúng. Old: ${renameEventReceived.oldName}, New: ${renameEventReceived.newName}`
      );
    }

    const meta2 = threadMetaRepo.getMetadata(testThreadId);
    if (!meta2 || meta2.customName !== "-M Lê Thị Ngọc Bích (Thủ công)" || !meta2.isManual) {
      throw new Error(
        `❌ Test 2 thất bại: Database thread_metadata chưa cập nhật hoặc chưa bật isManual. Thực tế: customName=${meta2?.customName}, isManual=${meta2?.isManual}`
      );
    }

    const candidate2 = candidateRepo.getLatestCandidate(testThreadId);
    if (!candidate2 || candidate2.senderName !== "-M Lê Thị Ngọc Bích (Thủ công)") {
      throw new Error(
        `❌ Test 2 thất bại: Bảng candidates chưa cập nhật senderName. Thực tế: ${candidate2?.senderName}`
      );
    }

    const userCtx2 = userCtxManager.getContext(testThreadId, testSenderId);
    if (!userCtx2 || userCtx2.senderName !== "-M Lê Thị Ngọc Bích (Thủ công)") {
      throw new Error(
        `❌ Test 2 thất bại: Bảng user_contexts chưa cập nhật senderName. Thực tế: ${userCtx2?.senderName}`
      );
    }

    if (!broadcastReceived || broadcastReceived.newName !== "-M Lê Thị Ngọc Bích (Thủ công)") {
      throw new Error("❌ Test 2 thất bại: ChatBroadcaster chưa phát sự kiện SSE thread_renamed!");
    }

    console.log("✅ Test 2 thành công: Phát hiện đổi tên, tự động bật -M và cập nhật toàn bộ database!");

    // --------------------------------------------------------------------------
    // Test Case 3: Đổi tên gỡ bỏ tiền tố -M -> Tự động gỡ bỏ chế độ Thủ công
    // --------------------------------------------------------------------------
    console.log("\n👉 Test 3: Đổi tên gỡ bỏ tiền tố -M -> Tự động khôi phục chế độ Tự động (isManual = false)...");
    renameEventReceived = null;

    const msg3: ParsedMessage = {
      id: `msg_3_${Date.now()}`,
      raw: {} as any,
      threadId: testThreadId,
      senderId: testSenderId,
      senderName: "Lê Thị Ngọc Bích",
      isGroup: false,
      isSelf: false,
      text: "Em đã xong việc rồi ạ",
      timestamp: Date.now(),
      args: [],
      hasQuote: false,
    };

    await messageHandler.handle(msg3);

    const meta3 = threadMetaRepo.getMetadata(testThreadId);
    if (!meta3 || meta3.customName !== "Lê Thị Ngọc Bích" || meta3.isManual) {
      throw new Error(
        `❌ Test 3 thất bại: Chưa tự động gỡ cờ isManual khi tên bỏ tiền tố -M. Thực tế: customName=${meta3?.customName}, isManual=${meta3?.isManual}`
      );
    }
    console.log("✅ Test 3 thành công: Đã tự động tắt isManual khi người dùng gỡ tiền tố -M!");

    // --------------------------------------------------------------------------
    // Test Case 4: Sự kiện Đổi tên Nhóm (GroupEventType.UPDATE)
    // --------------------------------------------------------------------------
    console.log("\n👉 Test 4: Bắt sự kiện đổi tên Nhóm qua GroupEventType.UPDATE...");
    renameEventReceived = null;

    const groupEvent: any = {
      type: GroupEventType.UPDATE,
      threadId: testGroupId,
      data: {
        groupName: "Tuyển Dụng KCN Bình Dương 2026",
        creatorId: "admin_123",
      },
    };

    await groupHandler.handle(groupEvent);

    if (!renameEventReceived || !renameEventReceived.isGroup) {
      throw new Error("❌ Test 4 thất bại: Không nhận được sự kiện đổi tên nhóm!");
    }

    const groupMeta = threadMetaRepo.getMetadata(testGroupId);
    if (!groupMeta || groupMeta.customName !== "Tuyển Dụng KCN Bình Dương 2026") {
      throw new Error(
        `❌ Test 4 thất bại: Tên nhóm trong DB chưa cập nhật. Thực tế: ${groupMeta?.customName}`
      );
    }
    console.log("✅ Test 4 thành công: Đã đồng bộ tên mới của Nhóm vào database!");

    console.log("\n==================================================================");
    console.log("🎉 TẤT CẢ 4/4 TEST CASES ĐỀU VƯỢT QUA XUẤT SẮC!");
    console.log("==================================================================");
  } finally {
    unsubBroadcast();
    // Dọn dẹp dữ liệu test trong SQLite
    try {
      db.connection.prepare("DELETE FROM thread_metadata WHERE thread_id IN (?, ?)").run(testThreadId, testGroupId);
      db.connection.prepare("DELETE FROM candidates WHERE thread_id = ?").run(testThreadId);
      db.connection.prepare("DELETE FROM user_contexts WHERE thread_id = ?").run(testThreadId);
      db.connection.prepare("DELETE FROM chat_messages WHERE thread_id IN (?, ?)").run(testThreadId, testGroupId);
    } catch {}
  }
}

runTest().catch((err) => {
  console.error("❌ Test gặp lỗi nghiêm trọng:", err);
  process.exit(1);
});

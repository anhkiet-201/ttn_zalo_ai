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
import { type ParsedMessage } from "../types/zalo.types.js";
import { GroupEventType } from "zca-js";

async function runTest() {
  console.log("==================================================================");
  console.log("🧪 BẮT ĐẦU KIỂM THỬ: ĐỔI TÊN THREAD & SỰ KIỆN ĐỔI TÊN NHÓM");
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

  // Chỉ gắn GroupHandler vào dispatcher (MessageHandler không bắt ứng viên đổi tên)
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
    // Test Case 1: Khởi tạo thông tin người dùng ban đầu trong DB
    // --------------------------------------------------------------------------
    console.log("👉 Test 1: Khởi tạo dữ liệu người dùng & hồ sơ ứng viên...");
    threadMetaRepo.upsertMetadata(testThreadId, "Lê Thị Ngọc Bích", false, false);
    candidateRepo.upsertCandidate({
      threadId: testThreadId,
      senderId: testSenderId,
      senderName: "Lê Thị Ngọc Bích",
      targetCompany: "Công ty Cổ phần Chế biến Thực phẩm ABC",
      forwardedTo: "hr_admin",
      imageUrls: [],
    });
    userCtxManager.getContext(testThreadId, testSenderId, "Lê Thị Ngọc Bích");

    const meta1 = threadMetaRepo.getMetadata(testThreadId);
    if (!meta1 || meta1.customName !== "Lê Thị Ngọc Bích" || meta1.isManual) {
      throw new Error(`❌ Test 1 thất bại: Dữ liệu khởi tạo chưa đúng. Thực tế: ${meta1?.customName}`);
    }
    console.log(`✅ Test 1 thành công: Khởi tạo ban đầu tên: "${meta1.customName}", isManual: ${meta1.isManual}`);

    // --------------------------------------------------------------------------
    // Test Case 2: Đổi tên luồng có tiền tố -M (từ Web Portal hoặc RenameHandler)
    // --------------------------------------------------------------------------
    console.log("\n👉 Test 2: Đổi tên cá nhân sang '-M Lê Thị Ngọc Bích (Thủ công)'...");
    broadcastReceived = null;

    await renameHandler.handle({
      threadId: testThreadId,
      senderId: testThreadId,
      newName: "-M Lê Thị Ngọc Bích (Thủ công)",
      isGroup: false,
      timestamp: Date.now(),
    });

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

    console.log("✅ Test 2 thành công: Đã đổi tên luồng, tự động bật -M và đồng bộ DB & SSE!");

    // --------------------------------------------------------------------------
    // Test Case 3: Đổi tên gỡ bỏ tiền tố -M -> Tự động khôi phục isManual = false
    // --------------------------------------------------------------------------
    console.log("\n👉 Test 3: Đổi tên gỡ tiền tố -M sang 'Ngọc Bích HR'...");
    broadcastReceived = null;

    await renameHandler.handle({
      threadId: testThreadId,
      senderId: testThreadId,
      newName: "Ngọc Bích HR",
      isGroup: false,
      timestamp: Date.now(),
    });

    const meta3 = threadMetaRepo.getMetadata(testThreadId);
    if (!meta3 || meta3.customName !== "Ngọc Bích HR" || meta3.isManual) {
      throw new Error(
        `❌ Test 3 thất bại: Chưa tự động gỡ isManual khi bỏ -M. Thực tế: customName=${meta3?.customName}, isManual=${meta3?.isManual}`
      );
    }

    if (!broadcastReceived || broadcastReceived.newName !== "Ngọc Bích HR") {
      throw new Error("❌ Test 3 thất bại: ChatBroadcaster chưa phát sự kiện SSE thread_renamed!");
    }
    console.log("✅ Test 3 thành công: Đã gỡ cờ isManual khi tên bỏ tiền tố -M!");

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
    console.log("✅ Test 4 thành công: Đã bắt sự kiện đổi tên Nhóm từ WebSocket Zalo và đồng bộ DB!");

    // --------------------------------------------------------------------------
    // Test Case 5: Ứng viên gửi tin nhắn có tên Zalo khác -> KHÔNG ĐỔI TÊN DATABASE
    // --------------------------------------------------------------------------
    console.log("\n👉 Test 5: Ứng viên gửi tin nhắn có tên Zalo khác -> Xác minh KHÔNG tự đổi tên...");
    renameEventReceived = null;

    const msgCandidate: ParsedMessage = {
      id: `msg_candidate_${Date.now()}`,
      raw: {} as any,
      threadId: testThreadId,
      senderId: testSenderId,
      senderName: "Tên Zalo Mới Của Ứng Viên",
      isGroup: false,
      isSelf: false,
      text: "Alo bot ơi",
      timestamp: Date.now(),
      args: [],
      hasQuote: false,
    };

    await messageHandler.handle(msgCandidate);

    if (renameEventReceived) {
      throw new Error("❌ Test 5 thất bại: Đã phát hiện sự kiện đổi tên khi ứng viên gửi tin nhắn!");
    }

    const meta5 = threadMetaRepo.getMetadata(testThreadId);
    if (meta5?.customName !== "Ngọc Bích HR") {
      throw new Error(
        `❌ Test 5 thất bại: Tên người dùng bị thay đổi bởi tin nhắn của ứng viên! Tên hiện tại: ${meta5?.customName}`
      );
    }
    console.log("✅ Test 5 thành công: Tuyệt đối không can thiệp đổi tên khi ứng viên gửi tin nhắn!");

    console.log("\n==================================================================");
    console.log("🎉 TẤT CẢ 5/5 TEST CASES ĐỀU VƯỢT QUA XUẤT SẮC!");
    console.log("==================================================================");
    process.exit(0);
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

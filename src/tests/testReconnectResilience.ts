import EventEmitter from "events";
import { CloseReason } from "zca-js";
import { MessageListener } from "../listener/messageListener.js";
import { EventDispatcher } from "../listener/eventDispatcher.js";
import { updateConnectionInfo, getConnectionInfo } from "../auth/qrWebServer.js";

/**
 * Mock API and Listener để kiểm thử cơ chế Tự Phục Hồi (Self-Healing Connection Resilience)
 */
class MockListener extends EventEmitter {
  public isStarted = false;
  public retryCount: Record<string, { count: number; max: number }> = {
    "1006": { count: 3, max: 3 },
  };

  public start({ retryOnClose = false } = {}) {
    this.isStarted = true;
    // Giả lập kết nối thành công sau 10ms
    setTimeout(() => {
      this.emit("connected");
    }, 10);
  }

  public stop() {
    this.isStarted = false;
  }
}

class MockAPI {
  public listener = new MockListener();
  public accountInfoValid = true;

  public async fetchAccountInfo() {
    if (!this.accountInfoValid) {
      throw new Error("Invalid Session Token (401)");
    }
    return {
      profile: {
        userId: "test_uid_123",
        displayName: "Bot Test",
      } as any,
    };
  }

  public getOwnId() {
    return "test_uid_123";
  }
}

async function runResilienceTests() {
  console.log("==================================================");
  console.log("🧪 BẮT ĐẦU KIỂM THỬ TÍNH NĂNG TỰ SỬA LỖI & PHỤC HỒI KẾT NỐI (MÃ 1006, 3000)");
  console.log("==================================================\n");

  const mockApi = new MockAPI();
  const dispatcher = new EventDispatcher();
  const listener = new MessageListener(mockApi as any, dispatcher);

  let stateChanges: string[] = [];
  listener.onStateChange((info) => {
    stateChanges.push(info.state);
    updateConnectionInfo(info);
  });

  // Test 1: Khởi động lần đầu
  console.log("▶️ [Test 1] Khởi chạy Listener và kết nối lần đầu...");
  listener.start();
  await new Promise((r) => setTimeout(r, 50));

  const info1 = listener.getConnectionInfo();
  if (info1.state !== "connected") {
    throw new Error(`Test 1 Thất bại: Mong đợi 'connected', thực tế: '${info1.state}'`);
  }
  console.log("✅ [Test 1 Pass] Listener đã kết nối thành công (State: connected)\n");

  // Test 2: Mô phỏng lỗi 1006 (AbnormalClosure)
  console.log("▶️ [Test 2] Mô phỏng máy chủ ngắt socket đột ngột với mã 1006...");
  stateChanges = [];
  mockApi.listener.emit("closed", CloseReason.AbnormalClosure, "WebSocket connection dropped");

  const info2 = listener.getConnectionInfo();
  if (info2.state !== "reconnecting") {
    throw new Error(`Test 2 Thất bại: Mong đợi 'reconnecting', thực tế: '${info2.state}'`);
  }
  if (info2.reconnectAttempts !== 1) {
    throw new Error(`Test 2 Thất bại: Mong đợi attempts = 1, thực tế: ${info2.reconnectAttempts}`);
  }
  if (!info2.lastError?.includes("1006")) {
    throw new Error(`Test 2 Thất bại: lastError phải chứa 1006, thực tế: ${info2.lastError}`);
  }

  // Kiểm tra Dashboard API state cũng được cập nhật
  const portalInfo = getConnectionInfo();
  if (portalInfo.state !== "reconnecting") {
    throw new Error(`Test 2 Thất bại: Web Portal chưa đồng bộ trạng thái 'reconnecting'`);
  }
  console.log("✅ [Test 2 Pass] Phát hiện mã 1006, tự chuyển sang trạng thái reconnecting và đặt lịch backoff\n");

  // Test 3: Mô phỏng mã 3000 (DuplicateConnection)
  console.log("▶️ [Test 3] Mô phỏng xung đột mở Zalo Web ở máy khác (Mã 3000)...");
  mockApi.listener.emit("closed", CloseReason.DuplicateConnection, "Another web instance opened");

  const info3 = listener.getConnectionInfo();
  if (!info3.cooldownReason?.includes("Zalo Web")) {
    throw new Error(`Test 3 Thất bại: Mong đợi cooldownReason cảnh báo Zalo Web, thực tế: ${info3.cooldownReason}`);
  }
  console.log("✅ [Test 3 Pass] Phát hiện mã 3000 và kích hoạt cooldown an toàn 30s tránh xung đột phiên\n");

  // Test 4: Mô phỏng phiên đăng nhập bị thu hồi (Session Expired)
  console.log("▶️ [Test 4] Mô phỏng trường hợp Cookie bị huỷ trên điện thoại...");
  mockApi.accountInfoValid = false; // Làm hỏng session
  let sessionExpiredFired = false;
  listener.onSessionExpired(() => {
    sessionExpiredFired = true;
  });

  // Giả lập thử lại lần thứ 3 (ngưỡng trigger health check)
  (listener as any).reconnectAttempt = 3;
  mockApi.listener.emit("closed", CloseReason.AbnormalClosure, "Session invalid");

  await new Promise((r) => setTimeout(r, 100));

  if (!sessionExpiredFired) {
    throw new Error("Test 4 Thất bại: onSessionExpired callback không được kích hoạt!");
  }
  const info4 = listener.getConnectionInfo();
  if (info4.state !== "session_expired") {
    throw new Error(`Test 4 Thất bại: Mong đợi 'session_expired', thực tế: '${info4.state}'`);
  }
  console.log("✅ [Test 4 Pass] Tự động phát hiện phiên chết và phát tín hiệu yêu cầu quét lại QR\n");

  // Dọn dẹp
  listener.stop();
  const infoFinal = listener.getConnectionInfo();
  if (infoFinal.state !== "disconnected") {
    throw new Error(`Dọn dẹp thất bại: State phải là 'disconnected', thực tế: ${infoFinal.state}`);
  }

  console.log("==================================================");
  console.log("🎉 TẤT CẢ 4/4 BÀI KIỂM THỬ ĐỀU THÀNH CÔNG RỰC RỠ!");
  console.log("==================================================");
}

runResilienceTests().catch((err) => {
  console.error("❌ Lỗi kiểm thử:", err);
  process.exit(1);
});

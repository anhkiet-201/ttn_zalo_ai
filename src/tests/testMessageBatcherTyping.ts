import assert from "node:assert";
import { MessageBatcher, type MessageBatch } from "../handlers/messageBatcher.js";
import { ThreadType, type ParsedMessage } from "../types/zalo.types.js";

/**
 * Suite kiểm thử chuyên biệt: Tính năng Typing Indicator trong lúc chờ Debounce & Xử lý Batch
 */
async function runTypingTests() {
  console.log("=======================================================================");
  console.log("🚀 BẮT ĐẦU KIỂM THỬ: TÍNH NĂNG GỬI TYPING KHI CHỜ DEBOUNCE");
  console.log("=======================================================================\n");

  const results: Array<{ test: string; status: "PASS" | "FAIL"; durationMs: number; details: string }> = [];

  // Helper tạo mock message
  function createMockMessage(threadId: string, text: string, senderId = "user_1"): ParsedMessage {
    return {
      raw: {} as any,
      threadId,
      senderId,
      senderName: "Ứng Viên Test",
      isGroup: false,
      isSelf: false,
      text,
      timestamp: Date.now(),
      hasQuote: false,
      args: [],
    };
  }

  // Helper đợi ms
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // ───────────────────────────────────────────────────────────────────────────
  // Test 1: Delay ngẫu nhiên 1-3s trước khi gửi typing đầu tiên
  // ───────────────────────────────────────────────────────────────────────────
  {
    const start = performance.now();
    const typingCalls: Array<{ threadId: string; type: ThreadType; time: number }> = [];

    // Cấu hình: delay từ 100ms đến 200ms, debounce 500ms
    const batcher = new MessageBatcher(
      async () => {},
      0.5,
      0.5,
      async (threadId, type) => {
        typingCalls.push({ threadId, type, time: Date.now() });
      },
      1, // interval 1s
      0.1, // min delay 100ms
      0.2  // max delay 200ms
    );

    const threadId = "thread_test_delay";
    const enqueueTime = Date.now();
    batcher.enqueue(createMockMessage(threadId, "Hello"), ThreadType.User);

    // Tại thời điểm vừa enqueue (< 50ms): Chưa được gọi typing vì đang delay
    await sleep(40);
    assert.strictEqual(typingCalls.length, 0, "Typing không được gọi tức thì khi vừa enqueue (phải có delay)");

    // Sau 250ms (lớn hơn max delay 200ms): Đã được gọi đúng 1 lần
    await sleep(220);
    assert.strictEqual(typingCalls.length, 1, "Typing phải được gọi sau khi hết delay");
    assert.strictEqual(typingCalls[0].threadId, threadId);
    assert.strictEqual(typingCalls[0].type, ThreadType.User);

    const elapsed = typingCalls[0].time - enqueueTime;
    assert.ok(elapsed >= 90 && elapsed <= 300, `Thời gian delay thực tế (${elapsed}ms) phải nằm trong khoảng ~100-250ms`);

    batcher.destroy();
    const duration = performance.now() - start;
    results.push({
      test: "Test 1: Delay ngẫu nhiên trước khi gửi typing đầu tiên",
      status: "PASS",
      durationMs: Math.round(duration),
      details: `Typing được kích hoạt sau delay ${elapsed}ms (mô phỏng người thật đọc tin)`,
    });
    console.log("✅ PASS - Test 1: Delay ngẫu nhiên trước khi gửi typing đầu tiên");
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Test 2: Typing Interval định kỳ trong suốt thời gian debounce
  // ───────────────────────────────────────────────────────────────────────────
  {
    const start = performance.now();
    let typingCount = 0;

    // Cấu hình: minDelay 30ms, maxDelay 50ms, interval 100ms, debounce 350ms
    const batcher = new MessageBatcher(
      async () => {},
      0.35,
      0.35,
      async () => {
        typingCount++;
      },
      0.1,  // interval 100ms
      0.03, // min delay 30ms
      0.05  // max delay 50ms
    );

    const threadId = "thread_test_interval";
    batcher.enqueue(createMockMessage(threadId, "Tin nhắn 1"), ThreadType.User);

    // Chờ 280ms: Typing sẽ được gọi:
    // - Lần 1: sau delay ~40ms
    // - Lần 2: sau ~140ms
    // - Lần 3: sau ~240ms
    await sleep(280);
    assert.ok(typingCount >= 2, `Typing phải được gọi định kỳ nhiều lần (thực tế: ${typingCount} lần)`);

    batcher.destroy();
    const duration = performance.now() - start;
    results.push({
      test: "Test 2: Duy trì chu kỳ Typing Interval trong lúc debounce",
      status: "PASS",
      durationMs: Math.round(duration),
      details: `Typing được gọi lặp lại ${typingCount} lần theo interval trong thời gian debounce`,
    });
    console.log("✅ PASS - Test 2: Duy trì chu kỳ Typing Interval trong lúc debounce");
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Test 3: Reset debounce khi có tin nhắn mới mà không bị nhân đôi interval
  // ───────────────────────────────────────────────────────────────────────────
  {
    const start = performance.now();
    let typingCount = 0;
    let processedBatch: MessageBatch | null = null;

    // minDelay 30ms, maxDelay 40ms, interval 80ms, debounce 200ms
    const batcher = new MessageBatcher(
      async (batch) => {
        processedBatch = batch;
      },
      0.2,
      0.2,
      async () => {
        typingCount++;
      },
      0.08,
      0.03,
      0.04
    );

    const threadId = "thread_test_reset";
    batcher.enqueue(createMockMessage(threadId, "Tin 1"), ThreadType.User);

    // Sau 100ms, gửi tiếp tin thứ 2 để reset debounce timer
    await sleep(100);
    batcher.enqueue(createMockMessage(threadId, "Tin 2"), ThreadType.User);

    // Đợi 250ms nữa để debounce hoàn thành
    await sleep(250);

    assert.ok(processedBatch !== null, "Batch phải được xử lý thành công sau khi reset debounce");
    const validBatch = processedBatch as MessageBatch;
    assert.strictEqual(validBatch.messages.length, 2, "Batch phải gom đủ 2 tin nhắn");
    assert.ok(typingCount >= 2, "Typing phải tiếp tục hoạt động liên tục khi reset debounce");

    batcher.destroy();
    const duration = performance.now() - start;
    results.push({
      test: "Test 3: Reset debounce khi nhận thêm tin nhắn mà không làm hỏng typing",
      status: "PASS",
      durationMs: Math.round(duration),
      details: `Đã reset debounce timer thành công, gom đủ 2 tin và typing gọi ${typingCount} lần`,
    });
    console.log("✅ PASS - Test 3: Reset debounce khi nhận thêm tin nhắn");
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Test 4: stopTyping() và tự động cleanup sau khi batch xử lý xong
  // ───────────────────────────────────────────────────────────────────────────
  {
    const start = performance.now();
    let typingCount = 0;
    let stopCountAtProcess = 0;

    const batcher = new MessageBatcher(
      async (batch) => {
        // Trong processor, gọi stopTyping trước khi hoàn tất
        batcher.stopTyping(batch);
        stopCountAtProcess = typingCount;
        // Giả lập AI xử lý thêm 150ms
        await sleep(150);
      },
      0.1,
      0.1,
      async () => {
        typingCount++;
      },
      0.05,
      0.01,
      0.02
    );

    const threadId = "thread_test_stop";
    batcher.enqueue(createMockMessage(threadId, "Test stop typing"), ThreadType.User);

    // Đợi 350ms (bao gồm cả debounce 100ms + processor 150ms + 100ms sau đó)
    await sleep(350);

    // Sau khi stopTyping được gọi, typingCount không được tăng thêm
    assert.strictEqual(
      typingCount,
      stopCountAtProcess,
      "Typing không được gọi thêm bất kỳ lần nào sau khi stopTyping()"
    );

    batcher.destroy();
    const duration = performance.now() - start;
    results.push({
      test: "Test 4: stopTyping() và tự động dọn dẹp sạch sẽ",
      status: "PASS",
      durationMs: Math.round(duration),
      details: `stopTyping() dọn dẹp interval thành công, không phát sinh cuộc gọi thừa (${typingCount} calls)`,
    });
    console.log("✅ PASS - Test 4: stopTyping() và tự động dọn dẹp sạch sẽ");
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Test 5: batcher.destroy() dọn dẹp toàn bộ timer đang chờ
  // ───────────────────────────────────────────────────────────────────────────
  {
    const start = performance.now();
    let typingCount = 0;
    let processed = false;

    const batcher = new MessageBatcher(
      async () => {
        processed = true;
      },
      0.5,
      0.5,
      async () => {
        typingCount++;
      },
      0.1,
      0.1,
      0.2
    );

    batcher.enqueue(createMockMessage("thread_destroy_1", "Tin A"), ThreadType.User);
    batcher.enqueue(createMockMessage("thread_destroy_2", "Tin B"), ThreadType.User);

    // Huỷ ngay khi đang delay
    await sleep(20);
    batcher.destroy();

    // Chờ 300ms sau khi destroy
    await sleep(300);

    assert.strictEqual(processed, false, "Không được kích hoạt processor sau khi destroy");
    assert.strictEqual(typingCount, 0, "Không được kích hoạt typing callback sau khi destroy");

    const duration = performance.now() - start;
    results.push({
      test: "Test 5: destroy() dọn dẹp triệt để không để rò rỉ bộ nhớ",
      status: "PASS",
      durationMs: Math.round(duration),
      details: "Tất cả timer delay và interval đều được hủy ngay lập tức",
    });
    console.log("✅ PASS - Test 5: destroy() dọn dẹp triệt để");
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Test 6: Khả năng chống chịu lỗi (Error Resilience) khi TypingHandler gặp sự cố
  // ───────────────────────────────────────────────────────────────────────────
  {
    const start = performance.now();
    let processed = false;

    const batcher = new MessageBatcher(
      async () => {
        processed = true;
      },
      0.1,
      0.1,
      async () => {
        throw new Error("Mạng Zalo lỗi ngắt quãng khi gửi typing");
      },
      0.05,
      0.01,
      0.02
    );

    batcher.enqueue(createMockMessage("thread_error_resilience", "Test error"), ThreadType.User);

    // Chờ debounce kích hoạt
    await sleep(200);

    assert.strictEqual(
      processed,
      true,
      "Processor vẫn phải hoàn tất thành công dù TypingHandler quăng exception"
    );

    batcher.destroy();
    const duration = performance.now() - start;
    results.push({
      test: "Test 6: Khả năng tự phục hồi khi typing gặp sự cố mạng",
      status: "PASS",
      durationMs: Math.round(duration),
      details: "Bắt lỗi an toàn, luồng debounce và AI processor không bị gián đoạn",
    });
    console.log("✅ PASS - Test 6: Khả năng tự phục hồi khi typing gặp sự cố mạng");
  }

  // In bảng kết quả
  console.log("\n=======================================================================");
  console.log("📋 BẢNG TỔNG HỢP KẾT QUẢ KIỂM THỬ TÍNH NĂNG TYPING DEBOUNCE (6/6)");
  console.log("=======================================================================");
  console.table(
    results.map((r, i) => ({
      STT: i + 1,
      "Bài kiểm thử": r.test,
      "Kết quả": r.status,
      "Thời gian (ms)": r.durationMs,
      "Chi tiết": r.details,
    }))
  );
  console.log("\n🎉 TẤT CẢ CÁC BÀI TEST ĐÃ VƯỢT QUA 100%!");
}

runTypingTests().catch((err) => {
  console.error("❌ Lỗi khi chạy test suite:", err);
  process.exit(1);
});

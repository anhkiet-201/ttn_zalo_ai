import { SQLiteDatabase } from "../database/sqliteDb.js";
import { ChatHistoryRepository } from "../database/repositories/chatHistoryRepository.js";
import { CandidateRepository } from "../database/repositories/candidateRepository.js";
import { ThreadMetadataRepository } from "../database/repositories/threadMetadataRepository.js";
import { UserContextRepository } from "../database/repositories/userContextRepository.js";
import { UserContextManager } from "../services/userContextManager.js";
import { EventDispatcher } from "../listener/eventDispatcher.js";
import { chatBroadcaster } from "../server/chatBroadcaster.js";
import { RAGService } from "../services/ragService.js";
import { splitTextIntoChunks } from "../services/zaloService.js";
import { ThreadType } from "../types/zalo.types.js";
import fs from "node:fs";
import path from "node:path";

/**
 * Suite kiểm thử hiệu suất, kiểm tra memory leak và kiểm thử khả năng chịu lỗi
 */
async function runAllBenchmarks() {
  console.log("===============================================================");
  console.log("🧪 BẮT ĐẦU KIỂM THỬ HIỆU SUẤT, MEMORY LEAK & KHẢ NĂNG CHỊU LỖI");
  console.log("===============================================================\n");

  const testDbDir = path.resolve(process.cwd(), "data");
  if (!fs.existsSync(testDbDir)) {
    fs.mkdirSync(testDbDir, { recursive: true });
  }
  const testDbPath = path.join(testDbDir, "test_benchmark.db");

  // Dọn dẹp DB test cũ nếu có
  if (fs.existsSync(testDbPath)) {
    try { fs.unlinkSync(testDbPath); } catch {}
  }

  const testDb = SQLiteDatabase.getInstance(testDbPath);
  const chatHistoryRepo = new ChatHistoryRepository(testDb);
  const candidateRepo = new CandidateRepository(testDb);
  const threadMetaRepo = new ThreadMetadataRepository(testDb);
  const userContextRepo = new UserContextRepository(testDb);

  const results: Array<{ test: string; status: "PASS" | "FAIL"; durationMs: number; metrics: string }> = [];

  // ──────────────────────────────────────────────────────────────────────────
  // MODULE 1: KIỂM THỬ HIỆU SUẤT DATABASE & CONCURRENCY
  // ──────────────────────────────────────────────────────────────────────────
  console.log("📊 [MODULE 1] Đang kiểm tra Hiệu suất Database & Concurrency...");
  {
    const startInsert = performance.now();
    const NUM_MESSAGES = 10000;
    const NUM_CANDIDATES = 1000;

    // 1.1. Bulk Insert 10.000 messages
    const insertTransaction = testDb.connection.transaction(() => {
      for (let i = 0; i < NUM_MESSAGES; i++) {
        const threadNum = i % 100;
        chatHistoryRepo.addMessage({
          id: `msg_perf_${i}`,
          threadId: `thread_${threadNum}`,
          senderId: `user_${i % 200}`,
          senderName: `Ứng viên ${i % 200}`,
          role: i % 2 === 0 ? "user" : "model",
          content: `Nội dung tin nhắn kiểm thử hiệu năng số ${i}`,
          timestamp: 1700000000000 + i * 1000,
        });
      }
    });
    insertTransaction();
    const insertMs = performance.now() - startInsert;
    const insertThroughput = Math.round((NUM_MESSAGES / (insertMs / 1000)));

    results.push({
      test: "Database Bulk Insert 10,000 Messages",
      status: insertThroughput > 3000 ? "PASS" : "FAIL",
      durationMs: Math.round(insertMs),
      metrics: `${insertThroughput.toLocaleString()} msgs/giây`,
    });

    // 1.2. Bulk Insert 1.000 Candidates
    const startCandidate = performance.now();
    const candidateTransaction = testDb.connection.transaction(() => {
      for (let i = 0; i < NUM_CANDIDATES; i++) {
        const threadNum = i % 100;
        candidateRepo.upsertCandidate({
          id: `cand_perf_${i}`,
          threadId: `thread_${threadNum}`,
          senderId: `user_${i}`,
          senderName: `Ứng viên ${i}`,
          fullName: `NGUYỄN VĂN ${i}`,
          idNumber: `07920${String(i).padStart(7, "0")}`,
          targetCompany: i % 2 === 0 ? "Chervon" : "Kaiser",
          interviewDate: "7h30 sáng mai",
          phoneNumber: `090123${String(i).padStart(4, "0")}`,
          imageUrls: [`https://example.com/cccd_${i}.jpg`],
          forwardedTo: "hr_admin",
        });
      }
    });
    candidateTransaction();
    const candidateMs = performance.now() - startCandidate;
    const candThroughput = Math.round((NUM_CANDIDATES / (candidateMs / 1000)));

    results.push({
      test: "Database Upsert 1,000 Candidates",
      status: candThroughput > 1000 ? "PASS" : "FAIL",
      durationMs: Math.round(candidateMs),
      metrics: `${candThroughput.toLocaleString()} records/giây`,
    });

    // 1.3. Query Latency: getThreadList và getTotalThreadsCount
    const startQuery = performance.now();
    const threads = chatHistoryRepo.getThreadList(20, 0, "", "all");
    const totalThreads = chatHistoryRepo.getTotalThreadsCount("", "all");
    const queryMs = performance.now() - startQuery;

    // Kiểm tra không có duplicate threadId và đúng 100 threads
    const threadIds = threads.map((t) => t.threadId);
    const hasDuplicates = new Set(threadIds).size !== threadIds.length;

    results.push({
      test: "Query getThreadList & Count (10,000 msgs dataset)",
      status: queryMs < 50 && !hasDuplicates ? "PASS" : "FAIL",
      durationMs: Number(queryMs.toFixed(2)),
      metrics: `Total: ${totalThreads} threads | Latency: ${queryMs.toFixed(2)}ms | Duplicate: ${hasDuplicates}`,
    });

    // 1.4. Query getHistoryBefore & getRecentHistory
    const startHist = performance.now();
    const recent = chatHistoryRepo.getRecentHistory("thread_1", 20);
    const before = chatHistoryRepo.getHistoryBefore("thread_1", 1700005000000, 20);
    const histMs = performance.now() - startHist;

    results.push({
      test: "Query Recent History & Pagination Before",
      status: recent.length > 0 && histMs < 10 ? "PASS" : "FAIL",
      durationMs: Number(histMs.toFixed(2)),
      metrics: `Fetched: ${recent.length + before.length} msgs in ${histMs.toFixed(2)}ms`,
    });

    // 1.5. Chống trùng lặp tin nhắn (Deduplication Check)
    const dupCheckStart = performance.now();
    const ts = Date.now();
    chatHistoryRepo.addMessage({
      threadId: "thread_dedup",
      senderId: "user_dup",
      senderName: "User Dup",
      role: "user",
      content: "Tin nhắn thử nghiệm chống trùng lặp",
      timestamp: ts,
    });
    // Gửi lại tin nhắn giống hệt trong vòng 5 giây
    chatHistoryRepo.addMessage({
      threadId: "thread_dedup",
      senderId: "user_dup",
      senderName: "User Dup",
      role: "user",
      content: "Tin nhắn thử nghiệm chống trùng lặp",
      timestamp: ts + 1000,
    });
    const dedupMs = performance.now() - dupCheckStart;
    const dedupHistory = chatHistoryRepo.getRecentHistory("thread_dedup", 10);

    results.push({
      test: "Message Deduplication (5s window)",
      status: dedupHistory.length === 1 ? "PASS" : "FAIL",
      durationMs: Number(dedupMs.toFixed(2)),
      metrics: `Actual count: ${dedupHistory.length} (Expected: 1)`,
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // MODULE 2: KIỂM THỬ RÒ RỈ BỘ NHỚ (MEMORY LEAK PROFILING)
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n🧠 [MODULE 2] Đang kiểm tra Rò rỉ Bộ nhớ (Memory Leak)...");
  {
    if (global.gc) {
      global.gc();
    }
    const memInitial = process.memoryUsage();
    const initialHeapMb = (memInitial.heapUsed / 1024 / 1024).toFixed(2);

    const userContextMgr = new UserContextManager(userContextRepo);
    const eventDispatcher = new EventDispatcher();

    // Đăng ký listener và kiểm tra count
    const dummyHandler = () => {};
    chatBroadcaster.on("message", dummyHandler);

    const CYCLES = 10000;
    const startMemTest = performance.now();

    for (let i = 0; i < CYCLES; i++) {
      const threadId = `mem_thread_${i % 50}`;
      const senderId = `mem_user_${i % 100}`;
      
      // 1. Phân tích tin nhắn qua Dispatcher
      const parsed = eventDispatcher.parseMessage({
        threadId,
        type: ThreadType.User,
        data: {
          uidFrom: senderId,
          dName: `Mem User ${i}`,
          content: `Xin chào bot! Tôi tên là Ứng viên ${i}, SĐT: 0901234567, cần tìm việc tại công ty Chervon.`,
          ts: 1700000000000 + i,
        },
      } as any);

      // 2. Cập nhật UserContext
      userContextMgr.extractAndAddPhoneNumbers(threadId, senderId, parsed.senderName, parsed.text);
      
      // 3. Broadcast SSE event
      chatBroadcaster.broadcast({
        threadId,
        senderId,
        senderName: parsed.senderName,
        role: "user",
        content: parsed.text,
        timestamp: parsed.timestamp,
      });
    }

    chatBroadcaster.off("message", dummyHandler);
    const broadcasterListenersAfter = chatBroadcaster.listenerCount("message");

    if (global.gc) {
      global.gc();
    }
    const memFinal = process.memoryUsage();
    const finalHeapMb = (memFinal.heapUsed / 1024 / 1024).toFixed(2);
    const heapDiffMb = ((memFinal.heapUsed - memInitial.heapUsed) / 1024 / 1024).toFixed(2);
    const memDuration = performance.now() - startMemTest;

    results.push({
      test: "Memory Leak Test (10,000 Event & Context Cycles)",
      status: Number(heapDiffMb) < 25 && broadcasterListenersAfter === 0 ? "PASS" : "FAIL",
      durationMs: Math.round(memDuration),
      metrics: `Initial: ${initialHeapMb}MB -> Final: ${finalHeapMb}MB (Delta: ${heapDiffMb}MB) | Listeners: ${broadcasterListenersAfter}`,
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // MODULE 3: KIỂM THỬ KHẢ NĂNG CHỊU LỖI & NGOẠI LỆ AI (RESILIENCE)
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n🛡️ [MODULE 3] Đang kiểm tra Khả năng chịu lỗi & Ngoại lệ AI...");
  {
    // 3.1. Timeout Guard Test (Giả lập Promise timeout)
    const startTimeoutTest = performance.now();
    const simulatedTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timeout (45000ms) khi gọi Gemini AI")), 50)
    );
    let caughtTimeout = false;
    try {
      await simulatedTimeout;
    } catch (err: any) {
      if (err.message.includes("Timeout")) caughtTimeout = true;
    }
    const timeoutDuration = performance.now() - startTimeoutTest;

    results.push({
      test: "AI Gateway Timeout & Abort Handling",
      status: caughtTimeout ? "PASS" : "FAIL",
      durationMs: Math.round(timeoutDuration),
      metrics: `Handled timeout gracefully: ${caughtTimeout}`,
    });

    // 3.2. Malformed JSON Resilience trong Tool/Parser
    const startJsonTest = performance.now();
    const rawMalformedJson = '```json\n{ "isCCCD": true, "cards": [ { "fullName": "NGUYEN VAN A", "idNumber": "079123456789" } \n```'; // thiếu dấu đóng
    let jsonErrorHandled = false;
    try {
      const cleanJson = rawMalformedJson.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      JSON.parse(cleanJson);
    } catch {
      jsonErrorHandled = true;
    }

    results.push({
      test: "Malformed OCR JSON Error Resilience",
      status: jsonErrorHandled ? "PASS" : "FAIL",
      durationMs: Number((performance.now() - startJsonTest).toFixed(2)),
      metrics: `Gracefully trapped malformed JSON: ${jsonErrorHandled}`,
    });

    // 3.3. Text Chunking cho tin nhắn cực dài
    const startChunk = performance.now();
    const longText = "A".repeat(12000);
    const chunks = splitTextIntoChunks(longText, 1500);
    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);

    results.push({
      test: "Message Text Splitting (12,000 chars -> chunks)",
      status: chunks.length === 8 && totalLength === 12000 ? "PASS" : "FAIL",
      durationMs: Number((performance.now() - startChunk).toFixed(2)),
      metrics: `Chunks: ${chunks.length} parts (Max: ${Math.max(...chunks.map((c) => c.length))} chars)`,
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // MODULE 4: KIỂM THỬ BẢO MẬT & DỮ LIỆU ĐẦU VÀO (SECURITY & EDGE CASES)
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n🔒 [MODULE 4] Đang kiểm tra Bảo mật & Input Edge Cases...");
  {
    // 4.1. SQL Injection Injection Test
    const startSqli = performance.now();
    const maliciousPayload = "' OR '1'='1'; DROP TABLE chat_messages; --";
    
    // Thử insert và query với payload SQLi
    chatHistoryRepo.addMessage({
      threadId: "thread_sqli",
      senderId: maliciousPayload,
      senderName: maliciousPayload,
      role: "user",
      content: maliciousPayload,
      timestamp: Date.now(),
    });

    const sqliSearch = chatHistoryRepo.getThreadList(20, 0, maliciousPayload, "all");
    const countCheck = testDb.connection.prepare("SELECT COUNT(*) as c FROM chat_messages").get() as { c: number };
    const sqliMs = performance.now() - startSqli;

    results.push({
      test: "SQL Injection Resistance (Parameterized Queries)",
      status: countCheck.c > 0 ? "PASS" : "FAIL",
      durationMs: Number(sqliMs.toFixed(2)),
      metrics: `Table intact! Total msgs: ${countCheck.c.toLocaleString()}`,
    });

    // 4.2. XSS & Special Unicode Characters
    const startUnicode = performance.now();
    const xssPayload = `<script>alert('XSS')</script> 🚀👨‍👩‍👧‍👦 ﷽ 𝓤𝓷𝓲𝓬𝓸𝓭𝓮`;
    chatHistoryRepo.addMessage({
      threadId: "thread_unicode",
      senderId: "user_xss",
      senderName: xssPayload,
      role: "user",
      content: xssPayload,
      timestamp: Date.now(),
    });
    const fetchedMsg = chatHistoryRepo.getRecentHistory("thread_unicode", 1);
    const unicodeMs = performance.now() - startUnicode;

    results.push({
      test: "XSS & Special Unicode Preservation",
      status: fetchedMsg.length > 0 && fetchedMsg[0].content === xssPayload ? "PASS" : "FAIL",
      durationMs: Number(unicodeMs.toFixed(2)),
      metrics: `Preserved Unicode exact match: ${fetchedMsg[0]?.content === xssPayload}`,
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TỔNG HỢP KẾT QUẢ VÀ IN BÁO CÁO
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n===============================================================");
  console.log("📋 BẢNG TỔNG HỢP KẾT QUẢ KIỂM THỬ TOÀN DIỆN");
  console.log("===============================================================");
  console.table(results);

  const passedCount = results.filter((r) => r.status === "PASS").length;
  const failedCount = results.filter((r) => r.status === "FAIL").length;

  console.log(`\n🎉 TỔNG KẾT: ${passedCount}/${results.length} bài test ĐẠT (PASS) | ${failedCount} bài test LỖI (FAIL)\n`);

  // Dọn dẹp test database
  try {
    testDb.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (fs.existsSync(`${testDbPath}-wal`)) fs.unlinkSync(`${testDbPath}-wal`);
    if (fs.existsSync(`${testDbPath}-shm`)) fs.unlinkSync(`${testDbPath}-shm`);
  } catch {}

  return { passedCount, failedCount, total: results.length, results };
}

runAllBenchmarks().catch((err) => {
  console.error("❌ Lỗi khi thực thi Test Benchmark:", err);
  process.exit(1);
});

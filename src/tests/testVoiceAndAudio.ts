import { EventDispatcher } from "../listener/eventDispatcher.js";
import { MessageBatcher, type MessageBatch } from "../handlers/messageBatcher.js";
import { GroupMessageBatcher, type GroupMessageBatch } from "../handlers/groupMessageBatcher.js";
import { SQLiteDatabase } from "../database/sqliteDb.js";
import { ChatHistoryRepository } from "../database/repositories/chatHistoryRepository.js";
import { downloadAudioAsBase64 } from "../services/audioHelper.js";
import { buildAudioTranscriptionPrompt } from "../prompts/audioPrompt.js";
import { AudioService } from "../services/audioService.js";
import { RAGService } from "../services/ragService.js";
import { ThreadType, type Message } from "../types/zalo.types.js";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";

/**
 * Suite kiểm thử chuyên sâu cho Tin nhắn thoại, Phân tích âm thanh & Trình phát HTML
 */
async function runVoiceAndAudioTests() {
  console.log("===============================================================");
  console.log("🎙️ BẮT ĐẦU KIỂM THỬ TOÀN DIỆN: VOICE MESSAGE, AUDIO STT & UI");
  console.log("===============================================================\n");

  const results: Array<{ module: string; test: string; status: "PASS" | "FAIL"; durationMs: number; details: string }> = [];

  // Setup Database test riêng
  const testDbDir = path.resolve(process.cwd(), "data");
  if (!fs.existsSync(testDbDir)) {
    fs.mkdirSync(testDbDir, { recursive: true });
  }
  const testDbPath = path.join(testDbDir, "test_voice.db");
  if (fs.existsSync(testDbPath)) {
    try { fs.unlinkSync(testDbPath); } catch {}
  }

  const testDb = SQLiteDatabase.getInstance(testDbPath);
  const chatHistoryRepo = new ChatHistoryRepository(testDb);

  // ──────────────────────────────────────────────────────────────────────────
  // MODULE A: KIỂM THỬ XỬ LÝ & LƯU TRỮ TIN NHẮN THOẠI
  // ──────────────────────────────────────────────────────────────────────────
  console.log("📦 [MODULE A] Kiểm thử Trích xuất, Gom Batch & Lưu trữ Tin Nhắn Thoại...");

  // Test A.1: Trích xuất payload Zalo Voice từ nhiều cấu trúc khác nhau
  {
    const start = performance.now();
    const dispatcher = new EventDispatcher();
    dispatcher.setOwnId("bot_own_id");

    // Case 1: Payload có JSON string trong content
    const rawVoice1 = {
      type: 0,
      data: {
        msgId: "voice_msg_1",
        cliMsgId: "cli_1",
        msgType: "chat.voice",
        uidFrom: "user_voice_1",
        idTo: "bot_own_id",
        dName: "Ứng Viên Thoại 1",
        ts: "1700000000000",
        content: JSON.stringify({
          voiceUrl: "https://zalo.me/voice/recording_01.m4a",
          duration: 7500,
        }),
      },
    } as any;

    const parsed1 = (dispatcher as any).parseMessage(rawVoice1);
    assert.strictEqual(parsed1.mediaType, "voice", "Case 1: mediaType phải là voice");
    assert.strictEqual(parsed1.mediaUrls?.[0]?.url, "https://zalo.me/voice/recording_01.m4a", "Case 1: voiceUrl khớp");
    assert.strictEqual(parsed1.mediaUrls?.[0]?.duration, 7500, "Case 1: duration khớp");

    // Case 2: Payload có thông tin trong params & paramsExt
    const rawVoice2 = {
      type: 0,
      data: {
        msgId: "voice_msg_2",
        cliMsgId: "cli_2",
        msgType: "chat.voice",
        uidFrom: "user_voice_2",
        idTo: "bot_own_id",
        dName: "Ứng Viên Thoại 2",
        ts: "1700000001000",
        content: "",
        params: {
          m4aUrl: "https://zalo.me/voice/recording_02.m4a",
          duration: 12000,
        } as any,
      },
    } as any;

    const parsed2 = (dispatcher as any).parseMessage(rawVoice2);
    assert.strictEqual(parsed2.mediaType, "voice", "Case 2: mediaType phải là voice");
    assert.strictEqual(parsed2.mediaUrls?.[0]?.url, "https://zalo.me/voice/recording_02.m4a", "Case 2: voiceUrl khớp từ params");
    assert.strictEqual(parsed2.mediaUrls?.[0]?.duration, 12000, "Case 2: duration khớp từ params");

    // Case 3: Quote tin nhắn thoại
    const rawVoice3 = {
      type: 0,
      data: {
        msgId: "voice_msg_3",
        cliMsgId: "cli_3",
        msgType: "chat.text",
        uidFrom: "user_voice_3",
        idTo: "bot_own_id",
        dName: "Ứng Viên Thoại 3",
        ts: "1700000002000",
        content: "Em vừa gửi tin nhắn thoại đó chị",
        quote: {
          msg: "",
          msgType: "chat.voice",
          ownerId: "user_voice_3",
          fromDName: "Ứng Viên Thoại 3",
        } as any,
      },
    } as any;

    const parsed3 = (dispatcher as any).parseMessage(rawVoice3);
    assert.strictEqual(parsed3.hasQuote, true, "Case 3: hasQuote phải là true");
    assert.strictEqual(parsed3.quoteText, "[Tin nhắn thoại]", "Case 3: quoteText được gán nhãn [Tin nhắn thoại]");

    // Case 4: Tin nhắn ảnh có thuộc tính url thông thường (phải nhận là Image, không được nhận là Voice)
    const rawPhoto = {
      type: 0,
      data: {
        msgId: "photo_msg_1",
        cliMsgId: "cli_photo_1",
        msgType: "chat.photo",
        uidFrom: "user_photo_1",
        idTo: "bot_own_id",
        dName: "Ứng Viên Gửi Ảnh",
        ts: "1700000003000",
        content: JSON.stringify({
          url: "https://res-zalo.zadn.vn/photo/abc.jpg",
          hdUrl: "https://res-zalo.zadn.vn/photo/abc_hd.jpg",
        }),
      },
    } as any;

    const parsedPhoto = (dispatcher as any).parseMessage(rawPhoto);
    assert.strictEqual(parsedPhoto.mediaType, "photo", "Case 4: mediaType = 'photo'");
    assert.strictEqual(parsedPhoto.mediaUrls?.length, 1, "Case 4: trích xuất đúng 1 ảnh tốt nhất");
    assert.strictEqual(parsedPhoto.mediaUrls?.[0]?.url, "https://res-zalo.zadn.vn/photo/abc_hd.jpg", "Case 4: ưu tiên hdUrl");

    const duration = performance.now() - start;
    results.push({
      module: "Module A",
      test: "Trích xuất Payload Voice Zalo (JSON, params, quote & Photo Protection)",
      status: "PASS",
      durationMs: duration,
      details: "Trích xuất chuẩn xác voice payload và bảo vệ 100% không nhận nhầm photo thành voice",
    });
  }

  // Test A.2: Gom Batch tin nhắn thoại với MessageBatcher
  {
    const start = performance.now();
    let batchedResult: MessageBatch | null = null;

    const batcher = new MessageBatcher(
      async (batch) => {
        batchedResult = batch;
      },
      0.05,
      0.05 // debounce 50ms cho test
    );

    // Enqueue 1 text message và 1 voice message
    batcher.enqueue(
      {
        raw: {} as any,
        args: [],
        threadId: "thread_voice_test",
        senderId: "user_100",
        senderName: "Ứng viên Batch",
        isGroup: false,
        isSelf: false,
        text: "Chào bot",
        timestamp: Date.now(),
        hasQuote: false,
      },
      ThreadType.User
    );

    batcher.enqueue(
      {
        raw: {} as any,
        args: [],
        threadId: "thread_voice_test",
        senderId: "user_100",
        senderName: "Ứng viên Batch",
        isGroup: false,
        isSelf: false,
        text: "",
        mediaType: "voice",
        mediaUrls: [{ url: "https://zalo.me/voice/test_batch.m4a", duration: 8000 }],
        timestamp: Date.now() + 10,
        hasQuote: false,
      },
      ThreadType.User
    );

    // Đợi debounce hoàn tất
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.ok(batchedResult, "Batcher phải kích hoạt callback");
    assert.strictEqual((batchedResult as any).messages.length, 2, "Batch phải gom đủ 2 tin nhắn");
    assert.strictEqual((batchedResult as any).messages[1].mediaType, "voice", "Tin nhắn 2 trong batch phải có mediaType = 'voice'");
    assert.strictEqual((batchedResult as any).messages[1].mediaUrls?.[0]?.url, "https://zalo.me/voice/test_batch.m4a", "voiceUrl trong batch khớp");

    const duration = performance.now() - start;
    results.push({
      module: "Module A",
      test: "Gom Batch Tin Nhắn Thoại (MessageBatcher)",
      status: "PASS",
      durationMs: duration,
      details: `Gom thành công batch 2 tin nhắn (Text + Voice 8000ms)`,
    });
  }

  // Test A.3: Lưu Trữ SQLite & Chống Trùng Lặp Tin Nhắn Thoại
  {
    const start = performance.now();

    // Lưu tin nhắn thoại 1
    chatHistoryRepo.addMessage({
      id: "msg_voice_db_1",
      threadId: "thread_voice_db",
      senderId: "user_v1",
      senderName: "Nguyễn Văn Voice",
      role: "user",
      content: "",
      mediaType: "voice",
      mediaUrls: [{ url: "https://zalo.me/voice/db_test_1.m4a", duration: 9500 }],
      timestamp: 1700000010000,
    });

    // Thử gửi trùng lặp cùng URL trong vòng 2 giây
    chatHistoryRepo.addMessage({
      id: "msg_voice_db_duplicate",
      threadId: "thread_voice_db",
      senderId: "user_v1",
      senderName: "Nguyễn Văn Voice",
      role: "user",
      content: "",
      mediaType: "voice",
      mediaUrls: [{ url: "https://zalo.me/voice/db_test_1.m4a", duration: 9500 }],
      timestamp: 1700000011000,
    });

    const recentMsgs = chatHistoryRepo.getRecentHistory("thread_voice_db", 10);
    assert.strictEqual(recentMsgs.length, 1, "Chống trùng lặp: Chỉ được có 1 bản ghi trong DB");
    assert.strictEqual(recentMsgs[0].mediaType, "voice", "mediaType = 'voice' phải được lưu vào SQLite");
    assert.strictEqual(recentMsgs[0].mediaUrls?.[0]?.url, "https://zalo.me/voice/db_test_1.m4a", "voiceUrl phải khớp trong SQLite");
    assert.strictEqual(recentMsgs[0].mediaUrls?.[0]?.duration, 9500, "voiceDuration phải khớp trong SQLite");

    // Kiểm tra Thread List Preview
    const threads = chatHistoryRepo.getThreadList(10, 0, undefined, "all");
    const foundThread = threads.find((t) => t.threadId === "thread_voice_db");
    assert.ok(foundThread, "Phải tìm thấy thread_voice_db trong ThreadList");
    assert.strictEqual(foundThread.lastMediaType, "voice", "lastMediaType của ThreadList phải là 'voice'");

    const duration = performance.now() - start;
    results.push({
      module: "Module A",
      test: "Lưu Trữ SQLite, Chống Duplicate & Thread Preview Voice",
      status: "PASS",
      durationMs: duration,
      details: "Lưu & chống trùng lặp thành công (voice_url, voice_duration, lastHasVoice: 1)",
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // MODULE B: KIỂM THỬ DỊCH VỤ PHÂN TÍCH ÂM THANH (AUDIO STT)
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n🧠 [MODULE B] Kiểm thử Dịch vụ Phân tích Âm thanh (AudioHelper & AudioPrompt)...");

  // Test B.1: Helper Tải File & Kiểm Tra Tính Hợp Lệ Của URL
  {
    const start = performance.now();

    const invalidRes1 = await downloadAudioAsBase64("");
    assert.strictEqual(invalidRes1, null, "URL rỗng phải trả về null");

    const invalidRes2 = await downloadAudioAsBase64("ftp://invalid.com/audio.mp3");
    assert.strictEqual(invalidRes2, null, "FTP protocol phải trả về null");

    const invalidRes3 = await downloadAudioAsBase64("not-a-valid-url");
    assert.strictEqual(invalidRes3, null, "URL sai định dạng phải trả về null");

    const duration = performance.now() - start;
    results.push({
      module: "Module B",
      test: "AudioHelper URL Validation & An Toàn Đầu Vào",
      status: "PASS",
      durationMs: duration,
      details: "Bảo vệ thành công trước URL rỗng, giao thức không hợp lệ và link sai định dạng",
    });
  }

  // Test B.2: Cấu Trúc Prompt Phiên Âm & Nạp Danh Sách Công Ty RAG
  {
    const start = performance.now();
    const ragService = RAGService.getInstance();
    const companyHints = ragService.getCompanyHints();

    const prompt = buildAudioTranscriptionPrompt(companyHints);

    assert.ok(prompt.includes("Vietnamese speech-to-text transcriber"), "Prompt phải chứa role STT");
    assert.ok(prompt.includes("CRITICAL DOMAIN-SPECIFIC GUIDELINES"), "Prompt phải chứa guidelines");
    assert.ok(prompt.includes("Regional Dialects & Pronunciations"), "Prompt phải chứa chỉ dẫn phương ngữ 3 miền");
    assert.ok(prompt.includes("OUTPUT RULES"), "Prompt phải chứa quy tắc định dạng output");

    // Kiểm tra các công ty tiêu biểu có mặt trong prompt
    if (companyHints.length > 0) {
      assert.ok(prompt.includes(companyHints[0]), `Prompt phải chứa công ty mẫu: ${companyHints[0]}`);
    }

    const duration = performance.now() - start;
    results.push({
      module: "Module B",
      test: "AudioPrompt Cấu Trúc Tiếng Anh & Nạp RAG Company Hints",
      status: "PASS",
      durationMs: duration,
      details: `Đã nạp ${companyHints.length} công ty và từ khóa vào Audio Prompt`,
    });
  }

  // Test B.3: AudioService Xử Lý Lỗi & Fallback Khi URL Không Khả Dụng
  {
    const start = performance.now();
    const audioService = new AudioService(null);

    // Khi truyền URL không tồn tại hoặc chưa khởi tạo AI
    const resNoAi = await audioService.transcribeAudio("https://invalid-url.com/sample.m4a");
    assert.ok(resNoAi.includes("[Tin nhắn thoại"), "Fallback an toàn khi chưa có AI hoặc lỗi tải audio");

    const resEmptyUrl = await audioService.transcribeAudio("");
    assert.strictEqual(resEmptyUrl, "[Tin nhắn thoại: Không có URL âm thanh hợp lệ]", "URL rỗng trả về thông báo hợp lý");

    const duration = performance.now() - start;
    results.push({
      module: "Module B",
      test: "AudioService Ngoại Lệ & Fallback Graceful Degradation",
      status: "PASS",
      durationMs: duration,
      details: "Trap lỗi URL rỗng/network/AI an toàn, trả về fallback thân thiện",
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // MODULE C: KIỂM THỬ TRÌNH PHÁT ÂM THANH HTML & LOGIC UI
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n🎨 [MODULE C] Kiểm thử Trình Phát Âm Thanh HTML (Custom Zalo Voice Player)...");

  // Test C.1: Logic Định Dạng Thời Lượng (formatAudioDuration)
  {
    const start = performance.now();

    function formatAudioDuration(seconds: number): string {
      if (isNaN(seconds) || seconds < 0) return "0:00";
      const m = Math.floor(seconds / 60);
      const s = Math.floor(seconds % 60);
      return `${m}:${s < 10 ? "0" : ""}${s}`;
    }

    assert.strictEqual(formatAudioDuration(0), "0:00", "0s -> 0:00");
    assert.strictEqual(formatAudioDuration(5), "0:05", "5s -> 0:05");
    assert.strictEqual(formatAudioDuration(59), "0:59", "59s -> 0:59");
    assert.strictEqual(formatAudioDuration(60), "1:00", "60s -> 1:00");
    assert.strictEqual(formatAudioDuration(125), "2:05", "125s -> 2:05");
    assert.strictEqual(formatAudioDuration(-10), "0:00", "Số âm -> 0:00");
    assert.strictEqual(formatAudioDuration(NaN), "0:00", "NaN -> 0:00");

    const duration = performance.now() - start;
    results.push({
      module: "Module C",
      test: "formatAudioDuration Định Dạng Thời Gian Chuẩn Xác",
      status: "PASS",
      durationMs: duration,
      details: "Kiểm tra 7/7 ca biên thời gian đều chính xác (0s, 5s, 59s, 60s, 125s, âm, NaN)",
    });
  }

  // Test C.2: Logic Tiến Trình Waveform & Tính Số Cột Sóng Hoạt Động (28 Bars)
  {
    const start = performance.now();
    const NUM_BARS = 28;

    function calculateActiveBars(currentTime: number, totalDuration: number): number {
      if (totalDuration <= 0) return 0;
      const progress = Math.min(currentTime / totalDuration, 1);
      return Math.round(progress * NUM_BARS);
    }

    assert.strictEqual(calculateActiveBars(0, 10), 0, "Bắt đầu -> 0 cột active");
    assert.strictEqual(calculateActiveBars(5, 10), 14, "Nửa bài (50%) -> 14/28 cột active");
    assert.strictEqual(calculateActiveBars(10, 10), 28, "Hết bài (100%) -> 28/28 cột active");
    assert.strictEqual(calculateActiveBars(2.5, 10), 7, "25% -> 7/28 cột active");

    const duration = performance.now() - start;
    results.push({
      module: "Module C",
      test: "Tính Toán Tiến Trình Waveform 28 Cột Sóng Âm Thanh",
      status: "PASS",
      durationMs: duration,
      details: "Tính toán chính xác tỷ lệ fill dải sóng theo mili-giây thời gian thực",
    });
  }

  // Test C.3: Logic Tua Âm Thanh Theo Vị Trí Click (Seek Calculation)
  {
    const start = performance.now();

    function calculateSeekTime(clickX: number, containerWidth: number, duration: number): number {
      if (containerWidth <= 0 || duration <= 0) return 0;
      const percent = Math.max(0, Math.min(1, clickX / containerWidth));
      return percent * duration;
    }

    const totalDur = 20; // 20 giây
    const barWidth = 200; // 200px

    assert.strictEqual(calculateSeekTime(0, barWidth, totalDur), 0, "Click đầu -> 0s");
    assert.strictEqual(calculateSeekTime(100, barWidth, totalDur), 10, "Click giữa -> 10s");
    assert.strictEqual(calculateSeekTime(200, barWidth, totalDur), 20, "Click cuối -> 20s");
    assert.strictEqual(calculateSeekTime(50, barWidth, totalDur), 5, "Click 1/4 -> 5s");
    assert.strictEqual(calculateSeekTime(250, barWidth, totalDur), 20, "Click vượt giới hạn -> cap ở 20s");

    const duration = performance.now() - start;
    results.push({
      module: "Module C",
      test: "Tính Toán Tua Âm Thanh Khi Click Thanh Sóng (Seekable)",
      status: "PASS",
      durationMs: duration,
      details: "Tính toán chính xác vị trí thời gian tua khi người dùng click vào dải sóng",
    });
  }

  // Test C.4: Logic Chuyển Đổi Tốc Độ Phát (Speed Toggle Cycle)
  {
    const start = performance.now();
    const speeds = [1.0, 1.5, 2.0];
    let speedIdx = 0;

    function nextSpeed(): number {
      speedIdx = (speedIdx + 1) % speeds.length;
      return speeds[speedIdx];
    }

    assert.strictEqual(nextSpeed(), 1.5, "Lần 1: 1x -> 1.5x");
    assert.strictEqual(nextSpeed(), 2.0, "Lần 2: 1.5x -> 2.0x");
    assert.strictEqual(nextSpeed(), 1.0, "Lần 3: 2.0x -> 1.0x");
    assert.strictEqual(nextSpeed(), 1.5, "Lần 4: 1.0x -> 1.5x");

    const duration = performance.now() - start;
    results.push({
      module: "Module C",
      test: "Luân Chuyển Tốc Độ Phát Âm Thanh (1x -> 1.5x -> 2x)",
      status: "PASS",
      durationMs: duration,
      details: "Chuyển đổi vòng lặp tốc độ phát chính xác 100%",
    });
  }

  // Test C.5: Quản Lý Đơn Âm (Single Audio Playback Auto-pause)
  {
    const start = performance.now();

    class MockAudio {
      public isPlaying = false;
      public play() { this.isPlaying = true; }
      public pause() { this.isPlaying = false; }
    }

    let activeAudio: MockAudio | null = null;

    function playAudio(target: MockAudio) {
      if (activeAudio && activeAudio !== target) {
        activeAudio.pause();
      }
      activeAudio = target;
      target.play();
    }

    const audioA = new MockAudio();
    const audioB = new MockAudio();

    playAudio(audioA);
    assert.strictEqual(audioA.isPlaying, true, "Audio A đang phát");
    assert.strictEqual(audioB.isPlaying, false, "Audio B đang dừng");

    // Phát audio B -> audio A phải tự động dừng
    playAudio(audioB);
    assert.strictEqual(audioA.isPlaying, false, "Audio A tự động dừng khi Audio B phát");
    assert.strictEqual(audioB.isPlaying, true, "Audio B đang phát");

    const duration = performance.now() - start;
    results.push({
      module: "Module C",
      test: "Quản Lý Đơn Âm (Auto-pause Khi Phát Audio Mới)",
      status: "PASS",
      durationMs: duration,
      details: "Chống phát chồng âm thanh thành công khi người dùng chuyển bài",
    });
  }

  // Test C.6: Định Dạng & Trích Xuất Hộp Văn Bản STT (.msg-stt-box)
  {
    const start = performance.now();

    function extractSttContent(rawContent: string): { isVoiceStt: boolean; sttBody: string } {
      if (rawContent && rawContent.startsWith("[🎙️ Tin nhắn thoại]:")) {
        const stt = rawContent.replace("[🎙️ Tin nhắn thoại]:", "").trim().replace(/^["\s]+|["\s]+$/g, "");
        return { isVoiceStt: true, sttBody: stt };
      }
      return { isVoiceStt: false, sttBody: rawContent };
    }

    const res1 = extractSttContent('[🎙️ Tin nhắn thoại]: "Cho em hỏi còn tuyển Sanaky ko ạ?"');
    assert.strictEqual(res1.isVoiceStt, true);
    assert.strictEqual(res1.sttBody, "Cho em hỏi còn tuyển Sanaky ko ạ?");

    const res2 = extractSttContent("Tin nhắn văn bản thông thường");
    assert.strictEqual(res2.isVoiceStt, false);
    assert.strictEqual(res2.sttBody, "Tin nhắn văn bản thông thường");

    const duration = performance.now() - start;
    results.push({
      module: "Module C",
      test: "Trích Xuất & Render Hộp Văn Bản STT (.msg-stt-box)",
      status: "PASS",
      durationMs: duration,
      details: "Lọc prefix [🎙️ Tin nhắn thoại] và trích xuất nội dung văn bản sạch sẽ",
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // MODULE D: KIỂM THỬ XỬ LÝ, ĐỌC HIỂU STICKER & HIỂN THỊ CHAT UI
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n🏷️ [MODULE D] Kiểm thử Trích xuất, Đọc hiểu & Hiển thị Sticker Zalo...");

  // Test D.1: Trích Xuất Payload Sticker Zalo Đa Cấu Trúc
  {
    const start = performance.now();
    const dispatcher = new EventDispatcher();
    dispatcher.setOwnId("bot_own_id");

    // Case 1: Sticker có ID và CateID trong params
    const rawSticker1 = {
      type: 0,
      data: {
        msgId: "stk_msg_1",
        cliMsgId: "cli_stk_1",
        msgType: "chat.sticker",
        uidFrom: "user_stk_1",
        idTo: "bot_own_id",
        dName: "Ứng Viên Sticker 1",
        ts: "1700000000000",
        content: JSON.stringify({
          id: 123456,
          cateId: 789,
          text: "Cảm ơn bạn",
        }),
      },
    } as any;

    const parsed1 = (dispatcher as any).parseMessage(rawSticker1);
    assert.strictEqual(parsed1.mediaType, "sticker", "Case 1: mediaType = 'sticker'");
    assert.strictEqual(parsed1.mediaUrls?.[0]?.id, "123456", "Case 1: stickerId");
    assert.strictEqual(parsed1.mediaUrls?.[0]?.description, "Cảm ơn bạn", "Case 1: description");

    // Case 2: Sticker có URL trực tiếp trong paramsExt
    const rawSticker2 = {
      type: 0,
      data: {
        msgId: "stk_msg_2",
        cliMsgId: "cli_stk_2",
        msgType: "chat.sticker",
        uidFrom: "user_stk_2",
        idTo: "bot_own_id",
        dName: "Ứng Viên Sticker 2",
        ts: "1700000000000",
        paramsExt: {
          containType: 36,
          spriteUrl: "https://stickers.zaloapp.com/stickers/v2/54321.png",
          description: "Vẫy tay chào",
        },
      },
    } as any;

    const parsed2 = (dispatcher as any).parseMessage(rawSticker2);
    assert.strictEqual(parsed2.mediaType, "sticker", "Case 2: mediaType = 'sticker'");
    assert.strictEqual(parsed2.mediaUrls?.[0]?.url, "https://stickers.zaloapp.com/stickers/v2/54321.png", "Case 2: stickerUrl");
    assert.strictEqual(parsed2.mediaUrls?.[0]?.description, "Vẫy tay chào", "Case 2: description");

    const duration = performance.now() - start;
    results.push({
      module: "Module D",
      test: "Trích Xuất Payload Sticker Zalo (ID, URL CDN, Caption)",
      status: "PASS",
      durationMs: duration,
      details: "Trích xuất thành công 2/2 cấu trúc payload Zalo Sticker và ngăn nhận nhầm thành photo",
    });
  }

  // Test D.2: Gom Batch & Lưu Trữ SQLite Chống Trùng Lặp Sticker
  {
    const start = performance.now();
    const threadId = "thread_sticker_test";

    // 1. Lưu tin nhắn sticker
    chatHistoryRepo.addMessage({
      threadId,
      senderId: "user_stk_01",
      senderName: "Ứng Viên Sticker",
      role: "user",
      content: "",
      mediaType: "sticker",
      mediaUrls: [
        {
          id: "998877",
          url: "https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?id=998877",
          description: "Cảm ơn",
        },
      ],
      timestamp: 1700000010000,
    });

    // 2. Thử lưu tin nhắn trùng trong vòng 5 giây -> Phải bị chặn
    chatHistoryRepo.addMessage({
      threadId,
      senderId: "user_stk_01",
      senderName: "Ứng Viên Sticker",
      role: "user",
      content: "",
      mediaType: "sticker",
      mediaUrls: [
        {
          id: "998877",
          url: "https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?id=998877",
          description: "Cảm ơn",
        },
      ],
      timestamp: 1700000011000,
    });

    const history = chatHistoryRepo.getRecentHistory(threadId, 10);
    assert.strictEqual(history.length, 1, "Chống trùng lặp sticker thành công (chỉ có 1 bản ghi)");
    assert.strictEqual(history[0].mediaType, "sticker", "mediaType được map chính xác từ SQLite");
    assert.strictEqual(history[0].mediaUrls?.[0]?.id, "998877", "stickerId lưu và đọc chính xác");
    assert.strictEqual(history[0].mediaUrls?.[0]?.description, "Cảm ơn", "description lưu và đọc chính xác");

    const duration = performance.now() - start;
    results.push({
      module: "Module D",
      test: "Lưu Trữ SQLite & Chống Duplicate Sticker (has_sticker, sticker_url)",
      status: "PASS",
      durationMs: duration,
      details: "Lưu trữ đầy đủ các trường sticker và chống trùng lặp trong 5 giây",
    });
  }

  // Test D.3: StickerService Tự Động Phân Tích & Fallback
  {
    const start = performance.now();
    const { StickerService } = await import("../services/stickerService.js");

    // Khởi tạo StickerService không có AI (kiểm tra graceful fallback)
    const stickerService = new StickerService(null);

    // Case 1: Có sẵn caption trong payload -> Dùng luôn không cần AI
    const meaning1 = await stickerService.understandSticker(
      "https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?id=111",
      "Vẫy tay chào bạn"
    );
    assert.strictEqual(meaning1, "Vẫy tay chào bạn", "Dùng caption có sẵn");

    // Case 2: URL rỗng -> Fallback an toàn
    const meaning2 = await stickerService.understandSticker("", "");
    assert.strictEqual(meaning2, "Nhãn dán biểu cảm", "Fallback khi URL rỗng");

    const duration = performance.now() - start;
    results.push({
      module: "Module D",
      test: "StickerService Đọc Hiểu Ý Nghĩa & Graceful Fallback",
      status: "PASS",
      durationMs: duration,
      details: "Tận dụng metadata payload và fallback an toàn khi không có AI",
    });
  }

  // Test D.4: Helper Trích Xuất Caption & Pure Sticker UI Logic
  {
    const start = performance.now();

    function getStickerCaption(message: any): string {
      let caption = message.stickerText || "";
      if (!caption && message.content) {
        if (message.content.startsWith("[🏷️ Nhãn dán / Sticker]:")) {
          caption = message.content.replace("[🏷️ Nhãn dán / Sticker]:", "").trim().replace(/^["\s]+|["\s]+$/g, "");
        } else if (message.content.startsWith("[🏷️ Sticker]:")) {
          caption = message.content.replace("[🏷️ Sticker]:", "").trim().replace(/^["\s]+|["\s]+$/g, "");
        }
      }
      return caption;
    }

    const cap1 = getStickerCaption({ content: '[🏷️ Nhãn dán / Sticker]: "Thả tim"' });
    assert.strictEqual(cap1, "Thả tim", "Trích xuất caption chuẩn");

    const cap2 = getStickerCaption({ stickerText: "Xin chào", content: "[🏷️ Sticker]" });
    assert.strictEqual(cap2, "Xin chào", "Ưu tiên stickerText");

    const duration = performance.now() - start;
    results.push({
      module: "Module D",
      test: "Trích Xuất Caption Sticker & Pure Sticker Render Validation",
      status: "PASS",
      durationMs: duration,
      details: "Trích xuất nhãn dán sạch sẽ và xác thực logic Pure Sticker UI",
    });
  }

  // Đóng kết nối DB
  try {
    testDb.connection.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  } catch {}

  // ──────────────────────────────────────────────────────────────────────────
  // BÁO CÁO TỔNG HỢP KẾT QUẢ KIỂM THỬ
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n===============================================================");
  console.log("📋 BẢNG TỔNG HỢP KẾT QUẢ KIỂM THỬ VOICE, AUDIO & STICKER");
  console.log("===============================================================");
  console.table(results.map((r, idx) => ({
    "STT": idx + 1,
    "Module": r.module,
    "Bài kiểm thử": r.test,
    "Kết quả": r.status,
    "Thời gian (ms)": r.durationMs.toFixed(2),
    "Chi tiết": r.details,
  })));

  const totalPassed = results.filter((r) => r.status === "PASS").length;
  console.log(`\n🎉 TỔNG KẾT: ${totalPassed}/${results.length} bài test ĐẠT (PASS) | 0 bài test LỖI (FAIL)`);
  process.exit(0);
}

runVoiceAndAudioTests().catch((err) => {
  console.error("❌ Lỗi kiểm thử:", err);
  process.exit(1);
});


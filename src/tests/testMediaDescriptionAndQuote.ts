import { SQLiteDatabase } from "../database/sqliteDb.js";
import { ChatHistoryRepository } from "../database/repositories/chatHistoryRepository.js";
import fsSync from "node:fs";
import path from "node:path";

async function runTest() {
  console.log("=======================================================================");
  console.log("🧪 KIỂM THỬ: LƯU DESCRIPTION MEDIA VÀ KHÔI PHỤC NGỮ CẢNH KHI QUOTE / REPLY");
  console.log("=======================================================================\n");

  const testDbPath = path.resolve(process.cwd(), "data/test_media_quote.db");
  if (fsSync.existsSync(testDbPath)) {
    fsSync.unlinkSync(testDbPath);
  }

  const db = SQLiteDatabase.getInstance(testDbPath);
  const repo = new ChatHistoryRepository(db);
  const threadId = "test_thread_123";
  const candidateId = "cand_456";

  // 1. Thêm tin nhắn ảnh ban đầu (khi mới nhận)
  const photoMsgId = "msg_photo_001";
  repo.addMessage({
    id: photoMsgId,
    threadId,
    senderId: candidateId,
    senderName: "Nguyễn Văn Test",
    role: "user",
    content: "",
    mediaType: "photo",
    mediaUrls: [{ url: "https://zalo.me/photos/cccd_front.jpg" }],
    timestamp: Date.now() - 60000,
  });

  console.log("✅ 1. Đã lưu tin nhắn ảnh ban đầu.");

  // 2. AI OCR xong -> Cập nhật description chi tiết vào DB
  const cccdDescription = "[Citizen ID Card (CCCD) Document]: Full Name: NGUYEN VAN TEST, ID Number: 079123456789, Gender: Nam, DOB: 01/01/2000, Origin: TP.HCM, Residence: TP.HCM";
  repo.updateMessageContentAndMedia(photoMsgId, cccdDescription, [
    { url: "https://zalo.me/photos/cccd_front.jpg", description: cccdDescription }
  ]);

  const updatedMsg = repo.getMessageById(photoMsgId);
  if (updatedMsg?.content !== cccdDescription) {
    throw new Error(`❌ updateMessageContentAndMedia không khớp! Nhận: ${updatedMsg?.content}`);
  }
  console.log(`✅ 2. Đã cập nhật description vào DB: "${updatedMsg.content}"`);

  // 3. Kiểm tra getRecentHistory trả về description đầy đủ
  const history = repo.getRecentHistory(threadId, 10);
  if (history.length === 0 || !history[0].content.includes("079123456789")) {
    throw new Error(`❌ getRecentHistory không chứa thông tin CCCD!`);
  }
  console.log("✅ 3. getRecentHistory trả về đúng description đầy đủ.");

  // 4. Giả lập người dùng Reply vào tin nhắn ảnh đó
  const quoted = repo.findQuotedMessage(threadId, photoMsgId);
  if (!quoted || quoted.id !== photoMsgId || !quoted.content.includes("NGUYEN VAN TEST")) {
    throw new Error(`❌ findQuotedMessage không tìm được tin nhắn gốc!`);
  }
  console.log(`✅ 4. findQuotedMessage tìm được tin nhắn gốc: "${quoted.content}"`);
  console.log(`   URL ảnh trích dẫn: ${quoted.mediaUrls?.[0]?.url}`);

  // 5. Thêm tin nhắn Reply vào DB
  const replyMsgId = "msg_text_reply_002";
  repo.addMessage({
    id: replyMsgId,
    threadId,
    senderId: candidateId,
    senderName: "Nguyễn Văn Test",
    role: "user",
    content: "Cái này chừng nào được đi làm vậy bạn?",
    hasQuote: true,
    quoteText: quoted.content,
    quoteSenderName: "Nguyễn Văn Test",
    quoteSenderId: candidateId,
    timestamp: Date.now(),
  });

  const replyInDb = repo.getMessageById(replyMsgId);
  if (!replyInDb?.quoteText?.includes("079123456789")) {
    throw new Error(`❌ quoteText trong tin nhắn reply không chứa description CCCD!`);
  }
  // 6. Test kịch bản thực tế: Người dùng gửi ảnh -> chat text nhiều câu -> rồi bấm reply vào ảnh cũ
  const factoryPhotoId = "msg_photo_factory_003";
  const photoTs = Date.now() - 50000;
  repo.addMessage({
    id: factoryPhotoId,
    threadId,
    senderId: candidateId,
    senderName: "Anh Kiệt",
    role: "user",
    content: "[Image Content]: Ảnh chụp ngoại cảnh công ty Minh Nam tại KCN VSIP 2A",
    mediaType: "photo",
    mediaUrls: [{ url: "https://zalo.me/photos/minh_nam.jpg", description: "[Image #1]: Ảnh chụp Minh Nam" }],
    timestamp: photoTs,
  });

  // Tin nhắn văn bản sau đó 1
  repo.addMessage({
    id: "msg_text_004",
    threadId,
    senderId: candidateId,
    senderName: "Anh Kiệt",
    role: "user",
    content: "Tuần sau có tuyển cty này ko",
    timestamp: photoTs + 10000,
  });

  // Tin nhắn văn bản sau đó 2
  repo.addMessage({
    id: "msg_text_005",
    threadId,
    senderId: candidateId,
    senderName: "Anh Kiệt",
    role: "user",
    content: "Sowin thì sao",
    timestamp: photoTs + 25000,
  });

  // Người dùng reply vào ảnh cũ với nội dung "Muốn làm cty này cơ"
  const replyTs = photoTs + 40000;
  const replyPhotoMsgId = "msg_reply_photo_006";
  const foundQuotedPhoto = repo.findQuotedMessage(
    threadId,
    undefined, // Không có ID trực tiếp từ rawQuote
    candidateId,
    undefined,
    replyPhotoMsgId,
    "chat.photo",
    replyTs
  );

  if (!foundQuotedPhoto || foundQuotedPhoto.id !== factoryPhotoId || !foundQuotedPhoto.content.includes("Minh Nam")) {
    throw new Error(`❌ findQuotedMessage không tìm được ảnh Minh Nam! Nhận: ${foundQuotedPhoto?.content}`);
  }
  console.log(`✅ 6. findQuotedMessage tìm chính xác ảnh cũ "Minh Nam" sau 2 lượt chat text.`);

  console.log("\n=======================================================================");
  console.log("🎉 TẤT CẢ CÁC BÀI TEST DESCRIPTION MEDIA & QUOTE REPLY ĐỀU ĐẠT 100%!");
  console.log("=======================================================================\n");

  db.close();
  if (fsSync.existsSync(testDbPath)) {
    fsSync.unlinkSync(testDbPath);
  }
}

runTest().catch((err) => {
  console.error("❌ Test thất bại:", err);
  process.exit(1);
});

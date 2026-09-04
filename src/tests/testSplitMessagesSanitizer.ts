import assert from "node:assert";
import { splitReplyMessages } from "../handlers/directMessageHandler.js";

console.log("=======================================================================");
console.log("🧪 KIỂM THỬ: BỘ PHÂN TÁCH VÀ LÀM SẠCH NHÃN THỜI GIAN & NGƯỜI NÓI (SANITIZER)");
console.log("=======================================================================\n");

// Test 1: Chuỗi lỗi thực tế từ log người dùng
console.log("▶️ Test 1: Chuỗi thực tế từ log người dùng bị dính timestamp và [Recruiter / Bot]:");
const userErrorLog =
  `[10:04:15 Thứ Sáu, 04/09/2026] [Recruiter / Bot]: Dạ khi mình đến cổng công ty sẽ có nhân sự hướng dẫn trực tiếp, trao đổi cụ thể về công việc và nhận việc luôn chứ không phỏng vấn khắt khe gì đâu nha chị Ngọc Bích.[10:04:16 Thứ Sáu, 04/09/2026] [Recruiter / Bot]: Dạ chị gửi giúp em hình chụp 2 mặt Căn cước công dân hoặc VNeID để em đăng ký lịch nhận việc ngày mai cho mình nha chị ơi!`;

const result1 = splitReplyMessages(userErrorLog);
console.log("   Số tin nhắn sau khi tách:", result1.length);
result1.forEach((msg, idx) => console.log(`   [Tin #${idx + 1}]: "${msg}"`));

assert.strictEqual(result1.length, 2, "Phải tách thành đúng 2 tin nhắn");
assert.strictEqual(
  result1[0],
  "Dạ khi mình đến cổng công ty sẽ có nhân sự hướng dẫn trực tiếp, trao đổi cụ thể về công việc và nhận việc luôn chứ không phỏng vấn khắt khe gì đâu nha chị Ngọc Bích.",
  "Tin nhắn 1 phải sạch sẽ 100%, không còn dính timestamp hoặc nhãn [Recruiter / Bot]"
);
assert.strictEqual(
  result1[1],
  "Dạ chị gửi giúp em hình chụp 2 mặt Căn cước công dân hoặc VNeID để em đăng ký lịch nhận việc ngày mai cho mình nha chị ơi!",
  "Tin nhắn 2 phải sạch sẽ 100%, không còn dính timestamp hoặc nhãn [Recruiter / Bot]"
);
console.log("✅ Test 1 PASS: Tách chuẩn 2 tin nhắn và làm sạch hoàn toàn nhãn rò rỉ.\n");

// Test 2: Tin nhắn chỉ có nhãn [Recruiter / Bot]: ở đầu (không có timestamp)
console.log("▶️ Test 2: Tin nhắn chỉ có nhãn [Recruiter / Bot]: ở đầu:");
const labelOnly = "[Recruiter / Bot]: Dạ em chào chị Ngọc Bích, bên em hỗ trợ tư vấn việc làm ạ.";
const result2 = splitReplyMessages(labelOnly);
assert.strictEqual(result2.length, 1);
assert.strictEqual(
  result2[0],
  "Dạ em chào chị Ngọc Bích, bên em hỗ trợ tư vấn việc làm ạ."
);
console.log("✅ Test 2 PASS: Bóc tách thành công nhãn đơn lẻ.\n");

// Test 3: Tin nhắn có nhãn [Bot]: hoặc [Recruiter]:
console.log("▶️ Test 3: Tin nhắn có tiền tố [Bot]: hoặc [Recruiter]:");
const botPrefix = "[Bot]: Công ty Sanaky tuyển nam nữ từ 18 đến 45 tuổi.|||[Recruiter]: Bao cơm giữa ca nha chị.";
const result3 = splitReplyMessages(botPrefix);
assert.strictEqual(result3.length, 2);
assert.strictEqual(result3[0], "Công ty Sanaky tuyển nam nữ từ 18 đến 45 tuổi.");
assert.strictEqual(result3[1], "Bao cơm giữa ca nha chị.");
console.log("✅ Test 3 PASS: Làm sạch tiền tố [Bot]: và [Recruiter]:.\n");

// Test 4: Tin nhắn có thời gian hẹn hợp lệ trong nội dung (ví dụ [10:30] hoặc 10:30)
console.log("▶️ Test 4: Giờ hẹn hợp lệ trong thân tin nhắn không bị xóa nhầm:");
const appointmentMsg = "Dạ em hẹn chị lúc 10:30 ngày mai [10:30] tại cổng công ty Sanaky nha!";
const result4 = splitReplyMessages(appointmentMsg);
assert.strictEqual(result4.length, 1);
assert.strictEqual(result4[0], appointmentMsg);
console.log("✅ Test 4 PASS: Không xóa nhầm giờ hẹn hợp lệ của ứng viên.\n");

// Test 5: Chuỗi chuẩn phân tách ||| kết hợp xuống dòng
console.log("▶️ Test 5: Chuỗi chuẩn ||| bình thường của Gemini:");
const normalGemini = "Dạ em chào anh Kiệt ||| Công ty Sanaky đang tuyển tốt lắm nè anh ||| Lương 250k/ngày nha!";
const result5 = splitReplyMessages(normalGemini);
assert.strictEqual(result5.length, 3);
assert.strictEqual(result5[0], "Dạ em chào anh Kiệt");
assert.strictEqual(result5[1], "Công ty Sanaky đang tuyển tốt lắm nè anh");
assert.strictEqual(result5[2], "Lương 250k/ngày nha!");
console.log("✅ Test 5 PASS: Chuỗi chuẩn ||| tách chuẩn 3 tin nhắn.\n");

console.log("=======================================================================");
console.log("🎉 TẤT CẢ CÁC BÀI KIỂM THỬ SANITIZER ĐỀU ĐẠT 100% (PASS)!");
console.log("=======================================================================");

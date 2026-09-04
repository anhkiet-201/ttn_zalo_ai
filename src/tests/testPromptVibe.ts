import assert from "node:assert";
import { buildSystemInstruction } from "../prompts/systemPrompt.js";

console.log("=======================================================================");
console.log("🧪 KIỂM THỬ: SYSTEM PROMPT - VĂN PHONG NGƯỜI THẬT CHAT ZALO");
console.log("=======================================================================\n");

const prompt = buildSystemInstruction({
  displayName: "Thảo Tuyển Dụng",
  gender: "female",
  age: 23,
});

// 1. Kiểm tra Persona người thật & xưng hô
assert.ok(
  prompt.includes("VĂN PHONG NGƯỜI THẬT CHAT ZALO"),
  "Prompt phải có phần hướng dẫn văn phong người thật chat Zalo"
);
assert.ok(
  prompt.includes("mình"),
  "Prompt phải hướng dẫn cách xưng hô linh hoạt với 'mình'"
);

// 2. Kiểm tra việc xóa bỏ các mẫu câu robot cứng nhắc
assert.ok(
  !prompt.includes("Công ty Sanaky: sản xuất điện gia dụng"),
  "Đã xóa định dạng liệt kê database 'Tên cty: mô tả...'"
);
assert.ok(
  !prompt.includes("hiện bên em đang có các công ty tuyển tốt sau"),
  "Đã xóa câu mở màn trịnh trọng kiểu sách giáo khoa"
);
assert.ok(
  !prompt.includes("Dạ em đăng ký lịch hẹn 19h20 tối nay Thứ Năm"),
  "Đã xóa câu chốt hẹn đọc cả ngày tháng năm máy móc"
);

// 3. Kiểm tra các ví dụ đời thường (theo ảnh chụp thực tế của user)
assert.ok(
  prompt.includes("Vậy em hẹn mình qua lễ nha") || prompt.includes("Dạ vậy em hẹn mình qua lễ nha"),
  "Prompt phải có ví dụ hẹn qua lễ tự nhiên giống ảnh chụp Zalo thực tế"
);
assert.ok(
  prompt.includes("4/9 cty nhận lại"),
  "Prompt phải có ví dụ ngày cty nhận lại như ảnh chụp Zalo thực tế"
);
assert.ok(
  prompt.includes("cty") && prompt.includes("ko") && prompt.includes("nhen"),
  "Prompt phải khuyến khích trợ từ và từ ngữ chat Zalo đời thường"
);

console.log("✅ Tất cả các tiêu chuẩn kiểm tra văn phong người thật trong systemPrompt.ts đều ĐẠT (PASS)!");

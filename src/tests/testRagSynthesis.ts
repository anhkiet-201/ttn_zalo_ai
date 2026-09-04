import { consolidateJobRawContent, RAGService } from "../services/ragService.js";

function runTests() {
  console.log("🧪 [TEST 1] Kết hợp tin SOWIN hiện tại với cập nhật mới tối nay");

  const currentSowinRaw =
    `📢 SOWIN GROUP (SX LY GIẤY) - Đối diện KCN Đồng An 2, Bình Dương (HIỆN TẠI TẠM NGƯNG TUYỂN)\n` +
    `📍 Bản đồ/Vị trí: https://maps.app.goo.gl/Ysex64GohN4ZS6iM6\n` +
    `👥 Số lượng cần tuyển: 0 người (Tạm ngưng tuyển)\n` +
    `⏰ Lịch hẹn: Cổng công ty 7h30 sáng\n` +
    `💳 LƯƠNG TUẦN: Lương ngày: 255k/8h (tăng ca 40k/h) | Lương đêm: 320k/8h (tăng ca 40k/h)\n` +
    `🍚 Công ty bao cơm, môi trường thoáng mát ổn định.`;

  const newUpdateText =
    `Lao động nhân viên có mã số thẻ rồi mà nghỉ xin vào lại sẽ không nhận được. Nếu chưa xuống sản xuất chưa có mã số thẻ thì nhận lại bình thường.\n` +
    `Tối nay nhận. Hẹn lao động 19:20 mang theo CCCD photo hoặc CCCD gốc/VNeID, mang dép bít mũi hoặc giày.`;

  const updatedFields = {
    vacancies: 30,
    interview_schedule: "Cổng công ty 19:20 tối nay (mang CCCD photo, dép bít mũi hoặc giày)",
  };

  const synthesized = consolidateJobRawContent(currentSowinRaw, newUpdateText, updatedFields);

  console.log("--- KẾT QUẢ TỔNG HỢP ---");
  console.log(synthesized);
  console.log("-----------------------");

  // Kiểm tra các điều kiện bắt buộc:
  if (synthesized.includes("[Cập nhật]:")) {
    throw new Error("❌ Thất bại: Vẫn còn tiền tố '[Cập nhật]:'!");
  }
  if (synthesized.includes("(HIỆN TẠI TẠM NGƯNG TUYỂN)")) {
    throw new Error("❌ Thất bại: Vẫn còn nhãn tạm ngưng tuyển!");
  }
  if (!synthesized.includes("https://maps.app.goo.gl/Ysex64GohN4ZS6iM6")) {
    throw new Error("❌ Thất bại: Đã làm mất link Google Maps!");
  }
  if (!synthesized.includes("255k/8h")) {
    throw new Error("❌ Thất bại: Đã làm mất thông tin lương!");
  }
  if (!synthesized.includes("19:20")) {
    throw new Error("❌ Thất bại: Chưa cập nhật lịch hẹn mới 19:20!");
  }
  if (!synthesized.includes("mã số thẻ")) {
    throw new Error("❌ Thất bại: Chưa bổ sung lưu ý mã số thẻ!");
  }

  console.log("✅ [TEST 1 PASSED] Hợp nhất tin tuyển dụng SOWIN hoàn hảo, không có [Cập nhật]:!");

  console.log("\n🧪 [TEST 2] Cập nhật liên tiếp 3 lần không bị nhân bản text");
  const step1 = consolidateJobRawContent(currentSowinRaw, "Cập nhật lần 1", { vacancies: 10, interview_schedule: "19h20" });
  const step2 = consolidateJobRawContent(step1, "Cập nhật lần 2", { vacancies: 15, interview_schedule: "19h20" });
  const step3 = consolidateJobRawContent(step2, "Cập nhật lần 3", { vacancies: 20, interview_schedule: "19h20" });

  const updatePrefixCount = (step3.match(/\[Cập nhật\]:/g) || []).length;
  if (updatePrefixCount > 0) {
    throw new Error(`❌ Thất bại: Có ${updatePrefixCount} chuỗi [Cập nhật]: sau 3 lần cập nhật!`);
  }
  console.log("✅ [TEST 2 PASSED] Cập nhật liên tiếp 3 lần không bị nhân bản chuỗi!");

  console.log("\n🧪 [TEST 3] Kiểm tra phương thức getEntryById của RAGService");
  const ragService = RAGService.getInstance();
  const entry = ragService.getEntryById("job_rag", "job_14");
  if (!entry) {
    throw new Error("❌ Thất bại: Không tìm thấy job_14 bằng getEntryById!");
  }
  if (entry.id !== "job_14") {
    throw new Error("❌ Thất bại: ID không khớp!");
  }
  console.log(`✅ [TEST 3 PASSED] getEntryById tìm thấy "${entry.title}"`);

  console.log("\n🧪 [TEST 4] Kiểm tra tin nhắn điểm danh Sowin không làm mất bài viết tuyển dụng cũ");
  const sowinAttendanceText =
    "Tên công ty: Sowin\nSố lượng tuyển hôm nay: 11 người.\nSố lượng cần tuyển: 8 người.\nSố đang làm việc: 32 người.";
  const sowinAttendanceFields = { vacancies: 8 };
  const sowinSynthesized = consolidateJobRawContent(currentSowinRaw, sowinAttendanceText, sowinAttendanceFields);

  if (!sowinSynthesized.includes("255k/8h")) {
    throw new Error("❌ Thất bại: Tin nhắn điểm danh làm mất thông tin lương!");
  }
  if (!sowinSynthesized.includes("https://maps.app.goo.gl/Ysex64GohN4ZS6iM6")) {
    throw new Error("❌ Thất bại: Tin nhắn điểm danh làm mất link Google Maps!");
  }
  if (!sowinSynthesized.includes("Số lượng cần tuyển: 8 người (Đang tuyển)")) {
    throw new Error("❌ Thất bại: Chưa cập nhật đúng số lượng 8 người đang tuyển!");
  }
  if (sowinSynthesized.length < 200) {
    throw new Error("❌ Thất bại: Bài viết bị thu nhỏ quá mức (bị ghi đè bằng tin điểm danh)!");
  }
  console.log("✅ [TEST 4 PASSED] Tin nhắn điểm danh kết hợp hoàn hảo với bài cũ, không mất thông tin lương/bản đồ!");

  console.log("\n🧪 [TEST 5] Kiểm tra Directory Index chứa đầy đủ Aliases của Sowin (job_14)");
  const dirIndex = ragService.buildDirectoryIndex();
  if (!dirIndex.includes("job_14") || !dirIndex.includes("sowin")) {
    throw new Error(`❌ Thất bại: Directory Index không chứa ID job_14 hoặc alias 'sowin'!`);
  }
  console.log(`✅ [TEST 5 PASSED] Directory Index có đầy đủ ID job_14 và Aliases cho AI đối chiếu!`);

  console.log("\n🎉 TẤT CẢ TEST CASES ĐÃ VƯỢT QUA THÀNH CÔNG!");
  ragService.destroy();
  process.exit(0);
}

runTests();

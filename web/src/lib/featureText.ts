// Detection and assistance features in plain words; the server key only shows as a tooltip.

export const FEATURE_GROUPS: { title: string; keys: string[] }[] = [
  { title: "Phát hiện đụng nhau", keys: ["detect.l0_path", "detect.l1_merge", "detect.l2_symbol", "detect.l3_semantic"] },
  { title: "Đăng ký việc", keys: ["registration", "registration.auto_from_plan", "drift_check", "policy.ask", "coord.priority"] },
  { title: "Hỏi đáp", keys: ["qa.tier1_answer", "qa.tier2_relay", "qa.tier3_human"] },
  { title: "Tri thức và hệ thống", keys: ["knowledge.code_graph", "knowledge.doc_kb", "brain.summary", "brain.suggest", "notify.desktop", "brain"] },
];

export const FEATURE_TEXT: Record<string, { t: string; s: string }> = {
  "detect.l0_path": { t: "Cùng file hoặc cùng phạm vi", s: "So đăng ký việc và file từng agent đã sửa" },
  "detect.l1_merge": { t: "Thử gộp code đang làm dở", s: "Chạy git merge trên bản lưu tạm của mỗi người" },
  "detect.l2_symbol": { t: "Đổi hàm mà người khác đang dùng", s: "So chữ ký hàm, lớp giữa các bản đang làm" },
  "detect.l3_semantic": { t: "AI so mục tiêu hai việc", s: "Bắt hai việc mâu thuẫn dù khác file. Cần AI trả lời" },
  registration: { t: "Agent đăng ký việc trước khi sửa", s: "Nền của mọi phần khác" },
  "registration.auto_from_plan": { t: "Tự đăng ký việc từ kế hoạch của agent", s: "Khi agent quên đăng ký. Cần AI trả lời" },
  drift_check: { t: "Báo khi agent sửa ra ngoài phạm vi đã đăng ký", s: "" },
  "policy.ask": { t: "Bắt agent hỏi lại trước khi sửa chỗ đang đụng nặng", s: "Áp dụng cho mức cao và nghiêm trọng" },
  "coord.priority": { t: "Nhường theo độ ưu tiên", s: "Lời báo đụng nhau kèm ưu tiên, hạn của hai việc và khuyên bên ít gấp hơn nhường" },
  "qa.tier1_answer": { t: "AI tự trả lời câu hỏi của agent", s: "Dựa trên code, tài liệu và việc của cả nhóm" },
  "qa.tier2_relay": { t: "Chuyển câu hỏi tới agent của đồng đội", s: "Khi AI không đủ căn cứ" },
  "qa.tier3_human": { t: "Hỏi người khi các agent không tự quyết được", s: "Câu hỏi hiện ở Cần xử lý" },
  "knowledge.code_graph": { t: "Chỉ mục code: hàm, lớp, ai gọi ai", s: "Dùng để bắt việc đổi hàm người khác đang dùng" },
  "knowledge.doc_kb": { t: "Tìm trong tài liệu và hỏi đáp", s: "" },
  "brain.summary": { t: "AI tóm tắt trao đổi và tóm tắt ngày", s: "Tối đa 80 lượt mỗi ngày" },
  "brain.suggest": { t: "AI soạn hướng xử lý khi hai người đụng nhau", s: "2–3 phương án cho mỗi vụ, và viết lại khi được yêu cầu" },
  "notify.desktop": { t: "Thông báo trên máy của developer", s: "" },
  brain: { t: "AI trả lời", s: "Tắt thì mọi phần cần AI cũng tắt" },
};

/** Presets: one click sets the features that decide how much gtv steps in. */
export const PRESETS = {
  watch: { label: "Chỉ quan sát", text: "Ghi lại mọi thứ lên dashboard, không chen vào agent.", set: { "policy.ask": "off", "notify.desktop": "off" } },
  balanced: { label: "Cân bằng", text: "Báo cho agent khi đụng nhau. Bắt hỏi lại ở mức cao.", set: { "policy.ask": null, "notify.desktop": null } },
} as const;

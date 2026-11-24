# Việc để sau

Những ý đã bàn nhưng chưa làm. Ghi kèm lý do và chỗ trong code để người làm sau khỏi phải tìm lại từ đầu.
Làm xong mục nào thì xoá khỏi đây và ghi vào commit.

## Đã làm (24/11/2026), để tham chiếu

- **Dashboard (UI)**: cột giờ ở feed, render markdown cho tài liệu, ô trống bị dính chữ, chip file bị cắt chữ, nhãn trên sơ đồ code, layout lệch do thanh cuộn, sidebar nhấp nháy khi tải trang, khung Trao đổi có hai thanh cuộn, nhãn tiếng Việt cho mọi loại conflict, avatar 2 chữ cái, trang Brain gập phần thêm provider, biểu đồ toàn số 0, số liệu kỹ thuật theo khoảng ngày đang chọn.
- **Một nguồn cho Việc**:
  - Mọi lần đăng ký đều nằm trên một Việc của bảng (`board_tasks`).
  - Phiên agent mới trong cùng checkout làm tiếp Việc còn dở của dev thay vì tạo Việc trùng (`Board.resolveFor`).
  - Đăng ký cũ chưa có Việc được gắn một lần khi server khởi động (`Board.adoptOrphans`).
  - Thành viên được thêm ở mọi chỗ có người làm (`Store.ensureMember`, `backfillMembers`).
  - Mọi lời gọi tool của agent đều làm mới `last_seen`.
  - "Đang làm" có một định nghĩa dùng chung (`summarize`, cờ `working`).
  - Briefing nhắc các Việc còn dở của dev.

## Dữ liệu từ agent còn thô (loại 2)

Gốc vấn đề:

- Server ghép sẵn câu tiếng Anh, ví dụ `conflicts.message` ở `src/server/detect/l0.ts`, `l1.ts`, `l2.ts`; ghi chú hệ thống trong `board.ts`; tin nhắn trong `engine.ts` và `tickets.ts`.
- `truncate()` (`src/shared/util.ts`) cắt cứng câu hỏi thành tiêu đề tài liệu Hỏi đáp, sinh ra "… (N more chars)".
- Brain chưa có bước tóm tắt nào.

Thứ tự đề xuất:

1. **Lưu dữ liệu có cấu trúc, UI tự dựng câu.**
   - Conflict, sự kiện board và L0–L2 lưu `{kind, dev_a, dev_b, subject, task_a, task_b}`. Web dựng câu tiếng Việt từ đó. Câu tiếng Anh vẫn giữ cho agent đọc.
   - Bỏ cắt cứng: lưu nguyên văn bản, UI tự rút gọn và có nút xem đủ.
   - `board_update.changes` đang là câu tiếng Anh; nên lưu dạng `{field, from, to}`.
2. **Gom nhóm khi hiển thị.**
   - Feed gom theo cặp người hoặc theo task, ví dụ "hien ↔ khanh đụng 3 file, 1 symbol ▸". Mặc định chỉ hiện dòng tóm tắt, bấm vào mới xem chi tiết.
3. **Ngôn ngữ của nhóm trong charter.** Server đưa vào briefing để agent viết tiêu đề, log và câu hỏi bằng ngôn ngữ đó. Không cần sửa skill.
4. **Brain tóm tắt (job `digest`).**
   - Chỉ dùng cho văn bản tự do còn dài: câu hỏi, câu trả lời, lý do L3.
   - Trả về `{headline, cần_ai_làm_gì, chi_tiết}`, chạy khi thread hoặc ticket đóng lại, có trần ngân sách theo ngày như `l3.daily_budget`.
   - Brain tắt thì hiện bản gốc.
   - Có thể làm thêm bản tóm tắt cuối ngày cho lead.
   - Chỉ thử vài lượt chạy LLM thật.
5. **Chỉ khi các bước trên chưa đủ:** thêm trường bắt buộc vào MCP tool, ví dụ `summary` cho `gtv_ask`, `type` (progress / decision / blocker) cho `gtv_log_work`.
   - Việc này đòi sửa `src/daemon/mcp.ts`, `tools.ts` và SKILL.md, rồi publish bản npm mới.
   - Dev cập nhật bằng `npx guide-the-vibe@latest install` trong từng repo và mở phiên agent mới.
   - Đã quyết định **không** làm cơ chế tự cập nhật skill.

## Một nguồn cho Việc: phần còn lại

- **Việc im lặng:** Việc `in_progress` không có phiên nào hoạt động trong N ngày (ví dụ 2) nên vào "Cần xử lý" (loại `stale`), kèm nút "Trả về To do" cho lead.
- **Cột "Ai đang làm gì"** vẫn đọc theo `tasks` và hiện cả đăng ký đã im lặng 18 ngày. Nên làm mờ hoặc tách nhóm "im lặng" theo `last_seen` của phiên, và thêm chấm online / im lặng / offline cạnh tên.
- **Giới hạn của cách làm tiếp Việc cũ:** chỉ gắn khi phiên cũ đã hết hoạt động và cùng checkout (repo@nhánh). Nếu dev bắt đầu một việc khác trên cùng nhánh mà không xong việc cũ, việc mới sẽ bị gắn nhầm vào Việc cũ. Agent thấy Việc được gắn trong phản hồi đăng ký. Có thể thêm so khớp tiêu đề, hoặc để lead tách Việc trên dashboard.
- **`gtv_tasks`** chưa chia nhóm (đang dở của bạn / giao cho bạn / chưa ai nhận). Muốn chia thì phải sửa định dạng ở `src/daemon/tools.ts`, tức là sửa CLI. Hiện briefing đã bù phần "đang dở".

## Dashboard: phần còn lại

- Chưa kiểm tra bản mobile: chưa có máy hay cửa sổ nào thu nhỏ được để xem. Có sẵn breakpoint 560, 720, 860–1180px.
- Trang Tổng quan có nhiều khoảng trống khi chỉ có 1–2 project.
- Một số thuật ngữ vẫn bằng tiếng Anh ("Projects", "Developers", "Conflict"). Cần chốt giữ hay dịch.
- Khung Trao đổi tính chiều cao theo `100dvh - 250px`. Khi có thông báo lỗi đồng bộ ở đầu trang, trang vẫn cuộn thêm khoảng 100px.
- Playwright MCP trong máy chưa dùng được (thiếu Chrome: `npx playwright install chrome`).

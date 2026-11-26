# Feature và layer

Định nghĩa: `src/shared/features.ts`. Mỗi feature có mode `off | shadow | on` (xem [architecture.md](architecture.md#feature-mode-và-cầu-dao)).
Đổi mode: dashboard (**Khác › Lớp phát hiện**), `gtv features set <key> <mode|default>`, `PUT /v1/p/:id/features`, hoặc `features:` trong `docker/gtv.config.yml` (áp cho mọi project).

| Key                           | Mặc định                   | Cần                    | Metric trên dashboard                 |
| ----------------------------- | -------------------------- | ---------------------- | ------------------------------------- |
| `registration`                | on                         |                        | `tasks`                               |
| `registration.auto_from_plan` | shadow                     | `brain`                |                                       |
| `drift_check`                 | on                         |                        | `drift_events`                        |
| `detect.l0_path`              | on                         |                        | `open`, `total`, `shadow_detections`  |
| `detect.l1_merge`             | on                         |                        | như trên                              |
| `detect.l2_symbol`            | on                         | `knowledge.code_graph` | như trên                              |
| `detect.l3_semantic`          | shadow (docker config: on) | `brain`                | như trên                              |
| `knowledge.code_graph`        | on                         |                        | `files`, `symbols`, `refs` (lớp base) |
| `knowledge.doc_kb`            | on                         |                        | `documents`                           |
| `qa.tier1_answer`             | on                         | `brain`                | `tickets` (bậc 1)                     |
| `qa.tier2_relay`              | on                         |                        | `tickets` (bậc 2)                     |
| `qa.tier3_human`              | on                         |                        | `tickets` (bậc 3)                     |
| `policy.ask`                  | on                         |                        |                                       |
| `coord.priority`              | on                         |                        |                                       |
| `notify.desktop`              | on                         |                        |                                       |
| `brain.summary`               | on                         | `brain`                | `summaries` (bảng cùng tên)           |
| `brain`                       | on                         |                        | — (off khi `BRAIN_BACKEND=null`)      |

## Đăng ký task

- **registration** — `POST /tasks`: lưu task (session mới đăng ký ⇒ task cũ thành `abandoned`), chạy L0, trả overlap + KB + lời khuyên L3. Daemon nhắc "chưa đăng ký" một lần mỗi session.
- **registration.auto_from_plan** — khi agent kết thúc plan (Claude `ExitPlanMode`, Codex `update_plan`): Brain chuyển plan thành đăng ký (`INTENT_SCHEMA`). `shadow` = chỉ ghi `plan_intent`; `on` = đăng ký thật và báo agent. **Tốn 1 lượt Brain mỗi plan.**
- **drift_check** — sửa file ngoài các `path` đã đăng ký ⇒ ghi `drift`, `on` thì gửi tin nhắc `gtv_update_task` (mỗi file một lần).

## Phát hiện conflict

| Mức                                                  | Agent                                                                      | Người                      |
| ---------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------- |
| info                                                 | không chèn                                                                 | thấy trên status/dashboard |
| warning                                              | chèn context 1 lần                                                         | statusline                 |
| high                                                 | Claude: `ask`; agent không có ask: `deny` **lần đầu**, thử lại thì cho qua | thông báo desktop          |
| critical                                             | `ask` / `deny` cho tới khi ack                                             | thông báo desktop          |
| (`policy.ask` ≠ `on` ⇒ không ask/deny, chỉ context.) |

### L0 — `detect.l0_path` (`src/server/detect/l0.ts`)

So từng cặp workspace đang hoạt động:

| kind                      | Khi nào                                                           | Mức                                             |
| ------------------------- | ----------------------------------------------------------------- | ----------------------------------------------- |
| `same_file`               | cả hai đang sửa cùng file                                         | warning                                         |
| `edit_in_scope`           | A sửa file nằm trong scope `path` đã đăng ký của B                | warning                                         |
| `scope_overlap`           | hai glob đăng ký chồng nhau                                       | info                                            |
| `same_symbol_declared`    | cùng khai báo một symbol                                          | warning; high nếu có `sig_change/rename/delete` |
| `planned_breaking_change` | A định đổi/xóa symbol mà dòng B **đã viết** đang dùng (qua graph) | high (warning nếu chỉ khớp tên)                 |
| `same_contract`           | cùng contract, có bên sửa                                         | high                                            |
| `critical_path`           | cả hai chạm glob trong `policy.critical_paths`                    | critical                                        |
| `same_module`             | khác file cùng module (2 thư mục đầu hoặc `policy.modules`)       | info                                            |

Giới hạn: glob–glob khi một bên không có tiền tố tĩnh (vd `**/migrations/**`) được so bằng đường dẫn mẫu ⇒ có thể bỏ sót chồng lấn hiếm, không báo nhầm.

### L1 — `detect.l1_merge` (`src/server/detect/l1.ts`)

`git merge-tree --write-tree --name-only -z` giữa snapshot của mọi cặp workspace và giữa snapshot với `main` (kind `main`, warning, chỉ báo cho chủ snapshot). Dựa vào exit code (0 sạch, 1 conflict). Kết quả cache theo cặp sha.
Giới hạn: chỉ thấy code đã được snapshot (daemon gửi khi agent Stop, hoặc 5 phút sau lần sửa cuối; agent không có hook ⇒ không có snapshot).

### L2 — `detect.l2_symbol` (`src/server/detect/l2.ts`, `src/codeintel/*`)

1. Khi có snapshot: so symbol tại merge-base với snapshot (`diffSymbols`) → `sig_changed`, `renamed` (cùng body hash), `deleted`, `body_changed`; lưu `symbol_changes` và các dòng workspace đã thêm/sửa (`wip_lines` từ `git diff -U0`).
2. Mỗi cặp A–B: thay đổi phá vỡ (`sig_changed/renamed/deleted`) của A × tham chiếu tới symbol đó **trong các dòng B đã viết** → `breaking_change_used` (high nếu confidence `local/import`, warning nếu chỉ `name`). Cả hai sửa cùng symbol → `same_symbol_changed`.
   Giới hạn: phân giải theo tên + import (không có type checker); dynamic dispatch, re-export, overload, DI có thể sai; L2 không biết B đã sửa lời gọi cho đúng chữ ký mới ⇒ cần `ack`.

### L3 — `detect.l3_semantic` (`judgeRegistration` trong `src/server/project/engine.ts`)

Khi đăng ký task và có task khác đang chạy: Brain nhận task mới, các task khác, bằng chứng L0–L2 → `overlaps[{task_id, level, reason, suggestion}]` + `advice`. Ngân sách `l3.daily_budget` job/ngày. Conflict L3 tự đóng khi task kết thúc.
Giới hạn: tốn 1 lượt Brain mỗi lần đăng ký; chất lượng phụ thuộc model.

## Tri thức

- **knowledge.code_graph** — tree-sitter cho TS/TSX, JS, Python, Go, Java; bỏ `node_modules`, `vendor`, `dist`, `build`, … và file > 512 KB. Lớp `base` theo `main`, lớp phủ = file của snapshot khác `main` (+ tombstone). Chỉ index lại file đổi blob.
- **knowledge.doc_kb** — markdown trên `main` khớp `knowledge.doc_globs` (mặc định `docs/**/*.md`, `*.md`, `.gtv/knowledge/**/*.md`, `adr/**/*.md`); front-matter `type`, `status`, `supersedes`; chia theo heading; FTS5 (`unicode61 remove_diacritics`). Q&A từ ticket là `unverified` cho tới khi `confirm`.

## Hỏi đáp

- **qa.tier1_answer** — Brain trả lời (`ANSWER_SCHEMA`). `confidence: low` không được coi là câu trả lời. `shadow` = chạy Brain, ghi log, nhưng chuyển tiếp như chưa trả lời.
- **qa.tier2_relay** — chuyển câu hỏi vào agent của `forward_to_dev` (message `ticket_question`).
- **qa.tier3_human** — `escalate` hoặc quá `qa.tier2_timeout_min` ⇒ hỏi người (`human_request`, thông báo desktop, `gtv answer`); quá `qa.tier3_timeout_h` ⇒ `expired`.

## Tin nhắn có cấu trúc và tóm tắt

- Agent gửi lên có trường riêng để dashboard hiển thị gọn: `gtv_log_work` có `kind` (progress / decision / blocker / question) và `summary` một dòng, `gtv_ask` có `options` (người quyết bấm chọn trên dashboard), `gtv_finish_task` có `summary` (thành thẻ "Hoàn thành" trong nhật ký việc). Agent cũ không gửi các trường này thì server lấy câu đầu làm một dòng.
- Ngôn ngữ của nhóm (`charter.language`, mặc định tiếng Việt) nằm trong briefing: agent viết tiêu đề, ghi chú, câu hỏi và tóm tắt bằng ngôn ngữ đó.
- **brain.summary** — Brain viết một câu (kèm tối đa 5 ý) cho mỗi cuộc trao đổi đã có kết quả và một bản tóm tắt trong ngày. Chạy nền, lưu trong bảng `summaries`, chỉ viết lại khi nội dung đổi, tối đa 80 lần/ngày. Tắt thì dashboard vẫn đủ nhờ các trường có cấu trúc.

## Góc nhìn manager (v0.8, SPEC mục 25)

- **Tài khoản và role** (`src/server/hub/accounts.ts`) — `admin` / `manager` / `viewer` đăng nhập bằng tên + mật khẩu (trang **Tài khoản**, chỉ admin). **Link xem chỉ đọc** cho một project (Cài đặt › Link xem chỉ đọc) để trình bày cho người ngoài nhóm. Bảng quyền: [api.md](api.md#tài-khoản-dashboard-và-role-v08).
- **Thành viên** (**Khác › Thành viên**) — dev tự thành thành viên khi mở agent lần đầu; manager đặt vai trò (backend, tech lead, …) và level (`intern` < `junior` < `mid` < `senior` < `lead`). Agent thấy danh sách nhóm trong briefing.
- **Tiêu chí project** (dải đầu trang Tổng quan, bấm _Chi tiết_ để xem mốc và ràng buộc) — mục tiêu, người dùng, hạn chót, mức chất lượng, công nghệ, mốc, ràng buộc, ngoài phạm vi. Đưa vào briefing, `gtv_status`, prompt trả lời câu hỏi và prompt L3 (`charterText` trong `src/shared/types.ts`).
- **Bảng việc** (tab **Việc**, `src/server/project/board.ts`) — việc có ưu tiên (`urgent/high/normal/low`), hạn, ước lượng, người nhận; giao việc ⇒ agent của người nhận có tin. Agent: `gtv_tasks`, `gtv_pick_task`, `gtv_log_work`, skill `/gtv` (Codex: `$gtv`). Đăng ký nối vào việc đã nhận, không có thì tự tạo việc. Trạng thái: đăng ký → _Đang làm_; conflict high/critical chưa ack → _Bị chặn_; `gtv_finish_task` → _Chờ merge_; code vào main → _Xong_. Mọi thay đổi ghi vào nhật ký của việc.
- **coord.priority** (`src/server/project/coord.ts`) — tin conflict gửi mỗi bên kèm việc của hai bên (ưu tiên, hạn, vai trò, level) và lời khuyên: bên đứng sau (ưu tiên thấp hơn → hạn muộn hơn → level thấp hơn) tạm dừng phần đụng nhau hoặc tìm workaround và hỏi bên kia; bên đứng trước tiếp tục nhưng báo trước khi đổi thứ người kia dùng. Câu hỏi chuyển tiếp ghi việc người hỏi đang làm. **Chỉ là lời khuyên**: không dừng agent nào, high/critical vẫn hỏi người. `shadow` = ghi `priority_advice` vào log, không chèn vào tin.
- **Trao đổi** (tab **Trao đổi**, số trên tab = câu hỏi chờ người, `src/server/project/conversations.ts`) — mọi tin vào agent gom thành luồng chat: câu hỏi → chuyển tiếp → trả lời; conflict → tin mỗi bên → ack; giao việc; ghi chú của lead. Manager nhắn thẳng vào agent của người trong luồng.
- **Cần xử lý** (trang Tổng quan) — conflict high/critical chưa ack, câu hỏi chờ người, câu hỏi chuyển tiếp quá 15 phút chưa ai trả lời, việc quá hạn, bị chặn, việc gấp chưa ai nhận.
- **Trang project cho lead** — hàng tab chỉ giữ thứ lead xem hằng ngày: _Tổng quan_ (5 ô số liệu, Cần xử lý, tiến độ, mỗi phiên agent một hàng: avatar + logo agent, file đang sửa, đụng ai), _Việc_, _Trao đổi_, _Conflict_, _Thống kê_. Phần còn lại nằm trong menu **Khác**: Thành viên, Tài liệu, Nhật ký hỏi đáp, Sơ đồ code, Lớp phát hiện, Cài đặt.
- **Thống kê** (tab **Thống kê**) — tính từ bảng việc, chọn 7/14/30 ngày: tỉ lệ hoàn thành, số việc xong trong kỳ (so với kỳ trước), thời gian làm (trung vị từ lúc bắt đầu tới lúc xong), quá hạn, bị chặn; biểu đồ việc còn lại theo ngày, việc xong mỗi ngày, trạng thái việc theo từng người, việc sắp tới hạn. Số liệu kỹ thuật (Brain, conflict theo layer, hỏi đáp, tài liệu, sự kiện) gập trong mục _Số liệu kỹ thuật_.

- **Tài liệu dự án** (**Khác › Tài liệu**) — kéo thả nhiều file chữ (markdown, txt, JSON, YAML, CSV; Word/PDF cần lưu thành chữ trước) hoặc viết trực tiếp; loại: yêu cầu, nghiệp vụ, quyết định, hướng dẫn, thuật ngữ. Manager sửa / xoá tài liệu tải lên; tài liệu từ repo chỉ đổi loại và dấu cốt lõi (nội dung theo git). **Tài liệu cốt lõi**: nội dung (tối đa ~8 000 ký tự, phần còn lại đọc bằng `kb_get`) nằm trong mọi prompt trả lời và đánh giá đăng ký của Operator, với chỉ dẫn dựa vào đó thay vì chuyển câu hỏi cho người; agent thấy tên trong briefing và đọc bằng `gtv_docs`.
- **Sơ đồ code** (**Khác › Sơ đồ code**, `src/codeintel/map.ts`) — ba chế độ: _Module_ (thư mục, tự chọn độ sâu để còn ≤ ~40 nút; mũi tên = số import), _File_ (tối đa 150 file nhiều liên kết nhất, hoặc một module và các file nối trực tiếp với nó), _Gọi hàm_ (nơi gọi ← hàm → những gì nó gọi; nét đứt = chỉ khớp tên). Vòng màu cho biết ai đang sửa (xanh), đã đăng ký (vàng), có conflict (đỏ). Import ra ngoài repo (package) không vẽ. Phân giải import theo đường dẫn như L2: alias kiểu tsconfig `paths` chỉ đoán theo đuôi đường dẫn.

Xem thử với dữ liệu mẫu (không gọi LLM): `npm run demo` → `http://localhost:7395`.

## Hệ thống

- **policy.ask** — cho phép hook trả `ask`/`deny` ở mức high/critical.
- **notify.desktop** — daemon bật thông báo hệ điều hành cho `human_request` và conflict HIGH/CRITICAL (Windows balloon, macOS `osascript`, Linux `notify-send`).
- **brain** — tắt mọi tính năng cần LLM.

## Khả năng theo agent

|                        | Claude Code      | Codex           | Cursor / Grok     |
| ---------------------- | ---------------- | --------------- | ----------------- |
| `ask` khi sửa          | ✅               | ❌ → deny 1 lần | ❌                |
| Chèn context giữa lượt | ✅               | ✅              | Cursor chỉ ở post |
| Đánh thức khi rảnh     | ✅ `asyncRewake` | ❌              | ❌                |

Adapter Cursor/Grok chưa làm (xem [agents.md](agents.md)).

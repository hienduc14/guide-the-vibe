# Feature và layer

Định nghĩa: `src/shared/features.ts`. Mỗi feature có mode `off | shadow | on` (xem [architecture.md](architecture.md#feature-mode-và-cầu-dao)).
Đổi mode: dashboard (tab **Layers**), `gtv features set <key> <mode|default>`, `PUT /v1/p/:id/features`, hoặc `features:` trong `docker/gtv.config.yml` (áp cho mọi project).

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
| `notify.desktop`              | on                         |                        |                                       |
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
Giới hạn: chỉ thấy code đã được snapshot (daemon debounce 20 s; agent không có hook ⇒ không có snapshot).

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

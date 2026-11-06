# API

Server mặc định `http://127.0.0.1:7390` (`GTV_PORT`). Lỗi trả `{"error": "..."}` (400; `unknown project` → 404; thiếu quyền → 401).
Kiểu dữ liệu chung: `src/shared/types.ts`. Dashboard sao chép ở `web/src/api/types.ts`.

## Xác thực

| Vùng          | Header                                    | Ghi chú                                                                                       |
| ------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| `/v1/*`       | `Authorization: Bearer <dev token>`       | Admin token cũng được (dev = `X-Gtv-Dev` hoặc `admin`). Chế độ mở: header `X-Gtv-Dev: <tên>`. |
| `/api/*`      | `Authorization: Bearer <GTV_ADMIN_TOKEN>` | Không đặt admin token ⇒ mở. Token cũng nhận qua `?token=`.                                    |
| `GET /health` | —                                         | `{ ok, brain: {backend, model, ok, detail}, projects: [id] }`                                 |

Quy tắc chế độ mở: `src/server/http/auth.ts` (xem [operations.md](operations.md#token)).

## Khám phá project (dev)

| Method | Path                       | Mô tả                                                                             |
| ------ | -------------------------- | --------------------------------------------------------------------------------- |
| GET    | `/v1/projects`             | `[{ id, name, repo_url (che token), main_branch }]`                               |
| GET    | `/v1/resolve?remote=<url>` | Project khớp remote URL (so `owner/repo`, kèm `aliases`): `{ id, name }` hoặc 404 |

## Project API — `/v1/p/:project`

### Event, state, stream

| Method | Path                 | Body / trả về                                                                                                                          |
| ------ | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/events`            | 1 `GtvEvent` hoặc `{ events: GtvEvent[] }` → `{ results: [...] }`. Chỉ cho session/workspace của chính dev gửi (admin: mọi workspace). |
| GET    | `/state`             | `TeamState` (workspaces, sessions, tasks, footprints, conflicts, features, policy)                                                     |
| GET    | `/stream`            | SSE: `state` (TeamState, debounce 150 ms), `message` (Message cho dev này), `ping` (15 s). Khi mở: gửi state + tin chưa giao           |
| GET    | `/messages`          | Tin chưa giao của dev                                                                                                                  |
| POST   | `/messages/ack`      | `{ ids: [] }` đánh dấu đã giao                                                                                                         |
| GET    | `/events/log?limit=` | `event_log` mới nhất                                                                                                                   |

`GtvEvent`:

```jsonc
{ "type": "session_start", "session": { "dev": "alice", "agent": "claude", "agent_session_id": "…", "workspace_id": "ws_…", "workspace_label": "app@main", "cwd": "…", "branch": "main" } }
// → results[0] = { session: Session, briefing: "gtv Project Operator is active…" }
{ "type": "edit", "session_id": "ses_…", "paths": ["src/a.ts"], "phase": "pre" | "post" }   // → { fresh, drift }
{ "type": "snapshot", "workspace_id": "ws_…", "sha": "<commit>", "branch": "main" }          // → { accepted: true } (xử lý async)
{ "type": "prompt", "session_id": "…", "prompt": "…" } | { "type": "plan", "session_id": "…", "plan": "…" } | { "type": "session_end", "session_id": "…" }
```

### Task

| Method | Path         | Body / trả về                                                                                 |
| ------ | ------------ | --------------------------------------------------------------------------------------------- |
| POST   | `/tasks`     | `{ session_id, title, goal?, base_sha?, resources: TaskResource[] }` → `RegistrationFeedback` |
| PATCH  | `/tasks/:id` | `{ title?, goal?, resources?, add_resources?, status?: "pr_open"\|"done"\|"abandoned" }`      |
| GET    | `/tasks`     | task đang chạy                                                                                |
| POST   | `/check`     | `{ session_id, paths?, symbols? }` → `{ clear, findings: [{kind, with, detail}] }`            |

`TaskResource`: `{ kind: "path"|"module"|"symbol"|"contract", value, op?: "read"|"modify"|"create"|"delete"|"rename"|"sig_change", certainty?: "committed"|"contingent" }`.

`RegistrationFeedback`:

```json
{
  "task": { "id": "task_…", "title": "…" },
  "status": "ok | adjust_suggested | needs_coordination",
  "overlaps": [{ "conflict_id": "cf_…", "layer": "L0", "level": "high", "with": "bob (bob@main)", "message": "…" }],
  "knowledge": [{ "id": "repo:docs/adr/002-user-ids.md", "type": "adr", "status": "active", "section": "…", "snippet": "…" }],
  "advice": "…",
  "l3": "done | pending | off | shadow | unavailable"
}
```

### Ticket (hỏi đáp)

| Method | Path                          | Body / trả về                                                                                       |
| ------ | ----------------------------- | --------------------------------------------------------------------------------------------------- |
| POST   | `/tickets`                    | `{ session_id, question, context?, to_dev? }` → `Ticket` + `formatted` (chờ tối đa `qa.ask_wait_s`) |
| GET    | `/tickets?scope=for_me\|mine` | `for_me` = đang chờ mình trả lời                                                                    |
| GET    | `/tickets/:id`                |                                                                                                     |
| POST   | `/tickets/:id/reply`          | `{ answer, escalate?, session_id? }` (có `session_id` ⇒ "agent của X", không ⇒ "X (human)")         |

`Ticket.status`: `answering → answered | forwarded → waiting_human → answered | closed | expired`.

### Conflict, knowledge, feature, graph

| Method | Path                                  | Mô tả                                                                                  |
| ------ | ------------------------------------- | -------------------------------------------------------------------------------------- |
| GET    | `/conflicts?all=1`                    | mặc định chỉ `open` + `acked`                                                          |
| POST   | `/conflicts/:id/ack\|dismiss\|reopen` | đổi trạng thái (`:id` nhận cả `key`)                                                   |
| GET    | `/kb?q=&limit=` · `/kb?type=&status=` | tìm (FTS) hoặc liệt kê                                                                 |
| POST   | `/kb`                                 | `{ title, body, type?, supersedes? }` → tài liệu `manual_*`, `active`                  |
| GET    | `/kb/:id`                             | id có `:` (vd `repo:docs/a.md`, `qa:tk_…`) ⇒ encode URL                                |
| POST   | `/kb/:id/confirm\|reject`             | `unverified → active` / `→ superseded`                                                 |
| GET    | `/features`                           | `{ modes, defs, tripped }`                                                             |
| PUT    | `/features`                           | `{ feature, mode: "off"\|"shadow"\|"on"\|null }` (`null` = về mặc định, reset cầu dao) |
| GET    | `/graph/symbols?q=&view=`             | `view` = `base` hoặc workspace id                                                      |
| GET    | `/graph/callers?q=&view=`             | `[{ symbol, callers: [{path, line, kind, from_symbol, confidence}] }]`                 |
| GET    | `/graph/stats`                        | `{ base: {files, symbols, refs}, main }`                                               |

## Admin API — `/api` (dashboard)

| Method               | Path                                  | Mô tả                                                                                            |
| -------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| GET                  | `/overview`                           | `{ open_mode, brain, brain_stats (7 ngày), projects: [summary], devs }`                          |
| GET / POST           | `/projects`                           | danh sách summary / tạo `{ id, repo_url, main_branch?, name?, aliases?, policy?, description? }` |
| GET / PATCH / DELETE | `/projects/:id`                       | chi tiết / sửa (đổi `repo_url` hoặc `main_branch` ⇒ mở lại runtime) / lưu trữ                    |
| POST                 | `/projects/:id/sync`                  | fetch ngay → `{ last_sync, main }`                                                               |
| GET                  | `/projects/:id/state`                 | `TeamState`                                                                                      |
| GET                  | `/projects/:id/stats?days=7`          | brain (totals, p50/p95, byKind, byDay, recent), conflicts, tickets, events, kb                   |
| GET                  | `/projects/:id/layers`                | mỗi feature: `mode, override, blocked_by, requires, tripped, errors, metrics`                    |
| GET                  | `/projects/:id/activity?type=&limit=` | event log (bỏ `prompt`)                                                                          |
| POST                 | `/projects/:id/messages`              | `{ to_dev, body }` → ghi chú vào agent của dev                                                   |
| GET / POST / DELETE  | `/devs`, `/devs/:name`                | liệt kê / cấp hoặc xoay token `{ name }` → `{ name, token }` (hiện 1 lần) / xóa                  |
| GET / PUT            | `/brain`                              | `{ backend, model, health, models, stats }` / `{ model }` (lưu vào settings)                     |

Summary của project: `{ id, name, repo_url, main_branch, main_sha, last_sync, counts: { people_active, sessions_active, tasks_active, conflicts_open, conflicts_by_level, tickets_waiting, kb_unverified }, people: [{ dev, status, agents, workspaces, last_seen, tasks, editing, conflicts }] }`.

## Tool chỉ-đọc của Brain (trong tiến trình, không có endpoint HTTP)

Brain (Pi) gọi các tool này **trực tiếp** trên `Engine` của project đang chạy job (`src/server/brain/tools.ts`); không có endpoint nào mở chúng ra mạng. Tham số được kiểm bằng zod trước khi chạy; kết quả cắt ở 24 000 ký tự.

`view` = `"base"` (main, mặc định) hoặc workspace id.

| Tool           | Tham số                                                 |
| -------------- | ------------------------------------------------------- |
| `team_status`  | —                                                       |
| `read_file`    | `path, view?, start_line?, end_line?` (tối đa 400 dòng) |
| `grep`         | `pattern, view?`                                        |
| `wip_diff`     | `workspace, path?`                                      |
| `find_symbol`  | `query, view?`                                          |
| `who_calls`    | `symbol, view?`                                         |
| `impact`       | `symbol, view?, depth? (1–4)`                           |
| `file_symbols` | `path, view?`                                           |
| `overview`     | `view?, limit? (≤80)`                                   |
| `owners`       | `path`                                                  |
| `kb_search`    | `query, type?: doc\|adr\|qa\|req`                       |
| `kb_get`       | `id`                                                    |
| `conflicts`    | `workspace?`                                            |

## Daemon local — `http://127.0.0.1:<port>` (mặc định 7391)

| Method | Path                             | Mô tả                                                                                                                       |
| ------ | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/hook/:agent`                   | payload hook gốc của agent (`claude`, `codex`, …) → output native của agent, hoặc body rỗng (= cho qua)                     |
| POST   | `/api/:tool`                     | `{ agent, cwd, args }` → `{ text }`; tool: `register_task, update_task, finish_task, ask, reply, status, check, inbox, ack` |
| GET    | `/wait?agent=&session=&timeout=` | long-poll cho Claude `asyncRewake` → `{ text \| null }`                                                                     |
| GET    | `/statusline?cwd=`               | 1 dòng text                                                                                                                 |
| GET    | `/status?cwd=`                   | mô tả trạng thái project của thư mục                                                                                        |
| POST   | `/snapshot`                      | `{ cwd }` → snapshot ngay                                                                                                   |
| GET    | `/human-inbox`                   | câu hỏi cần người trả lời                                                                                                   |
| GET    | `/health`                        | `{ ok, dev, server, reachable, projects: {id: connected}, sessions, inbox }`                                                |

## Tool cho agent — `gtv_*`

Phục vụ bởi `gtv mcp` (Claude, Codex); tất cả chuyển tới `POST /api/:tool` của daemon.

| Tool                | Tham số                                              |
| ------------------- | ---------------------------------------------------- |
| `gtv_register_task` | `title, goal?, resources[]`                          |
| `gtv_update_task`   | `title?, goal?, add_resources?, resources?, status?` |
| `gtv_finish_task`   | `status?: done\|abandoned`                           |
| `gtv_ask`           | `question, context?, to_dev?`                        |
| `gtv_reply`         | `ticket_id, answer, escalate?`                       |
| `gtv_status`        | —                                                    |
| `gtv_check`         | `paths?, symbols?`                                   |
| `gtv_inbox`         | —                                                    |
| `gtv_ack`           | `conflict_id`                                        |

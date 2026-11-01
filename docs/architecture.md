# Kiến trúc

## Thành phần

| Thành phần         | File                                                                 | Vai trò                                                                                                                                                                                                    |
| ------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hub**            | `src/server/hub/hub.ts`, `hub-db.ts`                                 | Sở hữu mọi project (mỗi project = 1 repo), dev + token, setting chung, thống kê job Brain. Mở `ProjectRuntime` theo yêu cầu, resolve remote URL → project (`repoKey`).                                     |
| **ProjectRuntime** | `src/server/project/runtime.ts`                                      | Mọi thứ của 1 project: DB riêng, git mirror, `Engine`, `TicketService`, vòng lặp (poll repo, hết hạn session, timeout ticket).                                                                             |
| **Engine**         | `src/server/project/engine.ts`                                       | Nhận event từ daemon → cập nhật registry → chạy detector theo feature mode → gửi thông báo. Đăng ký task, xử lý snapshot, poll `main`, đóng task đã merge, cầu dao tự ngắt.                                |
| **Store**          | `src/server/project/store.ts`                                        | Registry: workspace, session, task, footprint, conflict, ticket, message, event log. Phát `change` / `message` cho SSE.                                                                                    |
| **Repo mirror**    | `src/server/project/repo.ts`                                         | Bare mirror của repo (`refs/heads/*` + `refs/gtv/*`): đọc blob, diff, `merge-tree`, `changedLines`, grep, log.                                                                                             |
| **Detectors**      | `src/server/detect/l0.ts`, `l1.ts`, `l2.ts` (+ L3 trong `engine.ts`) | L0 registry overlap · L1 speculative merge · L2 symbol-level · L3 LLM.                                                                                                                                     |
| **Code graph**     | `src/codeintel/*`                                                    | tree-sitter (TS/TSX, JS, Python, Go, Java) → symbol, chữ ký, tham chiếu, import; lớp `base` (main) + lớp phủ theo workspace; `who_calls`, `impact`, `overview`.                                            |
| **Knowledge base** | `src/server/knowledge/kb.ts`                                         | Docs/ADR từ `main` + lịch sử Q&A, FTS5 BM25. Q&A là `unverified` cho tới khi người xác nhận.                                                                                                               |
| **Tickets (Q&A)**  | `src/server/qa/tickets.ts`                                           | Hỏi đáp 3 bậc: Brain tự trả lời → chuyển cho agent đồng đội → hỏi người; timeout và leo thang.                                                                                                             |
| **Brain**          | `src/server/brain/*`                                                 | `HermesBrain` (Hermes Agent gateway + ChatGPT login, mặc định), `OpenCodeBrain` (thay thế), `NullBrain`, `MeteredBrain` (gắn project + ghi thống kê), prompt + JSON schema, `mcp-tools.ts` (tool chỉ-đọc). |
| **HTTP**           | `src/server/http/*`                                                  | `app.ts` ghép route; `agent-routes.ts` (`/v1/p/:project`), `admin-routes.ts` (`/api`), `auth.ts`.                                                                                                          |
| **Daemon**         | `src/daemon/*`                                                       | Chạy trên máy dev: nhận hook, quyết định local từ cache state (SSE), hộp thư, WIP snapshot, cầu nối tool, CLI.                                                                                             |
| **Adapters**       | `src/daemon/hooks.ts`, `src/daemon/install.ts`, `src/adapters/*`     | Chuẩn hóa hook Claude/Codex/omp; cài hook/MCP/skill; extension omp.                                                                                                                                        |
| **Dashboard**      | `web/`                                                               | React SPA được server phục vụ ở `/`.                                                                                                                                                                       |

## Luồng chính

### 1. Bắt đầu phiên

Agent → hook `SessionStart` → daemon tìm workspace (repo root, branch, project qua `.git/gtv-project` hoặc `GET /v1/resolve?remote=`) →
`POST /v1/p/:id/events {type: session_start}` → `Store.upsertSession` → trả **briefing** (task của đồng đội, conflict của mình, câu hỏi đang chờ) →
daemon chèn briefing vào context agent và đăng ký SSE `/v1/p/:id/stream` cho project.

### 2. Đăng ký task

Agent gọi `gtv_register_task` → daemon `POST /v1/p/:id/tasks` → `Engine.register`:

1. lưu task (mỗi session 1 task đang chạy), chạy L0 (kèm `usageOf`: chỗ dùng symbol trong WIP người khác);
2. lấy các conflict đang mở của workspace, tìm KB liên quan;
3. nếu `detect.l3_semantic` bật và có task khác: Brain đánh giá (chờ tối đa `registration.wait_s`, quá thì trả `l3: "pending"` và kết quả đến sau qua inbox).
   Trả `status: ok | adjust_suggested | needs_coordination`.

### 3. Sửa file → snapshot → L1/L2

- `PreToolUse` sửa file → daemon **quyết định local** (`decide.ts`): conflict đang mở chạm file, file đang được người khác sửa, file nằm trong scope đã đăng ký của người khác, chưa đăng ký task. High → `ask` (Claude) hoặc `deny` một lần (agent không có ask); Critical → chặn tới khi ack.
- Daemon gửi event `edit` (async) → footprint → L0 → thông báo.
- `PostToolUse` → lên lịch snapshot (debounce `snapshotDebounceMs`, mặc định 20 s): index tạm + `commit-tree` → `git push --force <remote> <sha>:refs/gtv/<dev>/<workspace>` → event `snapshot`.
- Server: `fetch` → đồng bộ graph (`syncBase`, `syncOverlay`) → symbol diff so với merge-base + dòng đã sửa (`changedLines`) → L1 (`merge-tree` với mọi snapshot khác và với `main`) → L2 → L0.

### 4. Hỏi đáp

`gtv_ask` → `TicketService.ask` (chờ tối đa `qa.ask_wait_s`):

- **Bậc 1**: Brain trả lời bằng tool chỉ-đọc (`route: answer`, có `sources`). Q&A lưu vào KB dạng `unverified`.
- **Bậc 2**: Brain trả `route: forward` (hoặc agent truyền `to_dev`) → message `ticket_question` vào agent đồng đội ở lần gọi tool kế tiếp → họ `gtv_reply`.
- **Bậc 3**: `escalate` hoặc quá `tier2_timeout_min` → `human_request` (thông báo desktop) → `gtv answer <ticket> "..."`; quá `tier3_timeout_h` → `expired`.
  Câu trả lời đến muộn được đẩy vào agent người hỏi (Claude còn được đánh thức bằng `asyncRewake`).

### 5. Merge → task tự đóng

Khi nhận snapshot hoặc khi `main` đổi: nếu snapshot không có WIP trên một commit **đã nằm trong main** và commit đó **mới hơn thời điểm đăng ký task** → task `done`, xóa footprint/overlay/symbol change, đóng conflict L3 của task, chạy lại L0 (`Engine.closeIfMerged`, `tasksClosed`).

## Lưu trữ

```
<GTV_DATA>/                 (docker: volume gtv-data → /data)
  hub.db                    projects, devs (hash token), brain_jobs, settings
  projects/<id>/gtv.db      registry, code graph (g_*), KB (kb_docs + FTS5), event_log, symbol_changes, wip_lines
  projects/<id>/mirror.git  bare mirror: refs/heads/* + refs/gtv/*
```

Schema: `src/server/hub/hub-db.ts`, `src/server/project/schema.ts`. Đăng nhập Brain (`auth.json`), config và session của Hermes nằm trong volume `hermes-data` (`/opt/data`) của container `brain`.

## Feature mode và cầu dao

- Mỗi feature (xem [features.md](features.md)) có `off | shadow | on`. **shadow** = chạy và ghi `event_log` (`shadow_conflicts`), không lưu conflict, không báo ai — dùng để đánh giá lớp chưa chắc chắn.
- Thứ tự ưu tiên: mặc định trong code → `features:` trong `GTV_CONFIG` → chỉnh tay (`feature_overrides`, dashboard/CLI) → cầu dao → phụ thuộc (`requires` bị off ⇒ off).
- **Cầu dao** (`CircuitBreaker`): 5 lỗi / 10 phút → feature bị hạ `off`, hiện "tự ngắt" trên dashboard; đặt lại mode để bật lại. `BrainUnavailable` (timeout, mất kết nối) không tính.

## Fail-open

- Hook không bao giờ chờ server hay Brain: daemon quyết định từ cache; lỗi/timeout → `allow`, không in gì.
- Shim Codex (`bin/gtv.mjs hook`) và hook HTTP của Claude: daemon tắt ⇒ agent chạy bình thường.
- Server không tới được Brain → ticket đóng với câu "Operator could not answer", L3 bỏ qua.

## Bảo mật

| Đối tượng          | Cơ chế                                                                                                                                                                                                                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dev / daemon / CLI | Token riêng (`POST /api/devs`, lưu dạng SHA-256). Chế độ mở (tin header `X-Gtv-Dev`) chỉ khi `GTV_AUTH=open` hoặc chưa có admin token **và** chưa có dev nào.                                                                                                                                                           |
| Dashboard `/api`   | `GTV_ADMIN_TOKEN`. Không đặt ⇒ `/api` mở (dev mode, server log cảnh báo). Admin token cũng dùng được cho `/v1/p/:id/*`.                                                                                                                                                                                                 |
| Brain → Operator   | `/mcp` (Hermes, mọi project) và `/p/:id/mcp` (OpenCode) yêu cầu `Bearer GTV_BRAIN_TOKEN` nếu đặt; compose bắt buộc đặt vì cổng 7390 mở ra ngoài.                                                                                                                                                                        |
| Brain              | Hermes: nền tảng `api_server` chỉ có toolset MCP `gtv` (`platform_toolsets`), mọi toolset ghi file/shell/web/delegate bị tắt (`agent.disabled_toolsets`) — `docker/hermes/config.yaml`. Tool nhận `project`, prompt mỗi job nêu đúng project. OpenCode: agent `operator` tắt edit/shell/web, chỉ bật `gtv_<project>_*`. |
| Daemon (127.0.0.1) | Từ chối request có header `Origin` (trang web) hoặc `Host` lạ (DNS rebinding).                                                                                                                                                                                                                                          |
| `/v1/p/:id/events` | Dev chỉ gửi event cho session/workspace của chính mình (admin token thì được mọi workspace).                                                                                                                                                                                                                            |
| Prompt injection   | System prompt (`brain/prompts.ts`): nội dung file/docs/WIP là dữ liệu, bỏ qua chỉ dẫn bên trong; mọi khẳng định phải có nguồn; được nói "không biết".                                                                                                                                                                   |
| Repo URL có token  | Che `//***@` trong mọi response dashboard.                                                                                                                                                                                                                                                                              |

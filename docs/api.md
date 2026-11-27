# API

Server mặc định `http://127.0.0.1:7390` (`GTV_PORT`). Lỗi trả `{"error": "..."}` (400; `unknown project` → 404; thiếu quyền → 401).
Kiểu dữ liệu chung: `src/shared/types.ts`. Dashboard sao chép ở `web/src/api/types.ts`.

## Xác thực

| Người gọi         | Gửi                                   | Ghi chú                                                                                                                  |
| ----------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Phiên dashboard   | cookie `gtv_session` (`gtvs_…`)       | đặt bởi `/api/auth/setup\|signup\|login\|reset`; httpOnly, `SameSite=Lax`, `Secure` khi https; 30 ngày, gia hạn khi dùng |
| Máy (agent, CLI)  | `Authorization: Bearer gtvd_…`        | `gtv login` (luồng kết nối máy). Chỉ dùng được trên `/v1`                                                                |
| Link chia sẻ      | `Authorization: Bearer gtvl_…`        | `/s/<code>` trên dashboard; chỉ đọc một project                                                                          |
| `GTV_ADMIN_TOKEN` | `Authorization: Bearer <admin token>` | cứu hộ, script, test; quyền admin. Trên `/v1` đóng vai dev ghi trong `X-Gtv-Dev`                                         |
| Chế độ mở         | `X-Gtv-Dev: <tên>` (không token)      | khi không có admin token và chưa có tài khoản nào (hoặc `GTV_AUTH=open`)                                                 |
| `GET /health`     | —                                     | `{ ok, brain: {backend, model, ok, detail, failing}, commit }`; có khoá máy thì cập nhật `last_seen`                     |

Bearer cũng nhận qua `?token=`; `gtvs_…` gửi bằng Bearer vẫn được nhận (script), nhưng server không bao giờ trả token
phiên trong JSON. **Chống CSRF**: lệnh ghi (không phải GET/HEAD) dùng cookie phải có header `Origin` cùng host với server
(so host, vì sau tunnel giao thức server thấy có thể khác); lệnh ghi nào có `Origin` lạ cũng bị 403. Tài khoản bị khoá
hoặc đã xoá: mọi phiên và máy của họ nhận 401. Lỗi: 401 chưa đăng nhập, 403 thiếu quyền, 404 project không có (hoặc
mình không phải thành viên), 429 quá nhiều lần thử. Mã nguồn: `src/server/http/auth.ts` (bảng `ROUTES`), `Hub.projectAccess`.

### Quyền: hai tầng

**Quyền hệ thống** (`users.role`): `admin` lo server (tài khoản, AI, chế độ đăng ký) và quản lý mọi project; `member`
làm những gì quyền project cho phép. **Quyền trong project** (bảng `project_members` của `hub.db`, đọc được cả khi
project chưa mở): `manager` | `developer` | `viewer`, hoặc không phải thành viên. Admin, admin token và chế độ mở được
tính là `manager` ở mọi project; link chia sẻ là `viewer` ở project của nó. Project luôn còn ít nhất một `manager`.

| Việc                                                                                                   | Cần                                                      |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `/api/auth/config\|setup\|signup\|login`, `/api/auth/reset/:code`, `GET /api/invites/:code`            | công khai                                                |
| `/api/me*`, `/api/connect/*`, `/api/overview`, `/api/projects` (GET, POST), `check-repo`, nhận lời mời | đã đăng nhập (người, không phải máy hay link chia sẻ)    |
| `/api/admin/*`, `/api/brain/*`                                                                         | admin                                                    |
| `GET /api/projects/:id/…`, `GET /v1/p/:id/…` (phiên dashboard)                                         | ≥ `viewer` (không phải thành viên → 404)                 |
| `…/share-links`, `…/invites` (đọc lẫn ghi), mọi lệnh ghi khác `/api/projects/:id/…`                    | `manager`                                                |
| `DELETE /api/projects/:id/members/:user`                                                               | `manager`, hoặc chính `:user` (rời project)              |
| ghi `/v1/p/:id/…` từ dashboard                                                                         | `manager`, trừ ngoại lệ của `developer` ở dưới           |
| `POST /v1/p/:id/tickets/:tid/reply`                                                                    | `developer` khi câu hỏi gửi cho mình hoặc cả nhóm        |
| `PATCH /v1/p/:id/board/:bid`, `POST /v1/p/:id/board/:bid/notes`                                        | `developer` khi việc giao cho mình; không đổi `assignee` |
| `POST /v1/p/:id/board`                                                                                 | `developer` khi `assignee` trống hoặc là mình            |
| `POST /v1/p/:id/kb`, `PATCH /v1/p/:id/kb/:kid`, `POST /v1/p/:id/kb/:kid/confirm\|reject`               | `developer` (xoá tài liệu: `manager`)                    |
| mọi route `/v1/p/:id/…` từ **máy**                                                                     | `developer` hoặc `manager`; không thì 403 (xem dưới)     |

Máy không phải thành viên nhận 403 `You are not a member of project <id>. Ask a project manager for an invite link.`
(chỉ id mà máy đã biết, không lộ tên; người xem: `You are a viewer in project <name>; agents need developer access. …`);
CLI và daemon in lại nguyên văn. Trên `/v1`, danh tính lấy từ token (phiên, máy); chỉ admin token và chế độ mở dùng `X-Gtv-Dev`.

## Tài khoản và phiên đăng nhập

Tên đăng nhập: 3–32 ký tự `a-z 0-9 . _ -`, không trùng (kể cả tài khoản đã xoá), không dùng `admin root gtv system
everyone all share me api`. Mật khẩu ≥ 8 ký tự. Phản hồi đăng nhập `Login = { name, display_name, role }` kèm
`Set-Cookie`.

| Method     | Path                             | Ai                      | Mô tả                                                                                                                                                                                                   |
| ---------- | -------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET        | `/api/auth/config`               | công khai               | `{ setup_needed, registration: open\|invite\|closed, needs_admin_token }`                                                                                                                               |
| POST       | `/api/auth/setup`                | công khai, server trống | `{ name, display_name?, password, admin_token? }` → `Login` (role `admin`); có `GTV_ADMIN_TOKEN` thì phải đúng token (403); đã có tài khoản → 409                                                       |
| POST       | `/api/auth/signup`               | công khai               | `{ name, display_name?, password, invite? }` → `Login + { project: { id, access } \| null }`; `closed` → 403; `invite` mà không có `invite` → 403; link mời hết hiệu lực → 400; server chưa setup → 403 |
| POST       | `/api/auth/login`                | công khai               | `{ name, password }` → `Login`; sai → 400 `wrong user name or password`; bị khoá → 400 `this account is locked…`                                                                                        |
| POST       | `/api/auth/logout`               | đã đăng nhập            | xoá phiên hiện tại, xoá cookie                                                                                                                                                                          |
| GET / POST | `/api/auth/reset/:code`          | công khai               | `{ user, display_name, expires_at }` / `{ password }` → `Login`; mọi phiên cũ bị đăng xuất, máy giữ nguyên. Một lần, 1 giờ; sai/hết hạn → 400                                                           |
| GET        | `/api/me`                        | đã đăng nhập            | `{ name, display_name, role, kind, project, open_mode, projects: [{ id, name, access }] }` (`kind`/`project` cho link chia sẻ)                                                                          |
| PATCH      | `/api/me`                        | đã đăng nhập            | `{ display_name }` → `Login`                                                                                                                                                                            |
| PUT        | `/api/me/password`               | đã đăng nhập            | `{ current, password }` → `{ ok }`; các phiên khác bị đăng xuất, phiên này giữ                                                                                                                          |
| DELETE     | `/api/me`                        | đã đăng nhập            | `{ password }` → xoá tài khoản (phiên, máy, tư cách thành viên; tên giữ lại); Quản lý cuối của project hoặc admin cuối → 400                                                                            |
| GET        | `/api/me/sessions`               | đã đăng nhập            | `[{ id, created_at, expires_at, last_used, user_agent, ip, current }]`                                                                                                                                  |
| DELETE     | `/api/me/sessions[/:id]`         | đã đăng nhập            | không `:id`: đăng xuất mọi nơi khác; có `:id`: một phiên                                                                                                                                                |
| GET        | `/api/admin/users`               | admin                   | `[{ name, display_name, role, created_at, last_login, disabled_at, disabled, projects: n, devices: n, last_seen }]`                                                                                     |
| PATCH      | `/api/admin/users/:name`         | admin                   | `{ role?: admin\|member, disabled?: bool }` → user; không hạ quyền/khoá admin cuối (400)                                                                                                                |
| POST       | `/api/admin/users/:name/reset`   | admin                   | `{ reset_url: <origin>/reset/<code>, expires_at }`; link trước đó hết hiệu lực                                                                                                                          |
| DELETE     | `/api/admin/users/:name`         | admin                   | như tự xoá (không cần mật khẩu)                                                                                                                                                                         |
| GET        | `/api/admin/users/:name/devices` | admin                   | như `/api/me/devices` của người đó (kể cả đường dẫn repo)                                                                                                                                               |
| GET / PUT  | `/api/admin/settings`            | admin                   | `{ registration: open\|invite\|closed }` (mặc định `open`)                                                                                                                                              |

Giới hạn mỗi địa chỉ mỗi phút: login 10, signup 5, setup 10, reset 30, xem/nhận lời mời 30, xem mã kết nối máy 30,
`check-repo` và tạo project 10, `/v1/connect/start` 30, `/v1/connect/poll` 120.

## Máy và kết nối máy

| Method         | Path                                    | Ai           | Mô tả                                                                                                                          |
| -------------- | --------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| POST           | `/v1/connect/start`                     | công khai    | `{ device_name, platform }` → `{ device_code, user_code: "KQ7M-2XPD", verify_url, interval: 2, expires_at }` (10 phút)         |
| POST           | `/v1/connect/poll`                      | công khai    | `{ device_code }` → `{ status: pending }` \| `{ status: approved, user, token: gtvd_…, device_id }` (một lần) \| 400           |
| GET            | `/api/connect/:user_code`               | đã đăng nhập | `{ device_name, platform, created_at }` hoặc 404                                                                               |
| POST           | `/api/connect/:user_code/approve\|deny` | đã đăng nhập | gắn máy vào tài khoản đang đăng nhập / từ chối                                                                                 |
| GET            | `/v1/me`                                | máy          | `{ user, role, device: { id, name }, projects: [{ id, name, access, repos: [repoKey…] }] }`; `repos` không bao giờ là URL      |
| POST           | `/v1/me/device`                         | máy          | `{ gtv_version, agents: [{ kind, version }], repos: [{ path, project, agents: [kind] }] }` → `{ ok }`; ghi đè repo của máy này |
| POST           | `/v1/me/logout`                         | máy          | thu hồi khoá của chính máy này                                                                                                 |
| GET            | `/api/me/devices`                       | đã đăng nhập | `[Device]` (dưới)                                                                                                              |
| PATCH / DELETE | `/api/me/devices/:id`                   | đã đăng nhập | `{ name }` đổi tên / ngắt máy (khoá bị thu hồi, daemon nhận 401 và báo `Run: gtv login`); máy người khác → 400                 |
| POST           | `/v1/join`                              | —            | 410: `Invite links are gone. Run: npx guide-the-vibe, then gtv login`                                                          |

`Device = { id, name, platform, created_at, last_seen, online (last_seen trong 60 giây), gtv_version, agents: [{ kind,
version }], reported_at (null: bản gtv cũ chưa báo), repos: [{ path, project, project_name (null nếu mình không còn ở
project đó), agents, updated_at, sessions: [{ id, agent, status }] }], sessions: [{ id, project, project_name, agent,
status, cwd, last_seen }] }` — `sessions` là phiên agent chưa kết thúc chạy trên máy này. Đường dẫn repo chỉ chủ máy và
admin thấy; thành viên project chỉ thấy tên máy (`/api/projects/:id/members`).

## Project, thành viên, lời mời

| Method | Path                                | Ai                        | Mô tả                                                                                                                                                                |
| ------ | ----------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/projects/check-repo`          | đã đăng nhập              | `{ repo_url }` → `{ ok: true, default_branch }` \| `{ ok: false, error }` (luôn 200)                                                                                 |
| POST   | `/api/projects`                     | đã đăng nhập              | `{ id? (không có: server tạo từ name, thêm -2, -3… nếu trùng), name?, repo_url, main_branch?, description?, … }` → summary; người tạo là `manager`; id đã dùng → 400 |
| DELETE | `/api/projects/:id`                 | `manager`                 | lưu trữ project (id vẫn bị giữ; chỉ admin tạo lại được, kèm dữ liệu và thành viên cũ)                                                                                |
| GET    | `/api/projects/:id/members`         | `viewer`                  | `[Member + { display_name, joined_at, invited_by, devices: [{ id, name, online, last_seen }] }]`                                                                     |
| POST   | `/api/projects/:id/members`         | `manager`                 | `{ user, access? (mặc định developer) }` → member; chưa có tài khoản / đã là thành viên → 400                                                                        |
| PATCH  | `/api/projects/:id/members/:user`   | `manager`                 | `{ access?, role?, level?, note? }` → member; hạ quyền Quản lý cuối → 400                                                                                            |
| DELETE | `/api/projects/:id/members/:user`   | `manager` hoặc chính mình | xoá / rời project; Quản lý cuối → 400. Máy của người đó nhận 403 từ lần gọi kế tiếp                                                                                  |
| GET    | `/api/projects/:id/invites`         | `manager`                 | link đang dùng được: `[{ id, project, access, created_by, created_at, expires_at, max_uses, uses, revoked_at }]` (không có URL: chỉ lưu bản băm)                     |
| POST   | `/api/projects/:id/invites`         | `manager`                 | `{ access?: developer\|viewer, days?: 1\|7\|30 (7), max_uses?: 1\|10\|null (null) }` → invite `+ { code, url: <origin>/join/<code> }` (URL chỉ hiện lần này)         |
| DELETE | `/api/projects/:id/invites/:invite` | `manager`                 | thu hồi                                                                                                                                                              |
| GET    | `/api/invites/:code`                | công khai                 | `{ valid: true, project_name, access, invited_by, invited_by_name, expires_at, member }` (+ `project_id` khi đã là thành viên) \| `{ valid: false }`                 |
| POST   | `/api/invites/:code/accept`         | đã đăng nhập              | `{ project: { id, name }, access, already_member }`; đã là thành viên thì giữ quyền cũ, không tốn lượt; link hết hiệu lực → 400                                      |

Địa chỉ repo người thường được dùng: `https://…` hoặc `git@host:owner/repo`; không `file://`, `ext::`, `ssh://`,
`http://`, đường dẫn trên máy, hay host phân giải ra địa chỉ của chính server/mạng nội bộ (127/8, 10/8, 172.16/12,
192.168/16, 169.254/16, 100.64/10, ::1, fc00::/7, fe80::/10…). Server chạy `git ls-remote` (15 giây, không hỏi mật
khẩu) trước khi tạo hoặc đổi `repo_url`. Admin được dùng thêm đường dẫn trên máy (demo, sandbox).

## Khám phá project (máy)

| Method | Path                       | Mô tả                                                                                                                                               |
| ------ | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/projects`             | project của chính mình: `[{ id, name, repo_url (che token), main_branch }]`                                                                         |
| GET    | `/v1/resolve?remote=<url>` | project khớp remote URL (so `owner/repo`, kèm `aliases`): thành viên nhận `{ id, name }`, người ngoài chỉ nhận `{ exists: true }`; không khớp → 404 |

## Project API — `/v1/p/:project`

### Event, state, stream

| Method | Path                 | Body / trả về                                                                                                                                          |
| ------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/events`            | 1 `GtvEvent` hoặc `{ events: GtvEvent[] }` → `{ results: [...] }`. Chỉ cho session/workspace của chính dev gửi (admin: mọi workspace).                 |
| GET    | `/state`             | `TeamState` (workspaces, sessions, tasks, footprints, conflicts, features, policy); mỗi session có `device` (id máy đã đăng ký phiên, lấy từ khoá máy) |
| GET    | `/stream`            | SSE: `state` (TeamState, debounce 150 ms), `message` (Message cho dev này), `ping` (15 s). Khi mở: gửi state + tin chưa giao                           |
| GET    | `/messages`          | Tin chưa giao của dev                                                                                                                                  |
| POST   | `/messages/ack`      | `{ ids: [] }` đánh dấu đã giao                                                                                                                         |
| GET    | `/events/log?limit=` | `event_log` mới nhất                                                                                                                                   |

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

| Method | Path                                  | Mô tả                                                                                                    |
| ------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| GET    | `/conflicts?all=1`                    | mặc định chỉ `open` + `acked`                                                                            |
| POST   | `/conflicts/:id/ack\|dismiss\|reopen` | đổi trạng thái (`:id` nhận cả `key`)                                                                     |
| GET    | `/incidents?all=1`                    | vụ đụng nhau: mọi conflict của một cặp workspace gom thành một `Incident` (mặc định chỉ vụ còn hiệu lực) |
| POST   | `/incidents/:id/ack\|dismiss\|reopen` | áp cho mọi conflict của vụ                                                                               |
| POST   | `/incidents/:id/guide`                | `{ body, to: [dev] }`: gửi hướng xử lý vào agent của người nhận, rồi đánh dấu vụ đã biết                 |
| GET    | `/kb?q=&limit=` · `/kb?type=&status=` | tìm (FTS) hoặc liệt kê                                                                                   |
| POST   | `/kb`                                 | `{ title, body, type?, supersedes? }` → tài liệu `manual_*`, `active`                                    |
| GET    | `/kb/:id`                             | id có `:` (vd `repo:docs/a.md`, `qa:tk_…`) ⇒ encode URL                                                  |
| POST   | `/kb/:id/confirm\|reject`             | `unverified → active` / `→ superseded`                                                                   |
| GET    | `/features`                           | `{ modes, defs, tripped }`                                                                               |
| PUT    | `/features`                           | `{ feature, mode: "off"\|"shadow"\|"on"\|null }` (`null` = về mặc định, reset cầu dao)                   |
| GET    | `/graph/symbols?q=&view=`             | `view` = `base` hoặc workspace id                                                                        |
| GET    | `/graph/callers?q=&view=`             | `[{ symbol, callers: [{path, line, kind, from_symbol, confidence}] }]`                                   |
| GET    | `/graph/stats`                        | `{ base: {files, symbols, refs}, main }`                                                                 |

### Bảng task, thành viên (v0.8)

| Method               | Path               | Mô tả                                                                                                                                                                                           |
| -------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET                  | `/board?scope=`    | `open` (mặc định) \| `all` \| `mine` → `[BoardView]`, gấp nhất trước (bị chặn, quá hạn, ưu tiên, hạn). `BoardView = BoardTask + { work[], conflicts[], blocked, overdue, notes_count }`         |
| POST                 | `/board`           | `{ title, description?, priority?: urgent\|high\|normal\|low, due_date?: YYYY-MM-DD, estimate_h?, assignee?, labels? }`; có `assignee` ⇒ agent của người đó nhận tin; người ngoài project → 400 |
| GET / PATCH / DELETE | `/board/:id`       | chi tiết `+ { notes[], registrations[] }` / sửa (mọi thay đổi ghi vào nhật ký) / xoá                                                                                                            |
| POST                 | `/board/:id/notes` | `{ body }` → ghi chú vào nhật ký                                                                                                                                                                |
| POST                 | `/board/:id/pick`  | `{ session_id }` → agent nhận việc (gán cho dev, `in_progress`); việc đã giao cho người khác → 400                                                                                              |
| GET                  | `/members`         | `[{ dev, role, level: intern\|junior\|mid\|senior\|lead, access: manager\|developer\|viewer, note }]`: thành viên lấy từ hub, ghép hồ sơ trong project; làm việc không biến ai thành thành viên |

### Tài liệu, sơ đồ code (v0.8)

| Method         | Path                                             | Mô tả                                                                                                                                                                      |
| -------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST           | `/kb`                                            | `{ title, body, type?, pinned?, path? }` (≤ 400 000 ký tự)                                                                                                                 |
| PATCH / DELETE | `/kb/:id`                                        | `{ title?, body?, type?, pinned? }` (tài liệu từ repo: chỉ `type`, `pinned`) / xoá (không xoá được tài liệu từ repo → 400)                                                 |
| GET            | `/kb?core=1`                                     | tài liệu cốt lõi (không kèm nội dung)                                                                                                                                      |
| GET            | `/graph/map?view=&level=dir\|file&depth=&focus=` | `{ level, depth, truncated, nodes: [{ id, label, kind, files, symbols, lang?, editing: [dev], scoped: [dev], conflicts: [level] }], edges: [{ source, target, weight }] }` |
| GET            | `/graph/calls?q=&view=`                          | `{ center, nodes: [{ id, label, kind, path, line, role: center\|caller\|callee, sig? }], edges: [{ source, target, confidence }] }`                                        |

`POST /tasks` nhận thêm `board_id?`. Không có thì nối vào việc phiên này vừa nhận, hoặc tạo việc mới (`source: "agent"`).
Trạng thái việc đi theo đăng ký: đăng ký → `in_progress`; `gtv_finish_task` → `review`; abandoned → `todo`; code vào main → `done`.

## Admin API — `/api` (dashboard)

| Method           | Path                                   | Mô tả                                                                                                                                                                                                                               |
| ---------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET / POST / DEL | `/projects/:id/share-links[/:link]`    | link xem chỉ đọc: liệt kê / tạo `{ label?, days? }` → `{ …, code }` (hiện 1 lần) / thu hồi                                                                                                                                          |
| GET              | `/projects/:id/conversations?limit=`   | `[Thread]`: luồng trao đổi (question \| conflict \| task \| note) với `entries: [{ from, to, at, kind, body }]`                                                                                                                     |
| GET              | `/projects/:id/attention`              | `[{ kind, level, title, detail, ref, at, ticket?, board? }]`: vụ đụng nhau high/critical chưa xử lý (`ref` = id vụ), câu hỏi chờ người, việc quá hạn / bị chặn / gấp chưa giao / im lặng (`stale`, không agent nào chạy quá 24 giờ) |
| GET              | `/projects/:id/incidents/:iid/plans`   | `{ plans: [{ title, text }] }`: 2–3 hướng xử lý AI soạn (lưu đệm); `[]` khi AI tắt hoặc chưa soạn xong (hỏi lại sau vài giây)                                                                                                       |
| POST             | `/projects/:id/incidents/:iid/rewrite` | `{ text }` → `{ text }`: AI viết lại cùng ý; `""` khi AI tắt                                                                                                                                                                        |
| GET              | `/projects/:id/file?path=&context=`    | một file qua mắt cả nhóm: `{ conflicts, workspaces: [{ dev, diff, base, … }], outline, used_by }`; `context` = số dòng ngữ cảnh của diff                                                                                            |

`Incident = { id, workspace_a, workspace_b, dev_a, dev_b, level, status: open|guided|acked|closed, closed_reason?, headline: { layer, kind, subject }, evidence: [conflict], files, board_ids, guide?: { at, by, body, to: [{ dev, delivered_at }] } }`.
`/conversations` nhận `kinds=task,question,note`; luồng câu hỏi có `board_id`, tin nhắn có `delivered_at`. `/overview` và `/health` có `brain.failing = { count, error }` (job AI lỗi trong 10 phút qua).

`PATCH /projects/:id` nhận thêm `charter: { goal?, users?, deadline?, milestones?, stack?: string[], constraints?, non_goals?, quality?: prototype\|mvp\|production, notes? }`.
`POST /projects/:id/messages` nhận thêm `ref_id?` (gắn tin vào một luồng trao đổi).

| Method               | Path                                       | Mô tả                                                                                                                                                                                                                                                                                             |
| -------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET                  | `/overview`                                | `{ open_mode, brain, brain_stats (7 ngày), projects: [summary] }` (chỉ project mình là thành viên)                                                                                                                                                                                                |
| GET / POST           | `/projects`                                | danh sách summary (project của mình) / tạo (xem _Project, thành viên, lời mời_)                                                                                                                                                                                                                   |
| GET / PATCH / DELETE | `/projects/:id`                            | chi tiết (+ `my_access`) / sửa (đổi `repo_url` hoặc `main_branch` ⇒ mở lại runtime) / lưu trữ                                                                                                                                                                                                     |
| POST                 | `/projects/:id/sync`                       | fetch ngay → `{ last_sync, main }`                                                                                                                                                                                                                                                                |
| GET                  | `/projects/:id/state`                      | `TeamState`                                                                                                                                                                                                                                                                                       |
| GET                  | `/projects/:id/stats?days=7`               | brain (totals, p50/p95, byKind, byDay, recent), conflicts, tickets, events, kb                                                                                                                                                                                                                    |
| GET                  | `/projects/:id/layers`                     | mỗi feature: `mode, override, blocked_by, requires, tripped, errors, metrics`                                                                                                                                                                                                                     |
| GET                  | `/projects/:id/activity?type=&limit=`      | event log (bỏ `prompt`)                                                                                                                                                                                                                                                                           |
| POST                 | `/projects/:id/messages`                   | `{ to_dev, body }` → ghi chú vào agent của dev                                                                                                                                                                                                                                                    |
| GET / PUT            | `/brain`                                   | `{ backend, model, thinking, health, models, stats }` / `{ model?, thinking? }` (lưu vào settings; model lạ → 400)                                                                                                                                                                                |
| GET                  | `/brain/providers`                         | `{ secrets_encrypted, providers: [{ id, name, kind: endpoint\|builtin, configured, source, auth_type?: api_key\|oauth, key_hint, api_key?: bool, oauth?: device\|redirect, models?: n, base_url?, api?, env? }] }` — không bao giờ trả key/token (`source: "OAuth"` khi đăng nhập bằng tài khoản) |
| PUT / DELETE         | `/brain/providers/:id/key`                 | `{ key }` → lưu key (mã hoá bằng `GTV_SECRET_KEY`) / xoá key đã lưu                                                                                                                                                                                                                               |
| POST                 | `/brain/providers/:id/test`                | `{ model? }` → một request nhỏ thật: `{ ok, model, ms, detail }`                                                                                                                                                                                                                                  |
| GET                  | `/brain/oauth`                             | `{ providers: [{ id, name, flow: device\|redirect }] }` — provider đăng nhập được bằng tài khoản                                                                                                                                                                                                  |
| POST                 | `/brain/oauth/:provider/start`             | `{ domain? }` (chỉ GitHub Copilot Enterprise) → `OAuthSession` (chờ tới khi có `url`/`user_code`, ≤ 15 s); start lại thì phiên cũ của provider bị huỷ                                                                                                                                             |
| GET                  | `/brain/oauth/sessions/:id`                | `OAuthSession = { id, provider, status: pending\|waiting_input\|done\|error, url?, instructions?, user_code?, verification_uri?, prompt?: { message, placeholder? }, progress?, error?, expires_at }` — không bao giờ có token; phiên hết hạn/không có → 400                                      |
| POST                 | `/brain/oauth/sessions/:id/input`          | `{ value }` (code hoặc URL redirect cuối cùng, khi `status = waiting_input`) → `OAuthSession` (chờ kết quả ≤ 10 s)                                                                                                                                                                                |
| DELETE               | `/brain/oauth/sessions/:id`                | huỷ đăng nhập → `{ ok: true }`. Đăng xuất = `DELETE /brain/providers/:id/key`                                                                                                                                                                                                                     |
| POST / DELETE        | `/brain/endpoints`, `/brain/endpoints/:id` | `{ id, name?, base_url, api?: openai-completions\|anthropic-messages, key? }` → thêm / xoá endpoint                                                                                                                                                                                               |

Summary của project: `{ id, name, repo_url, main_branch, main_sha, last_sync, counts: { people_active, sessions_active, tasks_active, conflicts_open, conflicts_by_level, tickets_waiting, kb_unverified }, board: { total, done, open, in_progress, overdue, blocked }, charter, attention, members, people: [{ dev, role, level, status, agents, workspaces, last_seen, tasks, editing, conflicts }] }`.

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

| Tool                | Tham số                                                   |
| ------------------- | --------------------------------------------------------- |
| `gtv_register_task` | `title, goal?, resources[], board_task_id?`               |
| `gtv_tasks`         | `mine?` — bảng việc đang mở, gấp nhất trước               |
| `gtv_pick_task`     | `task_id` — nhận việc trên bảng                           |
| `gtv_log_work`      | `note, task_id?` — ghi nhật ký cho việc đang làm          |
| `gtv_docs`          | `query?, id?` — tài liệu cốt lõi / tìm / đọc một tài liệu |
| `gtv_update_task`   | `title?, goal?, add_resources?, resources?, status?`      |
| `gtv_finish_task`   | `status?: done\|abandoned`                                |
| `gtv_ask`           | `question, context?, to_dev?`                             |
| `gtv_reply`         | `ticket_id, answer, escalate?`                            |
| `gtv_status`        | —                                                         |
| `gtv_check`         | `paths?, symbols?`                                        |
| `gtv_inbox`         | —                                                         |
| `gtv_ack`           | `conflict_id`                                             |

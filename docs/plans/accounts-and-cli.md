# Kế hoạch: một người một tài khoản, quyền theo project, CLI mới

Viết ngày 27/11/2026 cho bản `5ef43b5`. Chủ dự án đã duyệt hướng này; người làm đọc hết file trước khi sửa code.

## 1. Mục tiêu

- **Một người = một tài khoản.** Tài khoản vừa đăng nhập dashboard, vừa là danh tính của agent trên máy người đó. Bỏ khái niệm "developer" tách riêng và token do admin tạo hộ.
- **Admin chỉ tạo tài khoản**, gửi link kích hoạt. Người dùng tự đặt mật khẩu và tự kết nối máy của mình.
- **Quyền theo project.** Quyền hệ thống chỉ còn Quản trị / Thường. Trong mỗi project, thành viên có quyền Quản lý / Developer / Người xem.
- **CLI mới**, toàn bộ chữ tiếng Anh: `npx guide-the-vibe` cài lệnh `gtv`; `gtv login` hỏi server bằng dấu nhắc rồi xác nhận máy trên trình duyệt; `gtv on` trong repo cài cho agent.
- **Hướng dẫn dùng CLI** (`docs/cli.md`) và README cập nhật.
- Máy và daemon đang chạy **không bị gián đoạn**: token cũ vẫn dùng được sau khi chuyển dữ liệu.

Xong nghĩa là:

- `npm run check` và `npm run web:build` qua, CI xanh.
- Server đã deploy lên tokyo-lxd và chạy với dữ liệu thật.
- Gói npm 0.2.0 đã build sẵn trong `dist/npm` nhưng **chưa publish**: publish cần khoá bảo mật của chủ dự án.

## 2. Quyết định đã chốt (không hỏi lại)

1. Kích hoạt tài khoản bằng **link một lần do admin gửi** (48 giờ). Admin không bao giờ biết mật khẩu của người khác.
2. Agent của người **không phải thành viên** project (hoặc chỉ là Người xem) thì **bị từ chối** ở project đó. Hệ thống **không tự thêm thành viên** nữa.
3. Developer trên web: **xem mọi thứ** trong project của mình, **trả lời câu hỏi gửi cho mình**, **sửa việc được giao cho mình** (trạng thái, mô tả, ghi chú). Mọi thứ khác cần Quản lý.
4. Cài **theo từng repo** bằng `gtv on`, không cài vào cấu hình chung của agent.
5. Chữ trên CLI: **tiếng Anh**. Dashboard: tiếng Việt như hiện nay.
6. `GTV_ADMIN_TOKEN` vẫn chấp nhận (dùng cứu hộ, cho script và test), nhưng giao diện không còn nói tới nó.
7. Link chia sẻ chỉ đọc giữ nguyên.

## 3. Mô hình dữ liệu (hub.db)

Sửa `src/server/hub/hub-db.ts`, `src/server/hub/accounts.ts`, `src/server/hub/hub.ts`.

| Bảng                           | Cột                                                                                                                                                                                                                                                                | Ghi chú                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| `users`                        | `name` PK, `role` (`admin` \| `member`), `pass_hash` (NULL = chưa kích hoạt), `created_at`, `created_by`, `last_login`                                                                                                                                             | đã có; thêm `created_by`, cho `pass_hash` NULL        |
| `devices` (mới)                | `id` (`dv_…`), `user`, `name` (tên máy), `platform`, `token_hash` UNIQUE, `created_at`, `last_seen`                                                                                                                                                                | khoá của từng máy                                     |
| `activations` (mới)            | `code_hash` PK, `user`, `expires_at`, `created_at`                                                                                                                                                                                                                 | link kích hoạt và link đặt lại mật khẩu, dùng một lần |
| `device_requests` (mới)        | `id`, `device_code_hash` UNIQUE, `user_code` UNIQUE (dạng `KQ7M-2XPD`, bỏ ký tự dễ nhầm 0/O/1/I), `device_name`, `platform`, `status` (`pending` \| `approved` \| `denied`), `user`, `token` (bản rõ, xoá ngay khi CLI nhận), `expires_at` (10 phút), `created_at` | luồng kết nối máy                                     |
| `user_sessions`, `share_links` | giữ nguyên                                                                                                                                                                                                                                                         |                                                       |
| `devs`, `invites`              | không đọc nữa sau khi chuyển dữ liệu; giữ bảng để có thể quay lại                                                                                                                                                                                                  |                                                       |

Trong **db của từng project**, bảng `members` thêm cột `access` TEXT NOT NULL DEFAULT `'developer'` (`manager` \| `developer` \| `viewer`). Thêm theo cách repo đang thêm cột cho bảng có sẵn (tìm `ensureColumn` hoặc cách `kb_docs.pinned` được thêm).

Tên tài khoản giữ đúng luật tên dev hiện có (`checkDevName`), vì nó xuất hiện trong mọi bản ghi cũ của project (tasks, footprints, conflicts…).

### Chuyển dữ liệu (chạy một lần khi server khởi động, idempotent, ghi `settings.accounts_migrated = 1`)

1. Mỗi dòng `devs` → một `users` (nếu chưa có tên đó) với `role = member`, `pass_hash = NULL`, cộng một `devices` với `name = "máy cũ"`, `platform = "unknown"`, **cùng `token_hash`**: daemon đang chạy với token cũ vẫn được nhận.
2. `users` có sẵn: `admin` giữ `admin`; `manager` và `viewer` → `member`.
3. Ghi nhớ role cũ để gán quyền project: người là `manager` cũ → `manager` ở mọi project; `viewer` cũ → thêm thành viên `viewer` ở mọi project (nếu chưa là thành viên).
4. Thành viên đã có trong các project giữ nguyên, `access = developer`.
5. Trên server thật sẽ có: `hoc` (admin, có mật khẩu, cũng là dev `hoc` cũ), `hoc-xem` (member, người xem), `hien`, `hien-test`, `khanh`… (chưa kích hoạt, máy cũ vẫn chạy).

Có test cho bước này.

## 4. Quyền

**Principal** (`accounts.ts`): `{ kind: "user" | "device" | "admin_token" | "share" | "open", name, role: "admin" | "member", project? }`.

**Quyền trong một project** (một hàm duy nhất, ví dụ `projectAccess(hub, principal, projectId)`):

- `admin` hệ thống, `admin_token`, `open` → `manager`.
- `share` → `viewer`, chỉ project của link.
- người dùng thường → `members.access` của project đó, hoặc `none` nếu không phải thành viên.

**Dashboard API (`/api`)** — viết lại `apiRoleFor` thành luật theo hai tầng:

- Chỉ admin hệ thống: `/users*`, `/brain/*`, `POST /projects`, `DELETE /projects/:id`.
- `/projects/:id/...` GET: cần quyền project ≥ `viewer` (không phải thành viên → 404, để không lộ project).
- `/projects/:id/...` ghi: cần `manager`, trừ các ngoại lệ của Developer ở dưới.
- `/overview`, `/projects`: chỉ liệt kê project mình là thành viên (admin thấy hết).
- `/me`: thêm `role` hệ thống và `projects: [{ id, access }]`.

**Project API (`/v1/p/:id`)**

- **Từ dashboard** (phiên đăng nhập): đọc khi quyền ≥ viewer. Ghi khi là manager, hoặc khi là Developer và thuộc ngoại lệ:
  - `POST /tickets/:id/reply` khi `ticket.to_dev === me`, hoặc câu hỏi gửi cả nhóm (`to_dev` rỗng);
  - `PATCH /board/:id` và `POST /board/:id/notes` khi `assignee === me`. Developer không được đổi `assignee` hay xoá việc.
- **Từ máy** (khoá thiết bị, hoặc token cũ đã chuyển thành thiết bị): mọi route agent đang dùng, nhưng chỉ khi quyền project là `developer` hoặc `manager`. Nếu không, trả 403 với lời rõ ràng (tiếng Anh, CLI và daemon in lại nguyên văn): `You are not a member of project <name>. Ask a project manager to add you.`
- `admin_token` kèm header `x-gtv-dev` vẫn đóng vai dev đó (test và script đang dựa vào).

**Bỏ tự thêm thành viên:** gỡ các lời gọi `store.ensureMember(...)` trong `engine.ts`, `board.ts`, `store.ts`. Giao việc cho người không phải thành viên → lỗi 400 `"<name> is not a member of this project"`.

## 5. API mới

| Method | Path                                        | Ai              | Mô tả                                                                                                                                                                        |
| ------ | ------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/users`                                | admin           | `{ name, role, projects: [{ id, access }] }` → `{ user, activation_url }`. Tạo tài khoản chưa kích hoạt, thêm thành viên các project đã chọn                                 |
| PATCH  | `/api/users/:name`                          | admin           | `{ role? }`                                                                                                                                                                  |
| DELETE | `/api/users/:name`                          | admin           | xoá tài khoản, mọi máy, mọi phiên; không xoá chính mình                                                                                                                      |
| POST   | `/api/users/:name/activation`               | admin           | tạo lại link (kích hoạt hoặc đặt lại mật khẩu); link cũ hết hiệu lực                                                                                                         |
| GET    | `/api/users`                                | admin           | `[{ name, role, activated, created_at, last_login, last_seen (máy), devices: n, projects: [{ id, name, access }] }]`                                                         |
| GET    | `/api/activate/:code`                       | công khai       | `{ user, kind: "activate" \| "reset" }` hoặc 400 khi hết hạn hay đã dùng                                                                                                     |
| POST   | `/api/activate/:code`                       | công khai       | `{ password }` (≥ 8 ký tự) → đặt mật khẩu, trả phiên đăng nhập như `/login`                                                                                                  |
| GET    | `/api/me/devices`                           | người đăng nhập | máy của tôi                                                                                                                                                                  |
| DELETE | `/api/me/devices/:id`                       | người đăng nhập | thu hồi một máy (admin thu hồi được máy của người khác qua `/api/users/:name/devices/:id`)                                                                                   |
| PUT    | `/api/me/password`                          | người đăng nhập | `{ current, password }`                                                                                                                                                      |
| GET    | `/api/connect/:user_code`                   | người đăng nhập | `{ device_name, platform, created_at }` hoặc 404                                                                                                                             |
| POST   | `/api/connect/:user_code/approve` \| `deny` | người đăng nhập | gắn máy vào tài khoản đang đăng nhập                                                                                                                                         |
| POST   | `/v1/connect/start`                         | công khai       | `{ device_name, platform }` → `{ device_code, user_code, verify_url, interval: 2, expires_at }`                                                                              |
| POST   | `/v1/connect/poll`                          | công khai       | `{ device_code }` → `{ status: "pending" }` \| `{ status: "approved", user, token, device_id }` (token chỉ trả một lần) \| 400 hết hạn hoặc bị từ chối                       |
| GET    | `/v1/me`                                    | máy             | `{ user, device: { id, name }, projects: [{ id, name, access, repos: [repoKey…] }] }`. `repos` là `repoKey()` của `repo_url` và các alias, **không bao giờ** là URL có token |
| POST   | `/v1/me/logout`                             | máy             | thu hồi khoá của chính máy này                                                                                                                                               |
| POST   | `/v1/join`                                  | —               | trả 410: `Invite links are gone. Run: npx guide-the-vibe, then gtv login`                                                                                                    |

- Bỏ `/api/devs*` (dashboard không gọi nữa); `/health` vẫn cập nhật `last_seen` cho **thiết bị**.
- Giới hạn tần suất đơn giản cho `/v1/connect/start`, `/v1/connect/poll`, `/api/activate/*`, `/api/login` (ví dụ 30 lần/phút mỗi IP), để mã ngắn không bị dò.
- Token máy có tiền tố `gtvd_…`; token cũ `gtv_…` vẫn được nhận qua bảng `devices`.
- `user_code` hết hạn sau 10 phút, mỗi mã duyệt một lần, chỉ người đã đăng nhập mới duyệt được.

## 6. Dashboard

Chữ tiếng Việt, dùng thành phần và kiểu sẵn có (`styles/project.css` cho trang project; trang khác dùng kiểu hiện có, đọc token màu).

1. **Đăng nhập** (`LoginPage`): tên + mật khẩu. Server chưa có tài khoản nào và chạy không có admin token: trang **Tạo tài khoản quản trị đầu tiên**.
2. **`/activate/:code`** (công khai): "Chào hoc, đặt mật khẩu để bắt đầu", hai ô mật khẩu → đăng nhập luôn → trang **Kết nối máy của bạn**.
3. **Kết nối máy của bạn** (`/me`, cũng là trang "Tài khoản của tôi"):
   - hướng dẫn 3 bước với lệnh chép được: `npx guide-the-vibe`, `gtv login` (server điền sẵn `location.origin`), `gtv on`;
   - danh sách máy đã kết nối (tên, nền tảng, lần thấy cuối, Thu hồi);
   - đổi mật khẩu.
4. **`/connect`** (cần đăng nhập; chưa đăng nhập thì đăng nhập xong quay lại): ô mã (điền sẵn từ `?code=`), hiện "Máy **thaihoc-laptop** (linux) muốn kết nối vào tài khoản **hoc**", nút **Cho phép** / **Từ chối**, cảnh báo một dòng: "Chỉ cho phép nếu bạn vừa chạy gtv login trên máy của mình."
5. **Người** (`/people`, chỉ admin), thay cho trang Developers và Tài khoản:
   - bảng: người, quyền hệ thống, project và quyền trong từng project, số máy, thấy lần cuối, trạng thái (đã kích hoạt / chưa kích hoạt);
   - **Thêm người**: tên, Quản trị?, chọn project và quyền → hiện link kích hoạt để chép (hiện một lần, kèm câu gửi mẫu);
   - mỗi dòng: tạo lại link đặt mật khẩu, đổi quyền hệ thống, xem và thu hồi máy, xoá người.
6. **Thanh bên**: Tổng quan, AI trả lời (admin), Người (admin), avatar dẫn tới Tài khoản của tôi, đăng xuất. Xoá `pages/devs`, `pages/users` và route của chúng (chuyển `/devs`, `/users` → `/people`).
7. **Trang project**:
   - `ProjectDetail` thêm `my_access`; `useProject()` trả `access`.
   - Thay mọi `can("manager")` trong `pages/project/*` bằng quyền project. Developer thấy nút trả lời câu hỏi gửi cho mình và nút sửa việc của mình. Chỗ không có quyền: một dòng "Cần quyền quản lý" như hiện có.
   - Thiết lập chỉ hiện cho Quản lý.
   - **Thiết lập › Thành viên**: cột quyền (Quản lý / Developer / Người xem) sửa được. "Thêm thành viên" chọn từ danh sách người có sẵn. Bỏ "Mời người mới"; với admin thì thay bằng link "Tạo tài khoản ở trang Người".
   - **Cần xử lý**: "Liên quan tới" mặc định là người đang đăng nhập nếu họ là thành viên (đã có, giờ chắc chắn đúng). **Việc**: thêm lựa chọn "Của tôi" trong bộ lọc người, mặc định cho Developer.
8. **Tổng quan các project**: chỉ hiện project mình là thành viên. Người chưa thuộc project nào thấy: "Bạn chưa ở project nào. Nhờ quản trị thêm bạn."

## 7. CLI (gói `guide-the-vibe` 0.2.0)

Sửa `src/daemon/cli.ts`, `join.ts` (đổi tên thành `setup.ts` hoặc tách `login.ts` + `repo.ts`), `install.ts`, `config.ts`, `client.ts`, `scripts/build-npm.mjs`, `package.json` (version). **Mọi chữ in ra tiếng Anh**, ngắn, có ✔ / ! / ✘ như mẫu. Lỗi luôn kèm một lệnh cụ thể để sửa.

### Lệnh

```
gtv login [server]   Connect this computer to your account.
gtv on               Set up gtv for this repo (hooks, MCP server, skill) and start the background service.
gtv off              Remove gtv from this repo.
gtv status           Who you are, this computer, the background service; inside a repo: project, your role,
                     your tasks, what waits for you.
gtv doctor           Check everything and fix what it can.
gtv open             Open this repo's project in the browser.
gtv answer <id> "…"  Answer a question that waits for you.
gtv logout           Disconnect this computer (revokes its key, stops the background service).
gtv daemon start|stop|restart|status
gtv help | --version
```

Ẩn khỏi help, vẫn chạy: `hook`, `hook-wait`, `mcp`, `statusline`, `daemon` (chạy trong terminal), `link <project>` (gắn tay khi không khớp remote). `install` là bí danh của `on`; `join` in: `Invite links are gone. Run: gtv login`. Bỏ: `init`, `projects`, `project add`, `kb`, `features`, `snapshot`, `inbox`, `ack`, `dismiss` (thao tác trên dashboard).

### `npx guide-the-vibe` (không tham số)

Cài lệnh `gtv` lên máy rồi in `Next: gtv login`. Chạy lại = cập nhật.

- Bundle đã được chép vào `~/.gtv/bin/gtv.mjs` (cơ chế có sẵn).
- Linux/macOS: tạo `~/.gtv/bin/gtv` (sh: `exec node ~/.gtv/bin/gtv.mjs "$@"`). Nếu `~/.local/bin` nằm trên PATH thì tạo liên kết ở đó; nếu không, thêm một dòng `export PATH="$HOME/.gtv/bin:$PATH"` vào `~/.bashrc` / `~/.zshrc` (chỉ file đã tồn tại, không thêm trùng) và nói rõ đã sửa file nào.
- Windows: `gtv.cmd` trong `%LOCALAPPDATA%\Microsoft\WindowsApps` (có sẵn trên PATH); không được thì in dòng `setx` cần chạy.
- Khi được gọi với lệnh (`npx guide-the-vibe login …`) thì chạy lệnh đó như `gtv`.

### `gtv login [server]`

1. Không có tham số và đang ở terminal: hỏi `? Your gtv server:`, gợi sẵn server cũ trong ngoặc nếu có. Chấp nhận có hoặc không `https://`, có `/` cuối; thử `https://` trước, tới không được thì `http://` cho `localhost` / `127.0.0.1`.
2. `GET <server>/health` phải trả JSON có `ok`; nếu không: `✘ No gtv server at <url>`.
3. `POST /v1/connect/start` với `device_name = os.hostname()`, `platform = process.platform`. In URL `<server>/connect?code=<user_code>` và mã; cố mở trình duyệt (`xdg-open` / `open` / `start`, im lặng nếu lỗi); poll mỗi 2 giây tới khi duyệt, từ chối hoặc hết hạn (in thông báo phù hợp).
4. Lưu `~/.gtv/config.json`: `{ server, dev: user, token, device_id }` (quyền file 600 trên Unix). Khởi động lại daemon nếu đang chạy với tài khoản khác (đã có `ensureDaemon` so dấu vân tay token).
5. Đang trong một repo khớp project mà mình là thành viên: hỏi `Set up this repo too? (Y/n)` → chạy `on`.
6. Không ở terminal (script) và không có tham số → lỗi `Pass the server: gtv login <url>`.

### `gtv on`

1. Chưa đăng nhập → `✘ Not logged in. Run: gtv login`.
2. Không phải git repo → `✘ Not a git repository. Run gtv on inside your project's folder.`
3. `GET /v1/me`; so `repoKey(remote)` (dùng lại `repoKey` của server, chép sang `src/shared` nếu cần) với `repos` của từng project. Có `.git/gtv-project` (từ `gtv link`) thì ưu tiên nó.
4. Không khớp → `✘ This repo is not part of any project on <host>.` + gợi ý `git remote -v`. Khớp nhưng không phải thành viên hoặc chỉ là viewer → câu ở mục 4.
5. Tìm agent trên máy: Claude Code (`claude` trên PATH hoặc có `~/.claude`), Codex (`codex` trên PATH hoặc có `~/.codex`). Hỏi `? Agents on this computer: Claude Code, Codex. Set up both? (Y/n)`; trả lời n thì hỏi từng cái. Không tìm thấy agent nào thì vẫn cài cả hai và nói rõ.
6. Cài như `installClaude` / `installCodex` hiện có (hook, MCP, skill, statusline), ghi link `.git/gtv-project`.
7. **Giấu khỏi git:** thêm vào `.git/info/exclude`, trong một khối có đánh dấu `# gtv (managed)` … `# end gtv`, các đường dẫn gtv tạo: `.mcp.json`, `.claude/settings.local.json`, `.claude/skills/gtv-*/`, `.codex/`. Nếu file đã bị git theo dõi thì không đụng, chỉ cảnh báo.
8. Ghi repo vào `~/.gtv/repos.json` (`[{ path, project }]`), `ensureDaemon()`.
9. In kết quả như mẫu ở mục 9. Chạy lại không tạo gì trùng.

### `gtv off`

Gỡ **chỉ phần của gtv**: hook có đánh dấu gtv trong `.claude/settings.local.json` và `.codex/hooks.json`, mục `gtv` trong `.mcp.json` và `[mcp_servers.gtv]` trong `.codex/config.toml`, thư mục skill của gtv, statusline nếu là của gtv, khối exclude, link, dòng trong `repos.json`. Xoá file chỉ khi nó rỗng sau khi gỡ. In những gì đã gỡ.

### `gtv status`

- Ngoài repo: `hoc @ gtv.tenantry.site · computer thaihoc-laptop · background service running (port 7391)`, rồi các repo đã bật và project của chúng.
- Trong repo đã bật: dòng trên + `Realworld API (developer)`, **Your tasks** (từ bảng việc), **Waiting for you** (vụ đụng nhau có mình, câu hỏi gửi cho mình, kèm id và gợi ý `gtv answer` / `gtv open`).
- Chưa đăng nhập hay daemon tắt: nói rõ và in lệnh sửa.

### `gtv doctor`

Lần lượt, mỗi dòng ✔ / ! (đã sửa) / ✘ (cần người làm):

- tới được server;
- khoá máy còn hiệu lực (401 → `Run: gtv login`);
- daemon chạy và đúng tài khoản (sửa: khởi động lại);
- với mỗi repo trong `repos.json`: còn tồn tại, hook không bị trùng (gỡ bản thừa), hook cài từ phiên bản cũ thì cài lại, vẫn còn là thành viên;
- agent nào đã cài trên máy mà repo chưa bật.

### `gtv logout`

`POST /v1/me/logout`, tắt daemon, xoá `token` khỏi config (giữ `server` để lần sau gợi ý). Giữ nguyên bản cài trong các repo; in `Repos keep their setup; run gtv off in a repo to remove it.`

### Daemon

- Nhận 403 "not a member" từ server: một lần cho mỗi phiên agent, chèn vào agent câu tiếng Anh ở mục 4; không lặp lại mỗi lần gọi.
- `x-gtv-dev` vẫn gửi, nhưng server lấy danh tính từ token.

## 8. Test

Không gọi LLM thật. Dùng các khuôn trong `test/` (`startServer` với `listen: false`, `makeOrigin`).

- `test/accounts.test.ts` (viết lại):
  - tạo người → link kích hoạt → đặt mật khẩu → đăng nhập;
  - link dùng hai lần hoặc hết hạn → 400;
  - đổi quyền hệ thống;
  - xoá người thì thu hồi máy và phiên;
  - chuyển dữ liệu cũ (devs, users manager/viewer → member + quyền project; token cũ vẫn chạy).
- `test/connect.test.ts` (mới):
  - start → approve bằng phiên đăng nhập → poll nhận token một lần, poll lại không còn token;
  - deny;
  - hết hạn;
  - khoá máy gọi được `/v1/me` và route agent;
  - logout thu hồi.
- `test/permissions.test.ts` (mới):
  - viewer chỉ đọc;
  - developer trả lời được câu hỏi gửi cho mình nhưng không trả lời được câu gửi người khác;
  - developer sửa được việc của mình, không sửa được việc người khác, không đổi được người làm;
  - manager làm được hết trong project của mình, không làm được ở project khác;
  - người không phải thành viên → 404 trên dashboard API và 403 trên route agent;
  - overview chỉ liệt kê project của mình;
  - giao việc cho người ngoài project → 400.
- CLI: test hàm thuần cho:
  - khối exclude (thêm, chạy lại không trùng, gỡ sạch);
  - gỡ phần của gtv khỏi `settings.local.json`, `.mcp.json`, `hooks.json`, `config.toml` mà giữ nguyên phần của người dùng;
  - chuẩn hoá URL server;
  - khớp repo với `/v1/me`.
- Sửa các test cũ đang dùng `/api/devs`, `/v1/join`, `issueToken`, `createInvite` (`admin.test.ts`, `server.test.ts`, `board.test.ts`, `work-unified.test.ts`, `pi.test.ts`, `incidents.test.ts`, `docs.test.ts`): tạo tài khoản + thiết bị bằng helper mới trong `test/helpers.ts`, hoặc dùng `admin_token` + `x-gtv-dev` như hiện có. Người đóng vai dev phải là thành viên project trước khi agent của họ gọi.
- **Chạy thử đầu cuối trên máy này** (ghi kết quả vào báo cáo cuối):
  1. chạy server local (`npm run demo`, cổng 7395, hoặc server trống với `GTV_DATA` tạm);
  2. `GTV_HOME=<thư mục tạm>`;
  3. chạy bundle `dist/npm` với `node dist/npm/gtv.mjs`, làm đủ chuỗi: cài lệnh (với `HOME` tạm), `login` (duyệt bằng API với phiên admin), `on` trong một bản clone, `status`, `doctor`, `off`, `logout`.

## 9. Mẫu chữ của CLI

```
$ npx guide-the-vibe
✔ Installed gtv 0.2.0 → ~/.gtv/bin/gtv
✔ Added gtv to your PATH (open a new terminal if `gtv` is not found)

Next: gtv login

$ gtv login
? Your gtv server: https://gtv.tenantry.site
✔ Found gtv at gtv.tenantry.site

Open this page to approve this computer:
  https://gtv.tenantry.site/connect?code=KQ7M-2XPD
Code: KQ7M-2XPD

Waiting for approval… (Ctrl+C to cancel)
✔ This computer (thaihoc-laptop) is connected as hoc

Next: in a project repo, run  gtv on

$ gtv on
✔ This repo belongs to Realworld API (you are a developer)
? Agents on this computer: Claude Code, Codex. Set up both? (Y/n)
✔ Claude Code: hooks, MCP server, skill
✔ Codex: hooks, MCP server, skill
✔ Kept out of git (.git/info/exclude)
✔ Background service running

Done. Start a new agent session and gtv takes it from there.
```

## 10. Tài liệu

- **`docs/cli.md` (mới, tiếng Việt, lệnh và chữ ví dụ giữ tiếng Anh): hướng dẫn dùng CLI.** Gồm:
  - cài đặt (`npx guide-the-vibe`), đăng nhập, bật trong repo, hằng ngày (`status`, `open`, `answer`), sửa lỗi (`doctor`, bảng triệu chứng → lệnh), gỡ (`off`, `logout`);
  - file `gtv on` ghi vào repo và vì sao chúng không bị commit;
  - nhiều máy, đổi tài khoản, đổi server;
  - câu hỏi thường gặp.
- `README.md` (tiếng Anh): mục Getting started theo luồng mới (admin tạo người → người dùng kích hoạt → `npx guide-the-vibe` → `gtv login` → `gtv on`), link tới `docs/cli.md`.
- `docs/api.md`: thêm mục 5, bỏ `/api/devs`, `/v1/join`, viết lại bảng quyền theo mục 4.
- `docs/agents.md`, `docs/operations.md`, `docs/architecture.md`, `docs/features.md`: thay mọi chỗ nói về developer token, lời mời, `gtv join`, `gtv init`.
- `docs/backlog.md`: xoá mục "tài khoản chưa gắn với tên dev"; thêm việc còn lại nếu có.
- Hướng dẫn trên `~/www/gtv-huong-dan.html` **không sửa** (ngoài repo).

## 11. Thứ tự làm và commit

Mỗi bước một commit thẳng lên `main` (thông điệp tiếng Anh dạng mệnh lệnh, kết thúc bằng dòng `Co-Authored-By` mà hệ thống yêu cầu). Trước mỗi commit: `npm run check` và `npm run web:build`. Đẩy lên ngay sau mỗi commit.

1. **Server:** bảng mới, chuyển dữ liệu, principal và quyền theo project, API mục 5, bỏ tự thêm thành viên, sửa test cũ, test mới.
2. **Dashboard:** đăng nhập và tạo admin đầu tiên, kích hoạt, `/connect`, Tài khoản của tôi, Người, thanh bên, quyền trong trang project, Thành viên có quyền, "Của tôi".
3. **CLI:** cài lệnh, `login`/`on`/`off`/`status`/`doctor`/`open`/`answer`/`logout`, ẩn lệnh máy, chữ tiếng Anh, test hàm thuần, chạy thử đầu cuối, version 0.2.0, `npm run build:npm`.
4. **Tài liệu** (mục 10).
5. **Deploy** (mục 12).

## 12. Deploy lên tokyo-lxd

Đã có quyền: `ssh tokyo-lxd` (key `~/.ssh/tokyo-lxd`), repo ở `~/Workspace/int3507/guide-the-vibe`, đọc được repo private.

1. Đợi CI của commit cuối xanh: `gh run list -R hienduc14/guide-the-vibe -L 1`.
2. **Sao lưu dữ liệu trước:**
   ```
   ssh tokyo-lxd 'sudo -n docker cp gtv-operator-1:/data /home/ubuntu/gtv-data-backup-$(date +%Y%m%d-%H%M)'
   ```
   Kiểm tra trước đường dẫn dữ liệu trong container (`GTV_DATA` trong `docker/compose.yml`).
3. Deploy:
   ```
   ssh tokyo-lxd 'cd ~/Workspace/int3507/guide-the-vibe && git pull --ff-only && C="sudo -n docker compose -f docker/compose.yml -f docker/compose.local.yml --env-file docker/.env -p gtv" && $C build --build-arg GTV_COMMIT=$(git rev-parse HEAD) && $C up -d'
   ```
4. Kiểm tra qua đường hầm `127.0.0.1:7390` (token admin trong `docker/.env` của bản clone ở `/home/ubuntu/Workspace/int3507/guide-the-vibe`):
   - `/health` có commit mới;
   - `GET /api/users` liệt kê `hoc`, `hoc-xem`, `hien`, `hien-test`, `khanh`… với quyền đúng;
   - đăng nhập `hoc` bằng mật khẩu cũ vẫn được;
   - token dev cũ vẫn gọi được `/v1/p/realworld/state` (không cần biết token: kiểm tra bảng `devices` có `token_hash` của các dev cũ);
   - chụp màn hình trang Người và Tài khoản của tôi bằng bộ chụp có sẵn ở `/tmp/claude-1001/-home-ubuntu-Workspace-int3507/2f3cb64c-dfdd-464b-8849-05624c5422b6/scratchpad/shots/shot.mjs`.
5. Có lỗi thì quay lại commit trước như `docs/operations.md` hướng dẫn, và chép dữ liệu sao lưu trở lại nếu bước chuyển dữ liệu đã làm hỏng gì.

## 13. Không làm

- **Không `npm publish`.** Build `dist/npm` 0.2.0 và để sẵn. Chủ dự án tự publish bằng `npm publish --auth-type=web` trong `dist/npm`.
- Không sửa cấu hình chung của Claude Code / Codex trên máy (`~/.claude`, `~/.codex`) khi chạy thử: dùng `HOME` tạm.
- Không đụng tới `~/.hermes`, container LXD `hai`, Cloudflare.
- Không tạo Claude Artifact.

## 14. Môi trường

- Node 24: `export PATH=$HOME/.nvm/versions/node/v24.22.2/bin:$PATH` (node mặc định là 22).
- Dependencies đã cài (`node_modules`, `web/node_modules`).
- Chụp màn hình: `playwright-core` trong thư mục `shots/` ở trên, Chromium ở `~/.cache/ms-playwright/chromium-1248`.
- Server mẫu: `npm run demo` (cổng 7395, token `demo-admin`). Có thể đang chạy sẵn từ phiên trước: kiểm tra cổng, tắt rồi chạy lại sau khi đổi code server.

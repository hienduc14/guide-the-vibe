# Kế hoạch: làm lại người dùng, đăng nhập, quyền và máy

Viết ngày 27/11/2026, dựa trên bản `07e86b9`. Bản này **thay** mô hình "quản trị tạo tài khoản, gửi link kích hoạt"
của `accounts-and-cli.md`. Phần kết nối máy (`gtv login` duyệt trên trình duyệt) và `gtv on` theo từng repo **giữ lại**.
Người làm đọc hết file trước khi sửa code. Mục 14 là những câu chủ dự án đã chốt.

## 1. Bản hiện tại dở ở đâu

| Chỗ dở                                                                                                               | Hậu quả                                                                   |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Không ai tự đăng ký được: quản trị tạo hộ, gửi link kích hoạt                                                        | Quản trị thành nút cổ chai; người mới phải chờ                            |
| Chỉ quản trị server tạo được project                                                                                 | Nhóm sinh viên không tự dựng project của mình được                        |
| Không có lời mời vào project; quản lý chỉ "thêm thành viên" từ danh sách tài khoản có sẵn                            | Muốn thêm ai phải nhờ quản trị tạo tài khoản trước                        |
| Quyền trong project nằm ở db của từng project và chỉ đọc được khi project đang mở trong bộ nhớ (`hub.projectAccess`) | Server vừa khởi động thì người thường thấy "không có project nào" một lúc |
| Trang máy chỉ có tên máy và lần thấy cuối                                                                            | Không biết máy nào có agent gì, đã bật repo nào, đang chạy phiên nào      |
| Phiên đăng nhập là token trong `localStorage`                                                                        | Một lỗi XSS là lộ phiên                                                   |
| Không có tên hiển thị, không xem/đăng xuất được các phiên khác                                                       | Thiếu những thứ người dùng coi là mặc định                                |

## 2. Mô hình

```
Tài khoản (hoc)                         Project (realworld-api)
 ├─ Phiên đăng nhập (trình duyệt)        ├─ Thành viên: hoc = Quản lý, bob = Developer, cô Lan = Người xem
 └─ Máy (thaihoc-laptop, lab-pc)          ├─ Lời mời (link, quyền, hạn, số lượt)
     ├─ Agent có trên máy: Claude Code, Codex
     └─ Repo đã bật (gtv on) ──────────► thuộc một project mà hoc là thành viên
         └─ Phiên agent đang chạy ──────► hiện trên trang Bây giờ của project đó
```

- **Một người, một tài khoản.** Tên đăng nhập (`hoc`) là danh tính trong mọi bản ghi của project (việc, dấu chân,
  đụng nhau), nên **không đổi được**. Tên hiển thị ("Thái Học") đổi thoải mái.
- **Một máy, một khoá**, gắn với tài khoản, không gắn với project. Khoá đó làm việc được ở **mọi project** mà người đó
  là Developer hoặc Quản lý. Vào project mới không cần `gtv login` lại.
- **Project là nhóm.** Không thêm tầng tổ chức/nhóm riêng: thành viên và quyền nằm ở từng project. Project luôn riêng
  tư: chỉ thành viên thấy nó.
- **Quản trị server** chỉ lo server: cấu hình AI, danh sách tài khoản (khoá, tạo link đặt lại mật khẩu), chế độ đăng ký.
  Quản trị không cần tham gia project để server chạy.

## 3. Vai trò và quyền

### 3.1 Cấp server

| Ai              | Làm được                                                                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Khách           | đăng nhập, đăng ký (nếu server cho), xem trang lời mời (chỉ tên project, quyền, người mời), xem qua link chia sẻ chỉ đọc                 |
| Người dùng      | mọi thứ của mình (hồ sơ, mật khẩu, phiên, máy), tạo project, nhận lời mời, rời project                                                   |
| Quản trị server | thêm: cấu hình AI, danh sách tài khoản (khoá/mở, cấp quyền quản trị, link đặt lại mật khẩu, xoá), chế độ đăng ký; xem và cứu mọi project |

Tài khoản đầu tiên trên server trống là quản trị (mục 4.1). `GTV_ADMIN_TOKEN` vẫn nhận, chỉ dùng cứu hộ, script, test.

### 3.2 Cấp project

Ba quyền như bây giờ. Người tạo project là **Quản lý**. Project luôn có ít nhất một Quản lý: không hạ quyền, không xoá,
không cho rời project người Quản lý cuối cùng.

| Việc                                                                         | Người xem | Developer |       Quản lý        |
| ---------------------------------------------------------------------------- | :-------: | :-------: | :------------------: |
| Xem mọi trang của project                                                    |     ✔     |     ✔     |          ✔           |
| Agent trên máy làm việc trong project (`gtv on`, hook, MCP)                  |           |     ✔     |          ✔           |
| Trả lời câu hỏi gửi cho mình hoặc gửi cả nhóm                                |           |     ✔     |          ✔           |
| Sửa việc được giao cho mình (trạng thái, mô tả, ghi chú)                     |           |     ✔     |          ✔           |
| Tạo việc (giao cho mình hoặc để trống người làm)                             |           |     ✔     |          ✔           |
| Giao việc cho người khác, sửa việc người khác, xoá việc                      |           |           |          ✔           |
| Sửa tài liệu, ghi chú kiến thức                                              |           |     ✔     |          ✔           |
| Xử lý vụ đụng nhau, đổi luật canh, tính năng AI, thông tin repo              |           |           |          ✔           |
| Thành viên: thêm, đổi quyền, xoá; tạo/thu hồi link mời; link chia sẻ chỉ đọc |           |           |          ✔           |
| Lưu trữ (xoá) project                                                        |           |           |          ✔           |
| Rời project                                                                  |     ✔     |     ✔     | ✔ (trừ Quản lý cuối) |

Người không phải thành viên: dashboard trả 404 (không lộ project có tồn tại), máy trả 403 kèm câu nhắc rõ ràng.

## 4. Các luồng

### 4.1 Dựng server lần đầu

1. Server chưa có tài khoản nào: mọi trang chuyển về `/setup` **Tạo tài khoản quản trị**.
2. Nếu server có `GTV_ADMIN_TOKEN`, trang hỏi thêm token đó (người lạ không giành được quyền quản trị trên server
   công khai). Không có token (máy cá nhân, demo): ai mở trước người đó làm quản trị.
3. Tạo xong là đăng nhập luôn, vào trang chủ.

### 4.2 Đăng ký, đăng nhập, đăng xuất

- **Đăng ký** `/signup`: tên đăng nhập, tên hiển thị, mật khẩu (≥ 8 ký tự, nhập 2 lần). Xong là đăng nhập.
  - Tên đăng nhập: chữ thường, số, `.` `_` `-`, 3–32 ký tự, không trùng, không dùng tên dành riêng
    (`admin`, `root`, `gtv`, `system`, `everyone`, `all`, `share`, `me`, `api`).
  - Có link mời trong URL (`/signup?invite=…`) thì đăng ký xong vào thẳng project đó.
  - Chế độ đăng ký do quản trị chọn: **Mở** (mặc định), **Chỉ khi có link mời**, **Đóng**.
- **Đăng nhập** `/login`: tên đăng nhập + mật khẩu. Sai 10 lần/phút mỗi IP thì chặn một phút (đã có `rateLimited`).
  Có `?next=` để quay lại trang đang định vào (lời mời, `/connect`).
- **Phiên**: cookie `gtv_session` httpOnly, `SameSite=Lax`, `Secure` khi chạy https, 30 ngày, gia hạn khi dùng.
  Lệnh ghi (không phải GET) phải có `Origin` trùng server (chống CSRF). Bỏ token trong `localStorage`.
- **Đăng xuất**: xoá phiên hiện tại. Trang Tài khoản có danh sách phiên (trình duyệt, IP, lần dùng cuối) và
  "Đăng xuất mọi nơi khác".
- **Quên mật khẩu**: server không gửi email, nên người dùng nhờ quản trị. Quản trị bấm "Tạo link đặt lại mật khẩu"
  (dùng một lần, 1 giờ), gửi qua chat. Đặt lại xong: mọi phiên cũ bị đăng xuất, **máy giữ nguyên**.

### 4.3 Tạo project

Ai đăng nhập cũng tạo được. Chưa giới hạn số project (chủ dự án chốt 27/11).

1. Trang chủ → **Tạo project** → form: tên, mã (tự sinh từ tên, sửa được), địa chỉ repo, nhánh chính
   (mặc định `main`).
2. Server kiểm tra địa chỉ repo **trước** khi tạo: chỉ `https://…` hoặc `git@host:owner/repo`; từ chối `file://`,
   đường dẫn trên máy, `localhost` và địa chỉ mạng nội bộ; chạy `git ls-remote` (hết giờ sau 15 giây) để báo ngay
   "không đọc được repo này, nếu repo riêng tư hãy dán URL có token chỉ-đọc".
3. Tạo xong: người tạo là Quản lý, vào trang project, thấy thẻ **Mời thành viên** và **Bật trên máy của bạn**.

### 4.4 Mời người vào project

Hai cách, đều ở **Thiết lập › Thành viên**:

- **Link mời** (cách chính). Quản lý chọn quyền (Developer hoặc Người xem; không mời thẳng Quản lý, muốn thì nâng
  sau), hạn (1 / 7 / 30 ngày, mặc định 7), số lượt (1, 10, không giới hạn; mặc định không giới hạn). Được link dạng
  `https://gtv.tenantry.site/join/Xk3…` kèm câu gửi mẫu. Danh sách link đang hiệu lực: quyền, người tạo, đã dùng mấy
  lượt, hết hạn khi nào, nút Thu hồi.
- **Thêm theo tên đăng nhập**: gõ tên người đã có tài khoản, chọn quyền, thêm ngay.

### 4.5 Nhận lời mời

```
Mở /join/Xk3…
 ├─ Link sai, hết hạn, hết lượt, bị thu hồi → "Link này không dùng được nữa. Nhờ người mời gửi link mới."
 ├─ Chưa đăng nhập → thẻ lời mời + hai nút: "Đăng nhập để tham gia" / "Tạo tài khoản"
 │                    (đăng nhập hoặc đăng ký xong tự quay lại đây)
 ├─ Đã là thành viên → "Bạn đã ở project này" + nút Mở project (không đổi quyền hiện có)
 └─ Đã đăng nhập     → "bob mời bạn vào Realworld API với quyền Developer" + nút Tham gia
                         └─ Tham gia → vào project, thẻ chào: "Bật gtv trên máy của bạn" (3 lệnh, mục 8)
```

Thẻ lời mời cho khách chỉ lộ tên project, quyền, tên người mời. Không lộ repo hay thành viên.

### 4.6 Kết nối máy (`gtv login`)

Giữ nguyên luồng duyệt trên trình duyệt đang có (mục 8.2). Chỉ đổi: trang `/connect` khi chưa đăng nhập thì đăng nhập
hoặc đăng ký xong quay lại đúng mã.

### 4.7 Rời project, bị xoá, xoá tài khoản

- **Rời project** (Thiết lập › Thành viên › Rời project, hoặc trang chủ): mất quyền ngay. Máy của người đó nhận 403
  ở project này từ lần gọi tiếp theo; daemon báo một lần cho agent.
- **Bị Quản lý xoá**: như trên. Lịch sử (việc đã làm, câu hỏi, đụng nhau) giữ nguyên với tên người đó.
- **Xoá tài khoản** (tự xoá ở Tài khoản, hoặc quản trị xoá): xoá phiên, máy, tư cách thành viên. Không xoá được nếu
  đang là Quản lý cuối của một project nào đó (phải giao lại trước). Tên đăng nhập **không** cấp lại cho người khác
  (giữ một dòng `deleted_at`), để lịch sử không bị nhận nhầm người.
- **Quản trị khoá tài khoản**: không đăng nhập được, máy bị từ chối; mở khoá là chạy lại như cũ.

## 5. Màn hình

Chữ tiếng Việt, dùng thành phần và màu sẵn có (`DESIGN.md`, `styles/`). Làm **prototype tĩnh trước** trong
`gtv-prototype/auth/` (sáng + tối) để chủ dự án duyệt, như lần thiết kế trang project.

| Đường dẫn                 | Màn hình                                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/setup`                  | Tạo tài khoản quản trị (chỉ khi server trống)                                                                                                                                         |
| `/login`, `/signup`       | Đăng nhập, Đăng ký. Bố cục một cột giữa trang, logo, câu giới thiệu ngắn về gtv, link qua lại giữa hai trang                                                                          |
| `/reset/:code`            | Đặt lại mật khẩu                                                                                                                                                                      |
| `/`                       | **Project của tôi**: thẻ từng project (quyền của tôi, số người, việc/câu hỏi đang chờ tôi), nút Tạo project. Chưa có project: hai lựa chọn "Tạo project" / "Có link mời? Dán vào đây" |
| `/new`                    | Tạo project (mục 4.3). `?repo=owner/repo` điền sẵn (CLI dẫn tới đây)                                                                                                                  |
| `/join/:code`             | Nhận lời mời (mục 4.5)                                                                                                                                                                |
| `/connect`                | Duyệt máy (có sẵn)                                                                                                                                                                    |
| `/account`                | **Tài khoản**: tên hiển thị, đổi mật khẩu, các phiên đăng nhập, xoá tài khoản                                                                                                         |
| `/account/devices`        | **Máy của tôi** (mục 5.1)                                                                                                                                                             |
| `/p/:id/settings/members` | **Thành viên**: danh sách + quyền sửa được + link mời + thêm theo tên + rời project (mục 5.2)                                                                                         |
| `/admin/users`            | Quản trị › Tài khoản: tìm, quyền quản trị, khoá/mở, link đặt lại mật khẩu, xoá; cột số project, số máy, lần thấy cuối                                                                 |
| `/admin/settings`         | Quản trị › Server: chế độ đăng ký                                                                                                                                                     |
| `/brain`                  | AI trả lời (giữ, chỉ quản trị)                                                                                                                                                        |

Thanh bên: Project của tôi (danh sách project), Tạo project, rồi dưới cùng avatar → Tài khoản / Máy của tôi / Đăng
xuất. Nhóm **Quản trị** (Tài khoản, Server, AI) chỉ hiện cho quản trị. Bỏ trang Người (`/people`) và trang kích hoạt.

### 5.1 Máy của tôi

```
Máy của tôi                                                           [+ Kết nối máy mới]

┌ thaihoc-laptop · linux · gtv 0.2.0 ────────────────────── ● đang kết nối ─ [Đổi tên] [Ngắt] ┐
│ Agent:  Claude Code 2.4.1   Codex 0.99                                                    │
│ Repo đã bật                                                                               │
│   ~/code/realworld-api   → Realworld API   Claude Code, Codex   1 phiên đang chạy (Codex) │
│   ~/code/shop            → Shop BTL        Claude Code                                    │
└───────────────────────────────────────────────────────────────────────────────────────────┘
┌ lab-pc · win32 · gtv 0.1.2 ────────────────────── thấy 3 ngày trước ─ [Đổi tên] [Ngắt] ┐
│ Máy này chạy bản gtv cũ và chưa gửi thông tin agent. Cập nhật: npx guide-the-vibe@latest   │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

- "Đang kết nối" = daemon trên máy đã liên lạc với server trong 60 giây qua. Không thì "thấy … trước".
- Agent và repo do daemon báo lên (mục 6.4). Đường dẫn repo chỉ chủ máy (và quản trị) thấy; thành viên project chỉ
  thấy tên máy.
- **Ngắt** = thu hồi khoá: daemon trên máy đó nhận 401 và báo `Run: gtv login`.
- "Kết nối máy mới" mở hướng dẫn 3 lệnh (mục 8).

### 5.2 Thành viên (Thiết lập của project)

```
Thành viên (4)                                       [Mời bằng link]  [Thêm theo tên]
  TH  Thái Học   hoc        Quản lý ▾      2 máy · đang làm         (bạn)
  B   Bob        bob        Developer ▾    1 máy · thấy 2 giờ trước  [Xoá]
  L   Cô Lan     lan        Người xem ▾    —                         [Xoá]

Link mời đang hiệu lực
  Developer · tạo bởi hoc · 3/∞ lượt · hết hạn 4/12     [Chép link] [Thu hồi]

Link xem không cần tài khoản (chỉ đọc)                (link chia sẻ có sẵn, giữ nguyên)

[Rời project]
```

Hồ sơ trong project (vai trò công việc frontend/backend, cấp độ, ghi chú cho AI) giữ như hiện có, mở ra từ từng dòng.

## 6. Dữ liệu (`hub.db`)

### 6.1 Bảng

| Bảng                                         | Cột                                                                                                                                               | Ghi chú                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `users`                                      | `name` PK, `display_name`, `role` (`admin`\|`member`), `pass_hash` NOT NULL, `created_at`, `last_login`, `disabled_at`, `deleted_at`              | thêm `display_name`, `disabled_at`, `deleted_at`; bỏ `created_by` |
| `user_sessions`                              | `token_hash` PK, `user`, `created_at`, `expires_at`, `last_used`, `user_agent`, `ip`                                                              | thêm 3 cột cuối cho danh sách phiên                               |
| `project_members`                            | `project`, `user`, `access` (`manager`\|`developer`\|`viewer`), `joined_at`, `invited_by`; PK (`project`, `user`)                                 | **mới, nguồn duy nhất về quyền**; đọc được khi project chưa mở    |
| `project_invites`                            | `id`, `project`, `code_hash` UNIQUE, `access`, `created_by`, `created_at`, `expires_at`, `max_uses` (NULL = không giới hạn), `uses`, `revoked_at` | mới                                                               |
| `password_resets`                            | `code_hash` PK, `user`, `expires_at`, `created_at`                                                                                                | đổi tên từ `activations`                                          |
| `devices`                                    | thêm `gtv_version`, `agents` (JSON `[{kind, version}]`), `reported_at`                                                                            | có sẵn                                                            |
| `device_repos`                               | `device`, `path`, `project`, `agents` (JSON), `updated_at`; PK (`device`, `path`)                                                                 | mới; daemon báo lên                                               |
| `device_requests`, `share_links`, `projects` | giữ                                                                                                                                               | `projects` thêm `created_by`                                      |
| `settings`                                   | khoá mới: `registration` (`open`\|`invite`\|`closed`)                                                                                             |                                                                   |
| `devs`, `invites`, `activations`             | xoá (dữ liệu thật đã xoá sạch hôm 27/11, không cần giữ để quay lại)                                                                               |                                                                   |

Trong db từng project:

- `members` giữ làm **hồ sơ trong project** (`role` công việc, `level`, `note`), bỏ cột `access`. Danh sách thành viên
  mà engine và AI dùng lấy từ `hub.project_members`, ghép hồ sơ nếu có. Truyền vào engine một hàm
  `members(): {user, access, profile?}[]` thay cho `store.members()`.
- `sessions` thêm `device` (id máy, lấy từ khoá máy khi daemon đăng ký phiên), để trang Bây giờ hiện
  "hoc · thaihoc-laptop · Codex" và trang Máy của tôi đếm phiên đang chạy.

### 6.2 Chuyển dữ liệu

Server thật hiện chỉ có `hoc` chưa kích hoạt, không có project. **Không viết bước chuyển dữ liệu**: deploy lên một
volume trống (sao lưu trước như lần trước). Bản local và test tạo lại từ đầu. Bỏ `Hub.migrateAccounts`,
`upgradeUsersTable` và test của chúng.

### 6.3 Quyền: một chỗ duy nhất

`hub.projectAccess(principal, projectId)` đọc `project_members` (đồng bộ, không cần runtime). Quản trị server,
`admin_token`, `open` → `manager`; link chia sẻ → `viewer` ở đúng project của nó. Tài khoản bị khoá hoặc đã xoá →
mọi principal của họ là `undefined` (401).

`auth.ts`: viết lại `apiDenied` theo bảng ở mục 7 (danh sách route → quyền tối thiểu), thay cho chuỗi `if` theo regex
hiện nay. `projectDenied` giữ các ngoại lệ cho Developer (trả lời câu hỏi của mình, sửa việc của mình).

### 6.4 Máy báo thông tin lên

- `POST /v1/me/device` `{ gtv_version, agents: [{kind, version}], repos: [{path, project, agents}] }`, daemon gọi khi
  khởi động, sau mỗi `gtv on`/`gtv off`, và mỗi 6 giờ. Server ghi đè `device_repos` của máy đó.
- Tìm agent: `claude --version`, `codex --version` (hết giờ 3 giây, lỗi thì bỏ qua). Danh sách repo lấy từ
  `~/.gtv/repos.json` có sẵn.
- "Đang kết nối" = `devices.last_seen` trong 60 giây qua (daemon đã gọi `/health` bằng khoá máy mỗi 15 giây, và
  `/health` đã cập nhật `last_seen`). Không cần theo dõi luồng sự kiện.

## 7. API

Bỏ: `/api/users*`, `/api/activate/*`, `/api/people`, `activation_url`. Mọi thứ khác ở `/api/projects/:id/*` và
`/v1/p/:id/*` giữ nguyên, chỉ đổi cách kiểm quyền.

| Method          | Path                                        | Ai                       | Mô tả                                                                                        |
| --------------- | ------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------- |
| GET             | `/api/auth/config`                          | công khai                | `{ setup_needed, registration, needs_admin_token }`                                          |
| POST            | `/api/auth/setup`                           | công khai, server trống  | `{ name, display_name, password, admin_token? }` → tạo quản trị, đặt cookie                  |
| POST            | `/api/auth/signup`                          | công khai                | `{ name, display_name, password, invite? }` → tạo tài khoản, đặt cookie, nhận lời mời nếu có |
| POST            | `/api/auth/login`                           | công khai                | `{ name, password }` → đặt cookie                                                            |
| POST            | `/api/auth/logout`                          | đã đăng nhập             | xoá phiên hiện tại                                                                           |
| GET/POST        | `/api/auth/reset/:code`                     | công khai                | xem / đặt mật khẩu mới từ link đặt lại                                                       |
| GET             | `/api/me`                                   | đã đăng nhập             | `{ name, display_name, role, projects: [{id, name, access}] }`                               |
| PATCH           | `/api/me`                                   | đã đăng nhập             | `{ display_name }`                                                                           |
| PUT             | `/api/me/password`                          | đã đăng nhập             | `{ current, password }`; đăng xuất các phiên khác                                            |
| GET/DELETE      | `/api/me/sessions`, `/api/me/sessions/:id`  | đã đăng nhập             | phiên của tôi; xoá một phiên hoặc tất cả trừ phiên này                                       |
| DELETE          | `/api/me`                                   | đã đăng nhập             | xoá tài khoản (cần mật khẩu)                                                                 |
| GET             | `/api/me/devices`                           | đã đăng nhập             | máy + agent + repo + số phiên đang chạy + đang kết nối                                       |
| PATCH/DELETE    | `/api/me/devices/:id`                       | đã đăng nhập             | đổi tên / ngắt máy                                                                           |
| GET/POST        | `/api/connect/:code`, `…/approve`, `…/deny` | đã đăng nhập             | giữ nguyên                                                                                   |
| GET             | `/api/invites/:code`                        | công khai                | `{ project_name, access, invited_by, valid }`                                                |
| POST            | `/api/invites/:code/accept`                 | đã đăng nhập             | thành thành viên; đã là thành viên thì giữ quyền cũ                                          |
| POST            | `/api/projects`                             | đã đăng nhập             | tạo project (kiểm repo); người tạo là Quản lý                                                |
| POST            | `/api/projects/check-repo`                  | đã đăng nhập             | `{ repo_url }` → đọc được hay không, nhánh mặc định                                          |
| DELETE          | `/api/projects/:id`                         | Quản lý                  | lưu trữ project                                                                              |
| GET             | `/api/projects/:id/members`                 | Người xem                | thành viên + quyền + hồ sơ + số máy, lần thấy cuối                                           |
| POST            | `/api/projects/:id/members`                 | Quản lý                  | `{ user, access }` thêm theo tên đăng nhập                                                   |
| PATCH           | `/api/projects/:id/members/:user`           | Quản lý                  | `{ access }`, giữ luật Quản lý cuối                                                          |
| DELETE          | `/api/projects/:id/members/:user`           | Quản lý, hoặc chính mình | xoá / rời project                                                                            |
| GET/POST/DELETE | `/api/projects/:id/invites[/:id]`           | Quản lý                  | link mời                                                                                     |
| GET             | `/api/admin/users`                          | quản trị                 | tài khoản + số project, số máy, lần thấy cuối                                                |
| PATCH           | `/api/admin/users/:name`                    | quản trị                 | `{ role?, disabled? }`; không tự hạ quyền mình nếu là quản trị cuối                          |
| POST            | `/api/admin/users/:name/reset`              | quản trị                 | → `{ reset_url }`                                                                            |
| DELETE          | `/api/admin/users/:name`                    | quản trị                 | như tự xoá                                                                                   |
| GET/PUT         | `/api/admin/settings`                       | quản trị                 | `{ registration }`                                                                           |
| POST            | `/v1/connect/start`, `/v1/connect/poll`     | công khai                | giữ nguyên                                                                                   |
| GET             | `/v1/me`                                    | máy                      | giữ nguyên                                                                                   |
| POST            | `/v1/me/device`                             | máy                      | báo agent và repo (mục 6.4)                                                                  |
| POST            | `/v1/me/logout`                             | máy                      | giữ nguyên                                                                                   |

Trình duyệt dùng cookie; máy và link chia sẻ dùng `Authorization: Bearer`. `auth.ts` đọc cả hai.

## 8. CLI: luồng đầy đủ (gói `guide-the-vibe` 0.2.0)

0.2.0 chưa publish, nên các thay đổi dưới đây vào thẳng 0.2.0.

### 8.1 Cài

`npx guide-the-vibe` chép bản bundle vào `~/.gtv/bin/gtv.mjs`, tạo lệnh `gtv` trên PATH, in `Next: gtv login`. Chạy
lại là cập nhật. **Không đổi.**

### 8.2 `gtv login [server]`

1. Hỏi `? Your gtv server:` (gợi ý server cũ), kiểm tra `/health`.
2. `POST /v1/connect/start` với tên máy và hệ điều hành → nhận mã `KQ7M-2XPD` và link `/connect?code=…`, mở trình duyệt.
3. Người dùng đăng nhập (hoặc đăng ký) trên trình duyệt, thấy "Máy thaihoc-laptop muốn kết nối vào tài khoản hoc",
   bấm Cho phép.
4. CLI hỏi `/v1/connect/poll` mỗi 2 giây, nhận khoá máy `gtvd_…` một lần, lưu `~/.gtv/config.json` (quyền 600),
   khởi động daemon. Daemon báo agent và repo lên (mục 6.4).
5. Đang đứng trong repo của project mình là thành viên: hỏi `Set up this repo too? (Y/n)`.

Đổi: chữ in ra khi chưa có tài khoản: `No account yet? Sign up on the page that opens.`

### 8.3 `gtv on` (trong repo)

1. Chưa login → `Run: gtv login`. Không phải git repo → báo.
2. `GET /v1/me`, so remote của repo (`owner/repo`) với repo của các project mình là thành viên.
3. Ba trường hợp:
   - **Khớp, mình là Developer/Quản lý** → cài hook + MCP + skill cho Claude Code và/hoặc Codex, giấu khỏi git qua
     `.git/info/exclude`, ghi `.git/gtv-project`, thêm vào `~/.gtv/repos.json`, bật daemon, báo lại thông tin máy.
   - **Repo thuộc một project mà mình chưa ở trong** → (mới) `This repo belongs to a project you are not in. Ask a
manager for an invite link.` Server chỉ trả lời "có project khớp" hay không, không lộ tên project với người ngoài.
   - **Không project nào khớp** → (mới) `No project uses this repo yet. Create one: https://…/new?repo=owner/repo`.
4. Chỉ là Người xem → `You are a viewer in <project>; agents need developer access.`

### 8.4 Khi làm việc

Không phải gõ gì. Mở Claude Code hoặc Codex trong repo:

- hook gửi sự kiện (bắt đầu phiên, sửa file, kết thúc) tới daemon trên máy → daemon gửi lên server bằng khoá máy;
- server biết người (từ khoá), máy (từ khoá, mới), project (từ repo);
- agent đăng ký việc, nhận cảnh báo đụng nhau, hỏi đồng đội qua tool MCP `gtv_*`; câu trả lời đi ngược về đúng agent.

### 8.5 Lệnh khác

| Lệnh                  | Làm gì                                                                          |
| --------------------- | ------------------------------------------------------------------------------- |
| `gtv status`          | ai, máy nào, daemon; trong repo: project, quyền, việc của tôi, cái đang chờ tôi |
| `gtv open`            | mở project của repo này trên trình duyệt                                        |
| `gtv answer <id> "…"` | trả lời câu hỏi đang chờ                                                        |
| `gtv doctor`          | kiểm tra và sửa: server, khoá, daemon, từng repo                                |
| `gtv off`             | gỡ gtv khỏi repo này (chỉ phần của gtv)                                         |
| `gtv logout`          | thu hồi khoá của máy này, tắt daemon; repo giữ bản cài                          |

### 8.6 Phần CLI/daemon phải sửa

- `src/daemon/daemon.ts`: gửi `POST /v1/me/device` (khởi động, mỗi 6 giờ, và khi CLI báo qua cổng daemon sau
  `on`/`off`); tìm phiên bản agent.
- `src/daemon/setup.ts`: hai câu mới ở 8.3; câu gợi ý đăng ký ở 8.2.
- `GET /v1/resolve` (đang trả tên project cho mọi máy) đổi thành chỉ trả `{ exists: true }` cho người ngoài project.
- Server ghi `device` vào `sessions` khi agent đăng ký phiên (`agent-routes.ts`, lấy từ `principal.device`).

## 9. Bảo mật

- Mật khẩu scrypt như hiện có. Phiên, mã mời, mã đặt lại, khoá máy chỉ lưu bản băm SHA-256.
- Cookie httpOnly + kiểm `Origin` cho lệnh ghi. Link chia sẻ vẫn là Bearer, chỉ đọc.
- Giới hạn tần suất (có sẵn `rateLimited`): đăng nhập, đăng ký (5/phút mỗi IP), mở lời mời, duyệt máy, kiểm repo.
- **Repo**: chỉ `https://` và `git@host:…`; chặn `file://`, `ext::`, đường dẫn trên máy, `localhost`, IP nội bộ
  (phân giải tên rồi mới kiểm). Lý do: ai cũng tạo được project, server sẽ clone URL đó.
- **Chưa giới hạn** số project mỗi người hay số việc AI mỗi project (chủ dự án chốt 27/11: tạm thời chưa cần).
  `brain_jobs` đã đếm sẵn, thêm giới hạn sau rất nhanh.
- Lời mời không bao giờ cấp quyền Quản lý. Link bị lộ thì Quản lý thu hồi; hạn mặc định 7 ngày.
- Khoá tài khoản, ngắt máy, xoá khỏi project có hiệu lực ở lần gọi kế tiếp (không cache quyền).

## 10. Test

Không gọi LLM thật. Dùng khuôn có sẵn trong `test/` (`startServer` với `listen: false`). Thêm helper
`test/helpers.ts`: `signup(app, name)`, `newProject(app, cookie, id)`, `connectDevice(app, cookie)`.

- `auth.test.ts`: setup lần đầu (có/không admin token); đăng ký (tên trùng, tên dành riêng, chế độ đăng ký
  `invite`/`closed`); đăng nhập sai bị giới hạn; cookie + kiểm `Origin`; đăng xuất; danh sách phiên; đổi mật khẩu đăng
  xuất phiên khác; link đặt lại dùng một lần; khoá tài khoản chặn cả phiên lẫn máy; xoá tài khoản giữ tên.
- `invites.test.ts`: tạo link (chỉ Quản lý); khách xem thẻ mời; nhận lời mời; hết hạn, hết lượt, thu hồi; đã là
  thành viên giữ quyền; đăng ký kèm lời mời; chế độ đăng ký `invite`.
- `members.test.ts`: thêm theo tên; đổi quyền; luật Quản lý cuối (hạ quyền, xoá, rời, xoá tài khoản); rời project
  làm máy nhận 403 ngay; quyền đọc được khi project chưa mở (server vừa khởi động).
- `projects.test.ts`: người thường tạo project và là Quản lý; chặn URL xấu; `check-repo`.
- `devices.test.ts`: báo thông tin máy; `/api/me/devices` có agent, repo, phiên; đổi tên; ngắt; người khác không thấy
  đường dẫn repo.
- Sửa `permissions.test.ts`, `connect.test.ts` theo cookie và bảng mới; bỏ `accounts.test.ts` phần kích hoạt/chuyển dữ liệu.
- CLI: test hàm thuần cho hai câu mới ở 8.3 và tìm phiên bản agent.
- **Chạy thử thật trên máy này** (như lần trước): server local, hai người (`GTV_HOME` riêng), đăng ký → tạo project →
  link mời → người kia nhận → `gtv login` (duyệt qua API) → `gtv on` → một phiên Claude Code và một phiên Codex sửa
  cùng file → cảnh báo tới → trang Máy của tôi hiện đúng agent, repo, phiên.

## 11. Thứ tự làm

Mỗi bước một commit thẳng lên `main` sau `npm run check` và `npm run web:build`; đợi CI xanh.

0. **Prototype** các màn hình mục 5 trong `gtv-prototype/auth/` (sáng + tối) → chủ dự án duyệt.
1. **Server – tài khoản**: bảng, setup/signup/login/cookie, phiên, đặt lại mật khẩu, khoá/xoá, `admin/*`, test.
2. **Server – project**: `project_members`, quyền một chỗ, ai cũng tạo project, kiểm repo, lời mời, thành
   viên, `/v1/resolve`, test.
3. **Server – máy**: `/v1/me/device`, `device_repos`, `sessions.device`, `/api/me/devices`, test.
4. **Dashboard**: theo prototype đã duyệt.
5. **CLI/daemon**: mục 8.6, build `dist/npm` 0.2.0.
6. **Tài liệu**: `docs/cli.md`, `docs/api.md`, README (Getting started: đăng ký → tạo project hoặc nhận lời mời →
   `npx guide-the-vibe` → `gtv login` → `gtv on`), `docs/backlog.md`. Đánh dấu `accounts-and-cli.md` là đã thay.
7. **Deploy** lên tokyo-lxd: sao lưu volume, xoá volume, deploy, tạo quản trị `hoc` qua `/setup` với admin token,
   chạy thử thật (mục 10) trên server thật, chụp màn hình.
8. Chủ dự án publish npm 0.2.0.

## 12. Không làm (lần này)

- Gửi email (xác minh, quên mật khẩu qua email): server chưa có dịch vụ gửi mail.
- Đăng nhập bằng GitHub/Google: làm sau được, bảng `users` đã đủ chỗ (thêm bảng `user_identities`).
- Tổ chức/nhóm nhiều tầng, quyền tuỳ biến, 2FA.
- "Xin vào project" từ CLI (người ngoài bấm xin, Quản lý duyệt): ý hay, để sau link mời.

## 13. Rủi ro

- **Đổi cookie** làm hỏng mọi chỗ web đang gửi Bearer: gom về một chỗ trong `web/src/api/client.ts`.
- **Gộp thành viên về `hub.db`**: engine, board, AI đang đọc `store.members()` ở nhiều chỗ; tìm hết lời gọi trước khi
  đổi.
- **Đăng ký mở trên server công khai**: người lạ vào được. Quản trị chuyển chế độ đăng ký sang "chỉ khi có link mời"
  hoặc "đóng" khi cần; giới hạn project và AI để sau.

## 14. Đã chốt (27/11)

| #   | Câu hỏi                                                          | Chốt                                                                        |
| --- | ---------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | Đăng ký mở cho mọi người, hay chỉ ai có link mời?                | **Mở**, quản trị đổi được trong Quản trị › Server                           |
| 2   | Có cần email khi đăng ký không?                                  | **Không** (không có dịch vụ gửi mail; quên mật khẩu nhờ quản trị)           |
| 3   | Developer có được tạo việc, giao việc, sửa tài liệu không?       | **Được tạo việc và sửa tài liệu**; giao việc cho người khác vẫn cần Quản lý |
| 4   | Giới hạn: 5 project mỗi người, 300 việc AI mỗi project mỗi ngày? | **Tạm thời chưa cần**                                                       |
| 5   | Làm prototype màn hình trước rồi mới code?                       | **Có**                                                                      |

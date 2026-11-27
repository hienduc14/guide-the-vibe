# Hướng dẫn dùng CLI `gtv`

`gtv` là lệnh trên máy của từng người. Nó kết nối máy vào tài khoản gtv của bạn, cài gtv cho agent (Claude Code,
Codex) trong từng repo, và chạy một dịch vụ nền nhỏ (daemon) để agent nói chuyện với server của nhóm. Chữ trên CLI bằng
tiếng Anh; lệnh và chữ ví dụ dưới đây giữ nguyên.

Cần: Node.js 20 trở lên, git, và một tài khoản gtv: tự đăng ký trên server của nhóm (`/signup`), hoặc mở link mời vào
project mà người quản lý gửi bạn rồi bấm Tạo tài khoản.

## 1. Cài đặt

```
$ npx guide-the-vibe
✔ Installed gtv 0.2.0 → ~/.gtv/bin/gtv
✔ Added gtv to your PATH (open a new terminal if `gtv` is not found)

Next: gtv login
```

- Bản cài nằm ở `~/.gtv/bin/gtv.mjs`; lệnh `gtv` là một file nhỏ chạy bản đó. Xoá cache của npx không làm hỏng gì.
- Linux/macOS: nếu `~/.local/bin` có trong PATH thì gtv tạo liên kết ở đó; nếu không, nó thêm một dòng
  `export PATH="$HOME/.gtv/bin:$PATH"` vào `~/.bashrc` / `~/.zshrc` (chỉ file đã có, không thêm trùng) và nói rõ đã sửa
  file nào. Mở terminal mới nếu `gtv` chưa chạy được.
- Windows: gtv tạo `gtv.cmd` trong `%LOCALAPPDATA%\Microsoft\WindowsApps` (có sẵn trong PATH). Không được thì nó in
  dòng `setx` cần chạy.
- **Cập nhật**: chạy lại `npx guide-the-vibe@latest`.
- `npx guide-the-vibe <lệnh>` chạy lệnh đó như `gtv <lệnh>` (ví dụ trên máy chưa cài).

## 2. Đăng nhập: kết nối máy vào tài khoản

```
$ gtv login
? Your gtv server: https://gtv.tenantry.site
✔ Found gtv at gtv.tenantry.site

Open this page to approve this computer:
  https://gtv.tenantry.site/connect?code=KQ7M-2XPD
Code: KQ7M-2XPD
No account yet? Sign up on the page that opens.

Waiting for approval… (Ctrl+C to cancel)
✔ This computer (thaihoc-laptop) is connected as hoc

Next: in a project repo, run  gtv on
```

- Gõ địa chỉ server có hoặc không có `https://`, có `/` cuối cũng được. Lần sau gtv gợi ý server cũ trong ngoặc: bấm
  Enter để dùng lại. Có thể đưa thẳng: `gtv login gtv.tenantry.site`.
- gtv mở trình duyệt tới trang **Kết nối máy**. Đăng nhập (nếu chưa), kiểm tra tên máy, bấm **Cho phép**. Chỉ cho phép
  khi chính bạn vừa chạy `gtv login`. Mã hết hạn sau 10 phút.
- Máy không mở được trình duyệt (SSH, server không màn hình): mở đường dẫn trên ở máy khác, hoặc vào `/connect` và gõ mã.
- Khoá của máy lưu trong `~/.gtv/config.json` (chỉ bạn đọc được). Server chỉ giữ bản băm; bạn xem và thu hồi từng máy ở
  **Tài khoản của tôi** trên dashboard.
- Đang đứng trong repo của một project bạn là thành viên, gtv hỏi `Set up this repo too? (Y/n)` và chạy luôn `gtv on`.
- Trong script (không có terminal) phải đưa server: `gtv login <url>`.

## 3. Bật gtv trong một repo

```
$ cd ~/code/realworld-api
$ gtv on
✔ This repo belongs to Realworld API (you are a developer)
? Agents on this computer: Claude Code, Codex. Set up both? (Y/n)
✔ Claude Code: hooks, MCP server, skill
✔ Codex: hooks, MCP server, skill
✔ Kept out of git (.git/info/exclude)
✔ Background service running

Done. Start a new agent session and gtv takes it from there.
```

- gtv tìm project theo `remote` của repo (so dạng `owner/repo`, kể cả các alias của project). Repo là bản fork hay có
  remote khác: `gtv link <project id>` rồi `gtv on`.
- Phải là **Developer** hoặc **Quản lý** của project. Người xem nhận
  `You are a viewer in project Realworld API; agents need developer access. Ask a project manager to change it.`
- Repo thuộc project bạn chưa ở trong (server không nói tên project với người ngoài):
  `This repo belongs to a project you are not in. Ask a manager for an invite link.`
- Chưa project nào dùng repo này: `No project uses this repo yet. Create one: https://…/new?repo=owner/repo`.
- Trả lời `n` ở câu hỏi agent thì gtv hỏi từng agent. Không tìm thấy agent nào trên máy thì gtv cài cho cả hai, sẵn
  cho lúc bạn cài agent sau.
- Chạy lại `gtv on` không tạo gì trùng; dùng nó để sửa một bản cài hỏng.
- Mở một phiên agent mới trong repo. Lần đầu Claude Code hỏi duyệt MCP server `gtv`; Codex cần trust project và duyệt
  hook bằng `/hooks`.

### Những file `gtv on` ghi vào repo, và vì sao chúng không bị commit

| File                                                         | Cho agent   | Nội dung                                    |
| ------------------------------------------------------------ | ----------- | ------------------------------------------- |
| `.claude/settings.local.json`                                | Claude Code | hook gửi tới daemon, statusline             |
| `.mcp.json`                                                  | Claude Code | MCP server `gtv` (các tool `gtv_*`)         |
| `.claude/skills/gtv-collaboration/`, `.claude/skills/gtv/`   | Claude Code | skill: khi nào đăng ký việc, hỏi, nhận việc |
| `.codex/hooks.json`, `.codex/config.toml`, `.codex/skills/…` | Codex       | như trên cho Codex                          |
| `.git/gtv-project`                                           | cả hai      | repo này thuộc project nào                  |

Các file này chứa đường dẫn trên máy bạn và cổng daemon của bạn, nên không được commit. `gtv on` thêm chúng vào
`.git/info/exclude` (giống `.gitignore` nhưng chỉ trên máy bạn, không ai khác thấy) trong một khối có đánh dấu:

```
# gtv (managed)
.mcp.json
.claude/settings.local.json
.claude/skills/gtv/
.claude/skills/gtv-*/
.codex/
# end gtv
```

File nào repo **đã theo dõi** (ví dụ nhóm commit sẵn `.mcp.json`) thì gtv không giấu, chỉ cảnh báo: phần gtv thêm vào
sẽ hiện trong `git status`, đừng commit nó. gtv chỉ thêm mục của mình vào các file có sẵn, không xoá gì của bạn.

## 4. Hằng ngày

```
$ gtv status
hoc @ gtv.tenantry.site · computer thaihoc-laptop · background service running (port 7391)
Realworld API (developer)

Your tasks
  in progress Hoàn tiền trong 14 ngày (urgent)

Waiting for you
  question tk_7f64bc2b29f9 from bob: JWT: keep the old session cookie for a week or log everyone out?
  clash with bob in src/orders/service.ts

Answer: gtv answer tk_7f64bc2b29f9 "<your answer>"
See it all: gtv open
```

| Lệnh                  | Làm gì                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------- |
| `gtv status`          | bạn là ai, máy nào, dịch vụ nền; trong repo: project, quyền, việc của bạn, cái đang chờ bạn |
| `gtv open`            | mở project của repo này trên dashboard (ngoài repo: mở trang chủ)                           |
| `gtv answer <id> "…"` | trả lời câu hỏi đang chờ bạn (id lấy từ `gtv status`); câu trả lời đi thẳng vào agent hỏi   |
| `gtv daemon status`   | dịch vụ nền đang chạy với tài khoản nào, nối tới project nào                                |

Phần lớn thời gian bạn không cần gõ gì: cứ làm việc với agent như thường, gtv tự đăng ký việc, cảnh báo đụng nhau và hỏi
đồng đội qua agent.

## 5. Sửa lỗi

`gtv doctor` kiểm tra lần lượt và sửa được gì thì sửa. Mỗi dòng: ✔ ổn, ! đã sửa, ✘ cần bạn làm (kèm lệnh).

```
$ gtv doctor
✔ Server gtv.tenantry.site reachable
✔ Logged in as hoc (computer thaihoc-laptop)
! Background service was stopped: started
! ~/code/realworld-api: Claude Code setup was outdated or duplicated: reinstalled
✔ ~/code/realworld-api: Codex set up

All good.
```

Nó kiểm tra: tới được server; khoá của máy còn hiệu lực; dịch vụ nền chạy đúng tài khoản; với mỗi repo đã bật: còn tồn
tại, hook không bị trùng, hook từ bản cũ thì cài lại, bạn vẫn là thành viên; agent nào có trên máy mà repo chưa bật.

| Triệu chứng                                         | Lệnh                                                                                   |
| --------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `gtv: command not found` sau khi cài                | mở terminal mới; vẫn không được thì chạy `npx guide-the-vibe` và làm theo dòng nó in   |
| `✘ Not logged in. Run: gtv login`                   | `gtv login`                                                                            |
| `✘ This computer's key is no longer valid…`         | máy bị thu hồi hoặc tài khoản bị xoá: `gtv login`                                      |
| `✘ No project uses this repo yet…`                  | tạo project ở link gtv in ra; kiểm tra `git remote -v`; bản fork: `gtv link <project>` |
| `✘ This repo belongs to a project you are not in…`  | xin người quản lý project một link mời, mở nó, rồi `gtv on`                            |
| Agent báo `[gtv] You are not a member of project …` | như trên; agent vẫn làm việc, chỉ không được gtv điều phối                             |
| Agent không nhận briefing, statusline "daemon off"  | `gtv doctor`                                                                           |
| Hook chạy hai lần, cảnh báo lặp                     | `gtv doctor` (gỡ bản thừa) hoặc `gtv on` lại                                           |
| Xem log dịch vụ nền                                 | `gtv daemon` (chạy trong terminal, in log), hoặc `~/.gtv/daemon.log`                   |

## 6. Gỡ

```
$ gtv off          # trong repo: gỡ phần của gtv khỏi repo này
$ gtv logout       # thu hồi khoá của máy, tắt dịch vụ nền
```

- `gtv off` chỉ gỡ đúng phần gtv đã thêm: hook của gtv, mục `gtv` trong `.mcp.json`, `[mcp_servers.gtv]` trong
  `.codex/config.toml`, skill của gtv, statusline nếu là của gtv, khối trong `.git/info/exclude`, liên kết project. File
  chỉ bị xoá khi nó rỗng sau khi gỡ. Bật lại: `gtv on`.
- `gtv logout` giữ địa chỉ server (lần sau gợi ý lại) và giữ bản cài trong các repo:
  `Repos keep their setup; run gtv off in a repo to remove it.`
- Gỡ hẳn lệnh `gtv`: xoá `~/.gtv`, liên kết `~/.local/bin/gtv` (nếu có) và dòng `# gtv` trong `~/.bashrc` / `~/.zshrc`.

## 7. Nhiều máy, đổi tài khoản, đổi server

- **Nhiều máy**: mỗi máy chạy `npx guide-the-vibe` và `gtv login` một lần; mỗi máy một khoá, thu hồi riêng được.
- **Đổi tài khoản** trên một máy: `gtv logout`, rồi `gtv login` và đăng nhập dashboard bằng tài khoản kia khi duyệt.
  Dịch vụ nền tự khởi động lại với tài khoản mới; các repo đã bật không cần cài lại.
- **Đổi server**: `gtv login <server mới>`. Repo của project trên server mới cần `gtv on` lại.
- **Nhiều người dùng chung một máy**: mỗi người một `GTV_HOME` và `GTV_DAEMON_PORT` riêng (xem
  [agents.md](agents.md)).

## 8. Câu hỏi thường gặp

**gtv có chặn agent của tôi không?** Không. gtv cảnh báo và gợi ý; gtv hỏng hay mất mạng thì agent vẫn chạy như không có
gtv.

**gtv gửi gì lên server?** Việc agent đăng ký (tiêu đề, file, hàm), file đang sửa, prompt bạn gõ cho agent, câu hỏi, và
bản chụp code đang làm dở (đẩy lên một ref riêng `refs/gtv/...` của remote) để phát hiện đụng nhau sớm. Tất cả nằm trên
server của nhóm; AI mà quản trị cấu hình cho server có thể đọc chúng khi trả lời câu hỏi.

**Quản trị có biết mật khẩu của tôi không?** Không. Bạn tự đặt mật khẩu khi đăng ký. Quên mật khẩu: nhờ quản trị tạo
link đặt lại (dùng một lần, 1 giờ); máy đã kết nối vẫn chạy, không phải `gtv login` lại.

**Tôi chỉ là Người xem, `gtv on` báo lỗi?** Đúng: agent chỉ làm việc ở project mà bạn là Developer hoặc Quản lý. Người
xem vẫn xem mọi thứ trên dashboard.

**Có cần chạy lại gì sau khi cập nhật gtv?** `npx guide-the-vibe@latest`, rồi `gtv doctor`: nó cài lại hook của các
repo nếu bản cũ khác.

**Lệnh `gtv join` cũ đâu?** Đã bỏ cùng link mời. Dùng `npx guide-the-vibe` rồi `gtv login`. Máy đã cài bằng `join` vẫn
chạy (token cũ trở thành một máy của tài khoản), nhưng nên `gtv login` lại khi tiện để thấy tên máy trên dashboard.

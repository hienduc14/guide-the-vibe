# Tích hợp agent

Mọi agent nói với **daemon local** của dev (`gtv daemon`, mặc định `127.0.0.1:7391`), không nói thẳng với server.
Daemon tự biết repo thuộc project nào: file `.git/gtv-project` (`gtv link <project>`) hoặc so remote URL với server.

Cách thường dùng: admin bấm **Tạo lệnh mời** trên dashboard, dev chạy lệnh đó trong thư mục repo (cần Node ≥ 20):

```bash
npx guide-the-vibe join https://<server>/j/<code>   # token, project, hook/MCP/skill, daemon nền
npx guide-the-vibe install                          # thêm repo khác
```

Daemon chạy nền (log `~/.gtv/daemon.log`). Nếu nó tắt, phiên agent kế tiếp tự bật lại: `gtv mcp` kiểm tra `/health` khi khởi động và trước lời gọi tool lỗi. Daemon đang chạy với dev/server khác config thì bị tắt và bật lại.

Từng bước bằng tay (trong repo gtv, `node bin/gtv.mjs` = `gtv`):

```bash
node bin/gtv.mjs init --dev alice --server http://<server>:7390 --token <dev token>
node bin/gtv.mjs daemon                      # chạy trong terminal này
node bin/gtv.mjs install claude [dir]        # hoặc: install codex [dir]
node bin/gtv.mjs link <project> [dir]        # khi remote của clone không khớp repo_url của project
```

Nhiều dev trên một máy: mỗi người một `GTV_HOME` (config riêng, cổng riêng) và `install … --daemon http://127.0.0.1:<port>`.

## Claude Code

`gtv install claude` ghi:

| File                                        | Nội dung                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.claude/settings.local.json`               | hook **HTTP** tới `/hook/claude`: `SessionStart` (15 s), `UserPromptSubmit`, `PreToolUse` matcher `Edit\|Write\|MultiEdit\|NotebookEdit\|ExitPlanMode`, `PostToolUse` `*`, `Stop` (+ hook command `gtv hook-wait claude` với `asyncRewake: true`), `SessionEnd`; `statusLine` = `gtv statusline` (chỉ khi chưa có statusline khác) |
| `.mcp.json`                                 | server `gtv`: `node bin/gtv.mjs mcp --agent auto --daemon <url>`                                                                                                                                                                                                                                                                   |
| `.claude/skills/gtv-collaboration/SKILL.md` | khi nào đăng ký, khi nào hỏi, cách trả lời câu hỏi được chuyển tới                                                                                                                                                                                                                                                                 |

- Hook HTTP lỗi = không chặn (Claude coi là non-blocking error).
- `PreToolUse` chỉ trả `permissionDecision` khi cần `ask`/`deny`, nên không vượt qua quyền của người dùng.
- `asyncRewake`: khi Claude rảnh, waiter long-poll `/wait`; có tin ⇒ exit 2, nội dung ở stderr đánh thức Claude. Waiter mới thay waiter cũ cùng session. Claude chạy không người (`claude -p`, SDK: `CLAUDE_CODE_SESSION_ATTENDED=0`) thì waiter thoát ngay, vì không có ai để đánh thức và Claude sẽ chờ waiter trước khi thoát (trước đây treo tới 30 phút).
- Lần đầu mở project: duyệt MCP server `gtv`.

## Codex CLI

`gtv install codex` ghi:

| File                                       | Nội dung                                                                                                                                                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.codex/hooks.json`                        | hook **command** `node bin/gtv.mjs hook codex --daemon <url>`: `SessionStart`, `UserPromptSubmit`, `PreToolUse` matcher `apply_patch\|Edit\|Write\|update_plan`, `PostToolUse`, `Stop`, `SessionEnd`                                  |
| `.codex/config.toml`                       | `[mcp_servers.gtv]` (`--agent codex`, `tool_timeout_sec = 150`, `default_tools_approval_mode = "approve"` — không có dòng này Codex hỏi duyệt mỗi lần gọi tool gtv, và `codex exec` với `approval_policy = "never"` thì từ chối luôn) |
| `.codex/skills/gtv-collaboration/SKILL.md` | skill                                                                                                                                                                                                                                 |

- Phải **trust project** và duyệt hook bằng `/hooks` trong Codex; hook đổi nội dung ⇒ phải duyệt lại.
- Codex báo sửa file là `apply_patch`, nội dung ở `tool_input.command`; daemon đọc các dòng `*** Add/Update/Delete File:` / `*** Move to:`.
- Codex **không hỗ trợ `ask`** ⇒ high: `deny` lần đầu kèm lý do, lần thử lại cho qua; critical: `deny` tới khi ack.
- Shim `bin/gtv.mjs hook` viết bằng JS thuần để khởi động nhanh (~270 ms trên Windows, phần lớn là khởi động Node).

## Ma trận khả năng

|                        | Claude Code     | Codex            | Cursor          | Grok Build       |
| ---------------------- | --------------- | ---------------- | --------------- | ---------------- |
| Kiểu hook              | http + command  | command          | command         | command, http    |
| Chặn trước khi sửa     | allow/ask/deny  | deny (không ask) | allow/deny      | deny             |
| Chèn context giữa lượt | Pre/PostToolUse | Pre/PostToolUse  | chỉ postToolUse | chưa có tài liệu |
| Đánh thức khi rảnh     | asyncRewake     | —                | —               | —                |
| Trích plan             | `ExitPlanMode`  | `update_plan`    | —               | —                |
| Adapter trong repo     | ✅              | ✅               | ❌              | ❌               |

## Xử lý sự cố

| Triệu chứng               | Kiểm tra                                                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Agent không nhận briefing | `curl http://127.0.0.1:7391/health` (`reachable`, `projects`); repo có thuộc project không: `node bin/gtv.mjs status` trong repo |
| "not linked to a project" | `gtv link <project>` hoặc thêm `aliases` cho project (dashboard › Cài đặt)                                                       |
| Codex không chạy hook     | `/hooks` trong Codex, project đã trust; `features.hooks` không bị tắt                                                            |
| Statusline "daemon off"   | daemon chưa chạy hoặc sai cổng trong `--daemon`                                                                                  |
| Không có conflict L1/L2   | snapshot có được đẩy không (log daemon `snapshot … pushed`), remote của clone push được tới repo của server                      |
| 401 từ daemon             | token dev sai/thiếu: `gtv init --token …` (xem [operations.md](operations.md#token))                                             |

# Tích hợp agent

Mọi agent nói với **daemon local** của dev (`gtv daemon`, mặc định `127.0.0.1:7391`), không nói thẳng với server.
Daemon tự biết repo thuộc project nào: file `.git/gtv-project` (`gtv link <project>`) hoặc so remote URL với server.

```bash
node bin/gtv.mjs init --dev alice --server http://<server>:7390 --token <dev token>
node bin/gtv.mjs daemon                      # giữ chạy
node bin/gtv.mjs install claude [dir]        # hoặc: install codex [dir] / install omp
node bin/gtv.mjs link <project> [dir]        # khi remote của clone không khớp repo_url của project
```
Nhiều dev trên một máy: mỗi người một `GTV_HOME` (config riêng, cổng riêng) và `install … --daemon http://127.0.0.1:<port>`.

## Claude Code
`gtv install claude` ghi:
| File | Nội dung |
|---|---|
| `.claude/settings.local.json` | hook **HTTP** tới `/hook/claude`: `SessionStart` (15 s), `UserPromptSubmit`, `PreToolUse` matcher `Edit\|Write\|MultiEdit\|NotebookEdit\|ExitPlanMode`, `PostToolUse` `*`, `Stop` (+ hook command `gtv hook-wait claude` với `asyncRewake: true`), `SessionEnd`; `statusLine` = `gtv statusline` (chỉ khi chưa có statusline khác) |
| `.mcp.json` | server `gtv`: `node bin/gtv.mjs mcp --agent auto --daemon <url>` |
| `.claude/skills/gtv-collaboration/SKILL.md` | khi nào đăng ký, khi nào hỏi, cách trả lời câu hỏi được chuyển tới |

- Hook HTTP lỗi = không chặn (Claude coi là non-blocking error).
- `PreToolUse` chỉ trả `permissionDecision` khi cần `ask`/`deny`, nên không vượt qua quyền của người dùng.
- `asyncRewake`: khi Claude rảnh, waiter long-poll `/wait`; có tin ⇒ exit 2, nội dung ở stderr đánh thức Claude. Waiter mới thay waiter cũ cùng session.
- Lần đầu mở project: duyệt MCP server `gtv`.

## Codex CLI
`gtv install codex` ghi:
| File | Nội dung |
|---|---|
| `.codex/hooks.json` | hook **command** `node bin/gtv.mjs hook codex --daemon <url>`: `SessionStart`, `UserPromptSubmit`, `PreToolUse` matcher `apply_patch\|Edit\|Write\|update_plan`, `PostToolUse`, `Stop`, `SessionEnd` |
| `.codex/config.toml` | `[mcp_servers.gtv]` (`--agent codex`, `tool_timeout_sec = 150`) |
| `.codex/skills/gtv-collaboration/SKILL.md` | skill |

- Phải **trust project** và duyệt hook bằng `/hooks` trong Codex; hook đổi nội dung ⇒ phải duyệt lại.
- Codex báo sửa file là `apply_patch`, nội dung ở `tool_input.command`; daemon đọc các dòng `*** Add/Update/Delete File:` / `*** Move to:`.
- Codex **không hỗ trợ `ask`** ⇒ high: `deny` lần đầu kèm lý do, lần thử lại cho qua; critical: `deny` tới khi ack.
- Shim `bin/gtv.mjs hook` viết bằng JS thuần để khởi động nhanh (~270 ms trên Windows, phần lớn là khởi động Node).

## omp (oh-my-pi)
Không cần cài file; chạy với extension:
```powershell
$env:GTV_DAEMON_URL="http://127.0.0.1:7391"; omp -e "<repo>/src/adapters/omp/gtv-extension.ts"
```
(`node bin/gtv.mjs install omp` in đúng lệnh.) Extension:
- `session_start`, `input`, `tool_call` (chặn bằng `{block, reason}`), `tool_result` (nối tin của Operator vào kết quả tool), `session_shutdown`;
- tự đăng ký đủ 9 tool như MCP: `gtv_register_task`, `gtv_update_task`, `gtv_finish_task`, `gtv_ask`, `gtv_reply`, `gtv_status`, `gtv_check`, `gtv_inbox`, `gtv_ack` (không qua MCP);
- tin chèn bằng `pi.sendMessage(..., { deliverAs: "steer" })`.

## Ma trận khả năng

| | Claude Code | Codex | omp | Cursor | Grok Build |
|---|---|---|---|---|---|
| Kiểu hook | http + command | command | extension TS | command | command, http |
| Chặn trước khi sửa | allow/ask/deny | deny (không ask) | block | allow/deny | deny |
| Chèn context giữa lượt | Pre/PostToolUse | Pre/PostToolUse | steer / tool_result | chỉ postToolUse | chưa có tài liệu |
| Đánh thức khi rảnh | asyncRewake | — | — | — | — |
| Trích plan | `ExitPlanMode` | `update_plan` | — | — | — |
| Adapter trong repo | ✅ | ✅ | ✅ | ❌ | ❌ |

## Xử lý sự cố
| Triệu chứng | Kiểm tra |
|---|---|
| Agent không nhận briefing | `curl http://127.0.0.1:7391/health` (`reachable`, `projects`); repo có thuộc project không: `node bin/gtv.mjs status` trong repo |
| "not linked to a project" | `gtv link <project>` hoặc thêm `aliases` cho project (dashboard › Cài đặt) |
| Codex không chạy hook | `/hooks` trong Codex, project đã trust; `features.hooks` không bị tắt |
| Statusline "daemon off" | daemon chưa chạy hoặc sai cổng trong `--daemon` |
| Không có conflict L1/L2 | snapshot có được đẩy không (log daemon `snapshot … pushed`), remote của clone push được tới repo của server |
| 401 từ daemon | token dev sai/thiếu: `gtv init --token …` (xem [operations.md](operations.md#token)) |

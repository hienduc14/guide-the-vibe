# gtv — Project Operator cho nhóm vibe code chung một repo

2–3 developer, mỗi người dùng một AI coding agent riêng (Claude Code, Codex) trên cùng một repo.
gtv đặt một **Project Operator** trên server; agent của mọi người nói chuyện với nó:

1. **Đăng ký task** trước khi sửa → Operator báo chồng lấn với việc của người khác _trước khi viết code_.
2. **Phát hiện conflict nhiều lớp** trong lúc code — mỗi lớp bật/tắt được (`off | shadow | on`):

   | Lớp | Bắt được                                                              | Cách làm                                                          |
   | --- | --------------------------------------------------------------------- | ----------------------------------------------------------------- |
   | L0  | trùng file, scope đã đăng ký, symbol/contract khai báo, vùng critical | so registry                                                       |
   | L1  | conflict text trước khi có PR                                         | `git merge-tree` trên WIP snapshot (`refs/gtv/<dev>/<workspace>`) |
   | L2  | "A đổi chữ ký `getUser`, code mới của B đang gọi nó"                  | tree-sitter symbol diff + code graph                              |
   | L3  | chồng lấn ý định giữa các task                                        | Brain (LLM)                                                       |

3. **Hỏi Operator giữa lúc code** (`gtv_ask`): trả lời từ code graph, docs/ADR và WIP của đồng đội; câu cần người khác quyết định được **chuyển vào agent của họ** và câu trả lời quay lại tự động.

Mỗi **project = một repo**. Một server phục vụ nhiều project; Brain (vòng lặp agent của [Pi](https://github.com/earendil-works/pi) chạy ngay trong Operator, LLM tùy chọn) dùng chung.

## Kiến trúc trong 30 giây

```
 Máy dev (mỗi người)                          Server (docker)
 ┌───────────────────────────────┐   HTTPS   ┌──────────────────────────────────────────┐
 │ Claude Code / Codex           │  + SSE    │ Operator (Node 24)                        │
 │   hooks · MCP gtv_* · skill   │◄────────► │  hub: projects, dev tokens, brain stats   │
 │            │                  │           │  project runtime × N:                     │
 │            ▼                  │           │    registry · L0–L3 · Q&A · KB · graph    │
 │ gtv daemon (127.0.0.1:7391)   │           │  /api (dashboard) · /v1/p/:id (agents)    │
 │   quyết định local, inbox,    │           │  Brain (Pi, trong tiến trình):            │
 │   WIP snapshot ──git push──┐  │           │    13 tool chỉ-đọc gọi thẳng engine       │
 └────────────────────────────┼──┘           └──────────────┬─────────────────────┬──────┘
                              ▼                     git fetch│                     │ HTTPS
                       ┌────────────┐                        │              ┌──────▼───────┐
                       │ GitHub /   │◄───────────────────────┘              │ LLM bất kỳ   │
                       │ bare repo  │                                       │ (OpenAI-     │
                       └────────────┘                                       │ compatible…) │
                                                                            └──────────────┘
```

## Chạy thử (sandbox, tất cả trên một máy)

Cần: Node ≥ 24, git ≥ 2.40, Docker Desktop.

```bash
npm ci
npm run web:install
node scripts/sandbox.ts                 # sandbox/origin.git (mini-shop) + clone alice / bob
cp docker/.env.example docker/.env      # đặt GTV_ADMIN_TOKEN và GTV_SECRET_KEY (openssl rand -hex 32)
docker compose -f docker/compose.yml --env-file docker/.env up -d --build
```

Mở dashboard **http://127.0.0.1:7390** (nhập `GTV_ADMIN_TOKEN`) → **Brain › Providers**: dán API key của một provider có sẵn (Anthropic, OpenAI, Google, OpenRouter…; với Claude dán được cả token `claude setup-token`), hoặc thêm một endpoint tương thích OpenAI (CLIProxyAPI, LiteLLM, Ollama…) → **Kiểm tra** → chọn model (vd `anthropic/claude-sonnet-5-5`) và mức suy nghĩ. Key được mã hoá bằng `GTV_SECRET_KEY`.

Cũng trên dashboard: tạo project (repo URL), cấp token cho dev. Chi tiết Brain: [docs/operations.md](docs/operations.md#brain-pi).

Hoặc bằng CLI (trong Git Bash phải tắt chuyển đường dẫn MSYS, nếu không `/repos/...` thành `C:/Program Files/Git/repos/...`):

```bash
MSYS_NO_PATHCONV=1 GTV_ADMIN_TOKEN=<admin> node bin/gtv.mjs project add mini-shop --repo /repos/origin.git --branch main
node bin/gtv.mjs link mini-shop sandbox/alice
```

Mỗi dev chạy một daemon (cổng riêng nếu cùng máy) rồi mở agent trong clone của mình:

```powershell
$env:GTV_HOME="<repo>\sandbox\.home-alice"; node bin/gtv.mjs init --dev alice --server http://127.0.0.1:7390 --token <token>
$env:GTV_HOME="<repo>\sandbox\.home-alice"; node bin/gtv.mjs daemon
```

Chi tiết tích hợp từng agent: [docs/agents.md](docs/agents.md).

## Tài liệu

|                                                        |                                                      |
| ------------------------------------------------------ | ---------------------------------------------------- |
| [docs/README.md](docs/README.md)                       | Mục lục tài liệu                                     |
| [docs/architecture.md](docs/architecture.md)           | Thành phần, luồng dữ liệu, lưu trữ, bảo mật          |
| [docs/project-structure.md](docs/project-structure.md) | Cấu trúc thư mục và chia vùng việc cho developer     |
| [docs/features.md](docs/features.md)                   | Từng feature/layer: cách hoạt động, chế độ, giới hạn |
| [docs/api.md](docs/api.md)                             | API server, daemon, MCP                              |
| [docs/agents.md](docs/agents.md)                       | Claude Code, Codex                                   |
| [docs/hooks.md](docs/hooks.md)                         | Từng hook đi đâu, luồng chi tiết từng bước           |
| [docs/operations.md](docs/operations.md)               | Docker, biến môi trường, token, Brain, sự cố         |
| [docs/development.md](docs/development.md)             | Quy ước code, cách thêm tính năng                    |
| [docs/testing.md](docs/testing.md)                     | Test tự động và self-test trên repo thật             |
| [SPEC.md](SPEC.md)                                     | Đặc tả (lý do thiết kế, đánh giá)                    |
| [web/README.md](web/README.md)                         | Dashboard                                            |
| [CONTRIBUTING.md](CONTRIBUTING.md)                     | Quy trình làm việc nhóm, branch/PR, quy ước          |

## Lệnh hay dùng

```bash
npm run check            # typecheck + format:check + toàn bộ test — chạy trước khi push
npm test                 # toàn bộ test (code intel, server, admin, end-to-end)
npm run format           # Prettier
npm run web:build        # build dashboard vào web/dist
node bin/gtv.mjs         # in trợ giúp CLI
```

## Trạng thái

Prototype cho đồ án: các luồng chính đã chạy thật (xem [báo cáo self-test](docs/reports/selftest-realworld.md)).
Đã chạy thật với Claude Code và Codex trên stack Docker, Brain là Pi (SPEC §24).
Chưa có: gắn với GitHub (comment PR, cửa chặn pre-push), embedding cho KB, adapter Cursor/Grok.
Lộ trình và lý do thiết kế: [SPEC.md](SPEC.md).

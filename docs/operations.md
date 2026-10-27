# Vận hành

## Stack docker

`docker/compose.yml` có 2 service:

| Service    | Image                                                              | Cổng             | Volume                                                                                               |
| ---------- | ------------------------------------------------------------------ | ---------------- | ---------------------------------------------------------------------------------------------------- |
| `operator` | `docker/Dockerfile` (stage 1 build `web/`, stage 2 Node 24 + git)  | `7390`           | `gtv-data:/data`, `./gtv.config.yml:/config/gtv.config.yml`, `${GTV_LOCAL_REPOS:-../sandbox}:/repos` |
| `brain`    | `docker/Dockerfile.brain` (`opencode-ai@1.19.4`, `opencode serve`) | `127.0.0.1:4096` | `opencode-data:/root/.local/share/opencode` (đăng nhập)                                              |

```bash
cp docker/.env.example docker/.env      # rồi đặt các secret
docker compose -f docker/compose.yml --env-file docker/.env up -d --build
docker compose -f docker/compose.yml --env-file docker/.env logs -f operator
```

Dashboard: `http://<server>:7390`. Repo trên GitHub: `repo_url = https://x-access-token:<token>@github.com/<org>/<repo>.git` (token chỉ cần quyền đọc **và** daemon của dev phải push được `refs/gtv/*` lên cùng remote).

## Biến môi trường

### Server (`src/server/config.ts`)

| Biến                                                     | Mặc định                                                       | Ý nghĩa                                                           |
| -------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------- |
| `GTV_PORT` / `GTV_HOST`                                  | `7390` / `0.0.0.0`                                             |                                                                   |
| `GTV_DATA`                                               | `.gtv-data` (docker: `/data`)                                  | thư mục dữ liệu                                                   |
| `GTV_CONFIG`                                             | —                                                              | file YAML (xem dưới)                                              |
| `GTV_ADMIN_TOKEN`                                        | —                                                              | bảo vệ `/api`; **bắt buộc khi chạy thật**                         |
| `GTV_TOKENS`                                             | —                                                              | `dev:token,dev2:token2` → nạp vào bảng dev khi khởi động          |
| `GTV_AUTH`                                               | —                                                              | `open` = tin header `X-Gtv-Dev` (chỉ để dev)                      |
| `GTV_BRAIN_TOKEN`                                        | —                                                              | Brain phải gửi khi gọi `/p/:id/mcp`                               |
| `GTV_INTERNAL_URL`                                       | `http://127.0.0.1:$GTV_PORT` (compose: `http://operator:7390`) | URL Brain dùng để gọi ngược Operator                              |
| `GTV_WEB_DIR`                                            | `web/dist` (image: `/app/web/dist`)                            | dashboard đã build                                                |
| `GTV_POLL_MS`                                            | `30000` (compose: `15000`)                                     | chu kỳ fetch repo                                                 |
| `GTV_REPO_URL`, `GTV_MAIN_BRANCH`, `GTV_DEFAULT_PROJECT` | —, `main`, `default`                                           | tùy chọn: tạo sẵn 1 project lần đầu chạy                          |
| `BRAIN_BACKEND`                                          | `null` (compose: `opencode`)                                   | `opencode` hoặc tắt LLM                                           |
| `OPENCODE_URL`                                           | `http://127.0.0.1:4096` (compose: `http://brain:4096`)         |                                                                   |
| `OPENCODE_SERVER_PASSWORD`                               | —                                                              | basic auth của OpenCode (đặt cho cả 2 service)                    |
| `BRAIN_MODEL`                                            | —                                                              | `provider/model`; ghi đè bằng dashboard (lưu trong `hub.db`)      |
| `BRAIN_AGENT`                                            | `operator`                                                     | agent OpenCode (định nghĩa trong `docker/opencode/opencode.json`) |
| `BRAIN_CONCURRENCY` / `BRAIN_TIMEOUT_MS`                 | `2` / `180000`                                                 |                                                                   |
| `GTV_QUIET`                                              | —                                                              | tắt log                                                           |

### File cấu hình YAML (`GTV_CONFIG`, ví dụ `docker/gtv.config.yml`)

```yaml
features: { detect.l3_semantic: on } # mặc định mode cho mọi project
policy: { critical_paths: ["**/migrations/**"], modules: {} } # dùng khi project chưa đặt policy riêng
knowledge: { doc_globs: ["docs/**/*.md", "*.md"] }
qa: { ask_wait_s: 45, tier2_timeout_min: 15, tier3_timeout_h: 4 }
registration: { wait_s: 30 }
l3: { daily_budget: 60 }
```

### Daemon / CLI (`src/daemon/config.ts`, file `~/.gtv/config.json`)

| Biến                                 | Mặc định                             |                                                             |
| ------------------------------------ | ------------------------------------ | ----------------------------------------------------------- |
| `GTV_HOME`                           | `~/.gtv`                             | thư mục config (mỗi dev một thư mục nếu dùng chung máy)     |
| `GTV_DEV`, `GTV_SERVER`, `GTV_TOKEN` | tên user, `http://127.0.0.1:7390`, — |                                                             |
| `GTV_DAEMON_PORT`                    | `7391`                               |                                                             |
| `GTV_REMOTE`                         | `origin`                             | remote để push snapshot và nhận diện project                |
| `GTV_SNAPSHOT_DEBOUNCE_MS`           | `20000`                              |                                                             |
| `GTV_DAEMON_URL`                     | —                                    | shim `gtv hook` và extension omp dùng (thay cho `--daemon`) |
| `GTV_CWD`                            | cwd                                  | thư mục mà `gtv mcp` coi là repo                            |
| `GTV_ADMIN_TOKEN`                    | —                                    | `gtv project add` dùng                                      |

## Project

- Dashboard: **Tổng quan › Thêm project** (id: chữ thường, số, `-`; repo URL; branch chính; aliases).
- CLI: `GTV_ADMIN_TOKEN=… node bin/gtv.mjs project add <id> --repo <url> --branch <main> --name "<tên>"`.
- **Git Bash**: đặt `MSYS_NO_PATHCONV=1` khi truyền đường dẫn kiểu `/repos/...`, nếu không MSYS đổi thành `C:/Program Files/Git/repos/...`. Sửa sai bằng PATCH `repo_url` (runtime tự mở lại, mirror đổi remote).
- Project được nhận diện theo `owner/repo` của remote; clone có remote khác ⇒ thêm `aliases` hoặc `gtv link <id>`.
- Xóa = lưu trữ (`DELETE /api/projects/:id`); dữ liệu còn trong `data/projects/<id>/`.

## Token

- Cấp token dev: dashboard **Developers** hoặc `POST /api/devs {name}` → token hiện **một lần**; dev chạy `gtv init --token …`.
- Xoay token = cấp lại cùng tên.
- Quy tắc mở (`src/server/http/auth.ts`):
  - `/v1/*` mở (tin `X-Gtv-Dev`) khi `GTV_AUTH=open`, hoặc **chưa có admin token và chưa có dev nào**. Có dev đầu tiên ⇒ phải dùng token.
  - `/api/*` mở khi `GTV_AUTH=open` hoặc **không đặt `GTV_ADMIN_TOKEN`** (server log cảnh báo).

## Brain (OpenCode + gói ChatGPT)

1. Đăng nhập (một lần):
   ```bash
   docker compose -f docker/compose.yml --env-file docker/.env exec brain opencode auth login -p openai -m "ChatGPT Pro/Plus (headless)"
   ```
   Có thể phải bật đăng nhập bằng mã thiết bị trong cài đặt bảo mật ChatGPT.
2. Chọn model: dashboard **Brain** (lấy danh sách từ OpenCode) hoặc `BRAIN_MODEL`. Tài khoản ChatGPT chỉ dùng được các model có trong danh sách của Codex: `openai/gpt-6-luna` chạy được; `openai/gpt-5.4-mini` bị từ chối ("not supported when using Codex with a ChatGPT account").
3. Mỗi project được đăng ký vào OpenCode thành MCP server `gtv_<project>` lúc job đầu tiên chạy.
4. Không dùng gói Claude Pro/Max làm Brain cho server dùng chung (điều khoản Anthropic) — xem SPEC §7.2.1.

Thống kê job (số lượt, p50/p95, lỗi theo loại/ngày/project): dashboard **Brain** và tab **Thống kê** của project.

## Backup và nâng cấp

- Backup: volume `gtv-data` (`hub.db`, `projects/*`) và `opencode-data` (đăng nhập). Ví dụ:
  `docker run --rm -v docker_gtv-data:/d -v "$PWD":/b alpine tar czf /b/gtv-data.tgz -C /d .`
- Nâng cấp: `git pull` → `docker compose … up -d --build`. Schema dùng `CREATE TABLE IF NOT EXISTS`, bảng mới tự tạo; đổi cột cần script migrate riêng.
- Reset hoàn toàn dữ liệu Operator: `docker volume rm docker_gtv-data` (mất project, token, lịch sử).

## Sự cố thường gặp

| Triệu chứng                                                      | Nguyên nhân / cách xử lý                                                                          |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `Model not found: openai/...` dù `opencode models` có model      | OpenCode nạp provider trước khi đăng nhập / lỗi tải models.dev → `docker compose … restart brain` |
| `model is not supported when using Codex with a ChatGPT account` | đổi sang model trong danh sách Codex (vd `gpt-6-luna`)                                            |
| repo URL thành `C:/Program Files/Git/...`                        | MSYS path conversion → `MSYS_NO_PATHCONV=1`, PATCH lại `repo_url`                                 |
| Dashboard 401                                                    | nhập `GTV_ADMIN_TOKEN` (lưu trong localStorage)                                                   |
| Daemon 401                                                       | token dev sai/thiếu sau khi bật token → `gtv init --token …`, khởi động lại daemon                |
| Hook không chạy                                                  | xem [agents.md](agents.md#xử-lý-sự-cố)                                                            |
| `last_sync.ok = false`                                           | repo URL / quyền đọc; xem log `operator`; bấm **Sync now**                                        |

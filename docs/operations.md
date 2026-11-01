# Vận hành

## Stack docker

`docker/compose.yml` có 2 service:

| Service    | Image                                                                          | Cổng             | Volume                                                                                               |
| ---------- | ------------------------------------------------------------------------------ | ---------------- | ---------------------------------------------------------------------------------------------------- |
| `operator` | `docker/Dockerfile` (stage 1 build `web/`, stage 2 Node 24 + git)              | `7390`           | `gtv-data:/data`, `./gtv.config.yml:/config/gtv.config.yml`, `${GTV_LOCAL_REPOS:-../sandbox}:/repos` |
| `brain`    | `docker/Dockerfile.brain` (`nousresearch/hermes-agent:v0.22.2`, `gateway run`) | `127.0.0.1:8642` | `hermes-data:/opt/data` (config, đăng nhập ChatGPT, session)                                         |

```bash
cp docker/.env.example docker/.env      # rồi đặt GTV_ADMIN_TOKEN, GTV_BRAIN_TOKEN, HERMES_API_KEY (openssl rand -hex 32); thiếu thì compose không chạy
docker compose -f docker/compose.yml --env-file docker/.env up -d --build
docker compose -f docker/compose.yml --env-file docker/.env logs -f operator
```

Dashboard: `http://<server>:7390`. Repo trên GitHub: `repo_url = https://x-access-token:<token>@github.com/<org>/<repo>.git` (token chỉ cần quyền đọc **và** daemon của dev phải push được `refs/gtv/*` lên cùng remote).

> **Code đang làm dở lên remote.** Daemon chụp working tree (`git add -A` vào index tạm, gồm cả file mới chưa commit nhưng không bị `.gitignore`) và push lên `refs/gtv/<dev>/<workspace>` của remote. Ai đọc được repo đều thấy các ref này (`git ls-remote`). Chỉ dùng **repo private**, và đưa mọi file bí mật (`.env`, key) vào `.gitignore` trước khi bật daemon.

## Biến môi trường

### Server (`src/server/config.ts`)

| Biến                                                      | Mặc định                                                       | Ý nghĩa                                                                                    |
| --------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `GTV_PORT` / `GTV_HOST`                                   | `7390` / `0.0.0.0`                                             |                                                                                            |
| `GTV_DATA`                                                | `.gtv-data` (docker: `/data`)                                  | thư mục dữ liệu                                                                            |
| `GTV_CONFIG`                                              | —                                                              | file YAML (xem dưới)                                                                       |
| `GTV_ADMIN_TOKEN`                                         | —                                                              | bảo vệ `/api`; **bắt buộc khi chạy thật**                                                  |
| `GTV_TOKENS`                                              | —                                                              | `dev:token,dev2:token2` → nạp vào bảng dev khi khởi động                                   |
| `GTV_AUTH`                                                | —                                                              | `open` = tin header `X-Gtv-Dev` (chỉ để dev)                                               |
| `GTV_BRAIN_TOKEN`                                         | — (compose: bắt buộc)                                          | Brain phải gửi khi gọi `/mcp`, `/p/:id/mcp`                                                |
| `GTV_INTERNAL_URL`                                        | `http://127.0.0.1:$GTV_PORT` (compose: `http://operator:7390`) | URL Brain OpenCode dùng để gọi ngược Operator (Hermes: trong `docker/hermes/config.yaml`)  |
| `GTV_WEB_DIR`                                             | `web/dist` (image: `/app/web/dist`)                            | dashboard đã build                                                                         |
| `GTV_POLL_MS`                                             | `30000` (compose: `15000`)                                     | chu kỳ fetch repo                                                                          |
| `GTV_REPO_URL`, `GTV_MAIN_BRANCH`, `GTV_DEFAULT_PROJECT`  | —, `main`, `default`                                           | tùy chọn: tạo sẵn 1 project lần đầu chạy                                                   |
| `BRAIN_BACKEND`                                           | `null` (compose: `hermes`)                                     | `hermes`, `opencode` hoặc tắt LLM                                                          |
| `HERMES_URL`                                              | `http://127.0.0.1:8642` (compose: `http://brain:8642`)         | API server của Hermes gateway                                                              |
| `HERMES_API_KEY`                                          | — (compose: bắt buộc)                                          | `API_SERVER_KEY` của Hermes (≥ 16 ký tự, đặt cho cả 2 service)                             |
| `BRAIN_MODEL`                                             | — (Hermes: `model` trong `docker/hermes/config.yaml`)          | `provider/model`, vd `openai-codex/gpt-6-luna`; ghi đè bằng dashboard (lưu trong `hub.db`) |
| `OPENCODE_URL`, `OPENCODE_SERVER_PASSWORD`, `BRAIN_AGENT` | `http://127.0.0.1:4096`, —, `operator`                         | chỉ khi `BRAIN_BACKEND=opencode`                                                           |
| `BRAIN_CONCURRENCY` / `BRAIN_TIMEOUT_MS`                  | `2` / `180000`                                                 |                                                                                            |
| `GTV_QUIET`                                               | —                                                              | tắt log                                                                                    |

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

## Brain (Hermes Agent + gói ChatGPT)

Brain là [Hermes Agent](https://hermes-agent.nousresearch.com/docs/) (Nous Research) chạy `hermes gateway run` với API server tương thích OpenAI. gtv gửi mỗi job một lượt chat; Hermes tự gọi tool chỉ-đọc của Operator qua MCP rồi trả JSON.

1. Đăng nhập gói ChatGPT (một lần, lưu trong volume `hermes-data`): in ra URL + mã thiết bị để nhập trên trình duyệt.
   ```bash
   docker compose -f docker/compose.yml --env-file docker/.env exec brain hermes auth add openai-codex --no-browser
   ```
   Có thể phải bật đăng nhập bằng mã thiết bị trong cài đặt bảo mật ChatGPT.
2. Chọn model: dashboard **Brain** (danh sách lấy từ `GET /api/model/options` của Hermes, chỉ provider đã đăng nhập) hoặc `BRAIN_MODEL=openai-codex/<model>`. Để trống thì dùng `model` trong `docker/hermes/config.yaml` (`gpt-6-luna`).
3. Cấu hình Hermes: `docker/hermes/config.yaml` — chỉ bật server MCP `gtv` (`http://operator:7390/mcp`, header `Bearer ${GTV_BRAIN_TOKEN}`), tắt mọi toolset ghi file/shell/web/delegate, `max_turns: 30`. File này chỉ được **chép vào volume ở lần chạy đầu**; sửa xong thì xóa bản trong volume rồi khởi động lại:
   ```bash
   docker compose -f docker/compose.yml --env-file docker/.env exec brain rm /opt/data/config.yaml
   docker compose -f docker/compose.yml --env-file docker/.env up -d --build brain
   ```
4. Kiểm tra: `curl -s http://127.0.0.1:8642/health`; danh sách tool Hermes thấy: `curl -s -H "Authorization: Bearer $HERMES_API_KEY" http://127.0.0.1:8642/v1/toolsets` (chỉ nên có `mcp-gtv`).
5. Không dùng gói Claude Pro/Max làm Brain cho server dùng chung (điều khoản Anthropic) — xem SPEC §7.2.1.

Cách gtv gọi Hermes (`src/server/brain/hermes.ts`): mỗi job một session riêng (`X-Hermes-Session-Id`), xóa sau khi xong; Hermes bỏ qua `response_format` nên schema nằm trong prompt và gtv tự kiểm JSON (sai thì nhắc lại một lần); lỗi có thể đến dưới dạng HTTP 200 (`finish_reason` ≠ `stop`) nên chỉ `stop` + JSON hợp lệ mới tính là thành công.

**Backend thay thế: OpenCode.** `BRAIN_BACKEND=opencode` + `OPENCODE_URL`, build `docker/Dockerfile.opencode` (`opencode serve`, cấu hình `docker/opencode/opencode.json`), đăng nhập `opencode auth login -p openai -m "ChatGPT Pro/Plus (headless)"`. Mỗi project được đăng ký thành MCP server `gtv_<project>` lúc job đầu tiên chạy. Báo cáo self-test hiện có (`docs/reports/selftest-realworld.md`) được chạy với backend này.

Thống kê job (số lượt, p50/p95, lỗi theo loại/ngày/project): dashboard **Brain** và tab **Thống kê** của project.

## Backup và nâng cấp

- Backup: volume `gtv-data` (`hub.db`, `projects/*`) và `hermes-data` (đăng nhập, config Hermes). Ví dụ:
  `docker run --rm -v docker_gtv-data:/d -v "$PWD":/b alpine tar czf /b/gtv-data.tgz -C /d .`
- Nâng cấp: `git pull` → `docker compose … up -d --build`. Schema dùng `CREATE TABLE IF NOT EXISTS`, bảng mới tự tạo; đổi cột cần script migrate riêng.
- Reset hoàn toàn dữ liệu Operator: `docker volume rm docker_gtv-data` (mất project, token, lịch sử).

## Sự cố thường gặp

| Triệu chứng                                                            | Nguyên nhân / cách xử lý                                                                                                                 |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Ticket: "Operator could not answer", log `hermes 401`                  | `HERMES_API_KEY` của operator khác `API_SERVER_KEY` của brain, hoặc key < 16 ký tự → đặt lại trong `docker/.env`, `up -d`                |
| Log `hermes run error: ...` / câu trả lời rỗng                         | chưa đăng nhập ChatGPT (`hermes auth add openai-codex --no-browser`) hoặc model không có trong gói → đổi model ở dashboard               |
| Hermes không gọi tool gtv                                              | `GTV_BRAIN_TOKEN` thiếu ở service `brain` (Hermes bỏ qua server MCP khi biến trống) hoặc config cũ trong volume → xem mục Brain bước 3–4 |
| (OpenCode) `Model not found: openai/...` dù `opencode models` có model | OpenCode nạp provider trước khi đăng nhập / lỗi tải models.dev → `docker compose … restart brain`                                        |
| `model is not supported when using Codex with a ChatGPT account`       | đổi sang model trong danh sách Codex (vd `gpt-6-luna`)                                                                                   |
| repo URL thành `C:/Program Files/Git/...`                              | MSYS path conversion → `MSYS_NO_PATHCONV=1`, PATCH lại `repo_url`                                                                        |
| Dashboard 401                                                          | nhập `GTV_ADMIN_TOKEN` (lưu trong localStorage)                                                                                          |
| Daemon 401                                                             | token dev sai/thiếu sau khi bật token → `gtv init --token …`, khởi động lại daemon                                                       |
| Hook không chạy                                                        | xem [agents.md](agents.md#xử-lý-sự-cố)                                                                                                   |
| `last_sync.ok = false`                                                 | repo URL / quyền đọc; xem log `operator`; bấm **Sync now**                                                                               |

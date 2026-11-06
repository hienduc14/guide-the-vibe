# Vận hành

## Stack docker

`docker/compose.yml` có 1 service: `operator`. Brain (Pi) chạy **bên trong** tiến trình Operator, không có container riêng; nó chỉ cần gọi được LLM qua HTTPS.

| Service    | Image                                                             | Cổng   | Volume                                                                                               |
| ---------- | ----------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| `operator` | `docker/Dockerfile` (stage 1 build `web/`, stage 2 Node 24 + git) | `7390` | `gtv-data:/data`, `./gtv.config.yml:/config/gtv.config.yml`, `${GTV_LOCAL_REPOS:-../sandbox}:/repos` |

```bash
cp docker/.env.example docker/.env      # rồi đặt GTV_ADMIN_TOKEN (openssl rand -hex 32; thiếu thì compose không chạy) và LLM cho Brain (mục Brain)
docker compose -f docker/compose.yml --env-file docker/.env up -d --build
docker compose -f docker/compose.yml --env-file docker/.env logs -f operator
```

Dashboard: `http://<server>:7390`. Repo trên GitHub: `repo_url = https://x-access-token:<token>@github.com/<org>/<repo>.git` (token chỉ cần quyền đọc **và** daemon của dev phải push được `refs/gtv/*` lên cùng remote).

> **Code đang làm dở lên remote.** Daemon chụp working tree (`git add -A` vào index tạm, gồm cả file mới chưa commit nhưng không bị `.gitignore`) và push lên `refs/gtv/<dev>/<workspace>` của remote. Ai đọc được repo đều thấy các ref này (`git ls-remote`). Chỉ dùng **repo private**, và đưa mọi file bí mật (`.env`, key) vào `.gitignore` trước khi bật daemon.

## Biến môi trường

### Server (`src/server/config.ts`)

| Biến                                                                             | Mặc định                            | Ý nghĩa                                                                           |
| -------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------- |
| `GTV_PORT` / `GTV_HOST`                                                          | `7390` / `0.0.0.0`                  |                                                                                   |
| `GTV_DATA`                                                                       | `.gtv-data` (docker: `/data`)       | thư mục dữ liệu                                                                   |
| `GTV_CONFIG`                                                                     | —                                   | file YAML (xem dưới)                                                              |
| `GTV_ADMIN_TOKEN`                                                                | —                                   | bảo vệ `/api`; **bắt buộc khi chạy thật**                                         |
| `GTV_TOKENS`                                                                     | —                                   | `dev:token,dev2:token2` → nạp vào bảng dev khi khởi động                          |
| `GTV_AUTH`                                                                       | —                                   | `open` = tin header `X-Gtv-Dev` (chỉ để dev)                                      |
| `GTV_WEB_DIR`                                                                    | `web/dist` (image: `/app/web/dist`) | dashboard đã build                                                                |
| `GTV_POLL_MS`                                                                    | `30000` (compose: `15000`)          | chu kỳ fetch repo                                                                 |
| `GTV_REPO_URL`, `GTV_MAIN_BRANCH`, `GTV_DEFAULT_PROJECT`                         | —, `main`, `default`                | tùy chọn: tạo sẵn 1 project lần đầu chạy                                          |
| `BRAIN_BACKEND`                                                                  | `null` (compose: `pi`)              | `pi` hoặc `null` (tắt LLM)                                                        |
| `BRAIN_MODEL`                                                                    | —                                   | `provider/model` (xem mục Brain); ghi đè bằng dashboard (lưu trong `hub.db`)      |
| `BRAIN_BASE_URL`, `BRAIN_API_KEY`                                                | —                                   | endpoint tương thích OpenAI cho provider `custom`, vd `http://127.0.0.1:8317/v1`  |
| `BRAIN_API`                                                                      | `openai-completions`                | `anthropic-messages` nếu `BRAIN_BASE_URL` nói giao thức Anthropic                 |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, … | —                                   | key của provider có sẵn trong Pi, khi `BRAIN_MODEL` là `anthropic/…`, `openai/…`… |
| `BRAIN_CONCURRENCY` / `BRAIN_TIMEOUT_MS`                                         | `2` / `180000`                      |                                                                                   |
| `GTV_QUIET`                                                                      | —                                   | tắt log                                                                           |

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

| Biến                                 | Mặc định                             |                                                         |
| ------------------------------------ | ------------------------------------ | ------------------------------------------------------- |
| `GTV_HOME`                           | `~/.gtv`                             | thư mục config (mỗi dev một thư mục nếu dùng chung máy) |
| `GTV_DEV`, `GTV_SERVER`, `GTV_TOKEN` | tên user, `http://127.0.0.1:7390`, — |                                                         |
| `GTV_DAEMON_PORT`                    | `7391`                               |                                                         |
| `GTV_REMOTE`                         | `origin`                             | remote để push snapshot và nhận diện project            |
| `GTV_SNAPSHOT_DEBOUNCE_MS`           | `20000`                              |                                                         |
| `GTV_DAEMON_URL`                     | —                                    | shim `gtv hook` dùng (thay cho `--daemon`)              |
| `GTV_CWD`                            | cwd                                  | thư mục mà `gtv mcp` coi là repo                        |
| `GTV_ADMIN_TOKEN`                    | —                                    | `gtv project add` dùng                                  |

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

## Brain (Pi)

Brain chạy bằng vòng lặp agent của [Pi](https://github.com/earendil-works/pi) (`@earendil-works/pi-agent-core` + `@earendil-works/pi-ai`, ghim bản 1.5.0) **ngay trong tiến trình Operator**. Mỗi job là một agent mới trong RAM: system prompt của Operator + schema JSON của job, và **chỉ có 13 tool chỉ-đọc của gtv** (`src/server/brain/tools.ts`) gọi thẳng vào engine của project. Không có shell, không ghi file, không file session, không đọc `~/.pi`.

1. Chọn LLM — **provider nào cũng được**, đặt `BRAIN_MODEL` dạng `provider/model`:
   - **endpoint tương thích OpenAI bất kỳ** (CLIProxyAPI, OpenRouter, LiteLLM, vLLM, Ollama…): `BRAIN_BASE_URL` + `BRAIN_API_KEY`, model là `custom/<id>` hoặc chỉ `<id>`. Ví dụ CLIProxyAPI trên máy chủ:
     ```bash
     BRAIN_BASE_URL=http://127.0.0.1:8317/v1
     BRAIN_API_KEY=<key trong access.api-keys của CLIProxyAPI>
     BRAIN_MODEL=gemini-3.8-flash-high
     ```
     Endpoint nói giao thức Anthropic thì thêm `BRAIN_API=anthropic-messages`.
   - **provider có sẵn trong Pi**: `BRAIN_MODEL=anthropic/<model>`, `openai/<model>`, `openrouter/<hãng>/<model>`, `google/<model>`… với key của provider đó (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`…). Tên model sai thì job báo `unknown model …`.
2. Đổi model lúc chạy: dashboard **Brain** (danh sách = model của `BRAIN_BASE_URL/models` dạng `custom/<id>` + model của các provider có sẵn đã có key). Lựa chọn lưu trong `hub.db`, ghi đè `BRAIN_MODEL`.
3. Kiểm tra: `curl -s http://127.0.0.1:7390/health` → `brain: { backend: "pi", ok: true, detail: "pi → …" }`. Với `custom`, `ok` nghĩa là `GET BRAIN_BASE_URL/models` trả 200 với key đã đặt.
4. Lưu ý điều khoản của gói subscription khi dùng cho server cả nhóm — xem SPEC §7.2.1.
5. Model chậm hoặc bị rate limit: gtv cắt job sau `BRAIN_TIMEOUT_MS` (180 s); câu hỏi đã quá `qa.ask_wait_s` thì vẫn được trả lời sau, qua hộp thư của agent.

Cách gtv gọi Pi (`src/server/brain/pi.ts`): Pi không ép schema JSON nên schema nằm trong prompt và gtv tự kiểm JSON (sai thì nhắc lại một lần, giữ nguyên lịch sử). Chỉ lượt kết thúc bằng `stop` + JSON hợp lệ mới tính là thành công. Lỗi tạm thời (429/5xx, mất kết nối, quá giờ) thành `BrainUnavailable`: tính năng bỏ qua (fail-open) mà không làm nhảy cầu dao. Lỗi khác (key sai, model sai) là lỗi thật và hiện trên dashboard.

Thống kê job (số lượt, p50/p95, lỗi theo loại/ngày/project): dashboard **Brain** và tab **Thống kê** của project.

## Backup và nâng cấp

- Backup: volume `gtv-data` (`hub.db`, `projects/*`). Ví dụ:
  `docker run --rm -v docker_gtv-data:/d -v "$PWD":/b alpine tar czf /b/gtv-data.tgz -C /d .`
- Nâng cấp: `git pull` → `docker compose … up -d --build`. Schema dùng `CREATE TABLE IF NOT EXISTS`, bảng mới tự tạo; đổi cột cần script migrate riêng.
- Reset hoàn toàn dữ liệu Operator: `docker volume rm docker_gtv-data` (mất project, token, lịch sử).

## Sự cố thường gặp

| Triệu chứng                                                 | Nguyên nhân / cách xử lý                                                                                                               |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `/health` báo `brain.ok = false`, `… /models -> 401`        | `BRAIN_API_KEY` sai với endpoint `BRAIN_BASE_URL` → sửa trong `docker/.env`, `up -d`                                                   |
| Ticket: "Operator could not answer", log `model error: …`   | key/model sai, hoặc model không gọi được tool → đổi model ở dashboard **Brain**                                                        |
| `no brain model set (BRAIN_MODEL)` / `needs BRAIN_BASE_URL` | chưa đặt `BRAIN_MODEL`, hoặc model `custom/…` mà thiếu `BRAIN_BASE_URL`                                                                |
| Brain trong docker không gọi được LLM trên máy chủ          | dùng `http://host.docker.internal:<port>` (Linux: thêm `extra_hosts: ["host.docker.internal:host-gateway"]`) và mở firewall cho Docker |
| repo URL thành `C:/Program Files/Git/...`                   | MSYS path conversion → `MSYS_NO_PATHCONV=1`, PATCH lại `repo_url`                                                                      |
| Dashboard 401                                               | nhập `GTV_ADMIN_TOKEN` (lưu trong localStorage)                                                                                        |
| Daemon 401                                                  | token dev sai/thiếu sau khi bật token → `gtv init --token …`, khởi động lại daemon                                                     |
| Hook không chạy                                             | xem [agents.md](agents.md#xử-lý-sự-cố)                                                                                                 |
| `last_sync.ok = false`                                      | repo URL / quyền đọc; xem log `operator`; bấm **Sync now**                                                                             |

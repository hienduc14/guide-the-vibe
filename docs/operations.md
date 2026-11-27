# Vận hành

## Stack docker

`docker/compose.yml` có 1 service: `operator`. Brain (Pi) chạy **bên trong** tiến trình Operator, không có container riêng; nó chỉ cần gọi được LLM qua HTTPS.

| Service    | Image                                                             | Cổng   | Volume                                                                                               |
| ---------- | ----------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| `operator` | `docker/Dockerfile` (stage 1 build `web/`, stage 2 Node 24 + git) | `7390` | `gtv-data:/data`, `./gtv.config.yml:/config/gtv.config.yml`, `${GTV_LOCAL_REPOS:-../sandbox}:/repos` |

```bash
cp docker/.env.example docker/.env      # rồi đặt GTV_ADMIN_TOKEN và GTV_SECRET_KEY (mỗi cái: openssl rand -hex 32; thiếu thì compose không chạy); LLM kết nối trên dashboard (mục Brain)
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

| Biến                                 | Mặc định          |                                                         |
| ------------------------------------ | ----------------- | ------------------------------------------------------- |
| `GTV_HOME`                           | `~/.gtv`          | thư mục config (mỗi dev một thư mục nếu dùng chung máy) |
| `GTV_DEV`, `GTV_SERVER`, `GTV_TOKEN` | từ `gtv login`    | ghi đè `dev`, `server`, `token` trong config (script)   |
| `GTV_DAEMON_PORT`                    | `7391`            |                                                         |
| `GTV_REMOTE`                         | `origin`          | remote để push snapshot và nhận diện project            |
| `GTV_SNAPSHOT_DEBOUNCE_MS`           | `300000` (5 phút) |                                                         |
| `GTV_DAEMON_URL`                     | —                 | shim `gtv hook` dùng (thay cho `--daemon`)              |
| `GTV_CWD`                            | cwd               | thư mục mà `gtv mcp` coi là repo                        |

## Project

- Dashboard: **Tổng quan › Thêm project** (id: chữ thường, số, `-`; repo URL; branch chính; aliases).
- Script: `curl -X POST <server>/api/projects -H "authorization: Bearer $GTV_ADMIN_TOKEN" -H content-type:application/json -d '{"id":"…","repo_url":"…","main_branch":"main"}'`.
- **Git Bash**: đặt `MSYS_NO_PATHCONV=1` khi truyền đường dẫn kiểu `/repos/...`, nếu không MSYS đổi thành `C:/Program Files/Git/repos/...`. Sửa sai bằng PATCH `repo_url` (runtime tự mở lại, mirror đổi remote).
- Project được nhận diện theo `owner/repo` của remote; clone có remote khác ⇒ thêm `aliases` hoặc `gtv link <id>`.
- Xóa = lưu trữ (`DELETE /api/projects/:id`); dữ liệu còn trong `data/projects/<id>/`.

## Tài khoản và máy

- **Một người một tài khoản**, vừa đăng nhập dashboard vừa là danh tính của agent trên máy người đó. Người dùng tự đăng
  ký ở `/signup` (tên đăng nhập không đổi được, tên hiển thị đổi được). Quản trị chọn ai được đăng ký ở **Quản trị
  server › Đăng ký**: mở (mặc định), chỉ khi có link mời, hoặc đóng.
- **Server mới**: chưa có tài khoản nào thì mọi trang về **Tạo tài khoản quản trị** (`/setup`); có `GTV_ADMIN_TOKEN`
  thì trang hỏi thêm token đó để người lạ không giành quyền quản trị trước.
- **Quên mật khẩu**: server không gửi email. Quản trị bấm **Đặt lại mật khẩu** ở **Quản trị server › Tài khoản**, gửi
  link (dùng một lần, 1 giờ) qua chat. Đặt lại xong mọi phiên cũ bị đăng xuất, máy giữ nguyên.
- **Khoá / xoá tài khoản** ở cùng trang: khoá thì không đăng nhập được và máy bị từ chối, mở khoá là chạy lại. Xoá thì
  mất phiên, máy, tư cách thành viên; tên giữ lại để lịch sử không bị nhận nhầm người. Server luôn còn ít nhất một quản
  trị; không xoá được Quản lý cuối của một project.
- **Project**: ai đăng nhập cũng tạo được, người tạo là Quản lý. Repo chỉ nhận `https://` hoặc `git@host:owner/repo`
  (không đường dẫn trên máy, `file://`, localhost, mạng nội bộ) và phải đọc được (`git ls-remote`). Quản trị (và
  `GTV_ADMIN_TOKEN`) được dùng thêm đường dẫn trên máy cho demo, sandbox.
- **Thành viên** (Thiết lập › Thành viên): Quản lý / Developer / Người xem, lưu ở `hub.db` (`project_members`). Quản lý
  thêm người theo tên đăng nhập hoặc tạo **link mời** (Developer hoặc Người xem, 1/7/30 ngày, 1/10/không giới hạn lượt;
  link chỉ hiện một lần lúc tạo). Ai cũng rời được project, trừ Quản lý cuối. Bảng quyền: [api.md](api.md#quyền-hai-tầng).
- **Kết nối máy**: người dùng chạy `npx guide-the-vibe`, `gtv login`, `gtv on` ([cli.md](cli.md)); `gtv login` mở trang
  `/connect` để họ bấm Cho phép. Mỗi máy một khoá (`gtvd_…`, server chỉ lưu SHA-256). Daemon báo phiên bản gtv, agent và
  repo đã bật; **Máy của tôi** hiện những thứ đó, phiên đang chạy, và cho đổi tên hoặc ngắt máy.
- **Phiên dashboard** là cookie httpOnly `gtv_session` (30 ngày, gia hạn khi dùng); lệnh ghi phải có `Origin` cùng host.
- **`GTV_ADMIN_TOKEN`** vẫn dùng được cho script, test, cứu hộ (`Authorization: Bearer`): quyền admin trên `/api`, trên
  `/v1` đóng vai dev ghi trong `X-Gtv-Dev`. Dashboard không đăng nhập bằng nó nữa.
- **Script, sandbox**: `GTV_TOKENS=alice:<khoá>,bob:<khoá>` khi khởi động server tạo tài khoản `alice`, `bob` (không có
  mật khẩu, không đăng nhập dashboard được) với máy dùng khoá đó; vẫn phải thêm họ làm thành viên project.
- **Chế độ mở** (`src/server/http/auth.ts`): khi `GTV_AUTH=open`, hoặc không có `GTV_ADMIN_TOKEN` **và** chưa có tài
  khoản nào. Lúc đó `/v1` tin header `X-Gtv-Dev`, `/api` không cần đăng nhập.
- **Không chuyển dữ liệu** từ bản tài khoản cũ (admin tạo tài khoản, link kích hoạt): deploy bản này lên volume trống.

## Brain (Pi)

Brain chạy bằng vòng lặp agent của [Pi](https://github.com/earendil-works/pi) (`@earendil-works/pi-agent-core` + `@earendil-works/pi-ai`, ghim bản 1.5.0) **ngay trong tiến trình Operator**. Mỗi job là một agent mới trong RAM: system prompt của Operator + schema JSON của job, và **chỉ có 13 tool chỉ-đọc của gtv** (`src/server/brain/tools.ts`) gọi thẳng vào engine của project. Không có shell, không ghi file, không file session, không đọc `~/.pi`.

Mọi xác thực LLM đi qua Pi: key nhập trên dashboard nằm trong `CredentialStore` của Pi (`src/server/brain/credentials.ts`, bảng `brain_credentials` của `hub.db`, **mã hoá AES-256-GCM bằng `GTV_SECRET_KEY`**). Khi chưa có key lưu, Pi dùng biến môi trường quen thuộc của từng provider.

1. **Kết nối provider** — dashboard **Brain › Providers** (chỉ admin):
   - **Provider có sẵn trong Pi** (Anthropic, OpenAI, Google, OpenRouter, Groq, DeepSeek, xAI…): chọn provider, dán API key. Với Claude, dán được cả API key `sk-ant-api…` lẫn token của `claude setup-token` (`sk-ant-oat…`): Pi tự nhận ra token gói Claude.
   - **Endpoint tương thích OpenAI** (CLIProxyAPI, OpenRouter, LiteLLM, vLLM, Ollama…): id (vd `cliproxy`), base URL (vd `http://127.0.0.1:8317/v1`), giao thức (OpenAI hoặc Anthropic), key nếu có. Thêm được nhiều endpoint.
   - **Đăng nhập bằng tài khoản** (OAuth của Pi, như 9router): Claude Pro/Max (`anthropic`), ChatGPT (`openai`, `openai-codex`), GitHub Copilot, OpenRouter, Kimi Code, xAI, Meta, Radius, và **Google Antigravity** (`antigravity/…`: Gemini, Claude, GPT-OSS qua hạn mức tài khoản Google; lấy từ extension cộng đồng `pi-antigravity`, ghim 0.11.0, `src/server/brain/antigravity.ts`). Operator chạy trên server nên không nhận được redirect về `localhost`: luồng `device` (Copilot, Codex, Kimi, xAI, Meta, Radius) chỉ cần mở trang và nhập mã hiện trên dashboard; luồng `redirect` (Claude: dán mã trang Claude hiện ra; ChatGPT, OpenRouter, Antigravity: trình duyệt sẽ báo lỗi kết nối ở `localhost`/`127.0.0.1` — dán **nguyên URL trên thanh địa chỉ**). Token lưu như key (mã hoá trong `hub.db`), Pi tự làm mới; đăng xuất = xoá key. Phiên đăng nhập sống 10 phút, mỗi provider một phiên.
   - Nút **Kiểm tra** gửi một request nhỏ ("Reply with exactly: OK") để biết ngay key và model có chạy không.
   - API không bao giờ trả key ra: dashboard chỉ hiện `…a1b2` và nguồn của key (`stored credential`, `ANTHROPIC_API_KEY`…).
2. **Chọn model** dạng `provider/model` (vd `anthropic/claude-sonnet-5-5`, `cliproxy/gemini-3-flash`) và **mức suy nghĩ** (`off` mặc định, nhanh nhất; `low`/`medium`/`high` thì Pi đổi thành tham số tương ứng của provider, với Claude là `effort`). Danh sách model = `/models` của từng endpoint + model của các provider có sẵn đã có key. Tên model sai bị từ chối ngay khi lưu.
3. **Biến môi trường** (tùy chọn, làm mặc định cho cài đặt bằng script): `BRAIN_MODEL`, `BRAIN_THINKING`, `BRAIN_BASE_URL` + `BRAIN_API_KEY` (+ `BRAIN_API=anthropic-messages`) thành endpoint `custom` chỉ-đọc trên dashboard (model `custom/<id>` hoặc chỉ `<id>`), và key của provider có sẵn (`ANTHROPIC_API_KEY`, `ANTHROPIC_OAUTH_TOKEN`, `OPENAI_API_KEY`…). Lựa chọn trên dashboard ghi đè biến môi trường.
4. **`GTV_SECRET_KEY`** (compose bắt buộc): đổi khoá thì key cũ không mở được nữa (log báo, job báo `No API key for provider …`), nhập lại trên dashboard. Không đặt (chạy không docker) thì key lưu dạng rõ và dashboard cảnh báo. Dashboard chạy HTTP: nhập key từ máy khác thì đặt dashboard sau HTTPS (reverse proxy, Cloudflare Tunnel).
5. Kiểm tra: `curl -s http://127.0.0.1:7390/health` → `brain: { backend: "pi", ok: true, detail: "pi → anthropic (stored credential)" }`.
6. Lưu ý điều khoản của gói subscription khi dùng cho server cả nhóm — xem SPEC §7.2.1.
7. Model chậm hoặc bị rate limit: gtv cắt job sau `BRAIN_TIMEOUT_MS` (180 s); câu hỏi đã quá `qa.ask_wait_s` thì vẫn được trả lời sau, qua hộp thư của agent. Đo trên self-test RealWorld: Sonnet 5.5 (suy nghĩ off) 12–44 s/job; gemini-3.8-flash-high 24–114 s/job.

Cách gtv gọi Pi (`src/server/brain/pi.ts`): Pi không ép schema JSON nên schema nằm trong prompt và gtv tự kiểm JSON (sai thì nhắc lại một lần, giữ nguyên lịch sử). Chỉ lượt kết thúc bằng `stop` + JSON hợp lệ mới tính là thành công. Lỗi tạm thời (429/5xx, mất kết nối, quá giờ) thành `BrainUnavailable`: tính năng bỏ qua (fail-open) mà không làm nhảy cầu dao. Lỗi khác (key sai, model sai) là lỗi thật và hiện trên dashboard.

Thống kê job (số lượt, p50/p95, lỗi theo loại/ngày/project): dashboard **Brain** và mục _Số liệu kỹ thuật_ cuối tab **Thống kê** của project.

## Backup và nâng cấp

- Backup: volume `gtv-data` (`hub.db`, `projects/*`) — key LLM trong `hub.db` chỉ mở được với cùng `GTV_SECRET_KEY`. Ví dụ:
  `docker run --rm -v docker_gtv-data:/d -v "$PWD":/b alpine tar czf /b/gtv-data.tgz -C /d .`
- Nâng cấp: `git pull` → `docker compose … up -d --build`. Schema dùng `CREATE TABLE IF NOT EXISTS`, bảng mới tự tạo; đổi cột cần script migrate riêng.
- Tự deploy (CD): `docker/auto-deploy.sh` chạy mỗi phút bằng systemd timer trên máy server. Khi `main` có commit mới và **mọi check của GitHub trên commit đó đã xanh**, script fast-forward bản checkout, `docker compose … up -d --build`, rồi chờ `/health`. Không lên trong 60 giây thì quay về commit cũ, nhớ commit hỏng và chờ commit tiếp theo. Máy server chỉ đọc GitHub, không cần mở cổng hay SSH key. Cài (sửa đường dẫn cho đúng chỗ clone):

  ```ini
  # /etc/systemd/system/gtv-deploy.service
  [Unit]
  Description=gtv: deploy new green commits of main
  After=network-online.target docker.service

  [Service]
  Type=oneshot
  User=ubuntu
  ExecStart=/path/to/guide-the-vibe/docker/auto-deploy.sh

  # /etc/systemd/system/gtv-deploy.timer
  [Timer]
  OnBootSec=2min
  OnUnitActiveSec=1min

  [Install]
  WantedBy=timers.target
  ```

  `sudo systemctl enable --now gtv-deploy.timer`; log: `journalctl -u gtv-deploy -f`. Repo private: script đọc trạng thái CI bằng `GITHUB_TOKEN` hoặc tài khoản `gh` đã đăng nhập trên máy (user chạy service), còn `git` cần credential đọc được repo. Biến tuỳ chọn: `GTV_DEPLOY_BRANCH`, `GTV_DEPLOY_REPO`, `GTV_DEPLOY_HEALTH`, `GTV_DEPLOY_PROJECT`. File `docker/compose.local.yml` (nếu có, ví dụ chỉ nghe ở 127.0.0.1) được dùng kèm.

- Reset hoàn toàn dữ liệu Operator: `docker volume rm docker_gtv-data` (mất project, token, lịch sử).

## Server của nhóm (gtv.tenantry.site)

Máy `tokyo-lxd` (Ubuntu, Oracle Cloud) chạy Operator cho `https://gtv.tenantry.site`. Container chỉ nghe ở `127.0.0.1:7390` (`docker/compose.local.yml`, không commit); tên miền đi qua Cloudflare Tunnel nên **không SSH được qua tên miền**, phải dùng IP.

| Mục              | Giá trị                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------ |
| SSH              | user `ubuntu`, cổng `2222`, key ED25519 riêng (xin chủ server; IP cũng hỏi chủ server)     |
| Thư mục repo     | `~/Workspace/int3507/guide-the-vibe` (branch `main`)                                       |
| Compose          | `docker/compose.yml` + `docker/compose.local.yml`, `--env-file docker/.env`, project `gtv` |
| Docker           | cần `sudo` (user `ubuntu` không thuộc group `docker`; sudo không hỏi mật khẩu)             |
| Auto-deploy (CD) | `gtv-deploy.timer` có cài nhưng **đang tắt** (từ 23/11/2026): deploy bằng tay qua SSH      |

> Không ghi IP, key hay token vào repo. Mỗi người giữ key trong `~/.ssh` của mình.

### Cài SSH trên máy dev (Windows, một lần)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\ssh-setup.ps1 -HostIp <IP> -KeyPath <file key>
ssh gtv-hoc
```

[`scripts/ssh-setup.ps1`](../scripts/ssh-setup.ps1) chép key vào `~/.ssh/gtv-hoc.key` (sửa xuống dòng, thêm newline cuối file — thiếu nó OpenSSH báo `not a key file`), khoá quyền chỉ cho user hiện tại, ghi host key vào `known_hosts`, thêm `Host gtv-hoc` (cổng 2222, user `ubuntu`) vào `~/.ssh/config` rồi thử đăng nhập. Chạy lại an toàn (đổi IP thì chạy lại với IP mới). Linux/macOS: tương đương `ssh -i <key> -p 2222 ubuntu@<IP>` sau `chmod 600 <key>`.

### Deploy qua SSH

Push lên `main` và đợi CI xanh trước, rồi:

```bash
ssh gtv-hoc
cd ~/Workspace/int3507/guide-the-vibe
git pull --ff-only
C="sudo docker compose -f docker/compose.yml -f docker/compose.local.yml --env-file docker/.env -p gtv"
$C build --build-arg GTV_COMMIT=$(git rev-parse HEAD) && $C up -d
curl -s 127.0.0.1:7390/health          # "ok": true và "commit" = commit vừa pull
```

- Log: `$C logs -f operator`. Kiểm tra từ ngoài: `https://gtv.tenantry.site/health` (trường `commit`).
- Lỗi thì quay lại commit trước: `git reset --hard <commit cũ>` rồi chạy lại dòng `build … up -d`. Dữ liệu (volume `gtv_gtv-data`) không bị đụng.
- Đừng `git pull` khi trên server có sửa đổi chưa commit (`git status`); `docker/compose.local.yml` là file riêng của server, để nguyên.
- Bật lại CD (sau khi thống nhất với chủ server): `sudo systemctl enable --now gtv-deploy.timer`. Script cần đọc được trạng thái CI của repo private: đăng nhập `gh` với `GH_CONFIG_DIR=~/.config/gtv-gh` (drop-in `gtv-deploy.service.d/github.conf`) — hiện chưa đăng nhập.

## Sự cố thường gặp

| Triệu chứng                                                 | Nguyên nhân / cách xử lý                                                                                                               |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `/health` báo `brain.ok = false`, `… /models -> 401`        | `BRAIN_API_KEY` sai với endpoint `BRAIN_BASE_URL` → sửa trong `docker/.env`, `up -d`                                                   |
| Ticket: "Operator could not answer", log `model error: …`   | key/model sai, hoặc model không gọi được tool → đổi model ở dashboard **Brain**                                                        |
| `no brain model set (BRAIN_MODEL)` / `needs BRAIN_BASE_URL` | chưa đặt `BRAIN_MODEL`, hoặc model `custom/…` mà thiếu `BRAIN_BASE_URL`                                                                |
| Brain trong docker không gọi được LLM trên máy chủ          | dùng `http://host.docker.internal:<port>` (Linux: thêm `extra_hosts: ["host.docker.internal:host-gateway"]`) và mở firewall cho Docker |
| repo URL thành `C:/Program Files/Git/...`                   | MSYS path conversion → `MSYS_NO_PATHCONV=1`, PATCH lại `repo_url`                                                                      |
| Dashboard 401                                               | nhập `GTV_ADMIN_TOKEN` (lưu trong localStorage)                                                                                        |
| Daemon 401                                                  | khoá của máy bị thu hồi hoặc tài khoản bị xoá → `gtv login` trên máy đó                                                                |
| Hook không chạy                                             | xem [agents.md](agents.md#xử-lý-sự-cố)                                                                                                 |
| `last_sync.ok = false`                                      | repo URL / quyền đọc; xem log `operator`; bấm **Sync now**                                                                             |

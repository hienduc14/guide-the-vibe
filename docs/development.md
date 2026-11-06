# Phát triển

## Thiết lập

```bash
npm ci                 # root: server, daemon, codeintel (.npmrc: ignore-scripts=true — grammar dùng .wasm có sẵn)
npm run web:install    # dashboard
npm run typecheck
npm test
```

Chạy server không docker: `GTV_DATA=.gtv-data GTV_ADMIN_TOKEN=dev node src/server/main.ts` (Brain tắt nếu không đặt `BRAIN_BACKEND=pi` + `BRAIN_MODEL`, thường kèm `BRAIN_BASE_URL`/`BRAIN_API_KEY`; xem [operations.md](operations.md#brain-pi)).
Dashboard dev: `npm run web:dev` → `http://localhost:5173` (proxy về `GTV_SERVER`, mặc định `:7390`).

### Node 24 chạy thẳng TypeScript (type stripping)

- Import tương đối **phải có đuôi `.ts`**: `import { x } from "./x.ts"`.
- Import chỉ-kiểu dùng `import type` (bật `verbatimModuleSyntax`).
- Không dùng cú pháp cần biên dịch: `enum`, `namespace`, parameter properties (`constructor(private x)`) — `erasableSyntaxOnly`.
- Không có bước build cho server/daemon; `tsc --noEmit` chỉ để kiểm tra kiểu.

## npm scripts

| Script                                |                                                     |
| ------------------------------------- | --------------------------------------------------- |
| `server`                              | `node src/server/main.ts`                           |
| `daemon`, `gtv`                       | daemon / CLI                                        |
| `test`, `typecheck`                   |                                                     |
| `web:install`, `web:dev`, `web:build` | dashboard                                           |
| `sandbox`                             | tạo sandbox mini-shop                               |
| `selftest:realworld`                  | self-test trên RealWorld ([testing.md](testing.md)) |
| `build:npm`                           | đóng gói CLI cho dev thành `dist/npm` (xem dưới)    |

### Package npm `guide-the-vibe`

Dev cài bằng `npx guide-the-vibe join <link>`. Package chỉ gồm CLI (daemon, hook, MCP, join): `scripts/build-npm.mjs` dùng esbuild gộp thành **một file** `gtv.mjs` không phụ thuộc gì, chạy trên Node ≥ 20 (Node không chạy TypeScript nằm trong `node_modules`, nên không publish thẳng `src/`). Skill được nhúng vào file. Khi cài, file tự chép sang `~/.gtv/bin/gtv.mjs` và hook/MCP trỏ vào đó, nên xoá cache của npx không làm hỏng gì.

Phát hành: tăng `version` trong `package.json`, rồi `npm run build:npm && npm publish dist/npm`. Dev nhận bản mới khi chạy lại `npx guide-the-vibe@latest install` (chép đè `~/.gtv/bin/gtv.mjs`).

## Quy ước

- Mỗi file mở đầu bằng 1–3 dòng comment nói file làm gì; comment giải thích **vì sao**, không kể lại code.
- Tên: `camelCase` hàm/biến, `PascalCase` class/type, `SCREAMING_CASE` hằng; key feature dạng `nhom.ten` (`detect.l2_symbol`).
- Thông điệp gửi cho agent viết bằng tiếng Anh, có tiền tố `[gtv …]`, nói rõ việc cần làm (tool nào gọi tiếp).
- Hook không bao giờ throw ra ngoài daemon: lỗi ⇒ cho qua (fail-open).
- Đổi shape API ⇒ cập nhật `web/src/api/types.ts` và [api.md](api.md).
- Ranh giới giữa các vùng: [project-structure.md](project-structure.md).

## Cách làm thường gặp

### Thêm feature flag

1. Thêm key vào `FEATURES` trong `src/shared/features.ts` (`default`, `requires?`, `description`).
2. Kiểm tra mode trong code: `engine.mode("key")` / `isActive(...)`; bọc phần có thể lỗi bằng `engine.guarded("key", fn)` để có cầu dao.
3. (Tùy) metric trong `layers()` của `src/server/http/admin-routes.ts` và nhãn trong `web/src/pages/project/LayersTab.tsx`.

### Thêm một lớp phát hiện

1. Viết hàm thuần trong `src/server/detect/lX.ts` trả `FoundConflict[]` (từ `l0.ts`). `key` phải ổn định cho cùng một vấn đề (`Lx|wsA|wsB|subject`).
2. Gọi trong `Engine` (thường ở `detectForWorkspace` hoặc `runL0`) qua `applyLayer("detect.lx", "Lx", found, scope)` — tự xử lý `off/shadow/on`, lưu, thông báo, đóng conflict không còn.
3. Thêm feature key và map layer trong `LAYER_OF` (`admin-routes.ts`).
4. Test với repo git tạm (`test/helpers.ts`: `makeOrigin`, `snapshotWorktree`).

### Thêm loại job cho Brain

1. Thêm vào `JobKind` (`src/server/brain/types.ts`), viết prompt + JSON schema trong `prompts.ts`.
2. Gọi `engine.brain.run({ kind, prompt, schema })` bên trong `engine.guarded(...)`; `MeteredBrain` tự gắn project và ghi thống kê.
3. Test bằng `FakeBrain` (xem `test/server.test.ts`).

### Thêm tool

- **Cho Brain**: `tool(...)` trong `src/server/brain/tools.ts` (handler nhận `Engine` của project, tham số khai báo bằng zod và được kiểm trước khi chạy) — chỉ đọc, giới hạn kích thước output (`text()` cắt 24 000 ký tự). Pi tự gửi tên + mô tả + JSON schema của tool cho model; test danh sách tool trong `test/pi.test.ts`.
- **Cho agent**: thêm case trong `runTool` (`src/daemon/tools.ts`), đăng ký trong `src/daemon/mcp.ts` (`gtv_<tên>`); cập nhật `SKILL.md` nếu agent cần biết khi nào dùng.

### Thêm adapter cho agent mới

1. `src/shared/types.ts`: thêm `AgentKind` và `AGENT_CAPABILITIES` (ask / inject / rewake).
2. `src/daemon/hooks.ts`: `normalize` (payload → `pre_edit/post_tool/…` + đường dẫn file) và `formatOutput`.
3. `src/daemon/install.ts` + case trong `cli.ts install`.
4. Test end-to-end kiểu `test/e2e.test.ts` (gửi đúng payload của agent tới `/hook/<agent>`).

### Thêm trang dashboard

Xem [../web/README.md](../web/README.md): kiểu trong `api/types.ts`, hàm trong `api/endpoints.ts`, trang trong `pages/`, dữ liệu qua `usePoll`.

## Chiến lược test

- **Không gọi LLM thật trong test tự động**: dùng `FakeBrain` có kịch bản trả lời.
- Git thật trong thư mục tạm (`makeOrigin`, clone, `snapshotWorktree`), server qua `app.request(...)` hoặc cổng thật (`GTV_PORT=0`).
- e2e: 2 daemon thật (cổng 17391/17392) + server + git, payload hook đúng định dạng Claude/Codex.
- Thử với LLM thật (Brain, Claude Code, Codex): **chỉ vài lượt**, nói trước sẽ tốn bao nhiêu job — quota là gói subscription của người dùng.

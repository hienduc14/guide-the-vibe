# Kiểm thử

## Test tự động

```bash
npm test                                   # tất cả, tuần tự (--test-concurrency=1)
node --test test/codeintel.test.ts         # một file
npm --prefix web run build                 # kiểm tra kiểu + build dashboard
```

| File                       | Phạm vi                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/codeintel.test.ts`   | trích symbol 4 ngôn ngữ, `diffSymbols` (đổi chữ ký/đổi tên/xóa/sửa thân), `importPointsTo` (kể cả module có dấu chấm như `profile.utils`), `patternsOverlap` (regression `**/migrations/**`), `parseMergeTree`, graph base + overlay với repo git thật                                                                                                                                                                                                                                                                                                                                       |
| `test/server.test.ts`      | project `default`: briefing, L0 same-file, đăng ký task + KB, snapshot → L2 + L1, shadow mode, hỏi đáp bậc 1/2/3 với `FakeBrain`, KB `unverified → active`, tool chỉ-đọc của Brain                                                                                                                                                                                                                                                                                                                                                                                                           |
| `test/accounts.test.ts`    | tài khoản trong project: xoá tài khoản bỏ tư cách thành viên, link chia sẻ, hồ sơ thành viên, charter. Đăng ký, cookie, phiên, đặt lại mật khẩu, khoá/xoá: `auth.test.ts`; lời mời: `invites.test.ts`; thành viên: `members.test.ts`; tạo project, kiểm repo: `projects.test.ts`; máy: `devices.test.ts`                                                                                                                                                                                                                                                                                     |
| `test/connect.test.ts`     | kết nối máy: start → duyệt → poll nhận khoá một lần, từ chối, hết hạn, `/v1/me`, logout, thu hồi, giới hạn tần suất                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `test/permissions.test.ts` | quyền trong project: viewer chỉ đọc, developer trả lời câu hỏi của mình và sửa việc của mình, manager, người ngoài 404/403, overview lọc theo thành viên                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `test/cli.test.ts`         | phần thuần của CLI: địa chỉ server, khớp repo với project, khối exclude, `gtv off` gỡ đúng phần của gtv                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `test/admin.test.ts`       | hub 2 project tách biệt, khoá máy, `repoKey`/resolve, overview/stats/layers/activity/messages, metering Brain theo project, sửa policy, lưu trữ project                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `test/e2e.test.ts`         | server trên cổng thật + 2 daemon (alice = Claude, bob = Codex) + git: briefing, đăng ký qua tool, cảnh báo L0 chèn vào Claude, snapshot → L2 high ⇒ Claude `ask` / Codex `deny` 1 lần, hỏi → chuyển → trả lời → đánh thức Claude, statusline                                                                                                                                                                                                                                                                                                                                                 |
| `test/pi.test.ts`          | `PiBrain` với endpoint tương thích OpenAI giả lập (SSE như CLIProxyAPI/OpenRouter): chọn model (`custom/…`, provider có sẵn, lỗi rõ ràng), thử lại khi trả lời không phải JSON (giữ lịch sử), key sai/400 là lỗi thật, không kết nối/quá giờ = `BrainUnavailable`, health + danh sách model; provider trên dashboard (key mã hoá, không lộ qua API, sai `GTV_SECRET_KEY` thì báo lỗi rõ, giữ qua restart, mức suy nghĩ); end-to-end: câu hỏi bậc 1 → model giả gọi `find_symbol` → tool chạy thật trên engine → ticket `answered` có nguồn; model chỉ thấy 13 tool chỉ-đọc; `/mcp` không còn |
| `test/regressions.test.ts` | lỗi tìm ra khi review: thư mục trần trùng glob bên dưới, ADR bị thay thế không "sống lại" khi main đổi, `git pull` không đóng task của người pull                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `test/helpers.ts`          | `makeOrigin`, `writeFiles`, `commitAndPush`, `tempDir`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## Self-test trên repo thật: RealWorld

`scripts/selftest/realworld.ts` — repo `gothinkster/node-express-realworld-example-app`, 2 dev sửa nhẹ song song.
Agent được giả lập bằng **đúng payload hook** của Claude Code (alice) và Codex (bob) gửi tới **daemon thật**; file được sửa thật trong 2 clone, snapshot đẩy thật, Operator (docker) và Brain là thật — **khoảng 3 job Brain mỗi lần chạy**.

Chuẩn bị: stack docker chạy và Brain có LLM ([operations.md](operations.md#brain-pi)), rồi trong Git Bash:

```bash
bash scripts/selftest/prepare.sh
```

Script làm một lần cho mỗi lượt chạy:

1. clone bare repo upstream vào `sandbox/realworld/origin.git` (lần đầu), đưa `master` về commit đã ghim, xóa `refs/gtv/*`;
2. tạo/reset 2 clone `sandbox/realworld/{alice,bob}` và cài hook Claude (alice, 7391) / Codex (bob, 7392);
3. **xóa dữ liệu Operator** (volume `docker_gtv-data`), tạo lại project `realworld` (+ `mini-shop` nếu có sandbox), cấp token mới cho alice/bob và ghi vào `sandbox/.home-<dev>/config.json`.

Sau đó bật 2 daemon (script in sẵn lệnh, mỗi lệnh một terminal) và chạy:
`GTV_ADMIN_TOKEN=<admin> npm run selftest:realworld`.

Kịch bản và các check:

- alice đổi `profileMapper(user, id)` → `profileMapper(user, viewer?: { id })` và sửa 5 caller; giới hạn page size 100.
- bob thêm `getCommentAuthors()` gọi chữ ký cũ, sửa cùng dòng page size, và sửa độc lập `tag.service.ts`.
- 21 check: briefing; không có cảnh báo critical nhầm; phản hồi khi đăng ký (trước khi có code); cảnh báo scope; không báo nhầm sửa độc lập; L2 high chỉ trỏ dòng bob viết; L1 text; Claude `ask` / Codex `deny` 1 lần; tin chèn vào agent; Brain trả lời bậc 1 có nguồn; Brain chuyển câu hỏi quyết định cho alice; câu trả lời quay lại bob; L1 tự hết sau khi phối hợp; task alice tự đóng sau merge; WIP bob merge sạch với master mới.

## Benchmark conflict: `npm run bench:conflicts`

`scripts/bench/conflicts.ts`: 8 cặp task trên RealWorld (`scripts/bench/scenarios.ts`), mỗi cặp làm theo 3 cách rồi merge (A trước, B sau):

- **none**: không điều phối;
- **lock**: chỉ giữ chỗ file;
- **gtv**: Operator thật chạy trong tiến trình + 2 daemon thật, hook đúng định dạng Claude Code / Codex, **Brain tắt** (không tốn quota).

Khi được cảnh báo trước lúc merge, B dùng bản sửa "đã điều chỉnh" soạn sẵn. Đúng sai được đo bằng `git merge-tree` (conflict, số dòng bị đè) và `tsc` trên cây đã merge (lỗi type mới = conflict logic).

Không cần docker. Lần đầu clone repo nguồn (mặc định `hienduc14/realworld-gtv-bench`, đổi bằng `BENCH_REPO`) vào `sandbox/bench/`. Chạy vài cặp: `BENCH_ONLY=S1,S2`.

Thêm cặp mới: thêm vào `SCENARIOS`, có `truth` (`text` / `logic` / `none`) và bản `adapted` của B.

## Đọc báo cáo — `docs/reports/`

`docs/reports/selftest-realworld.md` được ghi đè mỗi lần chạy (đừng sửa tay). Gồm: tổng số check pass, số job Brain và p50, bảng check, timeline theo giây, trích câu trả lời của Brain, trạng thái từng layer sau khi chạy. Dữ liệu thô: `sandbox/realworld/selftest.json`.

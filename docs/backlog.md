# Việc để sau

Những ý đã bàn nhưng chưa làm, và lỗi đã biết. Ghi kèm lý do và chỗ trong code để người làm sau khỏi phải tìm lại từ đầu.
Làm xong mục nào thì xoá khỏi đây và ghi vào commit.

## Tài khoản v2 (27/11/2026): phần còn lại

Đã làm theo [plans/auth-v2.md](plans/auth-v2.md): tự đăng ký, cookie, link mời, thành viên trong `hub.db`, ai cũng tạo
project, Máy của tôi, dashboard theo prototype `docs/prototype/auth/`. Còn lại:

- Chưa deploy (bước 7: sao lưu, volume trống, tạo quản trị `hoc` qua `/setup`, chạy thử thật trên server) và chưa
  publish npm 0.2.0 (bước 8).
- Link mời chỉ lưu bản băm nên chỉ hiện một lần lúc tạo; danh sách link không có nút Chép (mất link thì thu hồi, tạo mới).
- Máy của Developer vẫn ghi được mọi route `/v1/p/:id` (như trước); ngoại lệ Developer chỉ áp cho phiên dashboard.
- Kiểm địa chỉ repo lúc tạo/đổi `repo_url`; host đổi DNS sau đó (DNS rebinding) vẫn được clone; mirror fetch chưa đặt
  `GTV_ALLOW_PROTOCOL`.
- Cookie phiên hết hạn 30 ngày sau lần đăng nhập ở phía trình duyệt, dù server gia hạn khi dùng (chưa gửi lại cookie).
- "Việc/câu hỏi chờ tôi" trên trang chủ và thanh bên hỏi từng project mỗi 30 giây; nhiều project thì nên có một
  endpoint gộp.
- Giới hạn số project mỗi người, số việc AI mỗi project: chưa làm (chủ dự án chốt 27/11).

## Tài khoản và CLI (27/11/2026): phần còn lại

- Tab Tổng quan chỉ biết file một người sửa qua hook sửa file (Edit/Write, apply_patch). Agent sửa bằng lệnh shell (`sed -i`)
  thì không có footprint: người đó không hiện ở cột trái và file của họ không hiện, dù vụ đụng vẫn được bắt (từ snapshot).
  Hướng sửa: lấy danh sách file từ diff của snapshot (`repo.diffNames(base, snapshot_sha)`) khi không có footprint.
- Thử thật 27/11 (Claude Code + Codex, 2 tài khoản, server local): đăng nhập máy, `gtv on`, cảnh báo đụng nhau, hỏi đáp
  hai chiều đều chạy. Hai lỗi tìm ra đã sửa: workspace bị bỏ khỏi so sánh khi phiên agent kết thúc dù code dở vẫn còn;
  server không tắt khi còn luồng sự kiện của daemon nên daemon bám vào tiến trình cũ.
- `gtv login` chưa có cách đăng nhập không cần trình duyệt trên máy khác (chép mã sang máy có trình duyệt thì vẫn được:
  trang `/connect` nhận mã gõ tay).
- Giới hạn tần suất nằm trong bộ nhớ của tiến trình (reset khi khởi động lại), theo `cf-connecting-ip` / `x-forwarded-for`.
- `gtv doctor` chỉ kiểm tra repo có trong `~/.gtv/repos.json` (repo cài bằng bản cũ: chạy `gtv on` lại một lần trong đó).

## Bàn giao 26/11/2026

Quy trình hiện tại của repo: **không mở PR**, commit thẳng `main`, push, rồi deploy qua SSH như
[operations.md](operations.md#deploy-qua-ssh). Bản đang chạy trên gtv.tenantry.site: `6ef96ba`.

### Cần làm ngay (chặn tính năng)

1. **Tài khoản AI của server bị từ chối.** Log operator: `Antigravity denied this request … This service has been disabled`
   (model `antigravity/claude-sonnet-5-5`). Mọi job brain đều lỗi: trả lời câu hỏi bậc 1, L3, tóm tắt (`brain.summary`).
   Cầu dao đã tự tắt `brain.summary` sau nhiều lần lỗi (reset khi container khởi động lại).
   Sửa: dashboard › **AI trả lời** đăng nhập lại, hoặc chọn provider / model khác. Sau đó mở tab Trao đổi và Tổng quan để
   tóm tắt được viết (thẻ "Hôm nay · AI tóm tắt" chỉ hiện khi đã có bản tóm tắt).
2. ~~**`/health` báo brain `ok` dù model không gọi được.**~~ Đã có `brain.failing` (27/11). `health()` của backend Pi chỉ kiểm tra cấu hình, không gọi model, nên chấm xanh
   ở menu "AI trả lời" đánh lừa. Nên đưa lỗi gần nhất của `brain_jobs` (bảng trong hub db, `src/server/brain/metered.ts`) vào `/health` và
   trang AI trả lời, ví dụ "3 job lỗi trong 10 phút qua: …".
3. **Gói npm 0.2.0 chưa phát hành** (27/11). `dist/npm` đã build (CLI mới: `gtv login`, `gtv on`…). Cần chủ package:
   `npm run build:npm`, rồi `cd dist/npm && npm publish --auth-type=web`. Trước khi publish, người dùng chỉ có 0.1.x
   (lệnh `join` không còn chạy với server mới: `/v1/join` trả 410); máy đã cài trước vẫn chạy nhờ token cũ đã chuyển thành máy.

### Lỗi đã biết

- ~~**Danh sách Trao đổi bị luồng xung đột chiếm chỗ.**~~ Trang mới gom theo vụ và theo việc (27/11). Mỗi cặp file/hàm là một luồng, một lần đụng nhau sinh 5–8 luồng. Nên gom theo cặp
  người (hoặc theo cặp Việc): "hien ↔ hien-test · 6 xung đột ▸". Chỗ: vòng `engine.store.conflicts("all")` trong `conversations()` (`src/server/project/conversations.ts`).
- **Đăng ký việc mới bị gắn vào Việc cũ của cùng người.** Test 26/11: việc "Kiểm tra image là URL" của hien nằm dưới Việc
  "X1: module validation dùng chung". Nguyên nhân: `Board.resolveFor` làm tiếp Việc còn dở của dev trong cùng checkout. Nên so tiêu đề
  hoặc chỉ làm tiếp khi phiên mới không mang tiêu đề khác hẳn.
- ~~**Sơ đồ "Ai đang sửa file nào" hiện agent "Chưa đăng ký việc"**~~ Sơ đồ mới chỉ có thẻ cho workspace còn phiên hoặc còn việc mở (27/11). sau khi agent đã `gtv_finish_task` (đăng ký đóng, footprint còn).
  Nên hiện tiêu đề Việc vừa xong (mờ), hoặc ẩn agent không còn phiên và không còn đăng ký mở. Chỗ: `buildMap` trong
  `web/src/pages/project/WorkMap.tsx`.
- **Chạy agent không tương tác (`claude -p`, `codex exec`) thì không bao giờ thấy "Đang chạy"**: phiên kết thúc ngay khi xong. Đúng hành vi,
  nhưng nên ghi rõ trong tài liệu demo.
- **`gtv status` lần đầu sau khi daemon nối project trả "not connected"** vì state chưa tải xong (`/status` trong `src/daemon/daemon.ts`
  gọi `link()` rồi đọc `stateOf()` ngay). Nên chờ lần tải đầu (có timeout ngắn).
- **Ngân sách tóm tắt bị trừ cả lần lỗi**: `budget()` tăng bộ đếm trước khi chạy (`src/server/project/summaries.ts`). Khi provider hỏng, 80
  lượt/ngày có thể hết sau vài phút. Nên chỉ trừ khi job thành công, hoặc dừng hẳn khi cầu dao đã nhảy. Bộ đếm nằm trong bộ nhớ, reset khi
  khởi động lại.
- **Tóm tắt luồng chỉ được tạo khi có người mở tab Trao đổi** (`summarizer().threads()` gọi từ route conversations, tối đa 2 luồng mỗi lần).
  Đủ cho demo; nếu cần tóm tắt sẵn thì gọi thêm khi ticket đóng / conflict được ack / `gtv_finish_task`.
- **Nhiều dev trên một máy:** `gtv login` không lưu `GTV_DAEMON_PORT` vào config, và khi hook tự bật lại daemon thì không có `GTV_HOME` của danh
  tính thứ hai. Clone test `realworld-gtv-bench-b` chạy được vì `gtv-test.ps1` đặt biến môi trường trước, và port đã được ghi tay vào
  `.gtv-home/config.json`. Nên để `gtv login` lưu port, và ghi `GTV_HOME` vào lệnh hook khi khác mặc định (`cmd()` trong
  `src/daemon/install.ts`).
- **Số lần sửa cũ bị thổi phồng**: trước bản sửa `1cfa64e`, mỗi lần cài lại gtv cộng thêm một bộ hook HTTP, nên footprint `count` của dữ liệu
  cũ (realworld) cao gấp nhiều lần thực tế. Dữ liệu mới đúng.
- **Agent hiện chữ "O" thay vì logo** cho các phiên cũ đăng ký với agent `other` (lượt bench trước). Không phải lỗi code.

### Chưa quyết

- **Role viewer có được xem diff không.** `GET /api/projects/:id/file` (màn chi tiết file) trả code chưa commit của dev cho mọi người xem được
  dashboard, kể cả link chia sẻ chỉ đọc. Nếu chỉ manager được xem thì chặn trong `admin-routes.ts` và ẩn phần diff ở `FileDialog.tsx`.

### Chưa kiểm tra / thiếu test

- Hai lần deploy cuối (`bab85be`, `6ef96ba`) bỏ qua test theo yêu cầu. CI trên `main` của `bab85be` xanh; `6ef96ba` lúc viết còn đang chạy.
- **Chưa có test** cho: ghi chú có `tag`/`summary`, `options` của câu hỏi, `summary` khi `gtv_finish_task`, ghi chú gắn vào luồng Việc,
  `summaries.ts` (cache, hash, ngân sách), ngôn ngữ trong briefing, API `GET /api/projects/:id/file`. Có thể giả brain bằng `NullBrain`
  kiểu như `test/e2e.test.ts`.
- Lớp tóm tắt bằng brain **chưa chạy thành công lần nào** (provider hỏng, xem mục 1). Chưa xem được chất lượng tóm tắt tiếng Việt.

### Môi trường test để lại trên máy dev

- `D:\Projects\realworld-gtv-bench-b`: clone thứ hai, dev **hien-test** (daemon cổng 7392). Chạy `.\gtv-test` (Codex) hoặc
  `.\gtv-test claude`. Mọi file của danh tính này nằm trong thư mục đó và được ignore qua `.git/info/exclude`.
  Còn thay đổi chưa commit của agent trong `auth.service.ts` (giới hạn username, bio).
- `D:\Projects\realworld-gtv-bench` (dev **hien**, nhánh `bench/on/X1/c`): còn thay đổi chưa commit của agent trong `auth.service.ts` và
  `utils/validation.ts` (chuẩn hoá email, kiểm tra image). Có `.claude/settings.local.json.bak` (bản trước khi dọn hook nhân bản).
- Server thật sẽ được xoá sạch khi deploy bản tài khoản mới (auth v2), nên tài khoản `hien-test` cũ cũng mất theo.
- Dữ liệu cũ trên project realworld: xung đột và câu hỏi tiếng Anh từ lượt bench 19 ngày trước, 3 câu hỏi vẫn "chờ người quyết" trong
  "Cần xử lý". Nên đóng/bỏ qua trước khi demo.

## Đã làm (26/11/2026), để tham chiếu

- **Tin nhắn có cấu trúc** (`bab85be`): `gtv_log_work` có `kind` + `summary`, `gtv_ask` có `options`, `gtv_finish_task` có `summary`;
  server tự lấy câu đầu cho client cũ (`oneLine` trong `src/shared/types.ts`). Ngôn ngữ nhóm (`charter.language`) trong briefing.
  Luồng xung đột mang dữ liệu, UI tự dựng tiêu đề; ghi chú của agent nằm trong luồng Việc. Lớp `brain.summary` (bảng `summaries`).
- **Sơ đồ Agent ↔ File và màn chi tiết file có diff** (`579c8cb`), tên file không còn bị cắt.
- **Sửa hook nhân bản khi cài lại gtv** (`1cfa64e`).

## Đã làm (24/11/2026), để tham chiếu

- **Dashboard (UI)**: cột giờ ở feed, render markdown cho tài liệu, ô trống bị dính chữ, chip file bị cắt chữ, nhãn trên sơ đồ code, layout lệch do thanh cuộn, sidebar nhấp nháy khi tải trang, khung Trao đổi có hai thanh cuộn, nhãn tiếng Việt cho mọi loại conflict, avatar 2 chữ cái, trang Brain gập phần thêm provider, biểu đồ toàn số 0, số liệu kỹ thuật theo khoảng ngày đang chọn.
- **Một nguồn cho Việc**:
  - Mọi lần đăng ký đều nằm trên một Việc của bảng (`board_tasks`).
  - Phiên agent mới trong cùng checkout làm tiếp Việc còn dở của dev thay vì tạo Việc trùng (`Board.resolveFor`).
  - Đăng ký cũ chưa có Việc được gắn một lần khi server khởi động (`Board.adoptOrphans`).
  - Thành viên được thêm ở mọi chỗ có người làm (`Store.ensureMember`, `backfillMembers`).
  - Mọi lời gọi tool của agent đều làm mới `last_seen`.
  - "Đang làm" có một định nghĩa dùng chung (`summarize`, cờ `working`).
  - Briefing nhắc các Việc còn dở của dev.

## Dữ liệu từ agent: phần còn lại

Đã làm phần lớn (xem trên). Còn:

- Ghi chú hệ thống trên bảng việc (`board.ts`) và `board_update.changes` vẫn là câu tiếng Anh; nên lưu `{field, from, to}` để UI dựng câu.
- `truncate()` (`src/shared/util.ts`) cắt cứng câu hỏi thành tiêu đề tài liệu Hỏi đáp, sinh ra "… (N more chars)".
- Feed hoạt động chưa gom theo cặp người hoặc theo Việc.
- Đã quyết định **không** làm cơ chế tự cập nhật skill: dev cập nhật bằng `npx guide-the-vibe@latest install`.

## Một nguồn cho Việc: phần còn lại

- **Việc im lặng:** Việc `in_progress` không có phiên nào hoạt động trong N ngày (ví dụ 2) nên vào "Cần xử lý" (loại `stale`), kèm nút "Trả về To do" cho lead.
- **Cột "Ai đang làm gì"** vẫn đọc theo `tasks` và hiện cả đăng ký đã im lặng nhiều ngày. Nên làm mờ hoặc tách nhóm "im lặng" theo `last_seen` của phiên. (Chấm Đang chạy / Tạm nghỉ đã có.)
- **Giới hạn của cách làm tiếp Việc cũ:** xem mục "Đăng ký việc mới bị gắn vào Việc cũ" ở phần bàn giao.
- **`gtv_tasks`** chưa chia nhóm (đang dở của bạn / giao cho bạn / chưa ai nhận). Muốn chia thì phải sửa định dạng ở `src/daemon/tools.ts`, tức là sửa CLI. Hiện briefing đã bù phần "đang dở".

## Dashboard: phần còn lại

- Trang Tổng quan có nhiều khoảng trống khi chỉ có 1–2 project.
- Vài chữ tiếng Anh còn sót: "Ưu tiên high" ở "Cần xử lý" (`attention()` trong `conversations.ts`), cột "Chờ merge".
- Trang "Lớp phát hiện" vẫn dùng thuật ngữ kỹ thuật (`detect.l0_path`, off / shadow / on); nên viết mỗi lớp một câu bắt được gì và đổi "shadow" thành "Chạy thử (chỉ ghi lại)".
- Trên điện thoại, sơ đồ file để khoảng trống dưới danh sách (chiều cao tính theo cột agent đã bị ẩn).
- Khung Trao đổi tính chiều cao theo `100dvh - 250px`. Khi có thông báo lỗi đồng bộ ở đầu trang, trang vẫn cuộn thêm khoảng 100px.

## Giao diện project mới (27/11/2026): phần còn lại

Kế hoạch: `docs/prototype/PLAN.md`.

- "Gộp thử" trong khung xem file chưa có bản gộp do AI viết: chỗ đụng hiện bản của từng người xếp chồng.
- Mức giám sát "Chặt" (chặn agent sửa file đang đụng cho tới khi có người cho phép): cần cờ mới ở daemon và gói npm mới.
- Khung xem file gộp theo tên dev: một người có hai workspace cùng sửa một file thì chỉ thấy một bản.

# Kế hoạch: làm lại trang project của gtv theo prototype

Viết ngày 26/11/2026, cho bản `c19d846` của `hienduc14/guide-the-vibe`. Người thực hiện đọc hết file này trước khi sửa dòng code đầu tiên.

## 1. Việc cần làm, tóm tắt

Thay toàn bộ phần giao diện của **một project** trong dashboard (mọi thứ dưới `/p/:id`) bằng thiết kế trong prototype: 11 màn cũ gom thành 5 màn và một mục Thiết lập, có nền sáng và nền tối. Kèm theo là các thay đổi phía server để giao diện mới có đúng dữ liệu nó cần.

Xong nghĩa là:

- Mọi màn trong prototype chạy trên dữ liệu thật, ở cả hai nền, ở 1440px và 400px.
- Không chức năng nào của trang cũ bị mất, trừ những thứ ghi ở mục 3.
- `npm run check` và `npm run web:build` đều qua; CI xanh trên Ubuntu và Windows.
- `DESIGN.md` và `docs/` mô tả đúng giao diện mới.

## 2. Đọc trước

| Thứ | Ở đâu | Dùng để |
| --- | --- | --- |
| Prototype | `/home/ubuntu/Workspace/int3507/gtv-prototype/` (`index.html`, `styles.css`, `app.js`, `data.js`) | **Nguồn chuẩn** cho bố cục, màu, chữ, lời trên giao diện, cách bấm. Xem bằng `https://pages.tenantry.site/gtv-prototype/` hoặc `python3 -m http.server` trong thư mục đó |
| Ghi chú | `NOTES.md` cùng thư mục | Lỗi của trang cũ, những gì prototype chưa vẽ |
| Repo | `/home/ubuntu/Workspace/int3507/guide-the-vibe` | Code thật. Đọc `CONTRIBUTING.md`, `docs/development.md`, `docs/project-structure.md`, `docs/backlog.md` |
| Trang đang chạy | `http://127.0.0.1:7390` (đường hầm tới server nhóm), token admin trong `docker/.env` của repo | Chỉ để **xem** dữ liệu thật. Không ghi gì lên đó |

Quy ước của repo cần giữ:

- Node 24 chạy thẳng TypeScript: import có đuôi `.ts` ở phía server, `import type` cho type, không `enum`.
- Code và comment tiếng Anh, tài liệu và chữ trên giao diện tiếng Việt.
- Tính năng mới của server đi kèm feature flag (`src/shared/features.ts`) và test. Test không gọi LLM thật.
- Mọi lỗi phía gtv phải fail-open: không bao giờ chặn agent vì gtv hỏng.
- Icon: Lucide (`lucide-react`). Logo agent: `web/public/agents`.
- Commit thẳng `main`, thông điệp tiếng Anh dạng mệnh lệnh, mỗi giai đoạn ở mục 6 là một commit. Trước mỗi commit: `npm run check` và `npm run web:build`. **Không deploy**: server nhóm do người có khoá SSH deploy tay.

Không đụng tới: daemon và gói npm (`src/daemon`, `scripts/build-npm.mjs`), các lớp phát hiện (`src/server/detect`), các trang ngoài project (`OverviewPage`, `BrainPage`, `DevsPage`, `UsersPage`, `LoginPage`) ngoài việc chúng nhận bảng màu và khung mới.

## 3. Những chỗ làm khác prototype

Các quyết định dưới đây đã cân nhắc với code thật. Nếu chủ dự án không đồng ý thì sửa mục này trước khi làm.

1. **Chế độ "Gộp thử" của khung xem file chưa có bản gộp do AI viết.** Ở chỗ Git không tự gộp được, hiện hai bản xếp chồng (của A rồi của B), mỗi bản tô màu người viết, kèm dòng "Git không tự gộp được chỗ này". Bản gộp do AI gợi ý để sau (mục 9).
2. **Mức giám sát chỉ có hai mức chọn sẵn:** "Chỉ quan sát" và "Cân bằng". Mức "Chặt" cần sửa daemon và phát hành gói npm mới, để sau (mục 9). Không vẽ nút chưa hoạt động.
3. **Thiết lập có thêm mục thứ năm "Nhật ký hệ thống"** (prototype chưa vẽ): nhật ký sự kiện thô và số liệu kỹ thuật của trang cũ chuyển về đây.
4. **Trên điện thoại giữ ngăn kéo điều hướng hiện có** của `Layout.tsx`. Prototype chỉ ẩn thanh bên, chưa có gì thay.
5. **Bỏ hẳn:** màn Sơ đồ code (theo yêu cầu), thẻ "Gửi ghi chú cho developer" ở Cài đặt (đã có ô nhắn ở Hiện trường và Trao đổi), bốn ô KPI và danh sách "Ai đang làm gì" ở Tổng quan (sơ đồ đã nói cùng điều đó).
6. **"Viết lại cách khác" gọi AI thật.** Khi AI tắt hoặc lỗi: không có phương án soạn sẵn, ô soạn trống, nút "Viết lại" ẩn, các nút còn lại vẫn dùng được.

## 4. Màn hình và đường dẫn

| Màn mới | Route | Thay cho | File mới (trong `web/src/pages/project/`) |
| --- | --- | --- | --- |
| Hiện trường | `/p/:id` | `ProjectOverview`, `WorkMap` | `NowPage.tsx`, `WorkMap.tsx` (viết lại) |
| Cần xử lý | `/p/:id/inbox?i=&who=` | `ConflictsTab`, `TicketsTab`, khối "Cần xử lý" | `InboxPage.tsx`, `FixBox.tsx` |
| Việc | `/p/:id/work?task=&view=` | `BoardTab`, `TaskDialog`, `StatsTab` | `WorkPage.tsx`, `TaskDrawer.tsx` |
| Trao đổi | `/p/:id/talk?t=` | `ConversationsTab`, `Chat` | `TalkPage.tsx` |
| Tri thức | `/p/:id/knowledge/:section?` | `KnowledgeTab`, `CharterCard` | `KnowledgePage.tsx` |
| Thiết lập | `/p/:id/settings/:section?` | `MembersTab`, `LayersTab`, `SettingsTab`, `ShareLinksCard`, `ActivityFeed` | `SettingsPage.tsx` |
| Khung xem file | `?file=<path>` trên mọi route của project | `FileDialog` | `FileSheet.tsx` |

- `section` của Tri thức: `charter` (mặc định), `docs`, `review`. Của Thiết lập: `members` (mặc định), `watch`, `repo`, `share`, `log`.
- Lựa chọn đang mở luôn nằm trên URL (`?i=`, `?task=`, `?t=`, `?doc=`, `?file=`) để gửi link được và nút Back hoạt động.
- Chuyển hướng route cũ, giữ nguyên query: `board`→`work`, `conversations`→`talk`, `conflicts`→`inbox`, `qa`→`inbox`, `stats`→`work?view=progress`, `members`→`settings/members`, `layers`→`settings/watch`, `graph`→`/p/:id`.
- Thiết lập cần quyền quản lý: người chỉ có quyền xem không thấy tab này, và gõ thẳng URL thì bị đưa về `/p/:id`.

## 5. Luật nghiệp vụ dùng chung

Các luật này phải có **một** chỗ tính, mọi nơi hiển thị đọc từ đó.

**Vụ đụng nhau (incident).** Server gom các dòng `conflicts` theo cặp workspace (`workspace_a`, `workspace_b`, không kể thứ tự). Mỗi cặp là một vụ; các dòng xung đột là bằng chứng bên trong.

- Mức của vụ = mức cao nhất trong các bằng chứng đang `open` hoặc `acked`.
- Trạng thái:
  - `open`: còn ít nhất một bằng chứng `open`.
  - `guided`: mọi bằng chứng còn hiệu lực đều `acked` và có một lần gửi hướng xử lý sau lần mở gần nhất.
  - `acked`: như trên nhưng không có lần gửi nào.
  - `closed`: không còn bằng chứng nào `open` hay `acked`.
- Bấm "Đã biết", "Báo nhầm", "Mở lại" trên vụ là áp cho mọi bằng chứng của vụ. Bằng chứng mới xuất hiện sau đó vào ở trạng thái `open` như hiện nay, nên vụ tự mở lại.
- File của vụ: đường dẫn lấy từ `subject` của bằng chứng (`path` hoặc `path#symbol`). Vụ chỉ có bằng chứng L3 thì lấy các file cả hai workspace cùng chạm (footprint hoặc đăng ký).

**Một con số "Cần xử lý".** `attention()` là nguồn duy nhất cho số trên tab, trên thanh bên và trên trang tổng quan. Nó gồm:

- vụ đụng nhau `open` có mức `high` trở lên (một mục cho mỗi vụ);
- câu hỏi `waiting_human`, và câu hỏi `forwarded` quá 15 phút (như hiện nay);
- việc quá hạn, việc ưu tiên cao chưa ai nhận (như hiện nay);
- việc im lặng (mới, xem dưới);
- việc bị chặn chỉ khi lý do chặn chưa nằm trong danh sách.

Vụ `open` mức `warning` hiện ở Cần xử lý trong nhóm gập "Mức thấp", **không** tính vào con số. Vụ mức `info` chỉ hiện trong lịch sử.

**Bị chặn.** `Board.view()` đặt `blocked` khi việc đang mở và: trạng thái là `blocked`, hoặc có xung đột mức `high` trở lên chưa `acked` (như hiện nay), hoặc (mới) có câu hỏi `waiting_human` do một phiên đang làm việc đó hỏi. Giao diện xếp việc `in_progress` có `blocked` vào cột Bị chặn và ghi lý do trên thẻ.

**Việc im lặng.** Việc `in_progress` mà không phiên nào của nó `active`, và lần hoạt động gần nhất quá 24 giờ. Mức `warning`.

**Màu trên sơ đồ.** File viền đỏ khi có vụ `open` hoặc `guided`/`acked` mức `high` trở lên chạm vào nó; viền vàng khi mức `warning`. Bỏ luật cũ "hai agent cùng chạm là đụng nhau" và cách so chuỗi con trong `message`.

**Màu của từng người.** Sáu màu `--c-amber`, `--c-violet`, `--c-teal`, `--c-green`, `--c-pink`, `--c-sky`. Gán theo thứ tự `created_at` của thành viên trong project, hết thì quay vòng. Một hàm `personColor(dev, members)` trong `web/src/lib/people.ts`, không gán ở chỗ nào khác. Agent vẫn nhận ra bằng logo thật.

**Trạng thái agent.** Giữ nguyên của server: `active` = "đang chạy", `idle` = "tạm nghỉ", `ended` = "đã thoát".

## 6. Các giai đoạn

Thứ tự dưới đây giữ cho `main` luôn chạy được sau mỗi commit: server trước, khung và bảng màu, rồi từng màn thay cho màn cũ tương ứng.

### Giai đoạn 1: server

Mọi thứ ở đây cộng thêm vào API, giao diện cũ vẫn chạy.

1. **`src/server/project/incidents.ts` (mới).** Hàm thuần `incidents(engine, scope: "active" | "all")` đọc `store.conflicts(...)`, gom theo luật ở mục 5, trả về mảng `Incident` (mục 7). Lần gửi hướng xử lý đọc từ `event_log` (`type = 'incident_guided'`) và bảng `messages` (để biết `delivered_at`).
2. **Thao tác trên vụ**, trong `src/server/http/agent-routes.ts`, cạnh các route `/conflicts`:
   - `GET /incidents?all=1`.
   - `POST /incidents/:id/:action{ack|dismiss|reopen}`: gọi `store.setConflictStatus` cho từng bằng chứng và ghi sự kiện `conflict_<action>` cho từng cái như route hiện có, để `conversations()` không phải đổi.
   - `POST /incidents/:id/guide` với `{ body, to: string[] }`: mỗi người nhận một `store.addMessage({ kind: "info", from_dev, to_dev, ref_id: <id bằng chứng nặng nhất>, body })` theo đúng khuôn chữ của `POST /projects/:id/messages`; sau đó `ack` cả vụ; ghi `logEvent("incident_guided", by, { id, to, body })`.
3. **Phương án do AI soạn.** Thêm `JobKind` `"suggest_resolution"` (`src/server/brain/types.ts`), prompt trong `src/server/brain/prompts.ts`, cờ `"brain.suggest": { default: "on", requires: ["brain"] }` trong `src/shared/features.ts`.
   - `GET /api/projects/:id/incidents/:iid/plans`: trả `{ plans: { title, text }[] }`, 2–3 phương án, bằng ngôn ngữ của nhóm (`charter.language`). Lưu đệm trong bảng `summaries` với `ref = "plan:<iid>"` và `source_hash` của các bằng chứng; làm theo đúng khuôn của `Summarizer` trong `summaries.ts` (đệm, giới hạn mỗi ngày, cầu dao). Lần gọi đầu trả `{ plans: [] }` và soạn ở nền; giao diện hỏi lại.
   - `POST /api/projects/:id/incidents/:iid/rewrite` với `{ text }`: trả `{ text }` viết lại cùng ý. Không lưu đệm.
   - AI tắt, lỗi hoặc cờ tắt: cả hai trả kết quả rỗng, không ném lỗi.
4. **`attention()`** (`src/server/project/conversations.ts`): mục `conflict` lấy từ `incidents()` thay cho từng dòng xung đột (`ref` = id của vụ); thêm mục `stale`; với câu hỏi thêm `board?: { id, title }` (việc mà phiên hỏi đang làm, tra qua `tasks.session_id` → `board_id`) và `ticket: { from_dev, to_dev, tier }`. Sửa luôn chỗ "Ưu tiên high" còn tiếng Anh.
5. **`Board.view()`** (`src/server/project/board.ts`): thêm `waiting: { id, to_dev }[]` và đưa nó vào luật `blocked` (mục 5).
6. **`conversations()`**: nhận `kinds` (lọc trước khi cắt `limit`, để luồng xung đột không chiếm chỗ); luồng `question` thêm `board_id`; mỗi `ChatEntry` lấy từ `messages` thêm `delivered_at`.
7. **`GET /projects/:id/file`** (`admin-routes.ts`): nhận `context` (số dòng ngữ cảnh, truyền xuống `repo.diffFile` thành `-U<n>`); mỗi workspace trả thêm `base` (`snapshot_base`); thêm `outline` = `engine.graph.fileSymbols(path, BASE)` rút gọn còn `{ name, kind, start_line, end_line }`; thêm `used_by` lấy từ `evidence.callers` của các xung đột `breaking_change_used` trên file đó. Lọc `conflicts` của file bằng `subject`, bỏ so chuỗi con trong `message`.
8. **Sức khoẻ AI.** `/api/overview` và `/health` thêm `brain.failing`: số job AI lỗi trong 10 phút gần nhất (đọc từ `hub.brainStats`). Việc này cũng đóng mục 2 trong `docs/backlog.md`.
9. **Type và client:** cập nhật `src/shared/types.ts`, `web/src/api/types.ts`, `web/src/api/endpoints.ts` (thêm `api.incidents.*`; `Ticket.options`; `Task.board_id`, `Task.summary`; `BoardView.waiting`).
10. **Test** (`test/incidents.test.ts` mới, và bổ sung `test/board.test.ts`, `test/admin.test.ts`), dùng `FakeBrain` và khuôn có sẵn trong `test/`:
    - gom 6 dòng xung đột của hai cặp thành 2 vụ, đúng mức và trạng thái;
    - `ack` vụ thì mọi bằng chứng `acked`; bằng chứng mới làm vụ `open` lại;
    - `guide` tạo đúng số tin nhắn, vụ thành `guided`, `delivered_at` hiện ra sau khi agent nhận tin;
    - `attention()` đếm theo vụ; việc có câu hỏi `waiting_human` thì `blocked`; việc im lặng xuất hiện sau 24 giờ;
    - `/file?context=` trả đủ dòng ngữ cảnh và `outline`;
    - `plans` trả rỗng khi AI tắt.

### Giai đoạn 2: nền giao diện

1. **Bảng màu hai nền.** Viết lại `web/src/styles/tokens.css` theo khối `:root` của `styles.css` trong prototype. **Giữ nguyên tên token đang dùng** trong app (`--bg`, `--surface`, `--sunken`, `--fg`, `--muted`, `--faint`, `--line`, `--line-strong`, `--accent`, `--accent-soft`, `--hover`, `--info`, `--warning`, `--high`, `--critical`, `--ok` và các bản `-soft`) để các trang ngoài project tự có nền tối. Khi chuyển CSS từ prototype: `--clash` thành `--high`, `--warn` thành `--warning`. Thêm `--raised`, `--rail*`, sáu màu `--c-*`. Mọi màu chữ trên nền của nó đạt 4,5:1 ở cả hai nền (các giá trị trong prototype đã đạt).
2. **Chọn nền.** Thuộc tính `data-theme` trên `<html>`; mặc định theo hệ điều hành; nút đổi nền lưu vào `localStorage` khoá `gtv.theme`; một đoạn script nhỏ trong `web/index.html` đặt nền trước lần vẽ đầu. Đặt `color-scheme` theo nền.
3. **Khung ứng dụng** (`web/src/components/Layout.tsx`): thanh bên thành dải hẹp 60px như prototype (logo, bốn mục chung có `title` và `aria-label`, ô chữ cái cho từng project kèm số "Cần xử lý", tài khoản, đăng xuất, bản đang chạy). Dưới 860px giữ ngăn kéo hiện có.
4. **Thành phần dùng chung** (`web/src/components/`): avatar có vòng màu người và huy hiệu logo agent (sửa `DevAvatar` trong `Visual.tsx`), chồng avatar, chấm trạng thái, chip, nút phân đoạn (đã có `Segmented.tsx`), khung panel, khung "kết luận" (đỏ, vàng, trung tính), dòng danh sách, khối trống. Chuyển các lớp tương ứng từ prototype vào một file mới `web/src/styles/project.css`.
5. **Khung nổi lớn** dùng `<dialog>` gốc của trình duyệt với `showModal()`: tự có bẫy focus và đóng bằng Esc; thêm đóng khi bấm nền mờ.

Kiểm tra: mọi trang cũ vẫn dùng được ở cả hai nền, không chỗ nào chữ chìm vào nền.

### Giai đoạn 3: khung project, Hiện trường, khung xem file

1. **`ProjectLayout.tsx`:** thanh trên như prototype: tên project kèm danh sách đổi project, nhánh và commit, tình trạng đồng bộ (lỗi đồng bộ vẫn hiện thành thông báo gập như hiện nay), "x/y việc xong · còn N ngày", viên trạng thái AI (vàng "AI trả lời đang lỗi" khi `brain.failing > 0`, dẫn tới `/brain` với admin), nút đổi nền. Hàng tab: năm tab và Thiết lập ở bên phải. Chỉ tab Cần xử lý có số.
2. **`NowPage.tsx`:**
   - Câu dẫn đầu trang tính từ dữ liệu: số agent đang chạy và tạm nghỉ, số chỗ đụng nhau, số câu hỏi chờ.
   - Sơ đồ: cột agent, cột file nhóm theo thư mục, dây nối vẽ bằng SVG. Cách tính toạ độ dây và làm mờ khi rê chuột: chuyển từ `drawWires()` và `light()` trong `app.js`. Vẽ lại khi đổi kích thước (`ResizeObserver`).
   - Thẻ agent = workspace có phiên chưa `ended` **hoặc** có đăng ký đang mở. Workspace chỉ còn footprint thì chỉ hiện avatar trên file, không có thẻ và không có dây (sửa lỗi "Chưa đăng ký việc" trong backlog).
   - Kiểu dây: `editing` (footprint dưới 30 phút), `edited` (cũ hơn), `declared` (đã đăng ký, chưa sửa), như `buildMap` hiện có.
   - Tối đa 12 file, có "Xem thêm"; dòng "N file chưa ai chạm tới được ẩn".
   - Bộ lọc "Mọi file / Chỉ chỗ đụng nhau" và "Gọn / Chi tiết". Chi tiết: file hiện số lần sửa và lần sửa gần nhất; thẻ agent hiện nhánh, số file, lần thấy cuối, các symbol và contract đã đăng ký.
   - Cột phải mặc định: "Cần người xử lý" (4 mục đầu của `attention`) và "Hôm nay" (digest; ẩn khi chưa có).
   - Bấm agent: cột phải hiện việc, nhánh, mục tiêu, phạm vi đã đăng ký, hai ghi chú gần nhất, ô nhắn vào agent (`POST /messages`).
   - Dưới 900px: bỏ dây và cột file, mỗi thẻ agent liệt kê file của mình.
   - Thẻ agent và ô file là `<button>`: dùng được bằng bàn phím, focus cũng làm nổi dây.
3. **`FileSheet.tsx`** mở khi URL có `?file=`:
   - Gọi `GET /file?path=&context=100000`.
   - `web/src/lib/diff.ts` (mới, hàm thuần, không import gì): chuyển `parseDiff` từ `FileDialog.tsx` sang, thêm `alignDiffs()` dựng các đoạn `ctx`, `chg`, `fold` theo số dòng gốc. Thay đổi của hai người cách nhau không quá 1 dòng gốc là cùng một đoạn (đúng luật `NEAR = 1` hiện có); đoạn có từ hai người là đoạn đụng. Dãy không đổi dài hơn 7 dòng thì gập phần giữa.
   - Test hàm này trong `test/web-diff.test.ts`: chèn cùng chỗ, sửa khác chỗ, một người xoá dòng người kia sửa, gập. Nếu `tsc` của gốc repo không nhận file trong `web/`, thêm đường dẫn đó vào `tsconfig.json`.
   - Cột trái: khung kết luận của vụ, "Ai chạm vào file này", "Trong file này" (từ `outline`, có chấm màu người sửa, bấm thì cuộn tới), "Ai đang gọi theo chữ ký cũ" (từ `used_by`), "Vì sao gtv báo".
   - Phần code: "Cạnh nhau" (mỗi người một cột, đầu cột có tên việc, số dòng thêm bớt, giờ lưu bản tạm) và "Gộp thử" (xem mục 3.1).
   - Hai workspace có `base` khác nhau: hiện một dòng báo số dòng có thể lệch.
   - Tô màu cú pháp nhẹ như `hl()` trong `app.js` (từ khoá, chuỗi, chú thích). Không thêm thư viện.
   - Đáy khung: thanh gập "Hướng xử lý" (giai đoạn 4 mới gắn nội dung; ở giai đoạn này là nút dẫn tới vụ trong Cần xử lý).
4. Xoá `ProjectOverview.tsx`, `FileDialog.tsx`, `WorkMap.tsx` cũ.

### Giai đoạn 4: Cần xử lý

1. **`InboxPage.tsx`:** danh sách bên trái theo nhóm (Đụng nhau, Câu hỏi chờ người quyết, Việc cần để ý, Mức thấp (gập), Đã xử lý hôm nay), chi tiết bên phải. Bộ lọc "Liên quan tới" theo người; nếu tên tài khoản trùng tên một thành viên thì chọn sẵn người đó. Nút "Xem lịch sử đã đóng" tải `incidents?all=1`.
2. **Chi tiết vụ đụng nhau:** tiêu đề do giao diện dựng từ loại bằng chứng nặng nhất (`KIND_VI` trong `components/Message.tsx`), hai thẻ người, "Vì sao gtv báo" (mỗi bằng chứng một dòng lời thường, nhãn lớp L0–L3 nhỏ ở cuối dòng), "Ở đâu" (bấm mở khung xem file), khối Hướng xử lý, "gtv đã làm gì".
3. **`FixBox.tsx`**, dùng ở đây và ở đáy khung xem file:
   - Các phương án từ `plans` (hỏi lại mỗi 3 giây cho tới khi có, tối đa 30 giây), ô soạn sửa được, "Viết lại cách khác", chọn người nhận, nút gửi đổi chữ theo số người nhận.
   - Ba kết cục, mỗi cái ghi rõ hậu quả như prototype: gửi (`guide`), "Để hai bên tự phối hợp" (`ack`), "Báo nhầm, đóng lại" (`dismiss`).
   - Sau khi xử lý: hiện nội dung đã gửi, ai đã đọc (`delivered_at`), nút "Mở lại".
   - Chữ đang gõ không được mất khi dữ liệu tự làm mới: giữ bản nháp trong state theo id của vụ, không ghi đè khi người dùng đã sửa.
4. **Chi tiết câu hỏi:** ai hỏi ai, thuộc việc nào, câu hỏi và ngữ cảnh, các lựa chọn thành nút, ô trả lời bằng lời, "Gửi trả lời" (`api.tickets.reply`), "Nhắc <người>" (`POST /messages` kèm `ref_id` là id câu hỏi). Ô "Lưu vào Tri thức": sau khi trả lời, tìm tài liệu có `ticket_id` trùng và gọi `api.kb.review(id, "confirm")`.
5. **Việc cần để ý:** chưa ai nhận thì có các nút "Giao cho <người>" (`api.board.update`); im lặng thì "Nhắc" và "Trả về Cần làm"; quá hạn thì "Mở việc".
6. Người chỉ có quyền xem: thấy mọi thứ, chỗ các nút là một dòng "Cần quyền quản lý để xử lý".
7. Xoá `ConflictsTab.tsx`, `TicketsTab.tsx`.

### Giai đoạn 5: Việc

1. **`WorkPage.tsx`:** bảng năm cột như prototype; thẻ ghi lý do bị chặn; lọc theo người và nút "Thêm việc" giữ đủ các trường của form hiện có.
2. **`TaskDrawer.tsx`** mở bên cạnh bảng khi có `?task=`, giữ mọi chức năng của `TaskDialog`: đổi trạng thái, ưu tiên, người làm, hạn; sửa mô tả; thêm ghi chú; xoá việc; đóng bằng Esc. Có nút "Gỡ chặn ở Cần xử lý" khi việc bị chặn và "Xem trao đổi".
3. **`?view=progress`:** nội dung phần trên của `StatsTab` (bốn số, "Việc còn lại", "Xong mỗi ngày", "Theo người", "Sắp tới hạn", chọn 7/14/30 ngày), dùng lại `ProgressCharts.tsx`.
4. Xoá `BoardTab.tsx`, `TaskDialog.tsx`. Phần "Số liệu kỹ thuật" của `StatsTab` chuyển sang giai đoạn 7 rồi xoá file.

### Giai đoạn 6: Trao đổi

1. **`TalkPage.tsx`:** gọi `conversations?kinds=task,question,note`. Mỗi việc là một luồng; câu hỏi có `board_id` và các vụ đụng nhau có `board_ids` chứa việc đó thành tin trong luồng của việc, kèm nút "Trả lời" hoặc "Xem vụ đụng nhau" dẫn sang Cần xử lý. Câu hỏi và ghi chú không thuộc việc nào vào nhóm "Khác".
2. Bộ lọc: Tất cả, Có câu hỏi, Có đụng nhau, Có quyết định.
3. Khung "Tóm tắt" hiện khi luồng có `ai_summary`. Tin đã tới agent có dấu "đã đọc".
4. Ô nhắn: chọn người, gửi `POST /messages` với `ref_id` là id của việc.
5. Xoá `ConversationsTab.tsx`, `Chat.tsx`.

### Giai đoạn 7: Tri thức và Thiết lập

1. **`KnowledgePage.tsx`:**
   - Tiêu chí project: hiện đủ các trường (kể cả mốc và ghi chú), nút sửa mở form của `CharterCard`.
   - Tài liệu: tìm kiếm, thêm (tải file hoặc viết), danh sách, đọc và sửa tài liệu, bật tắt "cốt lõi", xoá; tài liệu đang mở nằm trên URL (`?doc=`).
   - Chờ xác nhận: danh sách hỏi đáp chưa xác nhận với "Đúng, lưu lại" và "Sai, bỏ".
2. **`SettingsPage.tsx`:**
   - Thành viên: sửa vai trò, trình độ, ghi chú; xoá; thêm; phần "Mời thêm người" chỉ admin thấy.
   - Mức giám sát: hai mức chọn sẵn (mục 3.2) và danh sách **mọi** khoá trong `FEATURE_KEYS` (kể cả `coord.priority` và `brain.suggest`) với ba nấc Tắt, Chạy thử, Bật. Nhãn lời thường lấy từ `LAYERS` trong `data.js`, đặt trong một bảng `web/src/lib/featureText.ts`; khoá kỹ thuật chỉ còn trong `title`. Vẫn hiện "đang tắt do…", "tự ngắt", số lỗi, và "về mặc định".
     - "Chỉ quan sát" = `policy.ask` tắt và `notify.desktop` tắt.
     - "Cân bằng" = bỏ ghi đè của hai khoá đó.
     - Các khoá khác bị chỉnh tay thì hiện "Tuỳ chỉnh".
   - Repo và đồng bộ, Link chia sẻ: chức năng như `SettingsTab` và `ShareLinksCard`.
   - Nhật ký hệ thống: `ActivityFeed` và phần "Số liệu kỹ thuật".
3. Xoá `MembersTab`, `LayersTab`, `SettingsTab`, `StatsTab`, `KnowledgeTab`, `CharterCard`, `GraphTab`, `CodeMap`, `components/GraphView.tsx`, và các hàm `api.graph.*` không còn ai gọi. **Giữ** các route `/graph/*` của server và `test/map.test.ts`: agent và AI vẫn dùng chỉ mục code.

### Giai đoạn 8: dọn dẹp và tài liệu

1. Xoá khỏi `components.css`, `manager.css`, `visual.css`, `theme.css` những lớp không còn file nào trong `web/src` dùng (grep từng tên lớp trước khi xoá; không chắc thì để lại).
2. Viết lại `DESIGN.md` cho giao diện mới: hai nền, bảng màu, màu theo người, năm màn, các thành phần, lời trên giao diện.
3. Cập nhật `docs/api.md` (các endpoint mới), `docs/features.md`, `docs/project-structure.md`, `README.md` (đoạn tả dashboard và ảnh `docs/assets/dashboard-project.jpg`).
4. `docs/backlog.md`: xoá các mục đã xong, thêm mục 9 của plan này. `NOTES.md` của prototype: xoá các mục đã xong.
5. Cập nhật `scripts/demo.ts` nếu dữ liệu mẫu thiếu trạng thái nào cần để xem đủ các màn (một vụ đụng nhau mở, một câu hỏi chờ người, một việc bị chặn).

## 7. Hợp đồng API mới

```ts
// src/shared/types.ts
export interface Incident {
  id: string; // stable for a pair of workspaces
  workspace_a: string;
  workspace_b: string;
  dev_a: string;
  dev_b: string;
  level: Level;
  status: "open" | "guided" | "acked" | "closed";
  /** The strongest piece of evidence: the dashboard writes the title from it. */
  headline: { layer: string; kind: string; subject: string };
  evidence: { id: string; layer: string; kind: string; level: Level; status: Conflict["status"]; subject: string; message: string; evidence: Record<string, unknown> }[];
  files: string[];
  board_ids: string[];
  /** The last guidance a lead sent, if it is newer than the last reopen. */
  guide?: { at: string; by: string; body: string; to: { dev: string; delivered_at: string | null }[] };
  created_at: string;
  updated_at: string;
}
```

| Endpoint | Quyền | Trả về |
| --- | --- | --- |
| `GET /v1/p/:id/incidents[?all=1]` | xem | `Incident[]` |
| `POST /v1/p/:id/incidents/:iid/{ack\|dismiss\|reopen}` | quản lý | `Incident` |
| `POST /v1/p/:id/incidents/:iid/guide` `{ body, to }` | quản lý | `Incident` |
| `GET /api/projects/:id/incidents/:iid/plans` | xem | `{ plans: { title, text }[] }` |
| `POST /api/projects/:id/incidents/:iid/rewrite` `{ text }` | quản lý | `{ text }` |
| `GET /api/projects/:id/file?path=&context=` | xem | thêm `outline`, `used_by`, `base` cho từng workspace |
| `GET /api/projects/:id/conversations?kinds=` | xem | luồng `question` thêm `board_id`; tin thêm `delivered_at` |
| `GET /api/projects/:id/attention` | xem | thêm loại `stale`; câu hỏi thêm `board`, `ticket` |
| `GET /api/overview`, `/health` | như cũ | thêm `brain.failing` |

Các route mới dưới `/v1/p` và `/api` theo đúng luật quyền hiện có trong `src/server/http/auth.ts`; kiểm tra rằng link chia sẻ chỉ đọc gọi được các `GET` mới và không gọi được các `POST`.

## 8. Nghiệm thu

Sau mỗi giai đoạn:

1. `npm run check` và `npm run web:build`.
2. Chạy `npm run demo` (cổng 7395, token `demo-admin`) và mở từng màn của giai đoạn đó.
3. Chụp màn hình ở nền sáng và nền tối, 1440px và 400px, đặt cạnh màn tương ứng của prototype. Dùng `playwright-core` cài trong một thư mục tạm ngoài repo; Chromium có sẵn ở `~/.cache/ms-playwright/chromium-1248`.
4. Kiểm tra: không có lỗi trong console; trang không cuộn ngang ở 400px; mọi nút có tên đọc được; dùng được bằng bàn phím; focus nhìn thấy được.

Trước commit cuối:

- Đi hết các luồng: mở file từ sơ đồ; gửi hướng xử lý và thấy việc rời cột Bị chặn; trả lời câu hỏi bằng lựa chọn và bằng lời; giao việc; thêm và sửa tài liệu; đổi một nấc ở Mức giám sát; tạo và thu hồi link chia sẻ.
- Đăng nhập bằng tài khoản chỉ xem và bằng link chia sẻ: không thấy nút sửa, không vào được Thiết lập, không lỗi.
- Mở các route cũ (`/p/x/board?task=…`, `/p/x/conflicts`, `/p/x/graph`): đều chuyển tới đúng màn mới.
- Con số trên tab Cần xử lý, trên thanh bên và số mục trong danh sách khớp nhau.

## 9. Để sau, không làm trong đợt này

- Bản gộp do AI gợi ý trong chế độ "Gộp thử" (một job AI cho mỗi đoạn đụng).
- Mức giám sát "Chặt": chặn agent sửa file đang đụng nhau cho tới khi có người cho phép. Cần cờ mới trong daemon và phát hành gói npm.
- Gắn tài khoản dashboard với tên dev bằng dữ liệu (hiện chỉ dựa vào việc trùng tên).
- Ghi chú hệ thống của bảng việc còn là câu tiếng Anh; nên lưu `{ field, from, to }` để giao diện dựng câu (đã có trong backlog).
- Quyết định người chỉ xem có được thấy code chưa commit trong khung xem file không (đã có trong backlog).

## 10. Việc cần chủ dự án quyết trước khi bắt đầu

1. Đồng ý với sáu điểm khác prototype ở mục 3 không.
2. `DESIGN.md` hiện ghi "chỉ nền sáng" và "không tự đặt màu cho agent". Plan này thay cả hai. Nên báo người viết `DESIGN.md` trước.
3. Có chép thư mục prototype vào repo (ví dụ `docs/prototype/`) để cả nhóm xem được không. Hiện nó chỉ nằm trên máy này.

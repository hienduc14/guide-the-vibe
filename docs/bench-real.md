# Benchmark thật: 2 người, 2 agent, cùng một repo

Mục tiêu: đo xem gtv giảm conflict được bao nhiêu khi **hai người thật** dùng **agent thật** (Claude Code, Codex) làm song song.

Cách làm:

- Chạy 8 cặp task ([`scripts/bench/scenarios.ts`](../scripts/bench/scenarios.ts)) **hai vòng**:
  - **off**: không có gtv;
  - **on**: có gtv.
- Mỗi cặp: A làm một việc, B làm một việc, mỗi người đẩy một nhánh.
- Script `measure.ts` merge nhánh A trước rồi nhánh B, rồi đếm:
  - conflict;
  - số dòng bị đè nhau;
  - lỗi type mới, tức code hỏng dù git merge sạch.

Repo thử: **https://github.com/hienduc14/realworld-gtv-bench** (RealWorld Node/Express, nhánh `master`).

| Vai | Người         | Agent gợi ý |
| --- | ------------- | ----------- |
| A   | hienduc14     | Claude Code |
| B   | bạn cùng nhóm | Codex       |

Hai người có thể đổi agent cho nhau, nhưng giữ nguyên lựa chọn suốt cả hai vòng.

## 1. Chuẩn bị (một lần)

**Chủ repo**

1. Thêm bạn B làm collaborator (quyền Write) của `realworld-gtv-bench`. B cần quyền này để đẩy nhánh và snapshot `refs/gtv/*`.
2. Trên dashboard của server đã deploy:
   - tạo project `realworld-bench`, repo `https://github.com/hienduc14/realworld-gtv-bench.git`, nhánh `master`;
   - **Thiết lập › Thành viên › Mời bằng link**: quyền Developer trong `realworld-bench`; A và B mở link, tạo tài khoản rồi bấm Tham gia.
3. Brain là tùy chọn. Có Brain thì thêm được L3 và hỏi đáp. Không có thì vẫn có L0–L2, là các lớp bắt conflict chính.

**Mỗi người** clone repo **hai lần**, vì daemon gtv tự bật lại mỗi khi agent mở phiên, nên không thể chỉ tắt nó để chạy vòng off:

| Thư mục      | Dùng cho | gtv          |
| ------------ | -------- | ------------ |
| `bench-off/` | vòng off | không cài gì |
| `bench-on/`  | vòng on  | `gtv on`     |

```bash
git clone https://github.com/hienduc14/realworld-gtv-bench.git bench-off
git clone https://github.com/hienduc14/realworld-gtv-bench.git bench-on
cd bench-on
npx guide-the-vibe && gtv login https://<server>     # một lần mỗi máy
gtv on                                                # A chọn Claude Code, B chọn Codex
```

`gtv on` nối repo với project, cài hook, MCP và skill, giấu chúng khỏi git, rồi bật daemon chạy nền.

**Đổi snapshot xuống 30 giây.** Mặc định là 5 phút, quá chậm cho bài thử: WIP của A chưa tới server thì B chưa được cảnh báo L1/L2.

1. Mở `~/.gtv/config.json` (Windows: `%USERPROFILE%\.gtv\config.json`), thêm dòng `"snapshotDebounceMs": 30000`.
2. Khởi động lại daemon:

```powershell
Stop-Process -Id (Invoke-RestMethod http://127.0.0.1:7391/health).pid; npx guide-the-vibe daemon
```

```bash
kill $(curl -s http://127.0.0.1:7391/health | node -pe 'JSON.parse(require("fs").readFileSync(0)).pid'); npx guide-the-vibe daemon
```

Lệnh `daemon` chạy ở terminal đó; cứ để nguyên trong suốt vòng on.

Codex: mở Codex trong `bench-on` một lần, trust project và duyệt hook bằng `/hooks`. Claude Code: duyệt MCP server `gtv` lần đầu.

## 2. Quy trình một cặp task

Hai người làm cùng một cặp, cùng lúc.

1. **Cả hai:** vào thư mục của vòng (`bench-off` hoặc `bench-on`), về `master` mới nhất rồi tạo nhánh, `<round>` là `off` hoặc `on`:
   ```bash
   git checkout master && git pull
   git checkout -b bench/<round>/S1/a        # B: bench/<round>/S1/b
   ```
2. **A** mở một phiên agent mới và dán prompt A của cặp đó (mục 4).
3. **B** chờ A bắt đầu sửa khoảng **1 phút**, rồi mở phiên agent mới và dán prompt B.
4. **Không nhắn nhau ngoài gtv.** Nếu buộc phải nhắn, ghi lại số lần vào bảng quan sát. Ở vòng on, cứ để agent tự xử lý cảnh báo của gtv. Agent được phép:
   - hỏi qua `gtv_ask`;
   - đợi A xong rồi làm tiếp trên nhánh của A: `git fetch && git rebase origin/bench/on/S1/a`.
5. Agent làm xong thì **commit và push**:
   ```bash
   git add -A && git commit -m "S1 a" && git push -u origin HEAD     # B: "S1 b"
   ```
6. **Dọn trước cặp tiếp theo:**
   - Vòng on: bảo agent "finish your gtv task", hoặc gõ `gtv_finish_task`.
   - Về `master` rồi đẩy snapshot sạch để WIP cũ không gây cảnh báo cho cặp sau:
     ```bash
     git checkout master && npx guide-the-vibe snapshot
     ```
   - Thoát agent.
7. Ghi bảng quan sát (mục 5).

**Vòng off:** làm trong `bench-off`, nơi không cài gtv. **Không** nhắc tới gtv trong prompt. Chạy hết vòng off trước, rồi mới chạy vòng on.

**Vòng on:** làm trong `bench-on`, daemon đang chạy. Dán đúng prompt như vòng off, không thêm gợi ý gì. Skill gtv tự hướng agent đăng ký task.

Thiếu thời gian hoặc quota thì chạy tối thiểu **S1, S2, S3, S6, S8**: đủ cả 3 loại conflict và một ca gtv dễ bỏ sót. Mỗi cặp chạy ở cả hai vòng.

## 3. Đo kết quả

Một người chạy, khi các nhánh `bench/*` đã được đẩy lên:

```bash
cd <gtv>
node scripts/bench/measure.ts
```

Đọc thêm cảnh báo của Operator theo từng cặp (tùy chọn):

```bash
GTV_SERVER=https://<server> GTV_ADMIN_TOKEN=<admin> GTV_PROJECT=realworld-bench node scripts/bench/measure.ts
```

Kết quả nằm ở `docs/reports/bench-real.md`:

- bảng tổng off/on: conflict, số dòng bị đè, merge sạch nhưng hỏng, số lần B làm tiếp trên code của A;
- bảng từng cặp;
- danh sách lỗi type mới.

## 4. Các cặp task và prompt

Prompt dán nguyên văn. Phần "Name your task…" giúp script nhận ra cảnh báo của cặp nào. Ở vòng off, câu đó vô hại vì không có gtv.

**S1: hai người cùng sửa một dòng** (dự kiến: git conflict)

- A: `S1: In src/app/routes/auth/token.utils.ts, make JWT tokens expire after 7 days instead of 60. Name your task "S1: shorter JWT lifetime". Commit when done.`
- B: `S1: In src/app/routes/auth/token.utils.ts, add issuer 'conduit' to the JWT options and set the lifetime to 30 days. Name your task "S1: JWT issuer". Commit when done.`

**S2: A đổi chữ ký hàm, B viết code mới gọi hàm đó** (dự kiến: merge sạch nhưng hỏng)

- A: `S2: Change profileMapper in src/app/routes/profile/profile.utils.ts to take the viewer as an object (viewer?: { id: number }) instead of a bare id, and update every caller. Name your task "S2: profileMapper viewer object". Commit when done.`
- B: `S2: Add getFollowers(username: string, id?: number) in a new file src/app/routes/profile/profile.followers.ts: load the user with prisma and return their followers mapped with profileMapper from profile.utils. Name your task "S2: list followers". Commit when done.`

**S3: A đổi tên hàm, B gọi tên cũ** (dự kiến: merge sạch nhưng hỏng)

- A: `S3: Rename getCurrentUser in src/app/routes/auth/auth.service.ts to getUserById and update all its callers. Name your task "S3: rename getCurrentUser". Commit when done.`
- B: `S3: Add refreshSession(id: number) in a new file src/app/routes/auth/session.utils.ts that calls getCurrentUser from auth.service and returns { username, token }. Name your task "S3: session refresh helper". Commit when done.`

**S4: cùng file, khác hàm** (dự kiến: không conflict, mọi cảnh báo ở đây là thừa)

- A: `S4: In createUser (src/app/routes/auth/auth.service.ts) hash passwords with bcrypt cost 12 instead of 10. Do not touch other functions. Name your task "S4: bcrypt cost 12". Commit when done.`
- B: `S4: In login (src/app/routes/auth/auth.service.ts) lower-case the email before looking up the user. Do not touch other functions. Name your task "S4: case-insensitive login". Commit when done.`

**S5: hai việc không liên quan** (dự kiến: không conflict)

- A: `S5: Make getTags in src/app/routes/tag/tag.service.ts return the 20 most popular tags instead of 10. Name your task "S5: more tags". Commit when done.`
- B: `S5: In src/app/routes/article/article.mapper.ts add commentsCount (number of comments, 0 if missing) to the mapped article. Name your task "S5: comments count". Commit when done.`

**S6: hai người cùng thêm hàm vào cuối một file** (dự kiến: git conflict)

- A: `S6: Add an exported isFollowing(usernamePayload: string, id: number) at the end of src/app/routes/profile/profile.service.ts that returns whether user id follows that profile (reuse getProfile). Name your task "S6: isFollowing". Commit when done.`
- B: `S6: Add an exported countFollowers(usernamePayload: string) at the end of src/app/routes/profile/profile.service.ts that returns how many followers the user has (prisma count). Name your task "S6: follower count". Commit when done.`

**S7: cùng vùng code** (dự kiến: git conflict)

- A: `S7: In getArticles (src/app/routes/article/article.service.ts) use a default page size of 20 and never return more than 100 articles. Name your task "S7: cap page size". Commit when done.`
- B: `S7: In getArticles (src/app/routes/article/article.service.ts) never use a negative offset (treat it as 0). Name your task "S7: non-negative offset". Commit when done.`

**S8: A bỏ một trường trả về, B đọc trường đó** (dự kiến: merge sạch nhưng hỏng; ca khó cho gtv)

- A: `S8: authorMapper in src/app/routes/article/author.mapper.ts should no longer return the following field (clients compute it). Remove it. Name your task "S8: drop following from author". Commit when done.`
- B: `S8: Add authorBadge(author: any, id?: number) in a new file src/app/routes/article/author.badge.ts: call authorMapper and return the username, with " (following)" appended when the mapped author's following field is true. Name your task "S8: author badge". Commit when done.`

## 5. Bảng quan sát

Script không đo được các cột dưới đây, người chạy ghi lại. Mỗi cặp một dòng, ghi cho cả hai vòng.

| Vòng | Cặp | gtv báo lúc nào (đăng ký / khi sửa / sau khi sửa / không) | B (agent) làm gì khi bị báo (đổi cách làm / hỏi / chờ A / bỏ qua) | Số lần 2 người phải nhắn nhau | Thời gian A / B (phút) | Ghi chú |
| ---- | --- | --------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------- | ---------------------- | ------- |
| off  | S1  | –                                                         | –                                                                 |                               |                        |         |
| on   | S1  |                                                           |                                                                   |                               |                        |         |

## 6. Đọc kết quả cho đúng

- Agent thật mỗi lần làm một khác: cùng prompt nhưng có thể sửa nhiều hoặc ít hơn dự kiến. Cột "Loại" trong báo cáo là dự kiến, cột off cho biết điều đã thực sự xảy ra.
- Chỉ so off và on của **cùng một cặp**.
- "B làm tiếp trên code của A" ở vòng on là cách tránh conflict hợp lệ nhưng có giá là phải chờ. Thời gian ở bảng quan sát cho thấy cái giá này.
- Lỗi logic chỉ đo được qua lỗi type (`tsc`). Lỗi hành vi không đổi kiểu (ví dụ đổi đơn vị) không đo được.
- So sánh với lần chạy bằng kịch bản soạn sẵn (`npm run bench:conflicts`, agent giả lập, báo cáo `docs/reports/bench-conflicts.md`).

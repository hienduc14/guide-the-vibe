# Benchmark: giảm conflict khi làm song song

Repo: RealWorld Node/Express (`hienduc14/realworld-gtv-bench.git`, base `30b68e1e88`). 8 cặp task, mỗi cặp làm theo 3 cách rồi merge (A merge trước, B sau). Chạy: `node scripts/bench/conflicts.ts`, 2026-11-06 14:57 UTC.

- **none**: không điều phối, hai người làm mù song song.
- **lock**: chỉ giữ chỗ file (kiểu các tool claim file): B điều chỉnh khi A đã giữ một file B sửa.
- **gtv**: Operator thật + 2 daemon, hook đúng định dạng Claude Code (A) và Codex (B), Brain tắt (L0–L2). B điều chỉnh khi gtv cảnh báo (mức ≥ warning) trước khi merge.

"Điều chỉnh" là bản sửa của B viết lại sau khi biết thay đổi của A (soạn sẵn trong `scripts/bench/scenarios.ts`), tức là giả định agent làm theo cảnh báo. Phần đo được thật là gtv **có cảnh báo hay không, lúc nào, lớp nào**; kết quả merge suy ra từ đó.

## Tổng hợp

| Chỉ số | none | lock | gtv | gtv so với none |
|---|---|---|---|---|
| Merge bị conflict (git) | 3 | 0 | 0 | 100% |
| Số dòng bị đè nhau (trong vùng conflict) | 13 | 0 | 0 | 100% |
| Merge sạch nhưng code hỏng (lỗi type mới) | 3 | 3 | 1 | 67% |
| **Tổng merge có vấn đề** | **6** | **3** | **1** | **83%** |
| Phát hiện được (cặp có conflict thật) | - | 3/6 | 5/6 | |
| Cảnh báo thừa (cặp không conflict) | - | 1/2 | 1/2 | |

Độ trễ hook PreToolUse của gtv: p50 6 ms, p95 20 ms, max 20 ms (19 lần gọi).

## Từng cặp

| # | Tình huống | Thật | none | lock | gtv: báo lúc | gtv: lớp | gtv |
|---|---|---|---|---|---|---|---|
| S1 | Hai người cùng sửa một dòng (hạn token) | text | CONFLICT 1 file, 3 lines | báo → clean | registration | L0:info, L0:warning, L1:high, L2:warning | clean |
| S2 | A đổi chữ ký hàm, B viết code mới gọi hàm đó (khác file) | logic | BROKEN 1 type errors | im → BROKEN 1 type errors | snapshot | L0:high, L0:info, L2:high | clean |
| S3 | A đổi tên hàm, B gọi tên cũ (khác file) | logic | BROKEN 1 type errors | im → BROKEN 1 type errors | snapshot | L0:high, L0:info, L2:high | clean |
| S4 | Cùng file, khác hàm (git tự gộp được) | none | clean | báo → clean | registration | L0:info, L0:warning | clean |
| S5 | Hai việc không liên quan | none | clean | im → clean | none | L0:info | clean |
| S6 | Hai người cùng thêm hàm vào cuối một file | text | CONFLICT 1 file, 6 lines | báo → clean | registration | L0:info, L0:warning, L1:high | clean |
| S7 | Cùng vùng code đã đăng ký (phân trang bài viết) | text | CONFLICT 1 file, 4 lines | báo → clean | registration | L0:info, L0:warning, L1:high, L2:warning | clean |
| S8 | A bỏ một trường trong kết quả trả về, B đọc trường đó (khác file) | logic | BROKEN 1 type errors | im → BROKEN 1 type errors | none | L0:info | BROKEN 1 type errors |

## Cảnh báo gtv đã đưa ra

**S1** — đăng ký của B: Registered task … "Add issuer to JWT". Status: adjust_suggested.
- [L0 warning] alice (alice@master, task "Shorter JWT lifetime") and bob (bob@master, task "Add issuer to JWT") are both editing src/app/routes/auth/token.utils.ts.
- [L0 info] Registered scopes overlap: alice (alice@master, task "Shorter JWT lifetime") "src/app/routes/auth/token.utils.ts" and bob (bob@master, task "Add issuer to JWT") "src/app/routes/auth/token.utils.ts".
- [L2 warning] bob (body_changed) and alice (body_changed) are both changing generateToken in src/app/routes/auth/token.utils.ts.
- [L1 high] Merging the current work of alice (alice@master) and bob (bob@master) would conflict in src/app/routes/auth/token.utils.ts (Auto-merging). Agree who changes what before going further.

**S2** — đăng ký của B: Registered task … "List a user's followers". Status: ok.
- [L0 info] alice (alice@master, task "profileMapper takes a viewer object") and bob (bob@master, task "List a user's followers") work in the same module "src/app".
- [L0 high] alice (alice@master, task "profileMapper takes a viewer object") plans to sig change profileMapper, which bob (bob@master, task "List a user's followers") is using in src/app/routes/profile/profile.followers.ts
- [L2 high] alice (alice@master) changes the signature of profileMapper from `profileMapper = (user: any, id: number | undefined): Profile =>` to `profileMapper = (user: any, viewer?: { id: number }): Profile =>`, but bob 

**S3** — đăng ký của B: Registered task … "Session refresh helper". Status: ok.
- [L0 info] alice (alice@master, task "Rename getCurrentUser to getUserById") and bob (bob@master, task "Session refresh helper") work in the same module "src/app".
- [L0 high] alice (alice@master, task "Rename getCurrentUser to getUserById") plans to rename getCurrentUser, which bob (bob@master, task "Session refresh helper") is using in src/app/routes/auth/session.utils.ts:4.
- [L2 high] alice (alice@master) renames getCurrentUser to getUserById, but bob (bob@master) is writing code that uses it: src/app/routes/auth/session.utils.ts:4. Git will merge cleanly but the result can break. Keep the o

**S4** — đăng ký của B: Registered task … "Case-insensitive login email". Status: adjust_suggested.
- [L0 warning] alice (alice@master, task "Stronger password hashing") and bob (bob@master, task "Case-insensitive login email") are both editing src/app/routes/auth/auth.service.ts.
- [L0 info] Registered scopes overlap: alice (alice@master, task "Stronger password hashing") "src/app/routes/auth/auth.service.ts" and bob (bob@master, task "Case-insensitive login email") "src/app/routes/auth/auth.servic

**S5** — đăng ký của B: Registered task … "Comment count on articles". Status: ok.
- [L0 info] alice (alice@master, task "More popular tags") and bob (bob@master, task "Comment count on articles") work in the same module "src/app".

**S6** — đăng ký của B: Registered task … "Follower count". Status: adjust_suggested.
- [L0 warning] alice (alice@master, task "isFollowing helper") and bob (bob@master, task "Follower count") are both editing src/app/routes/profile/profile.service.ts.
- [L0 info] Registered scopes overlap: alice (alice@master, task "isFollowing helper") "src/app/routes/profile/profile.service.ts" and bob (bob@master, task "Follower count") "src/app/routes/profile/profile.service.ts".
- [L1 high] Merging the current work of alice (alice@master) and bob (bob@master) would conflict in src/app/routes/profile/profile.service.ts (Auto-merging). Agree who changes what before going further.

**S7** — đăng ký của B: Registered task … "Reject negative offsets". Status: adjust_suggested.
- [L0 warning] alice (alice@master, task "Cap article page size") and bob (bob@master, task "Reject negative offsets") are both editing src/app/routes/article/article.service.ts.
- [L0 info] Registered scopes overlap: alice (alice@master, task "Cap article page size") "src/app/routes/article/**" and bob (bob@master, task "Reject negative offsets") "src/app/routes/article/**".
- [L2 warning] bob (body_changed) and alice (body_changed) are both changing getArticles in src/app/routes/article/article.service.ts.
- [L1 high] Merging the current work of bob (bob@master) and alice (alice@master) would conflict in src/app/routes/article/article.service.ts (Auto-merging). Agree who changes what before going further.

**S8** — đăng ký của B: Registered task … "Author badge". Status: ok.
- [L0 info] alice (alice@master, task "Author payload without following") and bob (bob@master, task "Author badge") work in the same module "src/app".

## Giới hạn

- Phản ứng của agent khi bị cảnh báo là kịch bản soạn sẵn; với agent thật, tỷ lệ làm theo cảnh báo cần đo riêng.
- Brain (L3: xung đột ý định) tắt để không tốn quota; các cặp chỉ khác nhau ở ý định không có trong bộ này.
- Lỗi logic chỉ được đo qua lỗi type (tsc); lỗi hành vi không đổi kiểu (vd đổi đơn vị thời gian) không đo được.
- 8 cặp tự dựng trên một repo TypeScript: đủ để so sánh các cách làm, chưa đủ để khái quát.

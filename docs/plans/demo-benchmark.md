# Kế hoạch: benchmark và demo gtv trên một shop thật

Viết ngày 27/11/2026, dựa trên bản `8463a72`. File này **tự đủ**: người mới vào nhóm đọc một mình nó là làm theo được,
không cần mở tài liệu khác. Phần cần chủ dự án chốt nằm ở mục 15.

## 1. Tóm tắt

**Mục tiêu.** Có số liệu và một buổi demo cho thấy gtv giúp được việc thật: hai người, hai agent khác loại (Claude
Code và Codex), cùng làm trên một repo bán hàng lấy từ bên ngoài, đi hết từ giao việc, code song song, đụng nhau, phối
hợp, tới lúc việc xong trên `main`.

**Cách làm.** Mỗi cặp việc chạy hai vòng: **off** (không có gtv) và **on** (có gtv), cùng prompt, cùng người, cùng
agent. So kết quả cuối: merge có hỏng không, việc có đạt nghiệm thu không, mất bao lâu, người phải nhắn nhau mấy lần.

**Kết quả cuối cùng phải có:**

1. Báo cáo `docs/reports/bench-shop.md`: bảng off/on, bảng theo từng lớp L0–L3, bảng hỏi đáp.
2. Một trang kết quả để chiếu.
3. Buổi demo sống khoảng 20 phút (mục 10: prompt dán sẵn cho từng người) và video dự phòng.

**Vai.** Trong cả file: **A** = chủ dự án (hienduc14) dùng Claude Code; **B** = bạn cùng nhóm dùng Codex. Mỗi người
một máy. Không đổi vai, không đổi agent giữa các vòng.

**Thứ tự.** 9 bước ở mục 12, xếp theo ngày cho tuần báo cáo (30/11–04/12). Trước tất cả: một lượt **chạy thử ngắn trên
hai máy** (mục 16, khoảng 45 phút) để tìm chỗ vấp khi chưa tốn quota cho phần đo.

**Đang ở đâu (27/11).** Bước 1 xong: bản fork [hienduc14/ace-next-gtv-bench](https://github.com/hienduc14/ace-next-gtv-bench)
đã có commit "bench setup" (`9c8ccbb`), shop chạy được trên máy A. Chạy thử cũng tìm ra một lỗi của gtv phải sửa trước
khi đo (mục 4.5). Chạy bộ **4 cặp: P1, P2, P3, P7**. Demo trên gtv.tenantry.site.

## 2. Cần chứng minh điều gì

Mỗi ý cốt lõi của SPEC phải có một con số hoặc một cảnh trong demo. Không có bằng chứng thì không nói trong báo cáo.

| #   | Điều khẳng định                                         | Bằng chứng                                                              | Lấy từ đâu (mục 3) |
| --- | ------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------ |
| C1  | Đăng ký việc giúp biết đụng nhau **trước khi code**     | số cặp được báo lúc đăng ký; báo sớm hơn lần merge bao lâu              | A, D               |
| C2  | Có gtv thì ít merge hỏng hơn, việc xong sớm hơn         | merge có vấn đề, đạt nghiệm thu ngay lần merge đầu, thời gian tới xanh  | A                  |
| C3  | Mỗi lớp L0–L3 bắt được một loại riêng                   | cặp nào do lớp nào bắt; recall/precision theo từng cấu hình lớp         | A-replay           |
| C4  | Agent hỏi Operator, nhận câu trả lời đúng và có nguồn   | % đúng, % nguồn đúng, % biết nói "không biết"                           | B, D               |
| C5  | Câu cần người khác quyết thì tới đúng agent rồi quay về | % chuyển đúng người, thời gian hỏi → trả lời, số lần người nhắn nhau    | C, D               |
| C6  | Chạy được với hai loại agent khác nhau                  | A dùng Claude Code, B dùng Codex trong mọi lượt                         | A, D               |
| C7  | Tắt/bật từng lớp; server chết thì agent vẫn làm việc    | đổi mức một lớp ngay trong demo; tắt server giữa phiên                  | D                  |
| C8  | Người quản lý nắm được việc và can thiệp được           | bảng việc tự chuyển trạng thái, vụ đụng nhau, hướng xử lý gửi tới agent | D                  |
| C9  | Cái giá phải trả nhỏ                                    | hook p95, số lượt Brain, token và thời gian thêm của agent              | A, A-replay        |

## 3. Bốn nguồn bằng chứng

Agent thật mỗi lần chạy một khác và tốn quota, nên chia theo chi phí:

| Nguồn                        | Agent     | Brain | Trả lời câu hỏi nào                                                        | Tốn quota  |
| ---------------------------- | --------- | ----- | -------------------------------------------------------------------------- | ---------- |
| **A. Off/on với agent thật** | thật      | thật  | Có gtv thì kết quả cuối khác gì                                            | nhiều nhất |
| **A-replay. Phát lại**       | giả lập   | tắt\* | Từng lớp bắt được gì, sớm bao nhiêu, báo thừa bao nhiêu; hook nhanh cỡ nào | không      |
| **B/C. Hỏi đáp và chuyển**   | không cần | thật  | Trả lời đúng không, có nguồn không, chuyển đúng người không                | 1 lượt/câu |
| **D. Demo sống + video**     | thật      | thật  | Người xem thấy tận mắt cả luồng                                            | 2–3 lượt   |

\* Riêng cấu hình L0–L3 cần Brain: 1 lượt mỗi cặp, chạy một lần.

**A-replay** cho nhiều số mà không tốn quota: lấy đúng các nhánh agent thật đã viết ở vòng off, phát lại qua daemon và
Operator bằng payload hook giả lập (cách `scripts/bench/conflicts.ts` đang làm), mỗi cấu hình lớp một lần. Ablation khi
đó chạy trên code do agent thật viết, không phải bản sửa soạn tay.

Đã có sẵn một bộ số trên repo ngoài thứ hai: bộ RealWorld 8 cặp chạy giả lập (`npm run bench:conflicts`, báo cáo
`docs/reports/bench-conflicts.md`). Chạy lại ngày 27/11 trên code mới cho kết quả như cũ: 6 merge có vấn đề còn 1, bắt
được 5/6, hook p95 10 ms. Giữ làm bằng chứng phụ.

## 4. Repo thử: `ace-next`

### 4.1 Vì sao lấy repo ngoài, không tự viết

Đã cân nhắc tự viết một shop để dễ dựng kịch bản, và **không chọn**:

- Nhóm viết công cụ, viết repo, viết cặp việc rồi báo công cụ chạy tốt thì kết quả không nói gì về code ngoài đời.
- Người biết L2 yếu ở đâu (DI, re-export, alias, khớp theo tên) sẽ vô tình viết code tránh các chỗ đó.
- Kịch bản được quyết bởi **đề bài của việc**, không bởi repo. Shop nào cũng có đoạn tính tổng, hàm lấy phiên, hàm
  trả lỗi dùng chung.

Quy tắc đi kèm: kịch bản nào repo không có chỗ để dựng thì **đổi kịch bản, không sửa repo cho vừa**. Chỉ khi cả
`ace-next` lẫn repo dự phòng không chạy được mới tự sinh repo, và khi đó sinh từ một đề bài trung lập (không nhắc gtv,
không nhắc kịch bản) bằng một phiên agent mới, khoá commit rồi mới viết kịch bản.

### 4.2 Repo

[kunlecreates/ace-next](https://github.com/kunlecreates/ace-next) ("Acegrocer", MIT, 1 sao, commit cuối 12/10/2025):
shop tạp hoá, Next.js 15 + Prisma 6 + SQLite, đăng nhập bằng JWT trong cookie, thanh toán giả (`provider: "MOCK"`), có
trang admin. Không cần tài khoản dịch vụ ngoài nào. Giá tính bằng xu (USD).

Dự phòng: [arya-dev2005/ebazaar](https://github.com/arya-dev2005/ebazaar) (có tầng service rõ hơn, nhưng phải giả 2
chỗ gọi Stripe).

Bản dùng để đo là bản fork [hienduc14/ace-next-gtv-bench](https://github.com/hienduc14/ace-next-gtv-bench), nhánh `main`.

### 4.3 Bản đồ code (những chỗ nhiều việc cùng chạm)

| File                        | Có gì                                                                                                          | Ai dùng                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `lib/session.ts`            | `getUserFromCookie(req)`, `getUserFromCookies()` (hai hàm gần trùng nhau), `requireAdmin(user)`                | 10 file route và trang                   |
| `lib/http.ts`               | `ok()`, `err(status, message, opts)`, và các hàm tắt `unauthorized`, `forbidden`, `badRequest`, `notFound`     | mọi route (qua hàm tắt)                  |
| `lib/schemas.ts`            | mọi schema Zod: sản phẩm, giỏ hàng, đơn hàng admin, checkout                                                   | route và test                            |
| `app/api/checkout/route.ts` | `POST`: kiểm tồn kho, tính `totalCents` trong một dòng `reduce`, tạo đơn + giao dịch giả trong một transaction | trang giỏ hàng                           |
| `app/api/cart/route.ts`     | `GET` / `POST` / `PATCH` / `DELETE` giỏ hàng; `GET` trả `{ items }` kèm `product` lồng bên trong               | `app/cart/CartList.tsx`, `CartBadge.tsx` |
| `prisma/schema.prisma`      | `User`, `Product`, `Order`, `OrderItem`, `Transaction`, `CartItem`                                             | tất cả                                   |
| `tests/unit/*.test.ts`      | Vitest: `http`, `session`, `schemas`, `metrics` (13 test)                                                      | `npm run test:unit`                      |
| `tests/*.spec.ts`           | Playwright (19 test); tự build rồi chạy server ở cổng 3005, nên chậm                                           | `npm run test:e2e`                       |
| `docs/PRD.md`               | yêu cầu sản phẩm do tác giả viết                                                                               | Operator sẽ đưa vào tri thức             |

### 4.4 Đã sửa gì trên bản fork

Một commit "bench setup" (`9c8ccbb`), ghi rõ trong báo cáo. **Không sửa code nghiệp vụ.**

- Bỏ theo dõi file sinh ra: `prisma/dev.db`, `prisma/prisma/dev.db`, `tsconfig.tsbuildinfo`, `test-results/`.
- Thêm `DATABASE_URL="file:./dev.db"` vào `.env.example` (trước đó thiếu, app không khởi động được).
- CI: xoá job `docker` và `deploy` trong `.github/workflows/ci.yml` và cả file `cd-k8s.yml` (chúng đẩy image và deploy
  lên cụm của tác giả). Giữ lint, type-check, unit test, e2e.

### 4.5 Kết quả chạy thử (27/11, máy A, Windows 11, Node 24)

| #   | Tiêu chí                                                    | Kết quả                                                                                                             |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | Shop chạy và đặt được hàng                                  | **Qua.** Đăng nhập, thêm 2 món vào giỏ, checkout ra đơn `PAID` 398 xu (gọi qua HTTP; chưa bấm tay trên trình duyệt) |
| 2   | Type-check, unit test, lint xanh trên `main`                | **Qua.** `tsc` sạch, 13/13 unit test, lint không cảnh báo. Chưa chạy bộ Playwright                                  |
| 3   | gtv đọc được code                                           | **Qua.** 80 file, 123 symbol, 1 553 tham chiếu, 209 import. Chưa xem trên dashboard (chờ server)                    |
| 4   | Import kiểu `@/lib/session` được phân giải                  | **Không qua. Lỗi của gtv**, xem dưới                                                                                |
| 5   | `GET` / `POST` trùng tên giữa các file route không lẫn nhau | **Qua** ở mức code graph: 13 hàm `GET`, 6 hàm `POST`, mỗi hàm một id riêng theo file                                |

**Lỗi tìm ra ở tiêu chí 4.** `importPointsTo` (`src/codeintel/graph.ts`) không hiểu alias `@/` của tsconfig. Trong
18 chỗ gọi `getUserFromCookie`, 15 chỗ import bằng `@/lib/session` chỉ được coi là "trùng tên"; 3 chỗ còn lại là file
test dùng đường dẫn tương đối. Hậu quả: ở P2 và P3, L2 vẫn báo nhưng chỉ ở mức **warning** thay vì **high**, nên
Claude không dừng lại hỏi người. Next.js nào cũng dùng alias này, nên đây là lỗi thật chứ không phải riêng repo thử.
Sửa gtv (mục 11, việc 5), không đổi repo.

## 5. Chuẩn bị

### 5.1 Chủ dự án làm một lần

1. ~~Fork và đẩy commit "bench setup"~~ (xong 27/11). Còn lại: thêm B làm collaborator quyền Write của
   `hienduc14/ace-next-gtv-bench` (B cần đẩy nhánh và snapshot `refs/gtv/*`).
2. Server: sửa tài khoản AI, deploy bản mới (gồm bản sửa alias), publish npm 0.2.0 (mục 11, việc 1, 2, 5).
3. Trên dashboard: **Tạo project** với repo của bản fork (server tự đặt id). Bấm **Mời thành viên**, tạo link quyền
   Developer, gửi B.
4. **Thiết lập › Thành viên**: A là backend, senior; B là fullstack, junior. Nhờ vậy lời khuyên "ai nhường ai" có cơ
   sở để so.
5. **Tri thức**: tải lên 3 tài liệu ở mục 7.2, đánh dấu cốt lõi. Điền tiêu chí project, ngôn ngữ nhóm là tiếng Việt.
6. Mỗi lượt chạy dùng một project mới (`shop-run1`, `shop-demo`) để dữ liệu lượt trước không lẫn vào.

### 5.2 Mỗi người làm một lần

Cần Node 20 trở lên, git, và agent của mình đã đăng nhập.

Clone hai lần: daemon gtv tự bật lại mỗi khi agent mở phiên, nên không thể chỉ "tắt gtv" để chạy vòng off.

```powershell
git clone https://github.com/hienduc14/ace-next-gtv-bench.git shop-off
git clone https://github.com/hienduc14/ace-next-gtv-bench.git shop-on
```

Trong **mỗi** thư mục, dựng shop (đã chạy được trên máy A ngày 27/11):

```powershell
npm ci
Copy-Item .env.example .env
npm run prisma:generate
npm run prisma:push
npm run db:seed
npm run dev
```

Mở `http://localhost:3000`, đăng nhập bằng tài khoản admin trong `.env`, thêm hàng vào giỏ, đặt hàng.

Chỉ trong `shop-on`, cài gtv:

```powershell
npx guide-the-vibe
gtv login https://gtv.tenantry.site
gtv on
gtv doctor
```

- `gtv login` mở trình duyệt để duyệt máy. `gtv on` hỏi cài cho agent nào: A chọn Claude Code, B chọn Codex.
- Lần đầu mở agent trong `shop-on`: Claude Code hỏi duyệt MCP server `gtv`; Codex cần trust project và duyệt hook bằng
  `/hooks`.

Đổi snapshot xuống 30 giây (mặc định 5 phút, quá chậm cho việc 10 phút): thêm `"snapshotDebounceMs": 30000` vào
`%USERPROFILE%\.gtv\config.json`, rồi:

```powershell
gtv daemon restart
```

### 5.3 Quy ước trong mọi lượt chạy

- Phiên agent chạy **tương tác**. Không dùng `claude -p` hay `codex exec`: phiên không tương tác kết thúc ngay nên
  dashboard không bao giờ hiện "Đang chạy".
- Mỗi việc một phiên agent mới. Ghi tên model và phiên bản CLI một lần ở đầu bảng quan sát.
- Hai người không nhắn nhau ngoài gtv. Buộc phải nhắn thì ghi một lần vào bảng quan sát.
- Người chỉ trả lời khi agent hỏi thẳng mình.

## 6. Bộ cặp việc

Viết như backlog một sprint của shop. Prompt dán nguyên văn, **giống hệt nhau ở hai vòng**, không nhắc tới gtv. Câu
`Name your task "…"` giúp script nhận ra cảnh báo thuộc cặp nào; ở vòng off nó vô hại.

Đây là bản nháp 1 viết từ code đọc trên GitHub. Bước 2 chạy thử từng việc bằng tay (không dùng agent), viết test
nghiệm thu, rồi **khoá** prompt. Sau khi khoá không sửa nữa.

| Cặp | Thật ra sẽ sao khi làm mù                         | Lớp phải bắt                               | Loại         |
| --- | ------------------------------------------------- | ------------------------------------------ | ------------ |
| P1  | git conflict ở dòng tính tổng và ở trang giỏ hàng | L0 lúc đăng ký, L1 sau snapshot            | conflict chữ |
| P2  | merge sạch, file mới của B import hàm đã bị xoá   | L0 `planned_breaking_change`, L2 `deleted` | sạch mà hỏng |
| P3  | merge sạch, lời gọi `err()` của B thiếu tham số   | L2 `sig_changed`                           | sạch mà hỏng |
| P4  | cùng sửa `schema.prisma`, nhiều khả năng conflict | L0 `critical_path` (hỏi người)             | conflict chữ |
| P5  | merge sạch, `tsc` sạch, mini-cart hiện sai        | L3; có thể sót                             | sai hành vi  |
| P6  | cùng file, khác hàm, git tự gộp được              | chỉ nên báo nhẹ, không chặn                | không đụng   |
| P7  | hai việc không liên quan                          | không báo gì                               | không đụng   |
| P8  | merge sạch, hai tính năng triệt tiêu nhau         | L3 lúc đăng ký                             | trái ý định  |

**Chạy bộ 4 cặp: P1, P2, P3, P7** (chốt 27/11): một conflict chữ, hai ca merge sạch mà hỏng, một ca không đụng để đo báo
thừa. P4, P5, P6, P8 để dự trữ; P8 chỉ dùng cho cảnh thêm trong demo (mục 10.4). Vì bỏ P5 và P8, bộ đo **không có ca nào
cho L3**: báo cáo ghi rõ L3 chỉ được minh hoạ trong demo, chưa được đo.

**P1: mã giảm giá và phí ship**

- A: `P1: Add coupon codes to checkout. POST /api/checkout accepts an optional couponCode; a valid code takes a percentage off the order. Keep the codes in a new file lib/coupons.ts (SAVE10 = 10% off). Add a coupon field to the cart page and show the discount there. Do not change the database schema. Name your task "P1: coupon codes". Commit when done.`
- B: `P1: Add a shipping fee to checkout, following the shop's shipping policy. The fee is added to the order total and shown on the cart page. Do not change the database schema. Name your task "P1: shipping fee". Commit when done.`

**P2: gộp hàm lấy phiên, và xuất đơn hàng**

- A: `P2: lib/session.ts has two near-duplicate functions, getUserFromCookie(req) and getUserFromCookies(). Replace both with a single getSessionUser(req?: Request), update every caller and the unit tests, and remove the old functions. Name your task "P2: single session helper". Commit when done.`
- B: `P2: Add GET /api/orders/export in a new file app/api/orders/export/route.ts that returns the signed-in user's orders as CSV (id, date, status, total). Follow the existing order routes. Name your task "P2: orders CSV export". Commit when done.`

**P3: mã lỗi cho API, và kiểm tồn kho ở giỏ hàng**

- A: `P3: Every API error must carry a machine-readable code. Change err() in lib/http.ts to err(status, code, message, opts?), give the shortcuts (unauthorized, forbidden, badRequest, notFound, tooMany) their codes, and update every caller and the unit tests. Name your task "P3: error codes". Commit when done.`
- B: `P3: In app/api/cart/route.ts, POST and PATCH must reject a quantity above the product's stock with HTTP 409 and the message "Insufficient stock", using err() from lib/http. Name your task "P3: cart stock check". Commit when done.`

**P4: giá khuyến mãi, và danh sách yêu thích**

- A: `P4: Products can be on sale. Add salePercent (0-90, default 0) to Product in prisma/schema.prisma, accept it in the product create/update schemas and the admin forms, and show the reduced price on the product pages. Name your task "P4: sale price". Commit when done.`
- B: `P4: Add a wishlist. New Wishlist model in prisma/schema.prisma (one row per user and product), GET/POST/DELETE /api/wishlist, and a "Save for later" button on the product page. Name your task "P4: wishlist". Commit when done.`

Trước khi chạy P4, thêm `prisma/schema.prisma` vào `policy.critical_paths` của project.

**P5: đổi dữ liệu trả về của giỏ hàng, và mini-cart**

- A: `P5: GET /api/cart should return a flat, priced payload: { items: [{ productId, name, qty, unitPriceCents, lineTotalCents }], subtotalCents } instead of raw rows with a nested product. Update the cart page to use it. Name your task "P5: cart payload". Commit when done.`
- B: `P5: Add a mini-cart to the header: hovering the cart badge shows the first three cart items (name, quantity, price) and the cart subtotal, loaded from GET /api/cart. New component components/MiniCart.tsx, used in app/layout.tsx. Name your task "P5: mini-cart". Commit when done.`

**P6: cùng file, khác hàm**

- A: `P6: In app/api/cart/route.ts, DELETE must return 404 (notFound) when the product is not in the user's cart, instead of failing. Do not touch the other handlers. Name your task "P6: cart delete 404". Commit when done.`
- B: `P6: In app/api/cart/route.ts, GET must return the items sorted by product name. Do not touch the other handlers. Name your task "P6: sorted cart". Commit when done.`

**P7: không liên quan**

- A: `P7: GET /api/health should also report the app version from package.json and whether the database answers. Name your task "P7: richer health check". Commit when done.`
- B: `P7: On the products page add a "Sort by price" control (low to high, high to low). Name your task "P7: sort products by price". Commit when done.`

**P8: hai ý định trái nhau**

- A: `P8: Out-of-stock products must not be shown to shoppers: hide products with stock 0 from the product list and search (GET /api/products and the products page). Name your task "P8: hide out-of-stock". Commit when done.`
- B: `P8: Let shoppers back-order products that are out of stock: on the product page show a "Back-order" button when stock is 0, and let checkout accept those items. Name your task "P8: back-orders". Commit when done.`

### 6.1 Test nghiệm thu

Mỗi việc có test nghiệm thu viết **trước** khi chạy agent, để ở nhánh `bench/acceptance` (thư mục `tests/acceptance/`)
mà agent không thấy. Sau khi gộp, script chồng thư mục đó lên cây đã gộp và chạy.

- Viết bằng Vitest, gọi thẳng hàm route (`POST(new Request(...))`) với một file SQLite tạm. Không dùng Playwright cho
  nghiệm thu: mỗi lần chạy nó build lại cả app.
- Mỗi cặp có 3 nhóm test: việc A, việc B, và **cả hai cùng lúc** (ví dụ P1: tổng = tiền hàng − giảm giá + phí ship).
- Test phải qua trên một bản làm tay đúng của từng việc, và trượt trên `main` chưa sửa.

## 7. Câu hỏi và tài liệu nghiệp vụ

### 7.1 Ba câu hỏi cài sẵn trong việc

| Câu | Trong | Agent cần biết                                 | Câu trả lời ở đâu                               | Kỳ vọng ở vòng on                                 |
| --- | ----- | ---------------------------------------------- | ----------------------------------------------- | ------------------------------------------------- |
| Q1  | P1, B | Phí ship bao nhiêu, miễn phí từ mức nào?       | tài liệu "Chính sách vận chuyển" trên dashboard | bậc 1: Operator trả lời, kèm nguồn                |
| Q2  | P1, B | Giảm giá tính trước hay sau khi cộng phí ship? | chưa ai viết ra; A đang làm phần mã giảm giá    | bậc 2: chuyển vào agent của A, trả lời quay về B  |
| Q3  | P8    | Hết hàng thì ẩn sản phẩm hay cho đặt trước?    | không có ở đâu, không ai phụ trách              | bậc 3: lên **Cần xử lý** của quản lý, có lựa chọn |

Đáp án cố định để hai vòng công bằng:

- Q2: A trả lời "giảm trên tiền hàng, không giảm phí ship; ngưỡng miễn phí ship tính trên tiền hàng trước giảm".
- Q3: quản lý chọn "cho đặt trước, không ẩn".

Ở vòng off, agent phải đoán hoặc dừng hỏi người. Người được hỏi trả lời đúng đáp án trên, và ghi **một lần can thiệp**.

### 7.2 Ba tài liệu tải lên dashboard

Tự viết, mỗi cái nửa trang, đánh dấu cốt lõi. **Không** để trong repo: ngoài đời tài liệu kiểu này nằm ở Notion hay
Drive, và như vậy vòng off công bằng vì agent không tự đọc được.

| Tài liệu              | Nội dung chính                                                                         |
| --------------------- | -------------------------------------------------------------------------------------- |
| Chính sách vận chuyển | tiền hàng từ 50,00 USD trở lên miễn phí ship; dưới mức đó phí cố định 4,99 USD         |
| Quy tắc mã giảm giá   | mỗi đơn một mã; chỉ có mã giảm theo phần trăm; **không** nói gì về thứ tự với phí ship |
| Quy ước API           | tiền là số nguyên tính bằng xu; lỗi trả về dạng `{ error: { message, code } }`         |

Trước khi tải lên, đọc `docs/PRD.md` của repo để chắc ba tài liệu không mâu thuẫn với nó.

### 7.3 Bộ 30 câu hỏi cho thí nghiệm B và C

Mỗi câu có đáp án và nguồn đúng viết trước, lưu ở `scripts/bench/questions.shop.json`. Script gửi thẳng lên Operator,
không cần agent. Trước khi gửi, dựng sẵn hai workspace có code đang dở (lấy nhánh off của P1).

| Loại                 | Số câu | Ví dụ                                          | Đúng là khi                         |
| -------------------- | ------ | ---------------------------------------------- | ----------------------------------- |
| Code                 | 6      | `getUserFromCookie` được gọi ở những file nào? | đủ các file, có nguồn               |
| Nghiệp vụ            | 6      | Đơn 45 USD thì phí ship bao nhiêu?             | 4,99 USD, nguồn là tài liệu ship    |
| Trạng thái           | 6      | Ai đang sửa checkout, đổi gì?                  | đúng người, đúng thay đổi           |
| Không trả lời được   | 6      | Shop có hỗ trợ trả góp không?                  | nói "không biết", không bịa         |
| Cần người khác quyết | 6      | Trường giảm giá trong đơn hàng nên tên là gì?  | chuyển cho đúng người, không tự trả |

Chấm tay: đúng / sai / từ chối đúng / bịa; nguồn đúng hay không; bậc nào xử lý; mất bao lâu. Hai người chấm riêng rồi
đối chiếu.

## 8. Quy trình chạy một cặp

"Xong" có một định nghĩa cho cả hai vòng: **cả hai việc đã vào `main`, `npm run type-check` sạch, unit test và test
nghiệm thu của cả hai việc đều qua.** Đo tới điểm đó chứ không dừng ở lần merge đầu, vì cái giá của phát hiện muộn là
thời gian sửa.

Chạy hết vòng off trước rồi mới chạy vòng on, để không ai mang hiểu biết về cảnh báo của gtv sang vòng off.

1. **Cả hai** vào thư mục của vòng (`shop-off` hoặc `shop-on`), về `main` mới nhất, tạo nhánh:

   ```powershell
   git checkout main; git pull; git checkout -b bench/off/P1/a
   ```

   B dùng `.../P1/b`. Vòng on thay `off` bằng `on`.

2. **A** mở phiên agent mới, dán prompt A. Ghi giờ.
3. **B** chờ 1 phút, mở phiên agent mới, dán prompt B. Ghi giờ.
4. **Giai đoạn code.** Để agent tự làm. Ở vòng on, agent được hỏi qua `gtv_ask`, hoặc chờ A xong rồi làm tiếp trên
   nhánh của A (`git fetch; git rebase origin/bench/on/P1/a`).
5. Agent báo xong thì commit và push. Ghi giờ.

   ```powershell
   git add -A; git commit -m "P1 a"; git push -u origin HEAD
   ```

6. **Giai đoạn gộp** (một người làm, trong một clone riêng `shop-merge`): merge nhánh A vào một nhánh thử từ `main`, rồi
   merge nhánh B, chạy type-check + unit test + nghiệm thu.
   - Sạch và xanh ⇒ xong. Ghi giờ.
   - Conflict hoặc đỏ ⇒ B bảo agent của mình: `Merge origin/bench/<vòng>/P1/a into your branch and make the type check and tests pass.`
     Ghi thời gian và số lượt tới khi xanh. Đây là phần vòng off thường phải trả.
7. **Dọn** (vòng on): bảo agent `finish your gtv task`, thoát agent, về `main`, rồi đẩy snapshot sạch bằng lệnh ở cuối mục 10.5.

   ```powershell
   git checkout main
   ```

   Xem trang **Việc**: hai việc của cặp đã rời cột "Đang làm" chưa.

8. Ghi một dòng vào bảng quan sát.

### 8.1 Bảng quan sát

Mỗi cặp một dòng cho mỗi vòng. Lưu ở `docs/reports/bench-shop-observations.md`.

| Vòng | Cặp | gtv báo lúc nào (đăng ký / đang code / lúc gộp / không) | Agent B làm gì khi bị báo (đổi cách / hỏi / chờ A / bỏ qua) | Lần người can thiệp | Phút code A / B | Phút gộp | Token A / B | Ghi chú |
| ---- | --- | ------------------------------------------------------- | ----------------------------------------------------------- | ------------------- | --------------- | -------- | ----------- | ------- |
| off  | P1  | –                                                       | –                                                           |                     |                 |          |             |         |
| on   | P1  |                                                         |                                                             |                     |                 |          |             |         |

Token: `/cost` trong Claude Code, `/status` trong Codex, đọc ngay trước khi thoát phiên.

## 9. Chỉ số và cách đo

| Chỉ số                                          | Cách đo                                                                 | Công cụ                           |
| ----------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------- |
| Merge bị conflict, số dòng đè nhau              | `git merge-tree` nhánh A rồi B                                          | `scripts/bench/measure.ts`        |
| Merge sạch nhưng hỏng                           | type-check + unit test trên cây đã gộp, so với `main`                   | `measure.ts`, **cần mở rộng**     |
| Đạt nghiệm thu ngay lần merge đầu               | chồng `tests/acceptance/` lên cây đã gộp, chạy test                     | **cần viết**                      |
| Thời gian code, thời gian gộp, tới xanh         | giờ commit + bảng quan sát                                              | tay + git                         |
| Số lần người can thiệp                          | bảng quan sát; vòng on đối chiếu câu hỏi bậc 3 và hướng xử lý đã gửi    | tay + `event_log`                 |
| Báo lúc nào, sớm hơn merge bao lâu              | `event_log` (`register`, `conflict`, `snapshot`), `footprints.first_at` | **cần viết** (script xuất)        |
| Recall, precision, báo thừa theo cấu hình lớp   | phát lại nhánh off với L0 / L0–L1 / L0–L2 / L0–L3                       | **cần viết** (từ `conflicts.ts`)  |
| Hỏi đáp: đúng, nguồn đúng, từ chối đúng, độ trễ | bộ 30 câu, chấm tay                                                     | **cần viết** (script gửi câu hỏi) |
| Chuyển đúng người, thời gian hỏi → trả lời      | bảng `tickets`: `tier`, `to_dev`, `created_at`, `updated_at`            | script xuất                       |
| Hook p50/p95                                    | đo trong lượt phát lại, nâng từ 19 lên vài trăm lần gọi                 | `conflicts.ts`                    |
| Lượt Brain, thời gian mỗi lượt                  | bảng `brain_jobs`                                                       | có sẵn                            |
| Fail-open                                       | tắt server giữa một phiên: agent vẫn sửa được file                      | đo một lần, quay video            |

**Bảng đưa lên slide** (mỗi dòng: off, on, chênh lệch):

1. Merge có vấn đề (conflict + sạch mà hỏng).
2. Cặp đạt nghiệm thu ngay lần merge đầu.
3. Thời gian tới xanh, trung vị.
4. Số lần người phải can thiệp.

Rồi riêng cho gtv: recall và precision theo lớp, số cặp được báo trước khi code, % câu hỏi trả lời đúng có nguồn,
hook p95.

## 10. Kịch bản demo: ai dán gì, lúc nào

Dùng cặp **P1** (mã giảm giá và phí ship) vì nó chứa cả ba chức năng. Hai laptop: máy A chạy Claude Code, máy B chạy
Codex. Màn chiếu mở dashboard của project `shop-demo`; A kiêm vai quản lý trên dashboard.

- **Thời lượng thật khoảng 20 phút**, vì mỗi agent cần 5–8 phút để code. Nếu chỉ có 10–13 phút: làm sống tới hết bước
  6, phần còn lại chiếu video của lượt chạy thử.
- Prompt demo viết bằng tiếng Việt và **được phép nhắc tới gtv** để người xem thấy đúng cảnh cần thấy. Prompt đo đạc ở
  mục 6 thì không bao giờ nhắc gtv. Hai bộ không dùng lẫn.
- Chạy thử trọn vẹn ít nhất một lần và quay video lượt đó.

### 10.1 Trước giờ demo 30 phút

- [ ] Project `shop-demo` mới tạo: trang **Việc** trống, **Cần xử lý** trống, 3 tài liệu cốt lõi đã ở **Tri thức**.
- [ ] Ô trạng thái AI ở góc phải trên của dashboard không báo lỗi.
- [ ] Cả hai máy, trong `shop-on`: `gtv doctor` xanh, về `main` mới nhất rồi tạo nhánh `demo/a` (máy A), `demo/b` (máy B).
- [ ] Máy A: shop chạy sẵn ở `http://localhost:3000`, đã đăng nhập, giỏ có 2 món.
- [ ] Mỗi máy mở sẵn một phiên agent tương tác trong `shop-on`, chưa gõ gì.
- [ ] Màn chiếu: một tab dashboard, một tab shop, video dự phòng mở sẵn.

### 10.2 Hai việc quản lý tạo trên trang Việc

| Ô        | Việc 1                                                                                                                                                                                                                                | Việc 2                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Tiêu đề  | `Mã giảm giá ở checkout`                                                                                                                                                                                                              | `Phí ship ở checkout`                                                                                                           |
| Mô tả    | `POST /api/checkout nhận couponCode (không bắt buộc). Mã hợp lệ giảm theo phần trăm. Danh sách mã để trong file mới lib/coupons.ts (SAVE10 = giảm 10%). Trang giỏ hàng có ô nhập mã và hiện số tiền giảm. Không đổi schema database.` | `Cộng phí ship vào tổng đơn theo Chính sách vận chuyển của shop, hiện phí ship trên trang giỏ hàng. Không đổi schema database.` |
| Ưu tiên  | Cao                                                                                                                                                                                                                                   | Thường                                                                                                                          |
| Giao cho | A                                                                                                                                                                                                                                     | B                                                                                                                               |

### 10.3 Từng bước

Mỗi prompt có mã (`A1`, `B2`…) để hai người gọi nhau cho nhanh. Dán nguyên văn.

**Bước 1 (phút 0–1). Mở màn.** Không có prompt. A thêm hàng và đặt một đơn trên shop. Nói vấn đề: hai người, hai
agent, không ai biết ai đang làm gì.

**Bước 2 (phút 1–2). Giao việc** _(C8)_. A, trên dashboard: trang **Việc**, tạo hai việc ở mục 10.2.

**Bước 3 (phút 2–4). A nhận việc** _(C6)_. Máy A, Claude Code:

```text
/gtv
```

```text
A2: Nhận việc "Mã giảm giá ở checkout". Lên kế hoạch ngắn, đăng ký việc với gtv, rồi làm luôn. Chưa commit.
```

- Màn chiếu: trang **Việc**, thẻ của A sang "Đang làm". Trang **Tổng quan**: agent Claude của A nối tới
  `app/api/checkout/route.ts`.

**Bước 4 (phút 4–6). B nhận việc và biết trùng trước khi code** _(C1)_. Chờ A sửa file đầu tiên. Máy B, Codex:

```text
$gtv
```

```text
B2: Nhận việc "Phí ship ở checkout". Đăng ký việc với gtv trước khi sửa bất kỳ file nào, rồi dừng lại và cho tôi xem nguyên văn gtv trả lời gì.
```

- Màn hình máy B: phản hồi đăng ký nói trùng với việc của A ở `app/api/checkout/route.ts`, kèm lời khuyên.
- Màn chiếu: **Tổng quan** có hai agent, logo Claude và Codex, cùng nối vào một file.
- Không thấy trùng: `B2b: Gọi gtv_status và cho tôi xem ai đang sửa file nào.`

**Bước 5 (phút 6–8). Hỏi Operator, có nguồn** _(C4)_. Máy B:

```text
B3: Hỏi Operator bằng gtv_ask: phí ship của shop là bao nhiêu và miễn phí từ mức nào? Cho tôi xem câu trả lời kèm nguồn. Chưa sửa code.
```

- Màn hình máy B: 4,99 USD, miễn phí từ 50 USD, nguồn là "Chính sách vận chuyển".
- Màn chiếu: trang **Trao đổi** có luồng câu hỏi; mở tài liệu đó ở **Tri thức** để đối chiếu.

**Bước 6 (phút 8–11). Chuyển câu hỏi sang agent của A** _(C5)_. Máy B:

```text
B4: Hỏi bằng gtv_ask: phần mã giảm giá đang làm tính giảm trước hay sau khi cộng phí ship, và ngưỡng miễn phí ship tính trên số nào? Trong lúc chờ, bắt đầu làm phần không phụ thuộc câu trả lời.
```

- Màn hình máy A: dòng `[gtv question tk_… from …]` hiện ra giữa lượt làm việc của Claude. Nếu Claude hỏi lại A:

```text
A3: Trả lời câu hỏi đó qua gtv: giảm trên tiền hàng, không giảm phí ship. Ngưỡng miễn phí ship tính trên tiền hàng trước giảm.
```

- Màn hình máy B: câu trả lời tự chèn vào ở lần Codex gọi tool kế tiếp. Codex không tự thức dậy khi đang rảnh, nên nếu
  nó đã dừng:

```text
B5: Đọc gtv_inbox rồi làm tiếp theo câu trả lời vừa nhận.
```

- Màn chiếu: trang **Trao đổi**, một luồng có đủ hỏi, chuyển tiếp, trả lời. Nói: không ai mở chat.

**Bước 7 (phút 11–15). Đụng nhau, quản lý xử lý** _(C3, C8)_. Mỗi khi một agent dừng lượt, code dở của nó được đẩy lên
sau 2 giây.

- Màn chiếu: trang **Cần xử lý** có một vụ mức cao giữa A và B. A (vai quản lý) mở vụ, xem các hướng AI soạn, chọn
  hướng "A merge trước, B làm tiếp trên code của A", sửa lời nếu cần, bấm gửi.
- Máy A:

```text
A4: Làm tiếp cho xong. Nếu gtv hỏi trước khi sửa file đang đụng thì cho tôi xem lý do.
```

- Màn hình máy A: Claude hiện hộp xin phép kèm lý do của gtv. A đọc to, bấm cho phép.
- Máy B:

```text
B6: Làm theo hướng xử lý vừa nhận từ gtv.
```

**Bước 8 (phút 15–19). Gộp, việc xong** _(C2)_. Máy A:

```text
A5: Chạy type-check và unit test. Xanh thì commit, push, merge nhánh này vào main, push main, rồi gọi gtv_finish_task kèm tóm tắt.
```

Khi A báo đã push `main`, máy B:

```text
B7: Lấy main mới nhất, rebase nhánh của tôi lên đó, sửa cho type-check và unit test xanh, merge vào main, push main, rồi gọi gtv_finish_task kèm tóm tắt.
```

- Màn chiếu: trang **Việc**, hai thẻ đi qua "Chờ merge" rồi sang "Xong". Chậm thì vào **Thiết lập › Repo và đồng bộ**
  cho server lấy `main` mới.
- Shop: máy A về `main`, kéo code, chạy lại. Trang giỏ hàng: nhập `SAVE10`, thấy tiền giảm và phí ship cùng lúc.

  ```powershell
  git checkout main; git pull; npm run dev
  ```

**Bước 9 (phút 19–20). Số liệu.** Slide bảng off/on ở mục 9. Video 30 giây lượt off của chính cặp này: dấu conflict,
test đỏ, thời gian sửa.

### 10.4 Cảnh thêm khi còn thời gian hoặc bị hỏi

**Hai ý định trái nhau, quản lý quyết** (L3 và hỏi đáp bậc 3). Máy A rồi máy B:

```text
A6: Đăng ký việc với gtv: ẩn sản phẩm hết hàng khỏi danh sách và tìm kiếm. Chỉ đăng ký, chưa sửa code.
```

```text
B8: Đăng ký việc với gtv: cho khách đặt trước sản phẩm hết hàng. Nếu gtv báo trái với việc của người khác thì dùng gtv_ask với hai lựa chọn "ẩn hàng hết" và "cho đặt trước" để người quản lý chọn. Chưa sửa code.
```

- Màn chiếu: **Cần xử lý** có câu hỏi kèm hai nút. A bấm "cho đặt trước". Câu trả lời tới cả hai agent.

**Tắt một lớp** _(C7)_. **Thiết lập › Mức giám sát**: đổi lớp L2 sang tắt, rồi bật lại.

**Server chết, agent vẫn làm** _(C7)_. Không tắt server thật giữa buổi. Chiếu video quay trước trên server chạy ở
laptop.

**Thầy tự xem.** **Thiết lập › Link chia sẻ**: tạo link chỉ đọc, gửi thầy mở trên máy của thầy.

### 10.5 Khi trục trặc

| Thấy gì                                        | Làm gì                                                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Agent sửa file mà chưa đăng ký                 | `Đăng ký việc này với gtv trước khi sửa tiếp.`                                           |
| B không hiện trên trang Tổng quan              | Codex đang ghi file bằng lệnh shell. `Sửa file bằng apply_patch, không dùng lệnh shell.` |
| Hơn 1 phút không có vụ đụng nhau ở Cần xử lý   | đẩy code dở lên bằng tay, lệnh ngay dưới bảng, chạy trong `shop-on` ở cả hai máy         |
| Câu hỏi không được trả lời, ô trạng thái AI đỏ | Brain hỏng. Nói rõ, chiếu video cho bước 5–6; cảnh báo đụng nhau (L0–L2) vẫn chạy        |
| Agent chạy quá lâu                             | chuyển sang video ở đúng bước đó                                                         |
| Việc không sang "Xong" sau khi merge           | **Thiết lập › Repo và đồng bộ**, cho server lấy `main` mới                               |

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:7391/snapshot -ContentType 'application/json' -Body (@{ cwd = "$PWD" } | ConvertTo-Json)
```

Lệnh `gtv snapshot` không còn trong CLI 0.2.0; lệnh trên gọi thẳng daemon và **chưa được thử**, kiểm ở lượt chạy thử.

## 11. Việc phải làm trên gtv trước

### Chặn demo

1. **Tài khoản AI của server đang bị từ chối** (log: `Antigravity denied this request`). Không có Brain thì mất hỏi
   đáp bậc 1, L3, hướng xử lý và tóm tắt, tức là mất C4, một nửa C5 và C8. Vào trang **AI trả lời**, đăng nhập lại
   hoặc chọn provider khác. Sau đó xem chất lượng trả lời và tóm tắt tiếng Việt: lớp tóm tắt chưa chạy được lần nào.
2. **Chưa deploy bản tài khoản mới, chưa publish npm 0.2.0.** Máy B cài bằng `npx guide-the-vibe` sẽ nhận 0.1.x,
   không nói chuyện được với server mới.
3. **Công cụ đo đang gắn cứng vào RealWorld.** `scripts/bench/merge.ts` chỉ chạy `tsc` trên `src/app/**`;
   `scenarios.ts` và `measure.ts` ghi sẵn repo và nhánh `master`. Cần một file cấu hình cho repo thử (URL, nhánh gốc,
   lệnh chuẩn bị `npm ci` + `prisma generate`, lệnh type-check, lệnh test) và bước chạy nghiệm thu trên cây đã gộp.
4. **Chưa có script xuất dòng thời gian.** Dữ liệu đã đủ trong `event_log`, `conflicts`, `tickets`, `footprints`
   (đều có giờ), nhưng chưa có gì gom theo từng cặp.
5. **L2 không hiểu alias `@/`** (tìm ra khi chạy thử, mục 4.5). Với repo thử, mọi cảnh báo "A đổi hàm mà B đang dùng"
   bị hạ từ high xuống warning. Sửa `importPointsTo` trong `src/codeintel/graph.ts` cho các tiền tố `@/`, `~/`, thêm
   test trong `test/codeintel.test.ts`. Việc nhỏ, nhưng không sửa thì số của P2 và P3 sai.

### Nên làm, không có thì số liệu yếu

6. **Phát lại nhánh thật theo cấu hình lớp.** `conflicts.ts` đã có khung; cần cho nó đọc bản sửa từ nhánh git thay vì
   từ `scenarios.ts`, và tham số chọn lớp nào bật.
7. **Script gửi bộ câu hỏi**, ghi câu trả lời, nguồn, độ tin cậy, bậc, thời gian ra CSV để chấm.
8. **Việc mới bị gắn vào Việc cũ của cùng người** (`Board.resolveFor`). Chạy nhiều cặp liên tiếp trong một clone thì
   bảng việc sẽ sai. Tạm tránh bằng bước dọn ở mục 8; nên sửa trước demo.
9. **Sửa file bằng lệnh shell thì không có dấu chân.** Codex trên Windows đôi khi ghi file bằng PowerShell; khi đó B
   không hiện trên trang Tổng quan đúng lúc đang chiếu. Kiểm tra trong lượt chạy thử.
10. **CLI 0.2.0 không còn lệnh `gtv snapshot`.** Bước dọn giữa hai cặp và lúc demo bị chậm đều cần đẩy code dở lên
    ngay. Daemon vẫn có `POST /snapshot`; nên thêm lại lệnh CLI gọi nó. `docs/bench-real.md` còn ghi lệnh cũ.
11. **Một trang kết quả để chiếu**: bảng off/on và vài biểu đồ sinh từ báo cáo.

### Không cần cho demo

- Hai danh tính trên một máy: đã chốt hai người, hai máy.
- Mức giám sát "Chặt" và bản gộp do AI viết.
- Lớp mới cho xung đột hành vi không đổi kiểu (P5): thử với L3, bắt được thì là điểm cộng, không thì ghi là giới hạn.

## 12. Thứ tự làm, phân công và lịch

Báo cáo trong tuần 30/11–04/12, chưa biết ngày. Lịch dưới đây xong mọi thứ trước **thứ Năm 03/12**, thứ Sáu để dự phòng.

| Bước | Việc                                                                                          | Ai     | Ngày           | Xong khi                                        | Quota                   |
| ---- | --------------------------------------------------------------------------------------------- | ------ | -------------- | ----------------------------------------------- | ----------------------- |
| 1    | ~~Fork, commit "bench setup", chạy thử~~                                                      | A      | xong 27/11     | mục 4.5                                         | 0                       |
| 2    | Làm tay 8 việc của P1, P2, P3, P7; viết test nghiệm thu; khoá prompt; viết 3 tài liệu, 30 câu | B      | T7 28 – CN 29  | nhánh `bench/acceptance`; prompt không đổi nữa  | 0                       |
| 3    | Sửa alias `@/` (việc 5); mở rộng công cụ đo (việc 3, 4, 6, 7 ở mục 11)                        | A      | T7 28 – CN 29  | chạy được trên 1 cặp dựng tay của shop          | 0                       |
| 4    | Sửa Brain, deploy, publish npm; tạo project, mời B; sửa việc 8, 10; B cài gtv                 | A, B   | T2 30/11       | `gtv doctor` xanh trên cả hai máy               | 2–3 lượt Brain          |
| 5    | Vòng off, 4 cặp                                                                               | A và B | T3 01/12 sáng  | 8 nhánh `bench/off/*` đã push, bảng quan sát đủ | 8 + ~3 phiên            |
| 6    | A-replay trên nhánh off; thí nghiệm B/C                                                       | A      | T3 01/12 chiều | bảng theo lớp, bảng hỏi đáp                     | ~34 lượt Brain          |
| 7    | Vòng on, 4 cặp                                                                                | A và B | T4 02/12 sáng  | 8 nhánh `bench/on/*` đã push                    | 8 phiên, ~35 lượt Brain |
| 8    | Chạy `measure`, viết `docs/reports/bench-shop.md`, làm trang kết quả                          | A      | T4 02/12 chiều | có bảng slide ở mục 9                           | 0                       |
| 9    | Chạy thử demo, quay video dự phòng và video lượt off của P1                                   | A và B | T5 03/12 sáng  | chạy trọn mục 10 không vấp                      | 4 phiên                 |

- Bước 2 và 3 chạy song song cuối tuần này, không tốn quota. Đây là hai bước nặng nhất; trễ ở đây thì cả lịch trễ.
- Bước 6 đặt trước bước 7 để biết gtv bắt được gì trên code thật trước khi tốn quota cho vòng on.
- **Nếu báo cáo sớm hơn thứ Năm, cắt theo thứ tự này:** trang kết quả (dùng thẳng bảng markdown); thí nghiệm B còn 15
  câu; A-replay chỉ chạy L0, L0–L1, L0–L2 (không tốn Brain); bỏ P7. Không cắt: vòng off/on của P1, P2, P3 và lượt chạy
  thử demo.
- Việc đầu tuần dễ kẹt nhất là bước 4 (tài khoản AI của server). Nên thử sửa ngay cuối tuần, đừng để tới thứ Hai.

## 13. Ngân sách lượt LLM

Một "phiên" là một lần mở agent làm một việc nhỏ (5–15 phút). Mỗi cặp ở vòng on tốn thêm khoảng 6–10 lượt Brain (L3
lúc đăng ký, câu hỏi, hướng xử lý, tóm tắt).

| Hạng mục                            | Tối thiểu (4 cặp)        | Đầy đủ (8 cặp)            |
| ----------------------------------- | ------------------------ | ------------------------- |
| Vòng off: phiên code                | 8                        | 16                        |
| Vòng off: phiên sửa sau merge (ước) | 3                        | 5                         |
| Vòng on: phiên code                 | 8                        | 16                        |
| Vòng on: lượt Brain                 | ~35                      | ~70                       |
| Thí nghiệm B/C: lượt Brain          | 30                       | 30                        |
| A-replay cấu hình L0–L3: lượt Brain | 4                        | 8                         |
| Chạy thử demo + demo thật: phiên    | 4                        | 4                         |
| **Tổng**                            | 23 phiên, ~70 lượt Brain | 41 phiên, ~110 lượt Brain |

Đã chốt cột **tối thiểu (4 cặp)**. Không chạy lặp. Mỗi cặp một lần mỗi vòng. Cặp hỏng vì lỗi thiết lập (không phải vì agent) mới chạy lại, và ghi rõ.

## 14. Đọc kết quả cho trung thực

- Cặp việc do nhóm tự dựng để đụng nhau, nên tỉ lệ conflict cao hơn thực tế nhiều. Báo cáo nói rõ: số liệu trả lời
  "khi đụng nhau thì gtv giúp được bao nhiêu", không trả lời "ngoài đời đụng nhau nhiều cỡ nào". P7 có mặt để đo báo
  thừa.
- Mỗi cặp chạy một lần mỗi vòng, agent không tất định. Đưa bảng từng cặp, không tính p-value. Chỉ so off và on của
  cùng một cặp.
- Cùng hai người chạy cả hai vòng nên ở vòng on họ đã biết việc. Prompt giống hệt và phiên agent mới mỗi lần giảm bớt
  ảnh hưởng này, không xoá được.
- "B làm tiếp trên code của A" là cách tránh conflict hợp lệ nhưng có giá là chờ; cột thời gian phải cho thấy giá đó.
- Số của A-replay đo việc **phát hiện**, không đo việc agent có làm theo hay không; cái sau chỉ có ở vòng on thật.
- Ghi cả những ca gtv sót và những cảnh báo thừa. Một bảng toàn 100% khó tin hơn bảng có một ca sót được giải thích.

## 15. Đã chốt và còn chờ chốt

Đã chốt (27/11):

- Repo ngoài, không tự viết (mục 4.1). Bản fork: `hienduc14/ace-next-gtv-bench`.
- Hai người, hai máy.
- Bộ 4 cặp: P1, P2, P3, P7.
- Demo trên gtv.tenantry.site.
- Báo cáo trong tuần 30/11–04/12.

Còn chờ chủ dự án: báo cáo đúng ngày nào trong tuần đó (lịch ở mục 12 đang nhắm thứ Năm 03/12).

## 16. Chạy thử ngắn: hai người, hai máy

**Để làm gì.** Đi hết một lượt đường của demo trên hai máy thật trước khi đo: cài đặt, nhận việc, biết trùng, hỏi
Operator, chuyển câu hỏi sang agent kia, đụng nhau, quản lý xử lý, merge, việc sang "Xong". **Không đo số**, chỉ ghi chỗ
vấp. Tốn 2 phiên agent và khoảng 6–10 lượt Brain. Mất khoảng 45 phút: 15 phút chuẩn bị, 30 phút chạy.

Dùng việc của cặp P1 (mã giảm giá và phí ship), prompt rút gọn và được nhắc tới gtv. **A** (Claude Code) kiêm vai quản
lý trên dashboard; **B** dùng Codex.

Mọi thứ chạy trên nhánh `trial` của bản fork, **không đụng `main`**. Nhờ vậy `main` vẫn là mốc sạch cho các vòng đo.

### 16.1 A chuẩn bị (trước giờ hẹn)

1. **Brain.** Dashboard, trang **AI trả lời**: chọn provider và model. Mở `https://gtv.tenantry.site/health`, phải thấy
   `"brain":{"backend":"pi",...,"ok":true`. Chưa `ok` thì dừng ở đây: bước 4–6 ở 16.3 cần Brain.
2. **GitHub.** Thêm B làm collaborator quyền **Write** của `hienduc14/ace-next-gtv-bench`. Tạo nhánh `trial` từ `main`:

   ```powershell
   git clone https://github.com/hienduc14/ace-next-gtv-bench.git shop-trial
   ```

   ```powershell
   cd shop-trial; git checkout -b trial; git push -u origin trial
   ```

3. **Project.** Dashboard: **Tạo project**, tên `shop-trial`, repo `https://github.com/hienduc14/ace-next-gtv-bench`,
   ô nhánh chính ghi **`trial`**. **Mời thành viên**: tạo link quyền Developer, gửi B.
4. **Tri thức.** Tải lên một tài liệu tên "Chính sách vận chuyển", đánh dấu cốt lõi:

   ```text
   Chính sách vận chuyển
   - Đơn có tiền hàng từ 50,00 USD trở lên: miễn phí ship.
   - Dưới 50,00 USD: phí ship cố định 4,99 USD.
   - Trong code tiền tính bằng xu: ngưỡng 5000, phí 499.
   ```

### 16.2 Mỗi người trên máy của mình (làm song song, khoảng 15 phút)

Cần Node 20 trở lên, git, và agent của mình đã đăng nhập (A: Claude Code, B: Codex). B mở link mời trong trình duyệt và
nhận lời trước.

**Dựng shop.** A dùng luôn thư mục `shop-trial` vừa clone ở 16.1; B clone mới:

```powershell
git clone https://github.com/hienduc14/ace-next-gtv-bench.git shop-trial
```

Rồi trong `shop-trial`, cả hai:

```powershell
git checkout trial
```

```powershell
npm ci; Copy-Item .env.example .env; npm run prisma:generate; npm run prisma:push; npm run db:seed
```

**Cài gtv:**

```powershell
npx guide-the-vibe
```

```powershell
gtv login https://gtv.tenantry.site
```

Đẩy code dở lên sau 30 giây thay vì 5 phút (ghi thêm một khoá vào `~/.gtv/config.json`, giữ nguyên các khoá khác):

```powershell
$f = "$HOME\.gtv\config.json"; $c = Get-Content $f -Raw | ConvertFrom-Json; $c | Add-Member snapshotDebounceMs 30000 -Force; [IO.File]::WriteAllText($f, ($c | ConvertTo-Json))
```

```powershell
gtv on
```

- Máy có cả Claude Code lẫn Codex: `gtv on` hỏi "Set up both?". Trả lời **n**, rồi chỉ chọn agent của mình (A: Claude
  Code, B: Codex).
- Phải thấy dòng `This repo belongs to shop-trial`. Thấy tên project khác thì chạy `gtv link <id>` (id của
  `shop-trial` xem trên dashboard), rồi `gtv on` lại.

```powershell
gtv daemon restart
```

```powershell
gtv doctor
```

`gtv doctor` phải xanh hết. Rồi mỗi người tạo nhánh của mình: A `git checkout -b trial-a`, B `git checkout -b trial-b`.

**Mở agent** (tương tác, không dùng `claude -p` / `codex exec`): A gõ `claude`, B gõ `codex`, trong `shop-trial`.

- Claude Code hỏi duyệt MCP server `gtv`: đồng ý.
- Codex: trust project, rồi gõ `/hooks` và duyệt các hook của gtv.

### 16.3 Chạy (khoảng 30 phút)

Màn hình chung (hoặc máy A): tab dashboard của `shop-trial`. Mỗi bước xong thì đánh dấu vào bảng ở 16.4.

**Bước 1. Giao việc.** A, trên dashboard, trang **Việc**: tạo hai việc rồi giao.

| Ô        | Việc 1                                                                                                                                                                                                                                | Việc 2                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Tiêu đề  | `Mã giảm giá ở checkout`                                                                                                                                                                                                              | `Phí ship ở checkout`                                                                                                           |
| Mô tả    | `POST /api/checkout nhận couponCode (không bắt buộc). Mã hợp lệ giảm theo phần trăm. Danh sách mã để trong file mới lib/coupons.ts (SAVE10 = giảm 10%). Trang giỏ hàng có ô nhập mã và hiện số tiền giảm. Không đổi schema database.` | `Cộng phí ship vào tổng đơn theo Chính sách vận chuyển của shop, hiện phí ship trên trang giỏ hàng. Không đổi schema database.` |
| Ưu tiên  | Cao                                                                                                                                                                                                                                   | Thường                                                                                                                          |
| Giao cho | A                                                                                                                                                                                                                                     | B                                                                                                                               |

**Bước 2. A nhận việc.** Máy A, Claude Code, gõ `/gtv` rồi dán:

```text
Nhận việc "Mã giảm giá ở checkout". Lên kế hoạch ngắn, đăng ký việc với gtv, rồi làm luôn. Chưa commit.
```

Phải thấy: thẻ của A sang "Đang làm"; trang **Tổng quan** có agent của A nối tới `app/api/checkout/route.ts`.

**Bước 3. B nhận việc, biết trùng trước khi code.** Chờ A sửa file đầu tiên. Máy B, Codex, gõ `$gtv` rồi dán:

```text
Nhận việc "Phí ship ở checkout". Đăng ký việc với gtv trước khi sửa bất kỳ file nào, rồi dừng lại và cho tôi xem nguyên văn gtv trả lời gì.
```

Phải thấy: phản hồi đăng ký nói trùng với việc của A ở `app/api/checkout/route.ts`. Không thấy thì dán
`Gọi gtv_status và cho tôi xem ai đang sửa file nào.`

**Bước 4. Hỏi Operator.** Máy B:

```text
Hỏi Operator bằng gtv_ask: phí ship của shop là bao nhiêu và miễn phí từ mức nào? Cho tôi xem câu trả lời kèm nguồn. Chưa sửa code.
```

Phải thấy: 4,99 USD, miễn phí từ 50 USD, nguồn "Chính sách vận chuyển". Trang **Trao đổi** có câu hỏi này.

**Bước 5. Chuyển câu hỏi sang agent của A.** Máy B:

```text
Hỏi bằng gtv_ask: phần mã giảm giá đang làm tính giảm trước hay sau khi cộng phí ship, và ngưỡng miễn phí ship tính trên số nào? Trong lúc chờ, bắt đầu làm phần không phụ thuộc câu trả lời.
```

Phải thấy: máy A hiện dòng `[gtv question … from …]` giữa lượt của Claude. Nếu Claude hỏi lại A, A dán:

```text
Trả lời câu hỏi đó qua gtv: giảm trên tiền hàng, không giảm phí ship. Ngưỡng miễn phí ship tính trên tiền hàng trước giảm.
```

Máy B nhận câu trả lời ở lần Codex gọi tool kế tiếp. Nếu Codex đã dừng thì dán:
`Đọc gtv_inbox rồi làm tiếp theo câu trả lời vừa nhận.`

**Bước 6. Đụng nhau, quản lý xử lý.** Để hai agent làm tiếp. Mỗi khi agent dừng lượt, code dở được đẩy lên sau vài
giây. Hơn 1 phút chưa thấy gì thì chạy lệnh này trong `shop-trial` ở **cả hai máy** (lệnh này chưa từng được thử, ghi
lại nó chạy hay không):

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:7391/snapshot -ContentType 'application/json' -Body (@{ cwd = "$PWD" } | ConvertTo-Json)
```

Phải thấy: trang **Cần xử lý** có một vụ giữa A và B. A mở vụ, xem các hướng AI soạn, chọn "A merge trước, B làm tiếp
trên code của A", bấm gửi. Rồi máy A:

```text
Làm tiếp cho xong. Nếu gtv hỏi trước khi sửa file đang đụng thì cho tôi xem lý do.
```

Máy B:

```text
Làm theo hướng xử lý vừa nhận từ gtv.
```

**Bước 7. Gộp, việc xong.** Máy A:

```text
Chạy type-check và unit test. Xanh thì commit, push, merge nhánh này vào nhánh trial, push trial, rồi gọi gtv_finish_task kèm tóm tắt.
```

Khi A báo đã push `trial`, máy B:

```text
Lấy nhánh trial mới nhất, rebase nhánh của tôi lên đó, sửa cho type-check và unit test xanh, merge vào trial, push trial, rồi gọi gtv_finish_task kèm tóm tắt.
```

Phải thấy: trang **Việc**, hai thẻ đi qua "Chờ merge" rồi sang "Xong". Chậm thì vào **Thiết lập › Repo và đồng bộ** cho
server lấy nhánh mới.

**Bước 8. Xem shop.** Máy A:

```powershell
git checkout trial; git pull; npm run dev
```

Mở `http://localhost:3000`, đăng nhập bằng tài khoản admin trong `.env`, thêm hàng vào giỏ, nhập `SAVE10`: phải thấy
tiền giảm và phí ship cùng lúc.

### 16.4 Ghi lại

Một người ghi, ngay trong lúc chạy:

| Bước | Đạt? | Mất bao lâu | Vấp gì, đã làm gì |
| ---- | ---- | ----------- | ----------------- |
| Cài  |      |             |                   |
| 1    |      |             |                   |
| 2    |      |             |                   |
| 3    |      |             |                   |
| 4    |      |             |                   |
| 5    |      |             |                   |
| 6    |      |             |                   |
| 7    |      |             |                   |
| 8    |      |             |                   |

Riêng mấy điều chưa ai kiểm:

- Codex sửa file thì B có hiện trên **Tổng quan** không. Codex ghi file bằng lệnh PowerShell thì không có dấu chân
  (mục 11, việc 9).
- Lệnh đẩy code dở ở bước 6 chạy được không.
- Tóm tắt và hướng xử lý tiếng Việt của Brain đọc có hiểu không.
- Có việc nào bị gắn nhầm vào việc khác trên trang **Việc** không (mục 11, việc 8).
- Tổng thời gian bước 1–8, so với 20 phút của buổi demo.

Chạy xong, mỗi vấp thành một việc phải sửa ở mục 11, hoặc thêm một dòng vào bảng trục trặc ở mục 10.5.

### 16.5 Dọn sau khi thử

- Bảo mỗi agent `finish your gtv task` nếu chưa gọi, rồi thoát agent.
- Giữ project `shop-trial` để xem lại. Các vòng đo dùng project mới (mục 5.1, điều 6). Khi tạo project mới cùng repo,
  trong clone đo chạy `gtv link <id project mới>` để clone không bám nhầm vào `shop-trial`.
- Nhánh `trial`, `trial-a`, `trial-b` để nguyên trên GitHub. `main` không bị đổi.

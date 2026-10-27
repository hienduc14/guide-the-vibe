# Đóng góp

## Bắt đầu

```bash
nvm use            # Node 24 (xem .nvmrc) — gtv chạy thẳng TypeScript, không có bước build
npm ci
npm run web:install
npm run check      # typecheck + format:check + toàn bộ test
```

Chạy thử cả hệ thống (Docker, sandbox, dashboard): [README.md](README.md#chạy-thử-sandbox-tất-cả-trên-một-máy).

## Chia việc theo vùng

Code chia thành các vùng độc lập (code intel, detection, Q&A + Brain, knowledge, hub/HTTP, daemon + adapter, dashboard, ops, evaluation).
Mỗi vùng có trách nhiệm, file chính, giao diện với vùng khác và test riêng: [docs/project-structure.md](docs/project-structure.md).
Nhận việc theo vùng; khi phải đổi giao diện giữa hai vùng (type trong `src/shared/types.ts`, API trong `docs/api.md`), nói trước với người giữ vùng kia.

## Quy trình

1. Tạo branch từ `main`: `feat/<vùng>-<việc>`, `fix/<việc>`, `docs/<việc>`.
2. Commit nhỏ, thông điệp tiếng Anh dạng mệnh lệnh: `Add L2 rename detection for Go`, `Fix daemon crash without notify-send`.
3. Trước khi push: `npm run check` (và `npm run web:build` nếu sửa `web/`).
4. Mở PR, mô tả **cái gì / vì sao / đã kiểm tra thế nào**. CI chạy trên Ubuntu và Windows.
5. Sửa API, biến môi trường, feature flag hay luồng hoạt động ⇒ cập nhật `docs/` trong cùng PR.

## Quy ước code

- Node 24 type stripping: import có đuôi `.ts`, `import type` cho type, không dùng `enum`/parameter property ([docs/development.md](docs/development.md)).
- Format bằng Prettier (`npm run format`); cấu hình trong `.prettierrc.json`.
- Comment ngắn, giải thích _vì sao_, không lặp lại code. Code và comment bằng tiếng Anh; docs bằng tiếng Việt.
- Mọi lỗi phía gtv phải **fail-open**: không bao giờ chặn agent vì gtv hỏng.
- Tính năng mới đi kèm feature flag (`src/shared/features.ts`) và test.

## Test

- Test tự động không được gọi LLM thật: dùng `FakeBrain` (xem `test/server.test.ts`).
- Test với Brain/agent thật (self-test RealWorld, Claude Code/Codex thật) tốn quota subscription: chỉ chạy vài lượt, ghi số lượt vào PR.
- Chi tiết: [docs/testing.md](docs/testing.md).

## Bí mật

Không commit `docker/.env`, token, mật khẩu, `sandbox/`, `.gtv-data/` (đã có trong `.gitignore`). Token dev cấp qua dashboard, mỗi người một token.

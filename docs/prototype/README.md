# Prototype của trang project

Bản HTML tĩnh dùng để chốt thiết kế trước khi viết React (26/11/2026). Mở `index.html` bằng một web server tĩnh, ví dụ `python3 -m http.server` trong thư mục này. Dữ liệu là mẫu, dựng theo project Realworld.

`PLAN.md` là kế hoạch đã dùng để chuyển prototype thành dashboard thật. Giao diện thật nằm ở `web/src/pages/project/`; nơi nào code thật khác prototype, code thật đúng.

## `auth/`: tài khoản, project, máy

Prototype các màn ở mục 5 của [plans/auth-v2.md](../plans/auth-v2.md) (27/11/2026): đăng nhập, đăng ký, link mời, Project
của tôi, tạo project (popup), Thiết lập › Thành viên, Tài khoản, Máy của tôi, Quản trị server. Mở `auth/index.html`
cũng qua web server tĩnh; nút "Màn hình" ở góc phải dưới chọn từng màn. Giao diện thật: `web/src/pages/{auth,home,account,admin}/`
và phần Thành viên trong `web/src/pages/project/SettingsSections.tsx`.

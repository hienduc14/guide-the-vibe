# Tài liệu gtv

| Tài liệu                                     | Nội dung                                                                                                             |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [architecture.md](architecture.md)           | Các thành phần, luồng chính (đăng ký, snapshot → L1/L2, hỏi đáp, merge), lưu trữ, chế độ feature, fail-open, bảo mật |
| [project-structure.md](project-structure.md) | Bản đồ thư mục, 9 vùng việc (A–I) để phân công, quy tắc phụ thuộc giữa các vùng                                      |
| [features.md](features.md)                   | Mỗi feature key: làm gì, thuật toán, mặc định, phụ thuộc, metric trên dashboard, giới hạn                            |
| [api.md](api.md)                             | API project (`/v1/p/:id`), khám phá project, admin (`/api`), MCP của Brain, API local của daemon, tool `gtv_*`       |
| [agents.md](agents.md)                       | Tích hợp Claude Code, Codex, omp; ma trận khả năng hook; `gtv install` / `gtv link`; xử lý sự cố                     |
| [operations.md](operations.md)               | Docker compose, biến môi trường, project/token, đăng nhập ChatGPT cho Brain, chọn model, backup, sự cố               |
| [development.md](development.md)             | Thiết lập dev (Node 24 type stripping), quy ước, hướng dẫn thêm flag/layer/job/tool/adapter/trang                    |
| [testing.md](testing.md)                     | Bộ test, cách chạy, self-test RealWorld, đọc báo cáo                                                                 |
| [reports/](reports/)                         | Báo cáo kiểm thử sinh tự động (đừng sửa tay)                                                                         |

Đặc tả gốc và lý do thiết kế: [../SPEC.md](../SPEC.md). Dashboard: [../web/README.md](../web/README.md).

# STATUS

Cập nhật: 2026-11-23 · Phiên: 1
Epic hiện tại: E1 · Item đang làm: E1-01, E1-02, E1-03 · Trạng thái: In progress

## Đã xong gần đây
- Hoàn thành và kiểm thử trực tiếp Giai đoạn 0B trên container PostgreSQL 16.16 (`beam-postgres` qua Docker Desktop):
  - `db/migrations/0001_initial_schema.sql` chạy sạch và chạy lại không lỗi trên `beam_dev` và `beam_test` (19 bảng gồm 18 bảng miền + `schema_migrations`).
  - `db/seed.sql` chạy lại 2 lần idempotent trên `beam_dev` (18 quyền, 3 preset, 5 profile giả, 4 ban, 1 board, 4 cột, 4 task).
  - Kiểm thử trực tiếp 9/9 bất biến SQL trên `beam_test`: chặn `UPDATE`/`DELETE`/`TRUNCATE` trên `task_events` & `audit_logs` (`APPEND_ONLY_TABLE`), chặn đổi `student_id` (`STUDENT_ID_IMMUTABLE`), chặn gỡ/khóa admin cuối cả single-row và multi-row `UPDATE`/`DELETE` (`LAST_ACTIVE_ADMIN`), chặn trùng `reminders (task_id, user_id, kind)`, `tasks.priority` 1–4, `departments.name` không phân biệt hoa thường/khoảng trắng.
- Chủ dự án đã duyệt đóng Giai đoạn 0 (`E0-01`, `E0-02`, `E0-03`), merge nhánh `feat/E0-multi-agent-and-design` vào `main` và duyệt triển khai Epic E1 (`E1-01`, `E1-02`, `E1-03`).

## Đang thực hiện
- Mở nhánh `feat/E1-foundation-and-architecture` và triển khai `E1-01` (Next.js, TypeScript `strict`, ESLint 6A.6, `dependency-cruiser` 6A.2, Vitest, CI).
- Sau khi `E1-01` xong, chạy song song `backend-db` (`E1-02`) và `frontend` (`E1-03`), sau đó kiểm thử + audit độc lập với `qa-reviewer`.

## Đang bị chặn / câu hỏi cho chủ dự án
- Không có.

## Việc tiếp theo
- Hoàn tất `E1-01`, `E1-02`, `E1-03`, chạy toàn bộ check (`typecheck`, `lint`, `arch:check`, `openapi:check`, `test:unit`, `test:integration`, `build`), audit bằng `qa-reviewer` ngữ cảnh sạch và gửi PR Epic E1 chờ duyệt.

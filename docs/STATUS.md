# STATUS

Cập nhật: 2026-11-24 · Phiên: 3
Epic hiện tại: CR-01 · Item đang làm: CR-01-01, CR-01-02, CR-01-03 (`[RỦI RO CAO]`) · Trạng thái: In progress trên nhánh `feat/CR01-all-account-passwords` (đã duyệt bởi chủ dự án)

## Đã xong gần đây
- **E0 (Done, đã merge `main`):** Wireframe 0A, CSDL 0B (PostgreSQL 16), OpenAPI & truy vết 0C.
- **E1 (Done, đã merge `main`):** Next.js 16 + TypeScript `strict`, ESLint 6A.6, `dependency-cruiser` 6A.2, Drizzle 18 bảng, hạ tầng `Config`/`Clock`/`Logger` (lọc PII)/`Mailer`/`TransactionRunner`/`toErrorResponse`/composition root, `next-intl`, `AppShell`, API client, CI.
- **E2 (Done, đã merge `main` sau khi chủ dự án duyệt):** Xác thực MSSV, session cookie (`24h` phiên / `30 ngày` trượt kèm gia hạn `Max-Age`), rate limit IP (`isIP()`), `authorize`, `sanitizeReturnTo` dùng chung, UI `S01`/`S08` (`AuthGuard` + đồng bộ ngôn ngữ `PATCH /me`); 83 unit test + 8 integration test PostgreSQL + 4 Chrome E2E xanh, `qa-reviewer` **`PASS`**.
- **E3 (Done, đã merge `main` sau khi chủ dự án duyệt):** Quản lý Thành viên & Ban (`src/lib/members.ts`, module `departments` + `members` + `audit`, che MSSV/email `FR-42`/`AC-11`, domain `@eiu.edu.vn` `AC-14`, 3 quyền mặc định `FR-19`, chặn gỡ/khóa admin cuối `409` `AC-09`, chặn xóa ban đang dùng `409` `WQ-10`, giao diện `S07`/`S09`/`S11`); 116 unit test + 10 integration test PostgreSQL + 7 Chrome E2E xanh, `qa-reviewer` **`PASS`**.
- **E4 (Done, đã merge `main` sau khi chủ dự án duyệt):** Phân quyền (`src/lib/permissions.ts`, 6 endpoint `/permissions*`, `/admin` & `/audit-logs`, 3 mẫu quyền thay thế toàn bộ `WQ-06`, hiệu lực tức thì `AC-07`, chặn `member.update` tự cấp quyền `AC-08`, chống gỡ admin cuối `409` transaction + trigger `AC-09`, `audit_logs` không PII `AC-10`, giao diện `S10` `/admin/permissions` & `S13` `/admin/audit`); 138 unit test + 12 integration test PostgreSQL / 7 tệp + 10 Chrome E2E xanh, `qa-reviewer` **`PASS`**.
- **E5 (Done, đã merge `main` sau khi chủ dự án duyệt):**
  - Backend: Boards, columns, tasks, `POST /tasks/{id}/move` (rebalance tự động & `409`), assignees (chặn gán mới thành viên đã rời `400 INVALID_ASSIGNEE_IDS`), `/me/tasks` (`WQ-03`), `taskVisibilityPolicy` (`404` task ẩn), `task_events` append-only, sửa seed UTF-8 `db/seed.sql` cho `departments`.
  - Frontend: `S03` `/boards`, `S04` `/boards/[id]` (kéo thả `@dnd-kit` task & cột, menu `⋯` `ActionMenu`, full-width Kanban), `S05` chi tiết task (hạn `00:00 UTC+7` `WQ-12`, bỏ gán thành viên đã rời, sửa xóa task không treo `404`), `S06` `/my-tasks`, bộ màu Hồng–Trắng–Đen (`Crisp Editorial Pop`) + phóng to desktop + nhấn mạnh Priority/Deadline + nhãn audit `board.*`.
  - Kiểm thử & QA (`qa-engineer` ngữ cảnh sạch): `typecheck`, `lint`, `arch:check` (`190/796`), `openapi:check`, `167 unit test / 36 tệp`, `15 integration test PostgreSQL / 10 tệp`, `next build` (`37 route`), **`13/13` Chrome E2E** (gồm `tests/e2e/boards-tasks.spec.ts`) đều đạt -> **`VERDICT: PASS`**.

## Đang bị chặn / câu hỏi cho chủ dự án
- Không có (đang triển khai `CR-01` trên nhánh `feat/CR01-all-account-passwords`).

## Việc tiếp theo
- Hoàn tất `CR-01` (Mật khẩu đăng nhập toàn bộ tài khoản, tự đổi mật khẩu, admin đặt lại mật khẩu) -> chờ Sang duyệt merge PR -> **`CR-02`** (Logo CLB & Avatar thành viên) -> **`CR-03`** (Giao task theo Ban & Thông báo) -> **`E6–E9`**.

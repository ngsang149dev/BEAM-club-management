# STATUS

Cập nhật: 2026-11-24 · Phiên: 2
Epic hiện tại: E2 · Item đang làm: E2-01, E2-02, E2-03 · Trạng thái: Chờ duyệt (nhánh `feat/E2-auth-and-session`)

## Đã xong gần đây
- **E0 (Done, đã merge `main`):** Wireframe 0A, CSDL 0B (xác minh trực tiếp trên PostgreSQL 16), OpenAPI & truy vết 0C.
- **E1 (Done, đã merge `main` sau khi chủ dự án duyệt):** Next.js 16 + TypeScript `strict`, ESLint 6A.6, `dependency-cruiser` 6A.2, Drizzle schema 18 bảng, hạ tầng `Config`/`Clock`/`Logger` (lọc PII)/`Mailer`/`TransactionRunner`/`toErrorResponse`/composition root, `next-intl` song ngữ, `AppShell`, API client typed, CI.
- **E2 (`E2-01` `[RỦI RO CAO]`, `E2-02`, `E2-03` `[RỦI RO CAO]` — Chờ duyệt merge trên nhánh `feat/E2-auth-and-session`):**
  - Backend auth/session/`authorize` đọc quyền & `is_active` trực tiếp từ PostgreSQL mỗi request, giới hạn thử theo IP (`isIP()`-validated headers + `login_attempts`), cookie `HttpOnly`/`SameSite`/`Secure` (phiên 24h vs 30 ngày trượt kèm gia hạn `Max-Age` khi dùng), `sanitizeReturnTo` dùng chung `@/lib/auth`, `Cache-Control: no-store`, `GET/PATCH /me`.
  - Frontend `S01` đăng nhập (`method="post"`, không mật khẩu/OTP), `AuthGuard`, `S08` hồ sơ cá nhân, `LanguageSwitch` đồng bộ `PATCH /me` trước khi cập nhật cookie/giao diện.
  - Kiểm thử sau lần sửa cuối: `typecheck`, `lint`, `arch:check` (71 modules / 168 deps, 0 vi phạm), `openapi:check`, `test:unit` (18 file / 83 test), `test:integration` trên PostgreSQL `beam_test` (3 file / 8 test), `build` (Turbopack), `test:e2e` Playwright Chrome trên `beam_test` (4 test); `qa-reviewer` ngữ cảnh sạch ra kết luận **`PASS`**.

## Đang thực hiện
- Chưa có (đang chờ chủ dự án duyệt PR E2 trước khi merge vào `main`).

## Đang bị chặn / câu hỏi cho chủ dự án
- Không có; cần chủ dự án duyệt merge nhánh `feat/E2-auth-and-session` vào `main` và duyệt danh sách item dự thảo Epic E3 (`E3-01`, `E3-02`, `E3-03`) trong `docs/BACKLOG.md`.

## Việc tiếp theo
- Sau khi được duyệt: merge `feat/E2-auth-and-session` vào `main`, chuyển trạng thái E2 sang `Done`, mở khóa và triển khai Epic E3 (Quản lý thành viên `S07`/`S09` & 20 ban `S11`).

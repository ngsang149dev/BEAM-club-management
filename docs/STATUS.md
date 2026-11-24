# STATUS

Cập nhật: 2026-11-24 · Phiên: 2
Epic hiện tại: E4 · Item đang làm: E4-01, E4-02, E4-03 · Trạng thái: Chờ duyệt merge (nhánh `feat/E4-permissions-and-audit`)

## Đã xong gần đây
- **E0 (Done, đã merge `main`):** Wireframe 0A, CSDL 0B (PostgreSQL 16), OpenAPI & truy vết 0C.
- **E1 (Done, đã merge `main`):** Next.js 16 + TypeScript `strict`, ESLint 6A.6, `dependency-cruiser` 6A.2, Drizzle 18 bảng, hạ tầng `Config`/`Clock`/`Logger` (lọc PII)/`Mailer`/`TransactionRunner`/`toErrorResponse`/composition root, `next-intl`, `AppShell`, API client, CI.
- **E2 (Done, đã merge `main` sau khi chủ dự án duyệt):** Xác thực MSSV, session cookie (`24h` phiên / `30 ngày` trượt kèm gia hạn `Max-Age`), rate limit IP (`isIP()`), `authorize`, `sanitizeReturnTo` dùng chung, UI `S01`/`S08` (`AuthGuard` + đồng bộ ngôn ngữ `PATCH /me`); 83 unit test + 8 integration test PostgreSQL + 4 Chrome E2E xanh, `qa-reviewer` **`PASS`**.
- **E3 (Done, đã merge `main` sau khi chủ dự án duyệt):** Quản lý Thành viên & Ban (`src/lib/members.ts`, module `departments` + `members` + `audit`, che MSSV/email `FR-42`/`AC-11`, domain `@eiu.edu.vn` `AC-14`, 3 quyền mặc định `FR-19`, chặn gỡ/khóa admin cuối `409` `AC-09`, chặn xóa ban đang dùng `409` `WQ-10`, giao diện `S07`/`S09`/`S11`); 116 unit test + 10 integration test PostgreSQL + 7 Chrome E2E xanh, `qa-reviewer` **`PASS`**.

## Đang thực hiện
- **Epic E4 (`Chờ duyệt merge`, nhánh `feat/E4-permissions-and-audit`):**
  - `E4-01` (`backend-db`, **RỦI RO CAO**): hợp đồng dùng chung `src/lib/permissions.ts` (`PERMISSION_CODES`, 3 preset, Zod schemas, `computePermissionDiff`), module `permissions` & mở rộng `audit` (6 endpoint `/permissions`, `/permission-presets`, `/members/{id}/permissions`, `/members/{id}/permissions/apply-preset`, `/members/{id}/admin`, `/audit-logs`), chỉ admin cấp/thu hồi quyền (`403` cho `member.update` `AC-08`), hiệu lực tức thì không cần đăng nhập lại (`AC-07`), thay thế toàn bộ khi áp mẫu (`WQ-06`), chống gỡ admin cuối trong transaction + advisory lock + trigger CSDL (`409` `AC-09`), ghi `audit_logs` trong cùng transaction (`AC-10`) và chiếu `MemberPublicSummary` không chứa MSSV/email.
  - `E4-02` (`frontend`): màn hình `S10` (`/admin/permissions` — 6 nhóm / 18 mã quyền, hộp thoại áp mẫu đếm `+thêm/-bỏ`, bật/tắt cờ admin + cảnh báo `409`, tóm tắt quyền hiệu lực) & `S13` (`/admin/audit` — nhật ký chỉ đọc phân trang cursor, lọc hành động/thời gian/người, chi tiết bên phải, giờ `Asia/Ho_Chi_Minh`), chuỗi song ngữ `vi`/`en` + parity key/ICU.
  - `E4-03` (`qa-reviewer`, **RỦI RO CAO**): Chrome E2E `tests/e2e/permissions-audit.spec.ts` + review ngữ cảnh sạch đạt **`PASS`**.
  - Kiểm chứng toàn bộ 8 cổng trên mã cuối: `typecheck` (0), `lint` (0), `arch:check` (0 — 138 module / 501 phụ thuộc), `openapi:check` (0), `test:unit` (28 tệp / 138 test xanh), `test:integration` PostgreSQL (7 tệp / 12 test xanh), `build` Next.js (26 route), `test:e2e` Chrome (10/10 test xanh).

## Đang bị chặn / câu hỏi cho chủ dự án
- Chờ Sang duyệt:
  1. Merge PR Epic E4 (nhánh `feat/E4-permissions-and-audit`, `[RỦI RO CAO]`) vào `main`.
  2. Duyệt dự thảo backlog **Epic E5** (`E5-01`, `E5-02`, `E5-03`) trong `docs/BACKLOG.md` để bắt đầu triển khai.

## Việc tiếp theo
- Sau khi Sang duyệt: merge `feat/E4-permissions-and-audit` vào `main`, chuyển `E4` sang `Done`, mở nhánh Epic E5 và triển khai `E5-01` (`backend-db`), `E5-02` (`frontend`), `E5-03` (`qa-reviewer`).

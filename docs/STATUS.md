# STATUS

Cập nhật: 2026-11-24 · Phiên: 2
Epic hiện tại: E3 · Item đang làm: E3-01, E3-02, E3-03 · Trạng thái: Chờ duyệt merge (nhánh `feat/E3-members-and-departments`)

## Đã xong gần đây
- **E0 (Done, đã merge `main`):** Wireframe 0A, CSDL 0B (PostgreSQL 16), OpenAPI & truy vết 0C.
- **E1 (Done, đã merge `main`):** Next.js 16 + TypeScript `strict`, ESLint 6A.6, `dependency-cruiser` 6A.2, Drizzle 18 bảng, hạ tầng `Config`/`Clock`/`Logger` (lọc PII)/`Mailer`/`TransactionRunner`/`toErrorResponse`/composition root, `next-intl`, `AppShell`, API client, CI.
- **E2 (Done, đã merge `main` sau khi chủ dự án duyệt):** Xác thực MSSV, session cookie (`24h` phiên / `30 ngày` trượt kèm gia hạn `Max-Age`), rate limit IP (`isIP()`), `authorize`, `sanitizeReturnTo` dùng chung, UI `S01`/`S08` (`AuthGuard` + đồng bộ ngôn ngữ `PATCH /me`); 83 unit test + 8 integration test PostgreSQL + 4 Chrome E2E xanh, `qa-reviewer` **`PASS`**.

## Đang thực hiện
- **Epic E3 (`Chờ duyệt merge`, nhánh `feat/E3-members-and-departments`):**
  - `E3-01` (`backend-db`, **RỦI RO CAO**): hợp đồng Zod dùng chung `src/lib/members.ts`, module `departments` & `members` & `audit` (lọc PII ở mapper, `studentId` không đổi `WQ-21`, domain `@eiu.edu.vn` `AC-14`, 3 quyền mặc định `FR-19`, thu hồi session + chặn gỡ admin cuối `409` `AC-09`, chặn xóa ban đang dùng `409` `WQ-10`, phân trang cursor, `audit_logs` không PII), 6 route `/api/v1/members*` & `/api/v1/departments*`.
  - `E3-02` (`frontend`): màn hình `S07` (`/members`), `S09` (`/admin/members`), `S11` (`/admin/departments`), chuỗi song ngữ `vi`/`en` + kiểm tra parity placeholder ICU.
  - `E3-03` (`qa-reviewer`, **RỦI RO CAO**): Chrome E2E `tests/e2e/members-departments.spec.ts` + review ngữ cảnh sạch đạt **`PASS`**.
  - Kiểm chứng toàn bộ 8 cổng trên mã cuối: `typecheck` (0), `lint` (0), `arch:check` (0 — 108 module / 354 phụ thuộc), `openapi:check` (0), `test:unit` (24 tệp / 116 test xanh), `test:integration` PostgreSQL (5 tệp / 10 test xanh), `build` Next.js (18 route), `test:e2e` Chrome (7/7 test xanh).

## Đang bị chặn / câu hỏi cho chủ dự án
- Chờ Sang duyệt:
  1. Merge PR Epic E3 (nhánh `feat/E3-members-and-departments`, `[RỦI RO CAO]`) vào `main`.
  2. Duyệt dự thảo backlog **Epic E4** (`E4-01`, `E4-02`, `E4-03`) trong `docs/BACKLOG.md` để bắt đầu triển khai.

## Việc tiếp theo
- Sau khi Sang duyệt: merge `feat/E3-members-and-departments` vào `main`, chuyển `E3` sang `Done`, mở nhánh Epic E4 và triển khai `E4-01` (`backend-db`), `E4-02` (`frontend`), `E4-03` (`qa-reviewer`).

# STATUS

Cập nhật: 2026-11-24 · Phiên: 2
Epic hiện tại: E4 · Item đang làm: E4-01, E4-02 · Trạng thái: In progress (nhánh `feat/E4-permissions-and-audit`)

## Đã xong gần đây
- **E0 (Done, đã merge `main`):** Wireframe 0A, CSDL 0B (PostgreSQL 16), OpenAPI & truy vết 0C.
- **E1 (Done, đã merge `main`):** Next.js 16 + TypeScript `strict`, ESLint 6A.6, `dependency-cruiser` 6A.2, Drizzle 18 bảng, hạ tầng `Config`/`Clock`/`Logger` (lọc PII)/`Mailer`/`TransactionRunner`/`toErrorResponse`/composition root, `next-intl`, `AppShell`, API client, CI.
- **E2 (Done, đã merge `main` sau khi chủ dự án duyệt):** Xác thực MSSV, session cookie (`24h` phiên / `30 ngày` trượt kèm gia hạn `Max-Age`), rate limit IP (`isIP()`), `authorize`, `sanitizeReturnTo` dùng chung, UI `S01`/`S08` (`AuthGuard` + đồng bộ ngôn ngữ `PATCH /me`); 83 unit test + 8 integration test PostgreSQL + 4 Chrome E2E xanh, `qa-reviewer` **`PASS`**.
- **E3 (Done, đã merge `main` sau khi chủ dự án duyệt):** Quản lý Thành viên & Ban (`src/lib/members.ts`, module `departments` + `members` + `audit`, che MSSV/email `FR-42`/`AC-11`, domain `@eiu.edu.vn` `AC-14`, 3 quyền mặc định `FR-19`, chặn gỡ/khóa admin cuối `409` `AC-09`, chặn xóa ban đang dùng `409` `WQ-10`, giao diện `S07`/`S09`/`S11`); 116 unit test + 10 integration test PostgreSQL + 7 Chrome E2E xanh, `qa-reviewer` **`PASS`**.

## Đang thực hiện
- **Epic E4 (đã được chủ dự án duyệt, nhánh `feat/E4-permissions-and-audit`):**
  - Khóa hợp đồng dùng chung `src/lib/permissions.ts` (`PERMISSION_CODES`, 3 mã preset, Zod schemas, `computePermissionDiff`), rồi triển khai song song `E4-01` (`backend-db`, **RỦI RO CAO**) và `E4-02` (`frontend`, màn hình `S10` `/admin/permissions` & `S13` `/admin/audit`).

## Đang bị chặn / câu hỏi cho chủ dự án
- Không có.

## Việc tiếp theo
- Hoàn tất `E4-01`, `E4-02`, chạy đủ 8 cổng (`typecheck`, `lint`, `arch:check`, `openapi:check`, `test:unit`, `test:integration`, `build`, `test:e2e`), audit ngữ cảnh sạch `qa-reviewer` (`E4-03` `[RỦI RO CAO]`), rồi gửi PR E4 kèm dự thảo backlog Epic E5.

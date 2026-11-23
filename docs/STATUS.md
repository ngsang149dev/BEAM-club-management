# STATUS

Cập nhật: 2026-11-24 · Phiên: 2
Epic hiện tại: E3 · Item đang làm: E3-01, E3-02 · Trạng thái: In progress (nhánh `feat/E3-members-and-departments`)

## Đã xong gần đây
- **E0 (Done, đã merge `main`):** Wireframe 0A, CSDL 0B (PostgreSQL 16), OpenAPI & truy vết 0C.
- **E1 (Done, đã merge `main`):** Next.js 16 + TypeScript `strict`, ESLint 6A.6, `dependency-cruiser` 6A.2, Drizzle 18 bảng, hạ tầng `Config`/`Clock`/`Logger` (lọc PII)/`Mailer`/`TransactionRunner`/`toErrorResponse`/composition root, `next-intl`, `AppShell`, API client, CI.
- **E2 (Done, đã merge `main` sau khi chủ dự án duyệt):** Xác thực MSSV, session cookie (`24h` phiên / `30 ngày` trượt kèm gia hạn `Max-Age`), rate limit IP (`isIP()`), `authorize`, `sanitizeReturnTo` dùng chung, UI `S01`/`S08` (`AuthGuard` + đồng bộ ngôn ngữ `PATCH /me`); 83 unit test + 8 integration test PostgreSQL + 4 Chrome E2E xanh, `qa-reviewer` **`PASS`**.

## Đang thực hiện
- Epic E3 (đã được chủ dự án duyệt): khóa hợp đồng Zod dùng chung `src/lib/members.ts`, sau đó triển khai song song `E3-01` (backend Thành viên & 20 ban + `audit_logs`, **RỦI RO CAO**) và `E3-02` (giao diện `S07`, `S09`, `S11`).

## Đang bị chặn / câu hỏi cho chủ dự án
- Không có.

## Việc tiếp theo
- Hoàn tất `E3-01`, `E3-02`, chạy đầy đủ 8 cổng (`typecheck`, `lint`, `arch:check`, `openapi:check`, `test:unit`, `test:integration`, `build`, `test:e2e`), audit ngữ cảnh sạch `qa-reviewer` (`E3-03` `[RỦI RO CAO]`), rồi gửi PR E3 kèm dự thảo backlog Epic E4.

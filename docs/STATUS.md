# STATUS

Cập nhật: 2026-11-23 · Phiên: 1
Epic hiện tại: E1 · Item đang làm: E1-01, E1-02, E1-03 · Trạng thái: Chờ duyệt

## Đã xong gần đây
- **E0 (Done & Merged vào `main`):** Hoàn thành 0A/0B/0C, xác minh trực tiếp 9/9 bất biến PostgreSQL 16 trên Docker `beam-postgres` (`beam_dev` & `beam_test`), hợp đồng `docs/openapi.yaml` và bảng truy vết `docs/TRACEABILITY.md`.
- **E1-01 (Chờ duyệt):** Khởi tạo Next.js 16 (TypeScript `strict`), ESLint (quy tắc mục `6A.6`), `dependency-cruiser` (quy tắc phân lớp mục `6A.2`), Vitest, OpenAPI codegen (`schema.d.ts`), scripts DB và GitHub Actions CI; cập nhật lệnh chuẩn mục 10 trong `AGENTS.md` (`21,488` bytes).
- **E1-02 [RỦI RO CAO] (Chờ duyệt):** Triển khai Drizzle schema 18 bảng (`db/schema/*`), `PERMISSIONS` (18 quyền + 3 preset), `AppError`, `Config`, `Clock`, `Logger` lọc PII (`mssv`, `studentId*`, `email`, `pass`, `databaseUrl`, `token*`, `cookie*`, `Error.cause`), `Mailer`, `db` + `TransactionRunner`, `toErrorResponse` + header `x-request-id`, composition root (`createContainer`), 16 unit test + 2 integration test PostgreSQL.
- **E1-03 (Chờ duyệt):** Triển khai song ngữ `next-intl` (`messages/vi.json`, `messages/en.json`), `AppShell` fail-closed + mobile drawer accessible, `ErrorState` (403/404/500), `LanguageSwitch`, `QueryProvider` + `sonner`, `<Can>`/`usePermissions`, API client typed từ `openapi.yaml` (`schema.d.ts`), và 20 unit test frontend.
- **Kiểm tra & Audit độc lập E1:** `typecheck`, `lint`, `arch:check` (47 modules / 73 deps, 0 vi phạm), `openapi:check`, `test:unit` (9 file / 36 test xanh), `test:integration` (1 file / 2 test xanh trên `beam_test`), `next build` xanh, và `qa-reviewer` ngữ cảnh sạch đạt **`PASS`**.

## Đang thực hiện
- Không có tác vụ đang chạy; nhánh `feat/E1-foundation-and-architecture` sẵn sàng trình chủ dự án duyệt PR trước khi merge vào `main`.

## Đang bị chặn / câu hỏi cho chủ dự án
- Đang chờ chủ dự án:
  1. Duyệt PR Epic E1 (`feat/E1-foundation-and-architecture` — đánh dấu `[RỦI RO CAO]`) để merge vào `main`.
  2. Duyệt danh sách backlog item dự thảo cho **Epic E2 (`E2-01`, `E2-02`, `E2-03`)** trong `docs/BACKLOG.md` để triển khai xác thực MSSV & session.

## Việc tiếp theo
- Sau khi chủ dự án duyệt E1 và backlog E2: merge E1 vào `main`, tạo nhánh Epic E2 và chạy song song `backend-db` (`E2-01`) & `frontend` (`E2-02`) kèm `qa-reviewer` (`E2-03` / audit).

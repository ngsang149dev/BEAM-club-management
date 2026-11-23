# BACKLOG — Website quản lý thành viên & giao task CLB BEAM

## Tổng quan theo Epic

| Epic | Nội dung | FR / NFR chính | Trạng thái |
|---|---|---|---|
| **E0** | Thiết kế: Wireframe (0A), CSDL (0B), OpenAPI & truy vết (0C) | HANDOFF 11.2–11.5 | Done |
| **E1** | Nền tảng: Next.js, kiến trúc phân lớp + composition root, Drizzle, CI, i18n | NFR-02, NFR-10, 6A | In progress |
| **E2** | Xác thực bằng MSSV, session (`24h`/`30d`), rate limit, `returnTo` | FR-04, FR-11, FR-40, FR-41 | Backlog |
| **E3** | Thành viên & 20 ban (nhập tay, nhiều ban, khóa tài khoản) | FR-10, FR-13, FR-42, FR-43 | Backlog |
| **E4** | Phân quyền, `authorize`, 3 mẫu quyền, chống gỡ admin cuối, `audit_logs` | FR-12, FR-14–19 | Backlog |
| **E5** | Board, cột, task cơ bản, "Task của tôi" | FR-06, FR-20, FR-21, FR-23 | Backlog |
| **E6** | Kanban kéo thả (`@dnd-kit`), priority 1–4, lọc/tìm kiếm | FR-22, FR-25, FR-27 | Backlog |
| **E7** | Bình luận, cờ task ẩn (`404`, lọc mọi nơi) | FR-24, FR-07, FR-26 | Backlog |
| **E7A** | Lịch sử hoạt động (`task_events`), hoàn tác + toast 10s, xóa mềm & Thùng rác | FR-60, FR-61, FR-62 | Backlog |
| **E8** | Email nhắc deadline, cấu hình `app_settings`, Vercel Cron | FR-30, FR-31 | Backlog |
| **E9** | Hoàn thiện song ngữ, backup `pg_dump`, regression, UAT, tài liệu vận hành | FR-50, NFR-06, NFR-08 | Backlog |

---

## Epic E0 — Thiết kế trước khi viết mã

### E0-01
- **ID:** `E0-01`
- **Tiêu đề:** Đóng giai đoạn 0A — Chốt câu hỏi mở & cập nhật wireframe S15
- **Sub-agent phụ trách:** `Coordinator`
- **Liên quan:** HANDOFF mục 11.3, 14, `wireframes/OPEN-QUESTIONS.md` (`WQ-01..WQ-35`, `Q36–Q41`)
- **Phụ thuộc:** Không
- **Phạm vi file được sửa:** `wireframes/_build/screens/system.mjs`, `wireframes/s15-trash.html`, `docs/DECISIONS.md`
- **Tiêu chí chấp nhận:** Toàn bộ câu hỏi mở 0A được chốt; màn hình `S15` bỏ giả định tự dọn 30 ngày khớp `Q39`, bỏ nút Đổi mật khẩu ở `S08`, đồng bộ mã FR/AC/WQ.
- **Mức rủi ro:** Thường
- **Trạng thái:** `Done` (đã chốt và đạt kiểm tra độc lập `qa-reviewer`)

### E0-02
- **ID:** `E0-02`
- **Tiêu đề:** Giai đoạn 0B — Thiết kế CSDL PostgreSQL, ERD, migration & seed idempotent
- **Sub-agent phụ trách:** `backend-db` (viết) + `qa-reviewer` (đối chiếu độc lập)
- **Liên quan:** HANDOFF mục 8.1, 8.6, 8.8, 11.4; AC-09, AC-10, AC-22
- **Phụ thuộc:** `E0-01`
- **Mục tài liệu cần đọc:** `HANDOFF` mục 8.1, 8.2, 8.6, 8.8, 11.4
- **Phạm vi file được sửa:** `docs/ERD.md`, `db/migrations/0001_initial_schema.sql`, `db/seed.sql`
- **Tiêu chí chấp nhận:** Đủ 18 bảng, FK/index/unique chuẩn, trigger chống sửa/xóa `task_events` & `audit_logs`, trigger không đổi `student_id`, trigger luôn còn >= 1 admin hoạt động; migration chạy sạch trên `beam_dev` và `beam_test`; `seed.sql` chạy lại nhiều lần không lỗi với dữ liệu giả hoàn toàn.
- **Kiểm thử bắt buộc:** Script SQL trên `beam_test` kiểm tra tất cả trigger, unique, check constraint và idempotency của `seed.sql`.
- **Ngoài phạm vi:** Drizzle ORM TypeScript code (thuộc E1-02).
- **Mức rủi ro:** Cao
- **Trạng thái:** `Done` (chạy sạch 2 lần trên `beam_dev` & `beam_test`; toàn bộ 9 bất biến trigger/constraint đạt trên PostgreSQL 16 + audit `qa-reviewer`)

### E0-03
- **ID:** `E0-03`
- **Tiêu đề:** Giai đoạn 0C — Hợp đồng API `docs/openapi.yaml` & bảng truy vết `FR -> Màn hình -> Bảng -> Endpoint`
- **Sub-agent phụ trách:** `backend-db` (viết) + `qa-reviewer` (audit độc lập)
- **Liên quan:** HANDOFF mục 11.5, mọi `FR-01..FR-62`, `AC-01..AC-22`
- **Phụ thuộc:** `E0-02`
- **Mục tài liệu cần đọc:** `HANDOFF` mục 3.3, 4, 8.2, 8.8, 9, 11.5
- **Phạm vi file được sửa:** `docs/openapi.yaml`, `docs/TRACEABILITY.md`
- **Tiêu chí chấp nhận:** Mọi hành động trên wireframe có endpoint; mọi endpoint ghi nêu rõ quyền yêu cầu; schema `MemberPublicSummary` không chứa `studentId`/`email`; mọi endpoint đọc/lịch sử/thùng rác task nêu rõ `404` cho task ẩn; mọi Must FR có đủ 3 cột màn hình + bảng + endpoint trong `docs/TRACEABILITY.md`.
- **Kiểm thử bắt buộc:** Validate YAML cú pháp hợp lệ; audit chéo 100% FR/AC bởi `qa-reviewer`.
- **Ngoài phạm vi:** Triển khai Route Handlers (thuộc E2–E8).
- **Mức rủi ro:** Cao
- **Trạng thái:** `Done` (đạt audit độc lập `qa-reviewer` và kiểm tra YAML `$ref`)

---

## Epic E1 — Nền tảng & Khung kiến trúc *(Đã duyệt bởi chủ dự án)*

### E1-01
- **ID:** `E1-01`
- **Tiêu đề:** Khởi tạo Next.js (TypeScript strict), ESLint, `dependency-cruiser` & GitHub Actions CI
- **Sub-agent phụ trách:** `Coordinator` + `qa-reviewer`
- **Liên quan:** NFR-02, `AGENTS.md` mục 6, 6A.6, 6A.10
- **Phụ thuộc:** Cổng E0 được duyệt
- **Mục tài liệu cần đọc:** `HANDOFF` mục 7.1, 8.7, 11.6, 11.8
- **Phạm vi file được sửa:** `package.json`, `tsconfig.json`, `next.config.*`, `eslint.config.*`, `.dependency-cruiser.*`, `vitest.config.*`, `.github/workflows/ci.yml`
- **Tiêu chí chấp nhận:** `npm run typecheck`, `npm run lint`, `npm run arch:check`, `npm test` chạy xanh; CI chặn `any`, độ phức tạp > 10, hàm > 40 dòng, file > 300 dòng, import trái tầng hoặc vòng phụ thuộc.
- **Kiểm thử bắt buộc:** Smoke test Vitest + test quy tắc `dependency-cruiser` (bắt được import trái hướng).
- **Ngoài phạm vi:** Nghiệp vụ auth, bảng CSDL chi tiết, giao diện tính năng.
- **Mức rủi ro:** Thường
- **Trạng thái:** `Ready`

### E1-02
- **ID:** `E1-02`
- **Tiêu đề:** Lớp hạ tầng dùng chung (`db`, Drizzle schema, `Config`, `Clock`, `Logger`, `AppError`, `PERMISSIONS`, `composition.ts`)
- **Sub-agent phụ trách:** `backend-db` + `qa-reviewer` (review ngữ cảnh sạch)
- **Liên quan:** `AGENTS.md` mục 6A.3, 6A.4, Phụ lục A
- **Phụ thuộc:** `E1-01`
- **Mục tài liệu cần đọc:** `HANDOFF` mục 3.3, 8.1, 8.6, 8.7
- **Phạm vi file được sửa:** `db/schema/*`, `src/server/shared/*`, `src/lib/errors.ts`, `src/lib/permissions.ts`, `tests/unit/shared/*`
- **Tiêu chí chấp nhận:** Đủ 5 port (`Repository` base/TransactionRunner, `Mailer`, `Clock`, `Logger` lọc PII, `Config` validate env); `PERMISSIONS` khớp 100% 18 quyền; Drizzle schema khớp `0001_initial_schema.sql`; logger không bao giờ in `studentId`/`email`.
- **Kiểm thử bắt buộc:** Unit test cho `Config`, `Logger` (chặn PII), `AppError` mapping, `PERMISSIONS` registry.
- **Ngoài phạm vi:** Các use case đăng nhập, quản lý thành viên, task.
- **Mức rủi ro:** Cao
- **Trạng thái:** `Ready`

### E1-03
- **ID:** `E1-03`
- **Tiêu đề:** Khung đa ngôn ngữ `next-intl` (`vi`/`en`), layout shell & API client nền từ `openapi.yaml`
- **Sub-agent phụ trách:** `frontend` (làm song song được với `E1-02` vì không trùng vùng file)
- **Liên quan:** FR-50, NFR-07, NFR-10, `wireframes/components.html`, `s14-errors.html`
- **Phụ thuộc:** `E1-01`
- **Mục tài liệu cần đọc:** `HANDOFF` mục 8.7, 11.3, 11.9
- **Phạm vi file được sửa:** `messages/vi.json`, `messages/en.json`, `src/components/*`, `src/features/shared/*`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/error.tsx`, `src/app/not-found.tsx`
- **Tiêu chí chấp nhận:** Có đầy đủ bộ khóa `vi`/`en` khớp nhau; API client sinh kiểu từ `docs/openapi.yaml`; AppShell responsive + trang lỗi 403/404 chuẩn; chạy typecheck/lint/test xanh.
- **Kiểm thử bắt buộc:** Test kiểm tra đồng bộ key `vi.json` == `en.json` và test render component shell/error.
- **Ngoài phạm vi:** Màn hình login, board, quản trị chi tiết.
- **Mức rủi ro:** Thường
- **Trạng thái:** `Ready`

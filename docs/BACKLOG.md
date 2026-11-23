# BACKLOG — Website quản lý thành viên & giao task CLB BEAM

## Tổng quan theo Epic

| Epic | Nội dung | FR / NFR chính | Trạng thái |
|---|---|---|---|
| **E0** | Thiết kế: Wireframe (0A), CSDL (0B), OpenAPI & truy vết (0C) | HANDOFF 11.2–11.5 | Done |
| **E1** | Nền tảng: Next.js, kiến trúc phân lớp + composition root, Drizzle, CI, i18n | NFR-02, NFR-10, 6A | Done |
| **E2** | Xác thực bằng MSSV, session (`24h`/`30d`), rate limit, `returnTo` | FR-04, FR-11, FR-40, FR-41 | Chờ duyệt |
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

## Epic E1 — Nền tảng & Khung kiến trúc *(Đã duyệt và merge vào `main`)*

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
- **Trạng thái:** `Done` (CI/lint/typecheck/arch/openapi/build xanh + audit `qa-reviewer` PASS)

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
- **Trạng thái:** `Done` (16 unit test + 2 integration test PostgreSQL xanh + audit `qa-reviewer` PASS)

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
- **Trạng thái:** `Done` (20 unit test frontend + parity `vi`/`en` + `next build` xanh + audit `qa-reviewer` PASS)

---

## Epic E2 — Xác thực bằng MSSV & Session *(Chờ duyệt merge)*

### E2-01
- **ID:** `E2-01`
- **Tiêu đề:** Backend xác thực MSSV, session TTL (`24h`/`30d` trượt), giới hạn thử theo IP & `authorize` lõi
- **Sub-agent phụ trách:** `backend-db` + `qa-reviewer` (ngữ cảnh sạch)
- **Liên quan:** FR-04, FR-11, FR-12, FR-15, FR-40, FR-41, AC-01, AC-02, AC-05, AC-07, AC-12, AC-13, `WQ-09`, `WQ-15`
- **Phụ thuộc:** Epic E1 merged vào `main`
- **Mục tài liệu cần đọc:** `HANDOFF` mục 3.2, 8.2, 8.5, 8.6, 11.5 (`POST /auth/login`, `POST /auth/logout`, `GET /auth/session`, `GET /me`, `PATCH /me`)
- **Phạm vi file được sửa:** `src/server/modules/auth/*`, `src/server/shared/authorize.ts`, `src/server/shared/auth-http.ts`, `src/server/shared/http.ts`, `src/server/shared/composition.ts`, `src/lib/auth.ts`, `src/app/api/v1/auth/*`, `src/app/api/v1/me/route.ts`
- **Tiêu chí chấp nhận:** Đăng nhập chỉ bằng MSSV hợp lệ & `is_active=true` (thông báo lỗi chung nếu sai/khóa); giới hạn thử theo IP (`429`) + ghi `login_attempts`; cookie `HttpOnly`/`Secure`/`SameSite` hỗ trợ session cookie `24h` vs `30d` trượt (kèm gia hạn `Max-Age` khi dùng); đọc lại `is_active` + quyền từ DB mỗi request; `returnTo` chỉ cho path nội bộ hợp lệ; `GET/PATCH /me` trả `MemberDetail` cho chính chủ và cập nhật `profiles.locale`.
- **Kiểm thử bắt buộc (viết trước):** MSSV lạ (`AC-01`), tài khoản khóa (`AC-02`), rate limit IP (`AC-12`), session TTL 2 chế độ + trượt (`AC-05`, `AC-13`), thu hồi quyền hiệu lực ngay (`AC-07`), chống open-redirect `returnTo`, không lộ MSSV trong log/error.
- **Ngoài phạm vi:** Quản trị thành viên (`E3`), màn hình phân quyền (`E4`).
- **Mức rủi ro:** Cao
- **Trạng thái:** `Chờ duyệt` (hoàn tất trên nhánh `feat/E2-auth-and-session`; `typecheck`/`lint`/`arch:check`/`openapi:check`, 40 unit test backend/shared, 6 integration test auth trên PostgreSQL `beam_test`, và audit `qa-reviewer` PASS)

### E2-02
- **ID:** `E2-02`
- **Tiêu đề:** Giao diện đăng nhập `S01`, guard hết phiên, hồ sơ cơ bản `S08` & lưu ngôn ngữ (`PATCH /me`)
- **Sub-agent phụ trách:** `frontend` (chạy song song với `E2-01` dựa trên `docs/openapi.yaml`)
- **Liên quan:** FR-04, FR-40, FR-50, `S01`, `S08`, `S14`, `WQ-09`, `WQ-15`, `WQ-19`
- **Phụ thuộc:** Epic E1 merged vào `main` (`docs/openapi.yaml` đã khóa)
- **Mục tài liệu cần đọc:** `HANDOFF` mục 8.2, 11.3 (`S01`, `S08`), `wireframes/s01-login.html`, `wireframes/s08-profile.html`
- **Phạm vi file được sửa:** `src/features/auth/*`, `src/app/login/page.tsx`, `src/app/profile/page.tsx`, `src/app/globals.css`, `src/components/LanguageSwitch.tsx`, `src/components/AppShell.tsx`, `src/i18n/locale.ts`, `messages/vi.json`, `messages/en.json`
- **Tiêu chí chấp nhận:** Màn hình `S01` có 1 trường MSSV (`autocomplete="username"`), `<form method="post">`, ô "Ghi nhớ đăng nhập" mặc định không tích kèm dòng nhắc thiết bị cá nhân, hiển thị banner lỗi chung / `429` / hết phiên; kiểm tra `returnTo` nội bộ dùng chung `@/lib/auth`; `S08` chỉ hiển thị MSSV/email của chính chủ + quyền hiệu lực (suy từ `PERMISSIONS`) + đăng xuất; đổi ngôn ngữ đồng bộ `PATCH /me` trước khi ghi cookie & refresh và báo lỗi nếu thất bại.
- **Kiểm thử bắt buộc (viết trước):** Unit/component test form đăng nhập, `AuthGuard`, `LanguageSwitch`, `ProfileView`, `returnTo`, parity `vi`/`en`.
- **Ngoài phạm vi:** Trang danh sách thành viên (`E3`), trang phân quyền (`E4`).
- **Mức rủi ro:** Thường
- **Trạng thái:** `Chờ duyệt` (hoàn tất trên nhánh `feat/E2-auth-and-session`; 43 unit test frontend + `next build` xanh + audit `qa-reviewer` PASS)

### E2-03
- **ID:** `E2-03`
- **Tiêu đề:** Kiểm thử tích hợp & E2E cho Auth/Session và review độc lập `[RỦI RO CAO]`
- **Sub-agent phụ trách:** `qa-reviewer` (ngữ cảnh sạch)
- **Liên quan:** `AC-01`, `AC-02`, `AC-05`, `AC-07`, `AC-12`, `AC-13`, `AGENTS.md` mục 8
- **Phụ thuộc:** `E2-01`, `E2-02`
- **Mục tài liệu cần đọc:** `HANDOFF` mục 8.2, 9; `docs/openapi.yaml` (`/auth/*`, `/me`)
- **Phạm vi file được sửa:** `playwright.config.ts`, `tests/unit/auth/*`, `tests/unit/shared/*`, `tests/integration/auth/*`, `tests/e2e/auth.spec.ts`
- **Tiêu chí chấp nhận:** Phủ 100% test bắt buộc cho auth/session (`AC-01`, `AC-02`, `AC-05`, `AC-07`, `AC-12`, `AC-13`, `returnTo` open-redirect, PII log check); audit checklist `6A.8` đạt `PASS`.
- **Kiểm thử bắt buộc:** Vitest unit/integration trên `beam_test` + Playwright E2E Chrome luồng login/logout/session.
- **Ngoài phạm vi:** Sửa mã nghiệp vụ trực tiếp (nếu lỗi thì báo Coordinator giao tác giả sửa).
- **Mức rủi ro:** Cao
- **Trạng thái:** `Chờ duyệt` (83 unit test / 18 file + 8 integration test PostgreSQL / 3 file + 4 E2E Chrome trên `beam_test` xanh; `qa-reviewer` ngữ cảnh sạch ra kết luận `PASS` sau khi khắc phục 6 Major & 5 Minor)

---

## Dự thảo Epic E3 — Thành viên & 20 ban *(Chờ chủ dự án duyệt)*

### E3-01
- **ID:** `E3-01`
- **Tiêu đề:** Backend quản lý Thành viên & Ban (`members`, `departments`, che MSSV/email, audit)
- **Sub-agent phụ trách:** `backend-db` + `qa-reviewer` (ngữ cảnh sạch)
- **Liên quan:** `FR-10`, `FR-13`, `FR-19`, `FR-42`, `FR-43`, `AC-09`, `AC-11`, `AC-14`, `WQ-10`, `WQ-21`
- **Phụ thuộc:** Epic E2 merged vào `main`
- **Mục tài liệu cần đọc:** `HANDOFF` mục 3.2, 3.3, 4.1 (`FR-10`, `FR-13`, `FR-19`, `FR-42`, `FR-43`), 8.1, 8.6, 11.5 (`GET/POST /members`, `GET/PATCH /members/{id}`, `POST /members/{id}/deactivate`, `POST /members/{id}/activate`, `GET/POST /departments`, `PATCH/DELETE /departments/{id}`)
- **Phạm vi file được sửa:** `src/lib/members.ts` (hoặc schema dùng chung), `src/server/modules/members/*`, `src/server/modules/departments/*`, `src/server/shared/composition.ts`, `src/app/api/v1/members/*`, `src/app/api/v1/departments/*`, `tests/unit/members/*`, `tests/unit/departments/*`, `tests/integration/members/*`, `tests/integration/departments/*`
- **Tiêu chí chấp nhận:** Mọi endpoint qua `authorize`; mapper tách biệt `MemberPublicSummary` (không chứa `studentId`/`email`) và `MemberDetail` (chỉ khi có `member.view_detail`, `AC-11`); tạo/sửa thành viên kiểm tra `@eiu.edu.vn` từ `Config.allowedEmailDomain` (`AC-14`); `studentId` không đổi sau khi tạo (`WQ-21`); tạo thành viên mới tự cấp `DEFAULT_MEMBER_PERMISSIONS` (`FR-19`); khóa thành viên thu hồi mọi `sessions` hoạt động + chặn khóa admin hoạt động cuối (`409`, `AC-09`); xóa ban đang có thành viên hoặc board trả `409` (`WQ-10`); mọi thao tác quản trị ghi `audit_logs` trong cùng transaction.
- **Kiểm thử bắt buộc (viết trước):** Allow/deny 6 mã quyền (`member.view`, `member.view_detail`, `member.create`, `member.update`, `member.deactivate`, `department.manage`), che MSSV/email (`AC-11`), chặn email sai domain (`AC-14`), chặn gỡ/khóa admin cuối (`AC-09`), khóa ban đang dùng (`409`), không đổi `studentId`, thu hồi session khi khóa, kiểm tra `audit_logs` & không lộ PII trong log.
- **Ngoài phạm vi:** Màn hình phân quyền & áp mẫu quyền (`E4`), board/task (`E5`).
- **Mức rủi ro:** Cao
- **Trạng thái:** `Backlog`

### E3-02
- **ID:** `E3-02`
- **Tiêu đề:** Giao diện danh sách thành viên `S07`, quản trị thành viên `S09` & quản trị ban `S11`
- **Sub-agent phụ trách:** `frontend` (có thể chạy song song với `E3-01` dựa trên `docs/openapi.yaml` đã khóa)
- **Liên quan:** `FR-10`, `FR-13`, `FR-42`, `FR-43`, `FR-50`, `S07`, `S09`, `S11`, `WQ-10`, `WQ-21`
- **Phụ thuộc:** Epic E2 merged vào `main` (`docs/openapi.yaml` đã khóa)
- **Mục tài liệu cần đọc:** `HANDOFF` mục 11.3 (`S07`, `S09`, `S11`), `wireframes/s07-members.html`, `wireframes/s09-member-admin.html`, `wireframes/s11-departments.html`
- **Phạm vi file được sửa:** `src/features/members/*`, `src/features/departments/*`, `src/app/members/page.tsx`, `src/app/admin/members/page.tsx`, `src/app/admin/departments/page.tsx`, `src/app/globals.css`, `messages/vi.json`, `messages/en.json`, `tests/unit/frontend/*`
- **Tiêu chí chấp nhận:** `S07` lọc theo ban/trạng thái & chỉ hiện cột MSSV/email khi có `member.view_detail` + gắn nhãn `"(đã rời)"` với `isActive=false`; `S09` thêm thành viên nhập tay (hiển thị chú thích MSSV không đổi sau khi tạo), gán nhiều ban, sửa thông tin, khóa/mở tài khoản + thông báo `409` khi khóa admin cuối; `S11` tạo/đổi tên/xóa ban + thông báo `409` khi ban còn thành viên/board; 100% chuỗi UI qua `messages/{vi,en}.json`.
- **Kiểm thử bắt buộc (viết trước):** Unit/component test `S07` ẩn MSSV/email & nhãn `"(đã rời)"`, `S09` khóa trường `studentId` khi sửa & validate email, `S11` xử lý `409`, kiểm tra parity `vi`/`en`.
- **Ngoài phạm vi:** Màn hình phân quyền `S10` & nhật ký `S13` (`E4`).
- **Mức rủi ro:** Thường
- **Trạng thái:** `Backlog`

### E3-03
- **ID:** `E3-03`
- **Tiêu đề:** Kiểm thử tích hợp, E2E & review độc lập Epic E3 `[RỦI RO CAO]`
- **Sub-agent phụ trách:** `qa-reviewer` (ngữ cảnh sạch)
- **Liên quan:** `AC-09`, `AC-11`, `AC-14`, `FR-10`, `FR-13`, `FR-19`, `FR-42`, `FR-43`, `AGENTS.md` mục 8
- **Phụ thuộc:** `E3-01`, `E3-02`
- **Mục tài liệu cần đọc:** `HANDOFF` mục 8.1, 8.6, 9; `docs/openapi.yaml` (`/members*`, `/departments*`)
- **Phạm vi file được sửa:** `tests/unit/members/*`, `tests/unit/departments/*`, `tests/integration/members/*`, `tests/integration/departments/*`, `tests/e2e/members-departments.spec.ts`
- **Tiêu chí chấp nhận:** Đủ test allow/deny từng mã quyền (`member.*`, `department.manage`), tích hợp PostgreSQL `beam_test` + E2E Chrome luồng `S07`/`S09`/`S11` (bao gồm `AC-09`, `AC-11`, `AC-14`, `WQ-10`), audit checklist `6A.8` đạt `PASS`.
- **Kiểm thử bắt buộc:** Vitest unit/integration trên `beam_test` + Playwright E2E Chrome.
- **Ngoài phạm vi:** Sửa mã nghiệp vụ trực tiếp.
- **Mức rủi ro:** Cao
- **Trạng thái:** `Backlog`

# BACKLOG — Website quản lý thành viên & giao task CLB BEAM

## Tổng quan theo Epic

| Epic | Nội dung | FR / NFR chính | Trạng thái |
|---|---|---|---|
| **E0** | Thiết kế: Wireframe (0A), CSDL (0B), OpenAPI & truy vết (0C) | HANDOFF 11.2–11.5 | Done |
| **E1** | Nền tảng: Next.js, kiến trúc phân lớp + composition root, Drizzle, CI, i18n | NFR-02, NFR-10, 6A | Done |
| **E2** | Xác thực bằng MSSV, session (`24h`/`30d`), rate limit, `returnTo` | FR-04, FR-11, FR-40, FR-41 | Done |
| **E3** | Thành viên & 20 ban (nhập tay, nhiều ban, khóa tài khoản) | FR-10, FR-13, FR-42, FR-43 | Done |
| **E4** | Phân quyền, `authorize`, 3 mẫu quyền, chống gỡ admin cuối, `audit_logs` | FR-12, FR-14–19 | Done |
| **E5** | Board, cột, task, kéo thả `@dnd-kit`, UI Hồng–Trắng–Đen, "Task của tôi" | FR-06, FR-20–23 | Done |
| **CR-01** | Mật khẩu đăng nhập cho toàn bộ tài khoản (`A4`, `[RỦI RO CAO]`) | Nâng cấp `FR-04` | Done |
| **CR-02** | Logo CLB & Ảnh đại diện thành viên (PostgreSQL <= 256 KB, chữ cái đầu đa sắc, `A1`) + siết đặt lại mật khẩu chỉ Admin | Nâng cấp `S02`/`S08`/`S09` | Done |
| **CR-02B** | Vào thẳng `/login` ở `/`, chặn Admin tự gỡ quyền Admin, và căn chỉnh bố cục toàn hệ thống (`S03`–`S10`) | Hoàn thiện UX & Bảo mật | Done |
| **CR-04** | Kho lưu trữ tập trung (Archive): Task, User & Board + tự dọn 7/30/90 ngày, xóa vĩnh viễn, khôi phục (`A1`–`A5`, `[RỦI RO CAO]`) | Nâng cấp `Q39`, `S15` | Done |
| **CR-03** | Giao task cho Ban (`task_departments`) + Email & Thông báo chuông (`A2`, `A3`, `[RỦI RO CAO]`) | Nâng cấp `FR-20`–`23` | Done |
| **CR-05** | Tinh gọn UX: bỏ chọn ngôn ngữ ở Hồ sơ, ẩn thành viên đã rời ở Phân quyền, gọn lời giải thích tự nhiên, làm đẹp ô `select` | Hoàn thiện UX & UI | Done |
| **CR-06** | Thiết kế lại trình chỉnh sửa Task 2 cột (`~900px` / modal `720px`) & tách riêng tùy chọn Thông báo trên web / Email cho cả Ban & thành viên lẻ (`A1`–`A3`, `[RỦI RO CAO]`) | Nâng cấp `S04`, `S05`, `CR-03` | Done |
| **E6** | Lọc & tìm kiếm board/task nâng cao; nút chuyển cột bàn phím/mobile (kéo thả & priority 1–4 đã giao trong E5) | FR-22, FR-25, FR-27 | Done |
| **CR-07** | Trang Quản trị Giao diện CLB (`/admin/branding`) & Khung treo ảnh Polaroid động trang Login Desktop (`A1`–`A4`, `[RỦI RO CAO]`) | Nâng cấp `S01`/`CR-02` | Done |
| **E7** | Bình luận, cờ task ẩn (`404`, lọc mọi nơi) | FR-24, FR-07, FR-26 | Done |
| **E7A** | Lịch sử hoạt động (`task_events`), hoàn tác + toast 10s (phần Thùng rác `S15` nâng cấp thành Kho Archive ở `CR-04`) | FR-60, FR-61, FR-62 | Done |
| **E8** | Email nhắc deadline, cấu hình `app_settings`, Vercel Cron | FR-02, FR-30, FR-31 | Done |
| **E9** | Hoàn thiện song ngữ, backup `pg_dump`, regression, UAT, tài liệu vận hành | FR-50, NFR-06, NFR-08 | Done |
| **E10** | Chuẩn bị Go-Live Production miễn phí (Vercel + Neon), migration danh mục quyền `0007`, CLI tạo Admin đầu tiên, kiểm chứng SMTP & GitHub Cron dự phòng | HANDOFF §7, §9, §10, NFR-08 | Chờ duyệt danh sách item |

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

## Epic E2 — Xác thực bằng MSSV & Session *(Done, đã merge vào `main`)*

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
- **Trạng thái:** `Done` (hoàn tất trên `feat/E2-auth-and-session` & đã merge vào `main`; `typecheck`/`lint`/`arch:check`/`openapi:check`, 40 unit test backend/shared, 6 integration test auth trên PostgreSQL `beam_test`, và audit `qa-reviewer` PASS)

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
- **Trạng thái:** `Done` (hoàn tất trên `feat/E2-auth-and-session` & đã merge vào `main`; 43 unit test frontend + `next build` xanh + audit `qa-reviewer` PASS)

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
- **Trạng thái:** `Done` (83 unit test / 18 file + 8 integration test PostgreSQL / 3 file + 4 E2E Chrome trên `beam_test` xanh; `qa-reviewer` ngữ cảnh sạch ra kết luận `PASS` sau khi khắc phục 6 Major & 5 Minor)

---

## Epic E3 — Thành viên & 20 ban *(Done — đã duyệt & merge vào main)*

### E3-01
- **ID:** `E3-01`
- **Tiêu đề:** Backend quản lý Thành viên & Ban (`members`, `departments`, che MSSV/email, audit)
- **Sub-agent phụ trách:** `backend-db` + `qa-reviewer` (ngữ cảnh sạch)
- **Liên quan:** `FR-10`, `FR-13`, `FR-19`, `FR-42`, `FR-43`, `AC-09`, `AC-11`, `AC-14`, `WQ-10`, `WQ-21`
- **Phụ thuộc:** Epic E2 merged vào `main`
- **Mục tài liệu cần đọc:** `HANDOFF` mục 3.2, 3.3, 4.1 (`FR-10`, `FR-13`, `FR-19`, `FR-42`, `FR-43`), 8.1, 8.6, 11.5 (`GET/POST /members`, `GET/PATCH /members/{id}`, `POST /members/{id}/deactivate`, `POST /members/{id}/activate`, `GET/POST /departments`, `PATCH/DELETE /departments/{id}`)
- **Phạm vi file được sửa:** `src/lib/members.ts`, `src/server/modules/audit/*`, `src/server/modules/members/*`, `src/server/modules/departments/*`, `src/server/shared/auth-http.ts`, `src/server/shared/composition.ts`, `src/app/api/v1/members/*`, `src/app/api/v1/departments/*`, `tests/unit/members/*`, `tests/unit/departments/*`, `tests/integration/members/*`, `tests/integration/departments/*`
- **Tiêu chí chấp nhận:** Mọi endpoint qua `authorize`; mapper tách biệt `MemberPublicSummary` (không chứa `studentId`/`email`) và `MemberDetail` (chỉ khi có `member.view_detail`, `AC-11`); tạo/sửa thành viên kiểm tra `@eiu.edu.vn` từ `Config.allowedEmailDomain` (`AC-14`); `studentId` không đổi sau khi tạo (`WQ-21`); tạo thành viên mới tự cấp `DEFAULT_MEMBER_PERMISSIONS` (`FR-19`); khóa thành viên thu hồi mọi `sessions` hoạt động + chặn khóa admin hoạt động cuối (`409`, `AC-09`); xóa ban đang có thành viên hoặc board trả `409` (`WQ-10`); mọi thao tác quản trị ghi `audit_logs` trong cùng transaction.
- **Kiểm thử bắt buộc (viết trước):** Allow/deny 6 mã quyền (`member.view`, `member.view_detail`, `member.create`, `member.update`, `member.deactivate`, `department.manage`), che MSSV/email (`AC-11`), chặn email sai domain (`AC-14`), chặn gỡ/khóa admin cuối (`AC-09`), khóa ban đang dùng (`409`), không đổi `studentId`, thu hồi session khi khóa, kiểm tra `audit_logs` & không lộ PII trong log.
- **Ngoài phạm vi:** Màn hình phân quyền & áp mẫu quyền (`E4`), board/task (`E5`).
- **Mức rủi ro:** Cao
- **Trạng thái:** `Done` (đã đạt 116 unit test / 24 tệp, 10 integration test PostgreSQL / 5 tệp, `arch:check` 108/354)

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
- **Trạng thái:** `Done` (đã đạt unit test UI + parity key/ICU `vi`/`en`, `build` 18 route, Chrome E2E `7/7`)

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
- **Trạng thái:** `Done` (`qa-reviewer` `PASS`, 116 unit / 24 tệp + 10 integration PostgreSQL / 5 tệp + 7 Chrome E2E xanh)

---

## Epic E4 — Phân quyền, 3 mẫu quyền, chống gỡ admin cuối & Nhật ký quản trị *(Done — đã duyệt & merge vào main)*

### E4-01
- **ID:** `E4-01`
- **Tiêu đề:** Backend quản trị phân quyền, 3 mẫu quyền (`WQ-06`), cờ admin & `GET /audit-logs` `[RỦI RO CAO]`
- **Sub-agent phụ trách:** `backend-db` + `qa-reviewer` (ngữ cảnh sạch)
- **Liên quan:** `FR-12`, `FR-14`–`FR-19`, `AC-07`, `AC-08`, `AC-09`, `AC-10`, `WQ-06`, `WQ-07`, `WQ-24`
- **Phụ thuộc:** Epic E3 merged vào `main` (`docs/openapi.yaml` đã khóa)
- **Mục tài liệu cần đọc:** `HANDOFF` mục 3.3, 4.1 (`FR-12`, `FR-14`–`FR-19`), 8.1, 11.5 (`GET /permissions`, `GET/PUT /members/{id}/permissions`, `GET /permission-presets`, `POST /members/{id}/permissions/apply-preset`, `PUT /members/{id}/admin`, `GET /audit-logs`); `docs/openapi.yaml`
- **Phạm vi file được sửa:** `src/lib/permissions.ts`, `src/server/modules/permissions/*`, `src/server/modules/audit/*`, `src/server/shared/composition.ts`, `src/app/api/v1/permissions/**`, `src/app/api/v1/permission-presets/**`, `src/app/api/v1/members/[id]/permissions/**`, `src/app/api/v1/members/[id]/admin/**`, `src/app/api/v1/audit-logs/**`, `tests/unit/permissions/*`, `tests/unit/audit/*`, `tests/integration/permissions/*`, `tests/integration/audit/*`
- **Tiêu chí chấp nhận:** Chỉ admin (`is_admin=true`) mới truy cập 6 endpoint phân quyền (`member.update` nhận `403`, `AC-08`); thay bộ quyền (`PUT`) hoặc áp mẫu (`basic_member`/`department_lead`/`hr_manager` theo `WQ-06`) thay thế toàn bộ `user_permissions` và ghi `audit_logs` trong cùng transaction (`AC-10`), có hiệu lực ngay ở request kế tiếp (`FR-15`, `AC-07`); `PUT /members/{id}/admin` bảo vệ trong transaction + trigger CSDL chặn gỡ admin hoạt động cuối (`409 LAST_ACTIVE_ADMIN`, `AC-09`); `GET /audit-logs` kiểm tra quyền `audit.view`, lọc cursor và không lộ PII (`studentId`/`email`) trong log detail.
- **Kiểm thử bắt buộc (viết trước):** Allow/deny quyền admin & `audit.view`, `AC-07` thu hồi quyền có hiệu lực ngay, `AC-08` `member.update` bị chặn `403`, `AC-09` gỡ admin cuối `409`, `AC-10` ghi đủ diff cấp/thu hồi trong `audit_logs`, `WQ-06` thay thế toàn bộ khi áp mẫu.
- **Ngoài phạm vi:** Board & task (`E5`).
- **Mức rủi ro:** Cao
- **Trạng thái:** `Done` (đã đạt 138 unit test / 28 tệp, 12 integration test PostgreSQL / 7 tệp, `arch:check` 138/501)

### E4-02
- **ID:** `E4-02`
- **Tiêu đề:** Giao diện Phân quyền `S10` & Nhật ký quản trị `S13`
- **Sub-agent phụ trách:** `frontend` (chạy song song với `E4-01` sau khi khóa `src/lib/permissions.ts` & `docs/openapi.yaml`)
- **Liên quan:** `FR-14`, `FR-16`, `FR-17`, `FR-18`, `FR-19`, `WQ-06`, `WQ-07`, `S10`, `S13`
- **Phụ thuộc:** Epic E3 merged vào `main` (`docs/openapi.yaml` đã khóa)
- **Mục tài liệu cần đọc:** `HANDOFF` mục 3.3, 11.3 (`S10`, `S13`), `wireframes/s10-permissions.html`, `wireframes/s13-audit.html`
- **Phạm vi file được sửa:** `src/features/permissions/*`, `src/features/audit/*`, `src/app/admin/permissions/page.tsx`, `src/app/admin/audit/page.tsx`, `src/app/globals.css`, `messages/vi.json`, `messages/en.json`, `tests/unit/frontend/*`
- **Tiêu chí chấp nhận:** `S10` hiển thị danh mục 18 quyền theo nhóm, chọn áp 3 mẫu (`basic_member`, `department_lead`, `hr_manager`) kèm hộp thoại xác nhận nêu rõ số quyền thêm/bỏ khi thay thế toàn bộ (`WQ-06`), bật/tắt cờ admin kèm thông báo `409` nếu là admin cuối (`WQ-07`), bảng tóm tắt "quyền hiệu lực"; `S13` hiển thị nhật ký phân trang cursor cho `audit.view` (lọc theo hành động/đối tượng); 100% chuỗi UI qua `messages/{vi,en}.json`.
- **Kiểm thử bắt buộc (viết trước):** Unit/component test `S10` (chọn quyền, xác nhận đếm thêm/bỏ khi áp mẫu, lỗi `409` admin cuối, màn hình `403` cho non-admin) & `S13` (`audit.view` allow/403), parity `vi`/`en` + ICU placeholder.
- **Ngoài phạm vi:** Màn hình board/task (`E5`).
- **Mức rủi ro:** Trung bình
- **Trạng thái:** `Done` (đã đạt unit test UI + parity key/ICU `vi`/`en`, `build` 26 route, Chrome E2E `10/10`)

### E4-03
- **ID:** `E4-03`
- **Tiêu đề:** Kiểm thử tích hợp, E2E & review độc lập Epic E4 `[RỦI RO CAO]`
- **Sub-agent phụ trách:** `qa-reviewer` (ngữ cảnh sạch)
- **Liên quan:** `AC-07`, `AC-08`, `AC-09`, `AC-10`, `WQ-06`, `WQ-07`, `AGENTS.md` mục 8
- **Phụ thuộc:** `E4-01`, `E4-02`
- **Mục tài liệu cần đọc:** `HANDOFF` mục 8.1, 9; `docs/openapi.yaml` (`/permissions`, `/permission-presets`, `/members/{id}/permissions*`, `/members/{id}/admin`, `/audit-logs`)
- **Phạm vi file được sửa:** `tests/unit/permissions/*`, `tests/unit/audit/*`, `tests/integration/permissions/*`, `tests/integration/audit/*`, `tests/e2e/permissions-audit.spec.ts`
- **Tiêu chí chấp nhận:** Đủ test allow/deny, `AC-07` (thu hồi `board.create` có hiệu lực ngay không cần đăng nhập lại), `AC-08` (chặn `member.update` tự cấp quyền), `AC-09` (chặn gỡ admin cuối `409`), `AC-10` (`audit_logs`), `WQ-06` (thay thế toàn bộ), Playwright Chrome E2E `S10`/`S13`, và review ngữ cảnh sạch toàn bộ Epic E4 theo checklist `6A.8` đạt `PASS`.
- **Kiểm thử bắt buộc:** Vitest unit/integration trên `beam_test` + Playwright E2E Chrome.
- **Ngoài phạm vi:** Sửa mã nghiệp vụ trực tiếp.
- **Mức rủi ro:** Cao
- **Trạng thái:** `Done` (`qa-reviewer` `PASS`, 138 unit / 28 tệp + 12 integration PostgreSQL / 7 tệp + 10 Chrome E2E xanh)

---

## Epic E5 — Board, Cột, Task, Kéo thả `@dnd-kit`, UI Polish & "Task của tôi" *(Done — đã duyệt & merge vào main)*

### E5-01
- **ID:** `E5-01`
- **Tiêu đề:** Backend Boards, Columns, Tasks, Move (`POST /tasks/{id}/move`), Assignees & "Task của tôi" (`task_events` + `taskVisibilityPolicy`) `[RỦI RO CAO]`
- **Sub-agent phụ trách:** `backend-db` + `qa-engineer` (ngữ cảnh sạch)
- **Liên quan:** `FR-06`, `FR-20`, `FR-21`, `FR-22`, `FR-23`, `AC-06`, `WQ-03`, `WQ-05`, `WQ-18`
- **Phụ thuộc:** Epic E4 merged vào `main` (`docs/openapi.yaml` đã khóa)
- **Mục tài liệu cần đọc:** `HANDOFF` mục 3.4, 4.1 (`FR-06`, `FR-20`–`FR-23`), 8.3, 11.5 (`GET/POST /boards`, `GET/PATCH/DELETE /boards/{id}`, `POST /boards/{id}/columns`, `PATCH/DELETE /columns/{id}`, `PUT /boards/{id}/columns/order`, `GET/POST /tasks`, `GET/PATCH/DELETE /tasks/{id}`, `POST /tasks/{id}/move`, `PUT /tasks/{id}/assignees`, `GET /me/tasks`); `docs/openapi.yaml`
- **Phạm vi file được sửa:** `db/seed.sql`, `src/lib/boards.ts`, `src/lib/tasks.ts`, `src/server/modules/boards/*`, `src/server/modules/tasks/*`, `src/server/shared/composition.ts`, `src/app/api/v1/boards/**`, `src/app/api/v1/columns/**`, `src/app/api/v1/tasks/**`, `src/app/api/v1/me/tasks/**`, `tests/unit/shared/boards-tasks.test.ts`, `tests/unit/boards/*`, `tests/unit/tasks/*`, `tests/integration/boards/*`, `tests/integration/tasks/*`
- **Tiêu chí chấp nhận:** Nguồn sự thật `taskVisibilityPolicy` lọc `deleted_at IS NULL` & `is_hidden` ở mọi truy vấn list/detail/count/`move`/`/me/tasks`; tạo board tự tạo 4 cột mặc định (`Todo`, `Doing`, `Review`, `Done`); xóa cột đang còn task trả `409 COLUMN_NOT_EMPTY` (`WQ-05`); mọi thao tác ghi task qua `authorize` (`AC-06`: thiếu `task.create` nhận `403`, `task.update_assigned` chỉ sửa/kéo thả task được giao, chặn gán mới thành viên đã rời `400 INVALID_ASSIGNEE_IDS`); `POST /tasks/{id}/move` tính `position` & tự rebalance khi gap `< 0.001` kèm kiểm tra `version` (`409`); ghi `task_events` append-only và trả `eventId`; DTO không lộ MSSV/email; `db/seed.sql` cập nhật tên ban UTF-8 sạch.
- **Kiểm thử bắt buộc:** Allow/deny mọi mã quyền `board.*`, `task.create`, `task.assign`, `task.update_any`, `task.update_assigned`, `task.delete`; `409` xóa cột còn task (`WQ-05`); `taskVisibilityPolicy` `404` & lọc `deleted_at IS NULL`; rebalance vị trí & `task_events` append-only.
- **Mức rủi ro:** Cao
- **Trạng thái:** `Done` (đạt `arch:check` `190/796`, unit test backend/shared, và `15 integration test PostgreSQL / 10 tệp` trên `beam_test`)

### E5-02
- **ID:** `E5-02`
- **Tiêu đề:** Giao diện Boards `S03`, Kanban kéo thả `S04`, Chi tiết Task `S05`, "Task của tôi" `S06` & Bộ màu Hồng–Trắng–Đen
- **Sub-agent phụ trách:** `frontend` + `qa-engineer` (ngữ cảnh sạch)
- **Liên quan:** `FR-06`, `FR-20`–`FR-23`, `S03`, `S04`, `S05`, `S06`, `WQ-03`, `WQ-05`, `WQ-12`
- **Phụ thuộc:** Epic E4 merged vào `main` (`docs/openapi.yaml` đã khóa)
- **Mục tài liệu cần đọc:** `HANDOFF` mục 11.3 (`S03`–`S06`), `wireframes/s03-boards.html`–`s06-my-tasks.html`
- **Phạm vi file được sửa:** `src/app/globals.css`, `src/app/boards/**`, `src/app/my-tasks/page.tsx`, `src/features/boards/*`, `src/features/tasks/*`, `src/features/audit/formatters.ts`, `messages/vi.json`, `messages/en.json`, `tests/unit/frontend/*`
- **Tiêu chí chấp nhận:** Bộ màu Hồng–Trắng–Đen (`Crisp Editorial Pop`) kèm animation, căn giữa & phóng to desktop, board `/boards/[id]` full-width; `S03`/`S04` gộp nút hành động vào menu `⋯` (`ActionMenu`) theo quyền `board.*`, hỗ trợ kéo thả `@dnd-kit` cả **task** lẫn **cột** (giữ click `< 6px` mở Drawer `S05`); `S05` nhập hạn theo ngày `00:00 UTC+7` (`WQ-12`), cho phép bỏ gán thành viên đã rời, nhấn mạnh Priority `1–4` & hạn chót (`overdue`/`today`/`soon`), sửa race condition xóa task không làm treo Drawer ở `404`; `S06` (`/my-tasks`) mặc định ẩn task cột cuối (`WQ-03`); 100% chuỗi UI qua `messages/{vi,en}.json`.
- **Kiểm thử bắt buộc:** Unit/component test `S03`–`S06`, `board-dnd-helpers`, `getTaskDueUrgency`, parity `vi`/`en` + ICU placeholder.
- **Mức rủi ro:** Trung bình
- **Trạng thái:** `Done` (đạt `167 unit test / 36 tệp`, `typecheck`, `lint`, `build` 37 route)

### E5-03
- **ID:** `E5-03`
- **Tiêu đề:** Kiểm thử tích hợp, E2E Chrome & review độc lập Epic E5 `[RỦI RO CAO]`
- **Sub-agent phụ trách:** `qa-engineer` (ngữ cảnh sạch)
- **Liên quan:** `AC-06`, `FR-06`, `FR-20`–`FR-23`, `FR-42`, `WQ-03`, `WQ-05`, `WQ-12`, `AGENTS.md` mục 8
- **Phụ thuộc:** `E5-01`, `E5-02`
- **Phạm vi file được sửa:** `tests/e2e/boards-tasks.spec.ts`, `tests/e2e/members-departments.spec.ts`, `tests/unit/{boards,tasks}/*`, `tests/integration/{boards,tasks}/*`
- **Tiêu chí chấp nhận:** Đủ test allow/deny mọi mã quyền board/task, `AC-06` (`403`), hidden task (`404`), `WQ-05` (`409`), `409 TASK_VERSION_CONFLICT`, `task_events` append-only không PII, Playwright Chrome E2E toàn hệ thống xanh, và review ngữ cảnh sạch checklist `6A.8` đạt `PASS`.
- **Mức rủi ro:** Cao
- **Trạng thái:** `Done` (`qa-engineer` **`VERDICT: PASS`**: 37 route `next build`, 167 unit / 36 tệp, 15 integration PostgreSQL / 10 tệp, **13/13 Chrome E2E** qua cả 4 spec)

---

## Đợt yêu cầu thay đổi sau E5 *(Theo thứ tự quyết định của chủ dự án: `CR-01` -> `CR-02` -> `CR-02B` -> `CR-04` -> `CR-03`)*

### CR-01 (`[RỦI RO CAO]`): Đăng nhập bằng mật khẩu cho toàn bộ tài khoản (`A4`, `A5`) *(Done — đã duyệt & merge vào `main`)*
- **`CR-01-01` (`backend-db`, `[RỦI RO CAO]` — `Done`):** Cập nhật `docs/DECISIONS.md`, `docs/openapi.yaml`, `docs/ERD.md`, migration `0002_passwords.sql` (cột `password_hash`, `must_change_password` trên `profiles`), `src/server/shared/password.ts` (`crypto.scrypt` + `timingSafeEqual` + `DUMMY_PASSWORD_HASH`), `POST /auth/login` kiểm tra mật khẩu + giữ rate limit, `POST /members` cấp `initialPassword` (hoặc `Config.defaultInitialPassword` ở non-prod), thêm `POST /me/password` (`400 INVALID_CURRENT_PASSWORD`, giữ session hiện tại và thu hồi session khác), thêm `POST /members/{id}/reset-password` (Admin hoặc `member.update` trên tài khoản thường; chặn `403` nếu không phải admin đặt lại cho admin, thu hồi toàn bộ session & ghi `audit_logs` `'member.password_reset'`), cập nhật `db/seed.sql` (`BeamDev@2026`).
- **`CR-01-02` (`frontend` — `Done`):** Thêm ô nhập mật khẩu kèm nút ẩn/hiện tại `S01` (`LoginForm` & `PasswordInput`, tự chuyển tới `/profile?changePassword=1` khi `mustChangePassword=true` và không có `returnTo` hợp lệ), nhập/sinh `initialPassword` khi tạo thành viên mới & modal Đặt lại mật khẩu có che theo quyền tại `S09`, và `ChangePasswordCard` + banner nhắc đổi mật khẩu ổn định vị trí DOM tại `S08` (`/profile`), đủ chuỗi `vi`/`en`.
- **`CR-01-03` (`qa-engineer`, `[RỦI RO CAO]` — `Done`):** `typecheck`, `lint`, `arch:check` (`200` module / `856` phụ thuộc), `openapi:check`, `184` unit test / `37` tệp, `16` integration PostgreSQL / `10` tệp, `next build` (`26/26` page/route), **`15/15` Chrome E2E**, và audit `6A.8` đạt **`VERDICT: PASS`**.

### CR-02: Logo CLB, Ảnh đại diện thành viên & Siết đặt lại mật khẩu chỉ Admin (`A1`, `A5`) *(Done — đã duyệt & merge vào `main`)*

- **`CR-02-01` (`backend-db` — `Done`):** Lưu trữ nhị phân PNG/JPEG/WEBP `<= 256 KB` trong PostgreSQL (`db/migrations/0003_branding_and_avatars.sql`: `club_assets` + `avatar_data`/`avatar_mime`/`avatar_updated_at` trên `profiles`), kiểm tra magic bytes & chặn SVG (`src/server/shared/media.ts`, `src/lib/media.ts`), module `src/server/modules/branding/*` + `GET/PUT/DELETE /branding*`, `/me/avatar`, `/members/{id}/avatar` + `avatarUrl` trên DTO danh sách (không SELECT `bytea` ở danh sách), audit `branding.logo_*` & `member.avatar_*` không PII/nhị phân, và siết `POST /members/{id}/reset-password` **chỉ Admin (`is_admin = true`)**.
- **`CR-02-02` (`frontend` — `Done`):** Tạo `MemberAvatar` (ảnh thật hoặc chữ cái đầu tên + bảng 8 màu `AVATAR_PALETTE`), `ClubLogo` (header `AppShell`, `LoginForm`, `LoginShowcase`, `ErrorState`), nén ảnh phía client `<= 256 KB` (`src/features/shared/image-compress.ts`), đổi/xóa avatar tại `S08` (`/profile`) & `S09` (`MemberFormDrawer`), `ClubLogoModal` cho Admin tại `/admin/members`, ẩn hoàn toàn nút đặt lại mật khẩu trên UI với tài khoản không phải Admin, và đủ `vi`/`en`.
- **`CR-02-03` (`qa-engineer` — `Done`):** Đủ 8 cổng (`typecheck`, `lint`, `arch:check 220/959`, `openapi:check`, `206 unit / 41 tệp`, `18 integration PostgreSQL / 11 tệp`, `next build 29/29`, **`18/18` Chrome E2E**) và audit `6A.8` đạt **`VERDICT: PASS`**.

### CR-02B: Vào thẳng `/login` ở `/`, Chặn Admin tự gỡ quyền Admin & Căn bố cục toàn hệ thống *(Done — đã duyệt & merge vào `main`)*
- **`CR-02B-01` (`backend-db` — `Done`):** Cập nhật `src/server/modules/permissions/{policy,repository,service}.ts`, `docs/DECISIONS.md`, `docs/openapi.yaml` chặn Admin tự gỡ cờ `is_admin` của chính mình (`409 CANNOT_REVOKE_OWN_ADMIN` kể cả khi có >= 2 Admin), giữ nguyên bảo vệ `LAST_ACTIVE_ADMIN` (`AC-09`) ở policy, khóa thành viên và trigger CSDL.
- **`CR-02B-02` (`frontend` — `Done`):** Cập nhật `src/app/page.tsx` chuyển hướng ngay sang `/login` (khi chưa đăng nhập) hoặc `/boards` / `/profile?changePassword=1` (khi đã đăng nhập), link logo về `/boards`; khóa nút gỡ quyền Admin cho chính mình trên `S10` (`AdminFlagPanel`); gom nút hành động bảng `S09` vào menu `⋯` (`src/components/ActionMenu.tsx`), bỏ banner thừa & chia lưới 2 cột cân đối ma trận quyền `S10`, cân `S08` và `S03`–`S06`, xử lý invalidate cache avatar (`boardDetail`/`taskDetail`/`myTasks`) + hiển thị metadata `branding`/`avatar` ở `AuditDetailPane`, đủ `vi`/`en`.
- **`CR-02B-03` (`qa-engineer` — `Done`):** Đủ 8 cổng (`typecheck`, `lint`, `arch:check 221/963`, `openapi:check`, `212 unit / 42 tệp`, `18 integration PostgreSQL / 11 tệp`, `next build 28/28`, **`19/19` Chrome E2E**) và audit `6A.8` đạt **`VERDICT: PASS`** (`0` Blocker, `0` Major, `2` Minor không chặn).

### CR-04 (`[RỦI RO CAO]`): Kho lưu trữ tập trung (Archive) cho Task, User & Board (`A1`–`A5`) *(Done — đã duyệt & merge vào `main`)*
- **`CR-04-01` (`backend-db`, `[RỦI RO CAO]` — `Done`):** Migration cộng thêm `0004_archive_purged_and_retention.sql` (`purged_at` trên `tasks`, `boards`, `profiles`, ngoại lệ 1 chiều ở `prevent_student_id_change` & `prevent_entity_unpurge`), cập nhật `docs/ERD.md`, `docs/openapi.yaml`, `schema.d.ts`, lọc `purged_at IS NULL` toàn hệ thống, tạo module `archive` (`GET /archive` phân 3 tab có lọc quyền `task.delete`/`member.deactivate`/`board.delete` và che task ẩn `404`, `POST /archive/{type}/{id}/restore` + `/tasks/{id}/restore` theo `WQ-33`, `DELETE /archive/{type}/{id}` [chỉ Admin: gắn `purged_at`, giải phóng ban khi purge board, ẩn danh PII user có lịch sử thành `"Thành viên đã xóa"` giữ nguyên FK `task_events`/`audit_logs`, hoặc xóa vật lý DB user chưa có lịch sử], `GET/PUT /settings/archive-retention` [Admin chọn `null`/`7`/`30`/`90` ngày], `POST /internal/cron/archive-purge` [`CRON_SECRET`]).
- **`CR-04-02` (`frontend` — `Done`):** Thêm mục điều hướng & trang `/archive` với 3 tab lọc (**Task**, **Thành viên**, **Board** — hiện theo quyền), thanh cấu hình hạn tự dọn (`Không tự xóa` / `7 ngày` / `30 ngày` / `90 ngày` chỉ Admin), nút **Khôi phục**, modal xác nhận **Xóa vĩnh viễn** (chỉ Admin), ẩn MSSV/email khi thiếu `member.view_detail`, nhãn audit `archive.*` & `settings.archive_retention_updated`, và đủ chuỗi `vi`/`en`.
- **`CR-04-03` (`qa-engineer`, `[RỦI RO CAO]` — `Done`):** Đủ 8 cổng (`typecheck`, `lint`, `arch:check 248/1130`, `openapi:check`, **`228` unit test / `44` tệp**, **`20` integration PostgreSQL / `12` tệp**, `next build 32 trang/static`, **`23/23` Chrome E2E** gồm `tests/e2e/archive.spec.ts`) và audit `6A.8` đạt **`VERDICT: PASS`** (`0` Blocker, `0` Major, `2` Minor không chặn).

### CR-03 (`[RỦI RO CAO]`): Giao task cho Ban (`task_departments`) & Thông báo (`A2`, `A3`, `A5`) *(Done — đã duyệt & merge vào `main`)*
- **`CR-03-01` (`backend-db`, `[RỦI RO CAO]` — `Done`):** Migration cộng thêm `0005_task_departments_and_notifications.sql` (`task_departments`, `notifications`), cập nhật `docs/ERD.md` (21 bảng miền), `docs/openapi.yaml` & `schema.d.ts` (`TaskDto.assignedDepartments`, `departmentIds` + `notifyDepartmentMembers` ở `POST /tasks` & `PUT /tasks/{id}/assignees`, `departmentId` ở `GET /tasks` & `GET /me/tasks`, `GET /notifications`, `POST /notifications/{id}/read`, `POST /notifications/read-all`), đưa `departmentIds` tươi vào `AuthActor`, mở rộng `taskVisibilityPolicy` & `/me/tasks` cho thành viên thuộc ban được giao, dựng `SmtpMailer` thuần Node (`net`/`tls` + `NoopMailer` fallback + chặn CRLF/NUL) và module `notifications` (che tiêu đề task ẩn `WQ-27`, không PII, cập nhật dọn dẹp khi Archive purge).
- **`CR-03-02` (`frontend` — `Done`):** Đặt bộ chọn **Giao cho Ban** làm mặc định nổi bật kèm checkbox bật/tắt thông báo & email, thu gọn bộ chọn từng thành viên ở `CreateTaskModal` & `TaskDrawerSections` (và cuộn modal an toàn `1280x720`); hiện badge Ban trên `BoardTaskCard` (`S04`) & `MyTasksView` (`S06` + lọc Ban); mở rộng quyền `task.update_assigned` cho thành viên Ban; thêm chuông `NotificationBell` + `NotificationPopover` trên topbar (`AppShell` + `AuthGuard`, bấm mở `/boards/[id]?task=[id]`, che tiêu đề ẩn `WQ-27`) và đủ chuỗi `vi`/`en`.
- **`CR-03-03` (`qa-reviewer` ngữ cảnh sạch — `Done`):** Đủ 8 cổng (`typecheck`, `lint`, `arch:check 268/1231`, `openapi:check`, **`242` unit test / `47` tệp**, **`22` integration PostgreSQL / `13` tệp**, `next build 34/34` route, **`27/27` Chrome E2E** gồm `tests/e2e/department-notifications.spec.ts`) và audit `6A.8`/`§7`/`§8` đạt **`VERDICT: PASS`** (`0` Blocker, `0` Major, `1` Minor không chặn).

### CR-05: Tinh gọn UX, Ẩn thành viên đã rời ở Phân quyền & Làm đẹp ô Select *(Done — đã duyệt & merge vào `main`)*
- **`CR-05-01` (`frontend` — `Done`):** Xóa thẻ chọn ngôn ngữ khỏi `/profile` (`ProfileView.tsx`, `ProfileSideCards.tsx`; giữ `LanguageSwitch` ở `AppShell` và `profile.languageSaveError` cho `AuthGuard.tsx`); lọc chỉ thành viên đang hoạt động tại `/admin/permissions` (`buildPermissionMembersQuery` `isActive: true` + filter phòng thủ ở `usePermissionsEditorState.ts`, `PermissionsAdminView.tsx`, `PermissionsMemberList.tsx`); lược bỏ lời giải thích thừa và viết lại chuỗi ngắn gọn, tự nhiên trên `vi`/`en` (`messages/{vi,en}.json`, giữ 100% tương thích khóa với `NotificationPopover`/`BoardDetailParts`); thiết kế lại `.ui-select` trong `src/app/globals.css` (`appearance: none`, SVG chevron đồng bộ hover/focus/disabled, tách `@media (min-width: 1024px)` bảo toàn `padding-right`).
- **`CR-05-02` (`qa-reviewer` ngữ cảnh sạch — `Done`):** Cập nhật unit test frontend (`profile-view`, `permissions-admin`, `i18n-parity`, `archive-view`, `audit-logs`, `departments-admin`, `login-form`, `member-admin`) và E2E (`auth.spec.ts` đổi ngôn ngữ ở thanh trái & xác nhận không còn thẻ ngôn ngữ ở `/profile`; `permissions-audit.spec.ts` xác nhận ẩn thành viên đã rời ở Phân quyền & kiểm tra computed style `.ui-select` không tràn ở `1280x720`).

### CR-06 (`[RỦI RO CAO]`): Mở rộng trình chỉnh sửa Task 2 cột & Tách riêng tùy chọn Thông báo / Email (`A1`–`A3`) *(Done — đã duyệt & merge vào `main`)*
- **`CR-06-01` (`backend-db`, `[RỦI RO CAO]` — `Done`):** Hợp nhất trên nền `origin/main`: cập nhật cộng thêm `docs/openapi.yaml` (`notifyInApp`, `notifyEmail` ở `CreateTaskRequest` & `ReplaceTaskAssigneesRequest`, tái sinh `schema.d.ts`, bảo toàn 100% `NotificationDto` phẳng & cập nhật từng phần `assigneeIds`/`departmentIds`), bổ sung `resolveTaskNotificationChannels` trong `src/lib/tasks.ts`, mở rộng `runTaskAssigneesInTx` trả về `addedDepartmentIds` & `addedAssigneeIds`, mở rộng `dedupeDepartmentRecipients` / `NotificationsService` hỗ trợ cả Ban (`task.department_assigned`) lẫn thành viên lẻ mới gán (`task.assigned`, email gán trực tiếp tự nhiên `vi`/`en`), loại trừ `actorId`, khử trùng lặp mỗi người tối đa `1` chuông + `1` email, giữ che tiêu đề task ẩn `WQ-27` và lọc PII khi lỗi SMTP (`extractSafeMailErrorMessage` + `scrubPiiText`).
- **`CR-06-02` (`frontend` — `Done`):** Tách khối độc lập `TaskNotificationOptions.tsx` (`Tùy chọn gửi thông báo`: `Thông báo trên web` + `Gửi email`), mở rộng `TaskDetailDrawer.tsx` sang bố cục 2 cột rộng `~900px` (`ui-drawer-task`, `task-drawer-grid`, `task-drawer-col-main`, `task-drawer-col-side` với `.task-assigned-summary` và nút `Cập nhật giao việc`), nới rộng `CreateTaskModal.tsx` (`ui-modal-lg` `720px`, textarea mô tả `6` dòng), và cập nhật đủ khóa `vi`/`en`.
- **`CR-06-03` (`qa-reviewer` ngữ cảnh sạch, `[RỦI RO CAO]` — `Done`):** Kiểm định độc lập toàn bộ bản hợp nhất `CR-05` + `CR-06` trên nền `origin/main`: vượt 8/8 cổng (`typecheck`, `lint` `0`/`0`, `arch:check` `269` module / `1,233` phụ thuộc, `openapi:check`, **`244` unit test / `47` tệp**, **`22` integration PostgreSQL / `13` tệp**, `next build` `34/34` route, **`28/28` Chrome E2E** gồm `department-notifications.spec.ts`), audit `6A.8` (`13/13`) & bảo mật `§7` đạt **`VERDICT: PASS`** (`0` Blocker, `0` Major, `1` Minor không chặn).

---

## Epic E6 — Lọc, tìm kiếm & sắp xếp board/task nâng cao; thay thế kéo thả *(Done — đã duyệt & merge vào main)*

### E6-01
- **ID:** `E6-01`
- **Tiêu đề:** API đếm/tìm kiếm board theo quyền xem & chuẩn hóa lọc/sắp xếp task (`overdue` loại cột cuối) `[RỦI RO CAO]`
- **Sub-agent phụ trách:** `backend-db`
- **Liên quan:** `FR-03`, `FR-25`, `FR-27`, `AC-15`, `S03`, `S04`
- **Phụ thuộc:** `CR-03`, `CR-05`, `CR-06` (`Done`), chủ dự án duyệt bổ sung cộng thêm `docs/openapi.yaml` (2026-11-25)
- **Mục tài liệu cần đọc:** `HANDOFF` (`FR-22`, `FR-25`, `FR-27`, `AC-15`, `S03`, `S04`, `GET /tasks`), `wireframes/s03-boards.html`, `wireframes/s04-board.html`, `docs/openapi.yaml`, `docs/DECISIONS.md`
- **Phạm vi file được sửa:** `docs/openapi.yaml`, `src/features/shared/api/schema.d.ts`, `src/lib/{boards,tasks}.ts`, `src/server/modules/{boards,tasks,archive}/*`, `src/app/api/v1/boards/route.ts`, `tests/unit/{boards,tasks}/*`, `tests/integration/{boards,tasks}/*`
- **Tiêu chí chấp nhận:**
  1. Bổ sung cộng thêm `GET /boards?q=` (tìm `boards.name` phía server, thoát ký tự LIKE) và mở rộng `BoardSummaryDto`/`BoardDetailDto` thêm `visibleTaskCount` & `overdueTaskCount` tính theo quyền người xem (loại bỏ task đã xóa mềm/purge, task ẩn không được xem, và task cột cuối `Done`).
  2. Tinh chỉnh `GET /tasks?dueStatus=overdue` loại bỏ task ở cột cuối `Done`, giữ lọc kết hợp (`boardId`, `columnId`, `assigneeId`, `departmentId`, `priority`, `dueStatus`, `q`, `sortBy`, `sortOrder`) không rò rỉ task ẩn hay PII.
  3. Tách `taskAccessSqlCondition` & `notDoneColumnSqlCondition` tại `src/server/modules/tasks/repository.ts` để `tasks` và `archive` dùng chung 1 nguồn sự thật.
- **Kiểm thử bắt buộc:** Unit test policy/service & integration test trên `beam_test` cho `GET /boards?q=`, đếm `visibleTaskCount`/`overdueTaskCount` theo quyền xem & cột `Done`, và `GET /tasks?dueStatus=overdue` + filter/sort kết hợp; `openapi:generate` + `openapi:check`.
- **Ngoài phạm vi:** Full-text search ngoài `q`, nhãn (label), lưu preset bộ lọc trên DB.
- **Mức rủi ro:** Cao (`[RỦI RO CAO]`)
- **Trạng thái:** `Done`

### E6-02
- **ID:** `E6-02`
- **Tiêu đề:** Giao diện lọc/tìm kiếm/sắp xếp Board & Task (`S03`/`S04`), nút chuyển cột bàn phím/mobile & chuẩn hóa badge quá hạn
- **Sub-agent phụ trách:** `frontend`
- **Liên quan:** `FR-22`, `FR-25`, `FR-27`, `AC-15`, `S03`, `S04`
- **Phụ thuộc:** `E6-01` (`Done` và đã khóa `docs/openapi.yaml` + `schema.d.ts`)
- **Mục tài liệu cần đọc:** `wireframes/s03-boards.html`, `wireframes/s04-board.html`, `docs/openapi.yaml`, `HANDOFF` (`FR-22`, `FR-25`, `FR-27`, `S03`, `S04`)
- **Phạm vi file được sửa:** `src/features/boards/*`, `src/features/tasks/*`, `src/app/boards/[id]/page.tsx`, `src/app/globals.css`, `messages/vi.json`, `messages/en.json`, `tests/unit/frontend/*`
- **Tiêu chí chấp nhận:**
  1. `S04` (`/boards/[id]`): thanh lọc/tìm kiếm/sắp xếp (`q`, Ban, Người được giao — tôn trọng `member.view`, Priority `1..4`, Hạn, Cột, Sắp xếp + thứ tự `asc`/`desc`, xóa lọc, đồng bộ query URL); khi lọc hoặc sắp xếp khác `position asc` thì tạm dừng kéo thả kèm thông báo rõ ràng; badge cột đếm theo task hiển thị.
  2. `BoardTaskCard`: menu `⋯` **"Chuyển tới cột…"** (`POST /tasks/{id}/move`) cho người có quyền di chuyển thẻ (`FR-22`), không hiện cảnh báo quá hạn ở cột cuối `Done`.
  3. `S03` (`/boards`): tìm kiếm `q` qua `GET /boards?q=` và hiển thị `visibleTaskCount`/`overdueTaskCount` trên `BoardTileCard`.
  4. 100% chuỗi UI qua `messages/{vi,en}.json`.
- **Kiểm thử bắt buộc:** Unit test `board-filters`, `boards-view`, `board-detail`, `i18n-parity`.
- **Ngoài phạm vi:** Đổi hợp đồng API hoặc sửa file ngoài phạm vi `frontend`.
- **Mức rủi ro:** Trung bình
- **Trạng thái:** `Done`

### E6-03
- **ID:** `E6-03`
- **Tiêu đề:** Kiểm thử E2E & kiểm định kiến trúc/bảo mật độc lập Epic E6 `[RỦI RO CAO]`
- **Sub-agent phụ trách:** `qa-reviewer` (ngữ cảnh sạch)
- **Liên quan:** `FR-22`, `FR-25`, `FR-27`, `AC-15`, `S03`, `S04`
- **Phụ thuộc:** `E6-01`, `E6-02`
- **Mục tài liệu cần đọc:** `AGENTS.md` (§6A.8, §7, §8), `HANDOFF` (`FR-22`, `FR-25`, `FR-27`, `AC-15`), `docs/openapi.yaml`
- **Phạm vi file được sửa:** `tests/e2e/board-filters-and-move.spec.ts` (và bổ sung test trong `tests/*` nếu cần phủ AC)
- **Tiêu chí chấp nhận:** E2E Chrome xác minh `S03` search/count không lộ task ẩn, `S04` filter/sort/URL reload, menu `⋯` chuyển cột ghi `task_events`, cột `Done` không cảnh báo quá hạn, `AC-15` (`404` task ẩn) & không PII; đạt đủ 8 cổng (`typecheck`, `lint`, `arch:check`, `openapi:check`, `test:unit`, `test:integration`, `build`, `test:e2e`) và audit §6A.8/§7/§8 `VERDICT: PASS`.
- **Kiểm thử bắt buộc:** Đủ 8 cổng CI + Chrome E2E.
- **Ngoài phạm vi:** Sửa mã sản phẩm trong `src/` hoặc `db/`.
- **Mức rủi ro:** Cao (`[RỦI RO CAO]`)
- **Trạng thái:** `Done (8/8 cổng CI, 253 unit / 48 tệp, 24 integration / 15 tệp, 31/31 Chrome E2E, audit 6A.8/§7/§8 VERDICT: PASS)`

---

## Epic E7 — Bình luận & Cờ ẩn task (`FR-07`, `FR-24`, `FR-26`) *(Done — đã duyệt & merge vào main)*

### E7-01
- **ID:** `E7-01`
- **Tiêu đề:** Backend `PUT /tasks/{id}/hidden` & module `comments` (`GET/POST /tasks/{id}/comments`, `DELETE /comments/{id}`) `[RỦI RO CAO]`
- **Sub-agent phụ trách:** `backend-db`
- **Liên quan:** `FR-07`, `FR-24`, `FR-26`, `AC-04`, `AC-05`, `AC-15`, `WQ-27`
- **Phụ thuộc:** `E6` (`Done`); `docs/openapi.yaml` & schema `comments` / `tasks.is_hidden` / `task_events` đã khóa (0 migration, 0 thay đổi OpenAPI)
- **Mục tài liệu cần đọc:** `HANDOFF` (`FR-07`, `FR-24`, `FR-26`, `AC-15`, `S05`, mục 8.3/11.5), `docs/openapi.yaml` (`/tasks/{id}/hidden`, `/tasks/{id}/comments`, `/comments/{id}`)
- **Phạm vi file được sửa:** `src/lib/{tasks,comments}.ts`, `src/server/modules/tasks/*`, `src/server/modules/comments/*`, `src/server/shared/composition.ts`, `src/app/api/v1/tasks/[id]/hidden/route.ts`, `src/app/api/v1/tasks/[id]/comments/route.ts`, `src/app/api/v1/comments/[id]/route.ts`, `tests/unit/{tasks,comments}/*`, `tests/integration/{tasks,comments}/*`
- **Tiêu chí chấp nhận:**
  1. `PUT /api/v1/tasks/{id}/hidden`: kiểm tra `taskVisibilityPolicy` trước (`404` nếu task không tồn tại/đã xóa mềm/đang ẩn với người không được xem); chỉ `created_by` hoặc `is_admin` được bật/tắt (`403` cho assignee/thành viên thường dù có `task.update_any`); kiểm tra `version` (`409` nếu xung đột); ghi `task.hidden_changed` trong cùng transaction và trả `{ task, eventId }`.
  2. `GET /api/v1/tasks/{id}/comments`: phân trang cursor, lọc `taskVisibilityPolicy` (`404` nếu task ẩn & không được xem hoặc đã xóa mềm), `author` qua `MemberPublicSummary` (0 PII, hiện trạng thái đã rời).
  3. `POST /api/v1/tasks/{id}/comments`: kiểm tra `taskVisibilityPolicy` (`404`) trước rồi `authorize('comment.create')` (`403`); validate `body` (`1..4000` ký tự sau trim); ghi `comment.added` (`commentId` UUID, 0 PII) cùng transaction và trả `201 { comment, eventId }`.
  4. `DELETE /api/v1/comments/{id}`: kiểm tra parent task `taskVisibilityPolicy` (`404` nếu comment không tồn tại hoặc task cha ẩn/xóa mềm); chỉ tác giả comment, người có `comment.delete_any`, hoặc admin được xóa (`403` nếu không); ghi `comment.deleted` (`commentId` UUID) cùng transaction và trả `200 { deleted: true, id, eventId }`.
- **Kiểm thử bắt buộc:** Unit test policy/service & PostgreSQL integration test trên `beam_test` đủ allow/deny `comment.create`, `comment.delete_any`, `canToggleTaskHidden` (creator/admin vs assignee/`task.update_any` `403` vs non-viewer `404`), `409` version conflict, `404` task ẩn ở mọi đường bình luận, `task_events` append-only không PII.
- **Ngoài phạm vi:** Hoàn tác (`E7A`), sửa bình luận, file đính kèm, `@mention`.
- **Mức rủi ro:** Cao (`[RỦI RO CAO]`)
- **Trạng thái:** `Done`

### E7-02
- **ID:** `E7-02`
- **Tiêu đề:** Giao diện Bật/tắt cờ ẩn & Bình luận trong Chi tiết Task `S05` + Tạo Task ẩn `S04`
- **Sub-agent phụ trách:** `frontend`
- **Liên quan:** `FR-07`, `FR-24`, `FR-26`, `AC-15`, `S04`, `S05`, `WQ-27`
- **Phụ thuộc:** `E6` (`Done`), `docs/openapi.yaml` đã khóa (có thể chạy song song `E7-01` sau khi duyệt do không trùng vùng file)
- **Mục tài liệu cần đọc:** `wireframes/s05-task-detail.html` (`s04-board.html`), `docs/openapi.yaml`, `HANDOFF` (`FR-07`, `FR-24`, `FR-26`, `S05`)
- **Phạm vi file được sửa:** `src/features/comments/*`, `src/features/tasks/*`, `src/features/boards/components/BoardTaskCard.tsx`, `src/app/globals.css`, `messages/vi.json`, `messages/en.json`, `tests/unit/frontend/*`
- **Tiêu chí chấp nhận:**
  1. `S05` (`TaskDetailDrawer`): tách tab **`Chi tiết` | `Bình luận (N)`**, bình luận mới nhất ở trên (`created_at DESC`), ghim ô nhập ở đầu (gửi nhanh `Ctrl/Cmd+Enter`), khung cuộn độc lập tải gọn `10` bình luận/lần kèm `"Xem thêm bình luận cũ hơn"` & thu gọn bình luận dài (`Xem thêm`/`Thu gọn`); hiển thị tác giả + avatar + `(đã rời)` nếu inactive + giờ `Asia/Ho_Chi_Minh`, 0 MSSV/email; composer theo `comment.create`; xóa inline theo tác giả/`comment.delete_any`/admin; cập nhật tức thì `commentCount`.
  2. `S05` (`TaskDetailDrawer`): công tắc **Cờ ẩn task** (`PUT /tasks/{id}/hidden`) chỉ hiện cho người tạo task hoặc admin (kèm cảnh báo khi bật ẩn mà chưa giao ai theo `WQ-27`, xử lý `409` version conflict); đồng bộ cache board/task/my-tasks/archive.
  3. `S04` (`CreateTaskModal` & `BoardTaskCard`): đảm bảo tùy chọn tạo task ẩn + badge ẩn rõ ràng cho người được xem; giữ đồng nhất bỏ cảnh báo quá hạn cột `Done`.
  4. 100% chuỗi UI qua `messages/{vi,en}.json`.
- **Kiểm thử bắt buộc:** Unit test `task-comments`, `task-hidden-toggle`, `board-detail`, `i18n-parity`.
- **Ngoài phạm vi:** Tab lịch sử & nút Hoàn tác (`E7A`), sửa bình luận, đổi API.
- **Mức rủi ro:** Trung bình
- **Trạng thái:** `Done`

### E7-03
- **ID:** `E7-03`
- **Tiêu đề:** Kiểm thử E2E & kiểm định kiến trúc/bảo mật độc lập Epic `E7` `[RỦI RO CAO]`
- **Sub-agent phụ trách:** `qa-engineer` + `qa-reviewer` (ngữ cảnh sạch)
- **Liên quan:** `FR-07`, `FR-24`, `FR-26`, `AC-04`, `AC-05`, `AC-15`, `WQ-27`, `AGENTS.md` (§6A.8, §7, §8)
- **Phụ thuộc:** `E7-01`, `E7-02`
- **Mục tài liệu cần đọc:** `AGENTS.md` (§6A.8, §7, §8), `HANDOFF` (`FR-07`, `FR-24`, `FR-26`, `AC-15`), `docs/openapi.yaml`
- **Phạm vi file được sửa:** `tests/e2e/comments-hidden-tasks.spec.ts` (và bổ sung test trong `tests/*` nếu cần phủ AC)
- **Tiêu chí chấp nhận:** Chrome E2E xác minh tạo/xem/xóa bình luận trong tab Bình luận (mới nhất trước, phân trang 10/lần, thu gọn bình luận dài) theo quyền (`comment.create`, tác giả, `comment.delete_any`, non-holder `403`), bật/tắt cờ ẩn (creator/admin được, assignee/`task.update_any` `403`, non-viewer `404` trên board/search/count/task detail/comments/delete comment), ghi `task_events` (`task.hidden_changed`, `comment.added`, `comment.deleted`) không PII; đạt đủ 8 cổng CI và audit §6A.8/§7/§8 `VERDICT: PASS`.
- **Kiểm thử bắt buộc:** Đủ 8 cổng CI + Chrome E2E.
- **Ngoài phạm vi:** Sửa mã sản phẩm trong `src/` hoặc `db/`.
- **Mức rủi ro:** Cao (`[RỦI RO CAO]`)
- **Trạng thái:** `Done (8/8 cổng CI, 277 unit / 53 tệp, 28 integration / 16 tệp, 38/38 Chrome E2E, audit 6A.8/§7/§8 VERDICT: PASS)`

---

## Yêu cầu thay đổi CR-07 (`[RỦI RO CAO]`): Trang Quản trị Giao diện CLB & Khung treo ảnh động Login *(Done — đã duyệt & merge vào main)*

### CR-07-01
- **ID:** `CR-07-01`
- **Tiêu đề:** Migration `0006_login_gallery.sql`, `docs/ERD.md`, OpenAPI & API `/branding/gallery*` (`<= 512 KB`, tối đa `12` ảnh) + `/branding/wordmark` (`<= 256 KB`) `[RỦI RO CAO]`
- **Sub-agent phụ trách:** `backend-db`
- **Liên quan:** `CR-02`, `S01`, `FR-42`, `A1`–`A4`
- **Phụ thuộc:** `E6` (`Done`), chủ dự án duyệt `CR-07` (`2026-11-26`)
- **Mục tài liệu cần đọc:** `docs/DECISIONS.md` (`CR-07`), `db/migrations/0003_branding_and_avatars.sql`, `docs/openapi.yaml` (`/branding*`)
- **Phạm vi file được sửa:** `db/migrations/0006_login_gallery.sql`, `db/schema/*`, `docs/ERD.md`, `docs/openapi.yaml`, `src/features/shared/api/schema.d.ts`, `src/lib/media.ts`, `src/server/shared/media.ts`, `src/server/modules/branding/*`, `src/app/api/v1/branding/**`, `tests/unit/{branding,shared}/*`, `tests/integration/branding/*`
- **Tiêu chí chấp nhận:** Bảng `login_gallery_items` cộng thêm (PNG/JPEG/WEBP `<= 512 KB`, magic-byte check, không SVG, giới hạn 12 ảnh trả `409 GALLERY_LIMIT_REACHED`); `GET /branding` trả thêm `wordmarkUrl` & `galleryItems` metadata (không SELECT `bytea`); `/branding/wordmark` (`GET` công khai với `nosniff` + `CSP sandbox`, `PUT`/`DELETE` chỉ Admin dùng chung bảng `club_assets`); `GET /branding/gallery/{id}/image` gắn `nosniff` + `CSP sandbox`; các endpoint ghi chỉ Admin (`403` cho non-admin) và ghi `audit_logs` không nhị phân/PII.
- **Mức rủi ro:** Cao (`[RỦI RO CAO]`)
- **Trạng thái:** `Done`

### CR-07-02
- **ID:** `CR-07-02`
- **Tiêu đề:** Trang `/admin/branding` (Logo + Chữ ảnh `club_wordmark` + Gallery), gỡ nút Logo lẻ ở `/admin/members`, tường triển lãm `/login`, footer `BEAM CLUB × Sang`
- **Sub-agent phụ trách:** `frontend`
- **Liên quan:** `S01`, `CR-02`, `A1`–`A4`
- **Phụ thuộc:** `CR-07-01` (`Done`, đã khóa `docs/openapi.yaml` + `schema.d.ts`)
- **Phạm vi file được sửa:** `src/app/admin/branding/page.tsx`, `src/app/globals.css`, `src/components/{AppShell.tsx,AppShellNav.tsx,ClubWordmark.tsx}`, `src/features/branding/*`, `src/features/auth/components/{LoginShowcase.tsx,LoginPhotoWall.tsx,LoginForm.tsx}`, `src/features/members/components/MemberAdminView.tsx`, `src/features/shared/image-compress.ts`, `src/features/audit/formatters.ts`, `messages/{vi,en}.json`, `tests/unit/frontend/*`
- **Tiêu chí chấp nhận:** Mục `/admin/branding` (Admin-only, non-admin `403`) quản lý cả Logo CLB (`<= 256 KB`), Chữ ảnh thương hiệu (`<= 256 KB`, hỗ trợ chọn `.svg` rasterize trong suốt client-side) & tối đa 12 khung ảnh Login (`<= 512 KB`, thêm/sửa/xóa/đổi thứ tự); gỡ nút `Logo CLB` khỏi `/admin/members`; `/login` Desktop (`>= 900px`) hiện nền tường gạch triển lãm + đèn rọi làm nổi bật khung Polaroid tự trôi chậm + kéo chuột ngang + `<`/`>` + 4 khung mẫu khi trống; Mobile ẩn hoàn toàn gallery; chân trang `/login` hiện `BEAM CLUB × Sang` gắn link Facebook; 100% chuỗi `vi`/`en`.
- **Mức rủi ro:** Trung bình
- **Trạng thái:** `Done`

### CR-07-03
- **ID:** `CR-07-03`
- **Tiêu đề:** Kiểm thử E2E & kiểm định kiến trúc/bảo mật độc lập `CR-07` `[RỦI RO CAO]`
- **Sub-agent phụ trách:** `qa-engineer` (ngữ cảnh sạch)
- **Liên quan:** `CR-07-01`, `CR-07-02`, `AGENTS.md` (§6A.8, §7, §8)
- **Phụ thuộc:** `CR-07-01`, `CR-07-02`
- **Phạm vi file được sửa:** `tests/e2e/members-departments.spec.ts` (chuyển test logo về `/admin/branding`), `tests/e2e/branding-login-gallery.spec.ts`
- **Tiêu chí chấp nhận:** Đủ 8 cổng CI + Chrome E2E xác minh Admin CRUD/reorder/giới hạn 12, `.svg` wordmark upload -> raster an toàn + hiển thị toàn site, non-admin `403`, `/login` Desktop kéo ngang/mũi tên/4 khung mẫu & Mobile ẩn, footer `BEAM CLUB × Sang`, `audit_logs` không nhị phân/PII, và audit `6A.8`/`§7`/`§8` đạt `VERDICT: PASS`.
- **Mức rủi ro:** Cao (`[RỦI RO CAO]`)
- **Trạng thái:** `Done (8/8 cổng CI, 266 unit / 50 tệp, 27 integration / 15 tệp, 35/35 Chrome E2E, audit 6A.8/§7/§8 VERDICT: PASS)`

---

## Epic E7A — Lịch sử hoạt động `task_events`, Hoàn tác (Undo) & Thùng rác theo Board (`FR-60`, `FR-61`, `FR-62`) *(Done, đã duyệt & merge vào `main`)*

### E7A-01
- **ID:** `E7A-01`
- **Tiêu đề:** Backend `GET /tasks/{id}/events`, `POST /tasks/{id}/events/{eventId}/revert` (Command + Registry) & `GET /boards/{id}/trash` `[RỦI RO CAO]`
- **Sub-agent phụ trách:** `backend-db`
- **Liên quan:** `FR-60`, `FR-61`, `FR-62`, `AC-16`, `AC-17`, `AC-18`, `AC-19`, `AC-20`, `AC-22`, `WQ-17`, `WQ-33`
- **Phụ thuộc:** `E7` (`Done`, merged `main`); schema `task_events` / `tasks` & `docs/openapi.yaml` đã khóa (0 migration, 0 thay đổi OpenAPI)
- **Mục tài liệu cần đọc:** `HANDOFF` (mục 8.7–8.8 `FR-60`–`FR-62`, `AC-16`–`AC-20`, `AC-22`), `docs/openapi.yaml` (`/tasks/{id}/events`, `/tasks/{id}/events/{eventId}/revert`, `/boards/{id}/trash`), `AGENTS.md` (§6A.4, §7)
- **Phạm vi file được sửa:** `src/lib/task-events.ts` (hoặc `src/lib/tasks.ts`), `src/server/modules/task-events/*` (hoặc `src/server/modules/tasks/*`), `src/server/modules/boards/*`, `src/server/shared/composition*.ts`, `src/app/api/v1/tasks/[id]/events/route.ts`, `src/app/api/v1/tasks/[id]/events/[eventId]/revert/route.ts`, `src/app/api/v1/boards/[id]/trash/route.ts`, `tests/unit/*`, `tests/integration/*`
- **Tiêu chí chấp nhận:**
  1. `GET /api/v1/tasks/{id}/events`: trả lịch sử mới nhất trước với phân trang cursor, áp dụng `taskVisibilityPolicy` (`404` nếu task ẩn không được xem theo `AC-20`, hỗ trợ xem lịch sử khi task đã xóa mềm nếu caller có `task.delete`/admin hoặc mở theo quyền xem task chưa purge), `actor` qua `MemberPublicSummary` (0 MSSV/email), `changes` chỉ chứa ID/giá trị miền, gắn cờ `revertable` chính xác theo loại sự kiện.
  2. `POST /api/v1/tasks/{id}/events/{eventId}/revert`: cài mẫu **Command (`apply`/`invert`) + Registry** cho mọi sự kiện hoàn tác được (`task.updated`, `task.moved`, `task.assignees_changed` [cả thành viên & ban], `task.hidden_changed`, `task.deleted`, `task.restored`); `task.created`, `comment.added`, `comment.deleted` trả `400`; kiểm tra `taskVisibilityPolicy` (`404` trước `403`) rồi kiểm tra quyền khớp thao tác gốc (`AC-19` `403` nếu thiếu); đối chiếu giá trị hiện tại với `to` của sự kiện (`409` kèm `details.conflictingFields` nếu đã thay đổi, trừ khi `force=true` `AC-18`); ghi sự kiện bù mới (`reverts_event_id`, `forced`) trong cùng transaction (`AC-17`, `AC-22`).
  3. `GET /api/v1/boards/{id}/trash`: yêu cầu `task.delete` hoặc admin (`403` nếu thiếu), liệt kê task đã xóa mềm chưa purge của board theo cursor, lọc bỏ task ẩn mà người gọi không có quyền xem (`WQ-17`).
- **Kiểm thử bắt buộc:** Unit test Command Registry & service (đủ từng loại sự kiện, `400`, `403`, `404`, `409` conflict + `force=true`, 0 PII) & integration test PostgreSQL trên `beam_test` (cả append-only trigger `task_events` `AC-22` và `/boards/{id}/trash` `WQ-17`).
- **Ngoài phạm vi:** Sửa/xóa `task_events` (bị khóa), xóa vĩnh viễn ngoài Archive (`CR-04`), sửa `docs/openapi.yaml`.
- **Mức rủi ro:** Cao (`[RỦI RO CAO]`)
- **Trạng thái:** `Done` *(đã duyệt & merge `main`; `E7A-01` unit `task-events-policy-service.test.ts` + integration PostgreSQL `task-events-revert-trash-routes.test.ts` xanh)*

### E7A-02
- **ID:** `E7A-02`
- **Tiêu đề:** Tab **`Lịch sử`** trong Drawer Task `S05`, Toast **Hoàn tác `10s`** (`S04`/`S05`) & Lối Thùng rác Board (`S04`)
- **Sub-agent phụ trách:** `frontend`
- **Liên quan:** `FR-60`, `FR-61`, `FR-62`, `AC-16`, `AC-17`, `AC-18`, `WQ-17`, `S04`, `S05`
- **Phụ thuộc:** `E7` (`Done`), `docs/openapi.yaml` đã khóa (có thể chạy song song `E7A-01` sau khi duyệt do không trùng vùng file)
- **Mục tài liệu cần đọc:** `HANDOFF` (mục 8.8 `FR-60`–`FR-62`, `S04`, `S05`), `wireframes/s05-task.html` (trạng thái Tab Lịch sử), `docs/openapi.yaml`
- **Phạm vi file được sửa:** `src/features/tasks/*`, `src/features/boards/*`, `src/app/globals.css`, `messages/vi.json`, `messages/en.json`, `tests/unit/frontend/*`
- **Tiêu chí chấp nhận:**
  1. `S05` (`TaskDetailDrawer`): thêm tab **`Lịch sử`** trên thanh tab sẵn có, tải phân trang cursor mới nhất trước (`GET /tasks/{id}/events`), hiển thị câu mô tả song ngữ dễ đọc theo loại sự kiện (tên cột, độ ưu tiên, hạn, assignee/ban, cờ ẩn, xóa/khôi phục — 0 PII, `(đã rời)`, giờ `Asia/Ho_Chi_Minh`), hiện nút **`Khôi phục giá trị này`** cho sự kiện `revertable` nếu đủ quyền và hộp thoại xác nhận **`force`** khi nhận `409` kèm danh sách trường xung đột.
  2. **Toast Hoàn tác (`10s`):** sau các thao tác có `eventId` trên `S04`/`S05` (kéo/chuyển cột, sửa chi tiết, đổi giao việc, bật/tắt ẩn, xóa mềm), hiện `sonner` toast kèm nút **`Hoàn tác`** (`duration` theo cấu hình `10s`) gọi `POST /tasks/{id}/events/{eventId}/revert` và đồng bộ lại UI ngay lập tức.
  3. **Thùng rác Board (`S04`):** bổ sung lối xem/khôi phục nhanh task đã xóa trong board (`GET /boards/{id}/trash`) cho người có `task.delete`/admin, không lộ task ẩn không được xem (`WQ-17`).
  4. 100% chuỗi UI qua `messages/{vi,en}.json`.
- **Kiểm thử bắt buộc:** Unit test tab Lịch sử, formatter loại sự kiện `vi`/`en`, hộp thoại xung đột `409`, toast Hoàn tác, kiểm tra `i18n-parity`.
- **Ngoài phạm vi:** Đổi API, sửa mã backend `src/server/*`.
- **Mức rủi ro:** Trung bình
- **Trạng thái:** `Done` *(đã duyệt & merge `main`; `E7A-02` tab Lịch sử `S05` + toast Hoàn tác `10s` + modal `409` + Thùng rác `S04` + unit `task-history-undo.test.tsx`, `i18n` `vi`/`en` xanh)*

### E7A-03
- **ID:** `E7A-03`
- **Tiêu đề:** Kiểm thử E2E Chrome & kiểm định kiến trúc/bảo mật độc lập Epic `E7A` `[RỦI RO CAO]`
- **Sub-agent phụ trách:** `qa-engineer` + `qa-reviewer` (ngữ cảnh sạch)
- **Liên quan:** `FR-60`, `FR-61`, `FR-62`, `AC-16`, `AC-17`, `AC-18`, `AC-19`, `AC-20`, `AC-22`, `WQ-17`, `AGENTS.md` (§6A.8, §7, §8)
- **Phụ thuộc:** `E7A-01`, `E7A-02`
- **Mục tài liệu cần đọc:** `AGENTS.md` (§6A.8, §7, §8), `HANDOFF` (`FR-60`–`FR-62`, `AC-16`–`AC-20`, `AC-22`), `docs/openapi.yaml`
- **Phạm vi file được sửa:** `tests/e2e/task-history-undo.spec.ts` (và bổ sung test trong `tests/*` nếu cần phủ AC)
- **Tiêu chí chấp nhận:** Chrome E2E xác minh toàn bộ vòng đời lịch sử & hoàn tác (`AC-16` ghi event khi kéo cột/sửa, `AC-17` bấm toast Hoàn tác `10s` tạo sự kiện bù mới, `AC-18` sửa đè gây `409` `conflictingFields` và xác nhận `force=true`, `AC-19` thiếu quyền gốc bị `403`, `AC-20` task ẩn trả `404` ở `/events` & `/revert`, `AC-22` append-only `task_events`, `WQ-17` `/boards/{id}/trash` che task ẩn, 0 PII); vượt 8/8 cổng CI và audit §6A.8/§7/§8 `VERDICT: PASS`.
- **Kiểm thử bắt buộc:** Đủ 8 cổng CI + Chrome E2E.
- **Ngoài phạm vi:** Sửa mã sản phẩm trong `src/` hoặc `db/`.
- **Mức rủi ro:** Cao (`[RỦI RO CAO]`)
- **Trạng thái:** `Done` *(đã duyệt & merge `main`; vượt `8/8` cổng CI: `openapi:check`, `typecheck` `0`, `lint` `0`/`0`, `arch:check` `326/1584`, `55` unit / `289` test, `17` integration / `29` test, `next build` `38/38` route, `42/42` Chrome E2E `2.7m` gồm `task-history-undo.spec.ts` `4/4`, và `qa-reviewer` ngữ cảnh sạch `6A.8`/`§7`/`§8` đạt `VERDICT: PASS` với `0` Blocker, `0` Major)*


---

## Epic E8 — Email nhắc deadline, Cấu hình `app_settings` & Vercel Cron (`FR-02`, `FR-30`, `FR-31`) *(Done, đã duyệt & merge `main`)*

### E8-01
- **ID:** `E8-01`
- **Tiêu đề:** Backend `GET/PUT /settings/reminders`, Cron `POST` (& `GET`) `/internal/cron/reminders` (`CRON_SECRET`), mẫu email gộp song ngữ `E01` & cấu hình `vercel.json` `[RỦI RO CAO]`
- **Sub-agent phụ trách:** `backend-db`
- **Liên quan:** `FR-02`, `FR-26`, `FR-30`, `FR-31`, `FR-42`, `FR-43`, `FR-50`, `AC-03`, `WQ-08`, `WQ-12`, `WQ-19`, `WQ-26`, `WQ-27`, `WQ-34`, `WQ-35`
- **Phụ thuộc:** `E7A` (`Done`, merged `main`); schema `app_settings` / `reminders` / `tasks` / `task_assignees` / `task_departments` & `docs/openapi.yaml` đã khóa (`0` migration, `0` thay đổi OpenAPI)
- **Mục tài liệu cần đọc:** `HANDOFF` (mục 8.1, 8.4, 9 `AC-03`, 11.5), `docs/openapi.yaml` (`/settings/reminders`, `/internal/cron/reminders`), `docs/DECISIONS.md` (`WQ-08`, `WQ-12`, `WQ-19`, `WQ-26`, `WQ-27`, `WQ-34`, `WQ-35`, `CR-03`, `CR-04`, `E6`), `AGENTS.md` (§6A.3, §6A.4, §7)
- **Phạm vi file được sửa:** `src/lib/reminders.ts`, `src/server/modules/reminders/*`, `src/server/shared/composition*.ts`, `src/app/api/v1/settings/reminders/route.ts`, `src/app/api/v1/internal/cron/reminders/route.ts`, `src/app/api/v1/internal/cron/archive-purge/route.ts` (bổ sung alias `GET` tương thích Vercel Cron), `vercel.json`, `tests/unit/reminders/*`, `tests/integration/reminders/*`
- **Tiêu chí chấp nhận:**
  1. `GET /api/v1/settings/reminders` & `PUT /api/v1/settings/reminders`: kiểm tra `authorize(actor, 'reminder.configure')` (`403` nếu thiếu); chuẩn hóa `daysBefore` (`0..365`, khử trùng lặp, sắp giảm dần, cho phép `[]` khi tắt hết mốc trước hạn), lưu `app_settings('reminders')` (giữ `sendHourVn: 7`) và ghi `audit_logs` (`action = 'settings.reminders_updated'`, 0 PII) trong cùng transaction; `updatedBy` trả qua `MemberPublicSummary`.
  2. `POST` (& `GET`) `/api/v1/internal/cron/reminders`: bảo vệ bằng `Authorization: Bearer <CRON_SECRET>` (`401` nếu thiếu/sai); tính ngày theo `Asia/Ho_Chi_Minh` (`WQ-12`), lọc task đang hoạt động (`deleted_at IS NULL`, `purged_at IS NULL`, board chưa lưu trữ/purge, **không thuộc cột cuối `Done`** theo `notDoneColumnSqlCondition`) khớp `daysBefore` (`kind = 'd<N>'`) hoặc đã quá hạn khi `remindOverdue = true` (`kind = 'overdue'` theo `HANDOFF §8.1`).
  3. Tập người nhận = hợp khử trùng lặp giữa `task_assignees` đang hoạt động và thành viên đang hoạt động thuộc `task_departments` (`CR-03`), loại trừ `is_active = false` / `purged_at IS NOT NULL` (`FR-43`), kiểm tra kép `canViewTask` cho task ẩn (`FR-26`); bỏ qua bộ `(task_id, user_id, kind)` đã có trong `reminders` (`skippedAlreadySent`, `AC-03`, `WQ-26`).
  4. Gộp tối đa **1 email duy nhất / người / lần chạy** (`FR-31`, `WQ-08`), nhóm **Quá hạn / Đến hạn hôm nay / Sắp tới** (`priority DESC`, `due_at ASC`, `title ASC` `WQ-34`), ngôn ngữ theo `profiles.locale` (`vi`/`en` Strategy `6A.4`, `FR-50`), CTA `${APP_URL}/my-tasks` (`WQ-35`); **không lộ MSSV/email/tên người khác (`FR-42`) và che hoàn toàn tiêu đề task ẩn (`WQ-27`)**. Chỉ ghi `reminders` sau khi gửi SMTP thành công cho người nhận đó; lỗi SMTP của một người được log qua `Logger` (`scrubPiiText`) mà không làm hỏng lượt gửi của người khác.
  5. Thêm `vercel.json` cấu hình lịch chạy hằng ngày (`0 0 * * *` UTC = `07:00 UTC+7` cho `/api/v1/internal/cron/reminders` và `5 0 * * *` UTC cho `/api/v1/internal/cron/archive-purge`).
- **Kiểm thử bắt buộc:** Unit test policy/service/email-template (`AC-03` không gửi trùng, gộp 1 email/người, loại Done/deleted/inactive, `CR-03` ban, `WQ-27` che tiêu đề task ẩn, `vi`/`en`, lỗi SMTP từng phần, 0 PII) & integration test PostgreSQL trên `beam_test` (`GET/PUT /settings/reminders` `401`/`403`/`200` + `audit_logs`, `POST/GET /internal/cron/reminders` `401`/`200` chạy 2 lần idempotent).
- **Ngoài phạm vi:** Đổi `docs/openapi.yaml`, thêm thư viện ngoài, chạm cấu hình production.
- **Mức rủi ro:** Cao (`[RỦI RO CAO]`)
- **Trạng thái:** `Done` *(đã duyệt & merge `main` — `src/lib/reminders.ts`, `src/server/modules/reminders/*`, `composition-workstream.ts`, `GET/PUT /api/v1/settings/reminders`, `POST/GET /api/v1/internal/cron/reminders` & `GET` `/internal/cron/archive-purge`, `vercel.json`, unit `reminders-policy-service.test.ts` + integration `reminders-routes.test.ts` xanh)*

### E8-02
- **ID:** `E8-02`
- **Tiêu đề:** Trang Cấu hình Nhắc deadline `S12` (`/admin/reminders`), Xem trước email `E01` song ngữ `VI`/`EN` & nhãn Audit `settings.reminders_updated`
- **Sub-agent phụ trách:** `frontend`
- **Liên quan:** `FR-02`, `FR-30`, `FR-42`, `FR-50`, `S12`, `E01`, `S13`, `WQ-08`, `WQ-27`, `WQ-34`
- **Phụ thuộc:** `E7A` (`Done`), `docs/openapi.yaml` đã khóa (có thể chạy song song `E8-01` sau khi duyệt do không trùng vùng file)
- **Mục tài liệu cần đọc:** `HANDOFF` (mục 8.4, 11.3 `S12`), `wireframes/s12-reminders.html`, `wireframes/e01-reminder-email.html`, `docs/openapi.yaml` (`/settings/reminders`)
- **Phạm vi file được sửa:** `src/app/admin/reminders/page.tsx`, `src/features/reminders/*`, `src/features/audit/*`, `src/app/globals.css`, `messages/vi.json`, `messages/en.json`, `tests/unit/frontend/*`
- **Tiêu chí chấp nhận:**
  1. Trang `/admin/reminders` (`S12`, đã có sẵn mục điều hướng trên `AppShellNav`): yêu cầu `reminder.configure` hoặc Admin (trả `403` `ErrorState` chuẩn khi thiếu quyền).
  2. Khối **Mốc nhắc (`daysBefore` & `remindOverdue`)**: bật/tắt mốc chuẩn (`Còn 2 ngày`, `Còn 1 ngày`, `Đã quá hạn`) và hỗ trợ thêm/xóa mốc ngày tùy chỉnh (`0..365`); hiện cảnh báo rõ khi tắt hết mọi mốc kèm nút **`Bật lại mốc mặc định`** (`[2, 1]`, `remindOverdue: true`); hiển thị giờ gửi cố định `07:00 · Asia/Ho_Chi_Minh (UTC+7)`, quy tắc người nhận/loại trừ, thông tin người cập nhật gần nhất (0 PII), nút `Hủy` / `Lưu cấu hình` kèm toast.
  3. Khối **Xem trước email (`E01`)**: chuyển đổi `VI` / `EN`, dựng khung email nhắc deadline từ tên `/me` và danh sách `/me/tasks` của chính người đang mở (hoặc trạng thái mẫu/trống an toàn, che tiêu đề task ẩn `WQ-27`, không lộ MSSV/email/tên người khác).
  4. Định dạng hành động `settings.reminders_updated` trên `S13` (`/admin/audit`); 100% chuỗi qua `messages/{vi,en}.json`.
- **Kiểm thử bắt buộc:** Unit test trang `S12` (quyền `403`, bật/tắt mốc, cảnh báo tắt hết, preview `VI`/`EN` che task ẩn & 0 PII), audit formatter `settings.reminders_updated`, `i18n-parity`.
- **Ngoài phạm vi:** Đổi API, thêm nút gửi thử ngoài `openapi.yaml`, sửa mã backend `src/server/*`.
- **Mức rủi ro:** Trung bình
- **Trạng thái:** `Done` *(đã duyệt & merge `main` — `/admin/reminders`, `useReminderSettings.ts`, `preview-helpers.ts` dùng chung `@/lib/reminders`, `ReminderMilestonesCard.tsx`, `RemindersAdminView.tsx`, `ReminderEmailPreview.tsx` + `ReminderEmailPreviewParts.tsx`, `settings.reminders_updated` trên `S13`, `vi`/`en` `100%`, unit `reminders-admin.test.tsx` & `audit-logs.test.tsx` xanh)*

### E8-03
- **ID:** `E8-03`
- **Tiêu đề:** Kiểm thử E2E Chrome & kiểm định kiến trúc/bảo mật độc lập Epic `E8` `[RỦI RO CAO]`
- **Sub-agent phụ trách:** `qa-engineer` + `qa-reviewer` (ngữ cảnh sạch)
- **Liên quan:** `FR-02`, `FR-26`, `FR-30`, `FR-31`, `FR-42`, `FR-43`, `FR-50`, `AC-03`, `WQ-27`, `AGENTS.md` (§6A.8, §7, §8)
- **Phụ thuộc:** `E8-01`, `E8-02`
- **Mục tài liệu cần đọc:** `AGENTS.md` (§6A.8, §7, §8), `HANDOFF` (`FR-30`, `FR-31`, `AC-03`), `docs/openapi.yaml`
- **Phạm vi file được sửa:** `tests/e2e/reminders.spec.ts` (và bổ sung test trong `tests/*` nếu cần phủ AC)
- **Tiêu chí chấp nhận:** Chrome E2E xác minh phân quyền `/admin/reminders` (`403` vs `reminder.configure`/Admin, lưu mốc + `audit_logs`, cảnh báo tắt hết mốc, xem trước `VI`/`EN`), bảo vệ `/api/v1/internal/cron/reminders` bằng `CRON_SECRET` (`401`), chạy cron 2 lần liên tiếp chỉ gửi & ghi `1` nhắc mỗi mốc (`AC-03`), gộp 1 email/người cho cả gán cá nhân & Ban (`CR-03`), bỏ qua cột `Done`/task xóa mềm/thành viên đã rời, che tiêu đề task ẩn (`WQ-27`) & 0 PII; vượt `8/8` cổng CI và `qa-reviewer` ngữ cảnh sạch đạt `VERDICT: PASS`.
- **Kiểm thử bắt buộc:** Đủ 8 cổng CI + Chrome E2E.
- **Ngoài phạm vi:** Sửa mã sản phẩm trong `src/` hoặc `db/`.
- **Mức rủi ro:** Cao (`[RỦI RO CAO]`)
- **Trạng thái:** `Done` *(đã duyệt & merge `main`; vượt `8/8` cổng CI sau sửa: `openapi:check`, `typecheck` `0`, `lint` `0`/`0`, `arch:check` `345` module / `1,677` phụ thuộc, `57` unit / `301` test, `18` integration PostgreSQL / `30` test, `next build` `41/41` route, `44/44` Chrome E2E `2.7m` gồm `reminders.spec.ts` `2/2`, và `qa-reviewer` ngữ cảnh sạch đạt `VERDICT: PASS` với `0` Blocker, `0` Major)*

---

## Epic E9 — Hoàn thiện song ngữ, Sao lưu `pg_dump`, Regression `v1.0` & Tài liệu vận hành (`FR-50`, `NFR-06`, `NFR-08`) *(Done — đã duyệt & merge vào `main`)*

### E9-01
- **ID:** `E9-01`
- **Tiêu đề:** Script sao lưu & kiểm chứng khôi phục `pg_dump`, đồng bộ `GET` cron OpenAPI (`MINOR-1`), chuẩn hóa `findUserPermissions` & Tài liệu vận hành/bàn giao (`NFR-06`, `NFR-08`) `[RỦI RO CAO]`
- **Sub-agent phụ trách:** `backend-db`
- **Liên quan:** `NFR-06`, `NFR-08`, `HANDOFF` (mục 10), `MINOR-1` (`E8` audit)
- **Phụ thuộc:** `E8` (`Done`, merged `main`), nhánh dọn dẹp `chore/repo-cleanup` (`Done`, merged `main`)
- **Mục tài liệu cần đọc:** `AGENTS.md` (§0.4, §6A, §7, §8), `HANDOFF` (mục 7, 10, 11.5), `docs/openapi.yaml`, `README.md`
- **Phạm vi file được sửa:** `scripts/db-cli.mjs`, `scripts/db-backup.mjs`, `scripts/db-restore-verify.mjs`, `.gitignore`, `package.json`, `docs/DECISIONS.md`, `docs/OPERATIONS.md`, `README.md`, `docs/openapi.yaml`, `src/features/shared/api/schema.d.ts`, `src/server/modules/auth/repository.ts`, `tests/integration/db/backup-restore.test.ts`, `tests/integration/auth/auth-repository.test.ts`
- **Tiêu chí chấp nhận:**
  1. `npm run db:backup` chạy `pg_dump` an toàn ra tệp `.sql` cục bộ (ẩn thông tin xác thực, chặn `NODE_ENV=production` và URL ngoài localhost khi thiếu `--allow-remote-dev`).
  2. `npm run db:restore:verify` khôi phục bản backup trên CSDL tạm cô lập, đồng bộ MVCC qua `pg_export_snapshot()` + `--snapshot`, xác nhận đủ `23` bảng `public` (cả số dòng `23/23` bảng, `18` quyền, `>= 3` preset, `>= 6` migration), 7 catalog trigger & probe runtime `SAVEPOINT` cho `APPEND_ONLY_TABLE`, `STUDENT_ID_IMMUTABLE`, `LAST_ACTIVE_ADMIN`, `ALREADY_PURGED`, rồi xóa sạch DB & tệp tạm.
  3. Hoàn thiện `docs/OPERATIONS.md` (gồm mục 7 ghi nhận giữ `/forbidden` làm dự phòng Giai đoạn 2) & cập nhật `README.md`.
  4. Đồng bộ `GET` handler cho `/internal/cron/reminders` và `/internal/cron/archive-purge` trong `docs/openapi.yaml` & `schema.d.ts`, và chuẩn hóa thứ tự `PERMISSIONS` ở `findUserPermissions`.
- **Kiểm thử bắt buộc:** `tests/integration/db/backup-restore.test.ts` (`2/2`), `tests/integration/auth/auth-repository.test.ts` (`1/1`), `npm run db:backup` & `npm run db:restore:verify -- --test`, `openapi:check`.
- **Ngoài phạm vi:** Chạm môi trường/CSDL production thật, đọc dữ liệu thật.
- **Mức rủi ro:** Cao (`[RỦI RO CAO]`)
- **Trạng thái:** `Done` (đã duyệt & merge vào `main`)

### E9-02
- **ID:** `E9-02`
- **Tiêu đề:** Bổ sung `src/app/icon.svg`, sửa logic `milestoneOverdueDesc` (`MINOR-2`), tinh gọn giao diện `/admin/reminders` (`S12`) & rà soát song ngữ `vi`/`en` (`FR-50`, `NFR-07`, `NFR-10`)
- **Sub-agent phụ trách:** `frontend`
- **Liên quan:** `FR-50`, `NFR-07`, `NFR-10`, `MINOR-2` (`E8` audit)
- **Phụ thuộc:** `E8` (`Done`, merged `main`)
- **Mục tài liệu cần đọc:** `AGENTS.md` (§6, §6A, §8), `HANDOFF` (mục 5 `NFR-07`/`NFR-10`), `messages/vi.json`, `messages/en.json`
- **Phạm vi file được sửa:** `src/app/icon.svg`, `messages/vi.json`, `messages/en.json`, `src/features/reminders/*`, `src/app/globals.css`, `tests/unit/frontend/reminders-admin.test.tsx`
- **Tiêu chí chấp nhận:**
  1. Bổ sung `src/app/icon.svg` loại bỏ hoàn toàn `404 /favicon.ico` trên console trình duyệt.
  2. Tinh gọn `S12` (`/admin/reminders`): loại bỏ thẻ kỹ thuật trùng lặp, dùng badge `07:00 · GMT+7`, chỉ hiện chip gỡ cho mốc tùy chỉnh khác `2` & `1`, thay banner xem trước thành chip gọn, không vỡ layout ở `375px` Mobile và `1440px` Desktop.
  3. Cập nhật `reminders.milestoneOverdueDesc` trong `vi.json` & `en.json` khớp hành vi nhắc 1 lần khi vừa quá hạn (`MINOR-2`), giữ nguyên `auth.collabLabel`.
- **Kiểm thử bắt buộc:** `i18n-parity.test.ts` (`6/6`), `reminders-admin.test.tsx` (`6/6`), `lint`, `typecheck`, zero console 404 trên E2E.
- **Ngoài phạm vi:** Đổi nghiệp vụ hoặc API backend.
- **Mức rủi ro:** Trung bình
- **Trạng thái:** `Done` (đã duyệt & merge vào `main`)

### E9-03
- **ID:** `E9-03`
- **Tiêu đề:** Dọn `wireframes/` (giữ `/forbidden` dự phòng), kiểm thử hồi quy `v1.0`, `TRACEABILITY.md`, Checklist UAT & kiểm định độc lập cuối (`AC-01`..`AC-22`) `[RỦI RO CAO]`
- **Sub-agent phụ trách:** `Coordinator` + `qa-engineer` (ngữ cảnh sạch)
- **Liên quan:** `AC-01`..`AC-22`, `AGENTS.md` (§6A.8, §7, §8), `HANDOFF` (mục 9)
- **Phụ thuộc:** `E9-01`, `E9-02`
- **Mục tài liệu cần đọc:** `AGENTS.md` (§6A.8, §7, §8), `HANDOFF` (mục 4, 5, 9), `docs/TRACEABILITY.md`, `docs/openapi.yaml`
- **Phạm vi file được sửa:** `wireframes/` (xóa), `docs/WIREFRAME-BRIEF.md` (xóa), `eslint.config.mjs`, `tsconfig.json`, `docs/TRACEABILITY.md`, `docs/UAT-CHECKLIST.md`, `tests/e2e/reminders.spec.ts`
- **Tiêu chí chấp nhận:**
  1. Vượt toàn bộ cổng CI (`openapi:check`, `typecheck`, `lint`, `arch:check` `345` modules / `1,677` deps, `test:unit` `57` files / `301` tests, `test:integration` `19` files / `32` tests, `next build` `42` routes, `test:e2e` `44/44` Chrome E2E gồm kiểm tra mobile overflow `375x812` & bỏ skip `/favicon.ico`).
  2. Đối chiếu lại đủ `18` mã quyền `PERMISSIONS`, `AC-01`..`AC-22`, che PII/task ẩn `404`, sao lưu & khôi phục trên `beam_test`.
  3. Cập nhật `docs/TRACEABILITY.md` khớp `100%` FR/AC/CR/endpoint hiện tại và xuất `docs/UAT-CHECKLIST.md` phục vụ 5–10 thành viên dùng thử (`HANDOFF §9`).
  4. Auditor ngữ cảnh sạch có shell thẩm định độc lập chốt **`VERDICT: PASS`** (`0` Blocker, `0` Major, `0` Minor; Checklist `6A.8` đạt `13/13`).
- **Kiểm thử bắt buộc:** Đủ `8/8` cổng CI + `db:backup` & `db:restore:verify` trên `beam_test`.
- **Ngoài phạm vi:** Sửa `src/app/forbidden/page.tsx` hoặc chạm production.
- **Mức rủi ro:** Cao (`[RỦI RO CAO]`)
- **Trạng thái:** `Done` (đã duyệt & merge vào `main`)

### E9-04
- **ID:** `E9-04`
- **Tiêu đề:** Hotfix CI GitHub Actions — Tương thích khôi phục `pg_dump 17+` vào `PostgreSQL 16` (`transaction_timeout`) & đồng bộ seed danh mục kiểm thử `[RỦI RO CAO]`
- **Sub-agent phụ trách:** `Coordinator` + `backend-db` + `qa-reviewer` (ngữ cảnh sạch)
- **Liên quan:** `NFR-06`, `E9-01`, `.github/workflows/ci.yml`
- **Phụ thuộc:** `E9-03` (`Done`, merged `main`)
- **Mục tài liệu cần đọc:** `AGENTS.md` (§0, §3, §6A, §8), `.github/workflows/ci.yml`, `scripts/db-cli.mjs`, `scripts/db-backup.mjs`, `scripts/db-restore-verify.mjs`, `tests/integration/db/backup-restore.test.ts`
- **Phạm vi file được sửa:** `.github/workflows/ci.yml`, `scripts/db-cli.mjs`, `scripts/db-backup.mjs`, `scripts/db-restore-verify.mjs`, `tests/unit/shared/db-cli.test.ts`, `tests/integration/db/backup-restore.test.ts`, `tests/integration/auth/auth-routes.test.ts`, `docs/BACKLOG.md`, `docs/STATUS.md`
- **Tiêu chí chấp nhận:**
  1. `resolvePgToolRunner` ưu tiên binary `pg_dump`/`psql` khớp major version của PostgreSQL server đích khi máy host có cài sẵn (`/usr/lib/postgresql/<major>/bin`, Homebrew `postgresql@<major>`).
  2. Khi `pg_dump` mới hơn (`17+`) xuất ra `SET transaction_timeout = 0;` nhưng PostgreSQL đích là `< 17` (`server_version_num < 170000`), cả luồng xuất backup lẫn luồng `runPsqlFromFile` đều chuẩn hóa/bỏ qua an toàn tham số GUC chưa hỗ trợ ở phần preamble mà không làm hỏng dữ liệu `COPY` hay chuỗi người dùng.
  3. `.github/workflows/ci.yml` chạy `npm run db:seed -- --test` sau `db:migrate -- --test` (kiểm chứng luôn `db/seed.sql` trên CI), đồng thời `backup-restore.test.ts` tự đảm bảo idempotent `18` `permissions` & `3` `permission_presets` để chạy độc lập kể cả trên DB mới chỉ `db:migrate`.
  4. Có unit test & integration test tái hiện trực tiếp file dump chứa `SET transaction_timeout = 0;` khôi phục sạch trên PostgreSQL 16 với `ON_ERROR_STOP=1`; vượt đủ cổng CI và `qa-reviewer` ngữ cảnh sạch đạt `VERDICT: PASS`.
- **Kiểm thử bắt buộc:** `tests/unit/shared/db-cli.test.ts`, `tests/integration/db/backup-restore.test.ts`, toàn bộ `typecheck`, `lint`, `arch:check`, `openapi:check`, `test:unit`, `test:integration`, `build`.
- **Ngoài phạm vi:** Chạm môi trường production hoặc tự merge khi chưa được chủ dự án duyệt.
- **Mức rủi ro:** Cao (`[RỦI RO CAO]`)
- **Trạng thái:** `Chờ chủ dự án duyệt merge` (nhánh `fix/ci-pg16-backup-restore` — `58/58` unit tệp / `312` test, `19/19` integration tệp / `33` test, `next build` `42/42` route, `qa-reviewer` ngữ cảnh sạch `VERDICT: PASS` `13/13` mục `6A.8`)

---

## Epic E10 — Triển khai Production Miễn phí & Tự động hóa Email Nhắc hạn (`HANDOFF §7, §9, §10`) *(Chờ chủ dự án duyệt danh sách item)*

### E10-01
- **ID:** `E10-01`
- **Tiêu đề:** Migration danh mục quyền nền tảng (`0007`), nâng cấp `db:migrate`, CLI khởi tạo Admin đầu tiên (`db:bootstrap-admin`) & CLI kiểm tra gửi mail thật (`smtp:verify`) `[RỦI RO CAO]`
- **Sub-agent phụ trách:** `backend-db` + `qa-reviewer` (ngữ cảnh sạch)
- **Liên quan:** `FR-04`, `FR-10`, `FR-17`–`FR-19`, `FR-30`, `NFR-08`, `HANDOFF` (§7.1, §8.1, §9, §10)
- **Phụ thuộc:** `E9` (`Done`, sau khi duyệt merge `main`)
- **Mục tài liệu cần đọc:** `AGENTS.md` (§0 #4, §6A, §7, §8), `HANDOFF` (mục 7, 8.1, 9, 10), `db/seed.sql`, `scripts/db-migrate.mjs`, `src/server/shared/password.ts`, `src/server/shared/mailer.ts`
- **Phạm vi file được sửa:** `db/migrations/0007_system_catalog_defaults.sql`, `scripts/db-migrate.mjs`, `scripts/db-bootstrap-admin.mjs`, `scripts/smtp-verify.mjs`, `package.json`, `tests/integration/db/schema-invariants.test.ts`, `tests/integration/db/backup-restore.test.ts`
- **Tiêu chí chấp nhận:**
  1. Tạo migration cộng thêm, idempotent `db/migrations/0007_system_catalog_defaults.sql` nạp sẵn `18` mã `permissions`, `3` `permission_presets` + `preset_permissions`, và `app_settings('reminders')` mặc định (`ON CONFLICT DO UPDATE / DO NOTHING`) — **tuyệt đối 0 tài khoản/board/task giả lập dev**, để CSDL Neon Production mới tạo chạy `db:migrate` là có đủ danh mục phân quyền.
  2. Nâng cấp `scripts/db-migrate.mjs` đối chiếu bảng `schema_migrations` để bỏ qua bản đã áp, ẩn thông tin nhạy cảm của URL trong log, và an toàn khi chủ dự án tự chạy với Direct URL của Neon.
  3. Thêm `npm run db:bootstrap-admin` (`scripts/db-bootstrap-admin.mjs` — chỉ dành cho chủ dự án tự chạy trên máy cá nhân): nhận thông tin Admin CLB đầu tiên qua biến môi trường/prompt ẩn, kiểm tra domain email hợp lệ, băm mật khẩu chuẩn `scrypt` khớp `src/server/shared/password.ts`, insert idempotent (`is_admin = true`, `is_active = true`, `must_change_password = true`) + cấp bộ quyền mặc định mà không ghi lộ mật khẩu/MSSV/email ra log.
  4. Thêm `npm run smtp:verify -- --to <email>` (`scripts/smtp-verify.mjs`) dùng `SmtpMailer` gửi 1 email kiểm tra song ngữ từ cấu hình `.env.local` để chủ dự án xác nhận thư vào thẳng hộp thư chính Gmail thật (`HANDOFF §9`) trước khi đưa biến môi trường lên Vercel.
- **Kiểm thử bắt buộc:** Integration test kiểm chứng migration `0007` trên DB sạch, unit/integration test cho logic `db-bootstrap-admin` & `smtp-verify` trên mock SMTP / `beam_test` (cấm chạm production).
- **Ngoài phạm vi:** Agent tự kết nối hoặc chạy lệnh lên Neon Production / Gmail thật của CLB (`AGENTS.md §0 #4`).
- **Mức rủi ro:** Cao (`[RỦI RO CAO]`)
- **Trạng thái:** `Chờ chủ dự án duyệt`

### E10-02
- **ID:** `E10-02`
- **Tiêu đề:** Ghim vùng Vercel Function `sin1` (Singapore), GitHub Actions Cron dự phòng/bấm tay (`0đ`) & Runbook Go-Live cầm tay chỉ việc (`docs/OPERATIONS.md`)
- **Sub-agent phụ trách:** `Coordinator` + `backend-db`
- **Liên quan:** `FR-02`, `FR-30`, `FR-31`, `AC-03`, `NFR-06`, `NFR-08`, `HANDOFF` (§7.1, §10)
- **Phụ thuộc:** `E10-01`
- **Mục tài liệu cần đọc:** `AGENTS.md` (§0 #4, §7), `HANDOFF` (mục 7.1, 7.3, 10), `vercel.json`, `.github/workflows/ci.yml`, `docs/OPERATIONS.md`
- **Phạm vi file được sửa:** `vercel.json`, `.github/workflows/daily-cron.yml`, `docs/OPERATIONS.md`, `README.md`
- **Tiêu chí chấp nhận:**
  1. Cập nhật `vercel.json` ghim `"regions": ["sin1"]` cùng khu vực Singapore với Neon `ap-southeast-1` để giảm độ trễ truy vấn trên gói Vercel Hobby miễn phí.
  2. Thêm `.github/workflows/daily-cron.yml` miễn phí trên GitHub Actions: hỗ trợ cả lịch tự động hằng ngày (`0 0 * * *` & `5 0 * * *` UTC, bỏ qua an toàn nếu chưa khai báo GitHub Secrets `PROD_APP_URL` / `CRON_SECRET`) lẫn nút bấm thủ công `workflow_dispatch` để Admin kích hoạt thử cron nhắc hạn & dọn Archive ngay trên giao diện GitHub (an toàn không gửi trùng nhờ `AC-03`).
  3. Bổ sung vào `docs/OPERATIONS.md` checklist triển khai thực tế từ A–Z với chi phí `0đ/tháng`: tạo Neon Free (Pooled vs Direct URL), cấu hình Gmail CLB + App Password 16 ký tự (và phương án thay thế Brevo SMTP Free khi có domain riêng), bảng biến môi trường Vercel, thứ tự migrate -> bootstrap Admin -> kiểm tra hộp thư chính.
- **Kiểm thử bắt buộc:** `lint`, `typecheck`, kiểm tra cú pháp JSON/YAML của `vercel.json` & `.github/workflows/daily-cron.yml`, `build`.
- **Ngoài phạm vi:** Thao tác trực tiếp trên dashboard Vercel/Neon/GitHub của CLB.
- **Mức rủi ro:** Trung bình
- **Trạng thái:** `Chờ chủ dự án duyệt`
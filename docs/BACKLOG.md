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
| **CR-04** | Kho lưu trữ tập trung (Archive): Task, User & Board + tự dọn 7/30/90 ngày, xóa vĩnh viễn, khôi phục (`A1`–`A5`, `[RỦI RO CAO]`) | Nâng cấp `Q39`, `S15` | In progress (đã duyệt) |
| **CR-03** | Giao task cho Ban (`task_departments`) + Email & Thông báo chuông (`A2`, `A3`, `[RỦI RO CAO]`) | Nâng cấp `FR-20`–`23` | Draft (sau CR-04) |
| **E6** | Lọc & tìm kiếm board/task nâng cao (kéo thả & priority 1–4 đã giao trong E5) | FR-22, FR-25, FR-27 | Backlog |
| **E7** | Bình luận, cờ task ẩn (`404`, lọc mọi nơi) | FR-24, FR-07, FR-26 | Backlog |
| **E7A** | Lịch sử hoạt động (`task_events`), hoàn tác + toast 10s (phần Thùng rác `S15` nâng cấp thành Kho Archive ở `CR-04`) | FR-60, FR-61, FR-62 | Backlog |
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

### CR-04 (`[RỦI RO CAO]`): Kho lưu trữ tập trung (Archive) cho Task, User & Board (`A1`–`A5`) *(In progress — đã duyệt trên `feat/CR04-archive-center`)*
- **`CR-04-01` (`backend-db`, `[RỦI RO CAO]` — `Ready`):** Migration cộng thêm `0004_archive_purged_and_retention.sql` (`purged_at` trên `tasks`, `boards`, `profiles`), cập nhật `docs/ERD.md`, `docs/openapi.yaml`, `schema.d.ts`, tạo module `archive` (`GET /archive` phân theo 3 nhóm có lọc quyền `task.delete`/`member.deactivate`/`board.delete` và che task ẩn `404`, `POST /archive/{type}/{id}/restore`, `DELETE /archive/{type}/{id}` [chỉ Admin: gắn `purged_at`, ẩn danh PII user có lịch sử thành `"Thành viên đã xóa"` giữ nguyên FK `task_events`/`audit_logs`, hoặc xóa vật lý DB user chưa có lịch sử], `GET/PUT /settings/archive-retention` [Admin chọn `null`/`7`/`30`/`90` ngày], `POST /internal/cron/archive-purge` [`CRON_SECRET`]).
- **`CR-04-02` (`frontend` — `Ready`):** Thêm mục điều hướng & trang `/archive` với 3 tab lọc (**Task**, **Thành viên**, **Board** — hiện theo quyền), thanh cấu hình hạn tự dọn (`Không tự xóa` / `7 ngày` / `30 ngày` / `90 ngày` chỉ Admin), nút **Khôi phục**, modal xác nhận **Xóa vĩnh viễn** (chỉ Admin), nhãn audit `archive.*` và đủ chuỗi `vi`/`en`.
- **`CR-04-03` (`qa-engineer`, `[RỦI RO CAO]` — `Ready`):** Unit test policy/service + DB integration test + Chrome E2E kiểm tra phân quyền từng tab, task ẩn `404`, khôi phục, Admin purge (ẩn danh PII user có lịch sử vs xóa vật lý user sạch), Cron tự dọn đúng hạn `7`/`30`/`90` ngày, và audit `6A.8` đạt `VERDICT: PASS`.

### CR-03 (`[RỦI RO CAO]`): Giao task cho Ban (`task_departments`) & Thông báo (`A2`, `A3`, `A5`) *(Draft — sau `CR-04`)*
- Lưu bảng `task_departments`, hiển thị badge Ban trên thẻ, thành viên Ban thấy ở `Task của tôi`, được sửa/kéo thả nếu có `task.update_assigned`, xem task ẩn giao cho Ban và nhận nhắc deadline; thu gọn picker chọn từng thành viên; tự động gửi Email (SMTP CLB) + Thông báo trong web (chuông topbar, đánh dấu đã đọc) khi giao task cho Ban kèm checkbox bật/tắt.

# Nhật ký quyết định kỹ thuật & nghiệp vụ (DECISIONS)

## 2026-11-23 · Mô hình multi sub-agents và đồng bộ AGENTS.md v1.4 (Q40, Q41)
Bối cảnh: `docs/HANDOFF-club-management-website.md` v1.4 chuyển sang mô hình multi sub-agents nhưng `AGENTS.md` cũ (v1.3) vẫn viết cho 1 agent đơn lẻ và không có cấu hình vai trò trong repo.
Đề xuất / quyết định: Chốt cơ cấu **1 Coordinator + 3 sub-agent chuyên trách** (`backend-db`, `frontend`, `qa-reviewer` ngữ cảnh sạch). Cập nhật `AGENTS.md` lên v1.4 (giữ gọn < 22,5 KB để nạp đầy đủ không bị cắt), bổ sung `.agents/skills/` cho 4 vai trò và quy tắc chạy song song (chỉ khi không chồng lấn vùng file và `docs/openapi.yaml` đã khóa).
Ảnh hưởng (openapi, schema, tài liệu): `AGENTS.md`, `.agents/skills/*`, `docs/BACKLOG.md`, `docs/STATUS.md`.
Trạng thái: Đã duyệt bởi chủ dự án

## 2026-11-23 · Chốt tech stack cốt lõi cho ứng dụng và kiểm tra kiến trúc
Bối cảnh: `AGENTS.md` mục 1 để ngỏ ORM, cơ chế session, framework test, server-state phía UI, thư viện kéo thả và công cụ kiểm tra kiến trúc.
Đề xuất / quyết định:
- Package manager: `npm`
- ORM & PostgreSQL (Neon / local dev): **Drizzle ORM**
- Session: **Bảng `sessions` trong PostgreSQL + opaque token hash + cookie `HttpOnly`/`Secure`/`SameSite`** (hỗ trợ chuẩn `SESSION_TTL_DEFAULT` 24h và `SESSION_TTL_REMEMBER` 30 ngày trượt, kiểm tra `is_active` & quyền từ DB mỗi request, dễ mở rộng đăng xuất mọi thiết bị giai đoạn 2)
- i18n: **`next-intl`** (`messages/vi.json`, `messages/en.json`)
- Kiểm thử: **Vitest** (unit, integration) + **Playwright** (E2E)
- Giao diện: **TanStack Query** (server state, optimistic update) + **React Hook Form** + **Zod** (dùng chung schema client/server) + **`@dnd-kit`** (kéo thả Kanban thân thiện mobile) + **`sonner`** (toast Hoàn tác 10 giây)
- Kiểm tra kiến trúc (6A.10): **`dependency-cruiser`** + **ESLint** (độ phức tạp, kích thước hàm/tệp, `no-explicit-any`) + TypeScript `strict`
Ảnh hưởng (openapi, schema, tài liệu): Thêm bảng `sessions` vào ERD/DDL (0B); cập nhật `AGENTS.md` v1.4; dùng cho Epic E1+.
Trạng thái: Đã duyệt bởi chủ dự án

## 2026-11-23 · Chốt nghiệp vụ Lịch sử hoạt động, Hoàn tác & Thùng rác (Q36–Q39, WQ-32, WQ-33)
Bối cảnh: HANDOFF v1.4 có Q36–Q39 chờ chốt và ghi nhận xung đột giữa Q39 (giữ mãi trong Thùng rác ở MVP) với giả định tạm trên wireframe S15 (`WQ-32`: tự dọn sau 30 ngày).
Đề xuất / quyết định:
- **Q36:** Chọn **Phương án A** — bảng `task_events` chỉ ghi thêm (`append-only` chặn ở cả tầng ứng dụng và trigger CSDL) được service ghi trong cùng transaction; hoàn tác bằng Command (`apply`/`invert`) + Registry.
- **Q37:** Phạm vi hoàn tác gồm sửa trường, đổi cột/vị trí, đổi assignee, bật/tắt ẩn, xóa mềm/khôi phục (không gồm comment và `audit_logs`); cửa sổ toast Hoàn tác nhanh **10 giây**.
- **Q38:** Mọi tài khoản có quyền xem task đó đều xem được lịch sử của task (vẫn áp dụng policy task ẩn 404 và ẩn MSSV/email).
- **Q39 (thay thế `WQ-32`):** Task đã xóa mềm **giữ mãi trong Thùng rác ở MVP** (chưa xóa vĩnh viễn, không tự dọn sau 30 ngày); đã cập nhật lại wireframe `s15-trash.html` và `wireframes/_build/screens/system.mjs`.
- **WQ-33:** Khôi phục task mà cột cũ đã bị xóa thì đưa về cột đầu tiên của board và ghi `task_events`.
Ảnh hưởng (openapi, schema, tài liệu): `wireframes/s15-trash.html`, `wireframes/_build/screens/system.mjs`, schema `task_events` & `tasks.deleted_at`, endpoints `/tasks/{id}/events*`, `/boards/{id}/trash`, `/tasks/{id}/restore`.
Trạng thái: Đã duyệt bởi chủ dự án

## 2026-11-23 · Chốt các câu hỏi mở giai đoạn 0A từ wireframe (`WQ-01`..`WQ-35`)
Bối cảnh: Cần đóng toàn bộ câu hỏi mở tại `wireframes/OPEN-QUESTIONS.md` để hoàn tất giai đoạn 0A trước khi chốt ERD (0B) và OpenAPI (0C).
Đề xuất / quyết định:
- **Nhóm Cao:**
  - `WQ-02`: 1 board thuộc **tối đa 1 ban** (`boards.department_id` nullable FK; board không gắn ban là board chung CLB).
  - `WQ-05`: Xóa cột còn task → chặn (`409`), yêu cầu chuyển task sang cột khác trước.
  - `WQ-06`: Áp mẫu quyền → **thay thế toàn bộ** quyền hiện tại của tài khoản (giao diện xác nhận rõ số quyền thêm/bỏ).
  - `WQ-10`: Xóa ban còn thành viên hoặc board → chặn (`409`), cho phép chuyển dữ liệu trước.
  - `WQ-09`, `WQ-15`: Sau đăng nhập chuyển về `returnTo` nếu là **path nội bộ hợp lệ**; chặn tuyệt đối URL ngoài (chống open-redirect), mặc định về danh sách board (S03).
  - `WQ-21`: Không cho đổi MSSV (`profiles.student_id`) sau khi đã tạo thành viên (khóa cả ở UI và DB trigger).
  - `WQ-27`: Email nhắc task ẩn chỉ gửi cho người được xem task đó và **không hiển thị tiêu đề task ẩn** trong nội dung email (khớp nguyên tắc wireframe).
- **Nhóm Vừa & Thấp:**
  - `WQ-12`: Hạn task (`due_at`) nhập **ngày** (lưu `timestamptz` ứng với `00:00 UTC+7` của ngày đó), không có bộ chọn giờ ở MVP.
  - `WQ-19`: Đổi công tắc ngôn ngữ trên giao diện **tự lưu vào `profiles.locale`** (đồng bộ ngôn ngữ email nhắc).
  - Các câu `WQ-01`, `WQ-03`, `WQ-04`, `WQ-11`, `WQ-13`, `WQ-16`, `WQ-18`, `WQ-23`, `WQ-25`, `WQ-28`, `WQ-30`, `WQ-31`, `WQ-34`, `WQ-35` (và nhóm đã khớp HANDOFF `WQ-07`, `WQ-08`, `WQ-14`, `WQ-17`, `WQ-20`, `WQ-22`, `WQ-24`, `WQ-26`, `WQ-29`): giữ đúng theo giả định đã chốt trong `wireframes/OPEN-QUESTIONS.md`.
Ảnh hưởng (openapi, schema, tài liệu): Đóng cổng 0A; khóa mô hình dữ liệu 0B và hợp đồng API 0C.
Trạng thái: Đã duyệt bởi chủ dự án

---

## Quyết định `CR-01` — Đăng nhập bằng mật khẩu cho toàn bộ tài khoản (`A4`, `A5`) — 2026-11-24

- **Ngữ cảnh:** Nâng cấp `FR-04` theo yêu cầu bảo mật từ chủ dự án (`A4`, `A5`): áp dụng mật khẩu đồng nhất cho toàn bộ tài khoản (`admin` và `member`), giữ giới hạn thử theo IP và session TTL (`24h`/`30 ngày`).
- **Quyết định kỹ thuật:**
  1. **Lưu trữ & băm mật khẩu (`0002_passwords.sql`):** Thêm cột cộng thêm `password_hash text NULL` và `must_change_password boolean NOT NULL DEFAULT false` vào `profiles`. Băm mật khẩu bằng `Node crypto.scrypt` (`N=16384, r=8, p=1, keylen=64`, salt 16 byte ngẫu nhiên) và so sánh thời gian hằng số (`timingSafeEqual`). Khi MSSV không tồn tại, đã khóa hoặc chưa có hash vẫn thực thi kiểm tra với `DUMMY_PASSWORD_HASH` trước khi trả `401 INVALID_CREDENTIALS`.
  2. **Chính sách mật khẩu dùng chung (`src/lib/auth.ts`):** Mật khẩu mới tối thiểu `8`, tối đa `128` ký tự và không chấp nhận toàn khoảng trắng. Không ghi mật khẩu thô hay `password_hash` vào API DTO, URL, `audit_logs`, `task_events`, email nhắc hoặc `Logger` (`passwordhash` thêm vào `SENSITIVE_KEYS`).
  3. **Mật khẩu ban đầu khi tạo thành viên (`POST /api/v1/members`, `S09`):** Cho phép truyền `initialPassword` (`8..128`); nếu API bỏ trống sẽ dùng `Config.defaultInitialPassword` (`DEFAULT_INITIAL_PASSWORD` từ env; ở môi trường non-production mặc định `'BeamDev@2026'`, ở `production` bắt buộc cấu hình hoặc nhập tay), đồng thời đặt `must_change_password = true`. Seed dev (`db/seed.sql`) gán sẵn hash cho `'BeamDev@2026'`.
  4. **Tự đổi mật khẩu (`POST /api/v1/me/password`, `S08`):** Yêu cầu `currentPassword` và `newPassword`. Trả **`400 INVALID_CURRENT_PASSWORD`** nếu sai mật khẩu hiện tại (không dùng `401` để tránh cưỡng chế đăng xuất), thu hồi mọi `sessions` khác nhưng giữ nguyên session hiện tại, và tắt `must_change_password = false`. Khi đăng nhập lần đầu (`mustChangePassword = true`) mà không có `returnTo` tường minh, giao diện điều hướng tới `/profile?changePassword=1`.
  5. **Đặt lại mật khẩu (`POST /api/v1/members/{id}/reset-password`, `S09`):** **Chỉ Admin (`is_admin = true`) mới được đặt lại mật khẩu** cho tài khoản khác theo xác nhận bổ sung của chủ dự án (`2026-11-24`); mọi tài khoản không phải Admin (kể cả có `member.update`) bị chặn `403 FORBIDDEN`. Đặt lại `password_hash`, bật `must_change_password = true`, thu hồi toàn bộ `sessions` đang mở của mục tiêu và ghi `audit_logs` (`action = 'member.password_reset'`) không kèm mật khẩu/hash.
- **Ảnh hưởng (`openapi`, `schema`, tài liệu):** Cộng thêm trên `docs/ERD.md`, `db/migrations/0002_passwords.sql`, `docs/openapi.yaml` (`MemberDetail.mustChangePassword`, `LoginRequest.password`, `CreateMemberRequest.initialPassword`, `POST /me/password`, `POST /members/{id}/reset-password`).
- **Trạng thái:** Đã duyệt bởi chủ dự án (`1. Duyệt / 2. Duyệt`, 2026-11-24).

---

## Quyết định `CR-04` — Kho lưu trữ tập trung (Archive) cho Task, User & Board (`A1`–`A5`) — 2026-11-24

- **Ngữ cảnh:** Nâng cấp quyết định `Q39` và màn hình Thùng rác `S15` (`E7A`) theo phản hồi trải nghiệm thực tế của chủ dự án: bổ sung Kho lưu trữ (Archive) tập trung với tùy chọn khôi phục, tự động dọn theo hạn (1 tuần / 1 tháng / 3 tháng) hoặc xóa vĩnh viễn ngay.
- **Quyết định nghiệp vụ & kiến trúc (`A1`–`A5` đã chốt với chủ dự án):**
  1. **Phạm vi đối tượng (`A1`):** Gộp chung 3 nhóm vào một Kho lưu trữ (`/archive`) kèm tab lọc: **Task đã xóa mềm** (`tasks.deleted_at IS NOT NULL`), **Thành viên đã khóa/xóa** (`profiles.is_active = false`), và **Board đã lưu trữ** (`boards.archived_at IS NOT NULL`).
  2. **Thời hạn tự dọn & thao tác (`A2`):** Admin cấu hình hạn tự dọn mặc định (`null` = không tự xóa | `7` | `30` | `90` ngày) trong `app_settings` (`key = 'archive_retention'`, payload `{ retentionDays }`), chạy định kỳ mỗi ngày qua Cron (`POST /api/v1/internal/cron/archive-purge` bảo vệ bằng `CRON_SECRET`, ghi tóm tắt cấu trúc qua `Logger` vì `audit_logs.actor_id` bắt buộc khác null); trong Kho lưu trữ có sẵn nút **Khôi phục (Restore)** và **Xóa vĩnh viễn ngay (Purge)**.
  3. **Purge an toàn & bảo toàn lịch sử (`A3`, `0004_archive_purged_and_retention.sql`):**
     - Với Task / Board đã xóa mềm hoặc lưu trữ: đánh dấu `purged_at = now()` để xóa vĩnh viễn khỏi Kho lưu trữ và mọi màn hình nghiệp vụ (`404`, khóa khôi phục ngược lại qua trigger `prevent_entity_unpurge`), đồng thời khi purge Board sẽ dọn `department_id = NULL` (giải phóng ban) và đánh dấu `deleted_at`/`purged_at` cho các task còn nằm trên board đó mà vẫn giữ nguyên `task_events`/`audit_logs` `ON DELETE RESTRICT` + `append-only`.
     - Với User đã khóa (`is_active = false`): xóa các bản ghi sở hữu phụ thuộc trực tiếp (`sessions`, `member_departments`, `user_permissions` nơi `user_id = targetId`) rồi kiểm tra tham chiếu lịch sử trên `audit_logs`, `task_events`, `tasks`, `task_assignees`, `comments`, `boards`, `reminders`, `app_settings`, `club_assets`, `user_permissions(granted_by)`. Nếu có tham chiếu lịch sử: **ẩn danh toàn bộ PII & gắn `purged_at = now()`** (`full_name = 'Thành viên đã xóa'`, `student_id = 'PURGED-' || id::text`, `email = 'purged+' || id::text || '@redacted.local'`, `password_hash = NULL`, `must_change_password = false`, xóa avatar & `is_admin = false`), cập nhật hàm trigger `prevent_student_id_change()` để chỉ mở ngoại lệ duy nhất cho chuyển đổi một chiều này và chặn mọi thao tác bỏ purge (`ALREADY_PURGED`). Nếu **không có** tham chiếu lịch sử nào: thực hiện **xóa vật lý (`DELETE FROM profiles`)** và ghi `audit_logs` với `target_user_id = NULL`.
  4. **Phân quyền (`A4`):** Người có quyền xóa/khóa loại đối tượng nào (`task.delete`, `member.deactivate`, `board.delete`, hoặc `is_admin = true`) được xem và khôi phục loại đối tượng đó (task ẩn `is_hidden=true` vẫn tiếp tục lọc chặt `404` đối với người không phải assignee / creator / admin, kể cả trước thông báo lỗi quyền/trạng thái; khôi phục task kiểm tra board còn hoạt động và áp dụng fallback cột đầu tiên `WQ-33`); **riêng thao tác Xóa vĩnh viễn (Purge) và Cấu hình hạn tự dọn chỉ dành cho Admin (`is_admin = true`)**.
  5. **Thứ tự ưu tiên (`A5`):** Hoàn tất `CR-02B` (đã merge `main`) -> **`CR-04`** (Kho lưu trữ Archive, gộp/nâng cấp phần Thùng rác `S15` từ `E7A`) -> **`CR-03`** (Giao task theo Ban & Thông báo).
- **Ảnh hưởng (`openapi`, `schema`, tài liệu):** Cộng thêm `db/migrations/0004_archive_purged_and_retention.sql` (`purged_at` trên `profiles`/`boards`/`tasks`, `app_settings('archive_retention')`), `docs/ERD.md`, `src/lib/archive.ts`, `docs/openapi.yaml` (`/archive`, `/archive/{type}/{id}/restore`, `/archive/{entityType}/{id}`, `/settings/archive-retention`, `/internal/cron/archive-purge`); nâng cấp `HANDOFF Q39`.
- **Trạng thái:** Đã duyệt phương án bởi chủ dự án (`A1`–`A5`, 2026-11-24); đang triển khai trên nhánh `feat/CR04-archive-center`.

---

## Quyết định `CR-02` — Logo CLB & Ảnh đại diện thành viên (`A1`, `A5`) — 2026-11-24

- **Ngữ cảnh:** Bổ sung khả năng nhận diện thương hiệu (Admin đổi Logo CLB) và cá nhân hóa thành viên (ảnh đại diện ở `S08`, `S09`, danh bạ, thẻ task), tự động hiển thị chữ cái đầu với bảng màu đa sắc đồng nhất khi thành viên chưa tải ảnh.
- **Quyết định kỹ thuật:**
  1. **Lưu trữ trong PostgreSQL `bytea` (`0003_branding_and_avatars.sql`):**
     - Tạo bảng `club_assets (key PK, mime_type, data bytea, updated_by, created_at, updated_at)` lưu tài nguyên `'club_logo'`.
     - Thêm 3 cột cộng thêm trên `profiles`: `avatar_data bytea NULL`, `avatar_mime text NULL`, `avatar_updated_at timestamptz NULL`.
     - Ràng buộc `CHECK` tại CSDL: kích thước mỗi ảnh `<= 262.144 byte` (`256 KB`), chỉ cho phép `image/png`, `image/jpeg`, `image/webp`.
  2. **Chống XSS & kiểm tra định dạng phía máy chủ (`src/server/shared/media.ts`):** Cấm tuyệt đối SVG/XML/HTML; giải mã base64 từ JSON `{ dataUrl }` (`ImageUploadRequest`), kiểm tra kích thước `<= 256 KB` và đối chiếu **magic bytes** thực tế (PNG/JPEG/WEBP) khớp với MIME khai báo. Khi trả ảnh nhị phân (`GET /branding/logo`, `GET /members/{id}/avatar`), luôn gắn header `X-Content-Type-Options: nosniff` và `Content-Security-Policy: default-src 'none'; sandbox`.
  3. **Hiệu năng danh sách (`avatarUrl`):** Các truy vấn danh sách thành viên/task/board/audit chỉ đọc `avatar_updated_at` (không đọc `avatar_data bytea`) để sinh `avatarUrl` có tham số phiên bản (`?v=<epoch_ms>`) hoặc `null`. Khi không có ảnh, UI dựng chữ cái đầu tên + màu nền trích xuất từ bảng `AVATAR_PALETTE` (`src/lib/media.ts`) theo hash ổn định.
  4. **Phân quyền & dấu vết:** Đọc Logo công khai (để hiện ở `S01` trước đăng nhập), chỉ **Admin** được sửa/xóa Logo (`PUT/DELETE /branding/logo`); mọi tài khoản active tự đổi/xóa ảnh cá nhân (`PUT/DELETE /me/avatar`); `member.update` hoặc Admin đổi/xóa ảnh cho thành viên (`PUT/DELETE /members/{id}/avatar`). Mọi cập nhật/xóa ghi `audit_logs` (`branding.logo_updated`, `branding.logo_removed`, `member.avatar_updated`, `member.avatar_removed`) chỉ kèm `mimeType`/`byteLength`, tuyệt đối không ghi dữ liệu ảnh hoặc PII.
- **Ảnh hưởng (`openapi`, `schema`, tài liệu):** Cộng thêm `docs/ERD.md` (19 bảng miền), `db/migrations/0003_branding_and_avatars.sql`, `docs/openapi.yaml`.
- **Trạng thái:** Đã duyệt bởi chủ dự án (`2026-11-24`).

---

## Quyết định `CR-02B` — Điều hướng gốc `/login`, Chặn Admin tự gỡ quyền Admin & Tinh gọn bố cục (`A1`–`A3`) — 2026-11-24

- **Ngữ cảnh:** Khắc phục phản hồi trải nghiệm trực tiếp từ chủ dự án & chủ CLB:
  1. Truy cập `/` chưa đăng nhập phải đi thẳng tới `/login` thay vì hiển thị trang chào mẫu.
  2. Admin không được phép tự gỡ cờ `is_admin` của chính mình (ngay cả khi hệ thống đang có từ 2 Admin trở lên).
  3. Căn chỉnh bố cục toàn hệ thống khoa học, giảm rối mắt tại `S03`–`S10`.
- **Quyết định kỹ thuật:**
  1. **Điều hướng gốc `/` (`src/app/page.tsx`):** Server Component đọc cookie `beam_session` và xác thực phiên thực tế qua `authService.authenticateSession(token)`; chưa đăng nhập hoặc phiên hết hạn chuyển hướng ngay sang `/login`, đã đăng nhập chuyển sang `/boards` (hoặc `/profile?changePassword=1` nếu `mustChangePassword = true`).
  2. **Chặn Admin tự gỡ quyền Admin (`PUT /api/v1/members/{id}/admin`):** Bổ sung quy tắc miền trong `permissions/policy.ts` + `service.ts`: nếu `actor.id === targetUserId && !nextIsAdmin`, từ chối ngay **`409 CANNOT_REVOKE_OWN_ADMIN`** (ưu tiên trước `LAST_ACTIVE_ADMIN`, không ghi `audit_logs`, không sửa DB). Quy tắc `LAST_ACTIVE_ADMIN` (`AC-09`) vẫn giữ nguyên cho trường hợp khóa thành viên, hạ quyền Admin khác và trigger PostgreSQL. Trên `S10` (`AdminFlagPanel`), khóa nút gỡ Admin khi `isSelf && isAdmin` kèm ghi chú rõ ràng.
  3. **Tinh gọn bố cục toàn hệ thống (`S03`–`S10`):** Chuyển `ActionMenu` (`⋯`) thành component dùng chung cho bảng quản trị thành viên `S09`; bỏ banner thừa và bố trí ma trận quyền `S10` thành lưới 2 cột cân đối kèm thanh lưu cô đọng; cân tỷ lệ cột và khoảng đệm đồng nhất trên `S08`, `S03`–`S06`; bổ sung invalidate query cache (`boardDetail`, `taskDetail`, `myTasks`) khi đổi ảnh đại diện và hiển thị metadata `branding`/`avatar` ở `AuditDetailPane`.
- **Ảnh hưởng (`openapi`, `schema`, tài liệu):** Cập nhật mô tả `PUT /members/{id}/admin` trong `docs/openapi.yaml` (cộng thêm `409 CANNOT_REVOKE_OWN_ADMIN`), không đổi schema CSDL.
- **Trạng thái:** Đã duyệt bởi chủ dự án (`A1`–`A3`, 2026-11-24).

---

## Quyết định `CR-03` — Giao task cho Ban (`task_departments`) & Email/Thông báo chuông (`A2`, `A3`, `A5`) — 2026-11-24

- **Ngữ cảnh:** Theo trải nghiệm thực tế của chủ CLB, giao việc theo **Ban** là luồng chính thường dùng, trong khi giao cho từng thành viên là tùy chọn phụ trợ; khi giao việc cho Ban cần có tùy chọn gửi thông báo và email tới từng thành viên thuộc ban đó.
- **Quyết định kỹ thuật:**
  1. **Cơ sở dữ liệu (`0005_task_departments_and_notifications.sql`):**
     - Bảng `task_departments (task_id FK tasks CASCADE, department_id FK departments RESTRICT, created_at)` với khóa chính kép `(task_id, department_id)` và index `task_departments_department_id_idx`.
     - Bảng `notifications (id PK, user_id FK profiles RESTRICT, type CHECK ('task.department_assigned', 'task.assigned'), task_id FK tasks CASCADE, board_id FK boards CASCADE, department_id FK departments SET NULL, actor_id FK profiles RESTRICT, is_hidden_task, payload jsonb, read_at, created_at)`.
  2. **Chính sách quyền & hiển thị dùng chung:**
     - `AuthActor` đọc tươi `departmentIds` của thành viên từ DB mỗi request (`authService.authenticateSession`).
     - Thành viên đang hoạt động thuộc bất kỳ ban nào trong `task_departments` được coi là thành viên được giao task ở mọi lớp: `taskVisibilityPolicy` (xem được task `is_hidden = true` giao cho ban mình; rời ban mất quyền xem ngay -> `404`), `canEditTask` (sửa/kéo thả với `task.update_assigned`), `/me/tasks`, và lọc `departmentId` trên `/tasks` và `/me/tasks`.
     - Ghi `department_ids` (chỉ UUID, không tên ban/PII) vào `task_events.changes` (`task.created` & `task.assignees_changed`), giữ append-only.
     - Khi Archive purge task/board hoặc purge user (`CR-04`), dọn `task_departments` của task bị purge và `notifications` sở hữu bởi user bị purge; vẫn kiểm tra tham chiếu `notifications.actor_id` trong `hasProfileHistoryReferences`.
  3. **Gửi Email SMTP & Thông báo in-app (`SmtpMailer` + `Mailer` port):**
     - Bổ sung `SmtpMailer` thuần Node (`node:net` / `node:tls`, hỗ trợ SMTPS 465 / STARTTLS 587, `AUTH PLAIN`/`LOGIN`, tiêu đề RFC 2047 UTF-8 Base64, timeout `10s`) thực thi port `Mailer` sẵn có, không thêm thư viện ngoài; tự động fallback về `NoopMailer` khi chưa cấu hình `SMTP_HOST`.
     - Khi `notifyDepartmentMembers` (mặc định `true`) bật và có ban mới được thêm vào task, gửi 1 thông báo `notifications` + 1 email song ngữ theo `profiles.locale` tới từng thành viên hoạt động của các ban vừa gán (khử trùng lặp nếu thuộc nhiều ban). Lỗi SMTP được ghi log cấu trúc qua `Logger` (không PII) và không rollback mutation task.
     - Bảo mật `WQ-27`: Với task ẩn (`is_hidden = true`), **không đưa tiêu đề task** vào email lẫn `notifications.payload.taskTitle = null` (UI hiển thị thông báo chung về task ẩn; không bao giờ kèm MSSV/email người khác).
- **Ảnh hưởng (`openapi`, `schema`, tài liệu):** Cộng thêm `docs/ERD.md` (21 bảng miền), `db/migrations/0005_task_departments_and_notifications.sql`, `src/lib/notifications.ts`, `docs/openapi.yaml`.
- **Trạng thái:** Đã duyệt bởi chủ dự án (`A2`, `A3`, `A5`, 2026-11-24); đã hoàn tất & merge vào `main`.

---

## Quyết định `CR-06` (`[RỦI RO CAO]`) — Mở rộng trình chỉnh sửa Task 2 cột & Tách riêng tùy chọn Thông báo / Email (`A1`–`A3`) — 2026-11-25

- **Ngữ cảnh:** Giao diện chỉnh sửa task `TaskDetailDrawer` hẹp (`580px`) và checkbox gửi thông báo nằm chung trong khung `Giao cho Ban` khiến người dùng khó hiểu; chủ CLB yêu cầu mở rộng không gian chỉnh sửa task và tách thành khu vực **Tùy chọn gửi thông báo** riêng gồm hai kênh độc lập (**Thông báo trên web** và **Gửi email**) áp dụng cho cả Ban lẫn thành viên lẻ mới được gán.
- **Quyết định kỹ thuật (đã hợp nhất với chuẩn `CR-03` trên `main`):**
  1. **Hợp đồng API & Schema Zod dùng chung (`docs/openapi.yaml`, `src/lib/tasks.ts`):**
     - Bổ sung cộng thêm hai cờ tùy chọn `notifyInApp?: boolean` và `notifyEmail?: boolean` trên `CreateTaskRequest` (`POST /api/v1/tasks`) và `ReplaceTaskAssigneesRequest` (`PUT /api/v1/tasks/{id}/assignees`), giữ nguyên hỗ trợ cập nhật từng phần `assigneeIds` / `departmentIds` và giữ nguyên cấu trúc phẳng của `NotificationDto` + `NotificationReadAllResponse.updatedCount`.
     - Giữ `notifyDepartmentMembers` (mặc định `true`) để bảo toàn tương thích ngược qua `resolveTaskNotificationChannels`: nếu không truyền `notifyInApp`/`notifyEmail`, kế thừa giá trị từ `notifyDepartmentMembers ?? true`.
  2. **Phạm vi phát thông báo & khử trùng lặp (`tasks` + `notifications`):**
     - Mở rộng `runTaskAssigneesInTx` trả về đồng thời `addedDepartmentIds` và `addedAssigneeIds`; cả `createTask` lẫn `replaceAssignees` gửi tới thành viên hoạt động của các Ban mới gán (`type: 'task.department_assigned'`) lẫn thành viên lẻ mới gán (`type: 'task.assigned'`, `departmentId = null`, `departmentName = null`).
     - Loại trừ `actorId` khỏi tự nhận thông báo của chính thao tác mình vừa thực hiện, đồng thời khử trùng lặp mỗi người nhận tối đa `1` bản ghi thông báo chuông (khi `notifyInApp = true`) và tối đa `1` email SMTP (khi `notifyEmail = true`), ưu tiên `task.department_assigned` nếu vừa thuộc Ban vừa được gán trực tiếp.
     - Giữ nguyên toàn bộ bảo mật `WQ-27` (không đưa tiêu đề task ẩn vào email hay `NotificationDto.taskTitle = null` kể cả khi gán trực tiếp thành viên) và lọc PII (`scrubPiiText`) khi ghi log lỗi SMTP (`Error`/`AggregateError`). Không cần thêm migration CSDL mới vì `0005_task_departments_and_notifications.sql` đã hỗ trợ sẵn `'task.assigned'` và `department_id NULL`.
  3. **Bố cục UI `S04`/`S05`:**
     - Mở rộng `TaskDetailDrawer` thành 2 cột thoáng trên desktop (`~900px`: cột trái chi tiết & form chỉnh sửa, cột phải tóm tắt giao việc + khối phân công + thẻ độc lập `TaskNotificationOptions` + nút `Cập nhật giao việc`), và nới rộng `CreateTaskModal` (`720px` desktop).
- **Ảnh hưởng (`openapi`, `schema`, tài liệu):** Cập nhật cộng thêm `docs/openapi.yaml` (`src/features/shared/api/schema.d.ts`) và `src/lib/tasks.ts`; không đổi schema PostgreSQL.
- **Trạng thái:** Đã duyệt bởi chủ dự án (`A1`–`A3`, 2026-11-25); đã hoàn tất, đạt QA độc lập (`PASS`) & merge vào `main`.

---

## Quyết định `E6` — Bổ sung cộng thêm OpenAPI lọc/đếm Board & chuẩn hóa quá hạn Task — 2026-11-25

- **Ngữ cảnh:** Chuẩn bị triển khai Epic `E6` (`FR-22`, `FR-25`, `FR-27`, `AC-15`, `S03`, `S04`): cần tìm kiếm board phía server thay vì lọc client trên các trang đã tải, hiển thị số task/số task quá hạn trên từng thẻ board `S03` theo đúng quyền người xem (không lộ task ẩn), và thống nhất quy tắc cột cuối `Done` không tính quá hạn cả ở bộ lọc API lẫn huy hiệu UI.
- **Quyết định kỹ thuật:**
  1. **Tìm kiếm & đếm Board theo quyền xem (`GET /api/v1/boards`):**
     - Thêm tham số query tùy chọn `q` (`maxLength: 200`, `ilike` sau `escapeLikePattern` trên `boards.name`).
     - Thêm hai trường bắt buộc trên `BoardSummaryDto` (và kế thừa trên `BoardDetailDto`): `visibleTaskCount` & `overdueTaskCount` (`integer >= 0`), tính theo `visibleTaskSqlCondition` (`deleted_at IS NULL AND purged_at IS NULL` + `taskAccessSqlCondition` theo `AuthActor`), trong đó `overdueTaskCount` loại bỏ các task nằm ở cột cuối (`Done` — tên `'done'` không phân biệt hoa thường/khoảng trắng hoặc `orderIndex = max(order_index)` của board). Ở ngữ cảnh Kho lưu trữ (`archive`), mapper giữ mặc định `0` để không rò rỉ dữ liệu ẩn.
  2. **Chuẩn hóa `GET /api/v1/tasks?dueStatus=overdue`:** Tái sử dụng chung biểu thức `notDoneColumnSqlCondition` để loại bỏ các task ở cột cuối `Done` khỏi kết quả `dueStatus=overdue`, đồng nhất với `S04` wireframe và `/me/tasks`.
  3. **Nguồn sự thật SQL cho quyền xem task (`taskAccessSqlCondition`):** Tách hàm dùng chung `taskAccessSqlCondition` tại `src/server/modules/tasks/repository.ts` (export qua `src/server/modules/tasks/index.ts`) để cả `tasks/repository.ts` và `archive/repository.ts` dùng chung một biểu thức (xử lý ghi chú Minor từ QA `CR-03`).
- **Ảnh hưởng (`openapi`, `schema`, tài liệu):** Cập nhật cộng thêm `docs/openapi.yaml` (`GET /boards?q`, `BoardSummaryDto`, `BoardDetailDto`, mô tả `GET /tasks`), sinh lại `src/features/shared/api/schema.d.ts`; không thay đổi schema CSDL PostgreSQL.
- **Trạng thái:** Đã duyệt bởi chủ dự án (2026-11-25).

---

## Quyết định `CR-07` (`[RỦI RO CAO]`) — Trang Quản trị Giao diện CLB (`/admin/branding`) & Khung treo ảnh động trang Login (`A1`–`A4`) — 2026-11-26

- **Ngữ cảnh:** Nút chỉnh sửa Logo CLB đang đặt lẻ trong `/admin/members` nên Admin dễ bỏ sót, và chủ CLB muốn thay bảng Kanban minh họa ở cột trái trang `/login` (riêng trên **Desktop**, ẩn trên Mobile) thành khu **khung treo ảnh Polaroid động** có thể rê/kéo chuột ngang và bấm mũi tên xem thêm, cho phép Admin chỉnh sửa ảnh và nội dung đi kèm.
- **Quyết định kỹ thuật (`A1`–`A4` đã chốt cùng chủ dự án):**
  1. **CSDL cộng thêm (`db/migrations/0006_login_gallery.sql`):**
     - Thêm bảng `login_gallery_items` (`id uuid PK`, `title` `1..80` ký tự, `caption` tùy chọn `<= 240` ký tự, `mime_type` `image/png|jpeg|webp`, `data bytea` `<= 512 KB`, `order_index >= 0`, `updated_by` `ON DELETE SET NULL`, `created_at`, `updated_at` kèm trigger).
     - Giới hạn tối đa **12 khung ảnh** (kiểm tra với lock trong transaction, vượt giới hạn trả `409 GALLERY_LIMIT_REACHED`). Giữ nguyên kiểm tra magic bytes, chặn SVG, gắn header `X-Content-Type-Options: nosniff` + `CSP: default-src 'none'; sandbox`.
  2. **OpenAPI cộng thêm (`docs/openapi.yaml` + `schema.d.ts`):**
     - `GET /api/v1/branding` *(công khai)* giữ nguyên `logoUrl`/`updatedAt` và bổ sung `galleryItems` (chỉ metadata, không SELECT `bytea` ở danh sách).
     - `GET /api/v1/branding/gallery/{id}/image` *(công khai)* trả nhị phân ảnh theo ID (`404` nếu không tồn tại).
     - Chỉ Admin (`authorizeAdmin`, ghi `audit_logs` `branding.gallery_*` không nhị phân/PII): `POST /api/v1/branding/gallery`, `PATCH /api/v1/branding/gallery/{id}`, `DELETE /api/v1/branding/gallery/{id}`, `PUT /api/v1/branding/gallery/order`.
  3. **Giao diện `/admin/branding` & Khung treo ảnh Polaroid Desktop (`A1`, `A3`, `A4`):**
     - Bổ sung mục **Giao diện CLB** (`/admin/branding`, chỉ Admin) trong `ADMIN_NAV` để quản lý chung Logo CLB (`<= 256 KB`) và bộ sưu tập ảnh Login (`<= 512 KB`, tối đa 12 khung, sắp xếp/sửa/xóa), đồng thời gỡ nút `Logo CLB` lẻ khỏi `/admin/members`.
     - Bên trái trang `/login` (ẩn dưới `900px`, chỉ hiện trên Desktop) hiển thị dãy **khung Polaroid treo nghiêng nhẹ** (tone Hồng–Trắng–Đen BEAM), tự trôi chậm mượt (tạm dừng khi rê chuột, focus, đang kéo, hoặc `prefers-reduced-motion`) + kéo chuột ngang + nút mũi tên `<`/`>`. Mặc định hiển thị **4 khung minh họa mẫu BEAM** song ngữ khi Admin chưa tải ảnh thật nào, và chuyển ngay sang ảnh thật khi có ảnh đầu tiên.
- **Bổ sung theo phản hồi chủ dự án (2026-11-26 — Chữ ảnh `club_wordmark`, Tường gạch trưng bày & Footer `BEAM CLUB × Sang`):**
  1. **Ảnh chữ thương hiệu tùy chỉnh (`club_wordmark` — không thêm migration CSDL):** Dùng lại bảng `club_assets` với khóa `'club_wordmark'` (`<= 256 KB`, PNG/JPEG/WEBP). Cộng thêm `wordmarkUrl` (nullable) trên `BrandingResponse` (`GET /api/v1/branding`) và thêm `/api/v1/branding/wordmark` (`GET` công khai với `nosniff` + `CSP sandbox`, `PUT`/`DELETE` chỉ Admin kèm `audit_logs` `branding.wordmark_*`). Phía client hỗ trợ chọn cả file `.svg` (như `5.svg`) và rasterize thành PNG/WEBP trong suốt trước khi gửi lên server, giúp Admin tự chỉnh chữ ảnh toàn hệ thống (`AppShell` sidebar & `/login` Desktop/Mobile) tương tự Logo CLB.
  2. **Nền tường triển lãm & chữ ký collab (`/login`):** Tường gạch/thạch cao sáng có ánh đèn rọi & bóng khung Polaroid nổi bật trên Desktop (`>= 900px`), và chân trang `/login` hiển thị chữ ký `BEAM CLUB × Sang` gắn link Facebook chính thức (`target="_blank"`, `rel="noopener noreferrer"`).
- **Ảnh hưởng (`openapi`, `schema`, tài liệu):** Migration `0006_login_gallery.sql`, `db/schema/identity.ts`, `docs/ERD.md` (22 bảng), `docs/openapi.yaml` (`src/features/shared/api/schema.d.ts`).
- **Trạng thái:** Đã duyệt bởi chủ dự án (`A1`–`A4` + bổ sung 2026-11-26); đã hoàn tất, đạt QA độc lập (`VERDICT: PASS`) & merge vào `main`.

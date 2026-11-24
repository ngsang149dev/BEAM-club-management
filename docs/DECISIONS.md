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
  2. **Thời hạn tự dọn & thao tác (`A2`):** Admin cấu hình hạn tự dọn mặc định (`never` / `7d` / `30d` / `90d`) trong `app_settings` (`key = 'archive_retention'`), chạy định kỳ mỗi ngày qua Cron; trong Kho lưu trữ có sẵn nút **Khôi phục (Restore)** và **Xóa vĩnh viễn ngay (Purge)**.
  3. **Purge an toàn & bảo toàn lịch sử (`A3`):**
     - Với Task / Board / User đã phát sinh dữ liệu lịch sử (`task_events`, `audit_logs`, bình luận): **đánh dấu `purged_at`** để xóa vĩnh viễn khỏi Kho lưu trữ (không thể khôi phục hoặc xem lại ở bất kỳ màn hình nghiệp vụ nào) nhưng giữ nguyên toàn vẹn khóa ngoại & tính `append-only` của `task_events` / `audit_logs`. Riêng User có lịch sử sẽ được **ẩn danh toàn bộ PII** (`full_name = 'Thành viên đã xóa'`, ẩn danh `student_id`/`email`, xóa `password_hash`, thu hồi toàn bộ quyền, ban và phiên đăng nhập).
     - Với User **chưa từng phát sinh** bản ghi lịch sử/liên kết (`task_events`, `audit_logs`, task tạo/giao, bình luận, bảng): cho phép **xóa vật lý (`DELETE`)** trực tiếp dòng `profiles` khỏi PostgreSQL.
  4. **Phân quyền (`A4`):** Người có quyền xóa/khóa loại đối tượng nào (`task.delete`, `member.deactivate`, `board.delete`) được xem và khôi phục loại đối tượng đó (task ẩn `is_hidden=true` vẫn tiếp tục lọc chặt `404` đối với người không phải assignee / creator / admin); **riêng thao tác Xóa vĩnh viễn (Purge) và Cấu hình hạn tự dọn chỉ dành cho Admin (`is_admin = true`)**.
  5. **Thứ tự ưu tiên (`A5`):** Hoàn tất merge `CR-01` -> triển khai **`CR-02`** (Logo CLB & Avatar thành viên) -> **`CR-03`** (Giao task theo Ban & Thông báo) -> **`CR-04`** (Kho lưu trữ Archive, gộp/nâng cấp phần Thùng rác `S15` từ `E7A`).
- **Ảnh hưởng (`openapi`, `schema`, tài liệu):** Cộng thêm cột `purged_at` (khi mở `CR-04`), cấu hình `app_settings('archive_retention')`, bổ sung đường dẫn `/archive` & API purge/retention mới; `HANDOFF Q39` cần ghi chú nâng cấp từ `CR-04` khi bắt đầu item.
- **Trạng thái:** Đã duyệt phương án bởi chủ dự án (`A1`–`A5`, 2026-11-24); xếp lịch làm sau `CR-02` và `CR-03`.

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

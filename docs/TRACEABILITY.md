# Traceability Matrix (`docs/TRACEABILITY.md`)

Tài liệu truy vết hai chiều khởi tạo ở giai đoạn **0C (`E0-03`)** và cập nhật đồng bộ tới phát hành **`v1.0` (`E9`)**, liên kết toàn bộ yêu cầu chức năng (`FR-01`..`FR-62`), tiêu chí chấp nhận (`AC-01`..`AC-22`) và các yêu cầu thay đổi mở rộng (`CR-01`..`CR-07`) tới:
- Mã màn hình (`S01`, `S03..S15`, `E01` — `S02` đã bỏ; bộ wireframe thiết kế 0A `wireframes/` & `docs/WIREFRAME-BRIEF.md` đã gỡ khỏi repo ở `E9` sau khi hoàn thành dựng giao diện thật)
- Bảng CSDL (`docs/ERD.md`, `db/migrations/0001_initial_schema.sql`..`0006_login_gallery.sql` — 22 bảng miền + `schema_migrations`)
- Endpoint API (`docs/openapi.yaml`)
- Epic triển khai (`docs/BACKLOG.md`)

---

## 1. Ma trận truy vết Yêu cầu chức năng (`FR-01` .. `FR-62`)

| FR | Mô tả tóm tắt | Ưu tiên | Wireframe | Bảng CSDL | Endpoint OpenAPI | Epic |
|---|---|---|---|---|---|---|
| `FR-01` | Giao task cho thành viên | Must | `S04`, `S05`, `S06` | `tasks`, `task_assignees`, `profiles` | `POST /tasks`, `PUT /tasks/{id}/assignees`, `GET /me/tasks` | `E5` |
| `FR-02` | Tự động gửi email khi task sắp đến hạn | Must | `S12`, `E01` | `tasks`, `task_assignees`, `profiles`, `columns`, `app_settings`, `reminders` | `GET /settings/reminders`, `PUT /settings/reminders`, `GET & POST /internal/cron/reminders` | `E8`, `E9` |
| `FR-03` | Bảng giao task kiểu Trello (board, cột, thẻ, kéo thả) | Must | `S03`, `S04` | `boards`, `columns`, `tasks`, `task_assignees` | `GET /boards`, `GET /boards/{id}`, `POST /tasks/{id}/move` | `E5`, `E6` |
| `FR-04` | Tài khoản do admin đăng ký; đăng nhập bằng MSSV, không OTP | Must | `S01`, `S09` | `profiles`, `sessions`, `login_attempts` | `POST /auth/login`, `POST /auth/logout`, `POST /members` | `E2`, `E3` |
| `FR-05` | Admin chọn từng quyền cho mỗi tài khoản (không dùng vai trò cố định) | Must | `S10` | `permissions`, `user_permissions`, `profiles`, `audit_logs` | `GET /permissions`, `GET /members/{id}/permissions`, `PUT /members/{id}/permissions` | `E4` |
| `FR-06` | Mọi tài khoản hoạt động xem được mọi task không ẩn (chỉ đọc nếu thiếu quyền sửa) | Must | `S03`, `S04`, `S05` | `boards`, `columns`, `tasks`, `task_assignees`, `profiles` | `GET /boards`, `GET /boards/{id}`, `GET /tasks`, `GET /tasks/{id}` | `E5` |
| `FR-07` | Task ẩn chỉ người được giao, người tạo, admin xem; chỉ người tạo & admin bật/tắt | Must | `S04`, `S05`, `S06` | `tasks`, `task_assignees`, `profiles`, `task_events` | `PUT /tasks/{id}/hidden`, `GET /tasks/{id}`, `GET /boards/{id}`, `GET /tasks` | `E7` |
| `FR-10` | Admin thêm/sửa/khóa thành viên (MSSV, họ tên, ban, email `@eiu.edu.vn`) | Must | `S07`, `S09` | `profiles`, `departments`, `member_departments`, `user_permissions`, `audit_logs` | `POST /members`, `PATCH /members/{id}`, `POST /members/{id}/deactivate`, `POST /members/{id}/activate` | `E3` |
| `FR-11` | Chỉ MSSV đã đăng ký và tài khoản `is_active=true` mới đăng nhập được | Must | `S01`, `S14` | `profiles`, `sessions`, `login_attempts` | `POST /auth/login`, `GET /auth/session` | `E2` |
| `FR-12` | Kiểm soát truy cập theo quyền từng tài khoản qua `authorize` (mặc định từ chối) | Must | `S03..S15` | `profiles`, `permissions`, `user_permissions` | Mọi endpoint ghi & nhạy cảm qua `authorize` (`docs/openapi.yaml`) | `E4` |
| `FR-13` | Quản lý ban (20 ban; 1 người thuộc nhiều ban) | Must | `S07`, `S09`, `S11` | `departments`, `member_departments`, `boards`, `audit_logs` | `GET /departments`, `POST /departments`, `PATCH /departments/{id}`, `DELETE /departments/{id}` | `E3` |
| `FR-14` | Trang phân quyền: admin tích/bỏ từng quyền theo nhóm cho từng tài khoản | Must | `S10` | `permissions`, `user_permissions`, `profiles` | `GET /permissions`, `GET /members/{id}/permissions`, `PUT /members/{id}/permissions` | `E4` |
| `FR-15` | Quyền có hiệu lực ngay sau khi admin lưu, không cần đăng nhập lại | Must | `S10`, `S14` | `sessions`, `profiles`, `user_permissions` | `GET /auth/session` + đọc DB mỗi request ở mọi endpoint | `E4` |
| `FR-16` | Ghi nhật ký (`audit_logs`) mọi thay đổi quyền & hành động quản trị | Must | `S10`, `S13` | `audit_logs`, `profiles` | `GET /audit-logs` (+ ghi trong `PUT /members/{id}/permissions`, `apply-preset`, `admin`, `members`, `departments`, `settings/reminders`) | `E4` |
| `FR-17` | Mẫu quyền (`basic_member`, `department_lead`, `hr_manager`) | Must | `S10` | `permission_presets`, `preset_permissions`, `user_permissions`, `audit_logs` | `GET /permission-presets`, `POST /members/{id}/permissions/apply-preset` | `E4` |
| `FR-18` | Chỉ admin cấp/thu hồi quyền & cờ admin; luôn còn >= 1 admin hoạt động | Must | `S10` | `profiles`, `user_permissions`, `audit_logs` | `PUT /members/{id}/permissions`, `PUT /members/{id}/admin`, `POST /members/{id}/deactivate` | `E4` |
| `FR-19` | Tài khoản mới mặc định có `member.view`, `task.update_assigned`, `comment.create` | Must | `S09`, `S10` | `profiles`, `user_permissions`, `permission_presets`, `preset_permissions` | `POST /members` | `E3`, `E4` |
| `FR-20` | CRUD board và cột; cột mặc định Todo/Doing/Review/Done; lưu trữ board; chặn xóa cột còn task | Must | `S03`, `S04` | `boards`, `columns`, `tasks` | `GET/POST /boards`, `GET/PATCH/DELETE /boards/{id}`, `POST /boards/{id}/columns`, `PATCH/DELETE /columns/{id}`, `PUT /boards/{id}/columns/order` | `E5` |
| `FR-21` | CRUD task (tiêu đề, mô tả, hạn, priority, nhiều người nhận) | Must | `S04`, `S05` | `tasks`, `task_assignees`, `task_events` | `POST /tasks`, `GET/PATCH/DELETE /tasks/{id}`, `PUT /tasks/{id}/assignees` | `E5` |
| `FR-22` | Kéo thả thẻ giữa các cột & đổi thứ tự trong cột (+ cách thay thế không kéo) | Must | `S04` | `tasks`, `columns`, `task_events` | `POST /tasks/{id}/move` | `E6` |
| `FR-23` | Trang "Task của tôi" | Must | `S06` | `tasks`, `task_assignees`, `columns`, `boards` | `GET /me/tasks` | `E5` |
| `FR-24` | Bình luận trong task | Should | `S05` | `comments`, `tasks`, `task_events` | `GET /tasks/{id}/comments`, `POST /tasks/{id}/comments`, `DELETE /comments/{id}` | `E7` |
| `FR-25` | Lọc/tìm kiếm task theo người, hạn, ưu tiên, trạng thái, từ khóa | Should | `S04`, `S06` | `tasks`, `task_assignees`, `columns` | `GET /tasks`, `GET /me/tasks` | `E6` |
| `FR-26` | Task ẩn không lộ qua board, tìm kiếm, số đếm, bình luận, API, email nhắc (`404` cho người không xem được) | Must | `S04`, `S05`, `S06`, `S14`, `S15`, `E01` | `tasks`, `task_assignees`, `comments`, `task_events`, `reminders` | `GET /boards/{id}`, `GET /tasks`, `GET/PATCH/DELETE /tasks/{id}`, `POST /tasks/{id}/move`, `PUT /tasks/{id}/assignees`, `PUT /tasks/{id}/hidden`, `GET /tasks/{id}/events`, `POST /tasks/{id}/events/{eventId}/revert`, `GET /boards/{id}/trash`, `POST /tasks/{id}/restore`, `GET/POST /tasks/{id}/comments`, `DELETE /comments/{id}`, `GET & POST /internal/cron/reminders` | `E7`, `E9` |
| `FR-27` | Priority 4 mức (1 Thấp .. 4 Khẩn): hiển thị, lọc, sắp xếp | Must | `S04`, `S05`, `S06`, `E01` | `tasks` | `POST /tasks`, `PATCH /tasks/{id}`, `GET /tasks`, `GET /me/tasks` | `E6` |
| `FR-30` | Email nhắc deadline theo mốc admin cấu hình + nhắc 1 lần khi quá hạn | Must | `S12`, `E01` | `app_settings`, `tasks`, `columns`, `task_assignees`, `task_departments`, `profiles`, `reminders`, `audit_logs` | `GET /settings/reminders`, `PUT /settings/reminders`, `GET & POST /internal/cron/reminders` | `E8`, `E9` |
| `FR-31` | Gộp nhiều task thành 1 email mỗi người/ngày; không gửi trùng | Must | `E01` | `reminders`, `tasks`, `task_assignees`, `task_departments`, `profiles`, `app_settings` | `GET & POST /internal/cron/reminders` | `E8`, `E9` |
| `FR-40` | Đăng nhập có "Ghi nhớ đăng nhập" (24h cookie phiên vs 30d trượt); hết phiên về `S01` | Must | `S01`, `S14` | `sessions`, `profiles` | `POST /auth/login`, `GET /auth/session` | `E2` |
| `FR-41` | Giới hạn nhẹ số lần thử đăng nhập theo IP; ghi log `login_attempts` | Should | `S01` | `login_attempts` | `POST /auth/login` | `E2` |
| `FR-42` | MSSV và email chỉ hiện cho `member.view_detail` (và chính chủ ở `S08`) | Must | `S04`, `S05`, `S07`, `S08`, `S09`, `S13`, `E01` | `profiles`, `user_permissions`, `task_events`, `audit_logs` | `GET /me`, `GET /members`, `GET /members/{id}` (+ ép `MemberPublicSummary` ở mọi DTO khác) | `E3`, `E4` |
| `FR-43` | Thành viên rời CLB: khóa `is_active=false`, giữ dữ liệu/task, hiện `"(đã rời)"`, ngừng nhắc mail | Must | `S04`, `S05`, `S07`, `S09` | `profiles`, `sessions`, `tasks`, `task_assignees`, `reminders`, `audit_logs` | `POST /members/{id}/deactivate`, `POST /members/{id}/activate`, `GET & POST /internal/cron/reminders` | `E3`, `E8`, `E9` |
| `FR-50` | Giao diện song ngữ Việt/Anh; lưu `profiles.locale`; email nhắc theo ngôn ngữ đã chọn | Must | `S01..S15`, `S08`, `E01` | `profiles` | `GET /me`, `PATCH /me`, `GET & POST /internal/cron/reminders` | `E1`, `E9` |
| `FR-60` | Lịch sử hoạt động của task (tab Lịch sử, chỉ ghi thêm, tuân thủ task ẩn & FR-42) | Must | `S05` | `task_events`, `tasks`, `profiles` | `GET /tasks/{id}/events` (+ ghi sự kiện ở mọi endpoint ghi task & bình luận) | `E7A` |
| `FR-61` | Hoàn tác task: toast 10s & "Khôi phục giá trị này" (tạo sự kiện mới, kiểm tra quyền & xung đột 409) | Must | `S04`, `S05` | `task_events`, `tasks`, `task_assignees` | `POST /tasks/{id}/events/{eventId}/revert` (+ trả `eventId` ở các endpoint ghi task) | `E7A` |
| `FR-62` | Xóa mềm (`deleted_at`) & Thùng rác của board (giữ vô thời hạn, khôi phục cho `task.delete`/admin) | Must | `S04`, `S05`, `S15` | `tasks`, `columns`, `task_events` | `DELETE /tasks/{id}`, `GET /boards/{id}/trash`, `POST /tasks/{id}/restore` | `E7A` |

---

## 2. Ma trận truy vết Tiêu chí chấp nhận (`AC-01` .. `AC-22`)

| AC | Điều kiện & Kết quả mong đợi (tóm tắt) | Wireframe | Bảng CSDL | Endpoint OpenAPI | Epic |
|---|---|---|---|---|---|
| `AC-01` | MSSV lạ đăng nhập -> từ chối, không tạo tài khoản, thông báo chung | `S01` | `profiles`, `login_attempts` | `POST /auth/login` (`401`) | `E2` |
| `AC-02` | Tài khoản `is_active=false` đăng nhập -> bị từ chối | `S01` | `profiles`, `login_attempts` | `POST /auth/login` (`401`) | `E2` |
| `AC-03` | Cron chạy 2 lần trong ngày cho task chưa Done -> chỉ gửi 1 nhắc cho mỗi mốc | `E01` | `reminders`, `tasks`, `columns`, `app_settings` | `GET & POST /internal/cron/reminders` | `E8`, `E9` |
| `AC-04` | Truy cập tài nguyên/thao tác không được phép qua URL/API -> bị chặn ở server | `S04`, `S14` | `profiles`, `user_permissions`, `boards`, `tasks` | Mọi endpoint qua `authorize` (`403`/`404`) | `E4`, `E5` |
| `AC-05` | Session vượt `SESSION_TTL_DEFAULT` hoặc `SESSION_TTL_REMEMBER` -> về đăng nhập kèm thông báo | `S01`, `S14` | `sessions` | `GET /auth/session` & mọi endpoint bảo vệ (`401`) | `E2` |
| `AC-06` | Thiếu `task.create` gọi API tạo task trực tiếp -> bị từ chối (`403`) | `S04`, `S14` | `user_permissions`, `profiles` | `POST /tasks` (`403`) | `E4`, `E5` |
| `AC-07` | Admin thu hồi `board.create` -> phiên đang mở bị từ chối ngay không cần đăng nhập lại | `S03`, `S10` | `user_permissions`, `sessions`, `profiles` | `PUT /members/{id}/permissions` -> `POST /boards` (`403`) | `E4` |
| `AC-08` | Non-admin có `member.update` cố cấp quyền/cờ admin -> bị từ chối (`403`) | `S09`, `S10` | `profiles`, `user_permissions` | `PUT /members/{id}/permissions`, `POST /members/{id}/permissions/apply-preset`, `PUT /members/{id}/admin` (`403`) | `E4` |
| `AC-09` | Chỉ còn 1 admin hoạt động -> gỡ cờ admin hoặc khóa bị từ chối (`409`) | `S09`, `S10` | `profiles` (triggers `prevent_last_active_admin_update`, `prevent_last_active_admin_delete`) | `PUT /members/{id}/admin`, `POST /members/{id}/deactivate` (`409`) | `E3`, `E4` |
| `AC-10` | Admin đổi quyền -> có 1 bản ghi `audit_logs` đầy đủ actor/target/detail | `S10`, `S13` | `audit_logs`, `user_permissions` | `PUT /members/{id}/permissions`, `POST /members/{id}/permissions/apply-preset`, `GET /audit-logs` | `E4` |
| `AC-11` | Thành viên chỉ có quyền cơ bản mở board/task -> xem được task chung, không thấy MSSV/email của ai | `S04`, `S05`, `S07` | `profiles`, `tasks`, `user_permissions` | `GET /boards/{id}`, `GET /tasks/{id}`, `GET /members` (`MemberPublicSummary`) | `E3`, `E5` |
| `AC-12` | IP thử đăng nhập vượt ngưỡng -> chặn tạm (`429`) và ghi `login_attempts` | `S01` | `login_attempts` | `POST /auth/login` (`429`) | `E2` |
| `AC-13` | Không tích "Ghi nhớ đăng nhập" -> đóng trình duyệt phải đăng nhập lại; có tích -> giữ trong hạn | `S01` | `sessions` | `POST /auth/login` (`Set-Cookie`) | `E2` |
| `AC-14` | Nhập email sai tên miền (`@eiu.edu.vn`) khi lưu thành viên -> từ chối (`400`) | `S09` | `profiles` (kiểm tra ở server config) | `POST /members`, `PATCH /members/{id}` (`400`) | `E3` |
| `AC-15` | Task ẩn giao cho A -> B tìm kiếm, mở URL hoặc gọi API đều không thấy và nhận `404` | `S04`, `S05`, `S06`, `S14` | `tasks`, `task_assignees` | `GET /boards/{id}`, `GET /tasks`, `GET /tasks/{id}` (`404`) | `E7` |
| `AC-16` | Đổi cột của task -> ghi `task_events` cột trước/sau; tab Lịch sử hiển thị đúng ngôn ngữ | `S04`, `S05` | `tasks`, `task_events` | `POST /tasks/{id}/move`, `GET /tasks/{id}/events` | `E7A` |
| `AC-17` | Đổi priority rồi bấm "Hoàn tác" trong 10s -> về giá trị cũ, tạo sự kiện mới có `reverts_event_id` | `S04`, `S05` | `tasks`, `task_events` | `PATCH /tasks/{id}`, `POST /tasks/{id}/events/{eventId}/revert` | `E7A` |
| `AC-18` | Task đã bị sửa tiếp sau sự kiện X -> hoàn tác không `force` trả `409` kèm trường xung đột; `force=true` ghi `forced=true` | `S05` | `tasks`, `task_events` | `POST /tasks/{id}/events/{eventId}/revert` (`409` / `200`) | `E7A` |
| `AC-19` | Người không có quyền của thao tác gốc gọi API hoàn tác -> bị từ chối (`403`) | `S05` | `user_permissions`, `task_events` | `POST /tasks/{id}/events/{eventId}/revert` (`403`) | `E7A` |
| `AC-20` | Người không được phép gọi `GET /tasks/{id}/events` cho task ẩn -> `404`; người được xem không thấy MSSV/email | `S05`, `S14` | `tasks`, `task_assignees`, `task_events` | `GET /tasks/{id}/events` (`404` / `TaskEventDto`) | `E7A` |
| `AC-21` | Khôi phục task đã xóa mềm -> trở lại đúng cột/vị trí cũ (hoặc cột đầu tiên nếu cột cũ đã xóa), ghi `task.restored` | `S15` | `tasks`, `columns`, `task_events` | `GET /boards/{id}/trash`, `POST /tasks/{id}/restore` | `E7A` |
| `AC-22` | Bất kỳ ai (kể cả admin) cố sửa/xóa bản ghi `task_events` -> bị từ chối | — (DB/API) | `task_events` (trigger `prevent_append_only_mutation`) | Không có endpoint `PATCH`/`DELETE` + DB trigger chặn | `E0`, `E7A` |

---

## 3. Độ phủ Màn hình Wireframe (`S01`, `S03..S15`, `E01`)

| Màn hình | Tên màn hình | Quyền truy cập UI / Server | Endpoint chính |
|---|---|---|---|
| `S01` | Đăng nhập | Công khai | `POST /auth/login`, `GET /auth/session` |
| `S03` | Danh sách board | Đã đăng nhập (`board.create`/`update`/`delete` cho nút ghi) | `GET/POST /boards`, `PATCH/DELETE /boards/{id}` |
| `S04` | Bảng Kanban | Đã đăng nhập | `GET /boards/{id}`, `GET /tasks`, `POST /tasks`, `POST /tasks/{id}/move`, `POST/PATCH/DELETE` cột, `PUT /boards/{id}/columns/order` |
| `S05` | Chi tiết task & Lịch sử | Người xem được task (`taskVisibilityPolicy`) | `GET/PATCH/DELETE /tasks/{id}`, `PUT /tasks/{id}/assignees`, `PUT /tasks/{id}/hidden`, `GET /tasks/{id}/events`, `POST /tasks/{id}/events/{eventId}/revert`, `GET/POST /tasks/{id}/comments`, `DELETE /comments/{id}` |
| `S06` | Task của tôi | Đã đăng nhập | `GET /me/tasks` |
| `S07` | Danh sách thành viên | `member.view` (`member.view_detail` cho MSSV/email) | `GET /members`, `GET /members/{id}`, `GET /departments` |
| `S08` | Hồ sơ cá nhân | Đã đăng nhập | `GET /me`, `PATCH /me`, `POST /auth/logout` |
| `S09` | Quản trị thành viên | `member.create` / `member.update` / `member.deactivate` | `POST /members`, `PATCH /members/{id}`, `POST /members/{id}/deactivate`, `POST /members/{id}/activate` |
| `S10` | Phân quyền theo tài khoản | Chỉ Admin (`is_admin=true`) | `GET /permissions`, `GET/PUT /members/{id}/permissions`, `GET /permission-presets`, `POST /members/{id}/permissions/apply-preset`, `PUT /members/{id}/admin` |
| `S11` | Quản trị ban | `department.manage` | `GET/POST /departments`, `PATCH/DELETE /departments/{id}` |
| `S12` | Cấu hình nhắc deadline | `reminder.configure` | `GET/PUT /settings/reminders` |
| `S13` | Nhật ký quản trị | `audit.view` | `GET /audit-logs` |
| `S14` | Trang lỗi & hết phiên (giữ `/forbidden` dự phòng Giai đoạn 2) | Mọi trạng thái lỗi HTTP (`/forbidden` cho `403` dự phòng) | Mọi endpoint (`401`/`403`/`404`/`409`/`429`) |
| `S15` | Thùng rác của board | `task.delete` hoặc Admin | `GET /boards/{id}/trash`, `POST /tasks/{id}/restore` |
| `E01` | Email nhắc deadline | Cron nội bộ | `GET & POST /internal/cron/reminders` |

---

## 4. Tóm tắt kiểm tra hoàn thiện Giai đoạn 0C

- **Độ phủ yêu cầu Must:** Toàn bộ **32/32 FR mức Must** (`FR-01..FR-07`, `FR-10..FR-23`, `FR-26`, `FR-27`, `FR-30`, `FR-31`, `FR-40`, `FR-42`, `FR-43`, `FR-50`, `FR-60..FR-62`) và **3/3 FR mức Should** (`FR-24`, `FR-25`, `FR-41`) — tổng cộng **32 Must + 3 Should = 35 FR** — đều có đầy đủ cả 3 cột ánh xạ: **Màn hình + Bảng CSDL + Endpoint OpenAPI**.
- **Độ phủ tiêu chí chấp nhận:** Tất cả **22/22 AC (`AC-01..AC-22`)** đều truy vết được về ràng buộc CSDL, endpoint `docs/openapi.yaml` và Epic triển khai tương ứng.
- **Khớp danh mục 18 quyền & quy tắc bảo mật:**
  - Mọi endpoint ghi trong `docs/openapi.yaml` đều ghi rõ quyền yêu cầu theo 18 mã quyền (`AGENTS.md` Phụ lục A) hoặc quy tắc đặc biệt (chỉ Admin, tác giả bình luận, người tạo task).
  - `MemberPublicSummary` chỉ gồm `id`, `fullName`, `isActive`, `leftAt`, `departments` (`additionalProperties: false`) — tuyệt đối không chứa `studentId` hay `email`.
  - Toàn bộ endpoint đọc/sửa/di chuyển/giao/ẩn/xóa/lịch sử/hoàn tác/bình luận/thùng rác liên quan tới task đều quy định `404` cho task ẩn với người không có quyền xem.

---

## 5. Mở rộng sau 0C (`CR-01` .. `CR-07` & Đóng gói phát hành `E9`)

| Hạng mục | Phạm vi / Mô tả | Màn hình / Route | Bảng CSDL (`db/migrations/0002..0006`) | Endpoint OpenAPI / Script |
|---|---|---|---|---|
| `CR-01` | Mật khẩu đăng nhập (`scrypt`), ép đổi mật khẩu lần đầu & Admin đặt lại | `/login`, `/profile`, `/admin/members` | `profiles` (`password_hash`, `must_change_password`), `audit_logs` | `POST /auth/login`, `POST /me/password`, `POST /members/{id}/reset-password` |
| `CR-02` | Avatar thành viên (`<= 256 KB`) & Logo CLB (`club_assets`) | `/profile`, `/admin/branding` | `profiles` (`avatar_*`), `club_assets` (`0003`) | `PUT/DELETE /me/avatar`, `GET/PUT/DELETE /members/{id}/avatar`, `GET /branding`, `GET/PUT/DELETE /branding/logo` |
| `CR-03` | Giao task theo nhiều Ban (`task_departments`), đồng bộ thông báo & nhắc hạn | `/boards/[id]`, `/my-tasks`, `E01` | `task_departments` (`0005`), `task_events` (`department_ids`) | `POST /tasks`, `PUT /tasks/{id}/assignees`, `GET /tasks`, `GET /me/tasks`, `GET & POST /internal/cron/reminders` |
| `CR-04` | Kho lưu trữ hợp nhất (`/archive`), Purge an toàn & tự dọn theo `retentionDays` | `/archive` | `profiles/boards/tasks.purged_at`, `app_settings` (`0004`) | `GET /archive`, `POST /archive/{tasks|boards|members}/{id}/restore`, `DELETE /archive/{entityType}/{id}`, `GET/PUT /settings/archive-retention`, `GET & POST /internal/cron/archive-purge` |
| `CR-05` / `CR-06` | Thông báo chuông in-app & tùy chọn kênh `notifyInApp` / `notifyEmail` | Header Bell, `/boards/[id]` | `notifications` (`0005`, che `taskTitle=null` với task ẩn) | `GET /notifications`, `POST /notifications/{id}/read`, `POST /notifications/read-all`, `POST /tasks`, `PUT /tasks/{id}/assignees` |
| `CR-07` | Giao diện CLB (`/admin/branding`), Chữ ảnh `club_wordmark` & Tường ảnh Polaroid `/login` | `/admin/branding`, `/login` | `club_assets`, `login_gallery_items` (`0006`) | `GET /branding`, `GET/PUT/DELETE /branding/wordmark`, `GET /branding/gallery/{id}/image`, `POST /branding/gallery`, `PATCH/DELETE /branding/gallery/{id}`, `PUT /branding/gallery/order` |
| `E9` (`NFR-06`, `NFR-08`) | `src/app/icon.svg` (hết `404 /favicon.ico`), gỡ `wireframes/` giữ `/forbidden` dự phòng, sao lưu/khôi phục & tài liệu vận hành/UAT | `src/app/icon.svg`, `/forbidden` (dự phòng Giai đoạn 2) | Đủ `22` bảng miền + `schema_migrations` (`23` bảng `public`) | `npm run db:backup`, `npm run db:restore:verify`, `docs/OPERATIONS.md`, `docs/UAT-CHECKLIST.md` |

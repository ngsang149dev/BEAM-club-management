# Sổ tay Triển khai & Vận hành (`docs/OPERATIONS.md`)

Tài liệu hướng dẫn triển khai, sao lưu, giám sát và bàn giao vận hành cho hệ thống quản lý thành viên & giao task **CLB BEAM** (`v1.0`, đối chiếu `HANDOFF §10`, `NFR-06`, `NFR-08`).

---

## 1. Kiến trúc môi trường & Quy tắc tách biệt dữ liệu

| Môi trường | Nền tảng | Mục đích | Lưu ý bắt buộc |
|---|---|---|---|
| **Local / Dev** | Next.js + Docker `postgres:16-alpine` (`beam_dev`) | Phát triển hàng ngày | Seed mẫu `db/seed.sql` |
| **Test** | PostgreSQL cô lập (`beam_test`) | Integration & Playwright E2E | Không dùng chung dữ liệu dev |
| **Production** | **Vercel** + **Neon PostgreSQL 16** + SMTP CLB | Thành viên CLB vận hành thật | **Cấm** agent/script local tự ý migrate, seed hoặc dump/restore production (`AGENTS.md §0 #4`) |

---

## 2. Biến môi trường Production (Vercel Project Settings)

Tham chiếu lược đồ chuẩn tại `src/server/shared/config.ts` và `.env.example`:

| Biến | Bắt buộc | Giá trị / Quy chuẩn Production | Ghi chú bảo mật |
|---|---|---|---|
| `NODE_ENV` | Có | `production` (Vercel tự đặt) | Tắt mật khẩu mặc định dev và kích hoạt cookie `Secure` |
| `DATABASE_URL` | Có | Connection string Neon PostgreSQL (`?sslmode=require`) | Lấy từ Neon Console; bật kết nối SSL |
| `SESSION_SECRET` | Có | Chuỗi hex ngẫu nhiên tối thiểu `32` byte (`openssl rand -hex 32`) | Độc lập với giá trị `.env.local` |
| `CRON_SECRET` | Có | Chuỗi bí mật tối thiểu `16`–`32` byte | Vercel tự gắn `Authorization: Bearer <CRON_SECRET>` khi gọi Cron |
| `ALLOWED_EMAIL_DOMAIN` | Có | `eiu.edu.vn` | Ràng buộc tên miền email hợp lệ khi tạo/sửa thành viên (`AC-14`) |
| `DEFAULT_INITIAL_PASSWORD` | Khuyến nghị | Mật khẩu khởi tạo quy ước CLB hoặc để trống theo quy trình Admin cấp riêng | Ở `production`, hệ thống **không** tự fallback về `BeamDev@2026` (`config.ts`) |
| `SESSION_TTL_DEFAULT_HOURS` | Tùy chọn | `24` | Session cookie khi không tích "Ghi nhớ đăng nhập" |
| `SESSION_TTL_REMEMBER_DAYS` | Tùy chọn | `30` | Phiên trượt khi tích "Ghi nhớ đăng nhập" |
| `UNDO_TOAST_SECONDS` | Tùy chọn | `10` | Thời gian hiển thị nút Hoàn tác (`1..120`s) |
| `NEXT_PUBLIC_APP_URL` | Có | Domain HTTPS chính thức (vd `https://beam.example.com`) | Dùng cho link CTA trong email nhắc & thông báo |
| `SMTP_HOST` / `SMTP_PORT` | Có | `smtp.gmail.com` / `587` | Máy chủ SMTP gửi mail của CLB |
| `SMTP_USER` / `SMTP_PASS` | Có | Email chung CLB & App Password | Thuộc tài khoản CLB (`NFR-08`) |
| `SMTP_FROM` | Có | `BEAM Club <club-email@eiu.edu.vn>` | Địa chỉ người gửi hiển thị trong hộp thư |

> **Cảnh báo:** Tuyệt đối không commit `.env*`, mật khẩu hoặc chuỗi kết nối chứa thông tin xác thực lên Git hoặc ghi vào log.

---

## 3. CI/CD & Triển khai Production (Vercel + Neon)

### 3.1 Cổng kiểm tra tự động (GitHub Actions `.github/workflows/ci.yml`)
Mỗi Pull Request / push vào `main` chạy lần lượt **8 kiểm tra**:
1. `npm run db:migrate -- --test`
2. `npm run typecheck` (`tsc --noEmit`)
3. `npm run lint` (`eslint .`)
4. `npm run arch:check` (`dependency-cruiser`)
5. `npm run openapi:check` (`schema.d.ts` khớp `docs/openapi.yaml`)
6. `npm run test:unit`
7. `npm run test:integration`
8. `npm run build` (`next build`)

*Lưu ý:* Trước khi mở đợt phát hành chính thức, chủ dự án hoặc QA chạy thêm toàn bộ `npm run test:e2e` cục bộ trên `beam_test`.

### 3.2 Quy trình áp migration lên Neon Production (Chỉ chủ dự án thực hiện)
1. **Luôn sao lưu database trước khi chạy migration mới** (mục 5 bên dưới) hoặc tạo snapshot/branch trên Neon Console.
2. Kiểm tra danh sách migration tuần tự trong `db/migrations/` (`0001_initial_schema.sql` .. `0006_login_gallery.sql` và các bản cộng thêm sau này).
3. Áp từng tệp SQL chưa có trong bảng `schema_migrations` lên nhánh `main` của Neon bằng công cụ quản trị an toàn (chỉ cộng thêm, mọi migration đều viết idempotent).
4. Đợi Vercel hoàn tất build từ nhánh `main` và kiểm tra sức khỏe các màn hình chính (`/login`, `/boards`, `/admin/reminders`, `/admin/branding`).

---

## 4. Vận hành & Giám sát Vercel Cron (`vercel.json`)

Hệ thống khai báo hai lịch chạy tự động hằng ngày (múi giờ UTC trong `vercel.json`, tương ứng buổi sáng Việt Nam `UTC+7`):

| Lịch UTC (`vercel.json`) | Giờ Việt Nam (`UTC+7`) | Endpoint (`GET` & `POST`) | Chức năng |
|---|---|---|---|
| `0 0 * * *` | `07:00` | `/api/v1/internal/cron/reminders` | Gom task đến hạn theo mốc `daysBefore` & quá hạn `overdue` (nhắc 1 lần/task/người), gửi tối đa `1` email/người/ngày theo `profiles.locale`, che tiêu đề task ẩn (`WQ-27`). |
| `5 0 * * *` | `07:05` | `/api/v1/internal/cron/archive-purge` | Đọc `app_settings('archive_retention')`; nếu cấu hình `7`/`30`/`90` ngày sẽ purge an toàn các task/board/thành viên quá hạn lưu giữ. |

**Giám sát hằng ngày/tuần:**
- Kiểm tra mục **Vercel Dashboard -> Logs / Cron Jobs** để đảm bảo cả hai job trả mã `200`.
- Kiểm tra hộp thư **SMTP của CLB** (Sent / Bounce / Giới hạn gửi Gmail App Password ~500 thư/ngày) nếu thành viên phản ánh không nhận email nhắc.
- Kiểm tra `/admin/audit` trên ứng dụng (với quyền `audit.view`) để theo dõi thay đổi cấu hình mốc nhắc (`settings.reminders_updated`), phân quyền và thao tác thành viên.

---

## 5. Sao lưu hàng tuần & Diễn tập khôi phục (`NFR-06`)

Theo `HANDOFF §10` và `NFR-06`, dữ liệu PostgreSQL phải được sao lưu **tối thiểu mỗi tuần** và lưu bản sao **ngoài nền tảng chính** (ví dụ thư mục Google Drive chung của Ban kỹ thuật CLB hoặc ổ lưu trữ ngoại tuyến có khóa truy cập).

### 5.1 Script chuẩn trong repository (Local & Test — tự chặn `production`)
Repository cung cấp hai script tại `scripts/db-backup.mjs` và `scripts/db-restore-verify.mjs` (dùng chung helper `scripts/db-cli.mjs` và `scripts/load-env.mjs`):
- Tự động dùng `pg_dump` / `psql` cài trên máy; nếu máy dev (như Windows) chỉ có Docker chạy container `beam-postgres`, script tự fallback sang `docker exec -i beam-postgres ...`.
- **Rào chắn bắt buộc (`AGENTS.md §0 #4`):** tự chối thực thi nếu `NODE_ENV=production` hoặc URL khác `localhost`/`127.0.0.1` (trừ khi chủ động truyền `--allow-remote-dev`), không bao giờ in mật khẩu hay connection string ra log.

```bash
# 1. Sao lưu CSDL local dev (xuất ra backups/beam-beam_dev-<timestamp>.sql, đã thêm vào .gitignore)
npm run db:backup

# Hoặc sao lưu CSDL test vào tệp chỉ định
npm run db:backup -- --test --output backups/manual-check.sql

# 2. Kiểm chứng khôi phục bản backup trên CSDL tạm cô lập (beam_restore_verify_*)
npm run db:restore:verify -- --test --file backups/manual-check.sql

# Hoặc chạy trọn chu trình backup -> restore verify tự động trên beam_test rồi tự dọn tệp tạm
npm run db:restore:verify -- --test
```

`db:restore:verify` xác minh tự động trên DB tạm:
- Đủ toàn bộ **23 bảng `public`** (`22` bảng miền + `schema_migrations`).
- Đủ **`18` mã quyền `permissions`**, `>= 3` `permission_presets`, `>= 6` `schema_migrations` và đối chiếu khớp số dòng.
- Tồn tại và hoạt động đúng các trigger bảo toàn dữ liệu: `prevent_append_only_mutation` (`task_events`, `audit_logs`), `prevent_last_active_admin_update/delete` (`profiles`), `prevent_student_id_change` (`profiles`), và `prevent_entity_unpurge` (`boards`, `tasks`), rồi xóa sạch DB tạm trong khối `finally`.

### 5.2 Quy trình Admin CLB sao lưu thủ công Production hàng tuần
1. Từ máy tính cá nhân đáng tin cậy của Admin kỹ thuật (KHÔNG lưu URL production vào repo), chạy `pg_dump --no-owner --no-privileges --format=plain --file=beam-prod-YYYYMMDD.sql "<NEON_DIRECT_URL>"`.
2. Đổi tên hoặc nén có mật khẩu (nếu lưu đám mây) rồi tải lên kho lưu trữ ngoại vi của CLB; giữ tối thiểu `4` bản sao hàng tuần gần nhất.
3. Mỗi tháng 1 lần, thử nạp bản backup vào một DB cục bộ/test mới tạo trên máy admin (hoặc chạy `npm run db:restore:verify -- --test --file <đường_dẫn_bản_sao_cục_bộ>`) để xác nhận file backup còn nguyên vẹn.

---

## 6. Bàn giao nhiệm kỳ & Quản trị tài khoản CLB (`NFR-08`)

1. **Tài khoản chung của CLB:** Email Gmail/Workspace CLB, GitHub Repository/Organization, Vercel Team và Neon Organization phải đăng ký bằng tài khoản chung của CLB BEAM, **không** gắn chết vào tài khoản cá nhân của một cựu thành viên.
2. **Bảo vệ truy cập tối thiểu 2 người:**
   - Bật **xác minh 2 bước (2FA)** trên toàn bộ 4 dịch vụ (Gmail CLB, GitHub, Vercel, Neon).
   - Duy trì ít nhất **2 Admin kỹ thuật** đang hoạt động giữ quyền truy cập nền tảng và quyền `is_admin=true` trong ứng dụng (tránh kẹt quy tắc `LAST_ACTIVE_ADMIN` nếu 1 người đột xuất vắng mặt).
3. **Checklist xoay vòng bí mật khi bàn giao nhiệm kỳ mới:**
   - Đổi `SESSION_SECRET` trên Vercel (lưu ý mọi thành viên sẽ cần đăng nhập lại một lần).
   - Đổi `CRON_SECRET` và cập nhật lại nếu có script kích hoạt ngoài.
   - Tạo App Password SMTP mới cho email CLB và thu hồi App Password cũ của nhiệm kỳ trước.
   - Kiểm tra trang `/admin/members` & `/admin/permissions` để khóa (`is_active=false`) các tài khoản thành viên đã ra CLB.

---

## 7. Tài nguyên dự phòng cho Giai đoạn 2 (`/forbidden` — `S14`)

- Trong đợt đóng gói `v1.0` (`Epic E9`), bộ tài liệu wireframe tĩnh giai đoạn 0A (`wireframes/`, `docs/WIREFRAME-BRIEF.md`) đã được gỡ khỏi repository để giữ mã nguồn gọn sạch sau khi hoàn tất dựng toàn bộ màn hình thật.
- **Route dự phòng được giữ lại:** trang [`src/app/forbidden/page.tsx`](../src/app/forbidden/page.tsx) (`/forbidden`, thiết kế ban đầu `S14`) **được giữ nguyên có chủ đích** theo quyết định của chủ dự án (2026-11-26):
  - Hiện tại ở `v1.0`, các trang quản trị (`/admin/*`) hiển thị `<ErrorState variant="403" />` trực tiếp trên cùng URL để tránh mất ngữ cảnh điều hướng.
  - Ở Giai đoạn 2, nếu cần middleware chuyển hướng tập trung sang một URL `403` dùng chung hoặc màn hình từ chối truy cập liên kết từ bên ngoài, có thể tái sử dụng trực tiếp `/forbidden` mà không phải dựng lại UI/i18n.

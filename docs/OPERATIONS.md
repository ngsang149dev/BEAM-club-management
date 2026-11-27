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
| `SESSION_TTL_MINUTES` | Tùy chọn | `30` | Thời hạn trượt cho phiên duy nhất (`1..1440` phút, thay thế 2 biến cũ từ `CR-08`; `SESSION_TTL_DEFAULT_HOURS` & `SESSION_TTL_REMEMBER_DAYS` chỉ còn giữ tương thích ngược) |
| `UNDO_TOAST_SECONDS` | Tùy chọn | `10` | Thời gian hiển thị nút Hoàn tác (`1..120`s) |
| `NEXT_PUBLIC_APP_URL` | Có | Domain HTTPS chính thức (vd `https://beam.example.com`) | Dùng cho link CTA trong email nhắc & thông báo |
| `SMTP_HOST` / `SMTP_PORT` | Có | `smtp.gmail.com` / `587` | Máy chủ SMTP gửi mail của CLB |
| `SMTP_USER` / `SMTP_PASS` | Có | Email chung CLB & App Password | Thuộc tài khoản CLB (`NFR-08`) |
| `SMTP_FROM` | Có | `BEAM Club <club-email@eiu.edu.vn>` | Địa chỉ người gửi hiển thị trong hộp thư |

> **Cảnh báo:** Tuyệt đối không commit `.env*`, mật khẩu hoặc chuỗi kết nối chứa thông tin xác thực lên Git hoặc ghi vào log.

---

## 3. CI/CD Tự động & Triển khai Production (GitHub Actions → Neon + Vercel)

### 3.1 Cổng kiểm tra tự động (GitHub Actions `.github/workflows/ci.yml`)
Mỗi Pull Request vào `main` (và bước `verify` khi chạy pipeline deploy) thực thi lần lượt **10 kiểm tra** trên dịch vụ `postgres:16-alpine` cô lập:
1. `npm run db:migrate -- --test`
2. `npm run db:seed -- --test`
3. `npm run typecheck` (`tsc --noEmit`)
4. `npm run lint` (`eslint .`)
5. `npm run arch:check` (`dependency-cruiser`)
6. `npm run openapi:check` (`schema.d.ts` khớp `docs/openapi.yaml`)
7. `npm run test:unit`
8. `npm run test:integration`
9. `npm run db:restore:verify -- --test`
10. `npm run build` (`next build`)

*Lưu ý:* Trước khi mở đợt phát hành chính thức, chủ dự án hoặc QA chạy thêm toàn bộ `npm run test:e2e` cục bộ trên `beam_test`.

### 3.2 Pipeline CD tự động đẩy lên Neon + Vercel (`.github/workflows/deploy.yml`)
Mỗi khi merge / `push` vào nhánh `main` (hoặc bấm `Run workflow` thủ công), workflow `Deploy Production (Neon & Vercel)` chạy tuần tự **3 pha** với `concurrency: { group: deploy-production, cancel-in-progress: false }` và `permissions: contents: read`:

1. **`verify`** (`uses: ./.github/workflows/ci.yml`): chặn ngay nếu bất kỳ cổng kiểm tra nào thất bại.
2. **`migrate-neon`** (`environment: production`):
   - Dùng `secrets.NEON_DIRECT_DATABASE_URL` (**Direct Connection String** không có `-pooler`) chạy `npm run db:migrate` với `NODE_ENV=production`.
   - Chỉ áp các file `.sql` mới chưa có trong `schema_migrations`; **tuyệt đối không chạy `db:seed`, `db:backup` hay `db:restore` lên production**.
3. **`deploy-vercel`** (`needs: [verify, migrate-neon]`, `environment: production`):
   - Cài cố định `vercel@54` (không dùng `@latest`, truyền `VERCEL_TOKEN` qua env thay vì cờ `--token`).
   - Chạy `vercel pull --yes --environment=production` → `vercel build --prod` → `vercel deploy --prebuilt --prod --yes`.
   - Kiểm tra nhanh `GET /api/v1/branding` trên URL vừa deploy (hoặc `PROD_APP_URL`) và ghi tóm tắt vào GitHub Step Summary.

*(Nếu chưa khai báo đủ secrets bên dưới, cả `migrate-neon` và `deploy-vercel` đều tự bỏ qua an toàn với `::notice::`, không làm đỏ pipeline).*

### 3.3 Khai báo 4 GitHub Secrets bắt buộc để kích hoạt Auto-Deploy
Vào **GitHub Repository → Settings → Secrets and variables → Actions → New repository secret** (hoặc đặt trong Environment **`production`** nếu muốn bật *Required reviewers* phê duyệt trước khi đẩy lên thật):

| Secret | Nơi lấy giá trị | Mục đích |
|---|---|---|
| `NEON_DIRECT_DATABASE_URL` | **Neon Console → Connect → bỏ tick Connection pooling** (giữ `?sslmode=require`) | Chạy `npm run db:migrate` tự động cho schema mới (DDL) |
| `VERCEL_TOKEN` | **Vercel Account Settings → Tokens → Create** (Scope khớp Team/Account giữ project) | Xác thực `vercel pull/build/deploy` từ GitHub Actions |
| `VERCEL_ORG_ID` | Chạy cục bộ `npx vercel link` rồi mở `.vercel/project.json` (trường `orgId`), hoặc xem trong Vercel Team/Account Settings | Định danh Team/User sở hữu project trên Vercel |
| `VERCEL_PROJECT_ID` | Mở `.vercel/project.json` (trường `projectId`), hoặc **Vercel Project → Settings → General** | Định danh Project Next.js trên Vercel |
| `PROD_APP_URL` *(khuyến nghị)* | Domain chính thức (vd `https://beam-club.vercel.app`, không `/` cuối) | Dùng cho smoke check sau deploy & workflow `.github/workflows/daily-cron.yml` |
| `CRON_SECRET` *(nếu dùng `daily-cron.yml`)* | Khớp biến `CRON_SECRET` trong Vercel Project Settings | Gọi `/api/v1/internal/cron/*` hằng ngày |

**Lưu ý tránh build trùng trên Vercel khi bật CI/CD:**
- Khi đã dùng `.github/workflows/deploy.yml` đẩy bản `--prebuilt`, nên vào **Vercel Project → Settings → Git** cấu hình **Ignored Build Step** (`exit 0` cho nhánh `main`) hoặc tắt Auto-Deploy Git trên nhánh `main` để Vercel **không** tự deploy song song trước khi bước `verify` + `migrate-neon` trên GitHub Actions hoàn tất (vẫn có thể giữ Preview Deploy cho các nhánh PR nếu muốn).

### 3.4 Lưu ý dự phòng khi cần thao tác migration thủ công từ máy chủ dự án
1. **Luôn sao lưu database trước khi chạy migration lớn** hoặc tạo branch/restore point trên Neon Console.
2. Kiểm tra danh sách migration tuần tự trong `db/migrations/` (`0001_initial_schema.sql` .. `0008_calendar_tasks_leads_deliverables.sql` và các bản cộng thêm sau này).
3. Nếu cần chạy tay từ máy cá nhân của chủ dự án, trỏ `DATABASE_URL` tạm thời vào **Direct Connection String** của Neon (không qua `-pooler`) và chạy `npm run db:migrate` — script tự đối chiếu bảng `schema_migrations`, bỏ qua các bản đã áp, ẩn mật khẩu khỏi log, và nạp sẵn `18` quyền + `3` mẫu quyền + cấu hình nhắc hạn mặc định (`0007_system_catalog_defaults.sql`) mà **không** chèn bất kỳ dữ liệu mẫu dev nào.
4. Kiểm tra sức khỏe các màn hình chính sau deploy (`/login`, `/tasks`, `/admin/reminders`, `/admin/branding`).

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
- Tự động ưu tiên `pg_dump` / `psql` khớp major version với PostgreSQL server (ví dụ `/usr/lib/postgresql/16/bin/...` hoặc Homebrew `postgresql@16`), tự chuẩn hóa tham số preamble `SET transaction_timeout = 0;` khi dump bằng client `17+` khôi phục vào PostgreSQL `16`, và tự fallback sang `docker exec -i beam-postgres ...` nếu máy dev không cài sẵn PostgreSQL client.
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
- Đủ toàn bộ **24 bảng `public`** (`23` bảng miền + `schema_migrations`).
- Đủ **`18` mã quyền `permissions`**, `>= 3` `permission_presets`, `>= 8` `schema_migrations` và đối chiếu khớp số dòng.
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

---

## 8. Runbook Go-Live Production `0đ/tháng` từ A–Z (Vercel + Neon + SMTP CLB)

Hướng dẫn từng bước dành cho chủ dự án / Admin kỹ thuật CLB BEAM khi đưa hệ thống lên môi trường thật với chi phí **0đ/tháng** (`HANDOFF §2.1, §7.1, §9, §10`):

### Bước 1 — Khởi tạo CSDL Neon PostgreSQL 16 Free (Singapore)
1. Đăng nhập tài khoản chung của CLB tại Neon Console, tạo project mới:
   - **Postgres version:** `16`
   - **Region:** `AWS Asia Pacific (Singapore) — ap-southeast-1` (cùng khu vực với `"regions": ["sin1"]` trong `vercel.json`).
2. Sao chép **2 loại chuỗi kết nối** của database `neondb` (hoặc `beam_prod`), luôn giữ `?sslmode=require`:
   - **Pooled Connection String** (hostname có hậu tố `-pooler`): dùng cho biến `DATABASE_URL` trên **Vercel Production** để chịu tải kết nối Serverless.
   - **Direct Connection String** (hostname **không** có `-pooler`): chỉ dùng trên máy cá nhân Admin khi chạy `npm run db:migrate`, `npm run db:bootstrap-admin`, hoặc `pg_dump` sao lưu hàng tuần.

### Bước 2 — Cấu hình SMTP Email CLB & Kiểm tra vào hộp thư chính (`HANDOFF §9`)
1. **Phương án mặc định (`0đ` — Gmail CLB):**
   - Đăng nhập Gmail chung của CLB (ví dụ `beamclub@gmail.com` hoặc email `@eiu.edu.vn` có hỗ trợ SMTP), bật **2-Step Verification (2FA)**.
   - Vào **Google Account -> Security -> App passwords**, tạo một App Password 16 ký tự đặt tên `BEAM Club Website`.
   - Khai báo tạm vào `.env.local` trên máy cá nhân chủ dự án để kiểm tra:
     - `SMTP_HOST="smtp.gmail.com"`, `SMTP_PORT="587"`
     - `SMTP_USER="<email-clb>"`, `SMTP_PASS="<16-ky-tu-khong-khoang-trang>"`
     - `SMTP_FROM="BEAM Club <email-clb>"`
   - *Phương án thay thế miễn phí khi có tên miền riêng:* **Brevo SMTP Free** (`smtp-relay.brevo.com`, cổng `587`, miễn phí 300 email/ngày; với ~50 thành viên và cơ chế gộp tối đa `1` email nhắc/người/ngày, CLB chỉ tốn ~10–50 email/ngày).
2. **Kiểm chứng gửi mail thật trước khi lên Vercel:**
   ```bash
   npm run smtp:verify -- --to <email-thật-của-admin>
   ```
   Mở hộp thư đến của `<email-thật-của-admin>` xác nhận email `[BEAM Club] Kiểm tra kết nối SMTP / SMTP Verification` vào thẳng **Inbox** (không rơi vào Spam). Sau khi xác nhận xong, có thể hoàn nguyên `.env.local` về cấu hình dev.

### Bước 3 — Áp Migration `0001..0008` & Tạo Admin đầu tiên (Lần Go-Live đầu)
Tuyệt đối **không** chạy `npm run db:seed` lên Production (script `db:seed` cũng đã tự khóa `NODE_ENV=production` và remote URL). Từ các lần cập nhật sau trở đi, `.github/workflows/deploy.yml` sẽ tự động chạy `npm run db:migrate`; riêng **lần khởi tạo đầu tiên** cần tạo tài khoản Admin:

1. **Áp toàn bộ schema & danh mục quyền nền tảng (`0001..0008`):**
   ```bash
   DATABASE_URL="<NEON_DIRECT_URL>" npm run db:migrate
   ```
   Lệnh này tạo đủ 24 bảng, 7 trigger bảo toàn dữ liệu, `18` mã quyền `PERMISSIONS`, `3` mẫu quyền (`basic_member`, `department_lead`, `hr_manager`) và cấu hình nhắc hạn mặc định (`07:00 UTC+7`), hoàn toàn **không có dữ liệu giả**.
2. **Tạo tài khoản Admin CLB đầu tiên (`must_change_password = true`):**
   ```bash
   DATABASE_URL="<NEON_DIRECT_URL>" \
   ALLOWED_EMAIL_DOMAIN="eiu.edu.vn" \
   npm run db:bootstrap-admin -- \
     --student-id "<MSSV_ADMIN_1>" \
     --email "<email_admin_1@eiu.edu.vn>" \
     --full-name "<Họ tên Admin 1>"
   ```
   CLI sẽ hỏi mật khẩu khởi tạo ở chế độ ẩn ký tự trên terminal (hoặc đọc từ biến môi trường `BOOTSTRAP_ADMIN_PASSWORD`), băm bằng `scrypt` chuẩn, gắn `is_admin = true`, `must_change_password = true`, ghi `audit_logs` không PII và không in lộ thông tin nhạy cảm ra màn hình.

### Bước 4 — Triển khai lên Vercel Hobby (`0đ/tháng`, vùng `sin1`)
1. Import repository `BEAM-club-management` vào tài khoản Vercel của CLB (Framework Preset: **Next.js**).
2. Trong **Vercel Project -> Settings -> Environment Variables** (môi trường `Production`), nhập đầy đủ bảng biến ở **Mục 2** (lưu ý `DATABASE_URL` dùng **Pooled URL** của Neon, `SESSION_SECRET` và `CRON_SECRET` sinh mới bằng `openssl rand -hex 32`, `NEXT_PUBLIC_APP_URL` đặt đúng domain HTTPS chính thức của Vercel/CLB).
3. Bấm **Deploy** nhánh `main`. Nhờ `vercel.json`, Serverless Functions tự động ghim về `sin1` (Singapore) và đăng ký sẵn 2 Vercel Cron (`0 0 * * *` & `5 0 * * *` UTC).
4. Mở trang `/login` trên domain thật:
   - Đăng nhập bằng `<MSSV_ADMIN_1>` và mật khẩu vừa tạo → hệ thống tự chuyển tới `/profile?changePassword=1` bắt buộc đổi mật khẩu mới.
   - Vào `/admin/members` & `/admin/permissions` tạo ngay **Admin hoạt động thứ 2** (chủ CLB / phó ban kỹ thuật theo `NFR-08`) và tạo các Ban thật của CLB tại `/admin/departments`.

### Bước 5 — Bật GitHub Actions Cron dự phòng & Nút kích hoạt thủ công (`.github/workflows/daily-cron.yml`)
Trên gói Vercel Hobby miễn phí, Vercel Cron chạy 1 lần/ngày với độ trễ có thể dao động trong khung giờ. Repository đi kèm workflow `.github/workflows/daily-cron.yml` (`0đ`) đóng vai trò **kênh kích hoạt dự phòng & nút bấm kiểm thử thủ công** (an toàn tuyệt đối không gửi trùng email nhờ khóa `UNIQUE (task_id, user_id, kind)` của `AC-03`):

1. Vào **GitHub Repository -> Settings -> Secrets and variables -> Actions -> New repository secret**, thêm 2 secret:
   - `PROD_APP_URL`: URL HTTPS chính thức của web (ví dụ `https://beam-club.vercel.app`, không có dấu `/` cuối).
   - `CRON_SECRET`: Khớp chính xác giá trị `CRON_SECRET` đã đặt trên Vercel.
2. Để kiểm thử ngay sau khi Go-Live mà không cần chờ đến `07:00` sáng hôm sau:
   - Vào tab **Actions -> Daily Cron (Backup & Manual Trigger) -> Run workflow**, chọn `all` (hoặc `reminders` / `archive-purge`) rồi bấm **Run workflow** và xác nhận step báo `HTTP 200`.
   - *(Nếu chưa khai báo 2 GitHub Secrets trên, workflow tự động bỏ qua an toàn với trạng thái xanh `Skipping daily cron trigger` chứ không báo đỏ).*

### Bước 6 — Chạy UAT 1 tuần & Bàn giao chính thức
- Thực hiện lần lượt 10 kịch bản `U1`–`U10` trong [`docs/UAT-CHECKLIST.md`](UAT-CHECKLIST.md) cùng 5–10 thành viên CLB trước khi mở rộng cho toàn bộ ~50 thành viên.
- Thiết lập lịch nhắc Admin kỹ thuật chạy `pg_dump` sao lưu hàng tuần theo **Mục 5.2**.

---

## 9. Gia cố Bảo mật Production, Vercel Firewall / WAF (`0đ`) & Kiểm tra CVE

Hệ thống đã tích hợp sẵn lớp phòng thủ ở mức ứng dụng (Drizzle ORM tham số hóa, `scrypt` + `timingSafeEqual`, cookie `HttpOnly`/`Secure`/`SameSite=Lax`, OWASP HTTP Security Headers tại `next.config.ts`, CSRF `Origin`/`Sec-Fetch-Site` Guard tại `src/proxy.ts` + route API, rate limit 2 lớp `(IP, studentId)` & tổng IP trên `/auth/login`, rate limit trên `/me/password`, và CDN cache + `ETag` cho ảnh branding công khai). Để bảo vệ thêm quota miễn phí trước các đợt spam/DDoS nhẹ với chi phí **`0đ`**:

### 9.1 Bật Vercel Firewall / WAF Rate Limit miễn phí (Vercel Dashboard)
Vercel Hobby đã tự hấp thụ DDoS tầng L3/L4/L7 phổ thông. Admin kỹ thuật nên tạo thêm **1–2 quy tắc Firewall miễn phí** tại **Vercel Project → Firewall → Configure → Custom Rules**:
1. **Chặn spam đăng nhập (bảo vệ CPU `scrypt` & Neon):**
   - Condition: `Request Path` **Equals** `/api/v1/auth/login` **AND** `Request Method` **Equals** `POST`
   - Action: **Rate Limit** — `30` requests / `60` seconds theo `IP Address` (đủ rộng cho cả CLB dùng chung 1 Wi-Fi trường đăng nhập cùng lúc, nhưng chặn ngay tool spam hàng trăm request/phút) → trả `429`.
2. **Chống lạm dụng API chung:**
   - Condition: `Request Path` **Starts With** `/api/v1/`
   - Action: **Rate Limit** — `300` requests / `60` seconds theo `IP Address`.
3. **Chế độ khẩn cấp khi bị phá (Attack Challenge Mode):**
   - Nếu phát hiện bất thường ở **Vercel → Observability / Logs** (lượng gọi API tăng đột biến), bật tạm **Firewall → Attack Challenge Mode** (miễn phí trên Hobby) trong vài giờ để buộc trình duyệt vượt bước kiểm tra bot tự động.

### 9.2 Tùy chọn Cloudflare Free (khi gắn tên miền riêng)
- Nếu CLB mua tên miền riêng (ví dụ `beam.eiuclub.vn`) và trỏ DNS qua **Cloudflare Free (Proxied — đám mây cam)**:
  - Bật **SSL/TLS mode: Full (strict)** và bật **Bot Fight Mode** (miễn phí).
  - Giữ nguyên bản ghi DNS CNAME trỏ về `cname.vercel-dns.com` theo hướng dẫn ở **Vercel → Settings → Domains**.

### 9.3 Bảo vệ mã nguồn & kiểm tra lỗ hổng thư viện định kỳ (`npm audit`)
- **Giữ GitHub Repository ở chế độ `Private`:** Vercel Hobby và GitHub Actions Free (`2.000 phút/tháng`) hỗ trợ đầy đủ repo cá nhân Private mà không lộ mã nguồn ra ngoài.
- **Rà soát CVE hàng tháng:** Định kỳ mỗi tháng hoặc trước mỗi đợt nâng cấp lớn, Admin kỹ thuật chạy:
  ```bash
  npm audit --omit=dev
  ```
  Nếu có lỗ hổng mức `high`/`critical` ở dependency runtime, tạo nhánh cập nhật `package-lock.json`, chạy đủ cổng CI và duyệt merge theo quy trình chuẩn.

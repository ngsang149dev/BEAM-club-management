# AGENTS.md: Hướng dẫn phát triển (v1.4)

| Mục | Nội dung |
|---|---|
| Dự án | Website nội bộ quản lý thành viên & giao task CLB BEAM (~50 thành viên, 20 ban) |
| Phiên bản | **1.4** (khớp `docs/HANDOFF-club-management-website.md` v1.4) |
| Mô hình | **Multi sub-agents:** 1 `Coordinator` + 3 sub-agent chuyên trách (`backend-db`, `frontend`, `qa-reviewer`) |
| Chủ dự án | Sang — quyết định nghiệp vụ, duyệt PR trước khi merge, thao tác production |

Đọc hết trước khi làm việc. Khi tệp này mâu thuẫn với HANDOFF, **HANDOFF thắng**: dừng lại, ghi `docs/STATUS.md` và hỏi chủ dự án.

---

## 0. Chín luật bất di bất dịch

1. **Mỗi lúc một item rõ phạm vi.** Chỉ chạy song song các item không chồng lấn vùng file sau khi đã khóa `docs/openapi.yaml`.
2. **Không đoán nghiệp vụ.** Mơ hồ thì dừng, ghi `docs/STATUS.md`, hỏi chủ dự án.
3. **Test trước (hoặc cùng lúc) mã**, bắt nguồn từ AC và `docs/openapi.yaml`, không suy từ mã đã viết.
4. **Không chạm production:** cấm chạy migration lên production, đổi env production, đọc dữ liệu thật.
5. **Không merge khi chưa được chủ dự án duyệt.**
6. **Không lộ dữ liệu:** MSSV/email chỉ cho `member.view_detail` (và chính chủ ở hồ sơ cá nhân); task ẩn trả **404** ở mọi đường cho người không được xem.
7. **Mọi route/server action ghi dữ liệu phải qua `authorize`.** Ẩn nút ở UI chỉ để tiện dùng.
8. **Đổi `docs/openapi.yaml` hoặc schema CSDL ngoài phạm vi item:** ghi `docs/DECISIONS.md` và chờ duyệt.
9. **Tuân thủ nghiêm ngặt kiến trúc mục 6A.** Test xanh nhưng phá kiến trúc vẫn là **chưa đạt**.

## 1. Dự án & Tech stack đã chốt

- **Sản phẩm:** quản lý thành viên; bảng task kiểu Trello (cột, thẻ, kéo thả, giao việc, bình luận, priority 1–4); email nhắc deadline; song ngữ Việt/Anh; đăng nhập bằng MSSV; lịch sử `task_events` & hoàn tác + Thùng rác.
- **Tech stack đã chốt (`docs/DECISIONS.md`):** Next.js (React, TypeScript `strict`) trên Vercel; PostgreSQL trên Neon (`Drizzle ORM`); session DB `sessions` + opaque token hash + cookie `HttpOnly`/`Secure`/`SameSite`; `next-intl`; `Vitest` + `Playwright`; `TanStack Query` + `React Hook Form` + `Zod`; `@dnd-kit`; `sonner` (toast hoàn tác); `dependency-cruiser` + ESLint; SMTP email CLB + Vercel Cron (07:00 UTC+7); GitHub Actions CI. Package manager: `npm`.
- **Ngoài MVP (không làm trừ khi item yêu cầu):** nhãn, checklist, file đính kèm, lịch, báo cáo cuối năm, nhập CSV, RLS PostgreSQL, thông báo in-app, xóa vĩnh viễn task. **Thiết kế mở để thêm sau** (HANDOFF 11.9): thay đổi cộng thêm, API chỉ thêm, service tách module.

## 2. Tài liệu nguồn & thứ tự đọc

**Đầu phiên đọc theo thứ tự:** `AGENTS.md` → `docs/STATUS.md` → item hiện tại trong `docs/BACKLOG.md` → **chỉ các mục HANDOFF ghi trong item** → skill vai trò trong `.agents/skills/`.

| Tài liệu | Vai trò | Ai sửa |
|---|---|---|
| `docs/HANDOFF-club-management-website.md` | Nghiệp vụ, kiến trúc, FR/NFR/AC, Q&A | Chỉ chủ dự án (agent đề xuất) |
| `docs/openapi.yaml` | Hợp đồng API | `Coordinator`/`backend-db`, đổi phải ghi `DECISIONS.md` & chờ duyệt |
| `wireframes/` | Giao diện cần dựng | Chỉ đọc sau khi đóng 0A |
| `docs/BACKLOG.md`, `STATUS.md`, `DECISIONS.md` | Backlog, trạng thái, quyết định | Chỉ `Coordinator` |

**Thứ tự ưu tiên khi mâu thuẫn:** HANDOFF > `openapi.yaml` > `DECISIONS.md` > wireframe > mô tả item > suy luận.

## 3. Quy trình Multi Sub-Agents

### 3.1 Vai trò & Điều phối
- **Coordinator (agent chính):** đọc trạng thái, tách epic thành item rõ file sở hữu (mục 9.3), xin chủ dự án duyệt danh sách item mỗi epic, giao brief cho sub-agent, kiểm soát song song (chỉ khi file không giao nhau & `openapi.yaml` đã khóa), tích hợp, mở PR (mục 9.1), cập nhật `docs/BACKLOG.md`, `STATUS.md`, `DECISIONS.md`.
- **`backend-db`:** sở hữu `db/`, `src/server/`, `src/app/api/`, `src/lib/`, `docs/openapi.yaml`, `docs/ERD.md`.
- **`frontend`:** sở hữu `src/features/`, `src/components/`, `src/app/` (UI pages), `messages/`.
- **`qa-reviewer` (ngữ cảnh sạch):** sở hữu `tests/`; viết test từ AC + OpenAPI; review độc lập diff, AC, checklist 6A.8 (bắt buộc với item **RỦI RO CAO**).

### 3.2 Vòng đời backlog item
1. **Backlog → Ready:** item đủ ID, sub-agent phụ trách, FR/AC, phụ thuộc, mục tài liệu, phạm vi file, rủi ro; chủ dự án duyệt.
2. **Kiểm tra phụ thuộc:** chưa xong thì không làm. Đầu phiên chạy bộ test hiện có.
3. **Viết test trước** từ AC và `docs/openapi.yaml` (mỗi AC ít nhất 1 test).
4. **Design note (mục 6A.7)** trước khi code; sub-agent chỉ sửa trong vùng file được giao.
5. **Tự kiểm tra & review độc lập:** chạy test, typecheck, lint, kiểm tra kiến trúc (`dependency-cruiser`), kiểm tra i18n `vi`/`en`, kiểm tra lộ PII/task ẩn, đối chiếu checklist 6A.8. Item rủi ro cao phải qua `qa-reviewer` ngữ cảnh sạch.
6. **Mở PR** kèm ghi chú bàn giao (mục 9.1). Item rủi ro cao ghi `[RỦI RO CAO]` ở tiêu đề PR.
7. **Chờ chủ dự án duyệt & merge.** Sửa theo phản hồi. Không tự merge.
8. **Sau merge:** `Coordinator` cập nhật `docs/BACKLOG.md`, `docs/STATUS.md`, `docs/DECISIONS.md`. Cuối phiên luôn cập nhật `docs/STATUS.md`.

## 4. Khi phải dừng và hỏi

Dừng item, ghi `docs/STATUS.md`, hỏi chủ dự án ngay khi:
- Nghiệp vụ mơ hồ hoặc tài liệu mâu thuẫn; cần đổi `openapi.yaml`/schema ngoài phạm vi item.
- Cần thao tác production hoặc dữ liệu thật; phát hiện lỗ hổng bảo mật ở phần đã merge.
- Item quá lớn (nên tách nhỏ); hoặc **test không qua sau 3 lần sửa** (cấm sửa test/hạ AC cho qua).

## 5. Cấu trúc repo & ranh giới sở hữu

```
.agents/skills/    skill theo vai trò (beam-coordinator, beam-backend-db, beam-frontend, beam-qa-reviewer)
docs/              HANDOFF, WIREFRAME-BRIEF, ERD, openapi.yaml, TRACEABILITY.md, BACKLOG.md, STATUS.md, DECISIONS.md
wireframes/        bộ wireframe 0A (chỉ đọc)
db/                migrations/, seed.sql, schema Drizzle
messages/          vi.json, en.json
src/app/           trang UI (frontend) và Route Handlers MỎNG api/v1 (backend-db)
src/features/      UI theo tính năng: components, hooks, api-client (frontend)
src/components/    UI kit dùng chung (frontend)
src/server/modules auth, members, departments, permissions, boards, tasks, comments, reminders, audit (backend-db)
src/server/shared  db, errors, authorize, config, logger, clock, mailer, composition (backend-db)
src/lib/           tiện ích thuần, schema zod dùng chung (backend-db/chung)
tests/             unit, integration, e2e (qa-reviewer & tác giả item)
```

Cấm sub-agent sửa file ngoài vùng sở hữu; cấm sub-agent tự ý sửa `docs/STATUS.md`, `docs/BACKLOG.md` hoặc `docs/HANDOFF-*`.

## 6. Quy ước mã

- **Ngôn ngữ:** mã, biến, commit, PR bằng tiếng Anh; chuỗi UI/email trong `messages/` có đủ `vi` và `en`.
- **TypeScript `strict`:** cấm `any` (trừ lý do bất khả kháng có ghi chú). Kiểm tra input bằng schema `zod` dùng chung client/server.
- **Lỗi API thống nhất:** `{ "error": { "code": "...", "messageKey": "...", "details": {} } }`. HTTP: `400` input sai, `401` chưa đăng nhập/hết session, `403` thiếu quyền, `404` không có hoặc **không được xem** (kể cả task ẩn), `409` xung đột (gỡ admin cuối, xóa cột còn task, xóa ban còn dữ liệu, xung đột hoàn tác), `429` quá giới hạn thử.
- **API `/api/v1` chỉ cộng thêm**, không đổi/xóa trường đã có; thời gian ISO 8601 UTC (`timestamptz`), hiển thị `Asia/Ho_Chi_Minh`. `tasks.priority` là số `1..4` (1 Thấp, 2 Trung bình, 3 Cao, 4 Khẩn).
- **Nhánh & commit:** nhánh `feat/<ID>-<mô-tả-ngắn>`; commit `<ID>: <mô tả ngắn>`. Migration chỉ cộng thêm, chạy lại được, không sửa migration đã merge.

## 6A. Thiết kế phần mềm (bắt buộc)

### 6A.1 Nguyên tắc nền
- **SOLID**, tách mối quan tâm, cohesion cao/coupling thấp, ưu tiên composition hơn kế thừa.
- **DRY có kiểm soát (quy tắc ba):** lặp lần thứ 3 mới trừu tượng hóa. **KISS, YAGNI.**
- **Một nguồn sự thật** (danh mục 18 quyền `PERMISSIONS`, cấu hình TTL/domain, điều kiện task ẩn).
- **Bất biến mặc định;** hàm thuần khi có thể; đặt tên theo miền nghiệp vụ (`Task`, `Board`, `Permission`).

### 6A.2 Kiến trúc phân lớp & hướng phụ thuộc
Từ ngoài vào trong (chỉ phụ thuộc vào trong):
1. **Delivery** (`src/app/api`, cron): **mỏng.** Đọc request, gọi service, ánh xạ response/lỗi. Không nghiệp vụ.
2. **Service / use case** (`src/server/modules/<module>/service.ts`): nghiệp vụ, gọi `authorize`, mở transaction.
3. **Domain / policy** (`policy.ts`): quy tắc thuần (vd ai xem task ẩn), không biết DB hay HTTP.
4. **Repository (port + adapter)** (`repository.ts`): truy cập dữ liệu; không SQL/ORM ngoài repository.
5. **Hạ tầng** (`src/server/shared`): db, mailer, clock, logger, config, composition root.

**Cấm:** service/domain import từ `src/app`, React, HTTP; import chéo vào tệp nội bộ module khác (chỉ qua `index.ts`); vòng phụ thuộc.

### 6A.3 Ranh giới bắt buộc (port và adapter)
Chỉ tạo interface sớm cho 5 ranh giới sau (ngoài danh sách này **không** tạo interface "cho chắc"):
- `<Aggregate>Repository` (adapter: Drizzle ORM trên PostgreSQL/Neon)
- `Mailer` (adapter: SMTP email CLB)
- `Clock` (adapter: đồng hồ hệ thống / mock clock khi test)
- `Logger` (adapter: log có cấu trúc, lọc bỏ PII)
- `Config` (adapter: đọc & validate env 1 lần lúc khởi động)

### 6A.4 Mẫu thiết kế bắt buộc
- **Service Layer:** một hàm/lớp cho mỗi use case.
- **Repository + DTO/Mapper:** trả về miền/DTO, **không trả entity ORM ra API**; **mapper là nơi ẩn MSSV/email** theo quyền người xem.
- **Policy (Specification):** `taskVisibilityPolicy`, `canToggleHidden` — 1 nguồn duy nhất cho mọi list/search/count/detail/events/trash/reminders.
- **Registry dữ liệu:** mảng hằng `PERMISSIONS` sinh kiểu, seed và UI.
- **Manual DI + Composition root:** lắp ráp tại `src/server/shared/composition.ts`; service nhận hạ tầng qua tham số.
- **Typed errors (`AppError`):** `(code, messageKey, httpStatus)`, ánh xạ tập trung ở route wrapper; không nuốt lỗi.
- **Transaction boundary (`TransactionRunner`):** đổi quyền + audit, gỡ admin cuối, ghi task + `task_events`.
- **Command (`apply`/`invert`) + Registry:** cho mọi `task_events` hoàn tác được.
- **Strategy/Factory:** chỉ khi có >= 2 biến thể thật (preset quyền, email theo locale). **Job idempotent:** unique `(task_id, user_id, kind)` trong `reminders`.
- **Frontend:** tổ chức theo `src/features/<feature>`; component thuần nhận props, logic/API ở hook; 1 API client tập trung sinh kiểu từ `openapi.yaml`; 1 cách server-state (`TanStack Query`) & form (`React Hook Form` + `Zod`); không truyền props > 2 cấp; `<Can>`/`usePermissions` chỉ để tiện UI; 100% chuỗi qua `messages/`.

### 6A.5 Thêm tính năng mới (giai đoạn 2)
Migration cộng thêm → module mới `src/server/modules/<m>` → thêm quyền vào `PERMISSIONS` + migration → thêm endpoint `openapi.yaml` → route mỏng → `src/features/<m>` → `messages/` `vi` & `en` → test policy/service/repo. Không sửa logic module cũ ngoài `index.ts`.

### 6A.6 Chất lượng mã (ngưỡng lint)
Hàm <= ~40 dòng; file <= ~300 dòng; tham số <= 3–4 (dùng object); complexity <= 10; lồng <= 3 cấp (dùng early return). Không `any`, không mã chết, không magic string/number. Comment giải thích **vì sao**. Tránh truy vấn N+1, dùng phân trang cursor; ghi tranh chấp (kéo thả, `tasks.version`, admin cuối) dùng cập nhật có điều kiện/khóa dòng.

### 6A.7 Design note (ghi trước khi code, trừ item rất nhỏ)
```
Design note: <ID>
Chạm: <modules/files>
Port/interface: <dùng port nào; có thêm không>
Mẫu áp dụng: <Service Layer / Policy / Mapper / Transaction / Command...>
Điểm mở rộng giữ lại: <...>
Quyết định: <chọn X thay Y vì ...>
Phụ thuộc mới: không (hoặc đã ghi DECISIONS.md)
```

### 6A.8 Checklist thiết kế (tự kiểm tra trước PR)
- [ ] Route/handler mỏng, không chứa nghiệp vụ.
- [ ] Nghiệp vụ nằm trong service/policy, không nằm trong route hay React component.
- [ ] Mọi truy cập DB qua repository; không SQL/ORM ngoài repository.
- [ ] Service nhận hạ tầng qua tham số (DI), test được bằng bản giả.
- [ ] Hướng phụ thuộc đúng 6A.2; không import nội bộ module khác; không vòng phụ thuộc.
- [ ] Không lặp điều kiện quyền, task ẩn, ẩn MSSV/email: dùng policy/mapper chung.
- [ ] Không trả entity DB ra API; DTO qua mapper; không lộ MSSV/email.
- [ ] Lỗi dùng `AppError`; không nuốt lỗi.
- [ ] Không magic string/number; mã quyền lấy từ `PERMISSIONS`.
- [ ] Thay đổi chỉ cộng thêm (migration, API); không phá cái đã có.
- [ ] Không thêm trừu tượng/thư viện thừa; mọi cái mới có lý do ghi rõ.
- [ ] Hàm & file trong ngưỡng 6A.6; lint & kiểm tra kiến trúc sạch.
- [ ] Đủ test policy/service (bản giả) và integration test repository (DB test).

### 6A.9–6A.10 Chống over-engineering & Công cụ
Không event bus, CQRS, microservice, DDD đầy đủ, plugin system, framework DI trong MVP. Thư viện mới phải ghi `DECISIONS.md` và chờ duyệt. CI chạy `dependency-cruiser`, ESLint (complexity, max-lines, `no-explicit-any`), TypeScript `strict`. Cấm `eslint-disable` trừ khi có lý do trong PR và được duyệt.

## 7. Quy tắc bảo mật & nghiệp vụ

- **Danh tính & PII:** MSSV & email chỉ hiện cho `member.view_detail` và chính chủ (S08/`GET /me`). Nơi khác chỉ hiện họ tên; thành viên đã rời (`is_active=false`) hiện `"(đã rời)"`. **Cấm ghi MSSV/email vào log**, URL, email nhắc hoặc thông báo lỗi. Email phải thuộc `@eiu.edu.vn` (cấu hình qua `ALLOWED_EMAIL_DOMAIN`), kiểm tra ở server. MSSV không đổi được sau khi tạo (`WQ-21`).
- **Task ẩn:** `is_hidden=true` chỉ hiển thị cho **người được giao, người tạo và admin**. Lọc ở mọi list/search/count/detail/comments/events/trash/reminders. Người không được xem nhận **404**. Chỉ người tạo và admin bật/tắt cờ ẩn; `task.update_any` không cho xem/sửa task ẩn không thuộc mình.
- **Quyền:** `authorize(user, permission, resource?)` đúng khi `is_active` và (`is_admin` hoặc có `user_permissions` khớp). Quyền toàn CLB, vĩnh viễn. **Đọc quyền từ DB mỗi request**, không nhúng vào cookie. Chỉ admin sửa `user_permissions` & `is_admin`; áp mẫu quyền thay thế toàn bộ quyền hiện tại (`WQ-06`). Trigger CSDL + transaction đảm bảo **luôn còn >= 1 admin hoạt động**. Mọi đổi quyền ghi `audit_logs` (chỉ ghi thêm). Tài khoản mới mặc định: `member.view`, `task.update_assigned`, `comment.create`.
- **Đăng nhập & session:** chỉ MSSV, không mật khẩu/OTP; lỗi đăng nhập chung chung; giới hạn thử theo IP + ghi `login_attempts`. Ô "Ghi nhớ đăng nhập" (mặc định không tích): không tích → session cookie + `SESSION_TTL_DEFAULT` (24h); tích → `SESSION_TTL_REMEMBER` (30 ngày, trượt). Cookie `HttpOnly`, `Secure`, `SameSite`. `returnTo` chỉ chấp nhận path nội bộ hợp lệ (`WQ-09`, `WQ-15`).
- **Lịch sử & hoàn tác:** service ghi `task_events` cùng transaction khi có thay đổi thật; **chỉ ghi thêm** (cấm `UPDATE`/`DELETE` kể cả admin); chỉ lưu ID, không lưu tên/MSSV/email. Mọi endpoint ghi task trả `eventId`. Hoàn tác = sự kiện mới (`reverts_event_id`), kiểm tra quyền thao tác gốc & xung đột theo giá trị `to` + `tasks.version` (`409` nếu khác, trừ khi `force=true`). Hoàn tác được: sửa trường, chuyển cột/vị trí, đổi assignee, bật/tắt ẩn, xóa/khôi phục. Không hoàn tác: comment, `audit_logs`.
- **Xóa mềm & Thùng rác:** xóa task chỉ đặt `deleted_at`; lọc `deleted_at IS NULL` ở mọi truy vấn thường; chỉ Thùng rác (`task.delete`/admin) thấy task đã xóa; **giữ mãi trong MVP, không xóa vĩnh viễn (`Q39`)**. Khôi phục về cột cũ hoặc cột đầu tiên nếu cột cũ đã xóa (`WQ-33`). Xóa cột còn task → `409` (`WQ-05`); xóa ban còn thành viên/board → `409` (`WQ-10`).
- **Nhắc deadline:** admin cấu hình mốc trong `app_settings` (mặc định 2 ngày, 1 ngày, quá hạn); gửi 07:00 UTC+7 mỗi ngày; 1 email gộp/người/ngày theo `profiles.locale`; unique `(task_id, user_id, kind)` chống gửi trùng; bỏ qua task cột Done, task đã xóa mềm, thành viên đã rời; email task ẩn chỉ gửi người được xem và **không lộ tiêu đề (`WQ-27`)**. Cron bảo vệ bằng `CRON_SECRET`.

## 8. Test & Item Rủi ro cao

- Bắt buộc có test cho: **từng mã quyền (1 test được + 1 test không được)**, task ẩn (404), ẩn MSSV/email, đăng nhập (đúng, lạ, khóa, rate limit, `returnTo`), 2 chế độ session TTL, gỡ admin cuối, `task_events` + hoàn tác (403, 409, `force`, 404 task ẩn, append-only), cron reminder không gửi trùng, i18n đủ khóa `vi`/`en`.
- Policy/service test bằng bản giả (không cần DB thật); repository test tích hợp trên `TEST_DATABASE_URL`.
- **Item RỦI RO CAO** (auth/session, `authorize`, lọc task ẩn, ẩn MSSV/email, lịch sử/hoàn tác, cron mail, migration, config prod): bắt buộc test đầy đủ + ghi `[RỦI RO CAO]` ở PR + **`qa-reviewer` ngữ cảnh sạch review diff**.

## 9. Mẫu chuẩn

### 9.1 Ghi chú bàn giao PR
```
Item: <ID>   [RỦI RO CAO nếu có]
Sub-agent tham gia: <Coordinator / backend-db / frontend / qa-reviewer>
Đã làm: ...
File thay đổi: ...
Cách chạy và kiểm tra: ...
AC đã đạt / chưa đạt: ...
Design note: ...
Checklist thiết kế (6A.8): đạt / mục chưa đạt & lý do: ...
Giả định / Câu hỏi: ...
```

### 9.2 `docs/STATUS.md` | 9.3 Backlog item | 9.4 `docs/DECISIONS.md`
Giữ đúng mẫu trong `docs/HANDOFF-club-management-website.md` mục 11.7 và `docs/STATUS.md` / `docs/DECISIONS.md` hiện có.

## 10. Lệnh chuẩn *(điền hoàn chỉnh khi xong E1)*

| Việc | Lệnh |
|---|---|
| Cài phụ thuộc | `npm install` *(E1)* |
| Chạy dev / Typecheck / Lint | `<điền ở E1>` |
| Test / Kiến trúc / OpenAPI | `<điền ở E1>` |
| Áp migration & seed (dev) | `psql` (`db/migrations/`, `db/seed.sql`) → Drizzle ở E1 |

## 11. Điều cấm tóm tắt
Chạm production; commit bí mật; merge chưa duyệt; đoán nghiệp vụ; sửa HANDOFF; sửa test/hạ AC; lộ MSSV/email hoặc task ẩn; bỏ qua `authorize`; đặt nghiệp vụ trong route/UI hoặc SQL ngoài repository; import chéo nội bộ module; trả entity ORM ra API; tự chế crypto; thêm tính năng ngoài MVP.

## Phụ lục A. Danh mục 18 quyền (`PERMISSIONS`)

| Nhóm | Mã quyền | Ý nghĩa |
|---|---|---|
| Thành viên | `member.view`, `member.view_detail`, `member.create`, `member.update`, `member.deactivate` | Xem tên/ban; xem MSSV/email; thêm; sửa/gán ban; khóa/mở |
| Ban | `department.manage` | Tạo/sửa/xóa ban |
| Board | `board.create`, `board.update`, `board.delete` | Tạo; sửa/cột; lưu trữ |
| Task | `task.create`, `task.assign`, `task.update_any`, `task.update_assigned`, `task.delete` | Tạo; giao; sửa mọi; sửa được giao; xóa mềm/khôi phục |
| Bình luận | `comment.create`, `comment.delete_any` | Tạo bình luận; xóa bình luận người khác |
| Hệ thống | `reminder.configure`, `audit.view` | Cấu hình mốc nhắc; xem nhật ký quản trị |

Ngoài danh mục: xem task không ẩn (mọi tài khoản active), bật/tắt cờ ẩn (người tạo task & admin), cấp/thu hồi quyền & cờ admin (chỉ admin).

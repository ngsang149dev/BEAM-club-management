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

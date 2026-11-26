# Checklist Kiểm thử Chấp nhận Người dùng UAT (`docs/UAT-CHECKLIST.md`)

Kế hoạch kiểm thử thực tế cho **5–10 thành viên CLB BEAM dùng thử trong 1 tuần** (`HANDOFF §9`, `E9-03`), đối chiếu toàn bộ luồng nghiệp vụ `FR-01`..`FR-62`, `AC-01`..`AC-22` và các yêu cầu bổ sung `CR-01`..`CR-07`.

---

## 1. Chuẩn bị trước đợt UAT

- **Môi trường:** Bản deploy Preview/Staging (hoặc môi trường UAT riêng có SMTP thử nghiệm, tuyệt đối tách biệt dữ liệu chính thức khi thử gửi/xóa).
- **Nhóm tài khoản kiểm thử tối thiểu 4 vai trò:**
  1. `UAT-Admin`: tài khoản `is_admin = true`.
  2. `UAT-Lead`: thành viên có quyền `member.view`, `member.view_detail`, `board.create`, `board.update`, `task.create`, `task.assign`, `task.update_any`, `task.delete`, `comment.create`, `department.manage`.
  3. `UAT-Member`: thành viên mới với bộ quyền mặc định (`member.view`, `task.update_assigned`, `comment.create`).
  4. `UAT-Inactive`: tài khoản đã bị khóa (`is_active = false`).
- **Thiết bị kiểm thử:** Cả trình duyệt **Desktop (`>= 1440px`)** và **Mobile (`~375px`)**; chuyển đổi cả hai ngôn ngữ **Tiếng Việt** & **English**.

---

## 2. Kịch bản kiểm thử UAT (`10` nhóm trọng tâm)

| # | Kịch bản & Thao tác thực tế | Kỳ vọng đạt (`AC` / `FR`) | Đạt? | Ghi chú người thử |
|---|---|---|---|---|
| **U1** | **Đăng nhập & Phiên (`S01`, `S08`)** <br>1) Nhập MSSV lạ hoặc sai mật khẩu. <br>2) Đăng nhập `UAT-Inactive`. <br>3) Đăng nhập `UAT-Member` không tích *"Ghi nhớ đăng nhập"*, đóng hẳn trình duyệt rồi mở lại. <br>4) Đăng nhập có tích *"Ghi nhớ đăng nhập"*. <br>5) Thử nhập sai liên tiếp vượt ngưỡng thử. | - Không tạo tài khoản mới; thông báo chung không lộ MSSV tồn tại (`AC-01`). <br>- Tài khoản khóa bị từ chối (`AC-02`). <br>- Không tích "Ghi nhớ": mở lại trình duyệt phải đăng nhập lại (`AC-13`); có tích vẫn giữ phiên (`AC-05`). <br>- Nhập sai liên tiếp bị chặn tạm `429` (`AC-12`). | [ ] | |
| **U2** | **Thành viên & Bảo vệ PII (`S07`, `S08`, `S09`)** <br>1) Dùng `UAT-Admin` tạo thành viên mới nhập email ngoài `@eiu.edu.vn`. <br>2) Đổi sang email `@eiu.edu.vn` hợp lệ, gán nhiều ban. <br>3) Đăng nhập `UAT-Member` xem danh sách thành viên, hồ sơ người khác và thẻ task. <br>4) Khóa một thành viên đã từng tạo/bình luận task. | - Email ngoài domain bị từ chối kèm lý do rõ (`AC-14`). <br>- `UAT-Member` **không thấy** MSSV/email của người khác ở mọi nơi (`AC-11`, `FR-42`), chỉ thấy MSSV/email của chính mình tại `/profile` (`S08`). <br>- Thành viên bị khóa hiển thị kèm `"(đã rời)"`, lịch sử việc làm vẫn giữ (`FR-43`). | [ ] | |
| **U3** | **Phân quyền & Hiệu lực tức thì (`S10`, `S11`, `S13`)** <br>1) Dùng `UAT-Lead` (không phải admin) mở/gọi `/admin/permissions`. <br>2) Dùng `UAT-Admin` áp mẫu quyền cho `UAT-Member`, sau đó mở 1 tab giữ nguyên phiên `UAT-Member` đang mở `/boards`, Admin thu hồi `board.create` (hoặc cấp/thu hồi `task.create`). <br>3) Thử bỏ cờ Admin của Admin duy nhất còn lại. <br>4) Xem `/admin/audit`. | - Non-admin không được sửa quyền/cờ admin (`AC-08`). <br>- Quyền mới có hiệu lực **ngay lập tức** trên phiên đang mở không cần F5/đăng nhập lại (`AC-07`, `AC-06`). <br>- Chặn gỡ Admin cuối (`AC-09`, `409`). <br>- `/admin/audit` ghi nhận rõ người thực hiện, đối tượng, chi tiết thay đổi không lộ MSSV (`AC-10`). | [ ] | |
| **U4** | **Board, Cột & Kéo thả / Mobile (`S03`, `S04`)** <br>1) Tạo board mới, thêm/đổi thứ tự/đổi tên cột, thử xóa cột đang còn task. <br>2) Kéo thả thẻ sang cột khác và đổi thứ tự trong cột. <br>3) Bật bộ lọc bất kỳ, dùng menu `⋯ -> Chuyển tới cột…` trên thẻ task (Desktop & Mobile `375px`). | - Xóa cột còn task bị chặn lịch sự (`409`). <br>- Khi không lọc: kéo thả mượt, tải lại trang giữ nguyên thứ tự. <br>- Khi đang lọc/sắp xếp: kéo thả tạm khóa có thông báo rõ; menu `⋯ -> Chuyển tới cột…` hoạt động bình thường trên cả Mobile (`FR-22`, `NFR-07`). | [ ] | |
| **U5** | **Giao việc cá nhân / theo Ban & Thông báo (`S04`, `S05`, `S06`)** <br>1) Tạo task chọn cả thành viên lẻ lẫn 1 Ban (nhiều thành viên thuộc Ban đó). <br>2) Bật/tắt tùy chọn gửi thông báo web & email. <br>3) Mở `/my-tasks` (`S06`) và chuông thông báo trên thanh trên cùng. | - Thành viên trong Ban & người nhận lẻ thấy task tại `/my-tasks`; thành viên trùng vừa gán lẻ vừa thuộc Ban không nhận trùng chuông/email (`CR-03`, `CR-05`, `CR-06`). <br>- Task ở cột cuối `Done` **không** còn gắn cảnh báo quá hạn. | [ ] | |
| **U6** | **Bình luận & Task ẩn `404` (`S05`, `AC-15`, `AC-20`)** <br>1) `UAT-Lead` tạo 1 task bật **Ẩn** chỉ giao cho `UAT-Member` (và thử bật ẩn khi chưa giao ai xem cảnh báo `WQ-27`). <br>2) Đăng 12+ bình luận dài ngắn khác nhau trong tab `Bình luận`. <br>3) Dùng 1 tài khoản thứ 3 (không phải Admin, không tạo, không được giao) tìm kiếm task ẩn, mở `/boards/{id}`, mở trực tiếp URL `/boards/{id}?task={id}` hoặc gọi API `/tasks/{id}`, `/comments`, `/events`. | - Khung bình luận gọn gàng: mới nhất trên đầu, phân trang tải thêm bình luận cũ, thu gọn/mở rộng bình luận dài. <br>- Người không liên quan **không thấy** task ẩn ở board, bộ đếm board, kết quả tìm kiếm hay API và nhận trạng thái `404` ở mọi đường (`AC-15`, `AC-20`). | [ ] | |
| **U7** | **Lịch sử, Hoàn tác `10s`, Xung đột `409` & Thùng rác (`S04`, `S05`, `S15`)** <br>1) Đổi cột hoặc đổi Priority của task -> bấm **`Hoàn tác`** trên toast trong `10s`. <br>2) Mở tab `Lịch sử`: người B sửa tiếp trường vừa đổi rồi người A bấm **`Khôi phục giá trị này`** trên sự kiện cũ. <br>3) Xóa mềm 1 task, kiểm tra nút **Thùng rác** trên Board rồi khôi phục lại. | - Bấm Hoàn tác phục hồi giá trị cũ và ghi thêm sự kiện mới có dấu hiệu hoàn tác, không xóa lịch sử cũ (`AC-17`, `AC-22`). <br>- Sửa đè gây hộp thoại xung đột `409` liệt kê trường xung đột và cho phép xác nhận ghi đè (`force`, `AC-18`). <br>- Task khôi phục từ Thùng rác về đúng cột/vị trí cũ (hoặc cột đầu tiên nếu cột cũ đã xóa, `AC-21`). | [ ] | |
| **U8** | **Kho lưu trữ (`/archive`)** <br>1) Mở `/archive` kiểm tra 3 tab (Task đã xóa, Thành viên đã khóa, Board đã lưu trữ). <br>2) Khôi phục 1 board lưu trữ và thử luồng dọn giữ (`retentionDays`). | - Chỉ người có quyền tương ứng xem được tab tương ứng (`CR-04`); khôi phục hoạt động đúng; người không được xem task ẩn vẫn không thấy task ẩn trong `/archive`. | [ ] | |
| **U9** | **Cấu hình nhắc deadline & Gửi Gmail thật (`S12`, `E01`)** <br>1) Mở `/admin/reminders` với `UAT-Admin`: kiểm tra giao diện tinh gọn (badge `07:00 · GMT+7`, 3 mốc chuẩn, chú thích `"Nhắc 1 lần khi công việc vừa quá hạn."`, thêm/xóa mốc ngày tùy chỉnh `0..365`, chuyển xem trước `VI`/`EN`). <br>2) Tắt hết mọi mốc kiểm tra cảnh báo + nút **`Bật lại mốc mặc định`**. <br>3) **Kiểm thử thủ công (`HANDOFF §9`):** kích hoạt cron reminder với Gmail thật của 2 thành viên (bao gồm 1 task bình thường + 1 task ẩn cùng ngày). <br>4) Gọi lại cron lần 2 ngay trong cùng ngày. | - Giao diện gọn rõ, dễ hiểu, không thông tin kỹ thuật thừa; thử `UAT-Member` vào `/admin/reminders` bị chặn `403`. <br>- Email nhận trên **Gmail thật** vào **hộp thư chính (Primary, không rơi Spam)**, gộp `1` thư/người/ngày đúng ngôn ngữ đã chọn của từng thành viên (`profiles.locale` — chuyển bằng nút `VI / EN` trên thanh bên hoặc trang `/login`), tiêu đề task ẩn được che an toàn (`WQ-27`). <br>- Chạy lần 2 cùng ngày **không** gửi email lặp lại (`AC-03`, `FR-31`). | [ ] | |
| **U10** | **Giao diện CLB (`/admin/branding`), Song ngữ & Responsive** <br>1) Mở `/admin/branding` tải Logo CLB, Chữ ảnh `.svg` trong suốt & 2–4 ảnh khung Polaroid `/login`. <br>2) Mở `/login` trên Desktop (kéo ngang, nhấn `<`/`>`, kiểm tra chân trang `BEAM CLUB × Sang`) và Mobile `375px`. <br>3) Chuyển toàn bộ giao diện `VI <-> EN` bằng bộ chuyển ngôn ngữ tại trang `/login` và trên thanh bên điều hướng (Desktop sidebar / Mobile menu). | - Logo & Chữ ảnh cập nhật toàn site; Desktop `/login` hiện tường triển lãm Polaroid mượt, Mobile tự ẩn gallery không tràn ngang. <br>- 100% nhãn/nút/thông báo dịch tự nhiên cả `VI` và `EN`, không vỡ chữ trên Mobile (`FR-50`, `NFR-07`, `NFR-10`). | [ ] | |

---

## 3. Tổng hợp kết quả & Điều kiện phát hành `v1.0`

- **Thời gian UAT:** `____/____/2026` → `____/____/2026`
- **Số thành viên tham gia:** `____` người (mục tiêu 5–10 thành viên)
- **Điều kiện chốt lên Production:**
  - `0` lỗi mức Nghiêm trọng / Cao liên quan tới phân quyền, rò rỉ MSSV/email, lộ task ẩn `404`, hoặc mất dữ liệu.
  - Email nhắc deadline vào hộp thư chính trên Gmail thật (không vào Spam).
  - Các lỗi giao diện/câu chữ phát sinh trong UAT đã được ghi nhận và xử lý trước ngày công bố chính thức cho toàn CLB.

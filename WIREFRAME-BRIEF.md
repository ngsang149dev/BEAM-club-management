# BRIEF: Thiết kế wireframe cho website quản lý thành viên & giao task của CLB

| Mục | Nội dung |
|---|---|
| Phiên bản brief | 1.2 |
| Ngày lập | 2026-11-21 (cập nhật lần cuối 2026-11-22) |
| Nguồn | Tài liệu HANDOFF v1.3 của dự án (brief này đã tóm tắt đủ để làm độc lập) |
| Ngôn ngữ làm việc | Tiếng Việt (giao diện cần song ngữ Việt/Anh) |
| Người duyệt | Chủ dự án (Sang) và chủ CLB |

> **Cách dùng:** đưa nguyên tệp này cho AI làm wireframe. AI làm đúng phạm vi ở mục 2, ghi mọi chỗ mơ hồ vào `OPEN-QUESTIONS.md` thay vì tự quyết nghiệp vụ, rồi nộp đầu ra theo mục 10.

---

## 1. Bối cảnh sản phẩm

Website **nội bộ** cho một câu lạc bộ (CLB) khoảng **50 thành viên**, chia thành **20 ban** (một người có thể thuộc 2 ban). Website dùng để:

1. Quản lý thành viên (hồ sơ, ban, quyền truy cập).
2. Giao và theo dõi task trên **bảng kiểu Trello** (cột, thẻ, kéo thả), có thêm **priority** cho task.
3. Tự động gửi **email nhắc deadline** (không có chức năng nhắc trong ứng dụng, chỉ có màn hình cấu hình).

Ưu tiên của dự án: đơn giản, ổn định, chi phí thấp. Giao diện sẽ được cài đặt bằng React/Next.js, nên wireframe cần chia thành các thành phần (component) rõ ràng.

## 2. Nhiệm vụ và phạm vi

**Việc của bạn:** thiết kế wireframe độ trung thực thấp (low-fidelity) cho toàn bộ màn hình ở mục 6, kèm điều hướng, luồng người dùng, các trạng thái đặc biệt và ghi chú.

**Không làm:**
- Không thiết kế hình ảnh hoàn thiện (màu thương hiệu, logo, minh họa). Dùng thang xám, chỉ giữ màu cho priority và cảnh báo hạn (mục 4).
- Không viết backend, không viết logic nghiệp vụ.
- **Không thêm tính năng ngoài danh sách.** MVP **không có**: nhãn màu (label), checklist, file đính kèm, lịch, báo cáo/thống kê, nhập CSV, thông báo trong ứng dụng, đổi mật khẩu, đăng ký tự do, quên mật khẩu.
- Không dùng dữ liệu thật (MSSV, email, tên thật). Dùng dữ liệu giả (mục 9).

**Thiết kế mở:** sau này sẽ thêm nhãn, checklist, đính kèm,... nên khung chi tiết task (S05) cần chừa một vùng gọn để chèn thêm khối chức năng mà không phải thiết kế lại. Chỉ vẽ vùng chừa chỗ (khung trống ghi chú "khối mở rộng"), không vẽ tính năng đó.

## 3. Người dùng và quyền

Có hai loại tài khoản:

- **Admin** (hiện có 2 người): có toàn quyền, sửa được mọi thứ, là người duy nhất cấp/thu hồi quyền.
- **Tài khoản thường:** chỉ có những quyền admin đã chọn từng cái. Mọi tài khoản mới mặc định có: `member.view`, `task.update_assigned`, `comment.create`.

Quyền áp dụng **toàn CLB**, không có phạm vi theo ban, không hết hạn. Danh mục 18 quyền:

| Nhóm | Mã quyền | Ý nghĩa |
|---|---|---|
| Thành viên | `member.view` | Xem danh sách thành viên (họ tên, ban) |
| Thành viên | `member.view_detail` | Xem MSSV, email |
| Thành viên | `member.create` | Thêm thành viên |
| Thành viên | `member.update` | Sửa hồ sơ, gán ban |
| Thành viên | `member.deactivate` | Khóa/mở khóa (thành viên rời CLB) |
| Ban | `department.manage` | Tạo/sửa/xóa ban |
| Board | `board.create` | Tạo board |
| Board | `board.update` | Sửa board, quản lý cột |
| Board | `board.delete` | Lưu trữ/xóa board |
| Task | `task.create` | Tạo task |
| Task | `task.assign` | Giao/bỏ giao người nhận |
| Task | `task.update_any` | Sửa, di chuyển mọi task |
| Task | `task.update_assigned` | Sửa, di chuyển task được giao cho mình |
| Task | `task.delete` | Xóa task |
| Bình luận | `comment.create` | Bình luận |
| Bình luận | `comment.delete_any` | Xóa bình luận của người khác |
| Hệ thống | `reminder.configure` | Cấu hình mốc nhắc deadline |
| Hệ thống | `audit.view` | Xem nhật ký quản trị |

Ngoài ra: **bật/tắt cờ ẩn của task** chỉ dành cho người tạo task và admin. **Phân quyền và cờ admin** chỉ dành cho admin.

**Nguyên tắc giao diện:** nút/mục nào người dùng không có quyền thì **ẩn** (hoặc hiện ở dạng chỉ đọc nếu cần để hiểu ngữ cảnh). Ẩn trên giao diện chỉ để tiện dùng, việc chặn thật do server làm; wireframe không cần vẽ cơ chế đó.

## 4. Quy tắc nghiệp vụ ảnh hưởng giao diện

Những điều dưới đây là **bắt buộc**, không được vi phạm trong wireframe.

1. **Đăng nhập chỉ bằng MSSV**: một ô nhập, không mật khẩu, không OTP. Thông báo lỗi **chung** (không cho biết MSSV có tồn tại hay không). Có thể bị chặn tạm khi thử quá nhiều lần.
2. **Ô "Ghi nhớ đăng nhập"** ở màn hình đăng nhập (mặc định không tích, có dòng nhắc "Chỉ tích trên thiết bị của bạn"). Không tích: đóng trình duyệt là phải đăng nhập lại. Tích: giữ đăng nhập lâu. Khi phiên hết hạn thì **đưa về màn hình đăng nhập kèm thông báo** "Phiên đã hết hạn, vui lòng đăng nhập lại". **Không có** hộp nhập lại MSSV giữa trang.
3. **MSSV và email là thông tin đăng nhập nhạy cảm:** chỉ hiện cho người có `member.view_detail`. Ở mọi nơi khác (người được giao, người bình luận, người tạo task, danh sách thành viên) **chỉ hiện họ tên**. Thành viên đã rời CLB hiện thêm "(đã rời)". Người dùng xem được MSSV/email **của chính mình** ở hồ sơ cá nhân.
4. **Task chung:** mọi tài khoản đang hoạt động xem được **mọi task không bị ẩn**. Thiếu quyền sửa thì xem ở chế độ chỉ đọc.
5. **Task ẩn:** task có cờ ẩn chỉ **người được giao, người tạo và admin** thấy. Người khác không thấy task đó ở bất cứ đâu (board, tìm kiếm, số đếm, đường dẫn trực tiếp cho kết quả như "không tìm thấy"). Trong chi tiết task, người được phép xem thấy biểu ngữ cảnh báo và công tắc cờ ẩn (công tắc chỉ cho người tạo và admin).
6. **Priority có 4 mức:** Thấp, Trung bình (mặc định), Cao, Khẩn. Hiển thị bằng **chữ hoặc biểu tượng kèm màu** (không chỉ dựa vào màu). Lọc và sắp xếp theo priority được.
7. **Hạn chót:** hiện trạng thái sắp đến hạn/quá hạn bằng chữ kèm màu. Task ở cột cuối ("Done") không còn cảnh báo hạn.
8. **Cột mặc định** của board: Todo, Doing, Review, Done. Người có quyền thêm/sửa/xóa/sắp xếp cột được.
9. **Một người có thể thuộc nhiều ban** (thực tế tối đa 2): hiển thị ban dạng chip.
10. **Khóa tài khoản = thành viên rời CLB:** dữ liệu và task của họ được giữ, tài khoản không đăng nhập được.
11. **Song ngữ Việt/Anh:** mọi màn hình có công tắc ngôn ngữ; bố cục chịu được chuỗi dài (tiếng Việt thường dài hơn tiếng Anh khoảng 20–30%). Wireframe ghi chuỗi cả hai ngôn ngữ cho các nút và tiêu đề chính.
12. **Luôn còn ít nhất một admin hoạt động:** gỡ cờ admin hoặc khóa admin cuối cùng phải bị chặn kèm thông báo.
13. **Lịch sử hoạt động của task:** mỗi task có tab "Lịch sử" (mới nhất trước) ghi ai làm gì, khi nào, giá trị trước và sau, bằng câu dễ đọc (ví dụ "Trần Thị B đã đổi priority từ Trung bình sang Cao"). Chỉ hiện họ tên (không MSSV/email), người đã rời hiện "(đã rời)"; task ẩn thì lịch sử chỉ người được xem task mới thấy. Lịch sử chỉ đọc, không có nút sửa/xóa.
14. **Hoàn tác (undo):** ngay sau thao tác hoàn tác được (đổi cột, sửa trường, giao người, bật/tắt ẩn, xóa), hiện thông báo nhỏ có nút "Hoàn tác" trong 10 giây. Trong tab Lịch sử, mỗi thay đổi hoàn tác được có nút "Khôi phục giá trị này". Nếu task đã bị sửa tiếp thì hiện hộp cảnh báo xung đột nêu giá trị hiện tại, cho chọn "Vẫn khôi phục" hoặc "Hủy". Nút hoàn tác chỉ hiện với người có quyền của thao tác gốc. Không hoàn tác bình luận và thao tác quản trị.
15. **Xóa task là xóa mềm:** task vào "Thùng rác" của board; người có `task.delete` và admin khôi phục được. Không có xóa vĩnh viễn.

## 5. Yêu cầu chung cho wireframe

- **Mobile-first:** vẽ bản **mobile (rộng 390px)** và **desktop (rộng 1280px)** cho mọi màn hình.
- **Trạng thái:** mỗi màn hình có đủ các trạng thái liên quan: bình thường, trống, đang tải, lỗi, không có quyền, hết session.
- **Kéo thả:** mọi chỗ kéo thả (thẻ task, thứ tự cột) phải có **cách thay thế không cần kéo** (ví dụ menu "Chuyển tới cột...", nút lên/xuống) để dùng được bằng bàn phím và trên điện thoại.
- **Khả năng tiếp cận cơ bản:** vùng chạm tối thiểu 44px, không truyền đạt thông tin chỉ bằng màu, thứ tự tab hợp lý.
- **Nhất quán:** dùng chung một bộ thành phần (thanh điều hướng, thẻ, bảng, hộp thoại, biểu mẫu, chip, badge). Đặt tên thành phần để dễ chuyển thành React component.
- **Ghi chú (annotation):** mỗi màn hình có phần ghi chú: mục đích, quy tắc liên quan, FR/AC, trạng thái đặc biệt.

## 6. Danh sách màn hình

### Điều hướng chung
- **Desktop:** thanh bên (sidebar). **Mobile:** thanh dưới hoặc menu ba gạch.
- Mục chính (mọi tài khoản): **Board**, **Task của tôi**, **Thành viên** (cần `member.view`), **Hồ sơ**.
- Nhóm **Quản trị** (chỉ hiện mục mà tài khoản có quyền): Quản trị thành viên (`member.*`), Phân quyền (chỉ admin), Ban (`department.manage`), Nhắc deadline (`reminder.configure`), Nhật ký (`audit.view`).
- Luôn có: công tắc ngôn ngữ Việt/Anh, đăng xuất.

### S01. Đăng nhập
- **Ai thấy:** mọi người (chưa đăng nhập). **FR/AC:** FR-04, FR-11, FR-40, FR-41, AC-01, AC-05, AC-13.
- **Thành phần:** tên CLB, một ô nhập MSSV, **hộp tích "Ghi nhớ đăng nhập"** (mặc định không tích, kèm dòng nhắc nhỏ "Chỉ tích trên thiết bị của bạn"), nút Đăng nhập, công tắc ngôn ngữ.
- **Trạng thái:** đang xử lý; lỗi chung (ví dụ "Không thể đăng nhập. Kiểm tra lại MSSV hoặc liên hệ admin."); bị chặn tạm kèm thời gian chờ; thông báo "Phiên đã hết hạn, vui lòng đăng nhập lại" khi bị đưa về từ trang khác.
- **Không có:** quên mật khẩu, đăng ký, mật khẩu, mã OTP.

### S02. (Đã bỏ)
- Không còn hộp nhập lại MSSV giữa trang. Hết phiên thì chuyển về S01 kèm thông báo. Giữ nguyên mã các màn hình khác (S03 đến S14), không đánh số lại.

### S03. Danh sách board
- **Ai thấy:** mọi tài khoản. **FR/AC:** FR-06, FR-20.
- **Thành phần:** lưới hoặc danh sách thẻ board (tên, ban nếu có); lọc theo ban; nút Tạo board (nếu `board.create`); menu mỗi board: sửa/lưu trữ (theo `board.update`, `board.delete`).
- **Trạng thái:** trống ("Chưa có board"); đang tải; lỗi.

### S04. Bảng Kanban (board)
- **Ai thấy:** mọi tài khoản (task ẩn chỉ hiện cho người được phép). **FR/AC:** FR-03, FR-22, FR-25, FR-27.
- **Thanh trên:** tên board; bộ lọc theo người, priority, hạn, từ khóa; nút thêm cột (nếu `board.update`).
- **Cột:** tên, số task, menu (sửa tên, xóa cột, sắp xếp), nút "Thêm task" cuối cột (nếu `task.create`).
- **Thẻ task:** tiêu đề; badge priority; hạn kèm trạng thái sắp/quá hạn; người được giao (họ tên hoặc avatar chữ cái, tối đa 3 rồi "+n"); số bình luận; biểu tượng ẩn nếu là task ẩn.
- **Tương tác:** kéo thẻ giữa các cột và đổi thứ tự trong cột; kéo đổi thứ tự cột (nếu `board.update`); cách thay thế không cần kéo (mục 5). Người không có quyền sửa thì không kéo được thẻ; người có `task.update_assigned` chỉ kéo thẻ được giao cho mình.
- **Mobile:** hiện **một cột mỗi lần**, vuốt ngang giữa các cột, có chỉ báo cột hiện tại.
- **Trạng thái:** cột trống; board trống; xóa cột còn task (yêu cầu chuyển task sang cột khác trước); đang tải; lỗi.
- **Hoàn tác:** sau khi kéo thẻ hoặc xóa task, hiện thông báo "Hoàn tác" 10 giây; menu board có mục "Thùng rác" (chỉ khi có `task.delete`) mở S15.

### S05. Chi tiết task
- **Ai thấy:** người xem được task đó. **FR/AC:** FR-21, FR-24, FR-07, FR-27, AC-15.
- **Hình thức:** khung bên (desktop), toàn màn hình (mobile).
- **Thành phần:** tiêu đề (sửa tại chỗ); mô tả; cột/trạng thái; **priority** (chọn 4 mức); hạn chót; **người được giao** (chọn nhiều, chỉ khi có `task.assign`); **công tắc cờ ẩn** (chỉ người tạo và admin); người tạo và thời gian tạo; **bình luận** (danh sách, ô nhập nếu có `comment.create`, xóa bình luận của mình hoặc của người khác nếu có `comment.delete_any`); nút xóa/lưu trữ (nếu `task.delete`); **vùng chừa chỗ cho khối mở rộng** (mục 2).
- **Biểu ngữ task ẩn:** "Task này đang ẩn: chỉ người được giao, người tạo và admin xem được." (kèm bản tiếng Anh).
- **Chế độ chỉ đọc:** người thiếu quyền sửa thấy toàn bộ thông tin nhưng không có điều khiển sửa.
- **Tab Lịch sử:** danh sách sự kiện mới nhất trước (người thực hiện, thời gian, câu mô tả thay đổi); nút "Khôi phục giá trị này" ở mục hoàn tác được; hộp cảnh báo xung đột; trạng thái trống và đang tải.
- **Trạng thái:** đang lưu; lỗi lưu; không tìm thấy (cũng dùng khi mở task ẩn mà không có quyền xem); hết phiên (đưa về S01 kèm thông báo).

### S06. Task của tôi
- **Ai thấy:** mọi tài khoản. **FR/AC:** FR-23.
- **Thành phần:** danh sách task được giao cho tôi (kể cả task ẩn được giao); nhóm theo hạn (Quá hạn, Hôm nay, Tuần này, Sau đó, Không có hạn); lọc theo priority; mỗi dòng gồm tiêu đề, board, cột, hạn, priority. Bấm vào mở S05.
- **Trạng thái:** trống ("Bạn chưa được giao task nào"); đang tải; lỗi.

### S07. Danh sách thành viên
- **Ai thấy:** tài khoản có `member.view`. **FR/AC:** FR-42, FR-43.
- **Thành phần:** bảng/danh sách: họ tên, ban (chip, có thể 2), trạng thái (Đang hoạt động / Đã rời); **cột MSSV và email chỉ hiện khi có `member.view_detail`**; tìm kiếm; lọc theo ban và trạng thái.
- **Trạng thái:** trống; đang tải; không có quyền xem MSSV/email (cột không xuất hiện).

### S08. Hồ sơ cá nhân
- **Ai thấy:** mọi tài khoản. **FR/AC:** FR-50.
- **Thành phần:** họ tên, ban, MSSV và email của chính mình (chỉ đọc); chọn ngôn ngữ Việt/Anh; nút Đăng xuất. Không có đổi MSSV, không có đổi mật khẩu.

### S09. Quản trị thành viên
- **Ai thấy:** tài khoản có quyền `member.*` tương ứng, admin. **FR/AC:** FR-10, FR-43, AC-14.
- **Thành phần:** danh sách thành viên với hành động theo quyền; **biểu mẫu thêm/sửa:** MSSV, họ tên, email (bắt buộc, phải thuộc tên miền trường `@eiu.edu.vn`), ban (chọn nhiều), ngôn ngữ mặc định; nút khóa/mở khóa ("Đánh dấu đã rời") có hộp xác nhận nêu rõ hệ quả (không đăng nhập được, dữ liệu được giữ, không nhận nhắc deadline).
- **Trạng thái/lỗi:** email sai tên miền; MSSV trùng; thiếu email; lưu thành công; lỗi lưu. **Không có** nhập CSV, nhập hàng loạt.

### S10. Phân quyền theo tài khoản
- **Ai thấy:** chỉ admin. **FR/AC:** FR-14, FR-15, FR-17, FR-18, FR-19, AC-07 đến AC-10.
- **Thành phần:** chọn thành viên (tìm kiếm); danh mục quyền theo nhóm với **hộp tích từng quyền** kèm mô tả ngắn; nút **Áp mẫu quyền** (mẫu: Thành viên cơ bản, Trưởng ban, Quản lý nhân sự; áp mẫu = sao chép thành quyền riêng, có thể chỉnh tiếp); khung **Quyền hiệu lực** tóm tắt tài khoản đó làm được gì; **công tắc cờ admin** (riêng, có cảnh báo); nút Lưu kèm hộp xác nhận; liên kết sang lịch sử thay đổi quyền (S13).
- **Trạng thái/lỗi:** chặn gỡ admin cuối cùng; cảnh báo khi thu hồi quyền của người đang có task được giao (task giữ nguyên người được giao); lưu thành công; lỗi lưu.

### S11. Quản trị ban
- **Ai thấy:** tài khoản có `department.manage`. **FR/AC:** FR-13.
- **Thành phần:** danh sách khoảng 20 ban; thêm/sửa/xóa ban; xem thành viên của từng ban.
- **Trạng thái:** xóa ban còn thành viên hoặc board (cảnh báo hoặc yêu cầu chuyển).

### S12. Cấu hình nhắc deadline
- **Ai thấy:** tài khoản có `reminder.configure`. **FR/AC:** FR-30.
- **Thành phần:** danh sách mốc nhắc (ví dụ "2 ngày trước hạn", "1 ngày trước hạn"), thêm/xóa mốc; công tắc "Nhắc task quá hạn"; ghi chú giờ gửi cố định (mặc định 07:00 giờ Việt Nam); xem trước nội dung email nhắc (song ngữ).

### S13. Nhật ký quản trị
- **Ai thấy:** tài khoản có `audit.view`. **FR/AC:** FR-16.
- **Thành phần:** bảng chỉ đọc: thời gian, người thực hiện, hành động, đối tượng, chi tiết; lọc theo người, loại hành động, khoảng thời gian. Nhật ký **chỉ đọc**, không có nút sửa/xóa.

### S14. Trang lỗi và trạng thái hệ thống
- **Thành phần:** 403 không có quyền; 404 không tìm thấy (cũng dùng cho task ẩn); hết phiên (đưa về S01 kèm thông báo); lỗi chung; mất kết nối.

### S15. Thùng rác của board
- **Ai thấy:** tài khoản có `task.delete`, admin. **FR/AC:** FR-62, AC-21.
- **Thành phần:** danh sách task đã xóa (tiêu đề, người xóa, thời gian xóa, cột cũ), nút "Khôi phục" cho từng task, nút quay lại board.
- **Trạng thái:** trống ("Thùng rác trống"); đang tải; lỗi. **Không có** xóa vĩnh viễn.

### E01. Mẫu email nhắc deadline (phụ lục)
- Một email mỗi người, gửi theo ngôn ngữ của người nhận (vẽ cả bản Việt và Anh).
- Nội dung: lời chào bằng họ tên, danh sách task sắp đến hạn và quá hạn (tiêu đề, board, hạn, priority), liên kết mở từng task, nút mở "Task của tôi". **Không chứa MSSV.**

## 7. Luồng người dùng cần vẽ

1. **Dùng hằng ngày:** đăng nhập (S01) → danh sách board (S03) → mở board (S04) → kéo thẻ sang cột khác → mở chi tiết task (S05) → bình luận.
2. **Admin thêm thành viên và cấp quyền:** S09 (thêm) → S10 (áp mẫu quyền, chỉnh quyền, lưu).
3. **Task ẩn:** người tạo mở S05, bật cờ ẩn, giao cho A → A thấy task ở S04 và S06 → người khác không thấy task ở bất cứ đâu.
4. **Đăng nhập có/không ghi nhớ:** S01 (tích hoặc không tích "Ghi nhớ đăng nhập") → dùng → phiên hết hạn → quay về S01 kèm thông báo.
5. **Thành viên rời CLB:** S09 → khóa → thành viên hiện "(đã rời)" ở S07, S04, S05; không còn đăng nhập được.
6. **Tài khoản chỉ có quyền cơ bản:** vào S04 và S05 chỉ thấy chế độ chỉ đọc; chỉ kéo được thẻ được giao cho mình.
7. **Chuyển ngôn ngữ:** bấm công tắc → toàn bộ giao diện đổi ngôn ngữ, bố cục không vỡ.
8. **Hoàn tác:** S04 kéo thẻ sang cột khác → thông báo "Hoàn tác" → bấm → thẻ về chỗ cũ; hoặc S05 tab Lịch sử → "Khôi phục giá trị này" → (nếu xung đột) hộp cảnh báo → xác nhận.
9. **Khôi phục task đã xóa:** S04 xóa task → thông báo "Hoàn tác"; hoặc menu board → S15 Thùng rác → "Khôi phục".

## 8. Bảng hiển thị theo quyền

| Thành phần giao diện | Điều kiện để hiện/bật |
|---|---|
| Xem mọi task không ẩn, mọi board | Mọi tài khoản đang hoạt động |
| Nút Tạo board | `board.create` |
| Sửa board, quản lý cột | `board.update` |
| Lưu trữ/xóa board | `board.delete` |
| Nút Thêm task | `task.create` |
| Sửa/di chuyển mọi task | `task.update_any` |
| Sửa/di chuyển task được giao cho mình | `task.update_assigned` |
| Chọn người được giao | `task.assign` |
| Xóa task | `task.delete` |
| Tab Lịch sử | Người xem được task đó |
| Nút Hoàn tác / Khôi phục giá trị này | Có quyền của thao tác gốc (xem mục 4, quy tắc 14) |
| Thùng rác (S15) và nút Khôi phục | `task.delete` hoặc admin |
| Công tắc cờ ẩn | Người tạo task hoặc admin |
| Ô nhập bình luận | `comment.create` |
| Xóa bình luận của người khác | `comment.delete_any` |
| Mục Thành viên (S07) | `member.view` |
| Cột MSSV/email | `member.view_detail` |
| Thêm thành viên | `member.create` |
| Sửa hồ sơ thành viên, gán ban | `member.update` |
| Khóa/mở khóa tài khoản | `member.deactivate` |
| Quản trị ban (S11) | `department.manage` |
| Cấu hình nhắc (S12) | `reminder.configure` |
| Nhật ký (S13) | `audit.view` |
| Phân quyền (S10), cờ admin | Chỉ admin |

Admin thấy và làm được tất cả, kể cả task ẩn.

## 9. Dữ liệu mẫu cho wireframe

Dùng dữ liệu giả, không dùng dữ liệu thật:
- Thành viên: "Nguyễn Văn A", "Trần Thị B", "Lê Văn C",... (khoảng 8–10 người); MSSV giả dạng `MSSV-001`; email giả dạng `ten@example.edu.vn` (chỉ để minh họa định dạng).
- Ban: Truyền thông, Sự kiện, Học thuật, Nhân sự, Đối ngoại,... (khoảng 5–6 ban); có người thuộc 2 ban.
- Board mẫu với cột Todo/Doing/Review/Done và 8–12 task, trong đó có: task đủ 4 mức priority, một task quá hạn, một task sắp đến hạn, một task có nhiều người được giao, một task ẩn, một task của thành viên "(đã rời)".

## 10. Đầu ra mong muốn

**Định dạng ưu tiên:** wireframe tĩnh bằng **HTML** (không logic nghiệp vụ, không cần backend), thang xám, có công tắc ngôn ngữ Việt/Anh đơn giản. Nếu không tạo được HTML thì dùng SVG, hoặc mô tả có cấu trúc (khung chữ + chú thích). Không dùng ảnh thật.

**Cấu trúc nộp:**

```
wireframes/
  index.html            bản đồ điều hướng, danh sách màn hình, liên kết tới từng màn
  s01-login.html ... s15-trash.html, e01-reminder-email.html
  README.md             cách xem, quy ước, bảng truy vết (màn hình -> FR/AC -> quyền)
  OPEN-QUESTIONS.md     câu hỏi và giả định chưa chắc
```

**Mỗi màn hình gồm:** bản mobile (390px) và desktop (1280px); các trạng thái ở mục 5; ghi chú (mục đích, quy tắc, FR/AC, trạng thái đặc biệt).

**Bảng truy vết:** mỗi FR mức Must trong phụ lục A phải xuất hiện ở ít nhất một màn hình.

## 11. Tiêu chí chấp nhận

- [ ] Có đủ S01, S03 đến S15 và E01 (S02 đã bỏ), mỗi màn có bản mobile và desktop.
- [ ] Mọi FR Must ở phụ lục A có ít nhất một màn hình; bảng truy vết đầy đủ.
- [ ] Đăng nhập chỉ có một ô MSSV; không có mật khẩu, OTP, quên mật khẩu, đăng ký.
- [ ] MSSV/email không xuất hiện ở bất kỳ nơi nào ngoài S07 (cho người có `member.view_detail`), S08 (của chính mình) và S09; thẻ task, chi tiết task, bình luận, người được giao chỉ hiện họ tên.
- [ ] Task ẩn có biểu ngữ và công tắc đúng quy tắc; có luồng thể hiện người không được phép không thấy gì.
- [ ] Priority có đủ 4 mức, hiển thị bằng chữ/biểu tượng kèm màu, lọc và sắp xếp được.
- [ ] Kéo thả có cách thay thế không cần kéo; Kanban mobile hiện một cột mỗi lần.
- [ ] Màn hình đăng nhập có hộp tích "Ghi nhớ đăng nhập" (mặc định không tích) và thông báo khi phiên hết hạn; không có hộp nhập lại MSSV giữa trang.
- [ ] Mọi nút/mục phụ thuộc quyền khớp bảng ở mục 8.
- [ ] Bố cục không vỡ với chuỗi tiếng Việt dài; có công tắc ngôn ngữ.
- [ ] Có vùng chừa chỗ cho khối mở rộng ở S05; không vẽ nhãn, checklist, đính kèm, lịch, báo cáo, nhập CSV.
- [ ] Tab Lịch sử ở S05, thông báo "Hoàn tác" ở S04, hộp cảnh báo xung đột và S15 Thùng rác đều có; lịch sử không hiện MSSV/email và không có nút sửa/xóa.
- [ ] Mọi câu hỏi và giả định được ghi trong `OPEN-QUESTIONS.md`.

## 12. Cách làm việc gợi ý

1. Vẽ điều hướng chung và bộ thành phần dùng chung trước.
2. Làm theo nhóm: S01, rồi S03–S06, rồi S07–S09, rồi S10–S15 và E01.
3. Sau mỗi nhóm, ghi giả định và câu hỏi vào `OPEN-QUESTIONS.md`. **Gặp chỗ mơ hồ về nghiệp vụ thì ghi câu hỏi, không tự quyết.**
4. Cuối cùng kiểm tra lại bảng truy vết và tiêu chí chấp nhận.

---

## Phụ lục A. Yêu cầu chức năng liên quan (tóm tắt)

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| FR-03 | Bảng task giống Trello | Must |
| FR-04 | Tài khoản do admin đăng ký; đăng nhập bằng MSSV, không OTP | Must |
| FR-06 | Mọi thành viên xem được task chung (mọi task không ẩn), chỉ đọc | Must |
| FR-07 | Cờ ẩn task: chỉ người được giao, người tạo, admin xem được; người tạo và admin bật/tắt | Must |
| FR-10 | Admin thêm/sửa/khóa thành viên (MSSV, họ tên, ban, email bắt buộc thuộc `@eiu.edu.vn`) | Must |
| FR-11 | Chỉ MSSV do admin đăng ký và tài khoản đang hoạt động mới đăng nhập được | Must |
| FR-12 | Kiểm soát truy cập theo quyền được cấp cho từng tài khoản; mặc định từ chối | Must |
| FR-13 | Quản lý ban (20 ban); một thành viên có thể thuộc nhiều ban | Must |
| FR-14 | Trang phân quyền: admin chọn/bỏ từng quyền cho từng tài khoản | Must |
| FR-15 | Quyền có hiệu lực ngay sau khi lưu | Must |
| FR-16 | Nhật ký mọi thay đổi quyền và hành động quản trị | Must |
| FR-17 | Mẫu quyền (preset) | Must |
| FR-18 | Chỉ admin cấp/thu hồi quyền; luôn còn ít nhất một admin hoạt động | Must |
| FR-19 | Tài khoản mới mặc định có `member.view`, `task.update_assigned`, `comment.create` | Must |
| FR-20 | CRUD board và cột; cột mặc định Todo/Doing/Review/Done | Must |
| FR-21 | CRUD task: tiêu đề, mô tả, hạn, ưu tiên, nhiều người nhận | Must |
| FR-22 | Kéo thả thẻ giữa cột và đổi thứ tự trong cột | Must |
| FR-23 | Trang "Task của tôi" | Must |
| FR-24 | Bình luận trong task | Should |
| FR-25 | Lọc/tìm kiếm theo người, hạn, ưu tiên, trạng thái | Should |
| FR-26 | Task ẩn không lộ qua board, tìm kiếm, số đếm, bình luận | Must |
| FR-27 | Priority 4 mức, hiển thị, lọc, sắp xếp | Must |
| FR-30 | Email nhắc deadline ở các mốc do admin cấu hình | Must |
| FR-40 | Đăng nhập có ô "Ghi nhớ đăng nhập"; hết phiên thì về màn hình đăng nhập kèm thông báo | Must |
| FR-41 | Giới hạn nhẹ số lần thử đăng nhập; ghi log | Should |
| FR-42 | MSSV và email chỉ hiện cho người có `member.view_detail` | Must |
| FR-43 | Thành viên rời CLB: khóa tài khoản, giữ dữ liệu, hiện "(đã rời)" | Must |
| FR-50 | Giao diện song ngữ Việt/Anh; email nhắc theo ngôn ngữ người nhận | Must |
| FR-60 | Lịch sử hoạt động của task (tab Lịch sử), chỉ đọc, tuân thủ task ẩn và ẩn MSSV/email | Must |
| FR-61 | Hoàn tác: thông báo "Hoàn tác" 10 giây và "Khôi phục giá trị này" trong Lịch sử; xung đột có hộp cảnh báo | Must |
| FR-62 | Xóa mềm và Thùng rác của board (người có `task.delete`, admin) | Must |

## Phụ lục B. Thuật ngữ

| Thuật ngữ | Nghĩa |
|---|---|
| MSSV | Mã số sinh viên, dùng làm tên đăng nhập; không phải bí mật nên không được hiển thị bừa bãi |
| Board / cột / thẻ | Bảng / danh sách / task, theo kiểu Trello |
| Task ẩn | Task có cờ ẩn, chỉ người được giao, người tạo và admin thấy |
| Priority | Mức ưu tiên của task: Thấp, Trung bình, Cao, Khẩn |
| Admin | Tài khoản có quyền cao nhất, cấp/thu hồi quyền cho người khác |
| Mẫu quyền (preset) | Bộ quyền soạn sẵn để áp nhanh cho tài khoản |
| Wireframe low-fi | Bản phác giao diện đơn giản, chưa có màu sắc và hình ảnh hoàn thiện |

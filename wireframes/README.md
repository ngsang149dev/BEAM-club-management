# Bộ wireframe — website quản lý thành viên & giao task

Bản low-fidelity cho CLB BEAM, làm theo \`WIREFRAME-BRIEF.md\` v1.2 và \`HANDOFF-club-management-website.md\` v1.3. Mục đích là chốt **bố cục, luồng, trạng thái và phân quyền** trước khi viết giao diện thật — không phải bản dựng cuối, không có nghiệp vụ chạy được.

## Mở bằng gì

Không cần cài gì, không cần build để xem:

\`\`\`bash
open wireframes/index.html
\`\`\`

Nếu muốn dựng lại toàn bộ (khi sửa \`_build/\`):

\`\`\`bash
cd /Users/minhsang/Code/Projects/BEAM-club-management
node wireframes/_build/build.mjs
\`\`\`

Mở \`index.html\` trước: có danh mục, luồng chính, nguyên tắc và checklist review. \`components.html\` là thư viện thành phần.

## Điều hướng

- **Rail trái**: nhóm theo luồng (Tổng quan, Vào hệ thống, Làm việc, Con người & quyền, Hệ thống, Phụ lục).
- **Topbar**: chuyển VI/EN, in, mở thư viện thành phần.
- **Mỗi trang màn hình**: mục đích → khung desktop 1280 → khung mobile 390 → trạng thái → ghi chú đánh số → quyền → chuỗi VI/EN → câu hỏi mở.
- **“Xem 1:1”** tắt thu nhỏ để soi kích thước thật; khung tự vừa bề rộng cột.
- **Số trong khung** (pin) khớp với danh sách ghi chú ngay dưới khung. Không phải số thứ tự trang trí.

## Quy ước

| Quy ước | Cách làm |
|---|---|
| Màu | Thang xám cho mọi thứ. Chỉ priority (1–4 thanh + nhãn) và hạn (chữ + biểu tượng) dùng màu; đỏ cho phá hủy/lỗi. Không màu thương hiệu. |
| Dữ liệu | Giả: thành viên A–K, MSSV-001…010, email \`@eiu.edu.vn\`, ngày quanh 23/11/2026. Không dữ liệu thật. |
| MSSV/email | Chỉ ở S07 khi có \`member.view_detail\`, S08 cho chính chủ, S09 cho admin. Không nơi nào khác. |
| Task ẩn | Không render với người không được xem — không làm mờ, không đếm, không gợi ý. Người khác nhận 404. |
| Ngôn ngữ | Mọi chuỗi có \`data-vi\`/\`data-en\`; chuyển bằng công tắc, lưu \`localStorage\` khóa \`beam-wireframe-lang\`. |
| Tên lớp | Giao diện sản phẩm dùng \`.ui-*\`; vỏ tài liệu dùng \`.screen\`, \`.rail\`, \`.frame-*\`, \`.pin\`, \`.state-*\`. |

## Danh mục

| Mã | Tệp | Nội dung | Người dùng chính |
|---|---|---|---|
| S01 | \`s01-login.html\` | Đăng nhập bằng MSSV, ghi nhớ, lỗi chung | Chưa đăng nhập |
| S03 | \`s03-boards.html\` | Danh sách board theo ban | Lê Văn C |
| S04 | \`s04-board.html\` | Kanban 4 cột, kéo thả, task ẩn | Lê Văn C |
| S05 | \`s05-task.html\` | Chi tiết task, bình luận, lịch sử, hoàn tác | Lê Văn C |
| S06 | \`s06-my-tasks.html\` | Task của tôi, nhóm theo hạn | Nguyễn Văn A |
| S07 | \`s07-members.html\` | Danh sách thành viên, hai mức thông tin | C (desktop) / A (mobile) |
| S08 | \`s08-profile.html\` | Hồ sơ cá nhân, quyền, phiên | Nguyễn Văn A |
| S09 | \`s09-member-admin.html\` | Sửa/thêm/khóa thành viên trong drawer | Trần Thị B |
| S10 | \`s10-permissions.html\` | Ma trận 18 quyền, mẫu quyền | Trần Thị B |
| S11 | \`s11-departments.html\` | 20 ban, xóa có ràng buộc | Trần Thị B |
| S12 | \`s12-reminders.html\` | Mốc nhắc, giờ gửi, xem trước email | Trần Thị B |
| S13 | \`s13-audit.html\` | Nhật ký quản trị chỉ ghi thêm | Trần Thị B |
| S14 | \`s14-errors.html\` | 403/404/hết phiên/lỗi/mất mạng/bảo trì | Mọi người |
| S15 | \`s15-trash.html\` | Thùng rác board, khôi phục | Trần Thị B |
| E01 | \`e01-reminder-email.html\` | Email nhắc deadline VI/EN, desktop/mobile | Nguyễn Văn A |

**S02 không tồn tại.** Hết phiên quay về S01 kèm banner; không có hộp nhập lại MSSV giữa trang. Số thứ tự giữ nguyên để khớp brief.

## Trạng thái

Mỗi màn hình có các trạng thái tối thiểu: mặc định, trống, đang tải, lỗi. Thêm khi cần:

- **Quyền**: 403 nói thiếu quyền; 404 dùng chung cho không tồn tại và task ẩn.
- **Xung đột**: 409 khi hoàn tác hoặc kéo thả trên dữ liệu đã đổi.
- **Chỉ đọc**: người thiếu quyền thấy dữ liệu nhưng không thấy nút sửa.
- **Mobile**: bảng chuyển thành danh sách; kéo thả có menu thay thế; không phụ thuộc hover.

## Truy vết

- Mỗi màn hình ghi FR và AC liên quan ở đầu trang.
- Mỗi pin nêu lý do thiết kế, không chỉ mô tả hình.
- Mỗi màn hình có bảng chuỗi VI/EN cho các chuỗi mới.
- Câu hỏi mở nằm trong [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md), không tự quyết nghiệp vụ.

## Cấu trúc tệp

\`\`\`
wireframes/
  index.html, components.html
  s01-login.html … s15-trash.html, e01-reminder-email.html
  assets/wireframe.css, assets/wireframe.js
  _build/
    build.mjs          # vỏ trang, rail, khung, trạng thái, ghi chú
    lib.mjs            # icon SVG + component
    data.mjs           # dữ liệu giả
    screens/core.mjs   # S01, S03–S06
    screens/admin.mjs  # S07–S11
    screens/system.mjs # S12–S15, E01
    index-page.mjs, components.mjs
\`\`\`

## Giới hạn đã biết

- Chỉ là HTML tĩnh: kéo thả, lưu, gửi email không chạy. Nút bấm không có hành động thật.
- Không có ảnh brand, logo thật hay màu thương hiệu — đúng brief.
- Một số chuỗi tiếng Anh trong bảng chuỗi là bản dịch gợi ý, cần người bản ngữ duyệt.
- E01 là **mô phỏng email**, không phải template gửi thật; không có địa chỉ người nhận.

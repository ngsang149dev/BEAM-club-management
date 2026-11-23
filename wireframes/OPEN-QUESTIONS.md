# Câu hỏi mở & giả định

Các chỗ \`WIREFRAME-BRIEF.md\` và HANDOFF v1.3 không nói rõ. Bản vẽ **đã dùng một giả định** để không dừng lại, nhưng giả định đó không phải quyết định nghiệp vụ. Chủ dự án chốt cái nào thì sửa bản vẽ theo.

Mức ảnh hưởng: **Cao** = sai sẽ phải vẽ lại luồng hoặc schema; **Vừa** = sửa một màn hình; **Thấp** = sửa chữ.

| ID | Câu hỏi | Giả định đã dùng | Ảnh hưởng |
|---|---|---|---|
| WQ-01 | Board đã lưu trữ có hiện trong danh sách không? | Ẩn mặc định; chỉ admin thấy mục “Đã lưu trữ”. | Vừa |
| WQ-02 | Một board thuộc một ban hay nhiều ban? | Một ban, hiển thị như nhãn. | Cao |
| WQ-03 | Task ở cột Done có bị loại khỏi “Task của tôi” không? | Có, mặc định ẩn; có bộ lọc “Hiện cả việc đã xong”. | Vừa |
| WQ-04 | “Tuần này” tính từ thứ Hai hay hôm nay? | Thứ Hai đến Chủ nhật, theo Asia/Ho_Chi_Minh. | Thấp |
| WQ-05 | Xóa cột còn task thì xử lý sao? | Chặn; bắt chuyển task sang cột khác trước. | Cao |
| WQ-06 | Mẫu quyền cộng dồn hay thay thế? | Thay thế toàn bộ, có xác nhận và đếm thêm/bỏ. | Cao |
| WQ-07 | Gỡ admin cuối cùng: chặn hay cho nhưng cảnh báo? | Chặn ở giao diện và transaction; nêu người còn lại. | Cao |
| WQ-08 | Nhắc deadline theo từng task hay gộp? | Một email gộp mỗi người mỗi ngày. | Vừa |
| WQ-09 | Sau đăng nhập có quay lại deep link không? | Có, nếu deep link hợp lệ; nếu không về S03. | Vừa |
| WQ-10 | Xóa ban còn thành viên/board: chặn hay chuyển? | Chặn, cho chuyển dữ liệu trong hộp thoại. | Cao |
| WQ-11 | Tìm thành viên theo MSSV khi người xem thiếu \`member.view_detail\`? | Không trả kết quả; tìm theo tên/ban. | Vừa |
| WQ-12 | Hạn task lưu ngày hay giờ? | Ngày (00:00 UTC+7), không có giờ. | Vừa |
| WQ-13 | Mobile có màn quản trị không? | Có bản đọc; sửa phức tạp khuyến khích desktop, nhưng không chặn. | Vừa |
| WQ-14 | Có giới hạn số lần đăng nhập sai? | Có, giới hạn nhẹ theo IP; thông báo chung. | Vừa |
| WQ-15 | \`returnTo\` sau đăng nhập có cho URL ngoài? | Không; chỉ path nội bộ. | Cao |
| WQ-16 | Mất mạng khi đang nhập task: giữ nháp? | Không tự lưu; cảnh báo rõ. | Vừa |
| WQ-17 | Task ẩn có hiện trong thùng rác với người không được xem? | Không; 404 như task thường. | Cao |
| WQ-18 | Một người thuộc nhiều ban hiển thị thế nào? | Nhiều chip, không có ban “chính”. | Thấp |
| WQ-19 | Người dùng tự đổi ngôn ngữ hay theo hồ sơ? | Tự đổi trên giao diện; email theo \`profiles.locale\`. | Thấp |
| WQ-20 | Đổi mật khẩu có tồn tại? | Không có mật khẩu; không vẽ. | Thấp |
| WQ-21 | Có cho đổi MSSV sau khi tạo? | Không; MSSV là định danh đăng nhập. | Cao |
| WQ-22 | Có xóa cứng thành viên? | Không; chỉ khóa (\`is_active=false\`). | Cao |
| WQ-23 | Admin có tạo mẫu quyền riêng? | Không trong MVP; chỉ 3 mẫu cố định. | Vừa |
| WQ-24 | Quyền theo ban có nằm trong MVP? | Không; quyền toàn CLB. | Cao |
| WQ-25 | Ban không có thành viên có được xóa? | Có, nếu không còn board. | Thấp |
| WQ-26 | Nhiều mốc trùng một ngày thì gửi mấy email? | Một email/người/ngày; không gửi trùng. | Vừa |
| WQ-27 | Email nhắc có nhắc task ẩn không? | Chỉ với người được xem; không lộ tiêu đề. | Cao |
| WQ-28 | Audit lưu bao lâu? | Không giới hạn trong MVP; lọc 30 ngày mặc định. | Thấp |
| WQ-29 | Có ghi audit cho đăng nhập? | Không; chỉ thay đổi quyền/thành viên. | Thấp |
| WQ-30 | Trang bảo trì có tự bật? | Không; chỉ khi deploy cần. | Thấp |
| WQ-31 | Có hiện mã lỗi kỹ thuật cho người dùng? | Chỉ mã yêu cầu, không stack trace. | Thấp |
| WQ-32 | Thùng rác tự dọn sau bao lâu? | Giả định 30 ngày; **chưa có trong HANDOFF**. | Vừa |
| WQ-33 | Khôi phục task khi cột cũ đã bị xóa? | Về cột đầu tiên; ghi lịch sử. | Vừa |
| WQ-34 | Nhiều task cùng hạn trong email xếp thế nào? | Priority cao trước, rồi tên. | Thấp |
| WQ-35 | Liên kết trong email có cần đăng nhập lại? | Có; về S01 rồi quay lại S06 nếu còn phiên hợp lệ. | Vừa |

## Cách chốt

Trả lời theo ID (ví dụ “WQ-05: chặn, bắt chuyển task”). Những câu **Cao** nên chốt trước khi dựng API: WQ-02, WQ-05, WQ-06, WQ-07, WQ-10, WQ-21, WQ-22, WQ-27, WQ-15.

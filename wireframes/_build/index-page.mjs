const flow = (title, note, steps, branches = '') =>
  '<div class="flow"><h3>' + title + '</h3><p class="flow-note">' + note + '</p><div class="flow-steps">' +
  steps.map((s, i) => '<span class="flow-step"><span class="c">' + s[0] + '</span>' + s[1] + '</span>' + (i < steps.length - 1 ? '<span class="flow-arrow">→</span>' : '')).join('') +
  '</div>' + branches + '</div>';

const check = (text, done = true) => '<div class="check-item"><span class="check-mark' + (done ? ' is-done' : '') + '">' + (done ? '✓' : '') + '</span><span>' + text + '</span></div>';

export function renderIndex(screens, { shell, rail }) {
  const countStates = screens.reduce((n, s) => n + (s.states ? s.states.length : 0), 0);
  const countPins = screens.reduce((n, s) => n + (s.pins ? s.pins.length : 0), 0);

  const hero = '<header class="index-hero"><div class="kicker"><span class="code">00</span><span class="dot"></span><span>Bộ wireframe · v1.0</span><span class="dot"></span><span>23.11.2026</span></div>' +
    '<h1>Wireframe low-fi cho website quản lý thành viên và giao task của CLB.</h1>' +
    '<p class="deck">Mười bốn màn hình và một email, ở hai bề rộng 1280 và 390. Bản vẽ để chốt bố cục, luồng và trạng thái trước khi viết giao diện thật — không phải bản dựng cuối.</p>' +
    '<div class="index-meta"><span><b>14</b> màn hình</span><span><b>1</b> email</span><span><b>' + countStates + '</b> trạng thái</span><span><b>' + countPins + '</b> ghi chú trong khung</span><span><b>VI / EN</b> chuyển ngay trên trang</span><span><b>S02</b> đã bỏ</span></div></header>';

  const how = '<section class="section"><div class="section-head"><h2>Cách đọc</h2><span class="sec-note">Bản vẽ không phải ảnh chụp: mọi khung là HTML thật, thu nhỏ vừa cột</span></div><div class="review-steps">' +
    '<div class="review-step"><span class="n">01</span><h3>Đọc mục đích trước</h3><p>Mỗi màn hình mở đầu bằng một câu: nó để làm gì, ai dùng. Nếu câu đó sai, bố cục sai theo — sửa câu trước.</p></div>' +
    '<div class="review-step"><span class="n">02</span><h3>Soi trạng thái, không chỉ màn hình chính</h3><p>Trạng thái trống, lỗi, đang tải, chỉ đọc và xung đột mới là chỗ quyết định sản phẩm có dùng được không.</p></div>' +
    '<div class="review-step"><span class="n">03</span><h3>Đối chiếu quyền</h3><p>Mỗi khung ghi người dùng và quyền. Nút bị ẩn không phải kiểm soát quyền; ghi chú luôn nói server kiểm tra lại.</p></div></div></section>';

  const principles = '<section class="section"><div class="section-head"><h2>Nguyên tắc của bộ vẽ</h2><span class="sec-note">Thang xám; màu chỉ để đọc priority và hạn</span></div><div class="principles">' +
    '<div class="principle"><h3>Thông tin trước trang trí</h3><p>Không ảnh brand, không gradient, không logo thật. Hình khối và chữ đủ để đánh giá mật độ, thứ tự và khoảng trắng.</p></div>' +
    '<div class="principle"><h3>Màu có nghĩa</h3><p>Priority dùng thanh 1–4 kèm nhãn; hạn dùng chữ và biểu tượng. Không mã hóa chỉ bằng màu, không dùng màu thương hiệu.</p></div>' +
    '<div class="principle"><h3>Ẩn thật, không làm mờ</h3><p>Task ẩn và MSSV/email không được render khi thiếu quyền. Không có “ô xám” gợi ý rằng có dữ liệu bị giấu.</p></div>' +
    '<div class="principle"><h3>Một hành động chính mỗi vùng</h3><p>Nút đen là hành động chính; còn lại là nút viền hoặc chữ. Hành động phá hủy dùng đỏ và luôn có xác nhận.</p></div>' +
    '<div class="principle"><h3>Bàn phím và cảm ứng ngang hàng</h3><p>Kéo thả có cách thay thế bằng menu và phím; mobile không phụ thuộc cử chỉ kéo.</p></div>' +
    '<div class="principle"><h3>Chừa chỗ cho mở rộng</h3><p>Vùng mở rộng trong task và cột trạng thái được vẽ khung, không vẽ tính năng ngoài MVP.</p></div></div></section>';

  const flows = '<section class="section"><div class="section-head"><h2>Luồng chính</h2><span class="sec-note">Đường đi, không phải sơ đồ kỹ thuật</span></div><div class="flow-grid">' +
    flow('Vào hệ thống', 'Không mật khẩu, không đăng ký.', [['S01', 'MSSV'], ['S03', 'Board'], ['S04', 'Kanban']], '<div class="flow-branch"><span class="tag">SAI</span><div class="flow-steps"><span class="flow-step">Lỗi chung</span><span class="flow-arrow">→</span><span class="flow-step">Thử lại / liên hệ admin</span></div></div>') +
    flow('Tạo và giao việc', 'Người có quyền tạo task, giao người, đặt hạn và priority.', [['S04', 'Thêm task'], ['S05', 'Chi tiết'], ['S04', 'Thẻ mới']]) +
    flow('Di chuyển task', 'Kéo thả hoặc menu; hoàn tác 10 giây.', [['S04', 'Kéo thẻ'], ['S04', 'Toast'], ['S05', 'Lịch sử']]) +
    flow('Task ẩn', 'Chỉ người được giao, người tạo và admin.', [['S05', 'Bật ẩn'], ['S04', 'Mắt gạch'], ['S14', '404 người khác']], '<div class="flow-branch"><span class="tag">SAU</span><div class="flow-steps"><span class="flow-step">Người tạo / admin tắt ẩn</span><span class="flow-arrow">→</span><span class="flow-step">Task hiện lại</span></div></div>') +
    flow('Cấp quyền', 'Một transaction gồm quyền và audit.', [['S10', 'Chọn người'], ['S10', 'Tick quyền'], ['S13', 'Bản ghi audit']], '<div class="flow-branch"><span class="tag">CHẶN</span><div class="flow-steps"><span class="flow-step">Gỡ admin cuối</span><span class="flow-arrow">→</span><span class="flow-step">409 + nêu người còn lại</span></div></div>') +
    flow('Nhắc deadline', 'Một email gộp cho mỗi người, 07:00.', [['S12', 'Mốc'], ['E01', 'Email'], ['S06', 'Task của tôi']], '<div class="flow-branch"><span class="tag">LOẠI</span><div class="flow-steps"><span class="flow-step">Đã rời</span><span class="flow-step">Task Done</span><span class="flow-step">Task đã xóa</span></div></div>') +
    '</div></section>';

  const directory = '<section class="section" id="directory"><div class="section-head"><h2>Danh mục màn hình</h2><span class="sec-note">14 màn hình + email · bấm để mở</span></div><table class="dir-table"><thead><tr><th>Mã</th><th>Màn hình</th><th class="hide-sm">Ai dùng</th><th class="hide-sm">FR</th><th>Trạng thái</th></tr></thead><tbody>' +
    screens.map((s) => '<tr><td class="code"><a href="' + s.slug + '.html">' + s.code + '</a></td><td class="name"><a href="' + s.slug + '.html">' + s.titleVi + '</a><span>' + s.titleEn + '</span></td><td class="who hide-sm">' + s.who + '</td><td class="fr hide-sm">' + (s.frs || []).slice(0, 3).join('<br>') + '</td><td class="code">' + (s.states ? s.states.length : 0) + '</td></tr>').join('') +
    '</tbody></table><p class="source-note">S02 không tồn tại: hết phiên quay về S01 kèm banner, không mở hộp nhập lại MSSV giữa trang. Số thứ tự giữ nguyên để khớp brief và tài liệu, không đánh số lại.</p></section>';

  const acceptance = '<section class="section"><div class="section-head"><h2>Kiểm tra trước khi duyệt</h2><span class="sec-note">Đối chiếu mục 11 của brief</span></div><div class="checklist">' +
    check('Đủ 14 màn hình + E01, đúng mã; S02 có ghi chú lý do bỏ.') +
    check('Mỗi màn hình có desktop 1280 và mobile 390, trừ ngoại lệ có ghi rõ.') +
    check('Có trạng thái trống, đang tải, lỗi; trạng thái quyền và xung đột ở nơi cần.') +
    check('Không MSSV/email ngoài S07 (có quyền), S08 (chính chủ), S09 (admin).') +
    check('Task ẩn không lộ qua tiêu đề, số đếm, tìm kiếm, bình luận, email.') +
    check('Mọi chuỗi có VI và EN, chuyển được bằng công tắc; không chuỗi cứng trong ảnh.') +
    check('Chỉ priority và hạn dùng màu; không màu thương hiệu, không mã hóa chỉ bằng màu.') +
    check('Nút bị ẩn theo quyền, nhưng ghi chú nói server kiểm tra lại.') +
    check('Luồng chính đi được không cần chuột: menu thay thế kéo thả.') +
    check('Câu hỏi mở nằm trong OPEN-QUESTIONS.md, không tự quyết nghiệp vụ.') +
    '</div></section>';

  const questions = '<section class="section"><div class="section-head"><h2>Câu hỏi mở</h2><span class="sec-note">35 giả định, 8 cái có thể chặn dựng</span></div><p class="source-note">Những chỗ brief và HANDOFF không nói rõ được ghi thành WQ-01…WQ-35 trong <a href="OPEN-QUESTIONS.md">OPEN-QUESTIONS.md</a>, kèm giả định đã dùng và mức độ ảnh hưởng. Không có quyết định nghiệp vụ nào được giấu trong bản vẽ.</p></section>';

  return shell({
    title: 'Tổng quan',
    current: 'index',
    crumb: 'Tổng quan',
    content: hero + how + principles + flows + directory + acceptance + questions
  });
}

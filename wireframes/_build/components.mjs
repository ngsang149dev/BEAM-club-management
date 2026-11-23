import {
  A, T, avatarStack, dueBadge, icon, priorityBadge, taskCard, uiBanner, uiBtn, uiCheck, uiChip,
  uiEmpty, uiErrorPanel, uiField, uiIconBtn, uiInput, uiModal, uiSelect, uiTabs, uiToggle, uiToast
} from './lib.mjs';
import { tasks } from './data.mjs';

const card = (name, code, body, wide = false) =>
  '<article class="comp-card' + (wide ? ' is-wide' : '') + '"><div class="comp-head"><h3>' + name + '</h3><code>data-component="' + code + '"</code></div><div class="comp-stage' + (wide ? ' is-block' : '') + '">' + body + '</div></article>';

export function renderComponents({ shell }) {
  const content = '<header class="index-hero"><div class="kicker"><span class="code">CMP</span><span class="dot"></span><span>Thư viện thành phần</span></div><h1>Những viên gạch dùng lại, kèm trạng thái.</h1><p class="deck">Mỗi thành phần có tên <code>data-component</code> để lập trình viên và người review nói cùng một thứ. Không phải design system đầy đủ: chỉ những gì MVP cần.</p></header>' +
    '<section class="section"><div class="section-head"><h2>Nút và điều khiển</h2><span class="sec-note">Một hành động chính mỗi vùng</span></div><div class="comp-grid">' +
    card('Nút', 'Button', uiBtn('Tạo board', 'New board', { variant: 'primary', iconName: 'plus' }) + uiBtn('Hủy', 'Cancel') + uiBtn('Xóa task', 'Delete task', { variant: 'danger' }) + '<span class="ui-btn ghost">' + T('Bỏ qua', 'Skip') + '>Bỏ qua</span>' + uiIconBtn('more', 'Thêm', 'More')) +
    card('Trường nhập', 'Field', '<div style="width:100%;display:grid;gap:10px">' + uiField({ labelVi: 'Tên board', labelEn: 'Board name', required: true, control: '<span class="ui-input">Sự kiện Open Day 2026</span>' }) + uiField({ labelVi: 'Email', labelEn: 'Email', control: '<span class="ui-input has-error">a@example.com</span>', errorVi: 'Email phải thuộc @eiu.edu.vn.', errorEn: 'Email must use @eiu.edu.vn.' }) + '</div>') +
    card('Chọn và lọc', 'Select & Filter', uiSelect('Tất cả ban', 'All departments', { iconName: 'building' }) + '<span class="ui-chip">' + icon('sliders', 12) + T('Đang lọc', 'Filtered') + '>Đang lọc</span><span class="ui-chip is-on">' + T('Đang hoạt động', 'Active') + '>Đang hoạt động</span>') +
    card('Công tắc và ô tick', 'Toggle & Checkbox', '<div style="display:grid;gap:10px">' + uiToggle('Đang ẩn', 'Hidden', { checked: true, descVi: 'Chỉ người tạo và admin đổi được.', descEn: 'Only the creator and admins can change this.' }) + uiCheck('Còn 1 ngày', '1 day before', { checked: true }) + '</div>') +
    '</div></section>' +
    '<section class="section"><div class="section-head"><h2>Đọc dữ liệu</h2><span class="sec-note">Màu chỉ có nghĩa, không trang trí</span></div><div class="comp-grid">' +
    card('Priority', 'PriorityBadge', priorityBadge(1) + priorityBadge(2) + priorityBadge(3) + priorityBadge(4)) +
    card('Hạn chót', 'DueBadge', dueBadge(tasks.slide.due) + dueBadge(tasks.script.due) + dueBadge(tasks.sponsor.due) + dueBadge(tasks.standee.due)) +
    card('Avatar và người', 'AvatarStack', avatarStack(['A', 'B', 'C']) + '<span class="ui-small ui-muted">' + T('Chỉ họ tên, không MSSV/email', 'Names only, no student ID or email') + '>Chỉ họ tên, không MSSV/email</span>') +
    card('Nhãn trạng thái', 'StatusPill', '<span class="role-badge is-admin">Admin</span><span class="role-badge">' + T('Trưởng ban', 'Department lead') + '>Trưởng ban</span><span class="status-cell"><i class="status-dot is-on"></i>' + T('Đang hoạt động', 'Active') + '>Đang hoạt động</span><span class="status-cell is-off"><i class="status-dot"></i>' + T('Đã rời', 'Left') + '>Đã rời</span>') +
    card('Thẻ task', 'TaskCard', '<div style="width:260px">' + taskCard(tasks.script, { menu: true }) + '</div>') +
    card('Tab', 'Tabs', uiTabs([{ vi: 'Chi tiết', en: 'Details', active: true }, { vi: 'Lịch sử', en: 'History', count: 12 }])) +
    '</div></section>' +
    '<section class="section"><div class="section-head"><h2>Phản hồi và trạng thái</h2><span class="sec-note">Không báo “thành công” khi chưa lưu</span></div><div class="comp-grid">' +
    card('Biểu ngữ', 'Banner', '<div style="display:grid;gap:8px;width:100%">' + uiBanner('Task này đang ẩn', 'This task is hidden', { kind: 'hidden', iconName: 'eye-off', bodyVi: 'Chỉ người được giao, người tạo và admin xem được.', bodyEn: 'Only assignees, the creator and admins can see it.' }) + uiBanner('Không lưu được thay đổi', 'Could not save changes', { kind: 'danger', iconName: 'alert-circle', bodyVi: 'Nội dung của bạn vẫn còn. Thử lại.', bodyEn: 'Your text is still here. Try again.' }) + '</div>', true) +
    card('Trống', 'EmptyState', uiEmpty({ iconName: 'check-square', titleVi: 'Chưa có task nào', titleEn: 'No tasks yet', bodyVi: 'Task mới sẽ xuất hiện ở đây.', bodyEn: 'New tasks will appear here.', action: uiBtn('Thêm task', 'Add task', { variant: 'primary', iconName: 'plus' }) })) +
    card('Lỗi', 'ErrorState', uiErrorPanel({ titleVi: 'Không tải được board', titleEn: 'Could not load the board', bodyVi: 'Kiểm tra kết nối rồi thử lại.', bodyEn: 'Check your connection and try again.', meta: 'REQ-7F3A' })) +
    card('Hộp thoại', 'Modal', '<div style="width:100%">' + uiModal({ titleVi: 'Xóa cột “Đang làm”?', titleEn: 'Delete “In progress”?', body: '<p class="ui-modal-p">' + T('Cột còn 4 task. Chọn cột nhận task trước khi xóa.', 'The column has 4 tasks. Choose a destination first.') + '>Cột còn 4 task. Chọn cột nhận task trước khi xóa.</p>', width: 420, actions: uiBtn('Hủy', 'Cancel') + uiBtn('Chuyển và xóa', 'Move and delete', { variant: 'danger' }) }) + '</div>', true) +
    card('Toast hoàn tác', 'UndoToast', uiToast({ vi: 'Đã chuyển task sang Đang làm', en: 'Moved task to In progress' })) +
    card('Đang tải', 'Skeleton', '<div style="width:100%;display:grid;gap:7px"><span class="ui-skeleton" style="width:70%;height:14px"></span><span class="ui-skeleton" style="width:92%"></span><span class="ui-skeleton" style="width:48%"></span></div>') +
    '</div></section>' +
    '<section class="section"><div class="section-head"><h2>Token</h2><span class="sec-note">Dùng biến, không viết mã màu rải rác</span></div><div class="tokens">' +
    ['--ink', '--ink-2', '--ink-3', '--line', '--paper-2', '--p1', '--p2', '--p3', '--p4', '--danger', '--warn', '--surface'].map((t) => '<div class="token"><span class="swatch" style="background:var(' + t + ')"></span><code>' + t + '</code></div>').join('') +
    '</div><p class="source-note">Nền giấy ấm, mực gần đen. Priority p1–p4 và danger/warn là màu duy nhất được dùng có nghĩa. Không có màu thương hiệu.</p></section>';

  return shell({ title: 'Thư viện thành phần', current: 'components', crumb: 'Thư viện thành phần', content });
}

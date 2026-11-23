import {
  A, T, appDesktop, appMobile, avatar, avatarStack, deptChip, dueBadge, icon,
  personName, priorityBadge, taskCard, uiBanner, uiBtn, uiEmpty, uiErrorPanel,
  uiIconBtn, uiSelect, uiTabs, uiToast, uiToggle, columnBlock
} from '../lib.mjs';
import { boards, columns, members, myTasks, tasks } from '../data.mjs';

const brand = '<span class="ui-logo" aria-hidden="true"><i></i><i></i><i></i><i></i></span>';

const loginForm = (opts = {}) =>
  '<div class="login-form' + (opts.compact ? ' is-compact' : '') + '">' +
  (opts.banner || '') +
  '<h1 class="login-title" ' + A('Đăng nhập', 'Sign in') + '>Đăng nhập</h1>' +
  '<p class="login-lead" ' + A('Dùng MSSV do admin cấp để vào hệ thống nội bộ của CLB.', 'Use the student ID an admin created for you to enter the club workspace.') + '>Dùng MSSV do admin cấp để vào hệ thống nội bộ của CLB.</p>' +
  '<div class="login-field"><span class="login-label" ' + A('MSSV', 'Student ID') + '>MSSV</span><span class="login-input' + (opts.input ? '' : ' is-empty') + '">' + (opts.input || 'MSSV-001') + '</span></div>' +
  '<div class="login-remember"><span class="ui-box' + (opts.remember ? ' is-on' : '') + '">' + (opts.remember ? icon('check', 12) : '') + '</span><span class="login-remember-text"><span class="login-remember-label" ' + A('Ghi nhớ đăng nhập', 'Remember me') + '>Ghi nhớ đăng nhập</span><span class="login-remember-hint" ' + A('Chỉ tích trên thiết bị của bạn.', 'Only tick this on your own device.') + '>Chỉ tích trên thiết bị của bạn.</span></span></div>' +
  '<span class="login-submit' + (opts.busy ? ' is-busy' : '') + '">' + (opts.busy ? '<span class="ui-spinner" aria-hidden="true"></span>' : '') + '<span ' + A(opts.busy ? 'Đang đăng nhập…' : 'Đăng nhập', opts.busy ? 'Signing in…' : 'Sign in') + '>' + (opts.busy ? 'Đang đăng nhập…' : 'Đăng nhập') + '</span></span>' +
  '<p class="login-help" ' + A('Tài khoản do admin cấp. Không có đăng ký tự do, không có mật khẩu hay OTP.', 'Accounts are created by an admin. There is no self sign-up, password or OTP.') + '>Tài khoản do admin cấp. Không có đăng ký tự do, không có mật khẩu hay OTP.</p>' +
  '</div>';

const loginMini = () => {
  const mini = [
    { nameVi: 'Cần làm', nameEn: 'To do', items: [tasks.sponsor, tasks.audio] },
    { nameVi: 'Đang làm', nameEn: 'In progress', items: [tasks.script, tasks.slide] },
    { nameVi: 'Hoàn thành', nameEn: 'Done', items: [tasks.poster, tasks.theme] }
  ];
  return '<div class="login-mini">' + mini.map((col) =>
    '<div class="login-mini-col"><div class="login-mini-head"><span ' + A(col.nameVi, col.nameEn) + '>' + col.nameVi + '</span><b>' + col.items.length + '</b></div>' +
    col.items.map((task) => '<div class="login-mini-card' + (task.hidden ? ' is-hidden' : '') + '"><span class="login-mini-title">' + task.title + '</span><span class="login-mini-meta">' + priorityBadge(task.priority) + (task.hidden ? '<span class="ui-hidden-mark">' + icon('eye-off', 11) + '</span>' : '') + '</span></div>').join('') +
    '</div>'
  ).join('') + '</div>';
};

const loginDesktop = () =>
  '<div class="ui ui-desktop"><div class="login">' +
  '<section class="login-left">' +
  '<div class="login-brand-row"><div class="login-word">' + brand + '<span class="login-word-text"><b>BEAM</b><span ' + A('CLB nội bộ', 'Club workspace') + '>CLB nội bộ</span></span></div><span class="login-left-tag" ' + A('Bảng task của CLB', 'The club board') + '>Bảng task của CLB</span></div>' +
  '<div class="login-copy"><span class="login-copy-kicker" ' + A('Một chỗ cho mọi việc của CLB', 'One place for everything the club runs') + '>Một chỗ cho mọi việc của CLB</span><h2 ' + A('Việc rõ người, rõ hạn, rõ ưu tiên.', 'Every task has an owner, a deadline and a priority.') + '>Việc rõ người, rõ hạn, rõ ưu tiên.</h2></div>' +
  '<div class="login-board-wrap has-pin"><span class="pin">1</span>' + loginMini() + '</div>' +
  '<p class="login-caption" ' + A('Dữ liệu minh họa. Ảnh chụp bảng task thật sẽ thay bằng dữ liệu của CLB.', 'Illustrative data. Real club data replaces this once the product is built.') + '>Dữ liệu minh họa.</p>' +
  '</section>' +
  '<section class="login-right"><div class="login-top"><span class="login-lang"><span ' + A('Ngôn ngữ', 'Language') + '>Ngôn ngữ</span><b>VI</b><span>/</span><span>EN</span></span></div>' +
  '<div class="login-center has-pin"><span class="pin">2</span>' + loginForm() + '</div>' +
  '<div class="login-foot"><span ' + A('CLB BEAM · Hệ thống nội bộ', 'BEAM Club · Internal system') + '>CLB BEAM · Hệ thống nội bộ</span><span>v1.0</span></div></section>' +
  '</div></div>';

const loginMobile = () =>
  '<div class="ui ui-mobile"><div class="login-m">' +
  '<div class="login-m-top"><div class="login-word">' + brand + '<span class="login-word-text"><b>BEAM</b><span ' + A('CLB nội bộ', 'Club workspace') + '>CLB nội bộ</span></span></div><span class="login-lang-mini">' + icon('globe', 15) + '<b>VI</b><span>/</span>EN</span></div>' +
  '<div class="login-mpeek">' + loginMini() + '</div>' +
  '<div class="login-mform has-pin"><span class="pin">3</span>' + loginForm({ compact: true }) + '</div>' +
  '<div class="login-mfoot"><span ' + A('Tài khoản do admin cấp', 'Accounts created by an admin') + '>Tài khoản do admin cấp</span><span>v1.0</span></div>' +
  '</div></div>';

const boardTile = (item) =>
  '<span class="board-tile"><span class="board-tile-top">' + deptChip(item.dept) + '<span class="board-tile-menu">' + icon('more', 15) + '</span></span>' +
  '<span class="board-tile-name">' + item.name + '</span>' +
  '<span class="board-tile-foot"><span class="board-stat"><b>' + item.open + '</b> <span ' + A('task', 'tasks') + '>task</span></span>' +
  (item.overdue ? '<span class="board-overdue">' + icon('alert-triangle', 12) + item.overdue + ' <span ' + A('quá hạn', 'overdue') + '>quá hạn</span></span>' : '<span class="board-ok" ' + A('Không có task quá hạn', 'No overdue tasks') + '>Không có task quá hạn</span>') +
  '<span class="board-updated" ' + A(item.updatedVi, item.updatedEn) + '>' + item.updatedVi + '</span></span></span>';

const boardsDesktop = () =>
  appDesktop('C', 'boards',
    '<div class="ui-top"><div class="ui-top-bread"><b>Board</b><span>/</span><span ' + A('Tất cả board', 'All boards') + '>Tất cả board</span></div><div class="ui-top-right">' + uiIconBtn('search', 'Tìm kiếm', 'Search') + '</div></div>' +
    '<div class="ui-scroll"><div class="ui-pagehead"><div class="ui-pagehead-text"><h1 class="ui-h1" ' + A('Board', 'Boards') + '>Board</h1><span class="ui-sub" ' + A('6 board · 44 task đang mở · 3 task quá hạn', '6 boards · 44 open tasks · 3 overdue') + '>6 board · 44 task đang mở · 3 task quá hạn</span></div><div class="ui-pagehead-actions has-pin"><span class="pin">1</span>' + uiBtn('Tạo board', 'New board', { variant: 'primary', iconName: 'plus' }) + '</div></div>' +
    '<div class="board-toolbar"><div class="ui-input" style="width:250px">' + icon('search', 15) + '<span class="ui-input-fake is-placeholder" ' + A('Tìm board', 'Search boards') + '>Tìm board</span></div>' + uiSelect('Tất cả ban', 'All departments', { iconName: 'building' }) +
    '<span class="board-view"><span class="is-active" ' + A('Đang dùng', 'Active') + '>Đang dùng</span><span ' + A('Đã lưu trữ', 'Archived') + '>Đã lưu trữ</span></span><span class="ui-toolbar-spacer"></span><span class="board-sort">' + icon('sliders', 14) + '<span ' + A('Sắp xếp: hoạt động gần nhất', 'Sort: recently updated') + '>Sắp xếp: hoạt động gần nhất</span></span></div>' +
    '<div class="board-grid has-pin"><span class="pin">3</span>' + boards.map(boardTile).join('') + '</div></div>');

const boardsMobile = () =>
  appMobile({ userKey: 'C', active: 'boards', titleVi: 'Board', titleEn: 'Boards', kickerVi: 'Không gian CLB', kickerEn: 'Club workspace', search: true, content:
    '<div class="ui-mpage"><div class="ui-mhead"><div><h1 ' + A('Board', 'Boards') + '>Board</h1><span class="ui-sub" ' + A('6 board · 44 task đang mở', '6 boards · 44 open tasks') + '>6 board · 44 task đang mở</span></div>' + uiBtn('Tạo', 'New', { variant: 'primary', iconName: 'plus', sm: true }) + '</div>' +
    '<div class="ui-msearch"><div class="ui-input">' + icon('search', 15) + '<span class="ui-input-fake is-placeholder" ' + A('Tìm board', 'Search boards') + '>Tìm board</span></div></div>' +
    '<div class="ui-mfilters"><span class="ui-chip">' + icon('building', 12) + '<span ' + A('Tất cả ban', 'All departments') + '>Tất cả ban</span></span><span class="ui-chip">' + icon('sliders', 12) + '<span ' + A('Gần đây', 'Recent') + '>Gần đây</span></span></div>' +
    '<div class="m-board-list">' + boards.map((item) =>
      '<div class="m-board"><div class="m-board-top">' + deptChip(item.dept) + icon('chevron-right', 15) + '</div><span class="m-board-name">' + item.name + '</span><div class="m-board-foot"><span><b>' + item.open + '</b> task</span>' + (item.overdue ? '<span class="board-overdue">' + icon('alert-triangle', 12) + item.overdue + ' ' + T('quá hạn', 'overdue') + '</span>' : '<span class="ui-muted">' + T('Không quá hạn', 'No overdue') + '</span>') + '<span class="ui-muted">' + T(item.updatedVi, item.updatedEn) + '</span></div></div>'
    ).join('') + '</div></div>' });

const boardColumns = (userKey, opts = {}) =>
  columns.map((column) => {
    const list = column.tasks.map((key) => tasks[key]);
    const visible = list;
    return columnBlock({ ...column, tasks: [] }, visible, {
      menu: opts.columnMenu !== false,
      add: opts.addTask !== false,
      cardMenu: opts.cardMenu !== false
    });
  }).join('');

const boardDesktop = () =>
  appDesktop('C', 'boards',
    '<div class="ui-top"><div class="ui-top-bread"><span ' + A('Board', 'Boards') + '>Board</span><span>/</span><b>Sự kiện Open Day 2026</b></div><div class="ui-top-right">' + uiIconBtn('search', 'Tìm kiếm', 'Search') + uiIconBtn('bell', 'Nhắc deadline', 'Reminders') + '</div></div>' +
    '<div class="ui-board"><div class="ui-board-head"><div class="ui-board-title-wrap"><div class="ui-board-title"><h1>Sự kiện Open Day 2026</h1>' + deptChip('Sự kiện') + '</div><div class="ui-board-meta"><span class="ui-small ui-muted" ' + A('12 task · 1 quá hạn · cập nhật 2 giờ trước', '12 tasks · 1 overdue · updated 2 hours ago') + '>12 task · 1 quá hạn · cập nhật 2 giờ trước</span></div></div>' +
    '<div class="ui-board-actions"><span class="has-pin"><span class="pin">4</span>' + uiBtn('Thêm cột', 'Add column', { iconName: 'plus', sm: true }) + '</span>' + uiBtn('Thùng rác', 'Trash', { iconName: 'trash', sm: true }) + uiIconBtn('more', 'Thao tác board', 'Board actions') + '</div></div>' +
    '<div class="ui-toolbar has-pin"><span class="pin">1</span><div class="ui-input" style="width:200px">' + icon('search', 15) + '<span class="ui-input-fake is-placeholder" ' + A('Tìm task', 'Search tasks') + '>Tìm task</span></div>' + uiSelect('Người được giao', 'Assignee', { iconName: 'users' }) + uiSelect('Priority', 'Priority', { iconName: 'alert-circle' }) + uiSelect('Hạn', 'Due', { iconName: 'calendar' }) +
    '<span class="ui-btn ghost is-sm">' + T('Xóa lọc', 'Clear filters') + '</span><span class="ui-toolbar-spacer"></span><span class="hint">' + icon('keyboard', 13) + '<span ' + A('Kéo thẻ, hoặc dùng ⋯ → Chuyển tới cột', 'Drag a card, or use ⋯ → Move to column') + '>Kéo thẻ, hoặc dùng ⋯ → Chuyển tới cột</span></span></div>' +
    '<div class="ui-cols">' + columns.map((column) => {
      const list = column.tasks.map((key) => tasks[key]);
      return columnBlock(column, list, { menu: true, add: true, cardMenu: true });
    }).join('') + '</div></div>' +
    uiToast({ vi: 'Đã chuyển “Viết kịch bản MC” sang Đang làm', en: 'Moved “Viết kịch bản MC” to In progress' }));

const boardMobile = () =>
  appMobile({ userKey: 'A', active: 'boards', titleVi: 'Sự kiện Open Day 2026', titleEn: 'Sự kiện Open Day 2026', kickerVi: 'Board', kickerEn: 'Board', back: true, search: true, filter: true, content:
    '<div class="m-board-head"><div class="ui-row">' + deptChip('Sự kiện') + '<span class="ui-small ui-muted">' + T('12 task · 1 quá hạn', '12 tasks · 1 overdue') + '</span></div>' +
    '<div class="m-colswitch"><span class="m-colswitch-arrow">' + icon('chevron-left', 15) + '</span><span class="m-colswitch-label"><b ' + A('Đang làm', 'In progress') + '>Đang làm</b><span ' + A('Cột 2 / 4', 'Column 2 / 4') + '>Cột 2 / 4</span></span><span class="m-colswitch-arrow">' + icon('chevron-right', 15) + '</span></div>' +
    '<div class="m-colseg" aria-hidden="true"><i></i><i class="on"></i><i></i><i></i></div>' +
    '<p class="m-hint">' + icon('keyboard', 12) + '<span ' + A('Vuốt ngang để đổi cột. Chạm ⋯ trên task của bạn để chuyển cột.', 'Swipe to change columns. Tap ⋯ on your tasks to move them.') + '>Vuốt ngang để đổi cột. Chạm ⋯ trên task của bạn để chuyển cột.</span></p></div>' +
    '<div class="m-cards">' + columns[1].tasks.map((key) => {
      const task = tasks[key];
      const mine = task.assignees.includes('A');
      return taskCard(task, { menu: mine });
    }).join('') + '</div></div>' });

const boardStates = [
  {
    title: 'Cột trống', note: 'Vẫn còn nút thêm task nếu có quyền.',
    html: '<div class="ui-fragment" style="padding:12px;background:#f7f8f5"><div style="width:250px">' + columnBlock(columns[0], [], { menu: true, add: true }) + '</div></div>'
  },
  {
    title: 'Board trống', note: 'Board mới chưa có cột hoặc có cột nhưng chưa có task.',
    html: '<div class="ui-fragment" style="padding:20px">' + uiEmpty({ iconName: 'board', titleVi: 'Board chưa có cột nào', titleEn: 'This board has no columns', bodyVi: 'Thêm cột đầu tiên để bắt đầu chia việc. Cột mặc định: Cần làm, Đang làm, Chờ duyệt, Hoàn thành.', bodyEn: 'Add the first column to start. Default columns: To do, In progress, Review, Done.', action: uiBtn('Thêm cột', 'Add column', { variant: 'primary', iconName: 'plus' }) }) + '</div>'
  },
  {
    title: 'Đang tải', note: 'Giữ bố cục cột để tránh nhảy trang.',
    html: '<div class="ui-fragment" style="padding:12px;background:#f7f8f5"><div class="ui-skel-cols">' + [1, 2, 3].map(() => '<div class="ui-skel-col"><span class="ui-skeleton" style="width:45%"></span>' + [1, 2].map(() => '<div class="ui-skel-card"><span class="ui-skeleton" style="width:86%"></span><span class="ui-skeleton" style="width:62%"></span><span class="ui-skeleton" style="width:38%"></span></div>').join('') + '</div>').join('') + '</div></div>'
  },
  {
    title: 'Lỗi tải board', note: 'Có yêu cầu thử lại và mã để đối chiếu log.',
    html: '<div class="ui-fragment" style="padding:20px">' + uiErrorPanel({ titleVi: 'Không tải được board', titleEn: 'Could not load the board', bodyVi: 'Kết nối tới máy chủ bị gián đoạn. Dữ liệu bạn vừa kéo có thể chưa được lưu.', bodyEn: 'The server connection was interrupted. Your last drag may not be saved.', meta: 'REQ-7F3A · 23/11/2026 15:42' }) + '</div>'
  },
  {
    title: 'Chỉ đọc', note: 'Thiếu quyền sửa: không có tay nắm kéo, không có menu cột.',
    html: '<div class="ui-fragment" style="padding:12px;background:#f7f8f5">' + uiBanner('Bạn đang xem ở chế độ chỉ đọc', 'You are viewing in read-only mode', { iconName: 'lock', bodyVi: 'Bạn có thể mở task để xem, nhưng không thể sửa hoặc di chuyển task của người khác.', bodyEn: 'You can open tasks, but cannot edit or move other people’s tasks.' }) + '<div style="width:250px;margin-top:10px">' + columnBlock(columns[2], [tasks.poster, tasks.opening], { menu: false, add: false, cardMenu: false }) + '</div></div>'
  },
  {
    title: 'Task ẩn · hai người nhìn cùng cột', note: 'Số đếm tính theo người xem; không có dấu hiệu “còn 1 task bị ẩn”.',
    wide: true,
    html: '<div class="ui-fragment" style="padding:14px;background:#f7f8f5"><div class="compare-grid"><div><span class="mini-label">Lê Văn C · người tạo + admin</span><div class="compare-col">' + columnBlock({ nameVi: 'Đang làm', nameEn: 'In progress' }, [tasks.script, tasks.slide, tasks.catering], { menu: false, add: false, cardMenu: false }) + '</div></div><div><span class="mini-label">Phạm Minh D · không được giao, không phải người tạo</span><div class="compare-col">' + columnBlock({ nameVi: 'Đang làm', nameEn: 'In progress' }, [tasks.script, tasks.catering], { menu: false, add: false, cardMenu: false }) + '</div></div></div><p class="compare-note" ' + A('Cột “Đang làm” hiển thị 4 task với C và 3 task với D. Không có chỗ nào lộ tiêu đề, số đếm hay bình luận của task ẩn.', 'The In progress column shows 4 tasks to C and 3 to D. No title, count or comment reveals the hidden task.') + '>Cột “Đang làm” hiển thị 4 task với C và 3 task với D.</p></div>'
  },
  {
    title: 'Xóa cột còn task', note: 'Phải chuyển task sang cột khác trước khi xóa.',
    html: '<div class="ui-fragment ui-modal-demo"><div class="ui-scrim"><div class="ui-modal" style="--w:430px"><div class="ui-modal-head"><span class="ui-modal-title" ' + A('Xóa cột “Đang làm”?', 'Delete the “In progress” column?') + '>Xóa cột “Đang làm”?</span>' + uiIconBtn('x', 'Đóng', 'Close') + '</div><div class="ui-modal-body"><p class="ui-modal-p" ' + A('Cột này còn 4 task. Chọn cột nhận task trước khi xóa; không task nào bị xóa theo.', 'This column still has 4 tasks. Choose a destination column first; no task is deleted with the column.') + '>Cột này còn 4 task. Chọn cột nhận task trước khi xóa; không task nào bị xóa theo.</p>' + uiSelect('Chuyển 4 task sang: Cần làm', 'Move 4 tasks to: To do', { iconName: 'board' }) + '</div><div class="ui-modal-foot">' + uiBtn('Hủy', 'Cancel') + uiBtn('Chuyển và xóa cột', 'Move and delete column', { variant: 'primary' }) + '</div></div></div></div>'
  },
  {
    title: 'Hoàn tác sau khi kéo', note: '10 giây; hết giờ thì thẻ ở lại cột mới.',
    html: '<div class="ui-fragment" style="position:relative;height:150px;padding:12px;background:#f7f8f5">' + uiToast({ vi: 'Đã chuyển “Viết kịch bản MC” sang Đang làm', en: 'Moved “Viết kịch bản MC” to In progress' }) + '</div>'
  },
  {
    title: 'Chuyển cột không cần kéo', note: 'Menu trên thẻ; dùng được bằng bàn phím và trên điện thoại.',
    html: '<div class="ui-fragment" style="padding:14px;background:#f7f8f5"><div style="width:250px;position:relative"><div class="ui-card"><div class="ui-card-top"><span class="ui-card-title">Viết kịch bản MC</span>' + uiIconBtn('more', 'Thao tác', 'Actions') + '</div><div class="ui-card-meta"><span class="ui-card-badges">' + priorityBadge(4) + dueBadge(tasks.script.due) + '</span>' + avatarStack(['A', 'D']) + '</div></div><div class="card-menu-demo"><span class="card-menu-title" ' + A('Chuyển tới cột', 'Move to column') + '>Chuyển tới cột</span><span class="card-menu-item">' + icon('check', 13) + '<span ' + A('Đang làm', 'In progress') + '>Đang làm</span><span class="card-menu-key">2</span></span><span class="card-menu-item">' + icon('board', 13) + '<span ' + A('Chờ duyệt', 'Review') + '>Chờ duyệt</span><span class="card-menu-key">3</span></span><span class="card-menu-item">' + icon('board', 13) + '<span ' + A('Hoàn thành', 'Done') + '>Hoàn thành</span><span class="card-menu-key">4</span></span><span class="card-menu-sep"></span><span class="card-menu-item">' + icon('edit', 13) + '<span ' + A('Mở chi tiết task', 'Open task details') + '>Mở chi tiết task</span></span></div></div></div>'
  }
];

const myTaskRow = (item) =>
  '<span class="my-row"><span class="my-row-prio">' + priorityBadge(item.task.priority) + '</span><span class="my-row-main"><span class="my-row-title">' + item.task.title + (item.task.hidden ? '<span class="ui-hidden-mark" style="margin-left:5px">' + icon('eye-off', 11) + '</span>' : '') + '</span><span class="my-row-meta"><span>' + item.boardVi + '</span><span class="my-sep">/</span><span ' + A(item.columnVi, item.columnEn) + '>' + item.columnVi + '</span></span></span><span class="my-row-due">' + dueBadge(item.task.due) + '</span><span class="my-row-open">' + icon('chevron-right', 15) + '</span></span>';

const myGroup = (key, vi, en, note) => {
  const items = myTasks.filter((item) => item.group === key);
  return '<section class="my-group"><header class="my-group-head"><h2 ' + A(vi, en) + '>' + vi + '</h2><span class="my-group-count">' + items.length + '</span>' + (note ? '<span class="my-group-note" ' + A(note[0], note[1]) + '>' + note[0] + '</span>' : '') + '</header>' + (items.length ? items.map(myTaskRow).join('') : '<div class="my-group-empty" ' + A('Không có task nào', 'Nothing here') + '>Không có task nào</div>') + '</section>';
};

const myTasksDesktop = () =>
  appDesktop('A', 'mytasks',
    '<div class="ui-top"><div class="ui-top-bread"><b ' + A('Task của tôi', 'My tasks') + '>Task của tôi</b></div><div class="ui-top-right">' + uiIconBtn('search', 'Tìm kiếm', 'Search') + '</div></div>' +
    '<div class="ui-scroll"><div class="ui-pagehead"><div class="ui-pagehead-text"><h1 class="ui-h1" ' + A('Task của tôi', 'My tasks') + '>Task của tôi</h1><span class="ui-sub" ' + A('7 task đang mở · 1 quá hạn · 1 đến hạn hôm nay', '7 open tasks · 1 overdue · due today') + '>7 task đang mở · 1 quá hạn · 1 đến hạn hôm nay</span></div><div class="ui-pagehead-actions">' + uiSelect('Priority: tất cả', 'Priority: all', { iconName: 'alert-circle' }) + uiSelect('Board: tất cả', 'Board: all', { iconName: 'board' }) + '</div></div>' +
    '<div class="my-list">' + myGroup('overdue', 'Quá hạn', 'Overdue') + myGroup('today', 'Hôm nay', 'Today') + myGroup('week', 'Tuần này', 'This week', ['7 ngày tới', 'Next 7 days']) + myGroup('later', 'Sau đó', 'Later') + myGroup('none', 'Không có hạn', 'No due date') + '</div>' +
    '<p class="my-footnote">' + icon('info', 13) + '<span ' + A('Task ở cột cuối (Hoàn thành) không hiện ở đây. Xem lại ở board tương ứng.', 'Tasks in the last column (Done) are not listed here. Find them on their board.') + '>Task ở cột cuối (Hoàn thành) không hiện ở đây.</span></p></div>');

const myTasksMobile = () =>
  appMobile({ userKey: 'A', active: 'mytasks', titleVi: 'Task của tôi', titleEn: 'My tasks', kickerVi: 'Không gian CLB', kickerEn: 'Club workspace', search: true, content:
    '<div class="ui-mpage"><div class="ui-mhead"><div><h1 ' + A('Task của tôi', 'My tasks') + '>Task của tôi</h1><span class="ui-sub" ' + A('7 task đang mở · 1 quá hạn', '7 open tasks · 1 overdue') + '>7 task đang mở · 1 quá hạn</span></div></div>' +
    '<div class="ui-mfilters"><span class="ui-chip">' + icon('alert-circle', 12) + '<span ' + A('Priority: tất cả', 'Priority: all') + '>Priority: tất cả</span></span><span class="ui-chip">' + icon('board', 12) + '<span ' + A('Board: tất cả', 'Board: all') + '>Board: tất cả</span></span></div>' +
    '<div class="m-mytasks">' + [['overdue', 'Quá hạn', 'Overdue'], ['today', 'Hôm nay', 'Today'], ['week', 'Tuần này', 'This week'], ['later', 'Sau đó', 'Later'], ['none', 'Không có hạn', 'No due date']].map(([key, vi, en]) => {
      const items = myTasks.filter((item) => item.group === key);
      return '<div class="m-mygroup"><div class="m-mygroup-head"><span ' + A(vi, en) + '>' + vi + '</span><b>' + items.length + '</b></div>' + items.map((item) => '<div class="m-myrow"><span class="m-myrow-prio">' + priorityBadge(item.task.priority) + '</span><span class="m-myrow-main"><span class="m-myrow-title">' + item.task.title + (item.task.hidden ? '<span class="ui-hidden-mark" style="margin-left:4px">' + icon('eye-off', 10) + '</span>' : '') + '</span><span class="m-myrow-meta">' + item.boardVi + ' · ' + dueBadge(item.task.due) + '</span></span>' + icon('chevron-right', 14) + '</div>').join('') + '</div>';
    }).join('') + '</div></div>' });

export const coreScreens = [
  {
    code: 'S01', slug: 's01-login', group: 'Bắt đầu',
    titleVi: 'Đăng nhập', titleEn: 'Sign in',
    purpose: 'Một ô MSSV, một nút. Không mật khẩu, không OTP, không đăng ký. Khối bảng task bên trái cho thấy ngay đây là công cụ gì, thay vì một trang đăng nhập trống.',
    who: 'Người chưa đăng nhập', persona: 'Không có (chưa đăng nhập)',
    permLine: 'Công khai · giới hạn số lần thử theo IP',
    frs: ['FR-04', 'FR-11', 'FR-40', 'FR-41'], acs: ['AC-01', 'AC-02', 'AC-05', 'AC-12', 'AC-13'],
    frames: [
      { kind: 'desktop', context: 'Màn hình mặc định · chưa có phiên', html: loginDesktop() },
      { kind: 'mobile', context: 'Màn hình mặc định · 390 px', html: loginMobile() }
    ],
    pins: [
      '<strong>Bảng task là hình mẫu, không phải dữ liệu thật.</strong> Chỉ dùng hình khối và chữ; không ảnh, không logo thật. Có thể thay bằng ảnh chụp sản phẩm sau.',
      '<strong>Một trường MSSV duy nhất.</strong> Không có trường mật khẩu, OTP, quên mật khẩu hay đăng ký. Ô nhập dùng <code>autocomplete="username"</code> và bàn phím chữ thường, không phải bàn phím email.',
      '<strong>“Ghi nhớ đăng nhập” mặc định không tích</strong> và luôn kèm dòng nhắc “Chỉ tích trên thiết bị của bạn”. Trạng thái tích/không tích phải đọc được bằng chữ, không chỉ bằng ô vuông.',
      '<strong>Thông báo lỗi dùng chung một câu</strong> cho MSSV lạ, tài khoản bị khóa và MSSV sai định dạng. Không gợi ý tài khoản có tồn tại hay không. Khi bị chặn tạm, nêu thời gian còn lại nhưng không nêu ngưỡng.'
    ],
    permissions: [
      'Không yêu cầu quyền; chỉ tài khoản đang hoạt động mới tạo được phiên.',
      'Hết phiên: chuyển về S01 kèm banner, không mở hộp nhập lại MSSV giữa trang (S02 đã bỏ).',
      'Không giữ nội dung đang soạn khi phiên hết hạn — xem WQ-17.'
    ],
    related: [['S03 · Danh sách board', 's03-boards.html'], ['S08 · Hồ sơ', 's08-profile.html']],
    questions: [['WQ-15', 'thời gian chặn tạm'], ['WQ-16', 'quay lại trang sau đăng nhập'], ['WQ-17', 'mất bản nháp']],
    strings: [
      ['Đăng nhập', 'Sign in'],
      ['MSSV', 'Student ID'],
      ['Ghi nhớ đăng nhập', 'Remember me'],
      ['Chỉ tích trên thiết bị của bạn.', 'Only tick this on your own device.'],
      ['Không thể đăng nhập. Kiểm tra lại MSSV hoặc liên hệ admin.', 'Could not sign in. Check your student ID or contact an admin.'],
      ['Phiên đã hết hạn, vui lòng đăng nhập lại.', 'Your session has expired. Please sign in again.']
    ],
    states: [
      { title: 'Đang xử lý', note: 'Nút khóa, không cho bấm lần hai.', phone: true, html: '<div class="login-state-wrap">' + loginForm({ busy: true, compact: true, input: 'MSSV-001' }) + '</div>' },
      { title: 'Lỗi chung', note: 'Một câu cho mọi nguyên nhân.', phone: true, html: '<div class="login-state-wrap">' + loginForm({ compact: true, input: 'MSSV-014', banner: uiBanner('Không thể đăng nhập', 'Could not sign in', { kind: 'danger', iconName: 'alert-circle', bodyVi: 'Kiểm tra lại MSSV hoặc liên hệ admin.', bodyEn: 'Check your student ID or contact an admin.' }) }) + '</div>' },
      { title: 'Bị chặn tạm', note: 'Nêu thời gian chờ, không nêu ngưỡng.', phone: true, html: '<div class="login-state-wrap">' + loginForm({ compact: true, input: 'MSSV-014', banner: uiBanner('Tạm thời chưa thể đăng nhập', 'Sign-in is temporarily blocked', { kind: 'warn', iconName: 'clock', bodyVi: 'Bạn đã thử quá nhiều lần. Thử lại sau 09:41.', bodyEn: 'Too many attempts. Try again in 09:41.' }) }) + '</div>' },
      { title: 'Phiên đã hết hạn', note: 'Banner trên form; không có ô nhập lại giữa trang.', phone: true, html: '<div class="login-state-wrap">' + loginForm({ compact: true, banner: uiBanner('Phiên đã hết hạn', 'Your session has expired', { iconName: 'lock', bodyVi: 'Vui lòng đăng nhập lại để tiếp tục. Nội dung đang soạn không được giữ.', bodyEn: 'Please sign in again to continue. Unsaved content is not kept.' }) }) + '</div>' }
    ]
  },
  {
    code: 'S03', slug: 's03-boards', group: 'Không gian làm việc',
    titleVi: 'Danh sách board', titleEn: 'Board list',
    purpose: 'Chọn board để làm việc và thấy ngay board nào đang có việc quá hạn. Đây là cửa vào hằng ngày, nên thông tin phải đủ để chọn trong vài giây, không phải một lưới thẻ trang trí.',
    who: 'Mọi tài khoản đang hoạt động', persona: 'Lê Văn C · Trưởng ban',
    permLine: 'board.create để tạo · board.update/delete cho menu từng board',
    frs: ['FR-06', 'FR-20'], acs: ['AC-04'],
    frames: [
      { kind: 'desktop', context: 'Có board.create · 6 board đang dùng', html: boardsDesktop() },
      { kind: 'mobile', context: 'Cùng người dùng · danh sách một cột', html: boardsMobile() }
    ],
    pins: [
      '<strong>Nút “Tạo board” chỉ hiện với <code>board.create</code>.</strong> Người không có quyền vẫn thấy danh sách và mở được mọi board.',
      '<strong>Menu từng board</strong> chứa Sửa (board.update), Quản lý cột (board.update) và Lưu trữ (board.delete). Lưu trữ là xóa mềm, không xóa dữ liệu.',
      '<strong>Số task và số quá hạn tính theo người xem</strong>: task ẩn không được giao và task đã xóa mềm không được đếm. Không hiển thị dấu hiệu “có task bị ẩn”.',
      '<strong>Bộ lọc “Đã lưu trữ” là giả định thiết kế</strong> (WQ-01) vì brief chỉ nói board có thể lưu trữ mà không nói xem lại ở đâu.'
    ],
    permissions: [
      'Xem mọi board: mọi tài khoản đang hoạt động.',
      'Tạo board: <code>board.create</code>. Sửa/cột: <code>board.update</code>. Lưu trữ: <code>board.delete</code>.',
      'Task ẩn không xuất hiện trong số đếm của người không được xem.'
    ],
    related: [['S04 · Bảng Kanban', 's04-board.html'], ['S15 · Thùng rác', 's15-trash.html']],
    questions: [['WQ-01', 'board đã lưu trữ'], ['WQ-02', 'board thuộc nhiều ban?']],
    strings: [
      ['Board', 'Boards'],
      ['Tạo board', 'New board'],
      ['Đang dùng', 'Active'],
      ['Đã lưu trữ', 'Archived'],
      ['Không có task quá hạn', 'No overdue tasks'],
      ['Tìm board', 'Search boards'],
      ['Tất cả ban', 'All departments']
    ],
    states: [
      { title: 'Chưa có board', note: 'Hướng dẫn hành động tiếp theo.', html: '<div class="ui-fragment" style="padding:24px">' + uiEmpty({ iconName: 'grid', titleVi: 'Chưa có board nào', titleEn: 'No boards yet', bodyVi: 'Board là nơi chứa các cột và task của một mảng việc. Tạo board đầu tiên để bắt đầu.', bodyEn: 'A board holds the columns and tasks for one area of work. Create the first one to start.', action: uiBtn('Tạo board', 'New board', { variant: 'primary', iconName: 'plus' }) }) + '</div>' },
      { title: 'Đang tải', note: 'Khung xương giữ đúng nhịp lưới.', html: '<div class="ui-fragment" style="padding:20px"><div class="skel-tiles">' + [1, 2, 3, 4, 5, 6].map(() => '<div class="skel-tile"><span class="ui-skeleton" style="width:32%"></span><span class="ui-skeleton" style="width:78%;height:16px"></span><span class="ui-skeleton" style="width:56%"></span></div>').join('') + '</div></div>' },
      { title: 'Lỗi tải danh sách', note: 'Thử lại không mất ngữ cảnh.', html: '<div class="ui-fragment" style="padding:20px">' + uiErrorPanel({ titleVi: 'Không tải được danh sách board', titleEn: 'Could not load boards', bodyVi: 'Máy chủ không phản hồi. Kiểm tra kết nối rồi thử lại.', bodyEn: 'The server did not respond. Check your connection and try again.', meta: 'REQ-2B91' }) + '</div>' },
      { title: 'Menu board', note: 'Chỉ hiện mục người dùng có quyền.', html: '<div class="ui-fragment" style="padding:18px;background:#f7f8f5"><div style="width:320px;position:relative"><div class="board-tile"><div class="board-tile-top">' + deptChip('Sự kiện') + '<span class="board-tile-menu">' + icon('more', 15) + '</span></div><span class="board-tile-name">Sự kiện Open Day 2026</span><span class="board-tile-foot"><span class="board-stat"><b>12</b> task</span><span class="board-overdue">' + icon('alert-triangle', 12) + '1 quá hạn</span><span class="board-updated">2 giờ trước</span></span></div><div class="board-menu-demo"><span class="card-menu-item">' + icon('edit', 13) + '<span ' + A('Sửa board', 'Edit board') + '>Sửa board</span></span><span class="card-menu-item">' + icon('board', 13) + '<span ' + A('Quản lý cột', 'Manage columns') + '>Quản lý cột</span></span><span class="card-menu-item">' + icon('trash', 13) + '<span ' + A('Thùng rác', 'Trash') + '>Thùng rác</span></span><span class="card-menu-sep"></span><span class="card-menu-item">' + icon('archive', 13) + '<span ' + A('Lưu trữ board', 'Archive board') + '>Lưu trữ board</span></span></div></div></div>' }
    ]
  },
  {
    code: 'S04', slug: 's04-board', group: 'Không gian làm việc',
    titleVi: 'Bảng Kanban', titleEn: 'Kanban board',
    purpose: 'Nơi làm việc hằng ngày: thấy toàn cảnh, mở task, kéo thẻ. Mỗi thẻ phải trả lời được ba câu — việc gì, gấp đến đâu, ai làm — trước khi người dùng mở nó ra.',
    who: 'Mọi tài khoản · thao tác theo quyền và theo task', persona: 'Desktop: Lê Văn C · Mobile: Nguyễn Văn A',
    permLine: 'board.update · task.create · task.assign · task.update_any · task.update_assigned',
    frs: ['FR-03', 'FR-06', 'FR-07', 'FR-20', 'FR-22', 'FR-25', 'FR-26', 'FR-27', 'FR-61', 'FR-62'], acs: ['AC-04', 'AC-15', 'AC-17'],
    frames: [
      { kind: 'desktop', context: 'Trưởng ban · thấy task ẩn mình tạo · đủ quyền board', html: boardDesktop() },
      { kind: 'mobile', context: 'Thành viên · chỉ kéo task được giao · một cột mỗi lần', html: boardMobile() }
    ],
    pins: [
      '<strong>Bộ lọc theo từ khóa, người, priority, hạn.</strong> Kết quả lọc vẫn phải áp dụng điều kiện task ẩn; không có trạng thái “đang lọc” nào vô tình bỏ qua điều kiện đó.',
      '<strong>Task ẩn</strong> có biểu tượng mắt gạch trên thẻ, nền gạch chéo nhẹ để không chỉ dựa vào màu. Người không được xem không thấy thẻ, không thấy trong số đếm, tìm kiếm hay thông báo.',
      '<strong>Số đếm cột tính theo người xem.</strong> C cùng cột “Đang làm” thấy 4, D thấy 3. Không hiển thị “+1 ẩn” vì như vậy là tiết lộ task ẩn.',
      '<strong>Menu cột</strong> (sửa tên, xóa, sắp xếp) chỉ hiện với <code>board.update</code>. Xóa cột còn task bị chặn cho đến khi chọn cột nhận task.',
      '<strong>Hoàn tác 10 giây</strong> sau khi kéo, xóa, đổi người hoặc bật/tắt ẩn. Toast không chặn thao tác khác; hết giờ thì biến mất, thay đổi vẫn được lưu.',
      '<strong>Cách thay thế kéo thả:</strong> menu ⋯ trên thẻ có “Chuyển tới cột” kèm phím tắt, dùng được bằng bàn phím và trên điện thoại. Kéo thả không phải cách duy nhất.'
    ],
    permissions: [
      'Xem mọi task không ẩn: mọi tài khoản đang hoạt động.',
      'Thêm task: <code>task.create</code>. Kéo/sửa mọi task: <code>task.update_any</code>. Kéo/sửa task của mình: <code>task.update_assigned</code>.',
      'Menu cột và thêm cột: <code>board.update</code>. Thùng rác: <code>task.delete</code>. Giao người: <code>task.assign</code>.',
      'Task ở cột cuối (Hoàn thành) không mang cảnh báo hạn.'
    ],
    related: [['S05 · Chi tiết task', 's05-task.html'], ['S15 · Thùng rác', 's15-trash.html'], ['S06 · Task của tôi', 's06-my-tasks.html']],
    questions: [['WQ-03', 'menu chuyển cột trên mobile'], ['WQ-04', 'xóa cột còn task'], ['WQ-06', 'thứ tự trong cột']],
    strings: [
      ['Thêm task', 'Add task'],
      ['Thêm cột', 'Add column'],
      ['Chuyển tới cột', 'Move to column'],
      ['Hoàn tác', 'Undo'],
      ['Đã chuyển task sang cột khác', 'Moved task to another column'],
      ['Tìm task', 'Search tasks'],
      ['Xóa lọc', 'Clear filters'],
      ['Không có task nào trong cột này', 'No tasks in this column']
    ],
    states: boardStates
  },
  {
    code: 'S05', slug: 's05-task', group: 'Không gian làm việc',
    titleVi: 'Chi tiết task', titleEn: 'Task detail',
    purpose: 'Một khung bên đủ chỗ cho mô tả, người làm, hạn, priority, bình luận và lịch sử — nhưng vẫn nhìn thấy board phía sau. Vùng mở rộng được chừa sẵn để thêm nhãn, checklist, đính kèm sau này mà không phải vẽ lại.',
    who: 'Người xem được task đó', persona: 'Lê Văn C · người tạo task ẩn',
    permLine: 'task.update_any · task.assign · comment.create · cờ ẩn cho người tạo/admin',
    frs: ['FR-07', 'FR-21', 'FR-24', 'FR-27', 'FR-42', 'FR-60', 'FR-61'], acs: ['AC-15', 'AC-16', 'AC-18', 'AC-19', 'AC-20'],
    frames: [
      { kind: 'desktop', context: 'Khung bên 610 px · board vẫn nhìn thấy phía sau', html: taskDesktop() },
      { kind: 'mobile', context: 'Toàn màn hình · cùng nội dung, xếp dọc', html: taskMobile() }
    ],
    pins: [
      '<strong>Biểu ngữ task ẩn</strong> luôn hiện với người được xem, kèm công tắc chỉ người tạo và admin bật/tắt. Người chỉ được giao thấy biểu ngữ nhưng không thấy công tắc.',
      '<strong>Vùng chừa chỗ cho khối mở rộng.</strong> Chỉ vẽ khung và mô tả; không vẽ nhãn, checklist hay đính kèm vì ngoài MVP. Khi thêm, chèn vào đây mà không đổi bố cục.',
      '<strong>Người được giao chỉ hiện họ tên và avatar chữ cái.</strong> Không MSSV, không email, kể cả với người có quyền xem chi tiết thành viên. Người đã rời có nhãn “(đã rời)” nhưng vẫn giữ task.',
      '<strong>Tab Lịch sử</strong> chỉ đọc, mới nhất trước, không có nút sửa/xóa. Mỗi mục hoàn tác được có “Khôi phục giá trị này”; xung đột mở hộp cảnh báo.',
      '<strong>Trạng thái lưu</strong> hiện cạnh tiêu đề (“Đã lưu · 15:42”). Lỗi lưu phải giữ nội dung đã sửa và cho thử lại; không đóng khung.'
    ],
    permissions: [
      'Xem: người được giao, người tạo, admin; người khác nhận 404 như S14.',
      'Sửa trường/cột: <code>task.update_any</code>, hoặc <code>task.update_assigned</code> nếu là người được giao.',
      'Giao người: <code>task.assign</code>. Xóa: <code>task.delete</code>. Bình luận: <code>comment.create</code>.',
      'Bật/tắt cờ ẩn: người tạo task hoặc admin (không cần mã quyền riêng).',
      'Hoàn tác: quyền của thao tác gốc; xung đột trả 409 và cần xác nhận có chủ ý.'
    ],
    related: [['S04 · Bảng Kanban', 's04-board.html'], ['S07 · Thành viên', 's07-members.html'], ['S14 · Lỗi & 404', 's14-errors.html']],
    questions: [['WQ-05', 'định dạng hạn chót'], ['WQ-07', 'xung đột hoàn tác'], ['WQ-08', 'lịch sử của task ẩn']],
    strings: [
      ['Chi tiết', 'Details'],
      ['Lịch sử', 'History'],
      ['Khôi phục giá trị này', 'Restore this value'],
      ['Người được giao', 'Assignees'],
      ['Hạn chót', 'Due date'],
      ['Thêm bình luận', 'Add a comment'],
      ['Task này đang ẩn', 'This task is hidden'],
      ['Đã lưu', 'Saved'],
      ['Không tìm thấy task', 'Task not found']
    ],
    states: taskStates()
  },
  {
    code: 'S06', slug: 's06-my-tasks', group: 'Không gian làm việc',
    titleVi: 'Task của tôi', titleEn: 'My tasks',
    purpose: 'Danh sách việc của riêng tôi, nhóm theo hạn để trả lời “hôm nay phải làm gì”. Không phải một bảng thống kê: chỉ task đang mở, theo thứ tự thời gian.',
    who: 'Mọi tài khoản', persona: 'Nguyễn Văn A · Thành viên',
    permLine: 'Không cần quyền riêng · chỉ thấy task được giao cho mình',
    frs: ['FR-23', 'FR-26', 'FR-27'], acs: ['AC-11', 'AC-15'],
    frames: [
      { kind: 'desktop', context: '7 task đang mở · nhóm theo hạn', html: myTasksDesktop() },
      { kind: 'mobile', context: 'Cùng dữ liệu · nhóm gọn, cuộn dọc', html: myTasksMobile() }
    ],
    pins: [
      '<strong>Năm nhóm cố định</strong> theo thứ tự: Quá hạn, Hôm nay, Tuần này, Sau đó, Không có hạn. Nhóm rỗng vẫn hiện để người dùng biết là không có việc, trừ khi cả danh sách trống.',
      '<strong>“Tuần này” = 7 ngày tới</strong> (không gồm hôm nay) — giả định WQ-09. Nếu chủ dự án muốn “tuần dương lịch”, chỉ đổi cách tính nhóm, không đổi bố cục.',
      '<strong>Task ẩn được giao cho tôi vẫn hiện</strong> ở đây, có biểu tượng mắt gạch. Người khác không thấy task đó ở bất kỳ đâu, kể cả số đếm.',
      '<strong>Task ở cột cuối không hiện</strong> (giả định WQ-10). Nếu muốn thấy việc đã xong, cần thêm bộ lọc “Bao gồm đã xong” — hiện chưa có để giữ MVP.'
    ],
    permissions: [
      'Chỉ task được giao cho chính mình, gồm task ẩn.',
      'Không phụ thuộc quyền sửa: người chỉ có <code>task.update_assigned</code> vẫn thấy danh sách.',
      'Bấm một dòng mở S05; nếu task ẩn và quyền xem đã mất, S05 trả 404.'
    ],
    related: [['S04 · Bảng Kanban', 's04-board.html'], ['S05 · Chi tiết task', 's05-task.html']],
    questions: [['WQ-09', 'định nghĩa tuần này'], ['WQ-10', 'task đã xong']],
    strings: [
      ['Task của tôi', 'My tasks'],
      ['Quá hạn', 'Overdue'],
      ['Hôm nay', 'Today'],
      ['Tuần này', 'This week'],
      ['Sau đó', 'Later'],
      ['Không có hạn', 'No due date'],
      ['Bạn chưa được giao task nào', 'You have no assigned tasks']
    ],
    states: [
      { title: 'Chưa được giao task', note: 'Gợi ý việc tiếp theo, không chỉ báo trống.', html: '<div class="ui-fragment" style="padding:24px">' + uiEmpty({ iconName: 'check-square', titleVi: 'Bạn chưa được giao task nào', titleEn: 'You have no assigned tasks', bodyVi: 'Khi ai đó giao việc cho bạn, task sẽ xuất hiện ở đây. Bạn vẫn xem được mọi task không ẩn trên board.', bodyEn: 'When someone assigns you work, it appears here. You can still see every non-hidden task on the boards.', action: uiBtn('Mở board', 'Open boards', { iconName: 'board' }) }) + '</div>' },
      { title: 'Đang tải', note: 'Giữ nhịp nhóm và dòng.', html: '<div class="ui-fragment" style="padding:18px"><div class="ui-stack">' + [1, 2, 3, 4, 5].map(() => '<div class="skel-taskrow"><span class="ui-skeleton" style="width:9%"></span><span class="ui-skeleton" style="width:58%;height:14px"></span><span class="ui-skeleton" style="width:16%"></span></div>').join('') + '</div></div>' },
      { title: 'Lỗi tải', note: 'Không xóa dữ liệu đã có trên màn hình nếu chỉ lỗi làm mới.', html: '<div class="ui-fragment" style="padding:20px">' + uiErrorPanel({ titleVi: 'Không tải được task của bạn', titleEn: 'Could not load your tasks', bodyVi: 'Kết nối bị gián đoạn. Danh sách cũ vẫn giữ nếu đang có.', bodyEn: 'The connection was interrupted. Any list already shown is kept.', meta: 'REQ-91C4' }) + '</div>' }
    ]
  }
];

function taskDesktop() {
  const behind = '<div class="ui-top"><div class="ui-top-bread"><span ' + A('Board', 'Boards') + '>Board</span><span>/</span><b>Sự kiện Open Day 2026</b></div></div><div class="ui-board"><div class="ui-board-head"><div class="ui-board-title"><h1>Sự kiện Open Day 2026</h1>' + deptChip('Sự kiện') + '</div></div><div class="ui-cols">' + [columns[0], columns[1], columns[2]].map((column) => columnBlock(column, column.tasks.map((key) => tasks[key]), { menu: false, add: false, cardMenu: false })).join('') + '</div></div>';
  const historyRows = '<div class="ui-history">' + [
    { actor: 'B', time: '23/11/2026 · 14:32', vi: 'đã đổi priority từ Trung bình sang Khẩn', en: 'changed priority from Medium to Urgent', action: true },
    { actor: 'A', time: '23/11/2026 · 15:02', vi: 'đã bình luận', en: 'commented' },
    { actor: 'C', time: '23/11/2026 · 11:05', vi: 'đã chuyển task từ Cần làm sang Đang làm', en: 'moved the task from To do to In progress', action: true },
    { actor: 'C', time: '22/11/2026 · 17:40', vi: 'đã giao task cho Nguyễn Văn A', en: 'assigned the task to Nguyễn Văn A', action: true },
    { actor: 'C', time: '22/11/2026 · 17:39', vi: 'đã bật cờ ẩn', en: 'turned on the hidden flag', action: true },
    { actor: 'C', time: '21/11/2026 · 09:14', vi: 'đã tạo task', en: 'created the task' }
  ].map((row) => '<div class="ui-history-row">' + avatar(row.actor, 24) + '<div class="ui-history-text"><b>' + members[row.actor].name + '</b> <span ' + A(row.vi, row.en) + '>' + row.vi + '</span><span class="ui-history-time">' + row.time + '</span></div>' + (row.action ? '<span class="ui-history-action" ' + A('Khôi phục giá trị này', 'Restore this value') + '>Khôi phục giá trị này</span>' : '') + '</div>').join('') + '</div>';

  return appDesktop('C', 'boards',
    '<div class="ui-behind">' + behind + '</div>' +
    '<div class="ui-sheet-layer"><div class="ui-sheet-scrim"></div><div class="ui-sheet">' +
    '<div class="ui-sheet-head"><div class="ui-sheet-title-wrap"><div class="ui-sheet-crumb"><span>Sự kiện Open Day 2026</span><span>/</span><span ' + A('Đang làm', 'In progress') + '>Đang làm</span></div><div class="ui-sheet-title"><h1>Chuẩn bị slide giới thiệu CLB</h1><span class="ui-hidden-mark">' + icon('eye-off', 13) + '</span></div><span class="ui-sheet-saved">' + icon('check', 12) + '<span ' + A('Đã lưu · 15:42', 'Saved · 15:42') + '>Đã lưu · 15:42</span></span></div>' + uiIconBtn('x', 'Đóng', 'Close') + uiIconBtn('more', 'Thêm thao tác', 'More actions') + '</div>' +
    '<div class="ui-sheet-tabs">' + uiTabs([{ vi: 'Chi tiết', en: 'Details', active: true }, { vi: 'Lịch sử', en: 'History', count: 12 }]) + '</div>' +
    '<div class="ui-sheet-body"><div class="has-pin">' + uiBanner('Task này đang ẩn', 'This task is hidden', { kind: 'hidden', iconName: 'eye-off', bodyVi: 'Chỉ người được giao, người tạo và admin xem được.', bodyEn: 'Only assignees, the creator and admins can see it.' }) + '<span class="pin">1</span></div>' +
    '<div class="ui-hidden-toggle">' + uiToggle('Đang ẩn', 'Hidden', { checked: true, descVi: 'Chỉ người tạo và admin bật/tắt được.', descEn: 'Only the creator and admins can change this.' }) + '</div>' +
    '<div class="ui-sheet-grid"><div class="ui-sheet-main">' +
    '<div><div class="ui-section-label"><span ' + A('Mô tả', 'Description') + '>Mô tả</span><span class="ui-icon-btn">' + icon('edit', 13) + '</span></div><div class="ui-description" ' + A('Bộ slide 8 trang cho phần giới thiệu CLB tại Open Day: sứ mệnh, các ban, hoạt động nổi bật và cách tham gia. Số liệu lấy từ báo cáo nhiệm kỳ 2025–2026.', 'An 8-slide deck introducing the club at Open Day: mission, departments, highlights and how to join. Figures come from the 2025–2026 term report.') + '>Bộ slide 8 trang cho phần giới thiệu CLB tại Open Day: sứ mệnh, các ban, hoạt động nổi bật và cách tham gia. Số liệu lấy từ báo cáo nhiệm kỳ 2025–2026.</div></div>' +
    '<div><div class="ui-section-label"><span ' + A('Người được giao', 'Assignees') + '>Người được giao</span><span class="ui-muted ui-small" ' + A('Chỉ họ tên', 'Name only') + '>Chỉ họ tên</span></div><div class="ui-assignee-row">' + avatarStack(['A'], 3) + personName('A') + '<span class="ui-btn is-sm">' + icon('plus', 13) + '<span ' + A('Chỉnh sửa', 'Edit') + '>Chỉnh sửa</span></span></div></div>' +
    '<div class="ui-comments"><div class="ui-section-label"><span ' + A('Bình luận', 'Comments') + '>Bình luận</span><span class="ui-count">3</span></div>' +
    '<div class="ui-comment">' + avatar('A', 24) + '<div><div class="ui-comment-head"><span class="ui-comment-name">Nguyễn Văn A</span><span class="ui-comment-time">23/11 · 15:02</span></div><div class="ui-comment-body">Mình đã cập nhật số liệu mới vào slide, nhờ C xem lại phần 2.</div></div></div>' +
    '<div class="ui-comment">' + avatar('C', 24) + '<div><div class="ui-comment-head"><span class="ui-comment-name">Lê Văn C</span><span class="ui-comment-time">23/11 · 14:48</span></div><div class="ui-comment-body">Phần ngân sách cần thêm bảng so sánh. Mình sẽ bổ sung trước 17:00.</div></div></div>' +
    '<div class="ui-comment">' + avatar('F', 24) + '<div><div class="ui-comment-head"><span class="ui-comment-name">Vũ Quốc F <span class="ui-out">(đã rời)</span></span><span class="ui-comment-time">20/11 · 10:12</span></div><div class="ui-comment-body">Bản nháp nằm ở thư mục chung của ban.</div></div></div>' +
    '<div class="ui-write-row">' + avatar('C', 24) + '<div class="ui-textarea" ' + A('Viết bình luận…', 'Write a comment…') + '>Viết bình luận…</div><span class="ui-btn primary is-sm">' + T('Gửi', 'Send') + '>Gửi</span></div></div>' +
    '<div class="ui-extension has-pin"><span class="pin">2</span><span class="ui-extension-title" ' + A('Vùng chừa chỗ cho khối mở rộng', 'Reserved space for extension blocks') + '>' + icon('grid', 14) + 'Vùng chừa chỗ cho khối mở rộng</span><span class="ui-extension-body" ' + A('Nhãn, checklist và tệp đính kèm sẽ được chèn ở đây sau MVP. Chỉ vẽ khung, không vẽ tính năng.', 'Labels, checklists and attachments will slot in here after the MVP. The frame is drawn; the features are not.') + '>Nhãn, checklist và tệp đính kèm sẽ được chèn ở đây sau MVP.</span><span class="ui-extension-ghosts"><span class="ui-ghost-chip">' + icon('tag', 11) + 'Nhãn</span><span class="ui-ghost-chip">' + icon('check-square', 11) + 'Checklist</span><span class="ui-ghost-chip">' + icon('paperclip', 11) + 'Đính kèm</span></span></div>' +
    '</div><aside class="ui-sheet-side">' +
    '<div class="ui-meta-row"><span class="ui-meta-label" ' + A('Cột', 'Column') + '>Cột</span><span class="ui-select">' + icon('board', 14) + '<span ' + A('Đang làm', 'In progress') + '>Đang làm</span>' + icon('chevron-down', 13) + '</span></div>' +
    '<div class="ui-meta-row"><span class="ui-meta-label" ' + A('Priority', 'Priority') + '>Priority</span><span class="ui-select">' + priorityBadge(4) + icon('chevron-down', 13) + '</span></div>' +
    '<div class="ui-meta-row"><span class="ui-meta-label" ' + A('Hạn chót', 'Due date') + '>Hạn chót</span><span class="ui-meta-value">' + dueBadge(tasks.slide.due) + '<span class="ui-icon-btn">' + icon('calendar', 14) + '</span></span><span class="ui-small ui-muted">22/11/2026</span></div>' +
    '<div class="ui-meta-row"><span class="ui-meta-label" ' + A('Người tạo', 'Created by') + '>Người tạo</span><span class="ui-meta-value">' + avatar('C', 20) + personName('C') + '</span><span class="ui-small ui-muted">21/11/2026 · 09:14</span></div>' +
    '<div class="ui-divider"></div><div class="ui-small ui-muted" ' + A('Thay đổi được lưu tự động. Không có nút Lưu.', 'Changes save automatically. There is no Save button.') + '>Thay đổi được lưu tự động. Không có nút Lưu.</div>' +
    '</aside></div>' +
    '</div></div></div>'
  );
}

function taskMobile() {
  return appMobile({ userKey: 'C', active: 'boards', titleVi: 'Chi tiết task', titleEn: 'Task detail', kickerVi: 'Sự kiện Open Day 2026', kickerEn: 'Sự kiện Open Day 2026', back: true, menu: true, tabs: false, content:
    '<div class="ui-m-sheet"><div class="ui-m-sheet-body">' +
    '<h1 class="ui-m-task-title">Chuẩn bị slide giới thiệu CLB</h1>' +
    '<div class="m-task-status">' + icon('check', 12) + '<span ' + A('Đã lưu · 15:42', 'Saved · 15:42') + '>Đã lưu · 15:42</span><span class="ui-dot"></span><span ' + A('Đang làm', 'In progress') + '>Đang làm</span></div>' +
    '<div style="margin-top:10px">' + uiBanner('Task này đang ẩn', 'This task is hidden', { kind: 'hidden', iconName: 'eye-off', bodyVi: 'Chỉ người được giao, người tạo và admin xem được.', bodyEn: 'Only assignees, the creator and admins can see it.' }) + '</div>' +
    '<div class="m-hidden-toggle">' + uiToggle('Đang ẩn', 'Hidden', { checked: true }) + '</div>' +
    '<div class="ui-m-meta">' + '<div class="ui-m-meta-row"><span class="ui-m-meta-label" ' + A('Cột', 'Column') + '>Cột</span><span class="ui-m-meta-value"><span class="ui-chip">' + icon('board', 12) + '<span ' + A('Đang làm', 'In progress') + '>Đang làm</span></span></span>' + icon('chevron-right', 14) + '</div>' +
    '<div class="ui-m-meta-row"><span class="ui-m-meta-label">Priority</span><span class="ui-m-meta-value">' + priorityBadge(4) + '</span>' + icon('chevron-right', 14) + '</div>' +
    '<div class="ui-m-meta-row"><span class="ui-m-meta-label" ' + A('Hạn chót', 'Due date') + '>Hạn chót</span><span class="ui-m-meta-value">' + dueBadge(tasks.slide.due) + '</span>' + icon('chevron-right', 14) + '</div>' +
    '<div class="ui-m-meta-row"><span class="ui-m-meta-label" ' + A('Người được giao', 'Assignees') + '>Người được giao</span><span class="ui-m-meta-value">' + avatarStack(['A']) + personName('A') + '</span>' + icon('chevron-right', 14) + '</div>' +
    '<div class="ui-m-meta-row"><span class="ui-m-meta-label" ' + A('Người tạo', 'Created by') + '>Người tạo</span><span class="ui-m-meta-value">' + personName('C') + '<span class="ui-small ui-muted">· 21/11</span></span></div></div>' +
    '<div class="ui-m-section"><div class="ui-m-section-title"><span ' + A('Mô tả', 'Description') + '>Mô tả</span><span class="ui-icon-btn">' + icon('edit', 13) + '</span></div><div class="ui-description">Bộ slide 8 trang cho phần giới thiệu CLB tại Open Day: sứ mệnh, các ban, hoạt động nổi bật và cách tham gia.</div></div>' +
    '<div class="ui-m-section"><div class="ui-m-section-title"><span ' + A('Bình luận', 'Comments') + '>Bình luận</span><span class="ui-count">3</span></div>' +
    '<div class="ui-comment">' + avatar('A', 24) + '<div><div class="ui-comment-head"><span class="ui-comment-name">Nguyễn Văn A</span><span class="ui-comment-time">23/11 · 15:02</span></div><div class="ui-comment-body">Mình đã cập nhật số liệu mới vào slide, nhờ C xem lại phần 2.</div></div></div>' +
    '<div class="ui-comment">' + avatar('C', 24) + '<div><div class="ui-comment-head"><span class="ui-comment-name">Lê Văn C</span><span class="ui-comment-time">23/11 · 14:48</span></div><div class="ui-comment-body">Phần ngân sách cần thêm bảng so sánh.</div></div></div></div>' +
    '<div class="ui-extension"><span class="ui-extension-title" ' + A('Vùng chừa chỗ cho khối mở rộng', 'Reserved for extension blocks') + '>' + icon('grid', 14) + 'Vùng chừa chỗ cho khối mở rộng</span><span class="ui-extension-body" ' + A('Nhãn, checklist, đính kèm — thêm sau MVP.', 'Labels, checklists, attachments — added after the MVP.') + '>Nhãn, checklist, đính kèm — thêm sau MVP.</span></div>' +
    '</div><div class="ui-write-row m-composer">' + avatar('C', 24) + '<div class="ui-textarea" ' + A('Viết bình luận…', 'Write a comment…') + '>Viết bình luận…</div><span class="ui-btn primary is-sm">' + T('Gửi', 'Send') + '>Gửi</span></div></div>' });
}

function taskStates() {
  const historyRows = '<div class="ui-history">' + [
    { actor: 'B', time: '23/11/2026 · 14:32', vi: 'đã đổi priority từ Trung bình sang Khẩn', en: 'changed priority from Medium to Urgent', action: true },
    { actor: 'A', time: '23/11/2026 · 15:02', vi: 'đã bình luận', en: 'commented' },
    { actor: 'C', time: '23/11/2026 · 11:05', vi: 'đã chuyển task từ Cần làm sang Đang làm', en: 'moved the task from To do to In progress', action: true },
    { actor: 'C', time: '22/11/2026 · 17:40', vi: 'đã giao task cho Nguyễn Văn A', en: 'assigned the task to Nguyễn Văn A', action: true },
    { actor: 'C', time: '22/11/2026 · 17:39', vi: 'đã bật cờ ẩn', en: 'turned on the hidden flag', action: true }
  ].map((row) => '<div class="ui-history-row">' + avatar(row.actor, 24) + '<div class="ui-history-text"><b>' + members[row.actor].name + '</b> <span ' + A(row.vi, row.en) + '>' + row.vi + '</span><span class="ui-history-time">' + row.time + '</span></div>' + (row.action ? '<span class="ui-history-action" ' + A('Khôi phục giá trị này', 'Restore this value') + '>Khôi phục giá trị này</span>' : '') + '</div>').join('') + '</div>';

  return [
    { title: 'Tab Lịch sử', note: 'Chỉ đọc; mới nhất trước; có nút khôi phục theo quyền.', wide: true, html: '<div class="ui-fragment" style="padding:14px">' + uiTabs([{ vi: 'Chi tiết', en: 'Details' }, { vi: 'Lịch sử', en: 'History', count: 12, active: true }]) + '<div style="margin-top:8px">' + historyRows + '</div><div class="ui-history-foot">' + icon('lock', 12) + '<span ' + A('Lịch sử chỉ ghi thêm. Không ai sửa hoặc xóa, kể cả admin.', 'History is append-only. No one can edit or delete it, including admins.') + '>Lịch sử chỉ ghi thêm. Không ai sửa hoặc xóa, kể cả admin.</span></div></div>' },
    { title: 'Xung đột khi khôi phục', note: 'Nêu giá trị hiện tại và cho chọn có chủ ý.', html: '<div class="ui-fragment ui-modal-demo"><div class="ui-scrim"><div class="ui-modal" style="--w:430px"><div class="ui-modal-head"><span class="ui-modal-title" ' + A('Giá trị đã bị thay đổi', 'This value has changed') + '>Giá trị đã bị thay đổi</span>' + uiIconBtn('x', 'Đóng', 'Close') + '</div><div class="ui-modal-body"><p class="ui-modal-p" ' + A('Bạn đang khôi phục priority “Trung bình”, nhưng task hiện là “Khẩn” do Trần Thị B đổi lúc 14:32.', 'You are restoring priority to “Medium”, but the task is now “Urgent”, changed by Trần Thị B at 14:32.') + '>Bạn đang khôi phục priority “Trung bình”, nhưng task hiện là “Khẩn”.</p><div class="conflict-values"><span><b ' + A('Hiện tại', 'Current') + '>Hiện tại</b>' + priorityBadge(4) + '</span><span><b ' + A('Sau khi khôi phục', 'After restore') + '>Sau khi khôi phục</b>' + priorityBadge(2) + '</span></div></div><div class="ui-modal-foot">' + uiBtn('Hủy', 'Cancel') + uiBtn('Vẫn khôi phục', 'Restore anyway', { variant: 'primary' }) + '</div></div></div></div>' },
    { title: 'Chế độ chỉ đọc', note: 'Đủ thông tin, không có điều khiển sửa.', html: '<div class="ui-fragment" style="padding:16px"><div class="ui-banner" style="margin-bottom:10px">' + icon('lock', 16) + '<div class="ui-banner-body"><span class="ui-banner-title" ' + A('Bạn chỉ có thể xem task này', 'You can only view this task') + '>Bạn chỉ có thể xem task này</span><span class="ui-banner-text" ' + A('Thiếu quyền sửa task hoặc không phải người được giao.', 'You lack task edit permission and are not an assignee.') + '>Thiếu quyền sửa task hoặc không phải người được giao.</span></div></div><div class="readonly-meta"><div><span ' + A('Cột', 'Column') + '>Cột</span><b ' + A('Đang làm', 'In progress') + '>Đang làm</b></div><div><span>Priority</span><b>' + priorityBadge(4) + '</b></div><div><span ' + A('Hạn chót', 'Due date') + '>Hạn chót</span><b>22/11/2026</b></div><div><span ' + A('Người được giao', 'Assignees') + '>Người được giao</span><b>' + personName('A') + '</b></div></div></div>' },
    { title: 'Không tìm thấy / task ẩn', note: 'Cùng một 404 cho không tồn tại và không được xem.', phone: true, html: '<div class="mini-error-page">' + uiErrorPanel({ iconName: 'lock', titleVi: 'Không tìm thấy task', titleEn: 'Task not found', bodyVi: 'Task không tồn tại hoặc bạn không có quyền xem. Hệ thống không cho biết trường hợp nào.', bodyEn: 'The task does not exist or you cannot view it. The system does not say which.', meta: '404 · REQ-4A2D', actions: uiBtn('Về board', 'Back to boards', { iconName: 'arrow-left' }) }) + '</div>' },
    { title: 'Đang lưu / lỗi lưu', note: 'Giữ nội dung, cho thử lại, không đóng khung.', html: '<div class="ui-fragment" style="padding:18px"><div class="save-demo"><span class="save-demo-title">Chuẩn bị slide giới thiệu CLB</span><span class="save-demo-state">' + icon('alert-circle', 13) + '<span ' + A('Chưa lưu được. Nội dung của bạn vẫn còn.', 'Could not save. Your text is still here.') + '>Chưa lưu được. Nội dung của bạn vẫn còn.</span><div class="save-demo-actions">' + uiBtn('Thử lại', 'Try again', { variant: 'primary', iconName: 'refresh' }) + uiBtn('Sao chép nội dung', 'Copy text') + '</div></div></div>' },
    { title: 'Lịch sử trống / đang tải', note: 'Không có trạng thái “không có quyền” riêng: 404.', phone: true, html: '<div class="ui-fragment" style="padding:18px"><div class="ui-tabs">' + '<span class="ui-tab is-active" ' + A('Lịch sử', 'History') + '>Lịch sử</span></div><div style="margin-top:14px" class="ui-stack">' + [1, 2, 3].map(() => '<div class="skel-history"><span class="ui-skeleton" style="width:20px;height:20px;border-radius:50%"></span><span class="ui-skeleton" style="width:70%"></span></div>').join('') + '</div></div>' }
  ];
}

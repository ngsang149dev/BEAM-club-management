import {
  A, T, appDesktop, appMobile, avatar, deptChip, dueBadge, icon, personName, priorityBadge,
  uiBanner, uiBtn, uiCheck, uiChip, uiEmpty, uiErrorPanel, uiField, uiIconBtn, uiModal,
  uiSelect, uiTabs, uiToast, uiToggle
} from '../lib.mjs';
import { auditRows, members, myTasks } from '../data.mjs';

const reminderSettings = () =>
  '<div class="rem-grid"><section class="rem-main"><div class="rem-card"><div class="rem-card-head"><h3>' + T('Mốc nhắc', 'Reminder milestones') + '</h3><span class="ui-small ui-muted" ' + A('Gửi một email gộp cho mỗi người', 'One digest email per person') + '>Gửi một email gộp cho mỗi người</span></div><div class="rem-options">' + uiCheck('Còn 2 ngày', '2 days before', { checked: true, descVi: 'Gửi lúc 07:00 ngày cách hạn 2 ngày.', descEn: 'Sent at 07:00 two days before the due date.' }) + uiCheck('Còn 1 ngày', '1 day before', { checked: true, descVi: 'Gửi lúc 07:00 ngày trước hạn.', descEn: 'Sent at 07:00 the day before.' }) + uiCheck('Đã quá hạn', 'Overdue', { checked: true, descVi: 'Gửi lúc 07:00 mỗi ngày cho đến khi xong.', descEn: 'Sent at 07:00 daily until done.' }) + '</div></div>' +
  '<div class="rem-card"><div class="rem-card-head"><h3>' + T('Thời điểm gửi', 'Send time') + '</h3></div><div class="rem-time"><div><span class="ui-small ui-muted">' + T('Giờ gửi', 'Send time') + '</span><b class="mono">07:00</b></div><div><span class="ui-small ui-muted">' + T('Múi giờ', 'Time zone') + '</span><b>Asia/Ho_Chi_Minh (UTC+7)</b></div></div><p class="ui-small ui-muted" ' + A('Cron chạy mỗi ngày một lần; giờ gửi cố định, không đổi theo từng người. Email dùng ngôn ngữ trong hồ sơ người nhận.', 'The cron runs once a day; send time is fixed, not per person. Email uses the recipient’s profile language.') + '>Cron chạy mỗi ngày một lần; giờ gửi cố định.</p></div>' +
  '<div class="rem-card"><div class="rem-card-head"><h3>' + T('Người nhận', 'Recipients') + '</h3></div><div class="rem-recipients"><span>' + icon('users', 14) + T('Người được giao task, còn hoạt động', 'Active assignees only') + '>Người được giao task, còn hoạt động</span><span>' + icon('x', 14) + T('Thành viên đã rời, task ở cột Hoàn thành', 'Left members, tasks in Done') + '>Thành viên đã rời, task ở cột Hoàn thành</span></div></div>' +
  '<div class="rem-save">' + uiBtn('Gửi thử cho tôi', 'Send a test to me', { iconName: 'mail' }) + '<span class="ui-toolbar-spacer"></span>' + uiBtn('Hủy', 'Cancel') + uiBtn('Lưu cấu hình', 'Save settings', { variant: 'primary' }) + '</div></section>' +
  '<aside class="rem-side"><div class="rem-preview-head"><h3>' + T('Xem trước email', 'Email preview') + '</h3><span class="ui-chip is-on">VI</span><span class="ui-chip">EN</span></div>' + emailPreview('vi', true) + '<p class="ui-small ui-muted" ' + A('Xem trước dùng dữ liệu của chính bạn. Không có MSSV, email hay tên người khác.', 'The preview uses your own data. No student IDs, emails or other people’s names.') + '>Xem trước dùng dữ liệu của chính bạn.</p></aside></div>';

const remindersDesktop = () =>
  appDesktop('B', 'reminders',
    '<div class="ui-top"><div class="ui-top-bread"><span ' + A('Hệ thống', 'System') + '>Hệ thống</span><span>/</span><b ' + A('Nhắc deadline', 'Deadline reminders') + '>Nhắc deadline</b></div></div>' +
    '<div class="ui-scroll"><div class="ui-pagehead"><div class="ui-pagehead-text"><h1 class="ui-h1" ' + A('Nhắc deadline', 'Deadline reminders') + '>Nhắc deadline</h1><span class="ui-sub" ' + A('Cấu hình mốc nhắc dùng chung cho toàn CLB', 'Milestones apply to the whole club') + '>Cấu hình mốc nhắc dùng chung cho toàn CLB</span></div><div class="ui-pagehead-actions">' + uiBtn('Lịch sử gửi', 'Send history', { iconName: 'clock' }) + '</div></div>' + reminderSettings() + '</div>');

const remindersMobile = () =>
  appMobile({ userKey: 'B', active: 'reminders', titleVi: 'Nhắc deadline', titleEn: 'Reminders', kickerVi: 'Hệ thống', kickerEn: 'System', back: true, content:
    '<div class="ui-mpage"><div class="ui-mhead"><div><h1 ' + A('Nhắc deadline', 'Reminders') + '>Nhắc deadline</h1><span class="ui-sub" ' + A('Áp dụng toàn CLB · 07:00', 'Club-wide · 07:00') + '>Áp dụng toàn CLB · 07:00</span></div></div>' + reminderSettings() + '</div>' });

const emailPreview = (lang, compact) => {
  const en = lang === 'en';
  const rows = (group) => myTasks.filter((t) => t.group === group).slice(0, 2).map((t) =>
    '<div class="email-task"><span class="email-task-prio">' + priorityBadge(t.task.priority) + '</span><span class="email-task-main"><b>' + t.task.title + '</b><span>' + (en ? t.boardEn : t.boardVi) + ' · ' + (en ? t.columnEn : t.columnVi) + '</span></span><span class="email-task-due">' + dueBadge(t.task.due) + '</span></div>'
  ).join('');
  return '<div class="email' + (compact ? ' is-compact' : '') + '" data-component="ReminderEmail"><div class="email-top"><span class="email-brand"><b>BEAM</b><span>' + T('CLB nội bộ', 'Club workspace') + '>CLB nội bộ</span></span><span class="email-lang">' + (en ? 'EN' : 'VI') + '</span></div>' +
  '<div class="email-subject"><span class="email-kicker">' + (en ? 'Deadline reminder' : 'Nhắc deadline') + '</span><h2>' + (en ? 'Tasks need your attention' : 'Task cần bạn chú ý') + '</h2><p>' + (en ? 'Sent 07:00 · 23/11/2026' : 'Gửi 07:00 · 23/11/2026') + '</p></div>' +
  '<div class="email-body"><p class="email-hello">' + (en ? 'Hi Nguyễn Văn A,' : 'Chào Nguyễn Văn A,') + '</p><p class="email-lead">' + (en ? 'Here are your open tasks by due date.' : 'Đây là các task đang mở của bạn, xếp theo hạn.') + '</p>' +
  '<div class="email-group"><h3 class="is-overdue">' + (en ? 'Overdue' : 'Quá hạn') + '</h3>' + rows('overdue') + '</div>' +
  '<div class="email-group"><h3>' + (en ? 'Due today' : 'Đến hạn hôm nay') + '</h3>' + rows('today') + rows('week') + '</div>' +
  '<div class="email-group"><h3>' + (en ? 'Coming up' : 'Sắp tới') + '</h3>' + rows('later') + '</div>' +
  '<span class="email-cta">' + (en ? 'Open My tasks' : 'Mở Task của tôi') + '</span><p class="email-foot">' + (en ? 'You receive this because you are assigned a task. One email per person, per day.' : 'Bạn nhận email vì được giao task. Mỗi người một email, mỗi ngày.') + '</p></div></div>';
};

const reminderStates = [
  { title: 'Không có quyền', note: 'Cần reminder.configure.', phone: true, html: '<div class="ui-fragment"><div class="mini-error-page">' + uiErrorPanel({ iconName: 'lock', titleVi: 'Bạn không cấu hình được nhắc deadline', titleEn: 'You cannot configure reminders', bodyVi: 'Cần quyền reminder.configure. Cấu hình hiện tại vẫn chạy bình thường.', bodyEn: 'Requires reminder.configure. The current settings keep running.', meta: '403 · REQ-3F10' }) + '</div></div>' },
  { title: 'Chưa chọn mốc nào', note: 'Cho phép tắt hết nhưng phải cảnh báo rõ.', html: '<div class="ui-fragment" style="padding:18px">' + uiBanner('Sẽ không gửi email nhắc nào', 'No reminder email will be sent', { kind: 'warn', iconName: 'alert-triangle', bodyVi: 'Bạn đã bỏ chọn cả ba mốc. Task vẫn hiện trong ứng dụng, nhưng không ai nhận email.', bodyEn: 'All three milestones are off. Tasks still appear in the app, but no one gets email.' }) + '<div style="margin-top:12px">' + uiBtn('Bật lại mốc mặc định', 'Restore default milestones', { iconName: 'refresh' }) + '</div></div>' },
  { title: 'Đã lưu', note: 'Toast; cấu hình có hiệu lực từ lần cron kế tiếp.', html: '<div class="ui-fragment" style="position:relative;height:150px;padding:14px;background:#f7f8f5">' + uiToast({ vi: 'Đã lưu cấu hình nhắc deadline', en: 'Reminder settings saved' }) + '</div>' },
  { title: 'Email tiếng Anh', note: 'Cùng bố cục, nội dung theo locale người nhận.', wide: true, html: '<div class="ui-fragment" style="padding:14px">' + emailPreview('en', true) + '</div>' }
];

const auditTable = () =>
  '<div class="audit-table"><div class="audit-tr audit-th"><span>' + T('Thời gian', 'Time') + '</span><span>' + T('Người thực hiện', 'Actor') + '</span><span>' + T('Hành động', 'Action') + '</span><span>' + T('Đối tượng', 'Target') + '</span><span>' + T('Chi tiết', 'Detail') + '</span></div>' +
  auditRows.slice(0, 9).map((row, i) =>
    '<div class="audit-tr' + (i === 0 ? ' is-active' : '') + '"><span class="mono">' + row.time + '</span><span class="audit-actor">' + avatar(row.actor, 22) + members[row.actor].name + '</span><span>' + T(row.actionVi, row.actionEn) + '>' + row.actionVi + '</span><span>' + row.target + '</span><span class="mono">' + row.detailVi + '</span></div>'
  ).join('') + '</div>';

const auditDesktop = () =>
  appDesktop('B', 'audit',
    '<div class="ui-top"><div class="ui-top-bread"><span ' + A('Hệ thống', 'System') + '>Hệ thống</span><span>/</span><b ' + A('Nhật ký quản trị', 'Audit log') + '>Nhật ký quản trị</b></div></div>' +
    '<div class="audit-layout"><section class="audit-main"><div class="ui-pagehead"><div class="ui-pagehead-text"><h1 class="ui-h1" ' + A('Nhật ký quản trị', 'Audit log') + '>Nhật ký quản trị</h1><span class="ui-sub" ' + A('Chỉ ghi thêm · không sửa, không xóa', 'Append-only · no edits, no deletes') + '>Chỉ ghi thêm · không sửa, không xóa</span></div></div>' +
    '<div class="audit-toolbar"><div class="ui-input" style="width:200px">' + icon('search', 14) + '<span class="ui-input-fake is-placeholder" ' + A('Tìm người hoặc đối tượng', 'Search actor or target') + '>Tìm người hoặc đối tượng</span></div>' + uiSelect('Mọi hành động', 'All actions') + uiSelect('30 ngày qua', 'Last 30 days') + '</div>' + auditTable() + '</section>' +
    '<aside class="audit-side"><h3>' + T('Chi tiết bản ghi', 'Record detail') + '</h3><div class="audit-detail"><div class="audit-detail-row"><span>' + T('Thời gian', 'Time') + '</span><b class="mono">23/11/2026 · 14:32:08</b></div><div class="audit-detail-row"><span>' + T('Người thực hiện', 'Actor') + '</span><b>' + personName('B') + '</b></div><div class="audit-detail-row"><span>' + T('Hành động', 'Action') + '</span><b>' + T('Cấp quyền', 'Granted permission') + '>Cấp quyền</b></div><div class="audit-detail-row"><span>' + T('Đối tượng', 'Target') + '</span><b>Nguyễn Văn A</b></div><div class="audit-detail-row"><span>' + T('Quyền', 'Permission') + '</span><b class="mono">task.assign</b></div><div class="audit-detail-row"><span>' + T('Mã yêu cầu', 'Request ID') + '</span><b class="mono">REQ-8C21</b></div><p class="ui-small ui-muted">' + T('Bản ghi không chứa MSSV hay email. Tên người được giải mã khi đọc, không lưu trong bản ghi.', 'Records hold no student ID or email. Names are resolved on read, not stored.') + '>Bản ghi không chứa MSSV hay email.</p></div></aside></div>');

const auditStates = [
  { title: 'Chưa có bản ghi', note: 'Ngày lọc không có dữ liệu.', phone: true, html: '<div class="ui-fragment" style="padding:20px">' + uiEmpty({ iconName: 'list', titleVi: 'Không có bản ghi nào', titleEn: 'No records', bodyVi: 'Thử mở rộng khoảng ngày hoặc bỏ bộ lọc hành động.', bodyEn: 'Try a wider date range or clear the action filter.', action: uiBtn('Xóa lọc', 'Clear filters') }) + '</div>' },
  { title: 'Đang tải', note: 'Giữ cột bảng.', html: '<div class="ui-fragment" style="padding:16px"><div class="ui-stack">' + [1, 2, 3, 4, 5].map(() => '<div class="skel-taskrow"><span class="ui-skeleton" style="width:16%"></span><span class="ui-skeleton" style="width:26%"></span><span class="ui-skeleton" style="width:30%"></span></div>').join('') + '</div></div>' },
  { title: 'Lỗi tải', note: 'Không có nút xóa hay sửa.', html: '<div class="ui-fragment" style="padding:20px">' + uiErrorPanel({ titleVi: 'Không tải được nhật ký', titleEn: 'Could not load the audit log', bodyVi: 'Thử lại; dữ liệu nhật ký không bị ảnh hưởng.', bodyEn: 'Try again; the log itself is unaffected.', meta: 'REQ-6A77' }) + '</div>' },
  { title: 'Không có quyền', note: 'Cần audit.view; admin cũng không sửa được.', phone: true, html: '<div class="ui-fragment"><div class="mini-error-page">' + uiErrorPanel({ iconName: 'lock', titleVi: 'Bạn không xem được nhật ký', titleEn: 'You cannot view the audit log', bodyVi: 'Cần quyền audit.view.', bodyEn: 'Requires audit.view.', meta: '403 · REQ-2D90' }) + '</div></div>' }
];

const errorPage = (opts) => '<div class="err-page"><span class="err-code">' + opts.code + '</span><h1 ' + A(opts.vi, opts.en) + '>' + (opts.vi) + '</h1><p ' + A(opts.body, opts.bodyEn) + '>' + (opts.body) + '</p><div class="err-actions">' + uiBtn(opts.actionVi, opts.actionEn, { variant: 'primary', iconName: opts.iconName || 'arrow-left' }) + (opts.secondary ? uiBtn(opts.secondaryVi, opts.secondaryEn) : '') + '</div>' + (opts.meta ? '<span class="err-meta">' + opts.meta + '</span>' : '') + '</div>';

const errorsDesktop = () =>
  '<div class="ui ui-desktop"><div class="err-shell"><div class="err-top"><span class="ui-logo"><i></i><i></i><i></i><i></i></span><b>BEAM</b></div><div class="err-stage">' + errorPage({ code: '403', vi: 'Bạn không có quyền xem trang này', en: 'You cannot view this page', body: 'Trang này cần quyền mà tài khoản của bạn chưa có. Nếu bạn nghĩ đây là nhầm, liên hệ admin của CLB.', bodyEn: 'This page needs a permission your account does not have. If you think this is a mistake, contact a club admin.', actionVi: 'Về board', actionEn: 'Back to boards', secondary: true, secondaryVi: 'Về trang chủ', secondaryEn: 'Home', meta: 'REQ-4B18 · 23/11/2026 15:42' }) + '</div><div class="err-foot">' + T('CLB BEAM · Hệ thống nội bộ', 'BEAM Club · Internal system') + '</div></div></div>';

const errorsMobile = () =>
  '<div class="ui ui-mobile"><div class="err-shell is-m"><div class="err-top"><span class="ui-logo"><i></i><i></i><i></i><i></i></span><b>BEAM</b></div><div class="err-stage">' + errorPage({ code: '404', vi: 'Không tìm thấy trang', en: 'Page not found', body: 'Đường dẫn không tồn tại, hoặc bạn không có quyền xem. Hệ thống không cho biết trường hợp nào — kể cả với task ẩn.', bodyEn: 'The path does not exist, or you cannot view it. The system does not say which — including for hidden tasks.', actionVi: 'Về Task của tôi', actionEn: 'My tasks', secondary: true, secondaryVi: 'Về board', secondaryEn: 'Boards', meta: '404 · REQ-9E02' }) + '</div></div></div>';

const errorsStates = [
  { title: 'Hết phiên', note: 'Về S01 kèm banner; không nhập lại MSSV giữa trang.', phone: true, html: '<div class="ui-fragment"><div class="mini-error-page">' + uiErrorPanel({ iconName: 'lock', titleVi: 'Phiên đã hết hạn', titleEn: 'Your session has expired', bodyVi: 'Đăng nhập lại để tiếp tục. Nội dung chưa lưu không được giữ.', bodyEn: 'Sign in again to continue. Unsaved content is not kept.', actions: uiBtn('Đăng nhập lại', 'Sign in again', { variant: 'primary' }) }) + '</div></div>' },
  { title: 'Lỗi máy chủ', note: 'Có mã để đối chiếu log; không lộ stack trace.', phone: true, html: '<div class="ui-fragment"><div class="mini-error-page">' + uiErrorPanel({ titleVi: 'Đã có lỗi xảy ra', titleEn: 'Something went wrong', bodyVi: 'Chúng tôi đã ghi nhận. Thử lại sau ít phút; dữ liệu bạn vừa nhập có thể chưa được lưu.', bodyEn: 'We logged it. Try again shortly; your last input may not be saved.', meta: '500 · REQ-1A7C' }) + '</div></div>' },
  { title: 'Mất kết nối', note: 'Không giả vờ dữ liệu còn mới.', phone: true, html: '<div class="ui-fragment"><div class="mini-error-page">' + uiErrorPanel({ iconName: 'wifi-off', titleVi: 'Không có kết nối', titleEn: 'You are offline', bodyVi: 'Kiểm tra mạng rồi thử lại. Thay đổi chưa gửi sẽ không tự động lưu.', bodyEn: 'Check your connection and try again. Unsent changes are not saved automatically.', meta: 'OFFLINE' }) + '</div></div>' },
  { title: 'Bảo trì', note: 'Nêu thời gian dự kiến nếu biết; không hứa mốc không chắc.', phone: true, html: '<div class="ui-fragment"><div class="mini-error-page">' + uiErrorPanel({ iconName: 'tool', titleVi: 'Hệ thống đang bảo trì', titleEn: 'Scheduled maintenance', bodyVi: 'Dự kiến trở lại sau 30 phút. Dữ liệu vẫn an toàn.', bodyEn: 'Expected back in 30 minutes. Your data is safe.', actions: uiBtn('Thử lại', 'Try again', { iconName: 'refresh' }) }) + '</div></div>' }
];

const trashDesktop = () =>
  appDesktop('B', 'boards',
    '<div class="ui-top"><div class="ui-top-bread"><span ' + A('Board', 'Boards') + '>Board</span><span>/</span><b>Sự kiện Open Day 2026</b><span>/</span><b ' + A('Thùng rác', 'Trash') + '>Thùng rác</b></div></div>' +
    '<div class="ui-scroll"><div class="ui-pagehead"><div class="ui-pagehead-text"><h1 class="ui-h1" ' + A('Thùng rác', 'Trash') + '>Thùng rác</h1><span class="ui-sub" ' + A('Task đã xóa mềm · khôi phục được · không xóa vĩnh viễn trong MVP', 'Soft-deleted tasks · restorable · no permanent delete in the MVP') + '>Task đã xóa mềm · khôi phục được · không xóa vĩnh viễn trong MVP</span></div></div>' +
    '<div class="trash-toolbar"><div class="ui-input" style="width:240px">' + icon('search', 14) + '<span class="ui-input-fake is-placeholder" ' + A('Tìm task đã xóa', 'Search deleted tasks') + '>Tìm task đã xóa</span></div><span class="ui-toolbar-spacer"></span><span class="ui-small ui-muted" ' + A('Tự động dọn sau 30 ngày (giả định)', 'Auto-cleaned after 30 days (assumption)') + '>Tự động dọn sau 30 ngày (giả định)</span></div>' +
    '<div class="trash-table"><div class="trash-tr trash-th"><span>Task</span><span>' + T('Cột cũ', 'Old column') + '</span><span>' + T('Người xóa', 'Deleted by') + '</span><span>' + T('Thời gian', 'When') + '</span><span></span></div>' +
    [['Viết kịch bản MC', 'Đang làm', 'B', '23/11 · 15:12'], ['Mượn thiết bị âm thanh', 'Cần làm', 'C', '22/11 · 09:40'], ['Check-in khách mời', 'Chờ duyệt', 'B', '20/11 · 16:05'], ['Trang trí sân khấu', 'Hoàn thành', 'C', '18/11 · 11:22']].map((r) =>
      '<div class="trash-tr"><span class="trash-task">' + icon('trash', 14) + '<b>' + r[0] + '</b></span><span>' + T(r[1], r[1]) + '</span><span>' + personName(r[2]) + '</span><span class="mono">' + r[3] + '</span><span class="trash-restore">' + uiBtn('Khôi phục', 'Restore', { sm: true, iconName: 'refresh' }) + '</span></div>'
    ).join('') + '</div><p class="trash-note">' + icon('info', 13) + '<span ' + A('Khôi phục đưa task về cột cũ nếu cột còn; nếu cột đã bị xóa, task về cột đầu tiên. Không có nút xóa vĩnh viễn.', 'Restore returns the task to its old column if it still exists, otherwise the first column. There is no permanent delete.') + '>Khôi phục đưa task về cột cũ nếu cột còn.</span></p></div>');

const trashStates = [
  { title: 'Thùng rác trống', note: 'Không có hành động nào khác.', phone: true, html: '<div class="ui-fragment" style="padding:22px">' + uiEmpty({ iconName: 'trash', titleVi: 'Thùng rác trống', titleEn: 'Trash is empty', bodyVi: 'Task bị xóa sẽ nằm ở đây và có thể khôi phục.', bodyEn: 'Deleted tasks appear here and can be restored.' }) + '</div>' },
  { title: 'Khôi phục task', note: 'Nêu cột sẽ nhận lại task.', phone: true, html: '<div class="ui-fragment">' + uiModal({ titleVi: 'Khôi phục “Viết kịch bản MC”?', titleEn: 'Restore “Viết kịch bản MC”?', body: '<p class="ui-modal-p" ' + A('Task sẽ về cột “Đang làm” và giữ nguyên người được giao. Task ẩn vẫn ẩn với người không được xem.', 'The task returns to “In progress” with its assignees. A hidden task stays hidden from people who cannot see it.') + '>Task sẽ về cột “Đang làm” và giữ nguyên người được giao.</p>', width: 420, actions: uiBtn('Hủy', 'Cancel') + uiBtn('Khôi phục', 'Restore', { variant: 'primary' }) }) + '</div>' },
  { title: 'Không có quyền xóa', note: 'Thùng rác chỉ mở với task.delete.', phone: true, html: '<div class="ui-fragment"><div class="mini-error-page">' + uiErrorPanel({ iconName: 'lock', titleVi: 'Bạn không xem được thùng rác', titleEn: 'You cannot view the trash', bodyVi: 'Cần quyền task.delete. Người chỉ sửa task không thấy mục này.', bodyEn: 'Requires task.delete. People who can only edit tasks do not see it.', meta: '403 · REQ-0D31' }) + '</div></div>' }
];

export const systemScreens = [
  {
    code: 'S12', slug: 's12-reminders', group: 'Hệ thống',
    titleVi: 'Nhắc deadline', titleEn: 'Deadline reminders',
    purpose: 'Ba mốc, một giờ gửi, một email gộp cho mỗi người. Cấu hình phải nói rõ ai không nhận và task nào không nhắc, để admin không tin nhầm là “đã bật là gửi hết”.',
    who: 'Admin hoặc người có reminder.configure', persona: 'Trần Thị B · Admin',
    permLine: 'reminder.configure',
    frs: ['FR-50', 'FR-51', 'FR-52', 'FR-53'], acs: ['AC-12', 'AC-13'],
    frames: [
      { kind: 'desktop', context: 'Cấu hình + xem trước email VI', html: remindersDesktop() },
      { kind: 'mobile', context: 'Cùng cấu hình · một cột', html: remindersMobile() }
    ],
    pins: [
      '<strong>Mốc mặc định 2 ngày / 1 ngày / quá hạn</strong>, lưu trong app_settings, không viết cứng trong cron.',
      '<strong>Giờ gửi cố định 07:00 Asia/Ho_Chi_Minh</strong> vì cron gói free chạy theo ngày. Không có “chọn giờ theo người”.',
      '<strong>Một email mỗi người</strong>, gộp mọi task, theo locale hồ sơ. Không gửi trùng nhờ unique (task, user, kind).',
      '<strong>Loại trừ:</strong> thành viên đã rời, task ở cột Hoàn thành, task đã xóa mềm. Task ẩn chỉ nhắc người được xem.',
      '<strong>Xem trước dùng dữ liệu của chính admin</strong>, không lộ người khác. Nút gửi thử chỉ gửi cho chính mình.'
    ],
    permissions: [
      'Xem/sửa: <code>reminder.configure</code>. Không có quyền: 403, cấu hình cũ vẫn chạy.',
      'Cron bảo vệ bằng secret; không có nút “chạy ngay” trên giao diện.',
      'Email không chứa MSSV, email người nhận hay người khác.'
    ],
    related: [['E01 · Email nhắc deadline', 'e01-reminder-email.html'], ['S06 · Task của tôi', 's06-my-tasks.html']],
    questions: [['WQ-26', 'nhiều mốc trùng ngày'], ['WQ-27', 'email cho task ẩn']],
    strings: [
      ['Nhắc deadline', 'Deadline reminders'],
      ['Mốc nhắc', 'Reminder milestones'],
      ['Còn 2 ngày', '2 days before'],
      ['Còn 1 ngày', '1 day before'],
      ['Đã quá hạn', 'Overdue'],
      ['Thời điểm gửi', 'Send time'],
      ['Lưu cấu hình', 'Save settings'],
      ['Gửi thử cho tôi', 'Send a test to me']
    ],
    states: reminderStates
  },
  {
    code: 'S13', slug: 's13-audit', group: 'Hệ thống',
    titleVi: 'Nhật ký quản trị', titleEn: 'Audit log',
    purpose: 'Ai đổi quyền cho ai, khi nào. Chỉ đọc, chỉ ghi thêm, không có cột sửa hay nút xóa — kể cả với admin. Bản ghi không chứa MSSV hay email.',
    who: 'Admin hoặc người có audit.view', persona: 'Trần Thị B · Admin',
    permLine: 'audit.view',
    frs: ['FR-39', 'FR-54', 'FR-55'], acs: ['AC-10', 'AC-21'],
    frames: [
      { kind: 'desktop', context: 'Bảng + chi tiết bản ghi đang chọn', html: auditDesktop() }
    ],
    pins: [
      '<strong>Không có nút sửa/xóa</strong> ở bất kỳ đâu, kể cả admin. Audit là append-only ở tầng ứng dụng và CSDL.',
      '<strong>Không lưu MSSV/email</strong>; chỉ lưu id người thực hiện và đối tượng. Tên hiển thị được giải mã khi đọc.',
      '<strong>Lọc theo người, hành động, khoảng ngày.</strong> Khoảng mặc định 30 ngày; không tải toàn bộ lịch sử một lần.',
      '<strong>Chi tiết chỉ đọc</strong>, có mã yêu cầu để đối chiếu log kỹ thuật.'
    ],
    permissions: [
      'Xem: <code>audit.view</code>. Admin cũng chỉ xem.',
      'Không có API sửa/xóa audit. Không có quyền nào bỏ qua điều này.',
      'Bản ghi cấp quyền gồm: ai, khi nào, cho ai, quyền nào.'
    ],
    related: [['S10 · Phân quyền', 's10-permissions.html'], ['S09 · Quản trị thành viên', 's09-member-admin.html']],
    questions: [['WQ-28', 'thời gian lưu audit'], ['WQ-29', 'audit cho đăng nhập']],
    strings: [
      ['Nhật ký quản trị', 'Audit log'],
      ['Chỉ ghi thêm · không sửa, không xóa', 'Append-only · no edits, no deletes'],
      ['Người thực hiện', 'Actor'],
      ['Hành động', 'Action'],
      ['Đối tượng', 'Target'],
      ['Chi tiết bản ghi', 'Record detail'],
      ['Cấp quyền', 'Granted permission']
    ],
    states: auditStates
  },
  {
    code: 'S14', slug: 's14-errors', group: 'Hệ thống',
    titleVi: 'Lỗi & trạng thái', titleEn: 'Errors & states',
    purpose: '403, 404, hết phiên, lỗi máy chủ, mất mạng, bảo trì. Cùng một ngôn ngữ hình ảnh, khác nhau ở việc người dùng làm được gì tiếp theo. 404 dùng chung cho “không tồn tại” và “không được xem”.',
    who: 'Mọi người dùng', persona: 'Không có · trạng thái hệ thống',
    permLine: 'Không áp dụng',
    frs: ['FR-60', 'FR-61', 'FR-62'], acs: ['AC-18', 'AC-19'],
    frames: [
      { kind: 'desktop', context: '403 · thiếu quyền, không phải ẩn trang', html: errorsDesktop() },
      { kind: 'mobile', context: '404 · không tồn tại hoặc không được xem', html: errorsMobile() }
    ],
    pins: [
      '<strong>403 nói thiếu quyền</strong> vì người dùng đã đăng nhập và trang tồn tại; che giấu chỉ gây bối rối.',
      '<strong>404 dùng chung cho không tồn tại và task ẩn</strong>. Không có thông điệp “task này bị ẩn” cho người không được xem.',
      '<strong>Không lộ stack trace, MSSV, email hay mã nội bộ</strong>. Chỉ mã yêu cầu để đối chiếu log.',
      '<strong>Hết phiên về S01</strong> kèm banner; không mở hộp nhập MSSV giữa trang.',
      '<strong>Mất mạng không giả vờ đã lưu.</strong> Nêu rõ thay đổi chưa gửi có thể mất.'
    ],
    permissions: [
      '403: đã đăng nhập nhưng thiếu mã quyền hoặc cờ admin.',
      '404: tài nguyên không tồn tại hoặc người dùng không được xem (task ẩn, board đã xóa mềm).',
      '401/hết phiên: chuyển S01. Không có S02.'
    ],
    related: [['S01 · Đăng nhập', 's01-login.html'], ['S05 · Task 404', 's05-task.html']],
    questions: [['WQ-30', 'trang bảo trì'], ['WQ-31', 'mã lỗi hiển thị cho người dùng']],
    strings: [
      ['Bạn không có quyền xem trang này', 'You cannot view this page'],
      ['Không tìm thấy trang', 'Page not found'],
      ['Phiên đã hết hạn', 'Your session has expired'],
      ['Đã có lỗi xảy ra', 'Something went wrong'],
      ['Không có kết nối', 'You are offline'],
      ['Hệ thống đang bảo trì', 'Scheduled maintenance']
    ],
    states: errorsStates
  },
  {
    code: 'S15', slug: 's15-trash', group: 'Hệ thống',
    titleVi: 'Thùng rác của board', titleEn: 'Board trash',
    purpose: 'Task xóa mềm nằm đây, khôi phục được về cột cũ. Không có xóa vĩnh viễn trong MVP — nên không vẽ nút “xóa” thứ hai để tránh hiểu nhầm.',
    who: 'Người có task.delete', persona: 'Trần Thị B · Admin',
    permLine: 'task.delete · chỉ trong board tương ứng',
    frs: ['FR-24', 'FR-25', 'FR-61'], acs: ['AC-16', 'AC-17'],
    frames: [
      { kind: 'desktop', context: '4 task đã xóa · còn khôi phục được', html: trashDesktop() }
    ],
    pins: [
      '<strong>Chỉ task đã xóa mềm</strong> của board này; task ẩn vẫn tuân theo policy xem, người không được xem không thấy trong thùng rác.',
      '<strong>Không có xóa vĩnh viễn</strong> trong MVP. Nếu thêm sau, phải là hành động riêng có xác nhận mạnh.',
      '<strong>Khôi phục về cột cũ</strong> nếu cột còn; nếu không, về cột đầu tiên. Task ẩn giữ nguyên cờ ẩn.',
      '<strong>Thời hạn dọn 30 ngày là giả định</strong> (WQ-32), chưa có trong HANDOFF; cần chủ dự án chốt.'
    ],
    permissions: [
      'Mở thùng rác: <code>task.delete</code> trong board đó.',
      'Khôi phục: quyền của thao tác xóa gốc; ghi task_event mới, không xóa lịch sử.',
      'Không có quyền: 403; task ẩn không được xem: 404.'
    ],
    related: [['S04 · Bảng Kanban', 's04-board.html'], ['S05 · Chi tiết task', 's05-task.html']],
    questions: [['WQ-32', 'thời hạn dọn thùng rác'], ['WQ-33', 'khôi phục khi cột đã xóa']],
    strings: [
      ['Thùng rác', 'Trash'],
      ['Task đã xóa mềm · khôi phục được · không xóa vĩnh viễn trong MVP', 'Soft-deleted tasks · restorable · no permanent delete in the MVP'],
      ['Khôi phục', 'Restore'],
      ['Người xóa', 'Deleted by'],
      ['Cột cũ', 'Old column'],
      ['Thùng rác trống', 'Trash is empty']
    ],
    states: trashStates
  },
  {
    code: 'E01', slug: 'e01-reminder-email', group: 'Phụ lục',
    titleVi: 'Email nhắc deadline', titleEn: 'Deadline reminder email',
    purpose: 'Một email, một người, gộp mọi task theo hạn. Không MSSV, không email, không tên người khác. Cùng nội dung ở VI và EN, cùng bố cục trên desktop và mobile.',
    who: 'Người được giao task, còn hoạt động', persona: 'Nguyễn Văn A · người nhận',
    permLine: 'Không áp dụng · dữ liệu lọc theo người nhận',
    frs: ['FR-50', 'FR-51', 'FR-52', 'FR-53'], acs: ['AC-12', 'AC-13'],
    frames: [
      { kind: 'desktop', context: 'Bản VI · 640 px', html: '<div class="email-frame">' + emailPreview('vi', false) + '</div>' },
      { kind: 'desktop', context: 'Bản EN · cùng bố cục, nội dung theo locale', html: '<div class="email-frame">' + emailPreview('en', false) + '</div>' },
      { kind: 'mobile', context: 'Bản VI trên điện thoại · một cột', html: '<div class="email-frame is-m">' + emailPreview('vi', true) + '</div>' }
    ],
    pins: [
      '<strong>Không có MSSV hay địa chỉ email trong thân email.</strong> Chỉ tên hiển thị. Người nhận không thấy người khác.',
      '<strong>Nhóm theo hạn</strong>: Quá hạn, Đến hạn hôm nay, Sắp tới. Trong nhóm, task gấp hơn lên trước.',
      '<strong>Một email mỗi người mỗi ngày</strong>; không gửi trùng nhờ unique (task, user, kind). Task Done và người đã rời bị loại.',
      '<strong>Ngôn ngữ theo hồ sơ người nhận</strong>, không theo ngôn ngữ người gửi hay trình duyệt.',
      '<strong>Liên kết mở ứng dụng</strong> đưa về S06; nếu chưa đăng nhập, về S01 rồi quay lại (WQ-16).'
    ],
    permissions: [
      'Không phải giao diện đăng nhập; email chỉ gửi cho người được giao task còn hoạt động.',
      'Task ẩn chỉ xuất hiện với người được xem; không lộ tiêu đề cho người khác.',
      'Không trả lời email; không có địa chỉ gửi thật trong bản wireframe.'
    ],
    related: [['S12 · Nhắc deadline', 's12-reminders.html'], ['S06 · Task của tôi', 's06-my-tasks.html']],
    questions: [['WQ-34', 'email cho nhiều task cùng hạn'], ['WQ-35', 'liên kết sâu trong email']],
    strings: [
      ['Nhắc deadline', 'Deadline reminder'],
      ['Task cần bạn chú ý', 'Tasks need your attention'],
      ['Quá hạn', 'Overdue'],
      ['Đến hạn hôm nay', 'Due today'],
      ['Sắp tới', 'Coming up'],
      ['Mở Task của tôi', 'Open My tasks'],
      ['Bạn nhận email vì được giao task.', 'You receive this because you are assigned a task.']
    ],
    states: [
      { title: 'Chỉ có task quá hạn', note: 'Không vẽ nhóm rỗng.', phone: true, html: '<div class="ui-fragment" style="padding:12px">' + emailPreview('vi', true) + '</div>' },
      { title: 'Không có task nào', note: 'Không gửi email; trạng thái này chỉ để kiểm tra.', phone: true, html: '<div class="ui-fragment" style="padding:20px">' + uiEmpty({ iconName: 'mail', titleVi: 'Không có gì để nhắc', titleEn: 'Nothing to remind', bodyVi: 'Khi không còn task đang mở, hệ thống không gửi email — không gửi một email rỗng.', bodyEn: 'With no open tasks, the system sends no email — never an empty one.' }) + '</div>' }
    ]
  }
];

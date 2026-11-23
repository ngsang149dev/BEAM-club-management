import {
  A, T, appDesktop, appMobile, avatar, avatarStack, deptChip, icon, personName, priorityBadge,
  uiBanner, uiBtn, uiCheck, uiChip, uiEmpty, uiErrorPanel, uiField, uiIconBtn, uiInput,
  uiModal, uiSelect, uiTabs, uiToggle, uiToast
} from '../lib.mjs';
import { auditRows, departments, members, permissionGroups, presets } from '../data.mjs';

const personCell = (m, detail) =>
  '<span class="mem-person">' + avatar(m.key, 28) + '<span class="mem-person-text"><span class="mem-name">' + m.name + (m.active ? '' : ' <span class="ui-out">(đã rời)</span>') + '</span>' + (detail ? '<span class="mem-email">' + m.email + '</span>' : '<span class="mem-sub">' + m.depts.join(' · ') + '</span>') + '</span></span>';

const roleBadge = (m) =>
  m.admin ? '<span class="role-badge is-admin">Admin</span>' : m.roleVi === 'Trưởng ban' ? '<span class="role-badge">' + T('Trưởng ban', 'Department lead') + '</span>' : '<span class="role-badge is-plain" ' + A('Thành viên', 'Member') + '>Thành viên</span>';

const statusCell = (m) =>
  m.active
    ? '<span class="status-cell"><i class="status-dot is-on"></i><span ' + A('Đang hoạt động', 'Active') + '>Đang hoạt động</span></span>'
    : '<span class="status-cell is-off"><i class="status-dot"></i><span ' + A('Đã rời', 'Left') + '>Đã rời</span></span>';

const membersTable = (detail) =>
  '<div class="mem-table" data-component="MemberTable"><div class="mem-tr mem-th">' +
  '<span ' + A('Thành viên', 'Member') + '>Thành viên</span>' +
  (detail ? '<span>MSSV</span><span>Email</span>' : '<span ' + A('Ban', 'Departments') + '>Ban</span>') +
  '<span ' + A('Vai trò', 'Role') + '>Vai trò</span><span ' + A('Trạng thái', 'Status') + '>Trạng thái</span><span></span></div>' +
  membersList(detail) + '</div>';

const membersList = (detail) =>
  Object.values(members).map((m) =>
    '<div class="mem-tr' + (m.active ? '' : ' is-off') + '">' + personCell(m, detail) +
    (detail ? '<span class="mem-mssv">' + m.mssv + '</span><span class="mem-email-cell">' + m.email + '</span>' : '<span class="mem-depts">' + m.depts.map((d) => '<span class="ui-chip is-sm">' + d + '</span>').join('') + '</span>') +
    '<span>' + roleBadge(m) + '</span><span>' + statusCell(m) + '</span><span class="mem-open">' + icon('chevron-right', 14) + '</span></div>'
  ).join('');

const membersDesktop = () =>
  appDesktop('C', 'members',
    '<div class="ui-top"><div class="ui-top-bread"><b ' + A('Thành viên', 'Members') + '>Thành viên</b></div><div class="ui-top-right">' + uiIconBtn('search', 'Tìm kiếm', 'Search') + '</div></div>' +
    '<div class="ui-scroll"><div class="ui-pagehead"><div class="ui-pagehead-text"><h1 class="ui-h1" ' + A('Thành viên', 'Members') + '>Thành viên</h1><span class="ui-sub" ' + A('10 thành viên · 9 đang hoạt động · 1 đã rời', '10 members · 9 active · 1 left') + '>10 thành viên · 9 đang hoạt động · 1 đã rời</span></div><div class="ui-pagehead-actions">' + uiBtn('Thêm thành viên', 'Add member', { variant: 'primary', iconName: 'plus' }) + '</div></div>' +
    '<div class="mem-toolbar"><div class="ui-input" style="width:260px">' + icon('search', 15) + '<span class="ui-input-fake is-placeholder" ' + A('Tìm theo họ tên hoặc MSSV', 'Search by name or student ID') + '>Tìm theo họ tên hoặc MSSV</span></div>' + uiSelect('Tất cả ban', 'All departments', { iconName: 'building' }) +
    '<span class="board-view"><span class="is-active" ' + A('Đang hoạt động', 'Active') + '>Đang hoạt động</span><span ' + A('Đã rời', 'Left') + '>Đã rời</span><span ' + A('Tất cả', 'All') + '>Tất cả</span></span><span class="ui-toolbar-spacer"></span><span class="mem-count" ' + A('10 / 10 thành viên', '10 / 10 members') + '>10 / 10 thành viên</span></div>' +
    '<div class="has-pin"><span class="pin">1</span>' + membersTable(true) + '</div>' +
    '<div class="mem-foot"><span>' + icon('lock', 12) + '<span ' + A('MSSV và email chỉ hiện với người có quyền xem chi tiết thành viên.', 'Student IDs and email are shown only with member detail permission.') + '>MSSV và email chỉ hiện với người có quyền xem chi tiết thành viên.</span></span><span ' + A('Trang 1 / 1', 'Page 1 / 1') + '>Trang 1 / 1</span></div></div>');

const membersMobile = () =>
  appMobile({ userKey: 'A', active: 'members', titleVi: 'Thành viên', titleEn: 'Members', kickerVi: 'Không gian CLB', kickerEn: 'Club workspace', search: true, content:
    '<div class="ui-mpage"><div class="ui-mhead"><div><h1 ' + A('Thành viên', 'Members') + '>Thành viên</h1><span class="ui-sub" ' + A('10 thành viên · 9 đang hoạt động', '10 members · 9 active') + '>10 thành viên · 9 đang hoạt động</span></div></div>' +
    '<div class="ui-msearch"><div class="ui-input">' + icon('search', 15) + '<span class="ui-input-fake is-placeholder" ' + A('Tìm thành viên', 'Search members') + '>Tìm thành viên</span></div></div>' +
    '<div class="ui-mfilters"><span class="ui-chip">' + icon('building', 12) + '<span ' + A('Tất cả ban', 'All departments') + '>Tất cả ban</span></span><span class="ui-chip is-on" ' + A('Đang hoạt động', 'Active') + '>Đang hoạt động</span></div>' +
    '<div class="m-memlist">' + Object.values(members).map((m) =>
      '<div class="m-memrow' + (m.active ? '' : ' is-off') + '">' + avatar(m.key, 36) + '<div class="m-memrow-main"><div class="m-memrow-top"><span class="m-memname">' + m.name + '</span>' + (m.admin ? '<span class="role-badge is-admin">Admin</span>' : '') + '</div><div class="m-memrow-meta">' + m.depts.map((d) => '<span class="ui-chip is-sm">' + d + '</span>').join('') + '<span class="ui-muted">' + T(m.roleVi, m.roleEn) + '</span></div></div>' + icon('chevron-right', 14) + '</div>'
    ).join('') + '</div><p class="m-note">' + icon('lock', 12) + '<span ' + A('Bạn không thấy MSSV hay email vì thiếu quyền xem chi tiết.', 'You do not see student IDs or email without member detail permission.') + '>Bạn không thấy MSSV hay email vì thiếu quyền xem chi tiết.</span></p></div>' });

const profileDesktop = () =>
  appDesktop('A', 'profile',
    '<div class="ui-top"><div class="ui-top-bread"><b ' + A('Hồ sơ', 'Profile') + '>Hồ sơ</b></div><div class="ui-top-right">' + uiIconBtn('settings', 'Cài đặt', 'Settings') + '</div></div>' +
    '<div class="ui-scroll"><div class="ui-pagehead"><div class="ui-pagehead-text"><h1 class="ui-h1" ' + A('Hồ sơ của tôi', 'My profile') + '>Hồ sơ của tôi</h1><span class="ui-sub" ' + A('Bạn chỉ thấy MSSV và email của chính mình ở đây.', 'You only see your own student ID and email here.') + '>Bạn chỉ thấy MSSV và email của chính mình ở đây.</span></div></div>' +
    '<div class="profile-grid"><section class="profile-main"><div class="profile-hero">' + avatar('A', 64) + '<div><h2>Nguyễn Văn A</h2><div class="profile-hero-meta"><span class="role-badge" ' + A('Thành viên', 'Member') + '>Thành viên</span><span ' + A('Tham gia 09/2025', 'Joined 09/2025') + '>Tham gia 09/2025</span></div><div class="profile-depts">' + members.A.depts.map((d) => '<span class="ui-chip">' + d + '</span>').join('') + '</div></div></div>' +
    '<div class="profile-section"><h3 ' + A('Thông tin liên hệ', 'Contact details') + '>Thông tin liên hệ</h3><div class="profile-fields"><div class="profile-field"><span>MSSV</span><b class="mono">' + members.A.mssv + '</b><span class="profile-lock">' + icon('lock', 12) + T('Chỉ bạn và admin thấy', 'Only you and admins') + '</span></div><div class="profile-field"><span>Email</span><b>' + members.A.email + '</b><span class="profile-lock">' + icon('lock', 12) + T('Chỉ bạn và admin thấy', 'Only you and admins') + '</span></div></div></div>' +
    '<div class="profile-section"><h3>' + T('Ban tham gia', 'Departments') + '</h3><div class="profile-depts big">' + members.A.depts.map((d) => '<span class="ui-chip">' + icon('building', 12) + d + '</span>').join('') + '</div><p class="ui-small ui-muted" ' + A('Việc gán ban do admin thực hiện. Bạn không tự đổi được.', 'Admins assign departments. You cannot change them yourself.') + '>Việc gán ban do admin thực hiện.</p></div></section>' +
    '<aside class="profile-side"><div class="profile-card"><h3 ' + A('Quyền của bạn', 'Your permissions') + '>Quyền của bạn</h3><div class="profile-perms">' + ['member.view', 'task.update_assigned', 'comment.create'].map((code) => {
      const item = permissionGroups.flatMap((g) => g.items).find((p) => p.code === code);
      return '<div class="profile-perm">' + icon('check', 13) + '<div><b>' + code + '</b><span ' + A(item.vi, item.en) + '>' + item.vi + '</span></div></div>';
    }).join('') + '</div><p class="ui-small ui-muted" ' + A('Quyền do admin cấp, áp dụng toàn CLB. Cần thêm quyền thì liên hệ admin.', 'Admins grant permissions club-wide. Ask an admin for more.') + '>Quyền do admin cấp, áp dụng toàn CLB.</p></div>' +
    '<div class="profile-card"><h3 ' + A('Phiên đăng nhập', 'Session') + '>Phiên đăng nhập</h3><div class="profile-kv"><span>' + T('Ghi nhớ đăng nhập', 'Remember me') + '</span><b>' + T('Tắt', 'Off') + '</b></div><div class="profile-kv"><span>' + T('Hết hạn sau', 'Expires in') + '</span><b>24 ' + T('giờ', 'hours') + '</b></div><div class="profile-kv"><span>' + T('Đăng nhập gần nhất', 'Last sign-in') + '</span><b>23/11 · 08:12</b></div><span class="ui-btn danger is-sm" style="margin-top:10px">' + icon('logout', 13) + T('Đăng xuất', 'Sign out') + '</span></div></aside></div></div>');

const profileMobile = () =>
  appMobile({ userKey: 'A', active: 'profile', titleVi: 'Hồ sơ', titleEn: 'Profile', kickerVi: 'Tài khoản', kickerEn: 'Account', menu: true, content:
    '<div class="ui-mpage"><div class="m-profile-hero">' + avatar('A', 56) + '<h1>Nguyễn Văn A</h1><span class="role-badge" ' + A('Thành viên', 'Member') + '>Thành viên</span><span class="ui-small ui-muted">' + T('Tham gia 09/2025', 'Joined 09/2025') + '>Tham gia 09/2025</span><div class="profile-depts">' + members.A.depts.map((d) => '<span class="ui-chip is-sm">' + d + '</span>').join('') + '</div></div>' +
    '<div class="m-section"><h3>' + T('Thông tin liên hệ', 'Contact details') + '</h3><div class="m-kv"><span>MSSV</span><b class="mono">' + members.A.mssv + '</b></div><div class="m-kv"><span>Email</span><b>' + members.A.email + '</b></div><p class="m-note">' + icon('lock', 12) + '<span ' + A('Chỉ bạn và admin thấy thông tin này.', 'Only you and admins see this.') + '>Chỉ bạn và admin thấy thông tin này.</span></p></div>' +
    '<div class="m-section"><h3>' + T('Quyền của bạn', 'Your permissions') + '</h3>' + ['member.view', 'task.update_assigned', 'comment.create'].map((code) => '<div class="m-perm">' + icon('check', 12) + '<b>' + code + '</b></div>').join('') + '</div>' +
    '<div class="m-section"><h3>' + T('Phiên đăng nhập', 'Session') + '</h3><div class="m-kv"><span>' + T('Ghi nhớ', 'Remember me') + '</span><b>' + T('Tắt', 'Off') + '</b></div><div class="m-kv"><span>' + T('Hết hạn sau', 'Expires in') + '</span><b>24 ' + T('giờ', 'hours') + '</b></div><span class="ui-btn danger is-block">' + icon('logout', 14) + T('Đăng xuất', 'Sign out') + '</span></div></div>' });

const adminListBehind = () =>
  '<div class="ui-top"><div class="ui-top-bread"><b ' + A('Quản trị thành viên', 'Member admin') + '>Quản trị thành viên</b></div></div><div class="ui-scroll"><div class="ui-pagehead"><div class="ui-pagehead-text"><h1 class="ui-h1" ' + A('Quản trị thành viên', 'Member admin') + '>Quản trị thành viên</h1><span class="ui-sub" ' + A('Thêm, sửa, khóa tài khoản và gán ban', 'Add, edit, deactivate accounts and assign departments') + '>Thêm, sửa, khóa tài khoản và gán ban</span></div><div class="ui-pagehead-actions">' + uiBtn('Thêm thành viên', 'Add member', { variant: 'primary', iconName: 'plus' }) + '</div></div>' +
  '<div class="mem-toolbar"><div class="ui-input" style="width:260px">' + icon('search', 15) + '<span class="ui-input-fake is-placeholder" ' + A('Tìm thành viên', 'Search members') + '>Tìm thành viên</span></div><span class="ui-toolbar-spacer"></span></div>' + membersTable(true) + '</div>';

const memberDrawer = (opts = {}) =>
  '<div class="ui-drawer-layer"><div class="ui-sheet-scrim"></div><aside class="ui-drawer"><div class="ui-drawer-head"><div><span class="ui-drawer-kicker" ' + A(opts.add ? 'Thêm tài khoản' : 'Sửa hồ sơ', opts.add ? 'New account' : 'Edit profile') + '>' + (opts.add ? 'Thêm tài khoản' : 'Sửa hồ sơ') + '</span><h2>' + (opts.add ? T('Thành viên mới', 'New member') : 'Nguyễn Văn A') + '</h2></div>' + uiIconBtn('x', 'Đóng', 'Close') + '</div>' +
  '<div class="ui-drawer-body">' + (opts.banner || '') +
  '<div class="ui-form-grid">' + uiField({ labelVi: 'Họ và tên', labelEn: 'Full name', required: true, control: '<span class="ui-input">' + (opts.add ? 'Nguyễn Văn ' : 'Nguyễn Văn A') + '</span>' }) + uiField({ labelVi: 'MSSV', labelEn: 'Student ID', required: true, control: '<span class="ui-input mono">' + (opts.add ? 'MSSV-011' : 'MSSV-001') + '</span>', hintVi: 'Duy nhất, không đổi sau khi tạo.', hintEn: 'Unique, cannot change after creation.' }) + '</div>' +
  uiField({ labelVi: 'Email', labelEn: 'Email', required: true, control: '<span class="ui-input' + (opts.emailError ? ' has-error' : '') + '">' + (opts.add ? 'nguyenvana@eiu.edu.vn' : 'nguyenvana@eiu.edu.vn') + '</span>', hintVi: 'Phải thuộc tên miền @eiu.edu.vn.', hintEn: 'Must use the @eiu.edu.vn domain.', errorVi: opts.emailError ? 'Email phải thuộc @eiu.edu.vn.' : '', errorEn: opts.emailError ? 'Email must use @eiu.edu.vn.' : '' }) +
  '<div class="ui-field"><span class="ui-field-label"><span ' + A('Ban', 'Departments') + '>Ban</span></span><div class="drawer-chips"><span class="ui-chip is-on">' + icon('building', 12) + 'Truyền thông' + icon('x', 11) + '</span><span class="ui-chip is-on">' + icon('building', 12) + 'Sự kiện' + icon('x', 11) + '</span><span class="ui-chip is-dashed">' + icon('plus', 12) + T('Thêm ban', 'Add department') + '</span></div></div>' +
  '<div class="ui-divider"></div><div class="drawer-toggles">' + uiToggle('Tài khoản đang hoạt động', 'Account is active', { checked: !opts.add, descVi: 'Tắt để khóa đăng nhập; dữ liệu và task vẫn giữ.', descEn: 'Turn off to block sign-in; data and tasks are kept.' }) + uiToggle('Quyền admin', 'Admin', { checked: false, descVi: 'Admin vượt mọi kiểm tra quyền. Chỉ admin khác cấp được.', descEn: 'Admins bypass permission checks. Only another admin can grant this.' }) + '</div>' +
  (opts.add ? '' : '<div class="drawer-danger"><div><b>' + T('Khóa tài khoản', 'Deactivate account') + '</b><span ' + A('Thành viên không đăng nhập được; task và bình luận vẫn còn.', 'The member cannot sign in; tasks and comments remain.') + '>Thành viên không đăng nhập được; task và bình luận vẫn còn.</span></div>' + uiBtn('Khóa', 'Deactivate', { variant: 'danger', sm: true }) + '</div>') +
  '</div><div class="ui-drawer-foot">' + uiBtn('Hủy', 'Cancel') + uiBtn(opts.add ? 'Tạo tài khoản' : 'Lưu thay đổi', opts.add ? 'Create account' : 'Save changes', { variant: 'primary' }) + '</div></aside></div>';

const memberAdminDesktop = () =>
  appDesktop('B', 'admin-members',
    '<div class="ui-behind">' + adminListBehind() + '</div>' + memberDrawer());

const memberAdminStates = [
  { title: 'Thêm thành viên', note: 'Cùng khung, trường trống, không có khối khóa.', html: '<div class="ui-fragment ui-drawer-demo">' + memberDrawer({ add: true }) + '</div>' },
  { title: 'Email sai tên miền', note: 'Lỗi ngay dưới trường, giữ dữ liệu đã nhập.', html: '<div class="ui-fragment ui-drawer-demo">' + memberDrawer({ emailError: true, add: true }) + '</div>' },
  { title: 'Khóa tài khoản', note: 'Nêu rõ dữ liệu được giữ và việc không đăng nhập được.', phone: true, html: '<div class="ui-fragment">' + uiModal({ titleVi: 'Khóa tài khoản của Nguyễn Văn A?', titleEn: 'Deactivate Nguyễn Văn A?', body: '<p class="ui-modal-p" ' + A('A sẽ không đăng nhập được và không nhận email nhắc deadline. Task, bình luận và lịch sử vẫn giữ nguyên; có thể mở khóa lại.', 'A will not be able to sign in or receive deadline email. Tasks, comments and history are kept; you can reactivate later.') + '>A sẽ không đăng nhập được và không nhận email nhắc deadline. Task, bình luận và lịch sử vẫn giữ nguyên.</p>', actions: uiBtn('Hủy', 'Cancel') + uiBtn('Khóa tài khoản', 'Deactivate', { variant: 'danger' }) }) + '</div>' },
  { title: 'MSSV đã tồn tại', note: 'Lỗi trường, không tiết lộ người sở hữu.', html: '<div class="ui-fragment"><div style="padding:18px">' + uiField({ labelVi: 'MSSV', labelEn: 'Student ID', required: true, control: '<span class="ui-input has-error mono">MSSV-002</span>', errorVi: 'MSSV này đã được dùng.', errorEn: 'This student ID is already in use.' }) + '</div></div>' },
  { title: 'Không có quyền', note: '403, không phải 404: người dùng biết trang tồn tại.', phone: true, html: '<div class="ui-fragment"><div class="mini-error-page">' + uiErrorPanel({ iconName: 'lock', titleVi: 'Bạn không có quyền quản trị thành viên', titleEn: 'You cannot manage members', bodyVi: 'Cần quyền member.create, member.update hoặc member.deactivate.', bodyEn: 'Requires member.create, member.update or member.deactivate.', meta: '403 · REQ-0C11', actions: uiBtn('Về trang thành viên', 'Back to members', { iconName: 'arrow-left' }) }) + '</div></div>' },
  { title: 'Đã lưu', note: 'Toast xác nhận; drawer đóng, danh sách cập nhật.', html: '<div class="ui-fragment" style="position:relative;height:170px;padding:14px;background:#f7f8f5">' + uiToast({ vi: 'Đã lưu thay đổi cho Nguyễn Văn A', en: 'Saved changes for Nguyễn Văn A' }) + '</div>' }
];

const permMatrix = (checked) => {
  const list = checked || ['member.view', 'task.update_assigned', 'comment.create'];
  return '<div class="perm-groups">' + permissionGroups.map((group) =>
    '<section class="perm-group"><header class="perm-group-head"><h3>' + T(group.nameVi, group.nameEn) + '>' + group.nameVi + '</h3><span>' + group.items.length + '</span></header>' +
    group.items.map((item) => '<div class="perm-row' + (list.includes(item.code) ? ' is-on' : '') + '"><span class="ui-box' + (list.includes(item.code) ? ' is-on' : '') + '">' + (list.includes(item.code) ? icon('check', 11) : '') + '</span><span class="perm-row-text"><b>' + item.code + '</b><span ' + A(item.vi, item.en) + '>' + item.vi + '</span></span></div>').join('') +
    '</section>'
  ).join('') + '</div>';
};

const permissionsDesktop = () =>
  appDesktop('B', 'permissions',
    '<div class="ui-top"><div class="ui-top-bread"><span ' + A('Quản trị', 'Admin') + '>Quản trị</span><span>/</span><b ' + A('Phân quyền', 'Permissions') + '>Phân quyền</b></div><div class="ui-top-right">' + uiIconBtn('search', 'Tìm kiếm', 'Search') + '</div></div>' +
    '<div class="perm-layout"><aside class="perm-people"><div class="perm-people-head"><h2 ' + A('Thành viên', 'Members') + '>Thành viên</h2><span class="ui-count">10</span></div><div class="perm-search">' + icon('search', 14) + '<span ' + A('Tìm thành viên', 'Find a member') + '>Tìm thành viên</span></div>' +
    Object.values(members).map((m) => '<div class="perm-person' + (m.key === 'A' ? ' is-active' : '') + (m.active ? '' : ' is-off') + '">' + avatar(m.key, 26) + '<span class="perm-person-text"><b>' + m.name + '</b><span>' + (m.admin ? 'Admin' : m.depts[0]) + '</span></span>' + (m.admin ? icon('shield', 13) : '') + '</div>').join('') + '</aside>' +
    '<section class="perm-main"><div class="perm-top"><div class="perm-who">' + avatar('A', 38) + '<div><h1>Nguyễn Văn A</h1><span>' + T('Thành viên · Truyền thông, Sự kiện', 'Member · Communications, Events') + '>Thành viên · Truyền thông, Sự kiện</span></div></div><div class="perm-presets"><span class="ui-small ui-muted" ' + A('Mẫu quyền', 'Presets') + '>Mẫu quyền</span><div class="perm-preset-row">' + presets.map((p) => '<span class="perm-preset' + (p.key === 'basic' ? ' is-on' : '') + '">' + T(p.vi, p.en) + '>' + p.vi + '<b>' + p.count + '</b></span>').join('') + '</div></div></div>' +
    '<div class="perm-banner">' + icon('info', 14) + '<span ' + A('Đang sửa quyền của Nguyễn Văn A. Thay đổi áp dụng toàn CLB và ghi vào nhật ký quản trị.', 'Editing Nguyễn Văn A’s permissions. Changes apply club-wide and are written to the audit log.') + '>Đang sửa quyền của Nguyễn Văn A.</span></div>' +
    '<div class="perm-scroll has-pin"><span class="pin">1</span>' + permMatrix() + '</div>' +
    '<div class="perm-savebar"><div class="perm-effective"><b ' + A('3 quyền đang bật', '3 permissions on') + '>3 quyền đang bật</b><span ' + A('member.view · task.update_assigned · comment.create', 'member.view · task.update_assigned · comment.create') + '>member.view · task.update_assigned · comment.create</span></div>' + uiBtn('Hủy', 'Cancel') + uiBtn('Lưu thay đổi', 'Save changes', { variant: 'primary' }) + '</div></section></div>');

const permissionsStates = [
  { title: 'Mẫu quyền thay thế', note: 'Chọn mẫu sẽ thay toàn bộ quyền, cần xác nhận.', html: '<div class="ui-fragment">' + uiModal({ titleVi: 'Thay bằng mẫu “Trưởng ban”?', titleEn: 'Replace with “Department lead”?', body: '<p class="ui-modal-p" ' + A('Mẫu này đặt lại toàn bộ 9 quyền của Trưởng ban và bỏ 1 quyền đang bật không thuộc mẫu. Không thể hoàn tác sau khi lưu.', 'This preset sets all 9 department-lead permissions and removes 1 current permission not in the preset. It cannot be undone after saving.') + '>Mẫu này đặt lại toàn bộ 9 quyền của Trưởng ban và bỏ 1 quyền đang bật không thuộc mẫu.</p><div class="preset-diff"><span><b>' + T('Thêm', 'Adds') + '</b> +6</span><span><b>' + T('Bỏ', 'Removes') + '</b> −1</span></div>', width: 430, actions: uiBtn('Hủy', 'Cancel') + uiBtn('Dùng mẫu này', 'Use this preset', { variant: 'primary' }) }) + '</div>' },
  { title: 'Admin cuối cùng', note: 'Chặn gỡ cờ admin cuối cùng; nêu người còn lại.', wide: true, html: '<div class="ui-fragment" style="padding:18px"><div class="ui-banner is-danger">' + icon('shield', 16) + '<div class="ui-banner-body"><span class="ui-banner-title" ' + A('Không thể gỡ quyền admin cuối cùng', 'Cannot remove the last admin') + '>Không thể gỡ quyền admin cuối cùng</span><span class="ui-banner-text" ' + A('CLB phải còn ít nhất một admin đang hoạt động. Cấp admin cho người khác trước, rồi quay lại.', 'The club must keep at least one active admin. Grant admin to someone else first, then come back.') + '>CLB phải còn ít nhất một admin đang hoạt động.</span></div></div><div class="last-admin-demo"><div class="ui-toggle-row"><span class="ui-toggle is-on"><i></i></span><span class="ui-toggle-label"><span>Quyền admin</span><span class="ui-check-desc">' + T('Trần Thị B · admin duy nhất còn hoạt động', 'Trần Thị B · the only active admin') + '>Trần Thị B · admin duy nhất còn hoạt động</span></span></div>' + uiBtn('Gỡ admin', 'Remove admin', { variant: 'danger', sm: true }) + '</div></div>' },
  { title: 'Đang tải quyền', note: 'Giữ cột và nhóm để không nhảy.', phone: true, html: '<div class="ui-fragment" style="padding:18px"><div class="ui-stack">' + [1, 2, 3, 4, 5].map(() => '<div class="skel-taskrow"><span class="ui-skeleton" style="width:14px;height:14px"></span><span class="ui-skeleton" style="width:72%"></span></div>').join('') + '</div></div>' },
  { title: 'Không có quyền', note: 'Chỉ admin mới vào được trang này.', phone: true, html: '<div class="ui-fragment"><div class="mini-error-page">' + uiErrorPanel({ iconName: 'lock', titleVi: 'Chỉ admin xem được phân quyền', titleEn: 'Only admins can see permissions', bodyVi: 'Cần cờ admin, không phải một mã quyền riêng.', bodyEn: 'This requires the admin flag, not a separate permission code.', meta: '403 · REQ-7D04' }) + '</div></div>' }
];

const deptRows = () =>
  departments.map((d) =>
    '<div class="dept-row"><span class="dept-name">' + d.name + '</span><span class="dept-meta"><b>' + d.members + '</b> ' + T('thành viên', 'members') + '</span><span class="dept-meta"><b>' + d.boards + '</b> board</span><span class="dept-open">' + icon('more', 14) + '</span></div>'
  ).join('');

const departmentsDesktop = () =>
  appDesktop('B', 'departments',
    '<div class="ui-top"><div class="ui-top-bread"><span ' + A('Quản trị', 'Admin') + '>Quản trị</span><span>/</span><b ' + A('Ban', 'Departments') + '>Ban</b></div></div>' +
    '<div class="ui-scroll"><div class="ui-pagehead"><div class="ui-pagehead-text"><h1 class="ui-h1" ' + A('Ban', 'Departments') + '>Ban</h1><span class="ui-sub" ' + A('20 ban · 8 ban đang có thành viên', '20 departments · 8 with members') + '>20 ban · 8 ban đang có thành viên</span></div><div class="ui-pagehead-actions">' + uiBtn('Thêm ban', 'Add department', { variant: 'primary', iconName: 'plus' }) + '</div></div>' +
    '<div class="dept-toolbar"><div class="ui-input" style="width:260px">' + icon('search', 15) + '<span class="ui-input-fake is-placeholder" ' + A('Tìm ban', 'Search departments') + '>Tìm ban</span></div><span class="ui-toolbar-spacer"></span><span class="ui-small ui-muted" ' + A('Xóa ban có thành viên hoặc board sẽ bị chặn.', 'A department with members or boards cannot be deleted.') + '>Xóa ban có thành viên hoặc board sẽ bị chặn.</span></div>' +
    '<div class="dept-grid"><section class="dept-panel"><header class="dept-panel-head"><h2>' + T('Đang dùng', 'In use') + '</h2><span>8</span></header>' + deptRows() + '</section><section class="dept-panel"><header class="dept-panel-head"><h2>' + T('Chưa có thành viên', 'No members yet') + '</h2><span>12</span></header>' + departments.slice(8).map((d) => '<div class="dept-row is-empty"><span class="dept-name">' + d.name + '</span><span class="dept-meta">0 ' + T('thành viên', 'members') + '</span><span class="dept-meta">0 board</span><span class="dept-open">' + icon('more', 14) + '</span></div>').join('') + '</section></div></div>');

const departmentsStates = [
  { title: 'Xóa ban còn dữ liệu', note: 'Chặn và nêu chính xác cái gì đang dùng ban.', phone: true, html: '<div class="ui-fragment">' + uiModal({ titleVi: 'Không thể xóa ban “Sự kiện”', titleEn: 'Cannot delete “Events”', body: '<p class="ui-modal-p" ' + A('Ban này còn 3 thành viên và 2 board. Chuyển thành viên và board sang ban khác trước khi xóa.', 'This department still has 3 members and 2 boards. Move them to another department before deleting.') + '>Ban này còn 3 thành viên và 2 board.</p><div class="dept-block-list"><span>' + icon('users', 13) + '3 ' + T('thành viên', 'members') + '</span><span>' + icon('board', 13) + '2 board</span></div>', width: 430, actions: uiBtn('Đóng', 'Close') + uiBtn('Chuyển dữ liệu', 'Move data', { variant: 'primary' }) }) + '</div>' },
  { title: 'Tên ban đã có', note: 'So trùng không phân biệt hoa thường.', phone: true, html: '<div class="ui-fragment"><div style="padding:18px">' + uiField({ labelVi: 'Tên ban', labelEn: 'Department name', required: true, control: '<span class="ui-input has-error">Truyền thông</span>', errorVi: 'Tên ban này đã tồn tại.', errorEn: 'This department name already exists.' }) + '</div></div>' },
  { title: 'Chưa có ban', note: 'Trạng thái trống hiếm nhưng phải có.', phone: true, html: '<div class="ui-fragment" style="padding:20px">' + uiEmpty({ iconName: 'building', titleVi: 'Chưa có ban nào', titleEn: 'No departments yet', bodyVi: 'Tạo ban đầu tiên để gán thành viên và board.', bodyEn: 'Create the first department to assign members and boards.', action: uiBtn('Thêm ban', 'Add department', { variant: 'primary', iconName: 'plus' }) }) + '</div>' }
];

export const adminScreens = [
  {
    code: 'S07', slug: 's07-members', group: 'Con người & quyền',
    titleVi: 'Danh sách thành viên', titleEn: 'Member directory',
    purpose: 'Tìm một người và biết họ thuộc ban nào. MSSV và email chỉ xuất hiện khi người xem có quyền xem chi tiết — cùng một bảng, hai mức thông tin khác nhau.',
    who: 'Mọi tài khoản đang hoạt động', persona: 'Desktop: Lê Văn C (có member.view_detail) · Mobile: Nguyễn Văn A (không có)',
    permLine: 'member.view · member.view_detail quyết định cột MSSV/email',
    frs: ['FR-42', 'FR-43'], acs: ['AC-11'],
    frames: [
      { kind: 'desktop', context: 'Có quyền xem chi tiết · thấy MSSV và email', html: membersDesktop() },
      { kind: 'mobile', context: 'Không có quyền xem chi tiết · chỉ họ tên và ban', html: membersMobile() }
    ],
    pins: [
      '<strong>Hai phiên bản của cùng một bảng.</strong> Không có quyền <code>member.view_detail</code> thì cột MSSV và email không được render, không phải bị làm mờ. Không có chỗ nào khác trong trang lộ hai trường này.',
      '<strong>Tìm theo họ tên hoặc MSSV</strong> chỉ trả kết quả phù hợp quyền: người thiếu quyền gõ MSSV sẽ không nhận gợi ý hay kết quả',
      '<strong>Thành viên đã rời</strong> vẫn nằm trong danh sách với nhãn “(đã rời)”, không bị xóa. Bộ lọc mặc định là “Đang hoạt động”.',
      '<strong>Dòng không có menu</strong> nếu người xem thiếu member.update/deactivate; bấm vào tên mở hồ sơ, không mở menu quản trị.'
    ],
    permissions: [
      'Xem danh sách: <code>member.view</code>. Không có quyền này thì không vào được mục Thành viên.',
      'MSSV/email: <code>member.view_detail</code>. Chính chủ luôn thấy ở S08.',
      'Thêm/sửa/khóa: <code>member.create</code>, <code>member.update</code>, <code>member.deactivate</code> — các nút này không có trong khung C vì C thiếu quyền.'
    ],
    related: [['S08 · Hồ sơ', 's08-profile.html'], ['S09 · Quản trị thành viên', 's09-member-admin.html']],
    questions: [['WQ-11', 'phạm vi tìm kiếm'], ['WQ-18', 'thành viên nhiều ban']],
    strings: [
      ['Thành viên', 'Members'],
      ['Đang hoạt động', 'Active'],
      ['Đã rời', 'Left'],
      ['Vai trò', 'Role'],
      ['Tìm theo họ tên hoặc MSSV', 'Search by name or student ID'],
      ['MSSV và email chỉ hiện với người có quyền xem chi tiết thành viên.', 'Student IDs and email are shown only with member detail permission.']
    ],
    states: [
      { title: 'Không có kết quả', note: 'Nêu từ khóa và cách xóa lọc.', html: '<div class="ui-fragment" style="padding:22px">' + uiEmpty({ iconName: 'search', titleVi: 'Không tìm thấy thành viên', titleEn: 'No members found', bodyVi: 'Không có kết quả cho “MSSV-099”. Thử tên khác hoặc xóa bộ lọc ban.', bodyEn: 'Nothing matches “MSSV-099”. Try another name or clear the department filter.', action: uiBtn('Xóa lọc', 'Clear filters', { iconName: 'x' }) }) + '</div>' },
      { title: 'Đang tải', note: 'Giữ cột để bảng không nhảy.', html: '<div class="ui-fragment" style="padding:16px"><div class="ui-stack">' + [1, 2, 3, 4, 5].map(() => '<div class="skel-taskrow"><span class="ui-skeleton" style="width:24px;height:24px;border-radius:50%"></span><span class="ui-skeleton" style="width:36%"></span><span class="ui-skeleton" style="width:18%"></span></div>').join('') + '</div></div>' },
      { title: 'Lỗi tải', note: 'Giữ bộ lọc, cho thử lại.', html: '<div class="ui-fragment" style="padding:20px">' + uiErrorPanel({ titleVi: 'Không tải được danh sách thành viên', titleEn: 'Could not load members', bodyVi: 'Máy chủ không phản hồi. Bộ lọc của bạn vẫn giữ nguyên.', bodyEn: 'The server did not respond. Your filters are kept.', meta: 'REQ-5E20' }) + '</div>' },
      { title: 'Email thành viên (chỉ admin)', note: 'Cùng bảng, thêm cột email; không có nút sửa nếu thiếu quyền.', html: '<div class="ui-fragment" style="padding:16px"><div class="mini-member-row"><span class="mem-person">' + avatar('F', 28) + '<span class="mem-person-text"><span class="mem-name">Vũ Quốc F <span class="ui-out">(đã rời)</span></span><span class="mem-email">vuquocf@eiu.edu.vn</span></span></span><span class="mem-mssv">MSSV-006</span><span class="status-cell is-off"><i class="status-dot"></i>Đã rời</span></div></div>' }
    ]
  },
  {
    code: 'S08', slug: 's08-profile', group: 'Con người & quyền',
    titleVi: 'Hồ sơ cá nhân', titleEn: 'My profile',
    purpose: 'Chỗ duy nhất một người thấy MSSV và email của chính mình, cùng danh sách quyền đang có. Không phải trang chỉnh sửa: hồ sơ do admin quản lý.',
    who: 'Mọi tài khoản', persona: 'Nguyễn Văn A · Thành viên',
    permLine: 'Chính chủ · không cần quyền đặc biệt',
    frs: ['FR-42', 'FR-50'], acs: [],
    frames: [
      { kind: 'desktop', context: 'Hồ sơ của chính mình · thấy MSSV/email', html: profileDesktop() },
      { kind: 'mobile', context: 'Cùng nội dung · xếp dọc', html: profileMobile() }
    ],
    pins: [
      '<strong>MSSV và email chỉ ở đây</strong>, kèm ghi chú “Chỉ bạn và admin thấy”. Không có nút chia sẻ, không copy vào clipboard tự động.',
      '<strong>Không có nút sửa hồ sơ.</strong> Họ tên, ban và quyền do admin quản lý; người dùng chỉ đổi được cách hiển thị ngôn ngữ và đăng xuất.',
      '<strong>Danh sách quyền là bản đọc</strong> từ 18 mã quyền, không phải công tắc. Người dùng biết mình làm được gì mà không phải thử.',
      '<strong>Phiên đăng nhập</strong> nêu “Ghi nhớ” đang bật/tắt và thời điểm hết hạn. Không hiển thị token hay mã phiên.'
    ],
    permissions: [
      'Chỉ chủ tài khoản xem được trang này; admin xem hồ sơ người khác qua S09.',
      'Không cần mã quyền; tài khoản phải đang hoạt động.',
      'Đổi ngôn ngữ lưu vào hồ sơ cá nhân (profiles.locale), áp dụng cho cả email nhắc (WQ-19).'
    ],
    related: [['S07 · Thành viên', 's07-members.html'], ['S12 · Nhắc deadline', 's12-reminders.html']],
    questions: [['WQ-19', 'tự đổi ngôn ngữ?'], ['WQ-20', 'đổi mật khẩu (không có mật khẩu)']],
    strings: [
      ['Hồ sơ của tôi', 'My profile'],
      ['Thông tin liên hệ', 'Contact details'],
      ['Quyền của bạn', 'Your permissions'],
      ['Phiên đăng nhập', 'Session'],
      ['Chỉ bạn và admin thấy', 'Only you and admins'],
      ['Đăng xuất', 'Sign out']
    ],
    states: [
      { title: 'Hồ sơ người khác · có quyền', note: 'Admin xem qua S09, không dùng trang này.', phone: true, html: '<div class="ui-fragment" style="padding:20px">' + uiEmpty({ iconName: 'user', titleVi: 'Đây là hồ sơ của bạn', titleEn: 'This is your profile', bodyVi: 'Hồ sơ người khác mở trong trang quản trị thành viên, nơi có kiểm tra quyền.', bodyEn: 'Other profiles open in member admin, where permissions are checked.', action: uiBtn('Mở quản trị thành viên', 'Open member admin', { iconName: 'users' }) }) + '</div>' },
      { title: 'Tài khoản bị khóa', note: 'Không vào được; hiển thị ở lần đăng nhập sau.', phone: true, html: '<div class="ui-fragment"><div class="mini-error-page">' + uiErrorPanel({ iconName: 'lock', titleVi: 'Tài khoản đã bị khóa', titleEn: 'Account deactivated', bodyVi: 'Liên hệ admin của CLB nếu bạn vẫn đang tham gia.', bodyEn: 'Contact a club admin if you are still a member.', meta: 'REQ-8A31' }) + '</div></div>' },
      { title: 'Đang tải', note: 'Khung xương giữ bố cục.', phone: true, html: '<div class="ui-fragment" style="padding:18px"><div class="ui-skeleton" style="width:56px;height:56px;border-radius:50%"></div><div class="ui-skeleton" style="width:48%;height:18px;margin-top:12px"></div><div class="ui-skeleton" style="width:70%;margin-top:8px"></div></div>' }
    ]
  },
  {
    code: 'S09', slug: 's09-member-admin', group: 'Con người & quyền',
    titleVi: 'Quản trị thành viên', titleEn: 'Member admin',
    purpose: 'Sửa hồ sơ, gán ban, khóa tài khoản trong một khung bên — danh sách phía sau vẫn giữ ngữ cảnh. Không có trang “tạo thành viên” riêng để tránh hai nguồn dữ liệu.',
    who: 'Admin và người có quyền quản lý thành viên', persona: 'Trần Thị B · Admin',
    permLine: 'member.create · member.update · member.deactivate',
    frs: ['FR-04', 'FR-10', 'FR-19', 'FR-42', 'FR-43'], acs: ['AC-09', 'AC-14'],
    frames: [
      { kind: 'desktop', context: 'Khung sửa 480 px · danh sách phía sau', html: memberAdminDesktop() }
    ],
    pins: [
      '<strong>MSSV không sửa sau khi tạo.</strong> Trường hiển thị nhưng khóa, vì MSSV là định danh đăng nhập; đổi MSSV sẽ làm hỏng phiên và lịch sử.',
      '<strong>Email kiểm tra tên miền ngay tại trường</strong> và một lần nữa ở server. Không lưu email sai rồi báo lỗi muộn.',
      '<strong>Khóa tài khoản là xóa mềm:</strong> không đăng nhập, không nhận email nhắc, nhưng task/bình luận/lịch sử còn nguyên. Có thể mở khóa lại.',
      '<strong>Cờ admin là quyền riêng, không nằm trong 18 mã.</strong> Chỉ admin khác cấp; không tự cấp cho mình nếu là admin cuối cùng.',
      '<strong>Mọi thay đổi ghi audit</strong> (ai, khi nào, cho ai, quyền nào) trong cùng transaction; không có nút “xóa vĩnh viễn”.'
    ],
    permissions: [
      'Mở khung: <code>member.create</code> hoặc <code>member.update</code>. Khóa/mở: <code>member.deactivate</code>.',
      'Đổi ban: <code>member.update</code>. Cấp/thu hồi admin: chỉ admin.',
      'Tự khóa chính mình bị chặn; gỡ admin cuối cùng bị chặn (S10).',
      'Thiếu quyền: 403, không ẩn trang.'
    ],
    related: [['S07 · Thành viên', 's07-members.html'], ['S10 · Phân quyền', 's10-permissions.html'], ['S13 · Nhật ký', 's13-audit.html']],
    questions: [['WQ-21', 'đổi MSSV?'], ['WQ-22', 'xóa cứng thành viên']],
    strings: [
      ['Thêm thành viên', 'Add member'],
      ['Sửa hồ sơ', 'Edit profile'],
      ['Họ và tên', 'Full name'],
      ['MSSV', 'Student ID'],
      ['Email', 'Email'],
      ['Ban', 'Departments'],
      ['Tài khoản đang hoạt động', 'Account is active'],
      ['Quyền admin', 'Admin'],
      ['Khóa tài khoản', 'Deactivate account'],
      ['Lưu thay đổi', 'Save changes']
    ],
    states: memberAdminStates
  },
  {
    code: 'S10', slug: 's10-permissions', group: 'Con người & quyền',
    titleVi: 'Phân quyền', titleEn: 'Permissions',
    purpose: 'Một ma trận đọc được, không phải 18 công tắc rời rạc. Chọn người bên trái, thấy quyền hiện tại và mẫu gợi ý bên phải; mọi thay đổi đều ghi nhật ký.',
    who: 'Chỉ admin', persona: 'Trần Thị B · Admin',
    permLine: 'Cờ admin · không có mã quyền riêng cho trang này',
    frs: ['FR-05', 'FR-14', 'FR-15', 'FR-17', 'FR-18', 'FR-19'], acs: ['AC-07', 'AC-08', 'AC-09', 'AC-10'],
    frames: [
      { kind: 'desktop', context: 'Đang sửa Nguyễn Văn A · 3 quyền mặc định', html: permissionsDesktop() }
    ],
    pins: [
      '<strong>Mỗi dòng là một mã quyền thật</strong> trong danh mục 18 mã, kèm mô tả tiếng người. Không có quyền “ẩn” hay quyền theo ban.',
      '<strong>Mẫu quyền thay thế toàn bộ</strong>, không cộng dồn. Trước khi áp dụng phải xác nhận và nêu rõ thêm/bỏ bao nhiêu.',
      '<strong>Quyền áp dụng toàn CLB, vĩnh viễn.</strong> Không có phạm vi theo ban hay ngày hết hạn — đúng theo HANDOFF, dù có thể gây bất ngờ.',
      '<strong>Admin cuối cùng</strong> không thể bị gỡ cờ. Kiểm tra ở giao diện và trong transaction; không chỉ ẩn nút.',
      '<strong>Lưu là một transaction</strong> gồm quyền + audit. Nếu audit lỗi, quyền không đổi.'
    ],
    permissions: [
      'Chỉ admin. Người có mã quyền khác vẫn nhận 403.',
      'Cấp/thu hồi 18 mã: chỉ admin. Cấp/thu admin: chỉ admin, luôn còn ít nhất một admin hoạt động.',
      'Mỗi thay đổi ghi một bản audit; không sửa/xóa audit.'
    ],
    related: [['S09 · Quản trị thành viên', 's09-member-admin.html'], ['S13 · Nhật ký', 's13-audit.html']],
    questions: [['WQ-23', 'mẫu quyền tùy chỉnh'], ['WQ-24', 'quyền theo ban (ngoài MVP)']],
    strings: [
      ['Phân quyền', 'Permissions'],
      ['Mẫu quyền', 'Presets'],
      ['Thành viên cơ bản', 'Basic member'],
      ['Trưởng ban', 'Department lead'],
      ['Quản lý nhân sự', 'People manager'],
      ['Lưu thay đổi', 'Save changes'],
      ['Không thể gỡ quyền admin cuối cùng', 'Cannot remove the last admin']
    ],
    states: permissionsStates
  },
  {
    code: 'S11', slug: 's11-departments', group: 'Con người & quyền',
    titleVi: 'Quản trị ban', titleEn: 'Departments',
    purpose: '20 ban, nhưng chỉ vài ban đang có người. Tách “đang dùng” và “chưa có thành viên” để admin không phải quét một danh sách dài.',
    who: 'Admin hoặc người có department.manage', persona: 'Trần Thị B · Admin',
    permLine: 'department.manage',
    frs: ['FR-13'], acs: [],
    frames: [
      { kind: 'desktop', context: '20 ban · 8 ban đang có người', html: departmentsDesktop() }
    ],
    pins: [
      '<strong>Xóa ban bị chặn khi còn thành viên hoặc board.</strong> Hộp thoại nêu con số cụ thể và cho chuyển dữ liệu, không chỉ báo “không xóa được”.',
      '<strong>Tên ban so trùng không phân biệt hoa thường</strong> và cắt khoảng trắng; lỗi hiện tại trường.',
      '<strong>Không xóa cứng ban đã dùng.</strong> Có thể đổi tên; muốn bỏ thì chuyển hết dữ liệu trước.',
      '<strong>Số thành viên và board là số thật</strong> tại thời điểm tải, không cache lâu; thêm người ở S09 phải thấy thay đổi khi quay lại.'
    ],
    permissions: [
      'Xem: mọi tài khoản (danh mục ban dùng để gán).',
      'Tạo/sửa/xóa: <code>department.manage</code>. Xóa còn ràng buộc dữ liệu: 409.',
      'Không có quyền: nút Thêm/sửa/xóa ẩn; API vẫn trả 403.'
    ],
    related: [['S07 · Thành viên', 's07-members.html'], ['S09 · Quản trị thành viên', 's09-member-admin.html']],
    questions: [['WQ-02', 'board thuộc nhiều ban?'], ['WQ-25', 'ban không có người']],
    strings: [
      ['Ban', 'Departments'],
      ['Thêm ban', 'Add department'],
      ['Đang dùng', 'In use'],
      ['Chưa có thành viên', 'No members yet'],
      ['thành viên', 'members'],
      ['Không thể xóa ban', 'Cannot delete department'],
      ['Tên ban này đã tồn tại.', 'This department name already exists.']
    ],
    states: departmentsStates
  }
];

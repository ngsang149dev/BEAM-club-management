// Shared markup helpers for the wireframe generator.
import { members } from './data.mjs';

export const esc = (value = '') =>
  String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));

/** Attributes for a leaf element whose text changes with the language switch. */
export const A = (vi, en) => 'data-vi="' + esc(vi) + '" data-en="' + esc(en) + '"';

export const T = (vi, en, tag = 'span', cls = '') =>
  '<' + tag + (cls ? ' class="' + cls + '"' : '') + ' ' + A(vi, en) + '>' + esc(vi) + '</' + tag + '>';

export const ph = (vi, en) => 'data-vi-ph="' + esc(vi) + '" data-en-ph="' + esc(en) + '" placeholder="' + esc(vi) + '"';

const ICONS = {
  board: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>',
  'check-square': '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 12l3 3 5-6"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20c.6-3.4 2.8-5.4 5.5-5.4s4.9 2 5.5 5.4"/><path d="M16 5.2a3.2 3.2 0 0 1 0 6.1"/><path d="M17.5 14.9c1.8.7 3 2.5 3.4 5.1"/>',
  user: '<circle cx="12" cy="8" r="3.4"/><path d="M5 20c.7-3.7 3.2-5.8 7-5.8s6.3 2.1 7 5.8"/>',
  shield: '<path d="M12 3l7 2.8v6c0 4.3-2.8 7.3-7 9.2-4.2-1.9-7-4.9-7-9.2v-6z"/><path d="M9.2 12l2 2 3.6-4"/>',
  building: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/><path d="M10 21v-3h4v3"/>',
  bell: '<path d="M6 9a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13 6 9z"/><path d="M10 18a2 2 0 0 0 4 0"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r=".9" fill="currentColor" stroke="none"/><circle cx="3.5" cy="12" r=".9" fill="currentColor" stroke="none"/><circle cx="3.5" cy="18" r=".9" fill="currentColor" stroke="none"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.2 4.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  'chevron-down': '<path d="M6 9l6 6 6-6"/>',
  'chevron-up': '<path d="M6 15l6-6 6 6"/>',
  'chevron-right': '<path d="M9 6l6 6-6 6"/>',
  'chevron-left': '<path d="M15 6l-6 6 6 6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  more: '<circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.2" fill="currentColor" stroke="none"/>',
  'eye-off': '<path d="M3 3l18 18"/><path d="M10.6 5.3A9.8 9.8 0 0 1 12 5.2c5.7 0 9 6.8 9 6.8a17 17 0 0 1-2.4 3.4"/><path d="M6.2 6.9C3.8 8.7 3 12 3 12s3.3 6.8 9 6.8c1.2 0 2.3-.3 3.3-.7"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  eye: '<path d="M3 12s3.3-6.8 9-6.8S21 12 21 12s-3.3 6.8-9 6.8S3 12 3 12z"/><circle cx="12" cy="12" r="2.8"/>',
  message: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
  'alert-triangle': '<path d="M12 3l9.5 17h-19z"/><path d="M12 9v5M12 17.2v.2"/>',
  'alert-circle': '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.2"/>',
  undo: '<path d="M9 7L4 12l5 5"/><path d="M4 12h9a6 6 0 0 1 6 6v1"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/><path d="M10 11v6M14 11v6"/>',
  restore: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v5h5"/>',
  'arrow-right': '<path d="M4 12h15M13 6l6 6-6 6"/>',
  'arrow-left': '<path d="M20 12H5M11 6l-6 6 6 6"/>',
  filter: '<path d="M4 5h16l-6.2 7.4V19l-3.6 1.6v-8.2z"/>',
  grip: '<circle cx="9" cy="7" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="7" r="1.1" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="9" cy="17" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="17" r="1.1" fill="currentColor" stroke="none"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/>',
  logout: '<path d="M10 5H5v14h5"/><path d="M14 8l4 4-4 4M8 12h10"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z"/>',
  check: '<path d="M4 12l5 5L20 6"/>',
  'wifi-off': '<path d="M3 3l18 18"/><path d="M8.5 15.5a5 5 0 0 1 7 0M5.5 12.5a10 10 0 0 1 3.2-2M18.5 12.5a10 10 0 0 0-2.2-1.5M2.5 9.5a15 15 0 0 1 4.1-2.6M21.5 9.5a15 15 0 0 0-10.9-3.4M12 19h.01"/>',
  edit: '<path d="M4 20h4L20 8l-4-4L4 16z"/><path d="M14 6l4 4"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5H5V5h5"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M9 14h6"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.6-4L4 9"/><path d="M4 4v5h5M4 13a8 8 0 0 0 14.6 4L20 15"/><path d="M20 20v-5h-5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  tag: '<path d="M4 4h8l8 8-8 8-8-8z"/><circle cx="8.5" cy="8.5" r="1.2"/>',
  paperclip: '<path d="M20 11l-8.5 8.5a5 5 0 0 1-7-7L14 3a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v11h14V9M10 13h4"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v5h5"/><path d="M12 8v4l3 2"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l2 2M14 9l2 2"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  'circle-dot': '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/>'
};

export const icon = (name, size = 16, cls = '') =>
  '<svg class="ic ' + cls + '" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';

export const initials = (name) => {
  const parts = String(name).trim().split(/\s+/);
  return (parts[parts.length - 1] || '?').slice(0, 1).toUpperCase();
};

export const person = (key) => members[key] || { name: key, active: true };

export const avatar = (key, size = 26) => {
  const p = person(key);
  return '<span class="ui-avatar' + (p.active === false ? ' is-out' : '') + '" style="--s:' + size + 'px" aria-hidden="true">' + esc(initials(p.name)) + '</span>';
};

export const personName = (key, opts = {}) => {
  const p = person(key);
  const suffix = p.active === false ? ' <span class="ui-out" ' + A('(đã rời)', '(left)') + '>(đã rời)</span>' : '';
  return '<span class="ui-person">' + esc(p.name) + suffix + '</span>' + (opts.withAvatar === false ? '' : '');
};

export const avatarStack = (keys, max = 3) => {
  const shown = keys.slice(0, max);
  const rest = keys.length - shown.length;
  return '<span class="ui-avatars">' + shown.map((k) => avatar(k, 22)).join('') + (rest > 0 ? '<span class="ui-avatar ui-avatar-more" style="--s:22px">+' + rest + '</span>' : '') + '</span>';
};

const PRIORITY = { 1: ['Thấp', 'Low'], 2: ['Trung bình', 'Medium'], 3: ['Cao', 'High'], 4: ['Khẩn', 'Urgent'] };

export const priorityBadge = (level) => {
  const [vi, en] = PRIORITY[level];
  const bars = [1, 2, 3, 4].map((i) => '<i class="' + (i <= level ? 'on' : '') + '"></i>').join('');
  return '<span class="ui-prio p' + level + '"><span class="ui-prio-bars" aria-hidden="true">' + bars + '</span><span ' + A(vi, en) + '>' + vi + '</span></span>';
};

export const dueBadge = (due, plain = false) => {
  if (!due) return '<span class="ui-due is-none" ' + A('Không có hạn', 'No due date') + '>Không có hạn</span>';
  const ico = due.state === 'overdue' ? 'alert-triangle' : due.state === 'today' || due.state === 'soon' ? 'clock' : 'calendar';
  return '<span class="ui-due is-' + due.state + (plain ? ' is-plain' : '') + '">' + icon(ico, 13) + '<span ' + A(due.vi, due.en) + '>' + esc(due.vi) + '</span></span>';
};

export const deptChip = (name, muted = false) =>
  name ? '<span class="ui-chip' + (muted ? ' is-muted' : '') + '">' + icon('building', 12) + '<span>' + esc(name) + '</span></span>' : '<span class="ui-chip is-muted" ' + A('Không gán ban', 'No department') + '>Không gán ban</span>';

export const countChip = (n, vi, en) => '<span class="ui-count">' + n + ' <span ' + A(vi, en) + '>' + vi + '</span></span>';

export const uiBtn = (vi, en, opts = {}) => {
  const cls = ['ui-btn', opts.variant || 'secondary', opts.sm ? 'is-sm' : '', opts.block ? 'is-block' : '', opts.cls || ''].filter(Boolean).join(' ');
  return '<span class="' + cls + '" data-component="Button">' + (opts.iconName ? icon(opts.iconName, opts.sm ? 13 : 15) : '') + '<span ' + A(vi, en) + '>' + esc(vi) + '</span>' + (opts.caret ? icon('chevron-down', 13) : '') + '</span>';
};

export const uiIconBtn = (iconName, vi, en, opts = {}) =>
  '<span class="ui-icon-btn ' + (opts.cls || '') + '" role="img" aria-label="' + esc(vi) + '" data-vi-aria="' + esc(vi) + '" data-en-aria="' + esc(en) + '" data-component="IconButton">' + icon(iconName, opts.size || 16) + '</span>';

export const uiInput = (vi, en, opts = {}) =>
  '<span class="ui-input ' + (opts.cls || '') + '">' + (opts.iconName ? icon(opts.iconName, 15) : '') + '<span class="ui-input-fake' + (opts.value ? '' : ' is-placeholder') + '" ' + (opts.value ? '' : A(vi, en)) + '>' + esc(opts.value || vi) + '</span></span>';

export const uiSelect = (vi, en, opts = {}) =>
  '<span class="ui-select ' + (opts.cls || '') + '">' + (opts.iconName ? icon(opts.iconName, 14) : '') + '<span ' + A(vi, en) + '>' + esc(vi) + '</span>' + icon('chevron-down', 13) + '</span>';

export const uiChip = (vi, en, opts = {}) =>
  '<span class="ui-chip ' + (opts.tone || '') + '">' + (opts.iconName ? icon(opts.iconName, 12) : '') + '<span ' + A(vi, en) + '>' + esc(vi) + '</span>' + (opts.removable ? icon('x', 11) : '') + '</span>';

export const uiCheck = (vi, en, opts = {}) =>
  '<span class="ui-check' + (opts.disabled ? ' is-disabled' : '') + '"><span class="ui-box' + (opts.checked ? ' is-on' : '') + '">' + (opts.checked ? icon('check', 12) : '') + '</span><span class="ui-check-text"><span class="ui-check-label" ' + A(vi, en) + '>' + esc(vi) + '</span>' + (opts.descVi ? '<span class="ui-check-desc" ' + A(opts.descVi, opts.descEn) + '>' + esc(opts.descVi) + '</span>' : '') + '</span></span>';

export const uiToggle = (vi, en, opts = {}) =>
  '<span class="ui-toggle-row' + (opts.disabled ? ' is-disabled' : '') + '"><span class="ui-toggle' + (opts.checked ? ' is-on' : '') + '" aria-hidden="true"><i></i></span><span class="ui-toggle-label"><span ' + A(vi, en) + '>' + esc(vi) + '</span>' + (opts.descVi ? '<span class="ui-check-desc" ' + A(opts.descVi, opts.descEn) + '>' + esc(opts.descVi) + '</span>' : '') + '</span></span>';

export const uiTabs = (tabs) =>
  '<div class="ui-tabs" role="tablist">' + tabs.map((tab) => '<span class="ui-tab' + (tab.active ? ' is-active' : '') + '" role="tab" aria-selected="' + (!!tab.active) + '"><span ' + A(tab.vi, tab.en) + '>' + esc(tab.vi) + '</span>' + (tab.count != null ? '<span class="ui-tab-count">' + tab.count + '</span>' : '') + '</span>').join('') + '</div>';

export const uiBanner = (vi, en, opts = {}) =>
  '<div class="ui-banner is-' + (opts.kind || 'info') + '">' + icon(opts.iconName || 'info', 16) + '<div class="ui-banner-body"><span class="ui-banner-title" ' + A(vi, en) + '>' + esc(vi) + '</span>' + (opts.bodyVi ? '<span class="ui-banner-text" ' + A(opts.bodyVi, opts.bodyEn) + '>' + esc(opts.bodyVi) + '</span>' : '') + '</div>' + (opts.action ? '<span class="ui-banner-action">' + opts.action + '</span>' : '') + '</div>';

export const uiEmpty = (opts) =>
  '<div class="ui-empty" data-component="EmptyState"><span class="ui-empty-icon">' + icon(opts.iconName || 'board', 22) + '</span><span class="ui-empty-title" ' + A(opts.titleVi, opts.titleEn) + '>' + esc(opts.titleVi) + '</span><span class="ui-empty-body" ' + A(opts.bodyVi, opts.bodyEn) + '>' + esc(opts.bodyVi) + '</span>' + (opts.action || '') + '</div>';

export const uiErrorPanel = (opts) =>
  '<div class="ui-state-panel" data-component="ErrorState"><span class="ui-state-icon">' + icon(opts.iconName || 'alert-circle', 22) + '</span><span class="ui-state-title" ' + A(opts.titleVi, opts.titleEn) + '>' + esc(opts.titleVi) + '</span><span class="ui-state-body" ' + A(opts.bodyVi, opts.bodyEn) + '>' + esc(opts.bodyVi) + '</span>' + (opts.meta ? '<span class="ui-state-meta">' + opts.meta + '</span>' : '') + '<span class="ui-state-actions">' + (opts.actions || uiBtn('Thử lại', 'Try again', { variant: 'primary', iconName: 'refresh' })) + '</span></div>';

export const uiField = (opts) =>
  '<label class="ui-field' + (opts.error ? ' has-error' : '') + '"><span class="ui-field-label"><span ' + A(opts.labelVi, opts.labelEn || opts.labelVi) + '>' + esc(opts.labelVi) + '</span>' + (opts.required ? '<span class="ui-req">*</span>' : '') + '</span>' + (opts.control || '') + (opts.hintVi ? '<span class="ui-field-hint" ' + A(opts.hintVi, opts.hintEn) + '>' + esc(opts.hintVi) + '</span>' : '') + (opts.errorVi ? '<span class="ui-field-error">' + icon('alert-circle', 13) + '<span ' + A(opts.errorVi, opts.errorEn) + '>' + esc(opts.errorVi) + '</span></span>' : '') + '</label>';

export const uiModal = (opts) =>
  '<div class="ui-scrim"><div class="ui-modal" style="--w:' + (opts.width || 460) + 'px" data-component="Modal"><div class="ui-modal-head"><span class="ui-modal-title" ' + A(opts.titleVi, opts.titleEn) + '>' + esc(opts.titleVi) + '</span>' + uiIconBtn('x', 'Đóng', 'Close') + '</div><div class="ui-modal-body">' + opts.body + '</div><div class="ui-modal-foot">' + (opts.actions || '') + '</div></div></div>';

export const uiToast = (opts) =>
  '<div class="ui-toast" data-component="UndoToast"><div class="ui-toast-top">' + icon(opts.iconName || 'check', 15) + '<span class="ui-toast-msg" ' + A(opts.vi, opts.en) + '>' + esc(opts.vi) + '</span><span class="ui-toast-action" ' + A(opts.actionVi || 'Hoàn tác', opts.actionEn || 'Undo') + '>' + esc(opts.actionVi || 'Hoàn tác') + '</span>' + uiIconBtn('x', 'Đóng', 'Close', { size: 14 }) + '</div><span class="ui-toast-timer" aria-hidden="true"><i></i></span></div>';

export const uiBar = (w) => '<span class="ui-bar" style="width:' + w + '%"></span>';

export const uiSkeleton = (w, h = 12) => '<span class="ui-skeleton" style="width:' + w + '%;height:' + h + 'px"></span>';

export const navGroups = {
  main: [
    { key: 'boards', icon: 'grid', vi: 'Board', en: 'Boards' },
    { key: 'mytasks', icon: 'check-square', vi: 'Task của tôi', en: 'My tasks' },
    { key: 'members', icon: 'users', vi: 'Thành viên', en: 'Members' },
    { key: 'profile', icon: 'user', vi: 'Hồ sơ', en: 'Profile' }
  ],
  admin: [
    { key: 'admin-members', icon: 'users', vi: 'Quản trị thành viên', en: 'Member admin' },
    { key: 'permissions', icon: 'key', vi: 'Phân quyền', en: 'Permissions' },
    { key: 'departments', icon: 'building', vi: 'Ban', en: 'Departments' },
    { key: 'reminders', icon: 'bell', vi: 'Nhắc deadline', en: 'Reminders' },
    { key: 'audit', icon: 'list', vi: 'Nhật ký', en: 'Audit log' }
  ]
};

const navLink = (item, active) =>
  '<span class="ui-nav-item' + (item.key === active ? ' is-active' : '') + '">' + icon(item.icon, 16) + '<span ' + A(item.vi, item.en) + '>' + esc(item.vi) + '</span>' + '</span>';

export const sideNav = (userKey, active) => {
  const user = person(userKey);
  const admin = !!user.admin;
  return '<aside class="ui-side" data-component="AppSidebar"><div class="ui-brand"><span class="ui-logo" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="ui-brand-text"><b>BEAM</b><span ' + A('CLB nội bộ', 'Club workspace') + '>CLB nội bộ</span></span></div>' +
    '<div class="ui-side-label" ' + A('Không gian làm việc', 'Workspace') + '>Không gian làm việc</div>' +
    '<nav class="ui-nav">' + navGroups.main.map((item) => navLink(item, active)).join('') + '</nav>' +
    (admin ? '<div class="ui-side-label has-rule" ' + A('Quản trị', 'Admin') + '>Quản trị</div><nav class="ui-nav">' + navGroups.admin.map((item) => navLink(item, active)).join('') + '</nav>' : '') +
    '<div class="ui-side-foot"><span class="ui-lang"><span ' + A('Ngôn ngữ', 'Language') + '>Ngôn ngữ</span><b>VI</b><span class="ui-lang-sep">/</span><span>EN</span></span>' +
    '<div class="ui-user">' + avatar(userKey, 28) + '<span class="ui-user-text"><span class="ui-user-name">' + esc(user.name) + '</span><span class="ui-user-role">' + esc(user.roleVi) + '</span></span>' + uiIconBtn('logout', 'Đăng xuất', 'Sign out', { size: 15 }) + '</div></div></aside>';
};

export const mobileTop = (opts = {}) =>
  '<div class="ui-mtop">' + (opts.back ? '<span class="ui-mtop-back">' + icon('arrow-left', 18) + '</span>' : '') +
  '<div class="ui-mtop-title">' + (opts.kickerVi ? '<span class="ui-mtop-kicker" ' + A(opts.kickerVi, opts.kickerEn || opts.kickerVi) + '>' + esc(opts.kickerVi) + '</span>' : '') + '<span class="ui-mtop-name" ' + A(opts.titleVi, opts.titleEn) + '>' + esc(opts.titleVi) + '</span></div>' +
  '<div class="ui-mtop-actions">' + (opts.search ? uiIconBtn('search', 'Tìm kiếm', 'Search', { size: 17 }) : '') + (opts.filter ? uiIconBtn('filter', 'Bộ lọc', 'Filters', { size: 17 }) : '') + (opts.menu ? uiIconBtn('list', 'Menu', 'Menu', { size: 17 }) : '') + '<span class="ui-lang-mini" aria-label="Ngôn ngữ">' + icon('globe', 15) + '<b>VI</b></span></div></div>';

export const mobileTabs = (active) =>
  '<nav class="ui-mtabs" data-component="MobileTabBar">' + navGroups.main.map((item) => '<span class="ui-mtab' + (item.key === active ? ' is-active' : '') + '">' + icon(item.icon, 19) + '<span ' + A(item.vi, item.en) + '>' + esc(item.vi) + '</span></span>').join('') + '</nav>';

export const appDesktop = (userKey, active, main) =>
  '<div class="ui ui-desktop" data-component="AppShell"><div class="ui-app">' + sideNav(userKey, active) + '<div class="ui-main">' + main + '</div></div></div>';

export const appMobile = (opts) =>
  '<div class="ui ui-mobile" data-component="AppShell"><div class="ui-mapp">' + mobileTop(opts) + '<div class="ui-mcontent">' + opts.content + '</div>' + (opts.tabs === false ? '' : mobileTabs(opts.active)) + '</div></div>';

export const pageHead = (opts) =>
  '<div class="ui-pagehead"><div class="ui-pagehead-text"><h1 class="ui-h1" ' + A(opts.titleVi, opts.titleEn) + '>' + esc(opts.titleVi) + '</h1>' + (opts.subVi ? '<span class="ui-sub" ' + A(opts.subVi, opts.subEn) + '>' + esc(opts.subVi) + '</span>' : '') + '</div><div class="ui-pagehead-actions">' + (opts.actions || '') + '</div></div>';

export const taskCard = (task, opts = {}) =>
  '<div class="ui-card' + (task.hidden ? ' is-hidden' : '') + '" data-component="TaskCard">' +
  '<div class="ui-card-top"><span class="ui-card-title">' + esc(task.title) + '</span>' + (task.hidden ? '<span class="ui-hidden-mark" title="Task ẩn" aria-label="Task ẩn">' + icon('eye-off', 13) + '</span>' : '') + (opts.menu ? uiIconBtn('more', 'Thêm thao tác', 'More actions', { size: 15 }) : '') + '</div>' +
  '<div class="ui-card-meta"><span class="ui-card-badges">' + priorityBadge(task.priority) + dueBadge(task.due) + '</span><span class="ui-card-right">' + (task.comments ? '<span class="ui-card-comments">' + icon('message', 13) + task.comments + '</span>' : '') + avatarStack(task.assignees) + '</span></div>' +
  '</div>';

export const columnBlock = (column, taskList, opts = {}) =>
  '<section class="ui-col" data-component="BoardColumn"><header class="ui-col-head"><span class="ui-col-name" ' + A(column.nameVi, column.nameEn) + '>' + esc(column.nameVi) + '</span><span class="ui-col-count">' + taskList.length + '</span>' + (opts.menu ? uiIconBtn('more', 'Thao tác cột', 'Column actions', { size: 15 }) : '') + '</header><div class="ui-col-body">' + taskList.map((task) => taskCard(task, { menu: opts.cardMenu })).join('') + '</div>' + (opts.add ? '<span class="ui-col-add">' + icon('plus', 14) + '<span ' + A('Thêm task', 'Add task') + '>Thêm task</span></span>' : '') + '</section>';

export const specPin = (n) => '<span class="pin" aria-hidden="true">' + n + '</span>';

export const dl = (rows) => '<dl class="meta-list">' + rows.map((row) => '<div><dt>' + row[0] + '</dt><dd>' + row[1] + '</dd></div>').join('') + '</dl>';

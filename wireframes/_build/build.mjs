import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { esc } from './lib.mjs';
import { screens } from './screens/index.mjs';
import { renderIndex } from './index-page.mjs';
import { renderComponents } from './components.mjs';

const OUT = new URL('../', import.meta.url).pathname;
const TODAY = '23.11.2026';

const rail = [
  { group: 'Bắt đầu', links: [
    { code: '00', titleVi: 'Tổng quan', href: 'index.html', slug: 'index' },
    { code: 'CMP', titleVi: 'Thư viện thành phần', href: 'components.html', slug: 'components' }
  ] },
  { group: 'Màn hình', links: [
    { code: 'S01', titleVi: 'Đăng nhập', href: 's01-login.html', slug: 's01-login' }
  ] },
  { group: 'Không gian làm việc', links: [
    { code: 'S03', titleVi: 'Danh sách board', href: 's03-boards.html', slug: 's03-boards' },
    { code: 'S04', titleVi: 'Bảng Kanban', href: 's04-board.html', slug: 's04-board' },
    { code: 'S05', titleVi: 'Chi tiết task', href: 's05-task.html', slug: 's05-task' },
    { code: 'S06', titleVi: 'Task của tôi', href: 's06-my-tasks.html', slug: 's06-my-tasks' }
  ] },
  { group: 'Con người & quyền', links: [
    { code: 'S07', titleVi: 'Thành viên', href: 's07-members.html', slug: 's07-members' },
    { code: 'S08', titleVi: 'Hồ sơ cá nhân', href: 's08-profile.html', slug: 's08-profile' },
    { code: 'S09', titleVi: 'Quản trị thành viên', href: 's09-member-admin.html', slug: 's09-member-admin' },
    { code: 'S10', titleVi: 'Phân quyền', href: 's10-permissions.html', slug: 's10-permissions' },
    { code: 'S11', titleVi: 'Quản trị ban', href: 's11-departments.html', slug: 's11-departments' }
  ] },
  { group: 'Hệ thống', links: [
    { code: 'S12', titleVi: 'Nhắc deadline', href: 's12-reminders.html', slug: 's12-reminders' },
    { code: 'S13', titleVi: 'Nhật ký quản trị', href: 's13-audit.html', slug: 's13-audit' },
    { code: 'S14', titleVi: 'Lỗi & trạng thái', href: 's14-errors.html', slug: 's14-errors' },
    { code: 'S15', titleVi: 'Thùng rác', href: 's15-trash.html', slug: 's15-trash' }
  ] },
  { group: 'Phụ lục', links: [
    { code: 'E01', titleVi: 'Email nhắc deadline', href: 'e01-reminder-email.html', slug: 'e01-reminder-email' }
  ] }
];

const railHtml = (current) => rail.map((group) =>
  '<div class="rail-group">' + group.group + '</div>' +
  group.links.map((link) =>
    '<a class="rail-link" href="' + link.href + '"' + (link.slug === current ? ' aria-current="page"' : '') + '>' +
    '<span class="rail-code">' + link.code + '</span><span>' + link.titleVi + '</span></a>'
  ).join('')
).join('');

const shell = (opts) => '<!doctype html>\n<html lang="vi">\n<head>\n' +
  '<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
  '<title>' + esc(opts.title) + ' — Bộ wireframe CLB BEAM</title>\n' +
  '<meta name="description" content="' + esc(opts.description || 'Wireframe low-fidelity cho website quản lý thành viên và giao task của CLB.') + '">\n' +
  '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
  '<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">\n' +
  '<link rel="stylesheet" href="assets/wireframe.css">\n' +
  '</head>\n<body>\n' +
  '<a class="skip" href="#main">Bỏ qua điều hướng</a>\n' +
  '<div class="doc">\n' +
  '<aside class="rail" aria-label="Danh sách màn hình">\n' +
  '<div class="rail-head"><div class="rail-brand"><span class="rail-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span><div><b>Bộ wireframe</b><span>CLB BEAM · quản lý &amp; giao task</span></div></div>' +
  '<div class="rail-version">v1.0 · ' + TODAY + '<br>Nguồn: WIREFRAME-BRIEF v1.2<br>Handoff v1.3 · AGENTS v1.3</div></div>\n' +
  '<nav class="rail-nav">' + railHtml(opts.current) + '</nav>\n' +
  '<div class="rail-foot"><a href="README.md">Cách đọc bộ wireframe</a><a href="OPEN-QUESTIONS.md">Câu hỏi mở &amp; giả định</a><span class="rail-note">S02 đã bỏ: hết phiên quay về S01, không nhập lại MSSV giữa trang.</span></div>\n' +
  '</aside>\n' +
  '<div class="main-wrap">\n' +
  '<header class="topbar"><div class="crumb"><span>Bộ wireframe</span><span class="sep">/</span><b>' + esc(opts.crumb) + '</b></div>' +
  '<div class="top-actions"><span class="top-note">Công tắc đổi chuỗi bên trong giao diện</span>' +
  '<div class="lang-switch" role="group" aria-label="Ngôn ngữ giao diện"><button type="button" data-lang-btn="vi" aria-pressed="true">VI</button><button type="button" data-lang-btn="en" aria-pressed="false">EN</button></div>' +
  '<button class="print-btn" type="button" data-print>In trang</button></div></header>\n' +
  '<main id="main" class="screen">' + opts.content + '</main>\n' +
  '</div>\n</div>\n<script src="assets/wireframe.js"></script>\n</body>\n</html>\n';

const dim = (width) => '<div class="dim" style="max-width:' + width + 'px;width:100%"><span class="dim-tick l"></span><span class="dim-line"></span><span class="dim-tick r"></span><span class="dim-text">' + width + ' px</span></div>';

const frame = (item) => {
  const isDesktop = item.kind === 'desktop';
  const width = isDesktop ? 1280 : 390;
  const height = isDesktop ? 820 : 812;
  return '<figure class="frame-block" data-frame>' +
    '<figcaption class="frame-cap"><div class="frame-label"><span class="frame-kind">' + (isDesktop ? 'Desktop' : 'Mobile') + '</span><span class="frame-size">' + width + ' × ' + height + ' px</span><span class="frame-context">' + (item.context || '') + '</span></div>' +
    '<div class="frame-cap-right"><span data-scale-readout>—</span><button class="zoom-btn" type="button" data-zoom aria-pressed="false"><span class="label-fit">Xem 1:1</span><span class="label-actual">Vừa khung</span></button></div></figcaption>' +
    dim(width) +
    '<div class="frame-viewport" data-viewport style="--frame-h:' + height + 'px">' +
    '<div class="device device--' + item.kind + '" data-device data-w="' + width + '" data-h="' + height + '">' + item.html + '</div>' +
    '</div></figure>';
};

const stateCard = (state) => {
  const cls = ['state-card', state.wide ? 'is-wide' : ''].filter(Boolean).join(' ');
  const stage = ['state-stage', state.phone ? 'is-phone' : '', state.plain ? 'is-plain' : ''].filter(Boolean).join(' ');
  return '<article class="' + cls + '"><div class="state-head"><h3>' + state.title + '</h3><p>' + (state.note || '') + '</p></div>' +
    '<div class="' + stage + '"><div class="ui-fragment"' + (state.height ? ' style="height:' + state.height + 'px"' : '') + '>' + state.html + '</div></div></article>';
};

const fact = (label, value) => '<span class="fact"><b>' + label + '</b>' + value + '</span>';

const stringsTable = (strings) => '<table class="string-table"><thead><tr><th>Tiếng Việt</th><th>English</th></tr></thead><tbody>' +
  strings.map((row) => '<tr><td>' + row[0] + '</td><td>' + esc(row[1]) + '</td></tr>').join('') + '</tbody></table>';

function renderScreen(screen) {
  const index = screens.findIndex((item) => item.slug === screen.slug);
  const previous = screens[index - 1];
  const next = screens[index + 1];
  const frames = screen.frames.map(frame).join('');
  const states = screen.states && screen.states.length
    ? '<section class="section" id="states"><div class="section-head"><h2>Trạng thái</h2><span class="sec-note">' + screen.states.length + ' trạng thái · hiển thị thành phần, không phải màn hình riêng</span></div><div class="state-grid">' + screen.states.map(stateCard).join('') + '</div></section>'
    : '';
  const pins = screen.pins && screen.pins.length
    ? '<section class="section" id="notes"><div class="section-head"><h2>Ghi chú thiết kế</h2><span class="sec-note">Số trong khung ứng với danh sách bên cạnh</span></div><div class="notes"><ol class="pin-list">' + screen.pins.map((item) => '<li>' + item + '</li>').join('') + '</ol><div class="notes-side">' +
      '<div class="note-card"><h3>QUYỀN &amp; ĐIỀU KIỆN</h3><ul class="plain">' + (screen.permissions || []).map((item) => '<li>' + item + '</li>').join('') + '</ul></div>' +
      (screen.related ? '<div class="note-card"><h3>LIÊN KẾT</h3><ul class="plain">' + screen.related.map((item) => '<li><a href="' + item[1] + '">' + item[0] + '</a></li>').join('') + '</ul></div>' : '') +
      (screen.questions && screen.questions.length ? '<div class="note-card"><h3>CÂU HỎI MỞ</h3><ul class="plain">' + screen.questions.map((item) => '<li><a href="OPEN-QUESTIONS.md#' + item[0].toLowerCase() + '">' + item[0] + '</a> — ' + item[1] + '</li>').join('') + '</ul></div>' : '') +
      (screen.strings ? '<div class="note-card"><h3>CHUỖI CHÍNH · VI / EN</h3>' + stringsTable(screen.strings) + '</div>' : '') +
      '</div></div></section>'
    : '';

  const pager = '<nav class="pager" aria-label="Màn hình trước và sau">' +
    (previous ? '<a href="' + previous.slug + '.html"><span class="pager-code">← ' + previous.code + '</span><span class="pager-title">' + previous.titleVi + '</span></a>' : '<span></span>') +
    (next ? '<a class="next" href="' + next.slug + '.html"><span class="pager-code">' + next.code + ' →</span><span class="pager-title">' + next.titleVi + '</span></a>' : '<span></span>') +
    '</nav>';

  return pageShell({
    title: screen.code + ' · ' + screen.titleVi,
    current: screen.slug,
    crumb: screen.code + ' · ' + screen.titleVi,
    content:
      '<header class="screen-head"><div>' +
      '<div class="kicker"><span class="code">' + screen.code + '</span><span class="dot"></span><span>' + screen.group + '</span><span class="dot"></span><span>' + (index + 1) + ' / ' + screens.length + '</span></div>' +
      '<h1>' + screen.titleVi + '<span class="h1-en">' + screen.titleEn + '</span></h1>' +
      '<p class="purpose">' + screen.purpose + '</p>' +
      '<div class="fact-row">' + fact('Ai thấy', screen.who) + fact('FR', screen.frs.join(' · ')) + (screen.acs.length ? fact('AC', screen.acs.join(' · ')) : '') + fact('Thiết bị', screen.frames.map((f) => f.kind === 'desktop' ? '1280' : '390').join(' / ') + ' px') + '</div>' +
      '</div><aside class="head-meta"><dl>' +
      '<div><dt>Người dùng trong khung</dt><dd>' + (screen.persona || '—') + '</dd></div>' +
      '<div><dt>Quyền chính</dt><dd>' + (screen.permLine || '—') + '</dd></div>' +
      '<div><dt>Trạng thái</dt><dd>' + ((screen.states && screen.states.length) || 0) + ' trạng thái</dd></div>' +
      '<div><dt>Quy ước</dt><dd>Low-fi · thang xám · chỉ priority và hạn dùng màu</dd></div>' +
      '</dl></aside></header>' +
      '<section class="section" id="layout"><div class="section-head"><h2>Bố cục</h2><span class="sec-note">Bấm “Xem 1:1” để soi kích thước thật; khung tự thu nhỏ theo bề rộng trang</span></div>' + frames + '</section>' +
      states + pins + pager
  });
}

function pageShell(opts) {
  return shell({ ...opts });
}

/* Some text labels were authored as bare attribute runs; lift them into a real
   span so the language switch can reach them. */
const repairLabels = (html) =>
  html.replace(/>([^<>]*)data-vi="([^"]*)" data-en="([^"]*)">([^<]*)</g,
    (m, prefix, vi, en, text) => '>' + prefix + '<span data-vi="' + vi + '" data-en="' + en + '">' + text + '</span>').replace(/<\/span>>/g, '</span>');

async function main() {
  for (const screen of screens) {
    const html = repairLabels(renderScreen(screen));
    await writeFile(join(OUT, screen.slug + '.html'), html, 'utf8');
    console.log('wrote', screen.slug + '.html');
  }
  await writeFile(join(OUT, 'index.html'), repairLabels(renderIndex(screens, { shell, rail })), 'utf8');
  console.log('wrote index.html');
  await writeFile(join(OUT, 'components.html'), repairLabels(renderComponents({ shell })), 'utf8');
  console.log('wrote components.html');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

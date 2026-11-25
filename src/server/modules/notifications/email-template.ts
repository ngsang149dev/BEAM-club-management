export interface BuildDepartmentEmailParams {
  readonly locale: 'vi' | 'en';
  readonly recipientName: string;
  readonly actorName: string;
  readonly boardName: string;
  readonly departmentNames: readonly string[];
  readonly taskTitle: string | null;
  readonly isHiddenTask: boolean;
  readonly appUrl: string;
  readonly boardId: string;
  readonly taskId: string;
}

export interface RenderedNotificationEmail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildTaskLink(appUrl: string, boardId: string, taskId: string): string {
  const base = appUrl.replace(/\/+$/, '');
  return `${base}/boards/${boardId}?task=${taskId}`;
}

function buildVietnameseEmail(
  params: BuildDepartmentEmailParams,
  deptLabel: string,
  taskUrl: string,
): RenderedNotificationEmail {
  const subject = params.isHiddenTask
    ? `[BEAM] Công việc ẩn mới được giao cho ${deptLabel}`
    : `[BEAM] Công việc mới cho ${deptLabel}: ${params.taskTitle ?? ''}`;

  const taskLine = params.isHiddenTask
    ? 'Công việc: (Công việc ẩn — vui lòng đăng nhập để xem chi tiết)'
    : `Công việc: ${params.taskTitle ?? ''}`;

  const text = [
    `Xin chào ${params.recipientName},`,
    '',
    `${params.actorName} đã giao một công việc cho ban ${deptLabel}.`,
    `Bảng: ${params.boardName}`,
    taskLine,
    `Xem tại: ${taskUrl}`,
  ].join('\n');

  const htmlTaskLine = params.isHiddenTask
    ? '<em>(Công việc ẩn — vui lòng đăng nhập để xem chi tiết)</em>'
    : `<strong>${escapeHtml(params.taskTitle ?? '')}</strong>`;

  const html = [
    `<p>Xin chào ${escapeHtml(params.recipientName)},</p>`,
    `<p><strong>${escapeHtml(params.actorName)}</strong> đã giao một công việc cho ban <strong>${escapeHtml(deptLabel)}</strong>.</p>`,
    `<ul>`,
    `<li>Bảng: ${escapeHtml(params.boardName)}</li>`,
    `<li>Công việc: ${htmlTaskLine}</li>`,
    `</ul>`,
    `<p><a href="${escapeHtml(taskUrl)}">Mở bảng công việc</a></p>`,
  ].join('\n');

  return { subject, text, html };
}

function buildEnglishEmail(
  params: BuildDepartmentEmailParams,
  deptLabel: string,
  taskUrl: string,
): RenderedNotificationEmail {
  const subject = params.isHiddenTask
    ? `[BEAM] New hidden task assigned to ${deptLabel}`
    : `[BEAM] New task for ${deptLabel}: ${params.taskTitle ?? ''}`;

  const taskLine = params.isHiddenTask
    ? 'Task: (Hidden task — please sign in to view details)'
    : `Task: ${params.taskTitle ?? ''}`;

  const text = [
    `Hello ${params.recipientName},`,
    '',
    `${params.actorName} assigned a task to department ${deptLabel}.`,
    `Board: ${params.boardName}`,
    taskLine,
    `Open: ${taskUrl}`,
  ].join('\n');

  const htmlTaskLine = params.isHiddenTask
    ? '<em>(Hidden task — please sign in to view details)</em>'
    : `<strong>${escapeHtml(params.taskTitle ?? '')}</strong>`;

  const html = [
    `<p>Hello ${escapeHtml(params.recipientName)},</p>`,
    `<p><strong>${escapeHtml(params.actorName)}</strong> assigned a task to department <strong>${escapeHtml(deptLabel)}</strong>.</p>`,
    `<ul>`,
    `<li>Board: ${escapeHtml(params.boardName)}</li>`,
    `<li>Task: ${htmlTaskLine}</li>`,
    `</ul>`,
    `<p><a href="${escapeHtml(taskUrl)}">Open board</a></p>`,
  ].join('\n');

  return { subject, text, html };
}

export function buildDepartmentAssignedEmail(
  params: BuildDepartmentEmailParams,
): RenderedNotificationEmail {
  const safeParams: BuildDepartmentEmailParams = params.isHiddenTask
    ? { ...params, taskTitle: null }
    : params;
  const deptLabel =
    safeParams.departmentNames.length > 0
      ? safeParams.departmentNames.join(', ')
      : 'BEAM';
  const taskUrl = buildTaskLink(
    safeParams.appUrl,
    safeParams.boardId,
    safeParams.taskId,
  );
  if (safeParams.locale === 'en') {
    return buildEnglishEmail(safeParams, deptLabel, taskUrl);
  }
  return buildVietnameseEmail(safeParams, deptLabel, taskUrl);
}

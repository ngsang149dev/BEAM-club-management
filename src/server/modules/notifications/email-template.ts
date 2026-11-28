import {
  computeEmailDeadlinePill,
  type EmailDetailRow,
  type EmailLocale,
  escapeHtml,
  formatEmailVnDateTime,
  renderBeamEmailHtml,
  truncateEmailExcerpt,
} from '@/server/shared/email-layout';

export interface BuildDepartmentEmailParams {
  readonly locale: EmailLocale;
  readonly recipientName: string;
  readonly actorName: string;
  readonly boardName: string;
  readonly departmentNames: readonly string[];
  readonly taskTitle: string | null;
  readonly taskDescription?: string | null;
  readonly startAt?: Date | null;
  readonly dueAt?: Date | null;
  readonly now?: Date;
  readonly isHiddenTask: boolean;
  readonly appUrl: string;
  readonly boardId?: string;
  readonly taskId: string;
}

export interface RenderedNotificationEmail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

interface DeptLocaleCopy {
  readonly greeting: (name: string) => string;
  readonly bannerPublic: string;
  readonly bannerHidden: string;
  readonly hiddenPlaceholder: string;
  readonly visibilityValue: string;
  readonly ctaPublic: string;
  readonly ctaHidden: string;
  readonly openLabel: string;
  readonly labels: {
    readonly taskTitle: string;
    readonly board: string;
    readonly scope: string;
    readonly description: string;
    readonly assignedBy: string;
    readonly startAt: string;
    readonly urgency: string;
    readonly deadline: string;
    readonly visibility: string;
    readonly textTask: string;
  };
}

const DEPT_COPY: Record<EmailLocale, DeptLocaleCopy> = {
  vi: {
    greeting: (name) => `Xin chào ${name},`,
    bannerPublic: 'BEAM CLUB — GIAO CÔNG VIỆC MỚI',
    bannerHidden: 'BEAM CLUB — CÔNG VIỆC NỘI BỘ (ẨN)',
    hiddenPlaceholder: '(Công việc ẩn — vui lòng đăng nhập để xem chi tiết)',
    visibilityValue: 'Người tạo, người được giao & Admin',
    ctaPublic: 'Mở công việc trên BEAM',
    ctaHidden: 'Đăng nhập xem chi tiết',
    openLabel: 'Xem tại',
    labels: {
      taskTitle: 'Tên công việc:',
      board: 'Bảng:',
      scope: 'Phạm vi giao:',
      description: 'Mô tả chi tiết:',
      assignedBy: 'Người giao việc:',
      startAt: 'Bắt đầu:',
      urgency: 'Tình trạng hạn:',
      deadline: 'Deadline:',
      visibility: 'Quyền truy cập:',
      textTask: 'Công việc:',
    },
  },
  en: {
    greeting: (name) => `Hello ${name},`,
    bannerPublic: 'BEAM CLUB — NEW TASK ASSIGNED',
    bannerHidden: 'BEAM CLUB — CONFIDENTIAL TASK',
    hiddenPlaceholder: '(Hidden task — please sign in to view details)',
    visibilityValue: 'Creator, assignees & Admins only',
    ctaPublic: 'Open Task in BEAM',
    ctaHidden: 'Sign in to view task',
    openLabel: 'Open',
    labels: {
      taskTitle: 'Task title:',
      board: 'Board:',
      scope: 'Assigned scope:',
      description: 'Description:',
      assignedBy: 'Assigned by:',
      startAt: 'Start time:',
      urgency: 'Urgency:',
      deadline: 'Deadline:',
      visibility: 'Visibility:',
      textTask: 'Task:',
    },
  },
};

function sanitizeHiddenDepartmentParams(
  params: BuildDepartmentEmailParams,
): BuildDepartmentEmailParams {
  if (!params.isHiddenTask) return params;
  return { ...params, taskTitle: null, taskDescription: null, startAt: null, dueAt: null };
}

function buildTaskLink(appUrl: string, taskId: string): string {
  return `${appUrl.replace(/\/+$/, '')}/tasks?task=${taskId}`;
}

function buildDepartmentSubject(params: BuildDepartmentEmailParams, deptLabel: string | null): string {
  const safeTitle = params.taskTitle ?? '';
  if (params.locale === 'en') {
    if (params.isHiddenTask) {
      return deptLabel ? `[BEAM] New hidden task assigned to ${deptLabel}` : '[BEAM] New hidden task assigned to you';
    }
    return deptLabel ? `[BEAM] New task for ${deptLabel}: ${safeTitle}` : `[BEAM] New task assigned to you: ${safeTitle}`;
  }
  if (params.isHiddenTask) {
    return deptLabel ? `[BEAM] Công việc ẩn mới được giao cho ${deptLabel}` : '[BEAM] Công việc ẩn mới được giao cho bạn';
  }
  return deptLabel ? `[BEAM] Công việc mới cho ${deptLabel}: ${safeTitle}` : `[BEAM] Công việc mới được giao cho bạn: ${safeTitle}`;
}

function buildDepartmentIntros(params: BuildDepartmentEmailParams, deptLabel: string | null) {
  const actorEscaped = escapeHtml(params.actorName);
  const deptEscaped = deptLabel ? escapeHtml(deptLabel) : null;
  if (params.locale === 'en') {
    const textIntro = deptLabel
      ? `${params.actorName} assigned a task to department ${deptLabel}.`
      : `${params.actorName} assigned a task to you.`;
    const targetHtml = deptEscaped ? `to department <strong>${deptEscaped}</strong>` : 'to you';
    const introHtml = params.isHiddenTask
      ? `<strong>${actorEscaped}</strong> assigned a <strong>confidential task</strong> ${targetHtml} on <strong>BEAM CLUB</strong>:`
      : `<strong>${actorEscaped}</strong> assigned a task ${targetHtml} on <strong>BEAM CLUB</strong>:`;
    return { textIntro, introHtml };
  }
  const textIntro = deptLabel
    ? `${params.actorName} đã giao một công việc cho ban ${deptLabel}.`
    : `${params.actorName} đã giao một công việc cho bạn.`;
  const targetHtml = deptEscaped ? `cho ban <strong>${deptEscaped}</strong>` : 'cho bạn';
  const introHtml = params.isHiddenTask
    ? `<strong>${actorEscaped}</strong> đã giao một <strong>công việc nội bộ ẩn</strong> ${targetHtml} trên <strong>BEAM CLUB</strong>:`
    : `<strong>${actorEscaped}</strong> đã giao một công việc ${targetHtml} trên <strong>BEAM CLUB</strong>:`;
  return { textIntro, introHtml };
}

function buildDepartmentRows(params: BuildDepartmentEmailParams, copy: DeptLocaleCopy): EmailDetailRow[] {
  const l = copy.labels;
  if (params.isHiddenTask) {
    return [
      { label: l.taskTitle, value: copy.hiddenPlaceholder, italic: true },
      { label: l.board, value: params.boardName },
      { label: l.assignedBy, value: params.actorName },
      { label: l.visibility, value: copy.visibilityValue, pill: 'neutral' },
    ];
  }
  const rows: EmailDetailRow[] = [
    { label: l.taskTitle, value: params.taskTitle ?? '', strong: true },
    { label: l.board, value: params.boardName },
  ];
  if (params.departmentNames.length > 0) rows.push({ label: l.scope, value: params.departmentNames.join(' · ') });
  const excerpt = truncateEmailExcerpt(params.taskDescription, 240);
  if (excerpt) rows.push({ label: l.description, value: excerpt });
  rows.push({ label: l.assignedBy, value: params.actorName });
  const startLabel = formatEmailVnDateTime(params.startAt, params.locale);
  if (startLabel) rows.push({ label: l.startAt, value: startLabel });
  const pill = computeEmailDeadlinePill({ dueAt: params.dueAt, now: params.now, locale: params.locale });
  if (pill) rows.push({ label: l.urgency, value: pill.label, pill: pill.tone });
  const dueLabel = formatEmailVnDateTime(params.dueAt, params.locale);
  if (dueLabel) rows.push({ label: l.deadline, value: dueLabel, highlight: true });
  return rows;
}

function buildDepartmentText(params: {
  readonly copy: DeptLocaleCopy;
  readonly safe: BuildDepartmentEmailParams;
  readonly textIntro: string;
  readonly rows: readonly EmailDetailRow[];
  readonly taskUrl: string;
}): string {
  const { copy, safe, textIntro, rows, taskUrl } = params;
  const boardRow = `${copy.labels.board} ${safe.boardName}`;
  const taskLine = safe.isHiddenTask
    ? `${copy.labels.textTask} ${copy.hiddenPlaceholder}`
    : `${copy.labels.textTask} ${safe.taskTitle ?? ''}`;
  const extraLines = rows
    .filter((row) => row.label !== copy.labels.taskTitle && row.label !== copy.labels.board)
    .map((row) => `${row.label} ${row.value}`);
  return [
    copy.greeting(safe.recipientName),
    '',
    textIntro,
    boardRow,
    taskLine,
    ...extraLines,
    `${copy.openLabel}: ${taskUrl}`,
  ].join('\n');
}

export function buildDepartmentAssignedEmail(
  params: BuildDepartmentEmailParams,
): RenderedNotificationEmail {
  const safe = sanitizeHiddenDepartmentParams(params);
  const copy = DEPT_COPY[safe.locale];
  const deptLabel = safe.departmentNames.length > 0 ? safe.departmentNames.join(', ') : null;
  const taskUrl = buildTaskLink(safe.appUrl, safe.taskId);
  const { textIntro, introHtml } = buildDepartmentIntros(safe, deptLabel);
  const rows = buildDepartmentRows(safe, copy);
  return {
    subject: buildDepartmentSubject(safe, deptLabel),
    text: buildDepartmentText({ copy, safe, textIntro, rows, taskUrl }),
    html: renderBeamEmailHtml({
      locale: safe.locale,
      bannerTitle: safe.isHiddenTask ? copy.bannerHidden : copy.bannerPublic,
      greeting: copy.greeting(safe.recipientName),
      introHtml,
      rows,
      ctaLabel: safe.isHiddenTask ? copy.ctaHidden : copy.ctaPublic,
      ctaUrl: taskUrl,
    }),
  };
}

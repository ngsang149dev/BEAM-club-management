import {
  type EmailDetailRow,
  type EmailLocale,
  escapeHtml,
  formatEmailVnDateTime,
  renderBeamEmailHtml,
} from '@/server/shared/email-layout';
import type { RenderedNotificationEmail } from './email-template';

export interface BuildLeadActivityEmailParams {
  readonly kind: 'task.accepted' | 'task.deliverable_submitted';
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
  readonly deliverableTitle?: string | null;
  readonly deliverableUrl?: string | null;
  readonly isHiddenTask: boolean;
  readonly appUrl: string;
  readonly boardId?: string;
  readonly taskId: string;
}

const LEAD_COPY_DICT = {
  vi: {
    greeting: (name: string) => `Xin chào ${name},`,
    boardLabel: 'Bảng',
    openLabel: 'Xem tại',
    taskLabel: 'Công việc',
    deliverableLabel: 'Sản phẩm',
    hiddenTaskNotice: '(Công việc ẩn — vui lòng đăng nhập để xem chi tiết)',
    visibilityLabel: 'Quyền truy cập:',
    visibilityValue: 'Người tạo, người được giao & Admin',
    taskTitleRow: 'Tên công việc:',
    boardRow: 'Bảng:',
    deptRow: 'Ban phụ trách:',
    acceptedByRow: 'Người xác nhận:',
    acceptedAtRow: 'Thời điểm nhận:',
    submittedByRow: 'Người nộp:',
    deliverableTitleRow: 'Tên sản phẩm:',
    deliverableLinkRow: 'Link bàn giao:',
    statusRow: 'Trạng thái hạn:',
    deadlineRow: 'Deadline:',
    submittedOnTime: (due: string) => `Nộp trước hạn (${due})`,
    submittedLate: (due: string) => `Nộp sau hạn (${due})`,
    'task.accepted': {
      banner: 'BEAM CLUB — ĐÃ NHẬN CÔNG VIỆC',
      cta: 'Mở công việc trên BEAM',
      hiddenSubject: (actor: string) => `[BEAM] ${actor} đã nhận một công việc ẩn`,
      visibleSubject: (actor: string, title: string) => `[BEAM] ${actor} đã nhận công việc: ${title}`,
      actionText: 'đã xác nhận đã nhận công việc',
    },
    'task.deliverable_submitted': {
      banner: 'BEAM CLUB — NỘP SẢN PHẨM BÀN GIAO',
      cta: 'Kiểm tra trên BEAM',
      hiddenSubject: (actor: string) => `[BEAM] ${actor} đã nộp sản phẩm cho một công việc ẩn`,
      visibleSubject: (actor: string, title: string) => `[BEAM] ${actor} đã nộp sản phẩm: ${title}`,
      actionText: 'đã nộp đường link sản phẩm cho công việc',
    },
  },
  en: {
    greeting: (name: string) => `Hello ${name},`,
    boardLabel: 'Board',
    openLabel: 'Open',
    taskLabel: 'Task',
    deliverableLabel: 'Deliverable',
    hiddenTaskNotice: '(Hidden task — please sign in to view details)',
    visibilityLabel: 'Visibility:',
    visibilityValue: 'Creator, assignees & Admins only',
    taskTitleRow: 'Task title:',
    boardRow: 'Board:',
    deptRow: 'Department:',
    acceptedByRow: 'Accepted by:',
    acceptedAtRow: 'Accepted at:',
    submittedByRow: 'Submitted by:',
    deliverableTitleRow: 'Deliverable:',
    deliverableLinkRow: 'Link:',
    statusRow: 'Status:',
    deadlineRow: 'Deadline:',
    submittedOnTime: (due: string) => `Submitted ahead of deadline (${due})`,
    submittedLate: (due: string) => `Submitted past deadline (${due})`,
    'task.accepted': {
      banner: 'BEAM CLUB — TASK ACCEPTED',
      cta: 'Open Task in BEAM',
      hiddenSubject: (actor: string) => `[BEAM] ${actor} accepted a hidden task`,
      visibleSubject: (actor: string, title: string) => `[BEAM] ${actor} accepted task: ${title}`,
      actionText: 'confirmed acceptance of a task',
    },
    'task.deliverable_submitted': {
      banner: 'BEAM CLUB — DELIVERABLE SUBMITTED',
      cta: 'Review on BEAM',
      hiddenSubject: (actor: string) => `[BEAM] ${actor} submitted a deliverable for a hidden task`,
      visibleSubject: (actor: string, title: string) => `[BEAM] ${actor} submitted a deliverable: ${title}`,
      actionText: 'submitted a deliverable link for a task',
    },
  },
} as const;

function sanitizeHiddenLeadParams(p: BuildLeadActivityEmailParams): BuildLeadActivityEmailParams {
  if (!p.isHiddenTask) return p;
  return {
    ...p,
    taskTitle: null,
    taskDescription: null,
    startAt: null,
    dueAt: null,
    deliverableTitle: null,
    deliverableUrl: null,
  };
}

function buildTaskLink(appUrl: string, taskId: string): string {
  return `${appUrl.replace(/\/+$/, '')}/tasks?task=${taskId}`;
}

function buildLeadHeaderRows(p: BuildLeadActivityEmailParams): EmailDetailRow[] {
  const t = LEAD_COPY_DICT[p.locale];
  const titleRow: EmailDetailRow = p.isHiddenTask
    ? { label: t.taskTitleRow, value: t.hiddenTaskNotice, italic: true }
    : { label: t.taskTitleRow, value: p.taskTitle ?? '', strong: true };
  return [titleRow, { label: t.boardRow, value: p.boardName }];
}

function buildAcceptedRows(p: BuildLeadActivityEmailParams): EmailDetailRow[] {
  const t = LEAD_COPY_DICT[p.locale];
  const rows = buildLeadHeaderRows(p);
  if (!p.isHiddenTask && p.departmentNames.length > 0) {
    rows.push({ label: t.deptRow, value: p.departmentNames.join(' · ') });
  }
  rows.push({ label: t.acceptedByRow, value: p.actorName });
  const acceptedAt = formatEmailVnDateTime(p.now, p.locale);
  if (acceptedAt) rows.push({ label: t.acceptedAtRow, value: acceptedAt });
  if (p.isHiddenTask) {
    rows.push({ label: t.visibilityLabel, value: t.visibilityValue, pill: 'neutral' });
    return rows;
  }
  const dueLabel = formatEmailVnDateTime(p.dueAt, p.locale);
  if (dueLabel) rows.push({ label: t.deadlineRow, value: dueLabel, highlight: true });
  return rows;
}

function appendDeliverableTimingRow(rows: EmailDetailRow[], p: BuildLeadActivityEmailParams): void {
  const t = LEAD_COPY_DICT[p.locale];
  const dueLabel = formatEmailVnDateTime(p.dueAt, p.locale);
  if (!dueLabel || !p.dueAt) return;
  if (!p.now) {
    rows.push({ label: t.deadlineRow, value: dueLabel, highlight: true });
    return;
  }
  const onTime = p.now.getTime() <= p.dueAt.getTime();
  rows.push({
    label: t.statusRow,
    value: onTime ? t.submittedOnTime(dueLabel) : t.submittedLate(dueLabel),
    pill: onTime ? 'ok' : 'urgent',
  });
}

function buildDeliverableRows(p: BuildLeadActivityEmailParams, deptLabel: string | null): EmailDetailRow[] {
  const t = LEAD_COPY_DICT[p.locale];
  const rows = buildLeadHeaderRows(p);
  const submitter = deptLabel ? `${p.actorName} (${deptLabel})` : p.actorName;
  rows.push({ label: t.submittedByRow, value: submitter });
  if (p.isHiddenTask) {
    rows.push({ label: t.visibilityLabel, value: t.visibilityValue, pill: 'neutral' });
    return rows;
  }
  if (p.deliverableTitle) rows.push({ label: t.deliverableTitleRow, value: p.deliverableTitle, strong: true });
  if (p.deliverableUrl) rows.push({ label: t.deliverableLinkRow, value: p.deliverableUrl, linkUrl: p.deliverableUrl });
  appendDeliverableTimingRow(rows, p);
  return rows;
}

function buildDeliverableTextLine(p: BuildLeadActivityEmailParams): string | null {
  if (p.kind !== 'task.deliverable_submitted' || p.isHiddenTask || !p.deliverableUrl) return null;
  const t = LEAD_COPY_DICT[p.locale];
  return `${t.deliverableLabel}: ${p.deliverableTitle ?? ''} — ${p.deliverableUrl}`;
}

function buildLeadText(params: {
  readonly safe: BuildLeadActivityEmailParams;
  readonly deptSuffix: string;
  readonly rows: readonly EmailDetailRow[];
  readonly taskUrl: string;
}): string {
  const { safe, deptSuffix, rows, taskUrl } = params;
  const t = LEAD_COPY_DICT[safe.locale];
  const kindT = t[safe.kind];
  const deliverableText = buildDeliverableTextLine(safe);
  const skipLabels = new Set<string>([
    t.taskTitleRow,
    t.boardRow,
    t.deliverableTitleRow,
    t.deliverableLinkRow,
  ]);
  const extraRows = rows
    .filter((row) => !skipLabels.has(row.label))
    .map((row) => `${row.label} ${row.value}`);
  return [
    t.greeting(safe.recipientName),
    '',
    `${safe.actorName} ${kindT.actionText}${deptSuffix}.`,
    `${t.boardLabel}: ${safe.boardName}`,
    `${t.taskLabel}: ${safe.isHiddenTask ? t.hiddenTaskNotice : (safe.taskTitle ?? '')}`,
    ...(deliverableText ? [deliverableText] : []),
    ...extraRows,
    `${t.openLabel}: ${taskUrl}`,
  ].join('\n');
}

export function buildLeadActivityEmail(params: BuildLeadActivityEmailParams): RenderedNotificationEmail {
  const safe = sanitizeHiddenLeadParams(params);
  const t = LEAD_COPY_DICT[safe.locale];
  const kindT = t[safe.kind];
  const deptLabel = safe.departmentNames.length > 0 ? safe.departmentNames.join(', ') : null;
  const deptSuffix = deptLabel ? ` (${deptLabel})` : '';
  const taskUrl = buildTaskLink(safe.appUrl, safe.taskId);
  const subject = safe.isHiddenTask
    ? kindT.hiddenSubject(safe.actorName)
    : kindT.visibleSubject(safe.actorName, safe.taskTitle ?? '');
  const rows = safe.kind === 'task.accepted' ? buildAcceptedRows(safe) : buildDeliverableRows(safe, deptLabel);
  const deptHtml = deptSuffix ? ` <strong>${escapeHtml(deptSuffix)}</strong>` : '';
  const introHtml = `<strong>${escapeHtml(safe.actorName)}</strong> ${kindT.actionText}${deptHtml}.`;
  return {
    subject,
    text: buildLeadText({ safe, deptSuffix, rows, taskUrl }),
    html: renderBeamEmailHtml({
      locale: safe.locale,
      bannerTitle: kindT.banner,
      greeting: t.greeting(safe.recipientName),
      introHtml,
      rows,
      ctaLabel: kindT.cta,
      ctaUrl: taskUrl,
    }),
  };
}

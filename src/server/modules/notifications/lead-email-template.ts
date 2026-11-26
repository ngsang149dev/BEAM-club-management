import type { RenderedNotificationEmail } from './email-template';

export interface BuildLeadActivityEmailParams {
  readonly kind: 'task.accepted' | 'task.deliverable_submitted';
  readonly locale: 'vi' | 'en';
  readonly recipientName: string;
  readonly actorName: string;
  readonly boardName: string;
  readonly departmentNames: readonly string[];
  readonly taskTitle: string | null;
  readonly deliverableTitle?: string | null;
  readonly deliverableUrl?: string | null;
  readonly isHiddenTask: boolean;
  readonly appUrl: string;
  readonly boardId: string;
  readonly taskId: string;
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

interface CopyParts {
  readonly subject: string;
  readonly introText: string;
  readonly introHtml: string;
  readonly taskLineText: string;
  readonly taskLineHtml: string;
  readonly deliverableText: string | null;
  readonly deliverableHtml: string | null;
}

const LEAD_COPY_DICT = {
  vi: {
    greeting: (name: string) => `Xin chào ${name},`,
    boardLabel: 'Bảng',
    openLabel: 'Xem tại',
    taskLabel: 'Công việc',
    deliverableLabel: 'Sản phẩm',
    hiddenTaskNotice: '(Công việc ẩn — vui lòng đăng nhập để xem chi tiết)',
    'task.accepted': {
      hiddenSubject: (actor: string) => `[BEAM] ${actor} đã nhận một công việc ẩn`,
      visibleSubject: (actor: string, title: string) => `[BEAM] ${actor} đã nhận công việc: ${title}`,
      actionText: 'đã xác nhận đã nhận công việc',
    },
    'task.deliverable_submitted': {
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
    'task.accepted': {
      hiddenSubject: (actor: string) => `[BEAM] ${actor} accepted a hidden task`,
      visibleSubject: (actor: string, title: string) => `[BEAM] ${actor} accepted task: ${title}`,
      actionText: 'confirmed acceptance of a task',
    },
    'task.deliverable_submitted': {
      hiddenSubject: (actor: string) => `[BEAM] ${actor} submitted a deliverable for a hidden task`,
      visibleSubject: (actor: string, title: string) => `[BEAM] ${actor} submitted a deliverable: ${title}`,
      actionText: 'submitted a deliverable link for a task',
    },
  },
} as const;

function buildDeliverableCopy(
  params: BuildLeadActivityEmailParams,
  label: string,
): { readonly text: string | null; readonly html: string | null } {
  if (params.kind !== 'task.deliverable_submitted' || params.isHiddenTask || !params.deliverableUrl) {
    return { text: null, html: null };
  }
  const titleText = params.deliverableTitle ?? '';
  const linkLabel = params.deliverableTitle ?? params.deliverableUrl;
  return {
    text: `${label}: ${titleText} — ${params.deliverableUrl}`,
    html: `<li>${label}: <a href="${escapeHtml(params.deliverableUrl)}">${escapeHtml(linkLabel)}</a></li>`,
  };
}

function buildCopyParts(p: BuildLeadActivityEmailParams, deptLabel: string | null): CopyParts {
  const t = LEAD_COPY_DICT[p.locale];
  const kindT = t[p.kind];
  const safeTitle = p.taskTitle ?? '';
  const deptSuffix = deptLabel ? ` (${deptLabel})` : '';
  const deliv = buildDeliverableCopy(p, t.deliverableLabel);
  return {
    subject: p.isHiddenTask ? kindT.hiddenSubject(p.actorName) : kindT.visibleSubject(p.actorName, safeTitle),
    introText: `${p.actorName} ${kindT.actionText}${deptSuffix}.`,
    introHtml: `<p><strong>${escapeHtml(p.actorName)}</strong> ${kindT.actionText}${deptSuffix ? ` <strong>${escapeHtml(deptSuffix)}</strong>` : ''}.</p>`,
    taskLineText: `${t.taskLabel}: ${p.isHiddenTask ? t.hiddenTaskNotice : safeTitle}`,
    taskLineHtml: p.isHiddenTask ? `<em>${t.hiddenTaskNotice}</em>` : `<strong>${escapeHtml(safeTitle)}</strong>`,
    deliverableText: deliv.text,
    deliverableHtml: deliv.html,
  };
}

function renderEmailBody(
  params: BuildLeadActivityEmailParams,
  copy: CopyParts,
  taskUrl: string,
): RenderedNotificationEmail {
  const t = LEAD_COPY_DICT[params.locale];
  const textLines = [
    t.greeting(params.recipientName),
    '',
    copy.introText,
    `${t.boardLabel}: ${params.boardName}`,
    copy.taskLineText,
    ...(copy.deliverableText ? [copy.deliverableText] : []),
    `${t.openLabel}: ${taskUrl}`,
  ];
  const html = [
    `<p>${escapeHtml(t.greeting(params.recipientName))}</p>`,
    copy.introHtml,
    `<ul><li>${t.boardLabel}: ${escapeHtml(params.boardName)}</li>`,
    `<li>${t.taskLabel}: ${copy.taskLineHtml}</li>`,
    copy.deliverableHtml ?? '',
    `</ul><p><a href="${escapeHtml(taskUrl)}">${escapeHtml(taskUrl)}</a></p>`,
  ].join('');
  return { subject: copy.subject, text: textLines.join('\n'), html };
}

export function buildLeadActivityEmail(params: BuildLeadActivityEmailParams): RenderedNotificationEmail {
  const deptLabel = params.departmentNames.length > 0 ? params.departmentNames.join(', ') : null;
  const copy = buildCopyParts(params, deptLabel);
  return renderEmailBody(params, copy, buildTaskLink(params.appUrl, params.boardId, params.taskId));
}

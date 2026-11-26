import type { TaskPriority } from '@/lib/tasks';
import {
  type ReminderDigestBuckets,
  type ReminderDigestItem,
  toVnDateParts,
} from './policy';
import type { ReminderLocale } from './types';

export interface BuildReminderEmailParams {
  readonly locale: ReminderLocale;
  readonly recipientName: string;
  readonly sentAt: Date;
  readonly appUrl: string;
  readonly buckets: ReminderDigestBuckets;
}

export interface RenderedReminderEmail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export type ReminderEmailStrategy = (
  params: BuildReminderEmailParams,
) => RenderedReminderEmail;

interface LocaleCopy {
  readonly langTag: ReminderLocale;
  readonly subject: string;
  readonly brandSub: string;
  readonly kicker: string;
  readonly heading: string;
  readonly sentPrefix: string;
  readonly greeting: (name: string) => string;
  readonly lead: string;
  readonly hiddenTaskLabel: string;
  readonly ctaLabel: string;
  readonly footer: string;
  readonly bucketLabels: {
    readonly overdue: string;
    readonly dueToday: string;
    readonly comingUp: string;
  };
  readonly priorityLabels: Record<TaskPriority, string>;
  readonly formatDueLabel: (item: ReminderDigestItem) => string;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatVnSentTimestamp(sentAt: Date): string {
  const vn = toVnDateParts(sentAt);
  return `${pad2(vn.hour)}:${pad2(vn.minute)} · ${pad2(vn.day)}/${pad2(vn.month)}/${vn.year}`;
}

function formatVnShortDate(dueAt: Date): string {
  const vn = toVnDateParts(dueAt);
  return `${pad2(vn.day)}/${pad2(vn.month)}`;
}

function buildViCopy(): LocaleCopy {
  return {
    langTag: 'vi',
    subject: '[BEAM] Nhắc deadline — Task cần bạn chú ý',
    brandSub: 'CLB nội bộ',
    kicker: 'Nhắc deadline',
    heading: 'Task cần bạn chú ý',
    sentPrefix: 'Gửi',
    greeting: (name) => `Chào ${name},`,
    lead: 'Đây là các task đang mở của bạn, xếp theo hạn.',
    hiddenTaskLabel: '(Công việc ẩn — đăng nhập để xem chi tiết)',
    ctaLabel: 'Mở Task của tôi',
    footer: 'Bạn nhận email vì được giao task. Mỗi người một email, mỗi ngày.',
    bucketLabels: {
      overdue: 'Quá hạn',
      dueToday: 'Đến hạn hôm nay',
      comingUp: 'Sắp tới',
    },
    priorityLabels: { 1: 'Thấp', 2: 'Trung bình', 3: 'Cao', 4: 'Khẩn' },
    formatDueLabel: (item) => {
      if (item.diffDays < 0) return `Quá hạn ${Math.abs(item.diffDays)} ngày`;
      if (item.diffDays === 0) return 'Hôm nay';
      return `Còn ${item.diffDays} ngày (${formatVnShortDate(item.dueAt)})`;
    },
  };
}

function buildEnCopy(): LocaleCopy {
  return {
    langTag: 'en',
    subject: '[BEAM] Deadline reminder — Tasks need your attention',
    brandSub: 'Club workspace',
    kicker: 'Deadline reminder',
    heading: 'Tasks need your attention',
    sentPrefix: 'Sent',
    greeting: (name) => `Hi ${name},`,
    lead: 'Here are your open tasks by due date.',
    hiddenTaskLabel: '(Hidden task — sign in to view details)',
    ctaLabel: 'Open My tasks',
    footer: 'You receive this because you are assigned a task. One email per person, per day.',
    bucketLabels: {
      overdue: 'Overdue',
      dueToday: 'Due today',
      comingUp: 'Coming up',
    },
    priorityLabels: { 1: 'Low', 2: 'Medium', 3: 'High', 4: 'Urgent' },
    formatDueLabel: (item) => {
      if (item.diffDays < 0) {
        const days = Math.abs(item.diffDays);
        return `${days} ${days === 1 ? 'day' : 'days'} overdue`;
      }
      if (item.diffDays === 0) return 'Today';
      return `In ${item.diffDays} ${item.diffDays === 1 ? 'day' : 'days'} (${formatVnShortDate(item.dueAt)})`;
    },
  };
}

function resolveDisplayTitle(item: ReminderDigestItem, copy: LocaleCopy): string {
  // WQ-27: Never include hidden task titles in outbound reminder emails.
  if (item.isHidden) return copy.hiddenTaskLabel;
  return item.title ?? copy.hiddenTaskLabel;
}

function formatTaskMeta(item: ReminderDigestItem): string {
  return item.columnName ? `${item.boardName} · ${item.columnName}` : item.boardName;
}

function renderBucketText(
  heading: string,
  items: readonly ReminderDigestItem[],
  copy: LocaleCopy,
): string[] {
  if (items.length === 0) return [];
  const lines = [`[${heading}]`];
  for (const item of items) {
    const title = resolveDisplayTitle(item, copy);
    const priority = copy.priorityLabels[item.priority];
    const due = copy.formatDueLabel(item);
    lines.push(`- [${priority}] ${title} (${formatTaskMeta(item)}) — ${due}`);
  }
  return lines;
}

function renderBucketHtml(
  heading: string,
  items: readonly ReminderDigestItem[],
  copy: LocaleCopy,
  isOverdue: boolean,
): string {
  if (items.length === 0) return '';
  const color = isOverdue ? '#b91c1c' : '#111827';
  const rows = items
    .map((item) => {
      const title = escapeHtml(resolveDisplayTitle(item, copy));
      const meta = escapeHtml(formatTaskMeta(item));
      const prio = escapeHtml(copy.priorityLabels[item.priority]);
      const due = escapeHtml(copy.formatDueLabel(item));
      return [
        '<li style="margin:0 0 10px 0;padding:10px 12px;border:1px solid #e5e7eb;border-radius:6px;list-style:none;">',
        `<div><span style="font-size:12px;font-weight:600;color:#374151;">[${prio}]</span> <strong>${title}</strong></div>`,
        `<div style="margin-top:4px;font-size:13px;color:#4b5563;">${meta} · <span style="font-weight:600;color:${color};">${due}</span></div>`,
        '</li>',
      ].join('');
    })
    .join('\n');
  return [
    `<section style="margin-top:16px;">`,
    `<h3 style="margin:0 0 8px 0;font-size:14px;color:${color};">${escapeHtml(heading)}</h3>`,
    `<ul style="margin:0;padding:0;">${rows}</ul>`,
    `</section>`,
  ].join('\n');
}

function buildMyTasksUrl(appUrl: string): string {
  return `${appUrl.replace(/\/+$/, '')}/my-tasks`;
}

function renderDigestText(
  params: BuildReminderEmailParams,
  copy: LocaleCopy,
  sentLabel: string,
  ctaUrl: string,
): string {
  const sections = [
    ...renderBucketText(copy.bucketLabels.overdue, params.buckets.overdue, copy),
    ...renderBucketText(copy.bucketLabels.dueToday, params.buckets.dueToday, copy),
    ...renderBucketText(copy.bucketLabels.comingUp, params.buckets.comingUp, copy),
  ];
  return [
    `${copy.kicker} — ${copy.heading}`,
    sentLabel,
    '',
    copy.greeting(params.recipientName),
    copy.lead,
    '',
    ...sections,
    '',
    `${copy.ctaLabel}: ${ctaUrl}`,
    '',
    copy.footer,
  ].join('\n');
}

function renderDigestHtml(
  params: BuildReminderEmailParams,
  copy: LocaleCopy,
  sentLabel: string,
  ctaUrl: string,
): string {
  const htmlSections = [
    renderBucketHtml(copy.bucketLabels.overdue, params.buckets.overdue, copy, true),
    renderBucketHtml(copy.bucketLabels.dueToday, params.buckets.dueToday, copy, false),
    renderBucketHtml(copy.bucketLabels.comingUp, params.buckets.comingUp, copy, false),
  ]
    .filter(Boolean)
    .join('\n');

  return [
    `<div lang="${copy.langTag}" style="font-family:system-ui,-apple-system,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#111827;">`,
    `<div style="font-size:12px;color:#6b7280;margin-bottom:12px;"><strong>BEAM</strong> · ${escapeHtml(copy.brandSub)}</div>`,
    `<div style="font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#6b7280;">${escapeHtml(copy.kicker)}</div>`,
    `<h2 style="margin:4px 0 4px 0;font-size:20px;">${escapeHtml(copy.heading)}</h2>`,
    `<p style="margin:0 0 16px 0;font-size:12px;color:#6b7280;">${escapeHtml(sentLabel)}</p>`,
    `<p style="margin:0 0 8px 0;">${escapeHtml(copy.greeting(params.recipientName))}</p>`,
    `<p style="margin:0 0 12px 0;color:#374151;">${escapeHtml(copy.lead)}</p>`,
    htmlSections,
    `<p style="margin:20px 0 16px 0;"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:10px 16px;background:#111827;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;">${escapeHtml(copy.ctaLabel)}</a></p>`,
    `<p style="margin:16px 0 0 0;font-size:12px;color:#6b7280;">${escapeHtml(copy.footer)}</p>`,
    `</div>`,
  ].join('\n');
}

function renderDigestWithCopy(
  params: BuildReminderEmailParams,
  copy: LocaleCopy,
): RenderedReminderEmail {
  const sentLabel = `${copy.sentPrefix} ${formatVnSentTimestamp(params.sentAt)}`;
  const ctaUrl = buildMyTasksUrl(params.appUrl);
  return {
    subject: copy.subject,
    text: renderDigestText(params, copy, sentLabel, ctaUrl),
    html: renderDigestHtml(params, copy, sentLabel, ctaUrl),
  };
}

export const REMINDER_EMAIL_STRATEGIES: Record<
  ReminderLocale,
  ReminderEmailStrategy
> = {
  vi: (params) => renderDigestWithCopy(params, buildViCopy()),
  en: (params) => renderDigestWithCopy(params, buildEnCopy()),
};

export function buildReminderDigestEmail(
  params: BuildReminderEmailParams,
): RenderedReminderEmail {
  const strategy = REMINDER_EMAIL_STRATEGIES[params.locale];
  return strategy(params);
}

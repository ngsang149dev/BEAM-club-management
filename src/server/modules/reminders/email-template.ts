import {
  type EmailDigestGroup,
  escapeHtml,
  renderBeamEmailHtml,
} from '@/server/shared/email-layout';
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
  readonly bannerTitle: string;
  readonly kicker: string;
  readonly heading: string;
  readonly sentPrefix: string;
  readonly greeting: (name: string) => string;
  readonly lead: string;
  readonly hiddenTaskLabel: string;
  readonly ctaLabel: string;
  readonly bucketLabels: {
    readonly overdue: string;
    readonly dueToday: string;
    readonly comingUp: string;
  };
  readonly formatDueLabel: (item: ReminderDigestItem) => string;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
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
    bannerTitle: 'BEAM CLUB — NHẮC HẠN CÔNG VIỆC 07:00',
    kicker: 'Nhắc deadline',
    heading: 'Task cần bạn chú ý',
    sentPrefix: 'Gửi',
    greeting: (name) => `Chào ${name},`,
    lead: 'Đây là các task đang mở của bạn, xếp theo hạn.',
    hiddenTaskLabel: '(Công việc ẩn — đăng nhập để xem chi tiết)',
    ctaLabel: 'Mở Việc của tôi',
    bucketLabels: {
      overdue: 'Quá hạn',
      dueToday: 'Đến hạn hôm nay',
      comingUp: 'Sắp tới',
    },
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
    bannerTitle: 'BEAM CLUB — 07:00 DEADLINE DIGEST',
    kicker: 'Deadline reminder',
    heading: 'Tasks need your attention',
    sentPrefix: 'Sent',
    greeting: (name) => `Hi ${name},`,
    lead: 'Here are your open tasks by due date.',
    hiddenTaskLabel: '(Hidden task — sign in to view details)',
    ctaLabel: 'Open My Tasks',
    bucketLabels: {
      overdue: 'Overdue',
      dueToday: 'Due today',
      comingUp: 'Coming up',
    },
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
  const lines = [`[${heading} (${items.length})]`];
  for (const item of items) {
    const title = resolveDisplayTitle(item, copy);
    const due = copy.formatDueLabel(item);
    lines.push(`- ${title} (${formatTaskMeta(item)}) — ${due}`);
  }
  return lines;
}

function buildDigestGroup(params: {
  readonly heading: string;
  readonly accentColor: string;
  readonly items: readonly ReminderDigestItem[];
  readonly copy: LocaleCopy;
}): EmailDigestGroup | null {
  if (params.items.length === 0) return null;
  return {
    heading: `${params.heading} (${params.items.length})`,
    accentColor: params.accentColor,
    items: params.items.map((item) => ({
      title: resolveDisplayTitle(item, params.copy),
      meta: `${formatTaskMeta(item)} · ${params.copy.formatDueLabel(item)}`,
      italic: item.isHidden,
    })),
  };
}

function buildMyTasksUrl(appUrl: string): string {
  return `${appUrl.replace(/\/+$/, '')}/progress`;
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
  ].join('\n');
}

function renderDigestHtml(
  params: BuildReminderEmailParams,
  copy: LocaleCopy,
  sentLabel: string,
  ctaUrl: string,
): string {
  const groups = [
    buildDigestGroup({
      heading: copy.bucketLabels.overdue,
      accentColor: '#e11d48',
      items: params.buckets.overdue,
      copy,
    }),
    buildDigestGroup({
      heading: copy.bucketLabels.dueToday,
      accentColor: '#ea580c',
      items: params.buckets.dueToday,
      copy,
    }),
    buildDigestGroup({
      heading: copy.bucketLabels.comingUp,
      accentColor: '#ca8a04',
      items: params.buckets.comingUp,
      copy,
    }),
  ].filter((group): group is EmailDigestGroup => group !== null);

  const introHtml = `${escapeHtml(copy.lead)} <span class="beam-email-muted" style="color:#6b7280;">(${escapeHtml(sentLabel)})</span>`;
  return renderBeamEmailHtml({
    locale: copy.langTag,
    bannerTitle: copy.bannerTitle,
    greeting: copy.greeting(params.recipientName),
    introHtml,
    digestGroups: groups,
    ctaLabel: copy.ctaLabel,
    ctaUrl,
  });
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

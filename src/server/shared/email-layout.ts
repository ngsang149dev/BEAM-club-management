const MS_PER_DAY = 86_400_000;
const VN_OFFSET_MS = 7 * 3_600_000;

export type EmailLocale = 'vi' | 'en';
export type EmailPillTone = 'urgent' | 'ok' | 'neutral';

export interface EmailDeadlinePill {
  readonly label: string;
  readonly tone: EmailPillTone;
}

export interface EmailDetailRow {
  readonly label: string;
  readonly value: string;
  readonly strong?: boolean;
  readonly italic?: boolean;
  readonly highlight?: boolean;
  readonly linkUrl?: string | null;
  readonly pill?: EmailPillTone;
}

export interface EmailDigestItem {
  readonly title: string;
  readonly meta: string;
  readonly italic?: boolean;
}

export interface EmailDigestGroup {
  readonly heading: string;
  readonly accentColor: string;
  readonly items: readonly EmailDigestItem[];
}

export interface RenderBeamEmailHtmlParams {
  readonly locale: EmailLocale;
  readonly bannerTitle: string;
  readonly greeting: string;
  readonly introHtml: string;
  readonly rows?: readonly EmailDetailRow[];
  readonly digestGroups?: readonly EmailDigestGroup[];
  readonly ctaLabel: string;
  readonly ctaUrl: string;
}

interface VnCalendarParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly utcMidnightMs: number;
}

const DARK_MODE_CSS = `
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  @media (prefers-color-scheme: dark) {
    .beam-email-outer { background-color: #181920 !important; }
    .beam-email-card { background-color: #23252f !important; border-color: #353846 !important; }
    .beam-email-primary { color: #e4e6eb !important; }
    .beam-email-body { color: #c8cbd4 !important; }
    .beam-email-muted { color: #9ca3af !important; }
    .beam-email-row { border-bottom-color: #303341 !important; }
    .beam-email-deadline { color: #fb7185 !important; }
    .beam-email-link { color: #f472b6 !important; }
    .beam-email-bucket-item { background-color: #2a2d3a !important; border-color: #303341 !important; }
    .beam-email-pill-urgent { background-color: #3b2328 !important; color: #fda4af !important; border-color: #881337 !important; }
    .beam-email-pill-ok { background-color: #1e3329 !important; color: #86efac !important; border-color: #14532d !important; }
    .beam-email-pill-neutral { background-color: #2f323e !important; color: #d4d4d8 !important; }
  }
`.trim();

const PILL_STYLES: Record<EmailPillTone, { readonly className: string; readonly style: string }> = {
  urgent: {
    className: 'beam-email-pill-urgent',
    style: 'display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:700;background-color:#fff1f2;color:#be123c;border:1px solid #fecdd3;',
  },
  ok: {
    className: 'beam-email-pill-ok',
    style: 'display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:700;background-color:#ecfdf5;color:#047857;border:1px solid #a7f3d0;',
  },
  neutral: {
    className: 'beam-email-pill-neutral',
    style: 'display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600;background-color:#f4f4f5;color:#3f3f46;',
  },
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toVnParts(date: Date): VnCalendarParts {
  // Asia/Ho_Chi_Minh is fixed UTC+7 without DST; shifting avoids host TZ drift.
  const vn = new Date(date.getTime() + VN_OFFSET_MS);
  const year = vn.getUTCFullYear();
  const month = vn.getUTCMonth() + 1;
  const day = vn.getUTCDate();
  return { year, month, day, hour: vn.getUTCHours(), minute: vn.getUTCMinutes(), utcMidnightMs: Date.UTC(year, month - 1, day) };
}

function sanitizeHref(raw: string): string {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('/')) return trimmed;
  return '#';
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function truncateEmailExcerpt(
  text: string | null | undefined,
  maxChars = 240,
): string | null {
  if (!text) return null;
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) return null;
  const limit = Math.max(1, maxChars);
  const codePoints = Array.from(normalized);
  if (codePoints.length <= limit) return normalized;
  if (limit === 1) return '…';
  return `${codePoints.slice(0, limit - 1).join('').replace(/\s+$/, '')}…`;
}

export function formatEmailVnDateTime(
  date: Date | null | undefined,
  locale: EmailLocale,
): string | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  const vn = toVnParts(date);
  const timePart = `${pad2(vn.hour)}:${pad2(vn.minute)}`;
  if (locale === 'en') {
    return `${vn.year}-${pad2(vn.month)}-${pad2(vn.day)} · ${timePart}`;
  }
  return `${pad2(vn.day)}/${pad2(vn.month)}/${vn.year} · ${timePart}`;
}

const EXACT_DAY_PILLS: Record<number, Record<EmailLocale, EmailDeadlinePill>> = {
  0: {
    vi: { tone: 'urgent', label: 'Gấp · Hôm nay' },
    en: { tone: 'urgent', label: 'Urgent · Due today' },
  },
  1: {
    vi: { tone: 'urgent', label: 'Gấp · Còn 1 ngày' },
    en: { tone: 'urgent', label: 'Urgent · Due in 1 day' },
  },
};

function buildDeadlineLabel(diffDays: number, locale: EmailLocale): EmailDeadlinePill {
  const exact = EXACT_DAY_PILLS[diffDays];
  if (exact) return exact[locale];
  if (diffDays < 0) {
    const days = Math.abs(diffDays);
    const enUnit = days === 1 ? 'day' : 'days';
    return { tone: 'urgent', label: locale === 'vi' ? `Quá hạn ${days} ngày` : `Overdue by ${days} ${enUnit}` };
  }
  if (diffDays <= 3) {
    return { tone: 'neutral', label: locale === 'vi' ? `Sắp hạn · Còn ${diffDays} ngày` : `Due soon · In ${diffDays} days` };
  }
  return { tone: 'ok', label: locale === 'vi' ? `Đúng tiến độ · Còn ${diffDays} ngày` : `On track · In ${diffDays} days` };
}

export function computeEmailDeadlinePill(params: {
  readonly dueAt?: Date | null;
  readonly now?: Date;
  readonly locale: EmailLocale;
}): EmailDeadlinePill | null {
  if (!params.dueAt || Number.isNaN(params.dueAt.getTime())) return null;
  const now = params.now ?? new Date();
  const diffDays = Math.round(
    (toVnParts(params.dueAt).utcMidnightMs - toVnParts(now).utcMidnightMs) / MS_PER_DAY,
  );
  return buildDeadlineLabel(diffDays, params.locale);
}

function renderRowValue(row: EmailDetailRow): string {
  const safeVal = escapeHtml(row.value);
  if (row.pill) {
    const pill = PILL_STYLES[row.pill];
    return `<span class="${pill.className}" style="${pill.style}">${safeVal}</span>`;
  }
  if (row.linkUrl) {
    const href = escapeHtml(sanitizeHref(row.linkUrl));
    return `<a href="${href}" class="beam-email-link" style="color:#db2777;text-decoration:underline;word-break:break-all;">${safeVal}</a>`;
  }
  if (row.highlight) return `<span class="beam-email-deadline" style="font-weight:700;color:#e11d74;">${safeVal}</span>`;
  if (row.strong) return `<strong class="beam-email-primary" style="color:#18181b;font-size:14px;">${safeVal}</strong>`;
  if (row.italic) return `<em class="beam-email-muted" style="color:#6b7280;">${safeVal}</em>`;
  return safeVal;
}

function renderRowsTable(rows: readonly EmailDetailRow[]): string {
  if (rows.length === 0) return '';
  const body = rows
    .map((row) => {
      const labelClass = row.highlight ? 'beam-email-deadline' : 'beam-email-muted';
      const labelColor = row.highlight ? '#e11d74' : '#6b7280';
      return `<tr class="beam-email-row" style="border-bottom:1px solid #f1f5f9;"><td class="${labelClass}" style="padding:10px 10px 10px 0;vertical-align:top;width:36%;font-size:13px;font-weight:600;color:${labelColor};">${escapeHtml(row.label)}</td><td class="beam-email-primary" style="padding:10px 0;vertical-align:top;font-size:13px;line-height:1.5;color:#18181b;">${renderRowValue(row)}</td></tr>`;
    })
    .join('');
  return `<table role="presentation" style="width:100%;border-collapse:collapse;margin-top:14px;">${body}</table>`;
}

function renderDigestGroupsHtml(groups: readonly EmailDigestGroup[]): string {
  const active = groups.filter((g) => g.items.length > 0);
  if (active.length === 0) return '';
  const rendered = active
    .map((group) => {
      const itemsHtml = group.items
        .map((item) => {
          const titleHtml = item.italic
            ? `<em class="beam-email-muted" style="color:#6b7280;font-weight:600;">${escapeHtml(item.title)}</em>`
            : escapeHtml(item.title);
          return `<div class="beam-email-bucket-item" style="padding:10px 12px;border-radius:10px;background-color:#fafafa;border:1px solid #f1f5f9;border-left:4px solid ${escapeHtml(group.accentColor)};margin-bottom:8px;"><div class="beam-email-primary" style="font-size:13.5px;font-weight:700;color:#18181b;">${titleHtml}</div><div class="beam-email-muted" style="font-size:12px;color:#6b7280;margin-top:3px;">${escapeHtml(item.meta)}</div></div>`;
        })
        .join('');
      return `<div style="margin-bottom:12px;"><div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:${escapeHtml(group.accentColor)};margin-bottom:6px;">&#9679; ${escapeHtml(group.heading)}</div>${itemsHtml}</div>`;
    })
    .join('');
  return `<div style="margin-top:14px;">${rendered}</div>`;
}

export function renderBeamEmailHtml(params: RenderBeamEmailHtmlParams): string {
  const rowsHtml = params.rows ? renderRowsTable(params.rows) : '';
  const digestHtml = params.digestGroups ? renderDigestGroupsHtml(params.digestGroups) : '';
  const ctaHref = escapeHtml(sanitizeHref(params.ctaUrl));
  return [
    '<!DOCTYPE html>',
    `<html lang="${params.locale}">`,
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<meta name="color-scheme" content="light dark">',
    '<meta name="supported-color-schemes" content="light dark">',
    `<style>${DARK_MODE_CSS}</style>`,
    '</head>',
    '<body class="beam-email-outer" style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;">',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" class="beam-email-outer" style="background-color:#f3f4f6;width:100%;border-collapse:collapse;">',
    '<tr><td align="center" style="padding:24px 14px;">',
    '<div style="max-width:600px;width:100%;margin:0 auto;text-align:left;">',
    '<div class="beam-email-card" style="background-color:#ffffff;border:1.5px solid #d4d4d8;border-radius:16px;overflow:hidden;">',
    '<div style="background-color:#db2777;background-image:linear-gradient(135deg,#be185d 0%,#db2777 52%,#ea580c 100%);padding:18px 20px;">',
    '<div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:rgba(255,255,255,0.86);text-transform:uppercase;">BEAM Club</div>',
    `<div style="font-size:16px;font-weight:800;color:#ffffff;margin-top:2px;letter-spacing:0.01em;line-height:1.3;">${escapeHtml(params.bannerTitle)}</div>`,
    '</div>',
    '<div style="padding:20px 20px 22px 20px;">',
    `<p class="beam-email-primary" style="margin:0 0 8px 0;font-size:14px;font-weight:600;color:#18181b;">${escapeHtml(params.greeting)}</p>`,
    `<p class="beam-email-body" style="margin:0;font-size:13.5px;line-height:1.5;color:#3f3f46;">${params.introHtml}</p>`,
    `${rowsHtml}${digestHtml}`,
    `<div style="text-align:center;margin-top:22px;"><a href="${ctaHref}" style="display:inline-block;padding:12px 28px;border-radius:10px;background-color:#db2777;color:#ffffff;font-size:13.5px;font-weight:700;text-decoration:none;">${escapeHtml(params.ctaLabel)}</a></div>`,
    '</div></div></div></td></tr></table></body></html>',
  ].join('\n');
}

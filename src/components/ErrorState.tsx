import type { ReactNode } from 'react';
import { ClubLogo } from './ClubLogo';

export type ErrorVariant =
  | '401'
  | '403'
  | '404'
  | '409'
  | '429'
  | '500'
  | 'offline'
  | 'sessionExpired';

export interface ErrorStateProps {
  variant?: ErrorVariant;
  code?: string;
  title: string;
  description: string;
  requestId?: string;
  requestIdLabel?: string;
  fullPage?: boolean;
  brandName?: string;
  footerText?: string;
  actions?: ReactNode;
}

const DANGER_VARIANTS = new Set<ErrorVariant>(['403', '500', 'offline']);

function renderVariantIcon(variant: ErrorVariant): ReactNode {
  if (variant === '401' || variant === 'sessionExpired') {
    return (
      <svg className="ic" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="5" y="10" width="14" height="10" rx="2" />
        <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
      </svg>
    );
  }
  if (variant === 'offline') {
    return (
      <svg className="ic" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 3l18 18" />
        <path d="M8.5 15.5a5 5 0 0 1 7 0M5.5 12.5a10 10 0 0 1 3.2-2M18.5 12.5a10 10 0 0 0-2.2-1.5M2.5 9.5a15 15 0 0 1 4.1-2.6M21.5 9.5a15 15 0 0 0-10.9-3.4M12 19h.01" />
      </svg>
    );
  }
  return (
    <svg className="ic" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5v.2" />
    </svg>
  );
}

function formatMeta(code?: string, requestId?: string, requestIdLabel?: string): string | null {
  const parts: string[] = [];
  if (code) {
    parts.push(code);
  }
  if (requestId) {
    parts.push(requestIdLabel ? `${requestIdLabel}: ${requestId}` : requestId);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

function FullPageErrorState({
  code,
  title,
  description,
  metaText,
  brandName,
  footerText,
  actions,
}: ErrorStateProps & { metaText: string | null }) {
  return (
    <div className="err-shell" data-component="ErrorState">
      {brandName ? (
        <header className="err-top">
          <ClubLogo alt="" />
          <b>{brandName}</b>
        </header>
      ) : null}
      <main className="err-stage">
        <section className="err-page" role="alert">
          {code ? <span className="err-code">{code}</span> : null}
          <h1>{title}</h1>
          <p>{description}</p>
          {actions ? <div className="err-actions">{actions}</div> : null}
          {metaText ? <span className="err-meta">{metaText}</span> : null}
        </section>
      </main>
      {footerText ? <footer className="err-foot">{footerText}</footer> : null}
    </div>
  );
}

function InlineErrorState({
  variant = '500',
  title,
  description,
  metaText,
  actions,
}: ErrorStateProps & { metaText: string | null }) {
  const isDanger = DANGER_VARIANTS.has(variant);
  return (
    <section
      className={`ui-state-panel${isDanger ? ' is-danger' : ''}`}
      data-component="ErrorState"
      role="alert"
    >
      <span className="ui-state-icon">{renderVariantIcon(variant)}</span>
      <h2 className="ui-state-title">{title}</h2>
      <p className="ui-state-body">{description}</p>
      {metaText ? <span className="ui-state-meta">{metaText}</span> : null}
      {actions ? <div className="ui-state-actions">{actions}</div> : null}
    </section>
  );
}

export function ErrorState(props: ErrorStateProps) {
  const metaText = formatMeta(props.code, props.requestId, props.requestIdLabel);
  if (props.fullPage) {
    return <FullPageErrorState {...props} metaText={metaText} />;
  }
  return <InlineErrorState {...props} metaText={metaText} />;
}

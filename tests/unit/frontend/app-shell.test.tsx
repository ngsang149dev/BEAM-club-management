import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import viMessages from '../../../messages/vi.json';
import enMessages from '../../../messages/en.json';
import { AppShell } from '@/components/AppShell';
import { ErrorState } from '@/components/ErrorState';
import { BRANDING_QUERY_KEYS } from '@/features/branding/hooks/useBranding';
import { PermissionsProvider } from '@/features/shared/permissions/can';

vi.mock('next/navigation', () => ({
  usePathname: () => '/tasks',
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe('AppShell navigation visibility and bilingual rendering', () => {
  it('hides gated workspace and admin links when user is omitted and no permissions exist', () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="vi" messages={viMessages} timeZone="Asia/Ho_Chi_Minh">
        <AppShell title="Calendar" fullHeight>
          <div>workspace-body</div>
        </AppShell>
      </NextIntlClientProvider>
    );

    expect(html).toContain('app-shell is-full-height');
    expect(html).toContain('href="/tasks"');
    expect(html).toContain('href="/tasks" class="app-brand"');
    expect(html).not.toContain('href="/"');
    expect(html).toContain('href="/my-tasks"');
    expect(html).toContain('href="/progress"');
    expect(html.indexOf('href="/progress"')).toBeGreaterThan(html.indexOf('href="/my-tasks"'));
    expect(html).toContain('Tiến độ cá nhân');
    expect(html).toContain('href="/profile"');
    expect(html).not.toContain('href="/members"');
    expect(html).not.toContain('href="/archive"');
    expect(html).not.toContain('href="/admin/members"');
    expect(html).not.toContain('href="/admin/permissions"');
    expect(html).not.toContain('href="/admin/departments"');
    expect(html).not.toContain('href="/admin/branding"');
    expect(html).not.toContain('href="/admin/reminders"');
    expect(html).not.toContain('href="/admin/audit"');
  });

  it('shows only explicitly granted permission-gated nav links for non-admin users', () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={enMessages} timeZone="Asia/Ho_Chi_Minh">
        <PermissionsProvider
          isAdmin={false}
          permissions={['member.view', 'department.manage', 'reminder.configure', 'audit.view']}
        >
          <AppShell user={{ fullName: 'Le Van C', roleLabel: 'Department lead' }}>
            <div>content</div>
          </AppShell>
        </PermissionsProvider>
      </NextIntlClientProvider>
    );

    expect(html).toContain('href="/members"');
    expect(html).toContain('href="/progress"');
    expect(html).toContain('Member Progress');
    expect(html).toContain('href="/admin/departments"');
    expect(html).toContain('href="/admin/reminders"');
    expect(html).toContain('href="/admin/audit"');
    expect(html).not.toContain('href="/archive"');
    expect(html).not.toContain('href="/admin/members"');
    expect(html).not.toContain('href="/admin/permissions"');
    expect(html).not.toContain('href="/admin/branding"');
  });

  it('shows archive link when non-admin holds any archive permission (task.delete, member.deactivate, board.delete)', () => {
    for (const perm of ['task.delete', 'member.deactivate', 'board.delete'] as const) {
      const html = renderToStaticMarkup(
        <NextIntlClientProvider locale="en" messages={enMessages} timeZone="Asia/Ho_Chi_Minh">
          <PermissionsProvider isAdmin={false} permissions={[perm]}>
            <AppShell activeNav="archive" user={{ fullName: 'Lead User' }}>
              <div>content</div>
            </AppShell>
          </PermissionsProvider>
        </NextIntlClientProvider>
      );
      expect(html).toContain('href="/archive"');
      expect(html).toContain('Archive');
    }
  });

  it('shows all workspace and admin links for admins and renders left badge when inactive', () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="vi" messages={viMessages} timeZone="Asia/Ho_Chi_Minh">
        <PermissionsProvider isAdmin permissions={[]}>
          <AppShell user={{ fullName: 'Nguyen Admin', isActive: false }}>
            <div>admin-content</div>
          </AppShell>
        </PermissionsProvider>
      </NextIntlClientProvider>
    );

    expect(html).toContain('href="/members"');
    expect(html).toContain('href="/archive"');
    expect(html).toContain('href="/admin/members"');
    expect(html).toContain('href="/admin/permissions"');
    expect(html).toContain('href="/admin/departments"');
    expect(html).toContain('href="/admin/branding"');
    expect(html).toContain('href="/admin/reminders"');
    expect(html).toContain('href="/admin/audit"');
    expect(html).toContain('(đã rời)');
  });

  it('renders custom club logo, custom wordmark, and member avatar from QueryClient cache and falls back cleanly', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(BRANDING_QUERY_KEYS.branding, {
      logoUrl: '/api/v1/branding/logo?v=123',
      wordmarkUrl: '/api/v1/branding/wordmark?v=321',
      updatedAt: '2026-11-24T00:00:00.000Z',
      galleryItems: [],
    });

    const withBrandingHtml = renderToStaticMarkup(
      <NextIntlClientProvider locale="vi" messages={viMessages} timeZone="Asia/Ho_Chi_Minh">
        <QueryClientProvider client={queryClient}>
          <AppShell
            user={{
              id: 'u-1',
              fullName: 'Le Van C',
              avatarUrl: '/api/v1/members/u-1/avatar?v=456',
              roleLabel: 'Thành viên',
            }}
          >
            <div>content</div>
          </AppShell>
        </QueryClientProvider>
      </NextIntlClientProvider>
    );

    expect(withBrandingHtml).toContain('src="/api/v1/branding/logo?v=123"');
    expect(withBrandingHtml).toContain('class="club-logo-img"');
    expect(withBrandingHtml).toContain('src="/api/v1/branding/wordmark?v=321"');
    expect(withBrandingHtml).toContain('class="club-wordmark-img"');
    expect(withBrandingHtml).toContain('src="/api/v1/members/u-1/avatar?v=456"');
    expect(withBrandingHtml).toContain('class="ui-avatar-img"');

    const fallbackClient = new QueryClient();
    fallbackClient.setQueryData(BRANDING_QUERY_KEYS.branding, {
      logoUrl: null,
      wordmarkUrl: null,
      updatedAt: null,
      galleryItems: [],
    });
    const fallbackHtml = renderToStaticMarkup(
      <NextIntlClientProvider locale="vi" messages={viMessages} timeZone="Asia/Ho_Chi_Minh">
        <QueryClientProvider client={fallbackClient}>
          <AppShell user={{ fullName: 'Le Van C' }}>
            <div>content</div>
          </AppShell>
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
    expect(fallbackHtml).toContain('<span class="app-brand-text"><b>BEAM</b><span>CLB nội bộ</span></span>');
    expect(fallbackHtml).not.toContain('class="club-wordmark-img"');

    const errorStandaloneHtml = renderToStaticMarkup(
      <ErrorState fullPage brandName="BEAM" code="404" title="Not found" description="Missing" />
    );
    expect(errorStandaloneHtml).toContain('class="ui-logo"');
    expect(errorStandaloneHtml).toContain('BEAM');
  });

  it('renders notificationsSlot inside topbar before LanguageSwitch', () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="vi" messages={viMessages} timeZone="Asia/Ho_Chi_Minh">
        <AppShell
          user={{ fullName: 'Le Van C' }}
          notificationsSlot={<button type="button" data-testid="notif-slot">bell</button>}
        >
          <div>body</div>
        </AppShell>
      </NextIntlClientProvider>
    );

    const slotIdx = html.indexOf('data-testid="notif-slot"');
    const topLangIdx = html.indexOf('class="app-top-lang"');
    expect(slotIdx).toBeGreaterThan(-1);
    expect(topLangIdx).toBeGreaterThan(slotIdx);
  });
});

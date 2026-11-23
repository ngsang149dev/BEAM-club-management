import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import viMessages from '../../../messages/vi.json';
import enMessages from '../../../messages/en.json';
import { AppShell } from '@/components/AppShell';
import { PermissionsProvider } from '@/features/shared/permissions/can';

vi.mock('next/navigation', () => ({
  usePathname: () => '/boards',
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
        <AppShell title="Board">
          <div>workspace-body</div>
        </AppShell>
      </NextIntlClientProvider>
    );

    expect(html).toContain('href="/boards"');
    expect(html).toContain('href="/my-tasks"');
    expect(html).toContain('href="/profile"');
    expect(html).not.toContain('href="/members"');
    expect(html).not.toContain('href="/admin/members"');
    expect(html).not.toContain('href="/admin/permissions"');
    expect(html).not.toContain('href="/admin/departments"');
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
    expect(html).toContain('href="/admin/departments"');
    expect(html).toContain('href="/admin/reminders"');
    expect(html).toContain('href="/admin/audit"');
    expect(html).not.toContain('href="/admin/members"');
    expect(html).not.toContain('href="/admin/permissions"');
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
    expect(html).toContain('href="/admin/members"');
    expect(html).toContain('href="/admin/permissions"');
    expect(html).toContain('href="/admin/departments"');
    expect(html).toContain('href="/admin/reminders"');
    expect(html).toContain('href="/admin/audit"');
    expect(html).toContain('(đã rời)');
  });
});

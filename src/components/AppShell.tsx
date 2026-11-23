'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { usePermissions, type PermissionCode } from '@/features/shared/permissions/can';
import { LanguageSwitch } from './LanguageSwitch';

export type AppNavKey =
  | 'boards'
  | 'myTasks'
  | 'members'
  | 'profile'
  | 'memberAdmin'
  | 'permissions'
  | 'departments'
  | 'reminders'
  | 'auditLog';

export interface AppShellUser {
  fullName: string;
  roleLabel?: string;
  isActive?: boolean;
}

export interface AppShellProps {
  activeNav?: AppNavKey;
  title?: string;
  breadcrumb?: string;
  actions?: ReactNode;
  user?: AppShellUser | null;
  onSignOut?: () => void;
  children: ReactNode;
}

interface NavItemConfig {
  key: AppNavKey;
  href: string;
  permission?: PermissionCode;
  anyOf?: readonly PermissionCode[];
  adminOnly?: boolean;
}

const WORKSPACE_NAV: readonly NavItemConfig[] = [
  { key: 'boards', href: '/boards' },
  { key: 'myTasks', href: '/my-tasks' },
  { key: 'members', href: '/members', permission: 'member.view' },
  { key: 'profile', href: '/profile' },
];

const ADMIN_NAV: readonly NavItemConfig[] = [
  { key: 'memberAdmin', href: '/admin/members', anyOf: ['member.create', 'member.update', 'member.deactivate'] },
  { key: 'permissions', href: '/admin/permissions', adminOnly: true },
  { key: 'departments', href: '/admin/departments', permission: 'department.manage' },
  { key: 'reminders', href: '/admin/reminders', permission: 'reminder.configure' },
  { key: 'auditLog', href: '/admin/audit', permission: 'audit.view' },
];

const MEMBERS_ICON = (
  <>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 20c.6-3.4 2.8-5.4 5.5-5.4s4.9 2 5.5 5.4M16 5.2a3.2 3.2 0 0 1 0 6.1M17.5 14.9c1.8.7 3 2.5 3.4 5.1" />
  </>
);

const NAV_ICON_PATHS: Record<AppNavKey, ReactNode> = {
  boards: <path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" />,
  myTasks: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M8 12l3 3 5-6" /></>,
  members: MEMBERS_ICON,
  profile: <><circle cx="12" cy="8" r="3.4" /><path d="M5 20c.7-3.7 3.2-5.8 7-5.8s6.3 2.1 7 5.8" /></>,
  memberAdmin: MEMBERS_ICON,
  permissions: <><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l2 2M14 9l2 2" /></>,
  departments: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3" /></>,
  reminders: <><path d="M6 9a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13 6 9z" /><path d="M10 18a2 2 0 0 0 4 0" /></>,
  auditLog: <><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="3.5" cy="6" r=".9" fill="currentColor" stroke="none" /><circle cx="3.5" cy="12" r=".9" fill="currentColor" stroke="none" /><circle cx="3.5" cy="18" r=".9" fill="currentColor" stroke="none" /></>,
};

function NavIcon({ name, size = 16 }: { name: AppNavKey; size?: number }) {
  return (
    <svg className="ic" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {NAV_ICON_PATHS[name]}
    </svg>
  );
}

function getUserInitial(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return (parts[parts.length - 1] ?? '?').slice(0, 1).toUpperCase();
}

function isNavItemActive(item: NavItemConfig, activeNav?: AppNavKey, pathname?: string): boolean {
  if (activeNav) {
    return item.key === activeNav;
  }
  return Boolean(pathname && pathname.startsWith(item.href));
}

function isNavPermitted(item: NavItemConfig, permCheck: ReturnType<typeof usePermissions>): boolean {
  if (item.adminOnly) {
    return permCheck.isAdmin;
  }
  if (item.anyOf) {
    return permCheck.canAny(item.anyOf);
  }
  if (item.permission) {
    return permCheck.can(item.permission);
  }
  return true;
}

function NavList(props: { items: readonly NavItemConfig[]; activeNav?: AppNavKey; pathname: string; ariaLabel?: string; onNavigate?: () => void }) {
  const tNav = useTranslations('nav');
  return (
    <nav className="app-nav" aria-label={props.ariaLabel}>
      {props.items.map((item) => {
        const active = isNavItemActive(item, props.activeNav, props.pathname);
        return (
          <Link key={item.key} href={item.href} className={`app-nav-item${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined} onClick={props.onNavigate}>
            <NavIcon name={item.key} />
            <span>{tNav(item.key)}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarUserRow({ user, onSignOut }: { user: AppShellUser; onSignOut?: () => void }) {
  const tNav = useTranslations('nav');
  const tMember = useTranslations('member');
  return (
    <div className="app-user">
      <span className={`ui-avatar${user.isActive === false ? ' is-out' : ''}`} aria-hidden="true">{getUserInitial(user.fullName)}</span>
      <span className="app-user-text">
        <span className="app-user-name">
          {user.fullName}
          {user.isActive === false ? <span className="app-user-left"> {tMember('leftBadge')}</span> : null}
        </span>
        {user.roleLabel ? <span className="app-user-role">{user.roleLabel}</span> : null}
      </span>
      {onSignOut ? (
        <button type="button" className="ui-icon-btn" aria-label={tNav('signOut')} title={tNav('signOut')} onClick={onSignOut}>
          <svg className="ic" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10 5H5v14h5" />
            <path d="M14 8l4 4-4 4M8 12h10" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

interface SidebarContentProps {
  workspaceItems: readonly NavItemConfig[];
  adminItems: readonly NavItemConfig[];
  activeNav?: AppNavKey;
  pathname: string;
  user?: AppShellUser | null;
  onSignOut?: () => void;
  onNavigate?: () => void;
}

function SidebarContent({ workspaceItems, adminItems, activeNav, pathname, user, onSignOut, onNavigate }: SidebarContentProps) {
  const tApp = useTranslations('app');
  const tNav = useTranslations('nav');
  const tLang = useTranslations('language');
  return (
    <>
      <Link href="/" className="app-brand" onClick={onNavigate}>
        <span className="ui-logo" aria-hidden="true"><i /><i /><i /><i /></span>
        <span className="app-brand-text"><b>{tApp('name')}</b><span>{tApp('subtitle')}</span></span>
      </Link>
      <div className="app-side-label">{tNav('groups.workspace')}</div>
      <NavList items={workspaceItems} activeNav={activeNav} pathname={pathname} ariaLabel={tNav('sidebarAriaLabel')} onNavigate={onNavigate} />
      {adminItems.length > 0 ? (
        <>
          <div className="app-side-label has-rule">{tNav('groups.admin')}</div>
          <NavList items={adminItems} activeNav={activeNav} pathname={pathname} onNavigate={onNavigate} />
        </>
      ) : null}
      <div className="app-side-foot">
        <div className="app-side-lang"><span>{tLang('label')}</span><LanguageSwitch /></div>
        {user ? <SidebarUserRow user={user} onSignOut={onSignOut} /> : null}
      </div>
    </>
  );
}

function AppTopBar(props: { drawerOpen: boolean; onOpenMenu: () => void; breadcrumb?: string; title?: string; actions?: ReactNode }) {
  const tApp = useTranslations('app');
  const tNav = useTranslations('nav');
  return (
    <header className="app-top">
      <button type="button" className="ui-icon-btn app-menu-btn" aria-label={tNav('openMenu')} aria-expanded={props.drawerOpen} onClick={props.onOpenMenu}>
        <svg className="ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
      <div className="app-top-bread">
        <span className="app-top-brand">{tApp('name')}</span>
        {props.breadcrumb ? <><span aria-hidden="true">/</span><span>{props.breadcrumb}</span></> : null}
        {props.title ? <><span aria-hidden="true">/</span><b>{props.title}</b></> : null}
      </div>
      <div className="app-top-right">
        {props.actions}
        <div className="app-top-lang"><LanguageSwitch /></div>
      </div>
    </header>
  );
}

export function AppShell({ activeNav, title, breadcrumb, actions, user, onSignOut, children }: AppShellProps) {
  const pathname = usePathname() ?? '/';
  const tApp = useTranslations('app');
  const tNav = useTranslations('nav');
  const permCheck = usePermissions();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!drawerOpen) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setDrawerOpen(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [drawerOpen]);

  const workspaceItems = WORKSPACE_NAV.filter((item) => isNavPermitted(item, permCheck));
  const adminItems = ADMIN_NAV.filter((item) => isNavPermitted(item, permCheck));

  return (
    <div className="app-shell" data-component="AppShell">
      <a className="skip" href="#main-content">{tApp('skipToContent')}</a>
      <aside className="app-side" data-component="AppSidebar">
        <SidebarContent workspaceItems={workspaceItems} adminItems={adminItems} activeNav={activeNav} pathname={pathname} user={user} onSignOut={onSignOut} />
      </aside>
      {drawerOpen ? (
        <div className="app-drawer-layer" role="dialog" aria-modal="true" aria-label={tNav('drawerAriaLabel')}>
          <button type="button" className="app-drawer-scrim" aria-label={tNav('closeMenu')} onClick={() => setDrawerOpen(false)} />
          <aside className="app-drawer">
            <SidebarContent workspaceItems={workspaceItems} adminItems={adminItems} activeNav={activeNav} pathname={pathname} user={user} onSignOut={onSignOut} onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      ) : null}
      <div className="app-main">
        <AppTopBar drawerOpen={drawerOpen} onOpenMenu={() => setDrawerOpen(true)} breadcrumb={breadcrumb} title={title} actions={actions} />
        <main id="main-content" className="app-scroll">{children}</main>
        <nav className="app-mtabs" data-component="MobileTabBar" aria-label={tNav('mobileTabsAriaLabel')}>
          {workspaceItems.map((item) => {
            const active = isNavItemActive(item, activeNav, pathname);
            return (
              <Link key={item.key} href={item.href} className={`app-mtab${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined}>
                <NavIcon name={item.key} size={19} />
                <span>{tNav(item.key)}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

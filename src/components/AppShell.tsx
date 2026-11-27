'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { usePermissions } from '@/features/shared/permissions/can';
import type { AppLocale } from '@/i18n/locale';
import {
  ADMIN_NAV,
  NavIcon,
  NavList,
  WORKSPACE_NAV,
  isNavItemActive,
  isNavPermitted,
  type AppNavKey,
  type NavItemConfig,
} from './AppShellNav';
import { ClubLogo } from './ClubLogo';
import { ClubWordmark } from './ClubWordmark';
import { LanguageSwitch } from './LanguageSwitch';
import { MemberAvatar } from './MemberAvatar';

export type { AppNavKey } from './AppShellNav';

export interface AppShellUser {
  id?: string;
  fullName: string;
  avatarUrl?: string | null;
  roleLabel?: string;
  isActive?: boolean;
}

export interface AppShellProps {
  activeNav?: AppNavKey;
  title?: string;
  breadcrumb?: string;
  actions?: ReactNode;
  notificationsSlot?: ReactNode;
  user?: AppShellUser | null;
  fullHeight?: boolean;
  onSignOut?: () => void;
  onLocaleChange?: (locale: AppLocale) => unknown | Promise<unknown>;
  children: ReactNode;
}

function SidebarUserRow({ user, onSignOut }: { user: AppShellUser; onSignOut?: () => void }) {
  const tNav = useTranslations('nav');
  const tMember = useTranslations('member');
  return (
    <div className="app-user">
      <MemberAvatar memberId={user.id} fullName={user.fullName} avatarUrl={user.avatarUrl} isActive={user.isActive} />
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
  onLocaleChange?: (locale: AppLocale) => unknown | Promise<unknown>;
  onNavigate?: () => void;
}

function SidebarContent({
  workspaceItems,
  adminItems,
  activeNav,
  pathname,
  user,
  onSignOut,
  onLocaleChange,
  onNavigate,
}: SidebarContentProps) {
  const tNav = useTranslations('nav');
  const tLang = useTranslations('language');
  return (
    <>
      <Link href="/tasks" className="app-brand" onClick={onNavigate}>
        <ClubLogo alt="" />
        <ClubWordmark className="app-brand-text" />
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
        <div className="app-side-lang"><span>{tLang('label')}</span><LanguageSwitch onLocaleChange={onLocaleChange} /></div>
        {user ? <SidebarUserRow user={user} onSignOut={onSignOut} /> : null}
        {!user && onSignOut ? (
          <button type="button" className="ui-btn ghost is-sm" onClick={onSignOut}>
            {tNav('signOut')}
          </button>
        ) : null}
      </div>
    </>
  );
}

function AppTopBar(props: {
  drawerOpen: boolean;
  onOpenMenu: () => void;
  breadcrumb?: string;
  title?: string;
  actions?: ReactNode;
  notificationsSlot?: ReactNode;
  onLocaleChange?: (locale: AppLocale) => unknown | Promise<unknown>;
}) {
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
        {props.notificationsSlot}
        <div className="app-top-lang"><LanguageSwitch onLocaleChange={props.onLocaleChange} /></div>
      </div>
    </header>
  );
}

function AppMobileTabs({
  workspaceItems,
  activeNav,
  pathname,
}: {
  workspaceItems: readonly NavItemConfig[];
  activeNav?: AppNavKey;
  pathname: string;
}) {
  const tNav = useTranslations('nav');
  return (
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
  );
}

function useEscapeCloseDrawer(drawerOpen: boolean, closeDrawer: () => void) {
  useEffect(() => {
    if (!drawerOpen) return;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') closeDrawer();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [drawerOpen, closeDrawer]);
}

export function AppShell(props: AppShellProps) {
  const pathname = usePathname() ?? '/';
  const tApp = useTranslations('app');
  const tNav = useTranslations('nav');
  const permCheck = usePermissions();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEscapeCloseDrawer(drawerOpen, () => setDrawerOpen(false));

  const workspaceItems = WORKSPACE_NAV.filter((item) => isNavPermitted(item, permCheck));
  const adminItems = ADMIN_NAV.filter((item) => isNavPermitted(item, permCheck));
  const sidebarProps = {
    workspaceItems,
    adminItems,
    activeNav: props.activeNav,
    pathname,
    user: props.user,
    onSignOut: props.onSignOut,
    onLocaleChange: props.onLocaleChange,
  };

  return (
    <div className={`app-shell${props.fullHeight ? ' is-full-height' : ''}`} data-component="AppShell">
      <a className="skip" href="#main-content">{tApp('skipToContent')}</a>
      <aside className="app-side" data-component="AppSidebar"><SidebarContent {...sidebarProps} /></aside>
      {drawerOpen ? (
        <div className="app-drawer-layer" role="dialog" aria-modal="true" aria-label={tNav('drawerAriaLabel')}>
          <button type="button" className="app-drawer-scrim" aria-label={tNav('closeMenu')} onClick={() => setDrawerOpen(false)} />
          <aside className="app-drawer"><SidebarContent {...sidebarProps} onNavigate={() => setDrawerOpen(false)} /></aside>
        </div>
      ) : null}
      <div className="app-main">
        <AppTopBar
          drawerOpen={drawerOpen}
          onOpenMenu={() => setDrawerOpen(true)}
          breadcrumb={props.breadcrumb}
          title={props.title}
          actions={props.actions}
          notificationsSlot={props.notificationsSlot}
          onLocaleChange={props.onLocaleChange}
        />
        <main id="main-content" className="app-scroll">{props.children}</main>
        <AppMobileTabs workspaceItems={workspaceItems} activeNav={props.activeNav} pathname={pathname} />
      </div>
    </div>
  );
}

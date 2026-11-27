'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { usePermissions, PermissionCode } from '@/features/shared/permissions/can';

export type AppNavKey =
  | 'tasks'
  | 'myTasks'
  | 'progress'
  | 'members'
  | 'archive'
  | 'profile'
  | 'memberAdmin'
  | 'permissions'
  | 'departments'
  | 'branding'
  | 'reminders'
  | 'auditLog';

export interface NavItemConfig {
  key: AppNavKey;
  href: string;
  permission?: PermissionCode;
  anyOf?: readonly PermissionCode[];
  adminOnly?: boolean;
}

export const WORKSPACE_NAV: readonly NavItemConfig[] = [
  { key: 'tasks', href: '/tasks' },
  { key: 'myTasks', href: '/my-tasks' },
  { key: 'progress', href: '/progress' },
  { key: 'members', href: '/members', permission: 'member.view' },
  { key: 'archive', href: '/archive', anyOf: ['task.delete', 'member.deactivate', 'board.delete'] },
  { key: 'profile', href: '/profile' },
];

export const ADMIN_NAV: readonly NavItemConfig[] = [
  { key: 'memberAdmin', href: '/admin/members', anyOf: ['member.create', 'member.update', 'member.deactivate'] },
  { key: 'permissions', href: '/admin/permissions', adminOnly: true },
  { key: 'departments', href: '/admin/departments', permission: 'department.manage' },
  { key: 'branding', href: '/admin/branding', adminOnly: true },
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
  tasks: <><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M8 2v4M16 2v4M3 10h18" /></>,
  myTasks: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M8 12l3 3 5-6" /></>,
  progress: <><path d="M4 19h16M7 15v-4M12 15V7M17 15v-6" /></>,
  members: MEMBERS_ICON,
  archive: <><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8M10 12h4" /></>,
  profile: <><circle cx="12" cy="8" r="3.4" /><path d="M5 20c.7-3.7 3.2-5.8 7-5.8s6.3 2.1 7 5.8" /></>,
  memberAdmin: MEMBERS_ICON,
  permissions: <><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l2 2M14 9l2 2" /></>,
  departments: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3" /></>,
  branding: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.5" /><path d="M21 15l-4.5-4.5L7 20" /></>,
  reminders: <><path d="M6 9a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13 6 9z" /><path d="M10 18a2 2 0 0 0 4 0" /></>,
  auditLog: <><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="3.5" cy="6" r=".9" fill="currentColor" stroke="none" /><circle cx="3.5" cy="12" r=".9" fill="currentColor" stroke="none" /><circle cx="3.5" cy="18" r=".9" fill="currentColor" stroke="none" /></>,
};

export function NavIcon({ name, size = 16 }: { name: AppNavKey; size?: number }) {
  return (
    <svg className="ic" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {NAV_ICON_PATHS[name]}
    </svg>
  );
}

export function isNavItemActive(item: NavItemConfig, activeNav?: AppNavKey, pathname?: string): boolean {
  if (activeNav) {
    return item.key === activeNav;
  }
  return Boolean(pathname && pathname.startsWith(item.href));
}

export function isNavPermitted(item: NavItemConfig, permCheck: ReturnType<typeof usePermissions>): boolean {
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

export function NavList(props: {
  items: readonly NavItemConfig[];
  activeNav?: AppNavKey;
  pathname: string;
  ariaLabel?: string;
  onNavigate?: () => void;
}) {
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

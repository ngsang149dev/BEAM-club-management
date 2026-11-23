'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { components } from '../api/schema';

export type PermissionCode = components['schemas']['PermissionCode'];

export interface PermissionsContextValue {
  isAdmin: boolean;
  permissions: readonly PermissionCode[];
  can: (permission: PermissionCode) => boolean;
  canAny: (permissions: readonly PermissionCode[]) => boolean;
}

const EMPTY_PERMISSIONS: readonly PermissionCode[] = [];

const PermissionsContext = createContext<PermissionsContextValue>({
  isAdmin: false,
  permissions: EMPTY_PERMISSIONS,
  can: () => false,
  canAny: () => false,
});

export interface PermissionsProviderProps {
  isAdmin?: boolean;
  permissions?: readonly PermissionCode[];
  children: ReactNode;
}

export function PermissionsProvider({
  isAdmin = false,
  permissions = EMPTY_PERMISSIONS,
  children,
}: PermissionsProviderProps) {
  const value = useMemo<PermissionsContextValue>(() => {
    const granted = new Set<PermissionCode>(permissions);
    return {
      isAdmin,
      permissions,
      can: (permission) => isAdmin || granted.has(permission),
      canAny: (codes) => isAdmin || codes.some((code) => granted.has(code)),
    };
  }, [isAdmin, permissions]);

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

export function usePermissions(): PermissionsContextValue {
  return useContext(PermissionsContext);
}

export interface CanProps {
  permission?: PermissionCode;
  anyOf?: readonly PermissionCode[];
  adminOnly?: boolean;
  fallback?: ReactNode;
  children: ReactNode;
}

export function Can({
  permission,
  anyOf,
  adminOnly = false,
  fallback = null,
  children,
}: CanProps) {
  const { isAdmin, can, canAny } = usePermissions();

  if (adminOnly) {
    return isAdmin ? <>{children}</> : <>{fallback}</>;
  }
  if (permission) {
    return can(permission) ? <>{children}</> : <>{fallback}</>;
  }
  if (anyOf && anyOf.length > 0) {
    return canAny(anyOf) ? <>{children}</> : <>{fallback}</>;
  }
  return <>{fallback}</>;
}

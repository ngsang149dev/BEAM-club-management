import { forbidden, unauthorized } from '@/lib/errors';
import type { PermissionCode } from '@/lib/permissions';

export interface AuthActor {
  readonly id: string;
  readonly isActive: boolean;
  readonly isAdmin: boolean;
  readonly permissions: readonly PermissionCode[];
  readonly departmentIds?: readonly string[];
}

export function hasPermission(actor: AuthActor, permission: PermissionCode): boolean {
  if (!actor.isActive) {
    return false;
  }
  if (actor.isAdmin) {
    return true;
  }
  return actor.permissions.includes(permission);
}

export function authorize(actor: AuthActor, permission: PermissionCode): void {
  if (!actor.isActive) {
    throw unauthorized('errors.unauthorized', {}, 'ACCOUNT_INACTIVE');
  }
  if (!hasPermission(actor, permission)) {
    throw forbidden('errors.forbidden', { requiredPermission: permission });
  }
}

export function authorizeAdmin(actor: AuthActor): void {
  if (!actor.isActive) {
    throw unauthorized('errors.unauthorized', {}, 'ACCOUNT_INACTIVE');
  }
  if (!actor.isAdmin) {
    throw forbidden('errors.forbidden', { requiresAdmin: true });
  }
}

import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import { PERMISSIONS } from '@/lib/permissions';
import {
  type AuthActor,
  authorize,
  authorizeAdmin,
  hasPermission,
} from '@/server/shared/authorize';

const MEMBER_ACTOR: AuthActor = {
  id: 'user-member-1',
  isActive: true,
  isAdmin: false,
  permissions: ['member.view', 'task.create'],
};

const ADMIN_ACTOR: AuthActor = {
  id: 'user-admin-1',
  isActive: true,
  isAdmin: true,
  permissions: [],
};

const INACTIVE_ADMIN_ACTOR: AuthActor = {
  id: 'user-inactive-admin',
  isActive: false,
  isAdmin: true,
  permissions: PERMISSIONS.map((permission) => permission.code),
};

const INACTIVE_MEMBER_ACTOR: AuthActor = {
  id: 'user-inactive-member',
  isActive: false,
  isAdmin: false,
  permissions: ['member.view'],
};

describe('authorize & hasPermission', () => {
  it('grants granted permissions and denies missing permissions for active members', () => {
    expect(hasPermission(MEMBER_ACTOR, 'member.view')).toBe(true);
    expect(hasPermission(MEMBER_ACTOR, 'task.create')).toBe(true);
    expect(hasPermission(MEMBER_ACTOR, 'board.create')).toBe(false);

    expect(() => authorize(MEMBER_ACTOR, 'member.view')).not.toThrow();
    expect(() => authorize(MEMBER_ACTOR, 'board.create')).toThrowError(AppError);

    try {
      authorize(MEMBER_ACTOR, 'board.create');
    } catch (error) {
      const appError = error as AppError;
      expect(appError.httpStatus).toBe(403);
      expect(appError.code).toBe('FORBIDDEN');
      expect(appError.messageKey).toBe('errors.forbidden');
    }
  });

  it('grants every catalog permission and admin checks to active admins', () => {
    for (const permission of PERMISSIONS) {
      expect(hasPermission(ADMIN_ACTOR, permission.code)).toBe(true);
      expect(() => authorize(ADMIN_ACTOR, permission.code)).not.toThrow();
    }
    expect(() => authorizeAdmin(ADMIN_ACTOR)).not.toThrow();
  });

  it('checks every single one of the 18 PERMISSIONS individually on non-admin actors', () => {
    for (const granted of PERMISSIONS) {
      const actor: AuthActor = {
        id: 'user-single-perm',
        isActive: true,
        isAdmin: false,
        permissions: [granted.code],
      };

      expect(hasPermission(actor, granted.code)).toBe(true);
      expect(() => authorize(actor, granted.code)).not.toThrow();

      for (const other of PERMISSIONS) {
        if (other.code === granted.code) continue;
        expect(hasPermission(actor, other.code)).toBe(false);
        expect(() => authorize(actor, other.code)).toThrowError(AppError);
      }
    }
  });

  it('rejects non-admin actors in authorizeAdmin with 403', () => {
    try {
      authorizeAdmin(MEMBER_ACTOR);
      expect.unreachable('Expected authorizeAdmin to throw');
    } catch (error) {
      const appError = error as AppError;
      expect(appError).toBeInstanceOf(AppError);
      expect(appError.httpStatus).toBe(403);
      expect(appError.code).toBe('FORBIDDEN');
      expect(appError.messageKey).toBe('errors.forbidden');
    }
  });

  it('rejects inactive users with 401 regardless of admin flag or permissions', () => {
    for (const actor of [INACTIVE_ADMIN_ACTOR, INACTIVE_MEMBER_ACTOR]) {
      expect(hasPermission(actor, 'member.view')).toBe(false);

      for (const invoke of [
        () => authorize(actor, 'member.view'),
        () => authorizeAdmin(actor),
      ]) {
        try {
          invoke();
          expect.unreachable('Expected 401 AppError');
        } catch (error) {
          const appError = error as AppError;
          expect(appError).toBeInstanceOf(AppError);
          expect(appError.httpStatus).toBe(401);
          expect(appError.code).toBe('ACCOUNT_INACTIVE');
          expect(appError.messageKey).toBe('errors.unauthorized');
        }
      }
    }
  });
});

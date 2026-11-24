import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import {
  createMemberRequestSchema,
  isAllowedEmailDomain,
  listMembersQuerySchema,
  resetMemberPasswordRequestSchema,
  updateMemberRequestSchema,
} from '@/lib/members';
import {
  assertAllowedEmailDomain,
  assertCanResetMemberPassword,
  canViewMemberDetail,
  decodeMemberCursor,
  encodeMemberCursor,
  escapeLikePattern,
} from '@/server/modules/members';
import type { AuthActor } from '@/server/shared/authorize';

describe('members policy & shared schemas', () => {
  it('validates allowed email domain strictly (rejects lookalikes & subdomains, AC-14)', () => {
    expect(isAllowedEmailDomain('member@eiu.edu.vn', 'eiu.edu.vn')).toBe(true);
    expect(isAllowedEmailDomain('  Member@EIU.EDU.VN ', '@EIU.EDU.VN')).toBe(true);

    const badEmails = [
      'member@gmail.com',
      'member@sub.eiu.edu.vn',
      'member@evil-eiu.edu.vn',
      'member@eiu.edu.vn.evil.com',
      '@eiu.edu.vn',
      'member@',
      'a@b@eiu.edu.vn',
      'no-at-sign',
    ];
    for (const email of badEmails) {
      expect(isAllowedEmailDomain(email, 'eiu.edu.vn')).toBe(false);
      expect(() => assertAllowedEmailDomain(email, 'eiu.edu.vn')).toThrowError(
        AppError,
      );
    }

    try {
      assertAllowedEmailDomain('bad@gmail.com', 'eiu.edu.vn');
    } catch (error) {
      const appError = error as AppError;
      expect(appError.httpStatus).toBe(400);
      expect(appError.code).toBe('INVALID_EMAIL_DOMAIN');
      expect(appError.details).toEqual({ allowedDomain: 'eiu.edu.vn' });
    }
  });

  it('evaluates canViewMemberDetail strictly for active detail viewers and admins', () => {
    const basic: AuthActor = {
      id: 'u1',
      isActive: true,
      isAdmin: false,
      permissions: ['member.view', 'member.create', 'member.update'],
    };
    const detailViewer: AuthActor = {
      id: 'u2',
      isActive: true,
      isAdmin: false,
      permissions: ['member.view', 'member.view_detail'],
    };
    const admin: AuthActor = {
      id: 'u3',
      isActive: true,
      isAdmin: true,
      permissions: [],
    };
    const inactiveAdmin: AuthActor = {
      id: 'u4',
      isActive: false,
      isAdmin: true,
      permissions: ['member.view_detail'],
    };

    expect(canViewMemberDetail(basic)).toBe(false);
    expect(canViewMemberDetail(detailViewer)).toBe(true);
    expect(canViewMemberDetail(admin)).toBe(true);
    expect(canViewMemberDetail(inactiveAdmin)).toBe(false);
  });

  it('allows non-admin member.update only on non-admin targets when resetting passwords', () => {
    const manager: AuthActor = {
      id: 'u1',
      isActive: true,
      isAdmin: false,
      permissions: ['member.update'],
    };
    const admin: AuthActor = {
      id: 'u2',
      isActive: true,
      isAdmin: true,
      permissions: [],
    };

    expect(() =>
      assertCanResetMemberPassword(manager, { isAdmin: false }),
    ).not.toThrow();
    expect(() =>
      assertCanResetMemberPassword(admin, { isAdmin: true }),
    ).not.toThrow();

    try {
      assertCanResetMemberPassword(manager, { isAdmin: true });
      throw new Error('Expected AppError');
    } catch (error) {
      const appError = error as AppError;
      expect(appError.httpStatus).toBe(403);
      expect(appError.code).toBe('FORBIDDEN');
      expect(appError.details).toEqual({ requiresAdmin: true });
    }
  });

  it('encodes and decodes keyset cursors and rejects tampered cursors', () => {
    const cursor = {
      fullName: 'Nguyen Van A',
      id: '10000000-0000-4000-8000-000000000001',
    };
    const encoded = encodeMemberCursor(cursor);
    expect(decodeMemberCursor(encoded)).toEqual(cursor);

    const invalidCursors = [
      'not-valid-base64!!!',
      `${encoded}=`,
      Buffer.from('{"fullName":"","id":"10000000-0000-4000-8000-000000000001"}').toString(
        'base64url',
      ),
      Buffer.from('{"fullName":"Alice","id":"not-a-uuid"}').toString('base64url'),
      Buffer.from('null').toString('base64url'),
    ];

    for (const raw of invalidCursors) {
      expect(() => decodeMemberCursor(raw)).toThrowError(AppError);
      try {
        decodeMemberCursor(raw);
      } catch (error) {
        expect((error as AppError).httpStatus).toBe(400);
        expect((error as AppError).code).toBe('INVALID_CURSOR');
      }
    }
  });

  it('escapes LIKE/ILIKE wildcards safely', () => {
    expect(escapeLikePattern('100%_test\\name')).toBe('100\\%\\_test\\\\name');
  });

  it('enforces WQ-21 immutability in updateMemberRequestSchema and query validation', () => {
    expect(
      updateMemberRequestSchema.safeParse({
        fullName: 'Updated Name',
        studentId: 'MSSV-HACK',
      }).success,
    ).toBe(false);

    expect(
      updateMemberRequestSchema.safeParse({
        isAdmin: true,
      }).success,
    ).toBe(false);

    expect(
      createMemberRequestSchema.parse({
        studentId: ' MSSV-DEV-900 ',
        email: ' Dev.Member@EIU.EDU.VN ',
        fullName: '  Member Test  ',
      }),
    ).toEqual({
      studentId: 'MSSV-DEV-900',
      email: 'dev.member@eiu.edu.vn',
      fullName: 'Member Test',
      departmentIds: [],
      locale: 'vi',
    });

    expect(
      listMembersQuerySchema.parse({
        q: '   ',
        departmentId: null,
        isActive: '',
        cursor: null,
        limit: null,
      }),
    ).toEqual({
      q: undefined,
      departmentId: undefined,
      isActive: undefined,
      cursor: undefined,
      limit: 20,
    });

    expect(listMembersQuerySchema.parse({ isActive: 'false' }).isActive).toBe(false);
    expect(listMembersQuerySchema.safeParse({ isActive: 'maybe' }).success).toBe(false);
    expect(listMembersQuerySchema.safeParse({ limit: '101' }).success).toBe(false);

    expect(
      createMemberRequestSchema.parse({
        studentId: 'MSSV-DEV-901',
        email: 'pw@eiu.edu.vn',
        fullName: 'Password Member',
        initialPassword: 'CustomInitial#2026',
      }).initialPassword,
    ).toBe('CustomInitial#2026');
    expect(
      createMemberRequestSchema.safeParse({
        studentId: 'MSSV-DEV-902',
        email: 'pw2@eiu.edu.vn',
        fullName: 'Short Pass',
        initialPassword: 'short',
      }).success,
    ).toBe(false);

    expect(
      resetMemberPasswordRequestSchema.parse({ newPassword: 'ResetPass#2026' }),
    ).toEqual({ newPassword: 'ResetPass#2026' });
    expect(
      resetMemberPasswordRequestSchema.safeParse({ newPassword: '        ' })
        .success,
    ).toBe(false);
    expect(
      resetMemberPasswordRequestSchema.safeParse({
        newPassword: 'ResetPass#2026',
        extra: 'nope',
      }).success,
    ).toBe(false);
  });
});

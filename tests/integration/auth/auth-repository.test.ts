import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { inArray } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  departments,
  loginAttempts,
  memberDepartments,
  permissions,
  profiles,
  sessions,
  userPermissions,
} from '@db/schema';
import { DrizzleAuthRepository } from '@/server/modules/auth';
import { createDb, createDbPool, type Database } from '@/server/shared/db';

function loadEnvLocalIfMissing(): void {
  if (process.env.TEST_DATABASE_URL) return;
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

describe('DrizzleAuthRepository integration', () => {
  let pool: Pool;
  let db: Database;
  let repo: DrizzleAuthRepository;
  const suffix = randomUUID().slice(0, 8);
  const userId = randomUUID();
  const deptId = randomUUID();
  const testIp = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
  const studentId = `MSSV-REPO-${suffix}`;

  beforeAll(async () => {
    loadEnvLocalIfMissing();
    const testDbUrl = process.env.TEST_DATABASE_URL;
    if (!testDbUrl) {
      throw new Error('TEST_DATABASE_URL is required for auth repository tests');
    }
    pool = createDbPool(testDbUrl);
    db = createDb(pool);
    repo = new DrizzleAuthRepository(db);

    await db
      .insert(permissions)
      .values([
        {
          code: 'member.view',
          groupName: 'members',
          description: 'View directory',
          scopable: false,
        },
        {
          code: 'board.create',
          groupName: 'boards',
          description: 'Create board',
          scopable: false,
        },
      ])
      .onConflictDoNothing();

    await db.insert(departments).values({
      id: deptId,
      name: `Auth Repo Dept ${suffix}`,
    });

    await db.insert(profiles).values({
      id: userId,
      studentId,
      email: `repo-${suffix}@eiu.edu.vn`,
      fullName: `Repo Test Member ${suffix}`,
      isAdmin: false,
      isActive: true,
      locale: 'vi',
    });

    await db.insert(memberDepartments).values({
      userId,
      departmentId: deptId,
    });

    await db.insert(userPermissions).values([
      { userId, permissionCode: 'member.view', grantedBy: null },
      { userId, permissionCode: 'board.create', grantedBy: null },
    ]);
  });

  afterAll(async () => {
    if (db) {
      await db.delete(sessions).where(inArray(sessions.userId, [userId]));
      await db
        .delete(userPermissions)
        .where(inArray(userPermissions.userId, [userId]));
      await db
        .delete(memberDepartments)
        .where(inArray(memberDepartments.userId, [userId]));
      await db.delete(loginAttempts).where(inArray(loginAttempts.ip, [testIp]));
      await db.delete(profiles).where(inArray(profiles.id, [userId]));
      await db.delete(departments).where(inArray(departments.id, [deptId]));
    }
    await pool?.end();
  });

  it('reads profile with departments and live permissions, and persists sessions & locale', async () => {
    const byStudent = await repo.findProfileWithDepartmentsByStudentId(studentId);
    expect(byStudent?.id).toBe(userId);
    expect(byStudent?.departments).toEqual([
      { id: deptId, name: `Auth Repo Dept ${suffix}` },
    ]);

    const byId = await repo.findProfileWithDepartmentsById(userId);
    expect(byId?.studentId).toBe(studentId);

    const perms = await repo.findUserPermissions(userId);
    expect(perms.sort()).toEqual(['board.create', 'member.view']);

    const now = new Date('2026-11-24T01:00:00.000Z');
    const expires = new Date('2026-11-25T01:00:00.000Z');
    const tokenHash = `hash-${suffix}`;
    const createdSession = await repo.createSession({
      userId,
      tokenHash,
      rememberMe: false,
      expiresAt: expires,
      now,
    });
    expect(createdSession.revokedAt).toBeNull();

    const foundSession = await repo.findSessionByTokenHash(tokenHash);
    expect(foundSession?.id).toBe(createdSession.id);

    const touchedAt = new Date('2026-11-24T02:00:00.000Z');
    await repo.touchSession({
      sessionId: createdSession.id,
      lastSeenAt: touchedAt,
      expiresAt: expires,
    });
    const afterTouch = await repo.findSessionByTokenHash(tokenHash);
    expect(afterTouch?.lastSeenAt.toISOString()).toBe(touchedAt.toISOString());

    const updatedProfile = await repo.updateProfileLocale({
      userId,
      locale: 'en',
      updatedAt: touchedAt,
    });
    expect(updatedProfile?.locale).toBe('en');

    await repo.revokeSession({
      sessionId: createdSession.id,
      revokedAt: touchedAt,
    });
    const afterRevoke = await repo.findSessionByTokenHash(tokenHash);
    expect(afterRevoke?.revokedAt?.toISOString()).toBe(touchedAt.toISOString());

    await repo.recordLoginAttempt({
      studentId,
      ip: testIp,
      success: false,
      createdAt: now,
    });
    await repo.recordLoginAttempt({
      studentId,
      ip: testIp,
      success: true,
      createdAt: touchedAt,
    });
    const recentFailed = await repo.countRecentFailedLoginAttempts(
      testIp,
      new Date('2026-11-24T00:50:00.000Z'),
    );
    expect(recentFailed).toBe(1);
  });
});

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boards, columns, permissions, profiles, taskAssignees, taskEvents, tasks, userPermissions } from '@db/schema';
import { POST as loginPost } from '@/app/api/v1/auth/login/route';
import { POST as taskMovePost } from '@/app/api/v1/tasks/[id]/move/route';
import { SESSION_COOKIE_NAME } from '@/lib/auth';
import { DrizzleAuditRepository } from '@/server/modules/audit';
import { DrizzleAuthRepository } from '@/server/modules/auth';
import { DrizzleBoardsRepository } from '@/server/modules/boards';
import { DrizzleDepartmentsRepository } from '@/server/modules/departments';
import { DrizzleMembersRepository } from '@/server/modules/members';
import { DrizzlePermissionsRepository } from '@/server/modules/permissions';
import { DrizzleTasksRepository } from '@/server/modules/tasks';
import { createContainer, setContainerForTesting } from '@/server/shared/composition';
import type { Config } from '@/server/shared/config';
import { createDb, createDbPool, type Database } from '@/server/shared/db';
import { StructuredLogger } from '@/server/shared/logger';
import { DEV_SEED_PASSWORD, hashPassword } from '@/server/shared/password';
import type { TransactionContext } from '@/server/shared/transaction';

class TestRollbackSentinel extends Error {}

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

async function withRolledBackDb(db: Database, fn: (tx: TransactionContext) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx);
      throw new TestRollbackSentinel();
    });
  } catch (error) {
    if (!(error instanceof TestRollbackSentinel)) throw error;
  }
}

function cookiePairFromLogin(res: Response): string {
  const line = res.headers.getSetCookie().find((entry) => entry.startsWith(`${SESSION_COOKIE_NAME}=`));
  expect(line).toBeDefined();
  return line!.split(';')[0]!;
}

describe('POST /api/v1/tasks/[id]/move integration', () => {
  let pool: Pool;
  let db: Database;

  beforeAll(() => {
    loadEnvLocalIfMissing();
    const testDbUrl = process.env.TEST_DATABASE_URL;
    if (!testDbUrl) throw new Error('TEST_DATABASE_URL is required for tasks move integration tests');
    pool = createDbPool(testDbUrl);
    db = createDb(pool);
  });

  afterAll(async () => {
    setContainerForTesting(undefined);
    await pool?.end();
  });

  it('enforces 401/403/404/400/409, cross-column move, rebalance on tight gap, task.moved event, and zero PII', async () => {
    const suffix = randomUUID().slice(0, 8);
    const adminId = randomUUID();
    const assignedId = randomUUID();
    const anyEditorId = randomUUID();
    const adminSid = `MSSV-MVADM-${suffix}`;
    const assignedSid = `MSSV-MVASS-${suffix}`;
    const anySid = `MSSV-MVANY-${suffix}`;
    const baseHost = Math.floor(Math.random() * 140) + 10;
    const logs: string[] = [];

    const testConfig: Config = {
      nodeEnv: 'test',
      databaseUrl: process.env.TEST_DATABASE_URL!,
      testDatabaseUrl: process.env.TEST_DATABASE_URL!,
      sessionSecret: `move-test-secret-${suffix}-0123456789`,
      sessionTtlDefaultHours: 24,
      sessionTtlRememberDays: 30,
      allowedEmailDomain: 'eiu.edu.vn',
      cronSecret: 'move-cron-secret',
      smtp: {},
      appUrl: 'http://localhost:3000',
      undoToastSeconds: 10,
    };

    await withRolledBackDb(db, async (tx) => {
      const container = createContainer({
        config: testConfig,
        db,
        transactionRunner: { runInTransaction: (fn) => tx.transaction(fn) },
        auditWriter: new DrizzleAuditRepository(tx),
        auditRepo: new DrizzleAuditRepository(tx),
        authRepo: new DrizzleAuthRepository(tx),
        departmentsRepo: new DrizzleDepartmentsRepository(tx),
        membersRepo: new DrizzleMembersRepository(tx),
        permissionsRepo: new DrizzlePermissionsRepository(tx),
        tasksRepo: new DrizzleTasksRepository(tx),
        boardsRepo: new DrizzleBoardsRepository(tx),
        logger: new StructuredLogger({
          writeOut: (line) => logs.push(line),
          writeErr: (line) => logs.push(line),
        }),
      });
      setContainerForTesting(container);

      await tx.insert(permissions).values([
        { code: 'task.update_any', groupName: 'tasks', description: 'TUA', scopable: false },
        { code: 'task.update_assigned', groupName: 'tasks', description: 'TUAS', scopable: false },
      ]).onConflictDoNothing();

      const seedPasswordHash = await hashPassword(DEV_SEED_PASSWORD);
      await tx.insert(profiles).values([
        { id: adminId, studentId: adminSid, email: `mv-adm-${suffix}@eiu.edu.vn`, fullName: `Move Admin ${suffix}`, passwordHash: seedPasswordHash, isAdmin: true, isActive: true, locale: 'vi' },
        { id: assignedId, studentId: assignedSid, email: `mv-ass-${suffix}@eiu.edu.vn`, fullName: `Move Assigned ${suffix}`, passwordHash: seedPasswordHash, isAdmin: false, isActive: true, locale: 'en' },
        { id: anyEditorId, studentId: anySid, email: `mv-any-${suffix}@eiu.edu.vn`, fullName: `Move Any ${suffix}`, passwordHash: seedPasswordHash, isAdmin: false, isActive: true, locale: 'vi' },
      ]);
      await tx.insert(userPermissions).values([
        { userId: assignedId, permissionCode: 'task.update_assigned', grantedBy: null },
        { userId: anyEditorId, permissionCode: 'task.update_any', grantedBy: null },
      ]);

      const boardId = randomUUID();
      const otherBoardId = randomUUID();
      const todoColId = randomUUID();
      const doingColId = randomUUID();
      const otherBoardColId = randomUUID();
      await tx.insert(boards).values([
        { id: boardId, name: `Move Board ${suffix}`, createdBy: adminId },
        { id: otherBoardId, name: `Other Move Board ${suffix}`, createdBy: adminId },
      ]);
      await tx.insert(columns).values([
        { id: todoColId, boardId, name: 'Todo', orderIndex: 0 },
        { id: doingColId, boardId, name: 'Doing', orderIndex: 1 },
        { id: otherBoardColId, boardId: otherBoardId, name: 'Todo', orderIndex: 0 },
      ]);

      const movedTaskId = randomUUID();
      const unassignedTaskId = randomUUID();
      const hiddenTaskId = randomUUID();
      const tightAId = randomUUID();
      const tightBId = randomUUID();
      await tx.insert(tasks).values([
        { id: movedTaskId, boardId, columnId: todoColId, title: `Movable ${suffix}`, priority: 2, position: '1000', isHidden: false, version: 1, createdBy: adminId },
        { id: unassignedTaskId, boardId, columnId: todoColId, title: `Unassigned ${suffix}`, priority: 2, position: '2000', isHidden: false, version: 1, createdBy: adminId },
        { id: hiddenTaskId, boardId, columnId: doingColId, title: `HiddenSib ${suffix}`, priority: 3, position: '1000.0001', isHidden: true, version: 1, createdBy: adminId },
        { id: tightAId, boardId, columnId: doingColId, title: `TightA ${suffix}`, priority: 2, position: '1000', isHidden: false, version: 1, createdBy: adminId },
        { id: tightBId, boardId, columnId: doingColId, title: `TightB ${suffix}`, priority: 2, position: '1000.0005', isHidden: false, version: 1, createdBy: adminId },
      ]);
      await tx.insert(taskAssignees).values({ taskId: movedTaskId, userId: assignedId });

      const loginAs = async (studentId: string, hostOffset: number) =>
        cookiePairFromLogin(await loginPost(new Request('http://localhost:3000/api/v1/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${baseHost + hostOffset}` },
          body: JSON.stringify({ studentId, password: DEV_SEED_PASSWORD }),
        })));

      const assignedCookie = await loginAs(assignedSid, 0);
      const anyEditorCookie = await loginAs(anySid, 1);

      const postMove = (id: string, body: unknown, cookie?: string) =>
        taskMovePost(
          new Request(`http://localhost:3000/api/v1/tasks/${id}/move`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(cookie ? { cookie } : {}),
            },
            body: JSON.stringify(body),
          }),
          { params: Promise.resolve({ id }) },
        );

      // 401, 403, 404 hidden, 400 other-board column, 400 hidden sibling, 409 stale version
      expect((await postMove(movedTaskId, { columnId: doingColId, version: 1 })).status).toBe(401);
      expect((await postMove(unassignedTaskId, { columnId: doingColId, version: 1 }, assignedCookie)).status).toBe(403);
      expect((await postMove(hiddenTaskId, { columnId: todoColId, version: 1 }, anyEditorCookie)).status).toBe(404);

      const mismatchRes = await postMove(movedTaskId, { columnId: otherBoardColId, version: 1 }, assignedCookie);
      expect(mismatchRes.status).toBe(400);
      expect(((await mismatchRes.json()) as { error: { code: string; messageKey: string } }).error).toMatchObject({
        code: 'BOARD_COLUMN_MISMATCH',
        messageKey: 'errors.boardColumnMismatch',
      });

      const hiddenSibRes = await postMove(movedTaskId, { columnId: doingColId, beforeId: hiddenTaskId, version: 1 }, assignedCookie);
      expect(hiddenSibRes.status).toBe(400);
      expect(((await hiddenSibRes.json()) as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');

      const staleRes = await postMove(movedTaskId, { columnId: doingColId, version: 99 }, assignedCookie);
      expect(staleRes.status).toBe(409);
      expect(((await staleRes.json()) as { error: { code: string; messageKey: string } }).error).toMatchObject({
        code: 'TASK_VERSION_CONFLICT',
        messageKey: 'errors.taskVersionConflict',
      });

      // Cross-column move by assigned user between tightAId (1000) and tightBId (1000.0005) triggers rebalance!
      const moveRes = await postMove(
        movedTaskId,
        { columnId: doingColId, beforeId: tightAId, afterId: tightBId, version: 1 },
        assignedCookie,
      );
      expect(moveRes.status).toBe(200);
      const moveBody = (await moveRes.json()) as { task: { columnId: string; position: number; version: number }; eventId: string };
      expect(moveBody.task.columnId).toBe(doingColId);
      expect(moveBody.task.version).toBe(2);
      expect(moveBody.task.position).toBe(2000);
      expect(moveBody.eventId).toBeTruthy();

      const [tightAAfter] = await tx.select({ position: tasks.position, version: tasks.version }).from(tasks).where(eq(tasks.id, tightAId));
      const [hiddenAfter] = await tx.select({ position: tasks.position, version: tasks.version }).from(tasks).where(eq(tasks.id, hiddenTaskId));
      const [tightBAfter] = await tx.select({ position: tasks.position, version: tasks.version }).from(tasks).where(eq(tasks.id, tightBId));
      expect(Number(tightAAfter?.position)).toBe(1000);
      expect(Number(hiddenAfter?.position)).toBe(3000);
      expect(Number(tightBAfter?.position)).toBe(4000);
      expect(tightAAfter?.version).toBe(1);
      expect(tightBAfter?.version).toBe(1);

      // No-op move in Doing returns eventId: null & keeps version=2
      const noopRes = await postMove(
        movedTaskId,
        { columnId: doingColId, beforeId: tightAId, afterId: tightBId, version: 2 },
        assignedCookie,
      );
      expect(noopRes.status).toBe(200);
      const noopBody = (await noopRes.json()) as { task: { version: number }; eventId: string | null };
      expect(noopBody.eventId).toBeNull();
      expect(noopBody.task.version).toBe(2);

      // Within-column reorder after tightBId -> 5000
      const reorderRes = await postMove(
        movedTaskId,
        { columnId: doingColId, beforeId: tightBId, afterId: null, version: 2 },
        assignedCookie,
      );
      expect(reorderRes.status).toBe(200);
      expect(((await reorderRes.json()) as { task: { position: number; version: number } }).task).toMatchObject({ position: 5000, version: 3 });

      const events = await tx.select().from(taskEvents).where(eq(taskEvents.taskId, movedTaskId));
      expect(events).toHaveLength(2);
      expect(events.map((e) => e.type)).toEqual(['task.moved', 'task.moved']);
      const firstMoveEvent = events.find((e) => e.id === moveBody.eventId);
      expect(firstMoveEvent).toBeDefined();
      expect(firstMoveEvent?.revertsEventId).toBeNull();
      expect(firstMoveEvent?.forced).toBe(false);
      expect(firstMoveEvent?.changes).toEqual({
        column_id: { from: todoColId, to: doingColId },
        position: { from: 1000, to: 2000 },
      });

      const serialized = JSON.stringify([events, logs, moveBody]);
      for (const pii of [adminSid, assignedSid, anySid, `mv-adm-${suffix}`]) {
        expect(serialized).not.toContain(pii);
      }
    });
  });
});

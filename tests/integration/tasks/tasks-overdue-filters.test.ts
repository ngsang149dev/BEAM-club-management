import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  boards,
  columns,
  departments,
  memberDepartments,
  profiles,
  taskAssignees,
  taskDepartments,
  tasks,
} from '@db/schema';
import { POST as loginPost } from '@/app/api/v1/auth/login/route';
import { GET as tasksGet } from '@/app/api/v1/tasks/route';
import { SESSION_COOKIE_NAME } from '@/lib/auth';
import { DrizzleAuditRepository } from '@/server/modules/audit';
import { DrizzleAuthRepository } from '@/server/modules/auth';
import { DrizzleBoardsRepository } from '@/server/modules/boards';
import { DrizzleDepartmentsRepository } from '@/server/modules/departments';
import { DrizzleMembersRepository } from '@/server/modules/members';
import { DrizzlePermissionsRepository } from '@/server/modules/permissions';
import { DrizzleTasksRepository } from '@/server/modules/tasks';
import { FakeClock } from '@/server/shared/clock';
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

describe('GET /api/v1/tasks dueStatus=overdue & combined filters/sort integration', () => {
  let pool: Pool;
  let db: Database;

  beforeAll(() => {
    loadEnvLocalIfMissing();
    const testDbUrl = process.env.TEST_DATABASE_URL;
    if (!testDbUrl) throw new Error('TEST_DATABASE_URL is required for tasks overdue integration tests');
    pool = createDbPool(testDbUrl);
    db = createDb(pool);
  });

  afterAll(async () => {
    setContainerForTesting(undefined);
    await pool?.end();
  });

  it('excludes Done/final column tasks from dueStatus=overdue, enforces combined filters/sort, and never leaks hidden tasks or PII', async () => {
    const suffix = randomUUID().slice(0, 8);
    const fixedNow = new Date('2026-11-25T12:00:00.000Z');
    const pastDue1 = new Date('2026-11-18T12:00:00.000Z');
    const pastDue2 = new Date('2026-11-20T12:00:00.000Z');
    const futureDue = new Date('2026-11-28T12:00:00.000Z');

    const adminId = randomUUID();
    const assigneeId = randomUUID();
    const outsiderId = randomUUID();
    const deptId = randomUUID();
    const baseHost = Math.floor(Math.random() * 140) + 10;
    const logs: string[] = [];

    const adminSid = `MSSV-TOA-${suffix}`;
    const assigneeSid = `MSSV-TOB-${suffix}`;
    const outsiderSid = `MSSV-TOC-${suffix}`;

    const testConfig: Config = {
      nodeEnv: 'test',
      databaseUrl: process.env.TEST_DATABASE_URL!,
      testDatabaseUrl: process.env.TEST_DATABASE_URL!,
      sessionSecret: `tasks-overdue-secret-${suffix}-0123456789`,
      sessionTtlMinutes: 30,
      allowedEmailDomain: 'eiu.edu.vn',
      cronSecret: 'tasks-overdue-cron',
      smtp: {},
      appUrl: 'http://localhost:3000',
    };

    await withRolledBackDb(db, async (tx) => {
      const container = createContainer({
        config: testConfig,
        clock: new FakeClock(fixedNow),
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

      await tx.insert(departments).values({ id: deptId, name: `Overdue Dept ${suffix}` });
      const passwordHash = await hashPassword(DEV_SEED_PASSWORD);
      await tx.insert(profiles).values([
        { id: adminId, studentId: adminSid, email: `to-adm-${suffix}@eiu.edu.vn`, fullName: `TO Admin ${suffix}`, passwordHash, isAdmin: true, isActive: true, locale: 'vi' },
        { id: assigneeId, studentId: assigneeSid, email: `to-ass-${suffix}@eiu.edu.vn`, fullName: `TO Assignee ${suffix}`, passwordHash, isAdmin: false, isActive: true, locale: 'vi' },
        { id: outsiderId, studentId: outsiderSid, email: `to-out-${suffix}@eiu.edu.vn`, fullName: `TO Outsider ${suffix}`, passwordHash, isAdmin: false, isActive: true, locale: 'vi' },
      ]);
      await tx.insert(memberDepartments).values({ userId: assigneeId, departmentId: deptId });

      const board1Id = randomUUID();
      const board2Id = randomUUID();
      await tx.insert(boards).values([
        { id: board1Id, name: `Overdue Board 1 ${suffix}`, createdBy: adminId },
        { id: board2Id, name: `Overdue Board 2 ${suffix}`, createdBy: adminId },
      ]);

      const colTodo = randomUUID();
      const colDoing = randomUUID();
      const colDoneName = randomUUID();
      const colBoard2Final = randomUUID();
      await tx.insert(columns).values([
        { id: colTodo, boardId: board1Id, name: 'Todo', orderIndex: 0 },
        { id: colDoing, boardId: board1Id, name: 'Doing', orderIndex: 1 },
        { id: colDoneName, boardId: board1Id, name: 'Done', orderIndex: 2 },
        { id: colBoard2Final, boardId: board2Id, name: 'Finished', orderIndex: 0 },
      ]);

      const tActiveOverdue1 = randomUUID();
      const tActiveOverdue2 = randomUUID();
      const tHiddenOverdue = randomUUID();
      const tDoneNameOverdue = randomUUID();
      const tFinalOrderOverdue = randomUUID();
      const tUpcoming = randomUUID();

      await tx.insert(tasks).values([
        { id: tActiveOverdue1, boardId: board1Id, columnId: colTodo, title: `Alpha_100% ${suffix}`, startAt: pastDue1, dueAt: pastDue1, priority: 3, position: '1000', isHidden: false, createdBy: adminId },
        { id: tActiveOverdue2, boardId: board1Id, columnId: colDoing, title: `AlphaX1000 ${suffix}`, startAt: pastDue2, dueAt: pastDue2, priority: 4, position: '2000', isHidden: false, createdBy: adminId },
        { id: tHiddenOverdue, boardId: board1Id, columnId: colTodo, title: `Alpha_100% Hidden ${suffix}`, startAt: pastDue1, dueAt: pastDue1, priority: 4, position: '3000', isHidden: true, createdBy: adminId },
        { id: tDoneNameOverdue, boardId: board1Id, columnId: colDoneName, title: `Alpha_100% Done ${suffix}`, startAt: pastDue1, dueAt: pastDue1, priority: 4, position: '1000', isHidden: false, createdBy: adminId },
        { id: tFinalOrderOverdue, boardId: board2Id, columnId: colBoard2Final, title: `Final Col Overdue ${suffix}`, startAt: pastDue1, dueAt: pastDue1, priority: 4, position: '1000', isHidden: false, createdBy: adminId },
        { id: tUpcoming, boardId: board1Id, columnId: colTodo, title: `Upcoming ${suffix}`, startAt: futureDue, dueAt: futureDue, priority: 4, position: '4000', isHidden: false, createdBy: adminId },
      ]);
      await tx.insert(taskAssignees).values([
        { taskId: tActiveOverdue1, userId: assigneeId },
        { taskId: tHiddenOverdue, userId: assigneeId },
      ]);
      await tx.insert(taskDepartments).values([
        { taskId: tActiveOverdue1, departmentId: deptId },
        { taskId: tHiddenOverdue, departmentId: deptId },
      ]);

      const loginAs = async (studentId: string, offset: number) =>
        cookiePairFromLogin(await loginPost(new Request('http://localhost:3000/api/v1/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${baseHost + offset}` },
          body: JSON.stringify({ studentId, password: DEV_SEED_PASSWORD }),
        })));

      const adminCookie = await loginAs(adminSid, 0);
      const assigneeCookie = await loginAs(assigneeSid, 1);
      const outsiderCookie = await loginAs(outsiderSid, 2);

      // 1. dueStatus=overdue excludes Done & final orderIndex columns, hides hidden tasks from outsider
      const outsiderOverdueRes = await tasksGet(
        new Request(`http://localhost:3000/api/v1/tasks?boardId=${board1Id}&dueStatus=overdue&sortBy=priority&sortOrder=desc`, {
          headers: { cookie: outsiderCookie },
        }),
      );
      expect(outsiderOverdueRes.status).toBe(200);
      const outsiderOverdueBody = (await outsiderOverdueRes.json()) as { items: Array<{ id: string }> };
      expect(outsiderOverdueBody.items.map((t) => t.id)).toEqual([tActiveOverdue2, tActiveOverdue1]);

      // Board 2 final column overdue task excluded from dueStatus=overdue
      const board2OverdueRes = await tasksGet(
        new Request(`http://localhost:3000/api/v1/tasks?boardId=${board2Id}&dueStatus=overdue`, {
          headers: { cookie: adminCookie },
        }),
      );
      expect(((await board2OverdueRes.json()) as { items: unknown[] }).items).toHaveLength(0);

      // 2. Combined filters: boardId + departmentId + assigneeId + priority + dueStatus=overdue + q (LIKE escape) + sortBy/sortOrder
      const combinedOutsiderRes = await tasksGet(
        new Request(
          `http://localhost:3000/api/v1/tasks?boardId=${board1Id}&departmentId=${deptId}&assigneeId=${assigneeId}&priority=4&dueStatus=overdue&q=${encodeURIComponent('Alpha_100%')}`,
          { headers: { cookie: outsiderCookie } },
        ),
      );
      expect(((await combinedOutsiderRes.json()) as { items: unknown[] }).items).toHaveLength(0);

      const combinedAssigneeRes = await tasksGet(
        new Request(
          `http://localhost:3000/api/v1/tasks?boardId=${board1Id}&departmentId=${deptId}&assigneeId=${assigneeId}&priority=4&dueStatus=overdue&q=${encodeURIComponent('Alpha_100%')}&sortBy=dueAt&sortOrder=asc`,
          { headers: { cookie: assigneeCookie } },
        ),
      );
      const combinedAssigneeBody = (await combinedAssigneeRes.json()) as { items: Array<{ id: string }> };
      expect(combinedAssigneeBody.items.map((t) => t.id)).toEqual([tHiddenOverdue]);

      // 3. upcoming still returns future tasks
      const upcomingRes = await tasksGet(
        new Request(`http://localhost:3000/api/v1/tasks?boardId=${board1Id}&dueStatus=upcoming`, {
          headers: { cookie: outsiderCookie },
        }),
      );
      expect(((await upcomingRes.json()) as { items: Array<{ id: string }> }).items.map((t) => t.id)).toEqual([tUpcoming]);

      const serialized = JSON.stringify([outsiderOverdueBody, combinedAssigneeBody, logs]);
      for (const pii of [adminSid, assigneeSid, outsiderSid, '@eiu.edu.vn']) {
        expect(serialized).not.toContain(pii);
      }
    });
  });
});

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
import { GET as boardGet } from '@/app/api/v1/boards/[id]/route';
import { GET as boardsGet } from '@/app/api/v1/boards/route';
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

describe('Boards search q & viewer-scoped visibleTaskCount/overdueTaskCount integration', () => {
  let pool: Pool;
  let db: Database;

  beforeAll(() => {
    loadEnvLocalIfMissing();
    const testDbUrl = process.env.TEST_DATABASE_URL;
    if (!testDbUrl) throw new Error('TEST_DATABASE_URL is required for boards search integration tests');
    pool = createDbPool(testDbUrl);
    db = createDb(pool);
  });

  afterAll(async () => {
    setContainerForTesting(undefined);
    await pool?.end();
  });

  it('escapes LIKE patterns in GET /boards?q=, scopes visibleTaskCount/overdueTaskCount per viewer, and excludes Done/deleted/purged', async () => {
    const suffix = randomUUID().slice(0, 8);
    const fixedNow = new Date('2026-11-25T12:00:00.000Z');
    const pastDue = new Date('2026-11-20T12:00:00.000Z');
    const futureDue = new Date('2026-11-30T12:00:00.000Z');
    const deletedAt = new Date('2026-11-21T12:00:00.000Z');

    const adminId = randomUUID();
    const creatorId = randomUUID();
    const assigneeId = randomUUID();
    const deptMemberId = randomUUID();
    const outsiderId = randomUUID();
    const deptId = randomUUID();
    const baseHost = Math.floor(Math.random() * 140) + 10;
    const logs: string[] = [];

    const sids = {
      admin: `MSSV-BSA-${suffix}`,
      creator: `MSSV-BSC-${suffix}`,
      assignee: `MSSV-BSD-${suffix}`,
      deptMember: `MSSV-BSM-${suffix}`,
      outsider: `MSSV-BSO-${suffix}`,
    };

    const testConfig: Config = {
      nodeEnv: 'test',
      databaseUrl: process.env.TEST_DATABASE_URL!,
      testDatabaseUrl: process.env.TEST_DATABASE_URL!,
      sessionSecret: `boards-search-secret-${suffix}-0123456789`,
      sessionTtlMinutes: 30,
      allowedEmailDomain: 'eiu.edu.vn',
      cronSecret: 'boards-search-cron',
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

      await tx.insert(departments).values({ id: deptId, name: `Board Search Dept ${suffix}` });
      const passwordHash = await hashPassword(DEV_SEED_PASSWORD);
      await tx.insert(profiles).values([
        { id: adminId, studentId: sids.admin, email: `bs-adm-${suffix}@eiu.edu.vn`, fullName: `BS Admin ${suffix}`, passwordHash, isAdmin: true, isActive: true, locale: 'vi' },
        { id: creatorId, studentId: sids.creator, email: `bs-cre-${suffix}@eiu.edu.vn`, fullName: `BS Creator ${suffix}`, passwordHash, isAdmin: false, isActive: true, locale: 'vi' },
        { id: assigneeId, studentId: sids.assignee, email: `bs-ass-${suffix}@eiu.edu.vn`, fullName: `BS Assignee ${suffix}`, passwordHash, isAdmin: false, isActive: true, locale: 'vi' },
        { id: deptMemberId, studentId: sids.deptMember, email: `bs-dep-${suffix}@eiu.edu.vn`, fullName: `BS Dept ${suffix}`, passwordHash, isAdmin: false, isActive: true, locale: 'vi' },
        { id: outsiderId, studentId: sids.outsider, email: `bs-out-${suffix}@eiu.edu.vn`, fullName: `BS Outsider ${suffix}`, passwordHash, isAdmin: false, isActive: true, locale: 'vi' },
      ]);
      await tx.insert(memberDepartments).values({ userId: deptMemberId, departmentId: deptId });

      const boardMatchId = randomUUID();
      const boardDecoyId = randomUUID();
      const boardCustomDoneId = randomUUID();
      await tx.insert(boards).values([
        { id: boardMatchId, name: `100% Launch_${suffix}`, createdBy: adminId, createdAt: new Date('2026-11-25T10:00:00.000Z') },
        { id: boardDecoyId, name: `1000 LaunchX${suffix}`, createdBy: adminId, createdAt: new Date('2026-11-25T09:00:00.000Z') },
        { id: boardCustomDoneId, name: `Custom Done ${suffix}`, createdBy: adminId, createdAt: new Date('2026-11-25T08:00:00.000Z') },
      ]);

      const colTodo = randomUUID();
      const colDoing = randomUUID();
      const colDone = randomUUID();
      const colCustomTodo = randomUUID();
      const colCustomFinal = randomUUID();
      await tx.insert(columns).values([
        { id: colTodo, boardId: boardMatchId, name: 'Todo', orderIndex: 0 },
        { id: colDoing, boardId: boardMatchId, name: 'Doing', orderIndex: 1 },
        { id: colDone, boardId: boardMatchId, name: 'Done', orderIndex: 2 },
        { id: colCustomTodo, boardId: boardCustomDoneId, name: 'Todo', orderIndex: 0 },
        { id: colCustomFinal, boardId: boardCustomDoneId, name: 'Completed', orderIndex: 1 },
      ]);

      const hiddenTaskId = randomUUID();
      await tx.insert(tasks).values([
        // 1. Public overdue in Todo -> counted in both visible & overdue for all
        { id: randomUUID(), boardId: boardMatchId, columnId: colTodo, title: 'Public Overdue', startAt: pastDue, dueAt: pastDue, priority: 2, position: '1000', isHidden: false, createdBy: adminId },
        // 2. Public upcoming in Todo -> visible only
        { id: randomUUID(), boardId: boardMatchId, columnId: colTodo, title: 'Public Upcoming', startAt: pastDue, dueAt: futureDue, priority: 2, position: '2000', isHidden: false, createdBy: adminId },
        // 3. Public overdue in Done -> visible only (NOT overdue)
        { id: randomUUID(), boardId: boardMatchId, columnId: colDone, title: 'Done Overdue', startAt: pastDue, dueAt: pastDue, priority: 2, position: '1000', isHidden: false, createdBy: adminId },
        // 4. Hidden overdue in Doing -> visible & overdue for admin/creator/assignee/deptMember, excluded for outsider
        { id: hiddenTaskId, boardId: boardMatchId, columnId: colDoing, title: 'Hidden Overdue', startAt: pastDue, dueAt: pastDue, priority: 4, position: '1000', isHidden: true, createdBy: creatorId },
        // 5. Soft-deleted overdue -> excluded for everyone
        { id: randomUUID(), boardId: boardMatchId, columnId: colTodo, title: 'Deleted Overdue', startAt: pastDue, dueAt: pastDue, priority: 2, position: '3000', isHidden: false, deletedAt, createdBy: adminId },
        // 6. Purged overdue -> excluded for everyone
        { id: randomUUID(), boardId: boardMatchId, columnId: colTodo, title: 'Purged Overdue', startAt: pastDue, dueAt: pastDue, priority: 2, position: '4000', isHidden: false, deletedAt, purgedAt: deletedAt, createdBy: adminId },
        // 7. Board 2: overdue in final column 'Completed' -> visible=1, overdue=0
        { id: randomUUID(), boardId: boardCustomDoneId, columnId: colCustomFinal, title: 'Custom Final Overdue', startAt: pastDue, dueAt: pastDue, priority: 2, position: '1000', isHidden: false, createdBy: adminId },
      ]);
      await tx.insert(taskAssignees).values({ taskId: hiddenTaskId, userId: assigneeId });
      await tx.insert(taskDepartments).values({ taskId: hiddenTaskId, departmentId: deptId });

      const loginAs = async (studentId: string, offset: number) =>
        cookiePairFromLogin(await loginPost(new Request('http://localhost:3000/api/v1/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${baseHost + offset}` },
          body: JSON.stringify({ studentId, password: DEV_SEED_PASSWORD }),
        })));

      const adminCookie = await loginAs(sids.admin, 0);
      const creatorCookie = await loginAs(sids.creator, 1);
      const assigneeCookie = await loginAs(sids.assignee, 2);
      const deptCookie = await loginAs(sids.deptMember, 3);
      const outsiderCookie = await loginAs(sids.outsider, 4);

      // LIKE escaping for '%' and '_'
      const pctRes = await boardsGet(new Request('http://localhost:3000/api/v1/boards?q=' + encodeURIComponent('100%'), { headers: { cookie: adminCookie } }));
      expect(pctRes.status).toBe(200);
      const pctBody = (await pctRes.json()) as { items: Array<{ id: string; visibleTaskCount: number; overdueTaskCount: number }> };
      expect(pctBody.items.map((b) => b.id)).toEqual([boardMatchId]);
      expect(pctBody.items[0]).toMatchObject({ visibleTaskCount: 4, overdueTaskCount: 2 });

      const underRes = await boardsGet(new Request('http://localhost:3000/api/v1/boards?q=' + encodeURIComponent(`Launch_${suffix}`), { headers: { cookie: outsiderCookie } }));
      expect(underRes.status).toBe(200);
      const underBody = (await underRes.json()) as { items: Array<{ id: string; visibleTaskCount: number; overdueTaskCount: number }> };
      expect(underBody.items.map((b) => b.id)).toEqual([boardMatchId]);
      expect(underBody.items[0]).toMatchObject({ visibleTaskCount: 3, overdueTaskCount: 1 });

      // Viewer counts on listBoards for creator, direct assignee, department member, and custom Done board
      for (const viewerCookie of [creatorCookie, assigneeCookie, deptCookie]) {
        const res = await boardsGet(new Request('http://localhost:3000/api/v1/boards?q=' + encodeURIComponent(`Launch_${suffix}`), { headers: { cookie: viewerCookie } }));
        const body = (await res.json()) as { items: Array<{ visibleTaskCount: number; overdueTaskCount: number }> };
        expect(body.items[0]).toMatchObject({ visibleTaskCount: 4, overdueTaskCount: 2 });
      }

      const customRes = await boardsGet(new Request('http://localhost:3000/api/v1/boards?q=' + encodeURIComponent(`Custom Done ${suffix}`), { headers: { cookie: outsiderCookie } }));
      const customBody = (await customRes.json()) as { items: Array<{ id: string; visibleTaskCount: number; overdueTaskCount: number }> };
      expect(customBody.items[0]).toMatchObject({ id: boardCustomDoneId, visibleTaskCount: 1, overdueTaskCount: 0 });

      // getBoardDetail matches listBoards counts per viewer
      const detailOutsider = (await (await boardGet(
        new Request(`http://localhost:3000/api/v1/boards/${boardMatchId}`, { headers: { cookie: outsiderCookie } }),
        { params: Promise.resolve({ id: boardMatchId }) },
      )).json()) as { board: { visibleTaskCount: number; overdueTaskCount: number; tasks: unknown[] } };
      expect(detailOutsider.board).toMatchObject({ visibleTaskCount: 3, overdueTaskCount: 1 });
      expect(detailOutsider.board.tasks).toHaveLength(3);

      const detailDept = (await (await boardGet(
        new Request(`http://localhost:3000/api/v1/boards/${boardMatchId}`, { headers: { cookie: deptCookie } }),
        { params: Promise.resolve({ id: boardMatchId }) },
      )).json()) as { board: { visibleTaskCount: number; overdueTaskCount: number; tasks: unknown[] } };
      expect(detailDept.board).toMatchObject({ visibleTaskCount: 4, overdueTaskCount: 2 });
      expect(detailDept.board.tasks).toHaveLength(4);

      const serialized = JSON.stringify([pctBody, underBody, customBody, detailOutsider, detailDept, logs]);
      for (const sid of Object.values(sids)) {
        expect(serialized).not.toContain(sid);
      }
      expect(serialized).not.toContain('@eiu.edu.vn');
    });
  });
});

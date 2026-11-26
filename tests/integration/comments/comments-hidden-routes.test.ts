import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { asc, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  boards,
  columns,
  comments,
  permissions,
  profiles,
  taskEvents,
  userPermissions,
} from '@db/schema';
import { POST as loginPost } from '@/app/api/v1/auth/login/route';
import { DELETE as commentDelete } from '@/app/api/v1/comments/[id]/route';
import {
  GET as taskCommentsGet,
  POST as taskCommentsPost,
} from '@/app/api/v1/tasks/[id]/comments/route';
import { PUT as taskHiddenPut } from '@/app/api/v1/tasks/[id]/hidden/route';
import { DELETE as taskDelete, GET as taskGet } from '@/app/api/v1/tasks/[id]/route';
import { POST as tasksPost } from '@/app/api/v1/tasks/route';
import { SESSION_COOKIE_NAME } from '@/lib/auth';
import { DrizzleAuditRepository } from '@/server/modules/audit';
import { DrizzleAuthRepository } from '@/server/modules/auth';
import { DrizzleBoardsRepository } from '@/server/modules/boards';
import { DrizzleCommentsRepository } from '@/server/modules/comments';
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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

async function withRolledBackDb(
  db: Database,
  fn: (tx: TransactionContext) => Promise<void>,
): Promise<void> {
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
  const line = res.headers
    .getSetCookie()
    .find((entry) => entry.startsWith(`${SESSION_COOKIE_NAME}=`));
  expect(line).toBeDefined();
  return line!.split(';')[0]!;
}

describe('Comments & Task Hidden Toggle Route Handlers integration', () => {
  let pool: Pool;
  let db: Database;

  beforeAll(() => {
    loadEnvLocalIfMissing();
    const testDbUrl = process.env.TEST_DATABASE_URL;
    if (!testDbUrl) {
      throw new Error('TEST_DATABASE_URL is required for comments integration tests');
    }
    pool = createDbPool(testDbUrl);
    db = createDb(pool);
  });

  afterAll(async () => {
    setContainerForTesting(undefined);
    await pool?.end();
  });

  it('enforces hidden toggle creator/admin rules, 404 before 403 on hidden tasks, cursor pagination, commentCount, append-only task_events, and zero PII', async () => {
    const suffix = randomUUID().slice(0, 8);
    const adminId = randomUUID();
    const creatorId = randomUUID();
    const assigneeId = randomUUID();
    const anyEditorId = randomUUID();
    const moderatorId = randomUUID();
    const plainId = randomUUID();
    const inactiveAuthorId = randomUUID();

    const adminSid = `MSSV-CADM-${suffix}`;
    const creatorSid = `MSSV-CCRE-${suffix}`;
    const assigneeSid = `MSSV-CASS-${suffix}`;
    const anyEditorSid = `MSSV-CANY-${suffix}`;
    const moderatorSid = `MSSV-CMOD-${suffix}`;
    const plainSid = `MSSV-CPLN-${suffix}`;
    const inactiveSid = `MSSV-CINA-${suffix}`;
    const baseHost = Math.floor(Math.random() * 140) + 10;
    const logs: string[] = [];

    const testConfig: Config = {
      nodeEnv: 'test',
      databaseUrl: process.env.TEST_DATABASE_URL!,
      testDatabaseUrl: process.env.TEST_DATABASE_URL!,
      sessionSecret: `comments-test-secret-${suffix}-0123456789`,
      sessionTtlMinutes: 30,
      sessionTtlDefaultHours: 24,
      sessionTtlRememberDays: 30,
      allowedEmailDomain: 'eiu.edu.vn',
      cronSecret: 'comments-cron-secret',
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
        commentsRepo: new DrizzleCommentsRepository(tx),
        boardsRepo: new DrizzleBoardsRepository(tx),
        logger: new StructuredLogger({
          writeOut: (line) => logs.push(line),
          writeErr: (line) => logs.push(line),
        }),
      });
      setContainerForTesting(container);

      await tx
        .insert(permissions)
        .values([
          { code: 'task.create', groupName: 'tasks', description: 'TC', scopable: false },
          { code: 'task.assign', groupName: 'tasks', description: 'TA', scopable: false },
          { code: 'task.update_any', groupName: 'tasks', description: 'TUA', scopable: false },
          {
            code: 'task.update_assigned',
            groupName: 'tasks',
            description: 'TUAS',
            scopable: false,
          },
          { code: 'task.delete', groupName: 'tasks', description: 'TD', scopable: false },
          { code: 'comment.create', groupName: 'comments', description: 'CC', scopable: false },
          {
            code: 'comment.delete_any',
            groupName: 'comments',
            description: 'CDA',
            scopable: false,
          },
        ])
        .onConflictDoNothing();

      const seedPasswordHash = await hashPassword(DEV_SEED_PASSWORD);
      await tx.insert(profiles).values([
        {
          id: adminId,
          studentId: adminSid,
          email: `c-adm-${suffix}@eiu.edu.vn`,
          fullName: `Comment Admin ${suffix}`,
          passwordHash: seedPasswordHash,
          isAdmin: true,
          isActive: true,
          locale: 'vi',
        },
        {
          id: creatorId,
          studentId: creatorSid,
          email: `c-cre-${suffix}@eiu.edu.vn`,
          fullName: `Comment Creator ${suffix}`,
          passwordHash: seedPasswordHash,
          isAdmin: false,
          isActive: true,
          locale: 'vi',
        },
        {
          id: assigneeId,
          studentId: assigneeSid,
          email: `c-ass-${suffix}@eiu.edu.vn`,
          fullName: `Comment Assignee ${suffix}`,
          passwordHash: seedPasswordHash,
          isAdmin: false,
          isActive: true,
          locale: 'vi',
        },
        {
          id: anyEditorId,
          studentId: anyEditorSid,
          email: `c-any-${suffix}@eiu.edu.vn`,
          fullName: `Comment AnyEditor ${suffix}`,
          passwordHash: seedPasswordHash,
          isAdmin: false,
          isActive: true,
          locale: 'vi',
        },
        {
          id: moderatorId,
          studentId: moderatorSid,
          email: `c-mod-${suffix}@eiu.edu.vn`,
          fullName: `Comment Moderator ${suffix}`,
          passwordHash: seedPasswordHash,
          isAdmin: false,
          isActive: true,
          locale: 'vi',
        },
        {
          id: plainId,
          studentId: plainSid,
          email: `c-pln-${suffix}@eiu.edu.vn`,
          fullName: `Comment Plain ${suffix}`,
          passwordHash: seedPasswordHash,
          isAdmin: false,
          isActive: true,
          locale: 'vi',
        },
        {
          id: inactiveAuthorId,
          studentId: inactiveSid,
          email: `c-ina-${suffix}@eiu.edu.vn`,
          fullName: `Former Member ${suffix}`,
          passwordHash: seedPasswordHash,
          isAdmin: false,
          isActive: false,
          leftAt: new Date('2026-10-01T00:00:00.000Z'),
          locale: 'vi',
        },
      ]);

      await tx.insert(userPermissions).values([
        { userId: creatorId, permissionCode: 'task.create', grantedBy: null },
        { userId: creatorId, permissionCode: 'task.assign', grantedBy: null },
        { userId: creatorId, permissionCode: 'comment.create', grantedBy: null },
        { userId: assigneeId, permissionCode: 'task.update_assigned', grantedBy: null },
        { userId: assigneeId, permissionCode: 'comment.create', grantedBy: null },
        { userId: anyEditorId, permissionCode: 'task.update_any', grantedBy: null },
        { userId: anyEditorId, permissionCode: 'task.delete', grantedBy: null },
        { userId: moderatorId, permissionCode: 'comment.create', grantedBy: null },
        { userId: moderatorId, permissionCode: 'comment.delete_any', grantedBy: null },
      ]);

      const boardId = randomUUID();
      const todoColId = randomUUID();
      await tx.insert(boards).values({
        id: boardId,
        name: `Comments Board ${suffix}`,
        createdBy: adminId,
      });
      await tx.insert(columns).values({
        id: todoColId,
        boardId,
        name: 'Todo',
        orderIndex: 0,
      });

      const loginAs = async (studentId: string, hostOffset: number) =>
        cookiePairFromLogin(
          await loginPost(
            new Request('http://localhost:3000/api/v1/auth/login', {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'x-forwarded-for': `198.51.100.${baseHost + hostOffset}`,
              },
              body: JSON.stringify({ studentId, password: DEV_SEED_PASSWORD }),
            }),
          ),
        );

      const adminCookie = await loginAs(adminSid, 0);
      const creatorCookie = await loginAs(creatorSid, 1);
      const assigneeCookie = await loginAs(assigneeSid, 2);
      const anyEditorCookie = await loginAs(anyEditorSid, 3);
      const moderatorCookie = await loginAs(moderatorSid, 4);
      const plainCookie = await loginAs(plainSid, 5);

      const createTaskRes = await tasksPost(
        new Request('http://localhost:3000/api/v1/tasks', {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: creatorCookie },
          body: JSON.stringify({
            boardId,
            columnId: todoColId,
            title: `Task For Comments ${suffix}`,
            assigneeIds: [assigneeId],
            isHidden: false,
          }),
        }),
      );
      expect(createTaskRes.status).toBe(201);
      const taskId = ((await createTaskRes.json()) as { task: { id: string } }).task.id;

      // 1. Unauthenticated -> 401
      expect(
        (
          await taskHiddenPut(
            new Request(`http://localhost:3000/api/v1/tasks/${taskId}/hidden`, {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ isHidden: true }),
            }),
            { params: Promise.resolve({ id: taskId }) },
          )
        ).status,
      ).toBe(401);
      expect(
        (
          await taskCommentsGet(
            new Request(`http://localhost:3000/api/v1/tasks/${taskId}/comments`),
            { params: Promise.resolve({ id: taskId }) },
          )
        ).status,
      ).toBe(401);

      // 2. Hidden toggle: assignee & task.update_any non-creator get 403; version conflict -> 409; no-op -> eventId null
      expect(
        (
          await taskHiddenPut(
            new Request(`http://localhost:3000/api/v1/tasks/${taskId}/hidden`, {
              method: 'PUT',
              headers: { 'content-type': 'application/json', cookie: assigneeCookie },
              body: JSON.stringify({ isHidden: true, version: 1 }),
            }),
            { params: Promise.resolve({ id: taskId }) },
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await taskHiddenPut(
            new Request(`http://localhost:3000/api/v1/tasks/${taskId}/hidden`, {
              method: 'PUT',
              headers: { 'content-type': 'application/json', cookie: anyEditorCookie },
              body: JSON.stringify({ isHidden: true, version: 1 }),
            }),
            { params: Promise.resolve({ id: taskId }) },
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await taskHiddenPut(
            new Request(`http://localhost:3000/api/v1/tasks/${taskId}/hidden`, {
              method: 'PUT',
              headers: { 'content-type': 'application/json', cookie: creatorCookie },
              body: JSON.stringify({ isHidden: true, version: 9 }),
            }),
            { params: Promise.resolve({ id: taskId }) },
          )
        ).status,
      ).toBe(409);

      const noopHiddenRes = await taskHiddenPut(
        new Request(`http://localhost:3000/api/v1/tasks/${taskId}/hidden`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie: creatorCookie },
          body: JSON.stringify({ isHidden: false, version: 1 }),
        }),
        { params: Promise.resolve({ id: taskId }) },
      );
      expect(noopHiddenRes.status).toBe(200);
      expect(
        ((await noopHiddenRes.json()) as { eventId: string | null; task: { version: number } }),
      ).toMatchObject({ eventId: null, task: { version: 1 } });

      // Creator hides task -> version 2 & eventId
      const hideRes = await taskHiddenPut(
        new Request(`http://localhost:3000/api/v1/tasks/${taskId}/hidden`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie: creatorCookie },
          body: JSON.stringify({ isHidden: true, version: 1 }),
        }),
        { params: Promise.resolve({ id: taskId }) },
      );
      expect(hideRes.status).toBe(200);
      expect(
        ((await hideRes.json()) as { eventId: string; task: { isHidden: boolean; version: number } }),
      ).toMatchObject({ task: { isHidden: true, version: 2 } });

      // 3. While hidden: non-viewers (plain user without comment.create, task.update_any, moderator with comment.delete_any) MUST get 404!
      expect(
        (
          await taskHiddenPut(
            new Request(`http://localhost:3000/api/v1/tasks/${taskId}/hidden`, {
              method: 'PUT',
              headers: { 'content-type': 'application/json', cookie: anyEditorCookie },
              body: JSON.stringify({ isHidden: false }),
            }),
            { params: Promise.resolve({ id: taskId }) },
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await taskCommentsGet(
            new Request(`http://localhost:3000/api/v1/tasks/${taskId}/comments`, {
              headers: { cookie: plainCookie },
            }),
            { params: Promise.resolve({ id: taskId }) },
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await taskCommentsPost(
            new Request(`http://localhost:3000/api/v1/tasks/${taskId}/comments`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', cookie: plainCookie },
              body: JSON.stringify({ body: 'Probe hidden' }),
            }),
            { params: Promise.resolve({ id: taskId }) },
          )
        ).status,
      ).toBe(404);

      // Viewer (assignee) can add comment to hidden task; commentCount increments
      const hiddenCommentRes = await taskCommentsPost(
        new Request(`http://localhost:3000/api/v1/tasks/${taskId}/comments`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: assigneeCookie },
          body: JSON.stringify({ body: 'Assignee note on hidden task' }),
        }),
        { params: Promise.resolve({ id: taskId }) },
      );
      expect(hiddenCommentRes.status).toBe(201);
      const hiddenCommentId = (
        (await hiddenCommentRes.json()) as { comment: { id: string } }
      ).comment.id;

      // Moderator WITH comment.delete_any who cannot view hidden task gets 404 on DELETE /comments/{id}!
      expect(
        (
          await commentDelete(
            new Request(`http://localhost:3000/api/v1/comments/${hiddenCommentId}`, {
              method: 'DELETE',
              headers: { cookie: moderatorCookie },
            }),
            { params: Promise.resolve({ id: hiddenCommentId }) },
          )
        ).status,
      ).toBe(404);

      // Admin unhides task -> version 3
      const unhideRes = await taskHiddenPut(
        new Request(`http://localhost:3000/api/v1/tasks/${taskId}/hidden`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({ isHidden: false, version: 2 }),
        }),
        { params: Promise.resolve({ id: taskId }) },
      );
      expect(unhideRes.status).toBe(200);

      // 4. On public task: plain user without comment.create gets 403; invalid body gets 400
      expect(
        (
          await taskCommentsPost(
            new Request(`http://localhost:3000/api/v1/tasks/${taskId}/comments`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', cookie: plainCookie },
              body: JSON.stringify({ body: 'No perm' }),
            }),
            { params: Promise.resolve({ id: taskId }) },
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await taskCommentsPost(
            new Request(`http://localhost:3000/api/v1/tasks/${taskId}/comments`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', cookie: creatorCookie },
              body: JSON.stringify({ body: '   ' }),
            }),
            { params: Promise.resolve({ id: taskId }) },
          )
        ).status,
      ).toBe(400);

      // Seed an inactive-author comment + create 2 more comments for cursor pagination
      const inactiveCommentId = randomUUID();
      await tx.insert(comments).values({
        id: inactiveCommentId,
        taskId,
        userId: inactiveAuthorId,
        body: 'Legacy comment from left member',
        createdAt: new Date('2026-11-20T05:00:00.000Z'),
      });
      const creatorCommentRes = await taskCommentsPost(
        new Request(`http://localhost:3000/api/v1/tasks/${taskId}/comments`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: creatorCookie },
          body: JSON.stringify({ body: 'Creator follow-up' }),
        }),
        { params: Promise.resolve({ id: taskId }) },
      );
      expect(creatorCommentRes.status).toBe(201);
      const creatorCommentId = (
        (await creatorCommentRes.json()) as { comment: { id: string } }
      ).comment.id;

      // Verify GET /tasks/{id} reflects accurate commentCount (3)
      const taskDetailRes = await taskGet(
        new Request(`http://localhost:3000/api/v1/tasks/${taskId}`, {
          headers: { cookie: plainCookie },
        }),
        { params: Promise.resolve({ id: taskId }) },
      );
      expect(taskDetailRes.status).toBe(200);
      expect(
        ((await taskDetailRes.json()) as { task: { commentCount: number } }).task.commentCount,
      ).toBe(3);

      // 5. Cursor pagination (newest first) + inactive author metadata without PII
      const page1Res = await taskCommentsGet(
        new Request(`http://localhost:3000/api/v1/tasks/${taskId}/comments?limit=2`, {
          headers: { cookie: plainCookie },
        }),
        { params: Promise.resolve({ id: taskId }) },
      );
      expect(page1Res.status).toBe(200);
      const page1 = (await page1Res.json()) as {
        items: Array<{ id: string; createdAt: string; author: Record<string, unknown> }>;
        meta: { nextCursor: string | null; limit: number };
      };
      expect(page1.items).toHaveLength(2);
      expect(page1.items[0]?.id).toBe(creatorCommentId);
      expect(page1.meta.nextCursor).toBeTruthy();

      const page2Res = await taskCommentsGet(
        new Request(
          `http://localhost:3000/api/v1/tasks/${taskId}/comments?limit=2&cursor=${encodeURIComponent(page1.meta.nextCursor!)}`,
          { headers: { cookie: plainCookie } },
        ),
        { params: Promise.resolve({ id: taskId }) },
      );
      expect(page2Res.status).toBe(200);
      const page2 = (await page2Res.json()) as {
        items: Array<{ id: string; createdAt: string; author: Record<string, unknown> }>;
        meta: { nextCursor: string | null };
      };
      expect(page2.items).toHaveLength(1);
      expect(page2.meta.nextCursor).toBeNull();
      const allCommentItems = [...page1.items, ...page2.items];
      for (let i = 1; i < allCommentItems.length; i += 1) {
        expect(
          new Date(allCommentItems[i - 1]!.createdAt).getTime(),
        ).toBeGreaterThanOrEqual(new Date(allCommentItems[i]!.createdAt).getTime());
      }
      const inactiveItem = allCommentItems.find((i) => i.id === inactiveCommentId);
      expect(inactiveItem?.author).toMatchObject({
        id: inactiveAuthorId,
        fullName: `Former Member ${suffix}`,
        isActive: false,
      });
      expect(inactiveItem?.author.leftAt).toBeTruthy();
      expect(inactiveItem?.author).not.toHaveProperty('studentId');
      expect(inactiveItem?.author).not.toHaveProperty('email');

      // 6. Delete rules: plain user gets 403, author deletes own, moderator deletes any
      expect(
        (
          await commentDelete(
            new Request(`http://localhost:3000/api/v1/comments/${creatorCommentId}`, {
              method: 'DELETE',
              headers: { cookie: plainCookie },
            }),
            { params: Promise.resolve({ id: creatorCommentId }) },
          )
        ).status,
      ).toBe(403);

      const delOwnRes = await commentDelete(
        new Request(`http://localhost:3000/api/v1/comments/${creatorCommentId}`, {
          method: 'DELETE',
          headers: { cookie: creatorCookie },
        }),
        { params: Promise.resolve({ id: creatorCommentId }) },
      );
      expect(delOwnRes.status).toBe(200);
      expect((await delOwnRes.json()) as { deleted: boolean; id: string; eventId: string }).toMatchObject({
        deleted: true,
        id: creatorCommentId,
      });

      const delModRes = await commentDelete(
        new Request(`http://localhost:3000/api/v1/comments/${hiddenCommentId}`, {
          method: 'DELETE',
          headers: { cookie: moderatorCookie },
        }),
        { params: Promise.resolve({ id: hiddenCommentId }) },
      );
      expect(delModRes.status).toBe(200);

      // commentCount decremented to 1
      const afterDeleteTaskRes = await taskGet(
        new Request(`http://localhost:3000/api/v1/tasks/${taskId}`, {
          headers: { cookie: plainCookie },
        }),
        { params: Promise.resolve({ id: taskId }) },
      );
      expect(
        ((await afterDeleteTaskRes.json()) as { task: { commentCount: number } }).task
          .commentCount,
      ).toBe(1);

      // 7. Soft-deleted task -> 404 on GET/POST comments & DELETE remaining comment
      expect(
        (
          await taskDelete(
            new Request(`http://localhost:3000/api/v1/tasks/${taskId}`, {
              method: 'DELETE',
              headers: { cookie: anyEditorCookie },
            }),
            { params: Promise.resolve({ id: taskId }) },
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await taskCommentsGet(
            new Request(`http://localhost:3000/api/v1/tasks/${taskId}/comments`, {
              headers: { cookie: adminCookie },
            }),
            { params: Promise.resolve({ id: taskId }) },
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await commentDelete(
            new Request(`http://localhost:3000/api/v1/comments/${inactiveCommentId}`, {
              method: 'DELETE',
              headers: { cookie: adminCookie },
            }),
            { params: Promise.resolve({ id: inactiveCommentId }) },
          )
        ).status,
      ).toBe(404);

      // 8. Verify task_events & logs have ZERO PII and ZERO comment body text
      const events = await tx
        .select()
        .from(taskEvents)
        .where(eq(taskEvents.taskId, taskId))
        .orderBy(asc(taskEvents.createdAt));
      expect(events.map((e) => e.type)).toEqual([
        'task.created',
        'task.hidden_changed',
        'comment.added',
        'task.hidden_changed',
        'comment.added',
        'comment.deleted',
        'comment.deleted',
        'task.deleted',
      ]);
      expect(events[1]?.changes).toEqual({ is_hidden: { from: false, to: true } });
      expect(events[3]?.changes).toEqual({ is_hidden: { from: true, to: false } });

      const serializedEventsAndLogs = JSON.stringify([events, logs]);
      for (const secretOrPii of [
        adminSid,
        creatorSid,
        assigneeSid,
        anyEditorSid,
        moderatorSid,
        plainSid,
        inactiveSid,
        `c-adm-${suffix}`,
        'Assignee note on hidden task',
        'Creator follow-up',
      ]) {
        expect(serializedEventsAndLogs).not.toContain(secretOrPii);
      }
    });
  });
});

import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import {
  boards,
  columns,
  comments,
  departments,
  loginAttempts,
  memberDepartments,
  notifications,
  permissions,
  profiles,
  sessions,
  taskAssignees,
  taskDeliverables,
  taskDepartments,
  tasks,
  userPermissions,
} from '@db/schema';
import { DEFAULT_MEMBER_PERMISSIONS, PERMISSIONS } from '@/lib/permissions';
import { createDb, createDbPool, type Database } from '@/server/shared/db';
import { DEV_SEED_PASSWORD, hashPassword } from '@/server/shared/password';
import viMessages from '../../messages/vi.json';

const BASE_ORIGIN = 'http://127.0.0.1:3001';
const LOOPBACK_IPS = ['unknown', '127.0.0.1', '::1', '::ffff:127.0.0.1'];
const VN_OFFSET_MS = 7 * 3_600_000;
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function vnDateIsoOffset(offsetDays: number): string {
  const vnNow = new Date(Date.now() + VN_OFFSET_MS);
  const shifted = new Date(
    Date.UTC(vnNow.getUTCFullYear(), vnNow.getUTCMonth(), vnNow.getUTCDate() + offsetDays),
  );
  return shifted.toISOString().slice(0, 10);
}

function vnMidnightUtc(offsetDays: number): Date {
  const iso = vnDateIsoOffset(offsetDays);
  return new Date(`${iso}T00:00:00.000+07:00`);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function attachRuntimeErrorTracker(page: Page): Promise<{
  assertClean: () => Promise<void>;
}> {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
  await page.addInitScript(() => {
    const win = window as Window & { __beamUnhandledRejections?: string[] };
    win.__beamUnhandledRejections = [];
    window.addEventListener('unhandledrejection', (event) => {
      win.__beamUnhandledRejections?.push(String(event.reason));
    });
  });

  return {
    assertClean: async () => {
      const unhandled = await page.evaluate(() => {
        const win = window as Window & { __beamUnhandledRejections?: string[] };
        return win.__beamUnhandledRejections ?? [];
      });
      expect(pageErrors).toEqual([]);
      expect(unhandled).toEqual([]);
    },
  };
}

async function signInAs(
  page: Page,
  studentId: string,
  expectedPath = '/tasks',
  returnTo?: string,
  password = DEV_SEED_PASSWORD,
): Promise<void> {
  const targetUrl = returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : '/login';
  await page.goto(targetUrl);
  await page.getByLabel(viMessages.auth.studentIdLabel, { exact: true }).fill(studentId);
  await page.getByLabel(viMessages.auth.passwordLabel, { exact: true }).fill(password);
  await page.getByRole('button', { name: viMessages.auth.signInButton, exact: true }).click();
  await page.waitForURL(`${BASE_ORIGIN}${expectedPath}`);
}

function getTaskModal(page: Page): Locator {
  return page.locator('aside.task-modal-shell[role="dialog"]');
}

function assertZeroPii(payloads: readonly string[], secrets: readonly string[]): void {
  for (const body of payloads) {
    for (const secret of secrets) {
      expect(body).not.toContain(secret);
    }
    expect(body).not.toContain('"studentId"');
    expect(body).not.toContain('"email"');
    expect(body).not.toContain('passwordHash');
    expect(body).not.toContain('password_hash');
    expect(body).not.toContain('scrypt$');
    expect(body).not.toContain(DEV_SEED_PASSWORD);
  }
}

test.describe('CR-10 Calendar Task Workspace, Deadline Alerts & Near-Fullscreen Modal E2E', () => {
  let pool: Pool;
  let db: Database;

  const suffix = randomUUID().slice(0, 8);
  const currentVnYear = Number.parseInt(vnDateIsoOffset(0).slice(0, 4), 10);

  const adminUserId = randomUUID();
  const leadUserId = randomUUID();
  const memberUserId = randomUUID();
  const outsiderUserId = randomUUID();

  const deptAId = randomUUID();
  const deptBId = randomUUID();

  const adminStudentId = `MSSV-CR10-ADM-${suffix}`;
  const leadStudentId = `MSSV-CR10-LEAD-${suffix}`;
  const memberStudentId = `MSSV-CR10-MEM-${suffix}`;
  const outsiderStudentId = `MSSV-CR10-OUT-${suffix}`;

  const adminEmail = `cr10-admin-${suffix}@eiu.edu.vn`;
  const leadEmail = `cr10-lead-${suffix}@eiu.edu.vn`;
  const memberEmail = `cr10-member-${suffix}@eiu.edu.vn`;
  const outsiderEmail = `cr10-outsider-${suffix}@eiu.edu.vn`;

  const adminFullName = `CR10 Admin ${suffix}`;
  const leadFullName = `CR10 Lead ${suffix}`;
  const memberFullName = `CR10 Member ${suffix}`;
  const outsiderFullName = `CR10 Outsider ${suffix}`;

  const deptAName = `Ban Kỹ thuật CR10 ${suffix}`;
  const deptBName = `Ban Sự kiện CR10 ${suffix}`;

  const seedBoardId = randomUUID();
  const seedTodoColId = randomUUID();
  const seedDoneColId = randomUUID();

  const overdueTaskId = randomUUID();
  const urgentTaskId = randomUUID();
  const soonTaskId = randomUUID();
  const safeTaskId = randomUUID();
  const doneTaskId = randomUUID();

  const overdueTitle = `CR10 Overdue ${suffix}`;
  const urgentTitle = `CR10 Urgent ${suffix}`;
  const soonTitle = `CR10 Soon ${suffix}`;
  const safeTitle = `CR10 Safe ${suffix}`;
  const doneTitle = `CR10 Done ${suffix}`;

  const trackedUserIds = [adminUserId, leadUserId, memberUserId, outsiderUserId];
  const trackedStudentIds = [adminStudentId, leadStudentId, memberStudentId, outsiderStudentId];
  const trackedDeptIds = [deptAId, deptBId];
  const trackedBoardIds: string[] = [seedBoardId];
  const trackedTaskIds: string[] = [
    overdueTaskId,
    urgentTaskId,
    soonTaskId,
    safeTaskId,
    doneTaskId,
  ];
  let workspaceBoardPreexisted = false;

  const sensitiveValues = [
    ...trackedStudentIds,
    adminEmail,
    leadEmail,
    memberEmail,
    outsiderEmail,
  ];

  test.beforeAll(async () => {
    const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for E2E tests.');
    }

    pool = createDbPool(testDatabaseUrl);
    db = createDb(pool);
    const seedPasswordHash = await hashPassword(DEV_SEED_PASSWORD);

    const existingWorkspace = await db
      .select({ id: boards.id })
      .from(boards)
      .where(
        and(
          eq(boards.name, 'BEAM Workspace'),
          isNull(boards.archivedAt),
          isNull(boards.purgedAt),
        ),
      )
      .limit(1);
    workspaceBoardPreexisted = existingWorkspace.length > 0;

    await db
      .insert(permissions)
      .values(
        PERMISSIONS.map((p) => ({
          code: p.code,
          groupName: p.group,
          description: p.code,
          scopable: false,
        })),
      )
      .onConflictDoNothing();

    await db.insert(profiles).values([
      {
        id: adminUserId,
        studentId: adminStudentId,
        email: adminEmail,
        fullName: adminFullName,
        passwordHash: seedPasswordHash,
        mustChangePassword: false,
        isAdmin: true,
        isActive: true,
        locale: 'vi',
      },
      {
        id: leadUserId,
        studentId: leadStudentId,
        email: leadEmail,
        fullName: leadFullName,
        passwordHash: seedPasswordHash,
        mustChangePassword: false,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      },
      {
        id: memberUserId,
        studentId: memberStudentId,
        email: memberEmail,
        fullName: memberFullName,
        passwordHash: seedPasswordHash,
        mustChangePassword: false,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      },
      {
        id: outsiderUserId,
        studentId: outsiderStudentId,
        email: outsiderEmail,
        fullName: outsiderFullName,
        passwordHash: seedPasswordHash,
        mustChangePassword: false,
        isAdmin: false,
        isActive: true,
        locale: 'vi',
      },
    ]);

    await db.insert(departments).values([
      { id: deptAId, name: deptAName, leadUserId },
      { id: deptBId, name: deptBName, leadUserId: null },
    ]);

    await db.insert(memberDepartments).values([
      { userId: leadUserId, departmentId: deptAId },
      { userId: memberUserId, departmentId: deptAId },
    ]);

    await db.insert(userPermissions).values([
      ...(
        [
          'member.view',
          'task.create',
          'task.assign',
          'task.update_any',
          'task.delete',
          'comment.create',
        ] as const
      ).map((code) => ({
        userId: leadUserId,
        permissionCode: code,
        grantedBy: adminUserId,
      })),
      ...DEFAULT_MEMBER_PERMISSIONS.map((code) => ({
        userId: memberUserId,
        permissionCode: code,
        grantedBy: adminUserId,
      })),
      ...(['member.view', 'task.update_any', 'comment.create'] as const).map((code) => ({
        userId: outsiderUserId,
        permissionCode: code,
        grantedBy: adminUserId,
      })),
    ]);

    await db.insert(boards).values({
      id: seedBoardId,
      name: `Board CR10 Seed ${suffix}`,
      departmentId: null,
      createdBy: adminUserId,
    });
    await db.insert(columns).values([
      { id: seedTodoColId, boardId: seedBoardId, name: 'Todo', orderIndex: 0 },
      { id: seedDoneColId, boardId: seedBoardId, name: 'Done', orderIndex: 1 },
    ]);

    // Seed 5 tasks spanning all 5 deadline tiers inside current VN year (A1: startAt & dueAt required)
    const jan1Start = new Date(`${currentVnYear}-01-02T00:00:00.000+07:00`);
    const dec30End = new Date(`${currentVnYear}-12-30T00:00:00.000+07:00`);
    const clampCurrentYear = (offset: number): Date => {
      const candidate = vnMidnightUtc(offset);
      if (candidate < jan1Start) return jan1Start;
      if (candidate > dec30End) return dec30End;
      return candidate;
    };

    await db.insert(tasks).values([
      {
        id: overdueTaskId,
        boardId: seedBoardId,
        columnId: seedTodoColId,
        title: overdueTitle,
        description: `needle-overdue-${suffix}`,
        startAt: new Date(`${currentVnYear}-01-02T00:00:00.000+07:00`),
        dueAt: new Date(`${currentVnYear}-01-05T00:00:00.000+07:00`),
        isCompleted: false,
        priority: 4,
        position: '1000',
        isHidden: false,
        createdBy: adminUserId,
      },
      {
        id: urgentTaskId,
        boardId: seedBoardId,
        columnId: seedTodoColId,
        title: urgentTitle,
        description: `needle-urgent-${suffix}`,
        startAt: clampCurrentYear(-1),
        dueAt: vnMidnightUtc(1),
        isCompleted: false,
        priority: 3,
        position: '2000',
        isHidden: false,
        createdBy: adminUserId,
      },
      {
        id: soonTaskId,
        boardId: seedBoardId,
        columnId: seedTodoColId,
        title: soonTitle,
        description: `needle-soon-${suffix}`,
        startAt: vnMidnightUtc(0),
        dueAt: vnMidnightUtc(3),
        isCompleted: false,
        priority: 2,
        position: '3000',
        isHidden: false,
        createdBy: adminUserId,
      },
      {
        id: safeTaskId,
        boardId: seedBoardId,
        columnId: seedTodoColId,
        title: safeTitle,
        description: `needle-safe-${suffix}`,
        startAt: vnMidnightUtc(0),
        dueAt: vnMidnightUtc(7),
        isCompleted: false,
        priority: 1,
        position: '4000',
        isHidden: false,
        createdBy: adminUserId,
      },
      {
        id: doneTaskId,
        boardId: seedBoardId,
        columnId: seedDoneColId,
        title: doneTitle,
        description: `needle-done-${suffix}`,
        startAt: vnMidnightUtc(-2),
        dueAt: vnMidnightUtc(0),
        isCompleted: true,
        completedAt: new Date(),
        priority: 4,
        position: '5000',
        isHidden: false,
        createdBy: adminUserId,
      },
    ]);

    await db.insert(taskDepartments).values([
      { taskId: overdueTaskId, departmentId: deptAId },
      { taskId: urgentTaskId, departmentId: deptAId },
      { taskId: soonTaskId, departmentId: deptBId },
      { taskId: safeTaskId, departmentId: deptBId },
    ]);
  });

  test.beforeEach(async () => {
    await db
      .delete(loginAttempts)
      .where(
        or(
          inArray(loginAttempts.studentId, trackedStudentIds),
          inArray(loginAttempts.ip, LOOPBACK_IPS),
        ),
      );
  });

  test.afterAll(async () => {
    if (db) {
      const now = new Date();
      if (!workspaceBoardPreexisted) {
        const wsBoards = await db
          .select({ id: boards.id })
          .from(boards)
          .where(eq(boards.name, 'BEAM Workspace'));
        for (const row of wsBoards) {
          if (!trackedBoardIds.includes(row.id)) trackedBoardIds.push(row.id);
        }
      }

      if (trackedBoardIds.length > 0) {
        const boardTasks = await db
          .select({ id: tasks.id })
          .from(tasks)
          .where(inArray(tasks.boardId, trackedBoardIds));
        for (const row of boardTasks) {
          if (!trackedTaskIds.includes(row.id)) trackedTaskIds.push(row.id);
        }
      }

      if (trackedTaskIds.length > 0) {
        await db.delete(comments).where(inArray(comments.taskId, trackedTaskIds));
        await db.delete(taskDeliverables).where(inArray(taskDeliverables.taskId, trackedTaskIds));
        await db.delete(taskDepartments).where(inArray(taskDepartments.taskId, trackedTaskIds));
        await db.delete(taskAssignees).where(inArray(taskAssignees.taskId, trackedTaskIds));
        await db.delete(notifications).where(inArray(notifications.taskId, trackedTaskIds));
        await db
          .update(tasks)
          .set({
            deletedAt: sql`COALESCE(${tasks.deletedAt}, ${now.toISOString()}::timestamptz)`,
            purgedAt: sql`COALESCE(${tasks.purgedAt}, ${now.toISOString()}::timestamptz)`,
            updatedAt: now,
          })
          .where(inArray(tasks.id, trackedTaskIds));
      }

      if (trackedBoardIds.length > 0) {
        await db
          .update(boards)
          .set({
            archivedAt: sql`COALESCE(${boards.archivedAt}, ${now.toISOString()}::timestamptz)`,
            purgedAt: sql`COALESCE(${boards.purgedAt}, ${now.toISOString()}::timestamptz)`,
            departmentId: null,
            updatedAt: now,
          })
          .where(inArray(boards.id, trackedBoardIds));
      }

      await db
        .delete(notifications)
        .where(
          or(
            inArray(notifications.userId, trackedUserIds),
            inArray(notifications.actorId, trackedUserIds),
          ),
        );
      await db.delete(taskDepartments).where(inArray(taskDepartments.departmentId, trackedDeptIds));
      await db.delete(memberDepartments).where(inArray(memberDepartments.userId, trackedUserIds));
      await db.delete(memberDepartments).where(inArray(memberDepartments.departmentId, trackedDeptIds));
      await db.delete(departments).where(inArray(departments.id, trackedDeptIds));
      await db.delete(sessions).where(inArray(sessions.userId, trackedUserIds));
      await db.delete(userPermissions).where(inArray(userPermissions.userId, trackedUserIds));
      await db
        .delete(loginAttempts)
        .where(
          or(
            inArray(loginAttempts.studentId, trackedStudentIds),
            inArray(loginAttempts.ip, LOOPBACK_IPS),
          ),
        );
      await db
        .update(profiles)
        .set({ isActive: false, leftAt: now, updatedAt: now })
        .where(and(inArray(profiles.id, [leadUserId, memberUserId, outsiderUserId]), isNull(profiles.purgedAt)));

      const remainingAdmins = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(and(eq(profiles.isAdmin, true), eq(profiles.isActive, true), ne(profiles.id, adminUserId)));
      if (remainingAdmins.length > 0) {
        await db
          .update(profiles)
          .set({ isActive: false, leftAt: now, updatedAt: now })
          .where(eq(profiles.id, adminUserId));
      }
    }
    await pool?.end();
  });

  test('redirects default & legacy /boards routes to /tasks, initializes centered horizontal timeline, supports zoom/period controls, omits unscheduled tray, deadline filters & zero Priority UI', async ({
    page,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    await page.setViewportSize({ width: 1280, height: 720 });

    // 1. Default post-login redirect lands on /tasks
    await signInAs(page, adminStudentId, '/tasks');
    await expect(page.locator('.hcal-shell')).toBeVisible();

    const scroller = page.locator('#hcal-scroller');
    const canvas = page.locator('#hcal-canvas');
    await expect(scroller).toBeVisible();
    await expect(canvas).toHaveAttribute('data-zoom-tier', 'week');

    // Verify initial mount computed --day-w for week tier (not stuck on 45px fallback) and centered around Today
    const initialMetrics = await page.evaluate(() => {
      const scrollerEl = document.getElementById('hcal-scroller');
      const canvasEl = document.getElementById('hcal-canvas');
      if (!scrollerEl || !canvasEl) return null;
      const dayW = Number.parseFloat(canvasEl.style.getPropertyValue('--day-w') || '0');
      const todayEl = canvasEl.querySelector('.hcal-day-cell.is-today') as HTMLElement | null;
      return {
        dayW,
        scrollLeft: scrollerEl.scrollLeft,
        clientWidth: scrollerEl.clientWidth,
        todayOffsetLeft: todayEl ? todayEl.offsetLeft : -1,
      };
    });
    expect(initialMetrics).not.toBeNull();
    expect(initialMetrics!.dayW).toBeGreaterThanOrEqual(180);
    if (initialMetrics!.todayOffsetLeft > initialMetrics!.clientWidth / 2) {
      expect(initialMetrics!.scrollLeft).toBeGreaterThan(0);
      const todayScreenCenter =
        initialMetrics!.todayOffsetLeft + initialMetrics!.dayW / 2 - initialMetrics!.scrollLeft;
      expect(Math.abs(todayScreenCenter - initialMetrics!.clientWidth / 2)).toBeLessThan(120);
    }

    // Verify toolbar alignment: 3-point zoom labels sit left-to-right on one row, dept & search sit side-by-side
    const yearPresetBox = await page.getByRole('button', { name: viMessages.calendar.zoomYear, exact: true }).boundingBox();
    const monthPresetBox = await page.getByRole('button', { name: viMessages.calendar.zoomMonth, exact: true }).boundingBox();
    const weekPresetBox = await page.getByRole('button', { name: viMessages.calendar.zoomWeek, exact: true }).boundingBox();
    const deptSelectBox = await page.locator('.hcal-dept-select').boundingBox();
    const searchInputBox = await page.locator('.hcal-search-input').boundingBox();
    expect(yearPresetBox).not.toBeNull();
    expect(monthPresetBox).not.toBeNull();
    expect(weekPresetBox).not.toBeNull();
    expect(yearPresetBox!.x).toBeLessThan(monthPresetBox!.x);
    expect(monthPresetBox!.x).toBeLessThan(weekPresetBox!.x);
    expect(Math.abs(yearPresetBox!.y - weekPresetBox!.y)).toBeLessThanOrEqual(2);
    expect(deptSelectBox).not.toBeNull();
    expect(searchInputBox).not.toBeNull();
    expect(Math.abs(deptSelectBox!.y - searchInputBox!.y)).toBeLessThanOrEqual(4);
    expect(deptSelectBox!.x + deptSelectBox!.width).toBeLessThanOrEqual(searchInputBox!.x);

    // 2. Verify all 5 deadline color classes + zero Priority UI on /tasks
    await expect(page.locator(`.hcal-task-bar.deadline-overdue[data-task-id="${overdueTaskId}"]`)).toBeVisible();
    await expect(page.locator(`.hcal-task-bar.deadline-urgent[data-task-id="${urgentTaskId}"]`)).toBeVisible();
    await expect(page.locator(`.hcal-task-bar.deadline-soon[data-task-id="${soonTaskId}"]`)).toBeVisible();
    await expect(page.locator(`.hcal-task-bar.deadline-safe[data-task-id="${safeTaskId}"]`)).toBeVisible();
    await expect(page.locator(`.hcal-task-bar.deadline-done[data-task-id="${doneTaskId}"]`)).toBeVisible();
    await expect(page.locator('.ui-prio, .prio-p1, .prio-p2, .prio-p3, .prio-p4')).toHaveCount(0);
    await expect(page.getByLabel(/priority|độ ưu tiên/i)).toHaveCount(0);

    // 3. Apple range zoom slider + Year/Month/Week presets + Ctrl+Wheel
    const zoomSlider = page.getByLabel(viMessages.calendar.zoomAriaLabel, { exact: true });
    await page.getByRole('button', { name: viMessages.calendar.zoomYear, exact: true }).click();
    await expect(canvas).toHaveAttribute('data-zoom-tier', 'year');

    await page.getByRole('button', { name: viMessages.calendar.zoomWeek, exact: true }).click();
    await expect(canvas).toHaveAttribute('data-zoom-tier', 'week');

    await zoomSlider.fill('50');
    await expect(canvas).toHaveAttribute('data-zoom-tier', 'month');

    // Ctrl+Wheel zoom transitions from month (50) toward week or year
    const scrollerBox = await scroller.boundingBox();
    expect(scrollerBox).not.toBeNull();
    await page.mouse.move(scrollerBox!.x + scrollerBox!.width / 2, scrollerBox!.y + scrollerBox!.height / 2);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -160);
    await page.keyboard.up('Control');
    await expect
      .poll(async () => Number(await zoomSlider.inputValue()))
      .toBeGreaterThan(50);

    // 4. Month select, prev/next month buttons, Today centering & Year switcher
    const waitTimelineCenteredInMonth = async (targetMonthIdx: number) => {
      await expect
        .poll(async () =>
          page.evaluate((yr) => {
            const scrollerEl = document.getElementById('hcal-scroller');
            const canvasEl = document.getElementById('hcal-canvas');
            if (!scrollerEl || !canvasEl) return -1;
            const dayW = Number.parseFloat(canvasEl.style.getPropertyValue('--day-w') || '0');
            if (!dayW) return -1;
            const centerDay = Math.floor((scrollerEl.scrollLeft + scrollerEl.clientWidth / 2) / dayW);
            const clampedDay = Math.max(0, Math.min(365, centerDay));
            return new Date(Date.UTC(yr, 0, 1 + clampedDay)).getUTCMonth();
          }, currentVnYear),
        )
        .toBe(targetMonthIdx);
    };

    const monthSelect = page.getByLabel(viMessages.calendar.selectMonth, { exact: true });
    await monthSelect.selectOption('0'); // Month 1
    await waitTimelineCenteredInMonth(0);
    await expect
      .poll(async () => Number(await monthSelect.inputValue()))
      .toBe(0);

    await page.getByLabel(viMessages.calendar.nextMonth, { exact: true }).click();
    await waitTimelineCenteredInMonth(1);
    await expect
      .poll(async () => Number(await monthSelect.inputValue()))
      .toBe(1);

    await page.getByLabel(viMessages.calendar.prevMonth, { exact: true }).click();
    await waitTimelineCenteredInMonth(0);
    await expect
      .poll(async () => Number(await monthSelect.inputValue()))
      .toBe(0);

    await page.getByRole('button', { name: viMessages.calendar.today, exact: true }).click();
    const expectedCurrentMonth = Number.parseInt(vnDateIsoOffset(0).slice(5, 7), 10) - 1;
    await waitTimelineCenteredInMonth(expectedCurrentMonth);
    await expect
      .poll(async () => Number(await monthSelect.inputValue()))
      .toBe(expectedCurrentMonth);

    // Year switcher ◀ / ▶ updates URL year & reloads tasks, then back to current year
    await page.getByLabel(viMessages.calendar.nextYear, { exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`year=${currentVnYear + 1}`));
    await expect(page.locator('.hcal-year-label')).toHaveText(String(currentVnYear + 1));

    await page.getByLabel(viMessages.calendar.prevYear, { exact: true }).click();
    await expect(page).not.toHaveURL(/year=/);
    await expect(page.locator('.hcal-year-label')).toHaveText(String(currentVnYear));

    // 5. Unscheduled tray is permanently removed under CR-14 (A1)
    await expect(page.locator('.hcal-unscheduled-tray')).toHaveCount(0);
    await expect(page.locator('.hcal-unscheduled-toggle')).toHaveCount(0);
    await expect(page.locator('.hcal-unscheduled-chip')).toHaveCount(0);

    // 6. Deadline filter pills with counts, Department filter & Search q
    const filterGroup = page.getByRole('group', { name: viMessages.calendar.deadlineFilterGroup });
    const allPillText = await filterGroup.locator('button').nth(0).innerText();
    expect(allPillText).toMatch(/Tất cả \(\d+\)/);

    await filterGroup
      .locator('button', { hasText: viMessages.calendar.filterOverdue.replace(/\s*\(\{count\}\)/, '') })
      .click();
    await expect(page).toHaveURL(/deadline=overdue/);
    await expect(page.locator(`.hcal-task-bar[data-task-id="${overdueTaskId}"]`)).toBeVisible();
    await expect(page.locator(`.hcal-task-bar[data-task-id="${safeTaskId}"]`)).toHaveCount(0);

    await filterGroup
      .locator('button', { hasText: viMessages.calendar.filterDone.replace(/\s*\(\{count\}\)/, '') })
      .click();
    await expect(page).toHaveURL(/deadline=done/);
    await expect(page.locator(`.hcal-task-bar[data-task-id="${doneTaskId}"]`)).toBeVisible();
    await expect(page.locator(`.hcal-task-bar[data-task-id="${overdueTaskId}"]`)).toHaveCount(0);

    await filterGroup
      .locator('button', { hasText: viMessages.calendar.filterAll.replace(/\s*\(\{count\}\)/, '') })
      .click();
    await expect(page).not.toHaveURL(/deadline=/);

    // Department filter
    const deptFilter = page.getByLabel(viMessages.calendar.departmentFilterLabel, { exact: true });
    await deptFilter.selectOption(deptAId);
    await expect(page).toHaveURL(new RegExp(`dept=${deptAId}`));
    await expect(page.locator(`.hcal-task-bar[data-task-id="${overdueTaskId}"]`)).toBeVisible();
    await expect(page.locator(`.hcal-task-bar[data-task-id="${soonTaskId}"]`)).toHaveCount(0);

    // Search q
    const searchInput = page.getByLabel(viMessages.calendar.searchLabel, { exact: true });
    await searchInput.fill(`needle-urgent-${suffix}`);
    await expect(page).toHaveURL(new RegExp(`q=needle-urgent-${suffix}`));
    await expect(page.locator(`.hcal-task-bar[data-task-id="${urgentTaskId}"]`)).toBeVisible();
    await expect(page.locator(`.hcal-task-bar[data-task-id="${overdueTaskId}"]`)).toHaveCount(0);

    await deptFilter.selectOption('');
    await searchInput.fill('');
    await expect(page).not.toHaveURL(/dept=|q=/);

    // 7. Legacy /boards and /boards/[id]?task=[id] redirects preserve ?task= and open near-fullscreen modal
    await page.goto('/boards');
    await page.waitForURL(`${BASE_ORIGIN}/tasks`);

    await page.goto(`/boards/${seedBoardId}?task=${safeTaskId}`);
    await page.waitForURL(`${BASE_ORIGIN}/tasks?task=${safeTaskId}`);
    const redirectedModal = getTaskModal(page);
    await expect(redirectedModal).toBeVisible();
    await expect(redirectedModal.getByLabel(viMessages.tasks.titleLabel)).toHaveValue(safeTitle);
    await redirectedModal.getByRole('button', { name: viMessages.common.close }).click();
    await expect(redirectedModal).toHaveCount(0);
    await expect(page).toHaveURL(`${BASE_ORIGIN}/tasks`);

    await tracker.assertClean();
  });

  test('creates boardless task with startAt/dueAt validation & 3 role="switch" toggles, edits in near-fullscreen modal with 409 reload & undo toast, updates status to Done, and uses inline Comments & History sub-tabs', async ({
    page,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await signInAs(page, leadStudentId, '/tasks');

    const createdTitle = `CR10 Boardless Task ${suffix}`;
    const editedTitle = `CR10 Boardless Edited ${suffix}`;
    const concurrentTitle = `CR10 Concurrent Edit ${suffix}`;
    const liveCommentBody = `CR10 inline comment ${suffix}`;

    // 1. Open CreateTaskModal (+ Tạo công việc) -> verify NO priority field, 3 role="switch" toggles,
    //    Bug #1 (A1): startAt defaults to Today (VN), no clear-date buttons, empty dueAt rejected, startAt > dueAt rejected, API 400 on omitted dates
    const missingStartRes = await page.request.post('/api/v1/tasks', {
      data: { title: `Missing startAt ${suffix}`, dueAt: vnMidnightUtc(1).toISOString() },
    });
    expect(missingStartRes.status()).toBe(400);
    const missingDueRes = await page.request.post('/api/v1/tasks', {
      data: { title: `Missing dueAt ${suffix}`, startAt: vnMidnightUtc(0).toISOString() },
    });
    expect(missingDueRes.status()).toBe(400);

    await page
      .getByRole('button', { name: `+ ${viMessages.calendar.createTask}`, exact: true })
      .click();
    const createDialog = page.locator('.ui-modal[role="dialog"]');
    await expect(createDialog).toBeVisible();
    await expect(createDialog.getByLabel(/priority|độ ưu tiên/i)).toHaveCount(0);
    await expect(createDialog.getByTestId('task-due-clear-btn')).toHaveCount(0);
    await expect(createDialog.locator('.task-date-clear-btn')).toHaveCount(0);

    const switches = createDialog.getByRole('switch');
    await expect(switches).toHaveCount(3);
    const inAppSwitch = createDialog.getByRole('switch', { name: viMessages.tasks.notifyInAppLabel });
    const emailSwitch = createDialog.getByRole('switch', { name: viMessages.tasks.notifyEmailLabel });
    const hiddenSwitch = createDialog.getByRole('switch', { name: viMessages.tasks.isHiddenShortLabel });
    await expect(inAppSwitch).toHaveAttribute('aria-checked', 'true');
    await expect(emailSwitch).toHaveAttribute('aria-checked', 'true');
    await expect(hiddenSwitch).toHaveAttribute('aria-checked', 'false');

    // Turn off email & web notifications for this setup test, verify toggle transitions
    await inAppSwitch.click();
    await emailSwitch.click();
    await expect(inAppSwitch).toHaveAttribute('aria-checked', 'false');
    await expect(emailSwitch).toHaveAttribute('aria-checked', 'false');

    await createDialog.getByLabel(viMessages.tasks.titleLabel, { exact: true }).fill(createdTitle);
    const startInput = createDialog.getByLabel(viMessages.tasks.startAtLabel, { exact: true });
    const dueInput = createDialog.getByLabel(viMessages.tasks.dueAtLabel, { exact: true });
    await expect(startInput).toHaveValue(vnDateIsoOffset(0));
    await expect(dueInput).toHaveValue('');

    // Reject empty dueAt
    await createDialog.getByRole('button', { name: viMessages.tasks.createSubmit, exact: true }).click();
    await expect(createDialog.getByRole('alert')).toContainText(viMessages.tasks.validationDueAt);

    const startIso = vnDateIsoOffset(1);
    const invalidEarlyDueIso = vnDateIsoOffset(0);
    const validDueIso = vnDateIsoOffset(3); // soon tier (2-3 days)

    await startInput.fill(startIso);
    await dueInput.fill(invalidEarlyDueIso);
    await createDialog.getByRole('button', { name: viMessages.tasks.createSubmit, exact: true }).click();
    await expect(createDialog.getByRole('alert')).toContainText(viMessages.errors.invalidDateRange);

    // Fix dueAt >= startAt, assign Dept A, and submit boardless POST /api/v1/tasks
    await dueInput.fill(validDueIso);
    await createDialog
      .locator('label.dept-check-item', { hasText: deptAName })
      .locator('input[type="checkbox"]')
      .check();

    const createPromise = page.waitForResponse(
      (res) => res.url().endsWith('/api/v1/tasks') && res.request().method() === 'POST',
    );
    await createDialog.getByRole('button', { name: viMessages.tasks.createSubmit, exact: true }).click();
    const createRes = await createPromise;
    expect(createRes.status()).toBe(201);
    const sentPayload = createRes.request().postDataJSON() as Record<string, unknown>;
    expect(sentPayload.boardId).toBeUndefined();
    expect(sentPayload.columnId).toBeUndefined();
    expect(sentPayload.priority).toBe(2);
    expect(sentPayload).toMatchObject({
      departmentIds: [deptAId],
      notifyInApp: false,
      notifyEmail: false,
      isHidden: false,
    });
    const createdTask = ((await createRes.json()) as { task: { id: string; boardId: string } }).task;
    trackedTaskIds.push(createdTask.id);
    if (!workspaceBoardPreexisted && !trackedBoardIds.includes(createdTask.boardId)) {
      trackedBoardIds.push(createdTask.boardId);
    }

    const createdBar = page.locator(`.hcal-task-bar.deadline-soon[data-task-id="${createdTask.id}"]`);
    await expect(createdBar).toBeVisible();
    await expect(createdBar).toContainText(createdTitle);

    // 2. Open near-fullscreen Task Detail Modal -> verify dimensions, 2 columns, zero Priority UI
    await createdBar.click();
    const modal = getTaskModal(page);
    await expect(modal).toBeVisible();
    const modalBox = await modal.boundingBox();
    expect(modalBox).not.toBeNull();
    expect(modalBox!.width).toBeGreaterThanOrEqual(1150);
    expect(modalBox!.height).toBeGreaterThanOrEqual(600);

    const mainColBox = await modal.locator('.task-modal-col-main').boundingBox();
    const sideColBox = await modal.locator('.task-modal-col-side').boundingBox();
    expect(mainColBox).not.toBeNull();
    expect(sideColBox).not.toBeNull();
    expect(sideColBox!.x).toBeGreaterThanOrEqual(mainColBox!.x + mainColBox!.width);
    await expect(modal.getByLabel(/priority|độ ưu tiên/i)).toHaveCount(0);
    await expect(modal.locator('.ui-prio')).toHaveCount(0);

    // 3. Edit title & verify 10s Undo toast (Major-1 mount stability across version 1->2)
    await modal.getByLabel(viMessages.tasks.titleLabel, { exact: true }).fill(editedTitle);
    const editPromise = page.waitForResponse(
      (res) => res.url().endsWith(`/api/v1/tasks/${createdTask.id}`) && res.request().method() === 'PATCH',
    );
    await modal.getByRole('button', { name: viMessages.tasks.saveDetails, exact: true }).click();
    const editRes = await editPromise;
    expect(editRes.status()).toBe(200);
    const editEventId = ((await editRes.json()) as { eventId: string }).eventId;

    const updatedToast = page
      .locator('[data-sonner-toast]', { hasText: viMessages.tasks.updatedToast })
      .last();
    await expect(updatedToast).toBeVisible();
    const undoBtn = updatedToast.getByRole('button', { name: viMessages.taskHistory.undoAction, exact: true });
    await expect(undoBtn).toBeVisible();

    const undoPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/tasks/${createdTask.id}/events/${editEventId}/revert`) &&
        res.request().method() === 'POST',
    );
    await undoBtn.click();
    expect((await undoPromise).status()).toBe(200);
    await expect(modal.getByLabel(viMessages.tasks.titleLabel, { exact: true })).toHaveValue(createdTitle);

    // 4. Simulate concurrent edit (version 3 -> 4), trigger 409 in modal, click Reload -> banner clears & loads concurrentTitle (Major-2)
    const concurrentRes = await page.request.patch(`/api/v1/tasks/${createdTask.id}`, {
      data: { title: concurrentTitle, version: 3 },
    });
    expect(concurrentRes.status()).toBe(200);

    await modal.getByLabel(viMessages.tasks.titleLabel, { exact: true }).fill(`Stale ${suffix}`);
    const conflictPromise = page.waitForResponse(
      (res) => res.url().endsWith(`/api/v1/tasks/${createdTask.id}`) && res.request().method() === 'PATCH',
    );
    await modal.getByRole('button', { name: viMessages.tasks.saveDetails, exact: true }).click();
    expect((await conflictPromise).status()).toBe(409);

    const conflictAlert = modal.getByRole('alert');
    await expect(conflictAlert).toContainText(viMessages.errors.taskVersionConflict);
    const reloadPromise = page.waitForResponse(
      (res) => res.url().endsWith(`/api/v1/tasks/${createdTask.id}`) && res.request().method() === 'GET',
    );
    await modal.getByRole('button', { name: viMessages.tasks.versionConflictReload, exact: true }).click();
    expect((await reloadPromise).status()).toBe(200);
    await expect(modal.getByLabel(viMessages.tasks.titleLabel, { exact: true })).toHaveValue(concurrentTitle);
    await expect(modal.locator('.ui-banner.is-danger')).toHaveCount(0);

    // 5. Status <select> Đang thực hiện -> Hoàn thành updates task bar border to .deadline-done
    const statusSelect = modal.getByLabel(viMessages.tasks.statusLabel, { exact: true });
    await expect(statusSelect).toHaveValue('active');
    const completePromise = page.waitForResponse(
      (res) => res.url().endsWith(`/api/v1/tasks/${createdTask.id}`) && res.request().method() === 'PATCH',
    );
    await statusSelect.selectOption('completed');
    expect((await completePromise).status()).toBe(200);
    await expect(statusSelect).toHaveValue('completed');
    await expect(page.locator(`.hcal-task-bar.deadline-done[data-task-id="${createdTask.id}"]`)).toBeVisible();

    // 6. Inline Comments & History sub-tabs
    const subTabs = modal.locator('.task-subtabs');
    await expect(subTabs.getByRole('tab', { name: new RegExp(escapeRegex(viMessages.tasks.tabComments)) })).toHaveAttribute('aria-selected', 'true');
    await modal.getByLabel(viMessages.comments.composerLabel).fill(liveCommentBody);
    const commentPostPromise = page.waitForResponse(
      (res) => res.url().includes(`/api/v1/tasks/${createdTask.id}/comments`) && res.request().method() === 'POST',
    );
    await modal.getByRole('button', { name: viMessages.comments.submit, exact: true }).click();
    expect((await commentPostPromise).status()).toBe(201);
    await expect(modal.getByText(liveCommentBody)).toBeVisible();

    await subTabs.getByRole('tab', { name: viMessages.tasks.tabHistory, exact: true }).click();
    await expect(modal.locator('.task-history-section')).toBeVisible();
    const historyText = await modal.locator('.task-history-section').innerText();
    expect(historyText).not.toMatch(UUID_PATTERN);
    assertZeroPii([historyText], sensitiveValues);

    // Revert isCompleted from History tab (filter for the completed-status change row, since comment.added is newest)
    const completedHistoryRow = modal.locator('li.task-history-row', {
      hasText: viMessages.taskHistory.statusDone,
    });
    const revertStatusPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/tasks/${createdTask.id}/events/`) &&
        res.url().endsWith('/revert') &&
        res.request().method() === 'POST',
    );
    await completedHistoryRow
      .getByRole('button', { name: viMessages.taskHistory.restoreValueButton, exact: true })
      .click();
    expect((await revertStatusPromise).status()).toBe(200);
    await expect(statusSelect).toHaveValue('active');
    await expect(page.locator(`.hcal-task-bar.deadline-soon[data-task-id="${createdTask.id}"]`)).toBeVisible();

    await modal.getByRole('button', { name: viMessages.common.close }).click();
    await expect(modal).toHaveCount(0);
    await tracker.assertClean();
  });

  test('completes Lead acceptance & deliverables loop via /tasks modal & Bell, updates /progress badges/filters (consolidated from /my-tasks), and enforces hidden 404 & WQ-27', async ({
    browser,
    page,
  }) => {
    const tracker = await attachRuntimeErrorTracker(page);
    await page.setViewportSize({ width: 1280, height: 720 });

    const flowTitle = `CR10 Lead Loop ${suffix}`;
    const hiddenTitle = `CR10_TOP_SECRET_${suffix}`;
    const hiddenDelivTitle = `CR10_SECRET_DOC_${suffix}`;
    const hiddenDelivUrl = `https://secret.example.com/cr10-${suffix}`;
    const deliv1Title = `Figma Spec ${suffix}`;
    const deliv1Url = `https://figma.com/file/cr10-1-${suffix}`;
    const deliv2Title = `Slides PDF ${suffix}`;
    const deliv2Url = `https://drive.google.com/file/d/cr10-2-${suffix}`;

    // Admin creates 1 public urgent task + 1 hidden task assigned to Dept A
    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    const adminTracker = await attachRuntimeErrorTracker(adminPage);
    let publicTaskId = '';
    let hiddenTaskId = '';
    try {
      await signInAs(adminPage, adminStudentId, '/tasks');
      const pubRes = await adminPage.request.post('/api/v1/tasks', {
        data: {
          title: flowTitle,
          startAt: vnMidnightUtc(0).toISOString(),
          dueAt: vnMidnightUtc(1).toISOString(),
          departmentIds: [deptAId],
          notifyInApp: false,
          notifyEmail: false,
        },
      });
      expect(pubRes.status()).toBe(201);
      const pubJson = (await pubRes.json()) as { task: { id: string; boardId: string } };
      publicTaskId = pubJson.task.id;
      trackedTaskIds.push(publicTaskId);
      if (!workspaceBoardPreexisted && !trackedBoardIds.includes(pubJson.task.boardId)) {
        trackedBoardIds.push(pubJson.task.boardId);
      }

      const hidRes = await adminPage.request.post('/api/v1/tasks', {
        data: {
          title: hiddenTitle,
          startAt: vnMidnightUtc(0).toISOString(),
          dueAt: vnMidnightUtc(2).toISOString(),
          departmentIds: [deptAId],
          isHidden: true,
          notifyInApp: false,
          notifyEmail: false,
        },
      });
      expect(hidRes.status()).toBe(201);
      hiddenTaskId = ((await hidRes.json()) as { task: { id: string } }).task.id;
      trackedTaskIds.push(hiddenTaskId);
      await adminTracker.assertClean();
    } finally {
      await adminCtx.close();
    }

    // 1. Dept A member visits /my-tasks -> redirects to /progress, sees pending badge & Giao cho Ban pill (no Priority UI),
    //    opens task modal on /tasks, ticks "Đã nhận công việc", submits 2 deliverables & deletes 1
    await signInAs(page, memberStudentId, '/progress', '/my-tasks');
    await expect(page.locator('.app-side a[href="/my-tasks"]')).toHaveCount(0);
    const myRowBefore = page.locator('.prog-row', { hasText: flowTitle });
    await expect(myRowBefore).toBeVisible();
    await expect(myRowBefore.locator('.prog-dot.is-urgent')).toBeVisible();
    await expect(myRowBefore).toContainText(viMessages.progress.unacceptedShort);
    await expect(myRowBefore).toContainText(viMessages.progress.deptAssignedPill);
    await expect(page.locator('.ui-prio, .prio-p1, .prio-p2, .prio-p3, .prio-p4')).toHaveCount(0);

    // Filter /progress by Việc của Ban and Đã xong
    const progressTabs = page.locator('.prog-filter-tabs');
    await progressTabs.getByRole('tab', { name: viMessages.progress.filterDepartment, exact: true }).click();
    await expect(myRowBefore).toBeVisible();
    await progressTabs.getByRole('tab', { name: viMessages.progress.filterDone, exact: true }).click();
    await expect(page.locator('.prog-row', { hasText: flowTitle })).toHaveCount(0);
    await progressTabs.getByRole('tab', { name: viMessages.progress.filterOpen, exact: true }).click();
    await expect(myRowBefore).toBeVisible();

    // Open /tasks and click urgent task bar
    await page.locator('.app-side a.app-nav-item[href="/tasks"]').click();
    await page.waitForURL(`${BASE_ORIGIN}/tasks`);
    const taskBar = page.locator(`.hcal-task-bar.deadline-urgent[data-task-id="${publicTaskId}"]`);
    await expect(taskBar).toBeVisible();
    await taskBar.click();

    const modal = getTaskModal(page);
    await expect(modal).toBeVisible();
    await expect(modal.locator('.task-deliverables-lead')).toContainText(leadFullName);

    // Tick "Đã nhận công việc" role="switch"
    const acceptSwitch = modal.getByRole('switch', { name: viMessages.tasks.acceptTaskSwitch });
    await expect(acceptSwitch).toHaveAttribute('aria-checked', 'false');
    const acceptPromise = page.waitForResponse(
      (res) => res.url().endsWith(`/api/v1/tasks/${publicTaskId}/acceptance`) && res.request().method() === 'PUT',
    );
    await acceptSwitch.click();
    expect((await acceptPromise).status()).toBe(200);
    await expect(acceptSwitch).toHaveAttribute('aria-checked', 'true');
    await expect(
      page.locator('[data-sonner-toast]', {
        hasText: viMessages.tasks.notifiedLeadsBanner.replace('{leads}', leadFullName),
      }),
    ).toBeVisible();

    // Reject javascript: URL client-side, then submit 2 deliverable links & delete 1
    const delivTitleInput = modal.getByLabel(viMessages.tasks.deliverableTitlePlaceholder, { exact: true });
    const delivUrlInput = modal.getByLabel(viMessages.tasks.deliverableUrlPlaceholder, { exact: true });
    const delivSubmitBtn = modal.getByRole('button', { name: viMessages.tasks.deliverableSubmit, exact: true });

    await delivTitleInput.fill('Bad XSS');
    await delivUrlInput.fill('javascript:alert(1)');
    await delivSubmitBtn.click();
    await expect(modal.getByRole('alert')).toContainText(viMessages.errors.invalidDeliverableUrl);

    for (const item of [
      { title: deliv1Title, url: deliv1Url },
      { title: deliv2Title, url: deliv2Url },
    ]) {
      await delivTitleInput.fill(item.title);
      await delivUrlInput.fill(item.url);
      const addDelivPromise = page.waitForResponse(
        (res) => res.url().endsWith(`/api/v1/tasks/${publicTaskId}/deliverables`) && res.request().method() === 'POST',
      );
      await delivSubmitBtn.click();
      expect((await addDelivPromise).status()).toBe(201);
    }

    const link1 = modal.locator('a.task-deliverable-link', { hasText: deliv1Title });
    const link2 = modal.locator('a.task-deliverable-link', { hasText: deliv2Title });
    await expect(link1).toHaveAttribute('href', deliv1Url);
    await expect(link1).toHaveAttribute('target', '_blank');
    await expect(link1).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(link2).toHaveAttribute('href', deliv2Url);

    // Delete second deliverable
    const deliv2Row = modal.locator('.task-deliverable-row', { hasText: deliv2Title });
    const delDelivPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/tasks/${publicTaskId}/deliverables/`) &&
        res.request().method() === 'DELETE',
    );
    await deliv2Row.getByRole('button', { name: viMessages.tasks.deliverableDelete, exact: true }).click();
    expect((await delDelivPromise).status()).toBe(200);
    await expect(modal.locator('.task-deliverable-row', { hasText: deliv2Title })).toHaveCount(0);

    await modal.getByRole('button', { name: viMessages.common.close }).click();

    // Verify /progress now shows Đã nhận and 1 deliverable link in Inspector
    await page.locator('.app-side a[href="/progress"]').click();
    await page.waitForURL(`${BASE_ORIGIN}/progress`);
    const myRowAfter = page.locator('.prog-row', { hasText: flowTitle });
    await expect(myRowAfter).toContainText(viMessages.progress.acceptedShort);
    await myRowAfter.locator('.prog-row-btn').click();
    await expect(page.locator('.prog-summary-card .prog-accept-btn.is-accepted')).toBeVisible();
    await expect(page.locator('.prog-deliv-card')).toContainText(
      viMessages.progress.deliverablesTitle.replace('{count}', '1'),
    );

    // Also accept and submit deliverable on hidden task as Dept A member -> Lead Bell gets redacted WQ-27 notifications
    expect(
      (await page.request.put(`/api/v1/tasks/${hiddenTaskId}/acceptance`, { data: { accepted: true } })).status(),
    ).toBe(200);
    expect(
      (
        await page.request.post(`/api/v1/tasks/${hiddenTaskId}/deliverables`, {
          data: { title: hiddenDelivTitle, url: hiddenDelivUrl },
        })
      ).status(),
    ).toBe(201);

    // 2. Department Lead logs in -> Bell receives task.accepted + task.deliverable_submitted (public + WQ-27 hidden redacted)
    const leadCtx = await browser.newContext();
    const leadPage = await leadCtx.newPage();
    const leadTracker = await attachRuntimeErrorTracker(leadPage);
    try {
      await signInAs(leadPage, leadStudentId, '/tasks');
      const bellBtn = leadPage.getByRole('button', {
        name: new RegExp(escapeRegex(viMessages.notifications.bellAriaLabel)),
      });
      await expect(bellBtn).toBeVisible();
      await bellBtn.click();

      const popover = leadPage.locator(`[aria-label="${viMessages.notifications.popoverAriaLabel}"]`);
      await expect(popover).toBeVisible();

      const expectedPubAccept = viMessages.notifications.taskAccepted
        .replace('{actorName}', memberFullName)
        .replace('{taskTitle}', flowTitle);
      const expectedPubDeliv = viMessages.notifications.taskDeliverableSubmitted
        .replace('{actorName}', memberFullName)
        .replace('{taskTitle}', flowTitle);
      await expect(popover).toContainText(expectedPubAccept);
      await expect(popover).toContainText(expectedPubDeliv);
      await expect(popover).toContainText(viMessages.notifications.hiddenTaskAccepted);
      await expect(popover).toContainText(viMessages.notifications.hiddenTaskDeliverableSubmitted);

      const popoverText = await popover.innerText();
      expect(popoverText).not.toContain(hiddenTitle);
      expect(popoverText).not.toContain(hiddenDelivTitle);
      expect(popoverText).not.toContain(hiddenDelivUrl);
      assertZeroPii([popoverText], sensitiveValues);

      // Clicking notification navigates to /tasks?task=<id> and opens modal
      await popover.getByText(expectedPubAccept).click();
      await leadPage.waitForURL(`${BASE_ORIGIN}/tasks?task=${publicTaskId}`);
      const leadModal = getTaskModal(leadPage);
      await expect(leadModal).toBeVisible();
      await expect(leadModal.getByLabel(viMessages.tasks.titleLabel, { exact: true })).toHaveValue(flowTitle);
      await leadModal.getByRole('button', { name: viMessages.common.close }).click();
      await leadTracker.assertClean();
    } finally {
      await leadCtx.close();
    }

    // 3. Outsider (non-viewer even with task.update_any) receives 404 on API & /tasks?task=<hiddenId> UI
    const outsiderCtx = await browser.newContext();
    const outsiderPage = await outsiderCtx.newPage();
    const outsiderTracker = await attachRuntimeErrorTracker(outsiderPage);
    try {
      await signInAs(outsiderPage, outsiderStudentId, '/tasks');
      await expect(outsiderPage.locator(`.hcal-task-bar[data-task-id="${hiddenTaskId}"]`)).toHaveCount(0);
      expect((await outsiderPage.request.get(`/api/v1/tasks/${hiddenTaskId}`)).status()).toBe(404);
      expect((await outsiderPage.request.put(`/api/v1/tasks/${hiddenTaskId}/acceptance`, { data: { accepted: true } })).status()).toBe(404);
      expect((await outsiderPage.request.get(`/api/v1/tasks/${hiddenTaskId}/deliverables`)).status()).toBe(404);

      await outsiderPage.goto(`/tasks?task=${hiddenTaskId}`);
      const notFoundModal = getTaskModal(outsiderPage);
      await expect(notFoundModal).toBeVisible();
      await expect(notFoundModal.getByText(viMessages.errors['404'].code)).toBeVisible();
      await expect(notFoundModal.getByText(viMessages.errors['404'].title)).toBeVisible();
      await outsiderTracker.assertClean();
    } finally {
      await outsiderCtx.close();
    }

    await tracker.assertClean();
  });
});

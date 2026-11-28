import { describe, expect, it } from 'vitest';
import {
  isRevertableTaskEventType,
  listBoardTrashQuerySchema,
  listTaskEventsQuerySchema,
  NON_REVERTABLE_TASK_EVENT_TYPES,
  REVERTABLE_TASK_EVENT_TYPES,
  revertTaskEventRequestSchema,
} from '@/lib/task-events';
import {
  assertCanViewTaskEvents,
  decodeBoardTrashCursor,
  decodeTaskEventCursor,
  encodeBoardTrashCursor,
  encodeTaskEventCursor,
  getRevertCommand,
  TASK_EVENT_COMMAND_REGISTRY,
  type ApplyRevertRepoParams,
  type ListBoardTrashRepoParams,
  type ListTaskEventsRepoParams,
  type RevertResolvedTargets,
  type RevertTargetIntent,
  type TaskEventContext,
  type TaskEventRecord,
  type TaskEventsRepository,
  TaskEventsService,
} from '@/server/modules/task-events';
import type { TaskMemberSummaryRecord, TaskRecord } from '@/server/modules/tasks';
import { parseOptionalJsonBody } from '@/server/shared/auth-http';
import type { AuthActor } from '@/server/shared/authorize';
import { FakeClock } from '@/server/shared/clock';
import { StructuredLogger } from '@/server/shared/logger';
import type { TransactionContext, TransactionRunner } from '@/server/shared/transaction';

const BOARD_ID = '40000000-0000-4000-8000-000000000001';
const COL_A = '50000000-0000-4000-8000-000000000001';
const COL_B = '50000000-0000-4000-8000-000000000002';
const COL_DELETED = '50000000-0000-4000-8000-000000000099';
const TASK_ID = '60000000-0000-4000-8000-000000000001';
const ADMIN_ID = '10000000-0000-4000-8000-000000000001';
const CREATOR_ID = '10000000-0000-4000-8000-000000000010';
const ASSIGNEE_ID = '10000000-0000-4000-8000-000000000011';
const DEPT_MEMBER_ID = '10000000-0000-4000-8000-000000000012';
const EDITOR_ID = '10000000-0000-4000-8000-000000000013';
const ASSIGNER_ID = '10000000-0000-4000-8000-000000000014';
const DELETER_ID = '10000000-0000-4000-8000-000000000015';
const OUTSIDER_ID = '10000000-0000-4000-8000-000000000016';
const PURGED_USER_ID = '10000000-0000-4000-8000-000000000099';
const DEPT_ID = '20000000-0000-4000-8000-000000000001';
const DELETED_DEPT_ID = '20000000-0000-4000-8000-000000000099';

function makeMember(id: string, fullName: string, isActive = true): TaskMemberSummaryRecord {
  return {
    id,
    fullName,
    avatarUpdatedAt: null,
    isActive,
    leftAt: isActive ? null : new Date('2026-10-01T00:00:00.000Z'),
    departments: [{ id: DEPT_ID, name: 'Media' }],
  };
}

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  const now = new Date('2026-11-26T04:00:00.000Z');
  return {
    id: TASK_ID,
    boardId: BOARD_ID,
    columnId: COL_A,
    title: 'Initial Title',
    description: 'Initial Desc',
    startAt: new Date('2026-11-26T04:00:00.000Z'),
    dueAt: new Date('2026-12-01T10:00:00.000Z'),
    isCompleted: false,
    completedAt: null,
    priority: 2,
    position: '1000',
    isHidden: false,
    version: 1,
    deletedAt: null,
    createdBy: CREATOR_ID,
    assignees: [{ ...makeMember(ASSIGNEE_ID, 'Assignee'), acceptedAt: null }],
    assignedDepartments: [{ id: DEPT_ID, name: 'Media' }],
    deliverables: [],
    deliverableCount: 0,
    creator: makeMember(CREATOR_ID, 'Creator'),
    commentCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

class InMemoryTaskEventsRepository implements TaskEventsRepository {
  readonly tasks = new Map<string, { task: TaskRecord; boardArchivedAt: Date | null }>();
  readonly events = new Map<string, TaskEventRecord>();
  readonly boards = new Set<string>([BOARD_ID]);
  readonly validColumns = new Set<string>([COL_A, COL_B]);
  readonly firstBoardColumn = COL_A;
  readonly validProfiles = new Set<string>([ADMIN_ID, CREATOR_ID, ASSIGNEE_ID, DEPT_MEMBER_ID, EDITOR_ID, ASSIGNER_ID, DELETER_ID, OUTSIDER_ID]);
  readonly validDepartments = new Set<string>([DEPT_ID]);
  private seq = 0;

  seedEvent(input: Omit<TaskEventRecord, 'id' | 'actor'> & { id?: string }): TaskEventRecord {
    this.seq += 1;
    const id = input.id ?? `70000000-0000-4000-8000-${String(this.seq).padStart(12, '0')}`;
    const rec: TaskEventRecord = {
      ...input,
      id,
      actor: makeMember(input.actorId, `Actor ${input.actorId.slice(-2)}`),
    };
    this.events.set(id, rec);
    return rec;
  }

  async findTaskContext(taskId: string): Promise<TaskEventContext | null> {
    const entry = this.tasks.get(taskId);
    return entry ? { task: entry.task, boardArchivedAt: entry.boardArchivedAt } : null;
  }

  async listByTaskId(params: ListTaskEventsRepoParams) {
    const ordered = Array.from(this.events.values())
      .filter((e) => e.taskId === params.taskId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
    const filtered = params.cursor
      ? ordered.filter(
          (e) =>
            e.createdAt.getTime() < params.cursor!.createdAt.getTime() ||
            (e.createdAt.getTime() === params.cursor!.createdAt.getTime() &&
              e.id < params.cursor!.id),
        )
      : ordered;
    const hasMore = filtered.length > params.limit;
    return { rows: hasMore ? filtered.slice(0, params.limit) : filtered, hasMore };
  }

  async findEventByIdForTask(params: { readonly taskId: string; readonly eventId: string }) {
    const evt = this.events.get(params.eventId);
    return evt && evt.taskId === params.taskId ? evt : null;
  }

  async resolveRevertTargets(params: {
    readonly boardId: string;
    readonly taskId: string;
    readonly intent: RevertTargetIntent;
  }): Promise<RevertResolvedTargets> {
    const column = params.intent.columnLookup
      ? params.intent.columnLookup.desiredColumnId &&
        this.validColumns.has(params.intent.columnLookup.desiredColumnId)
        ? {
            columnId: params.intent.columnLookup.desiredColumnId,
            position: params.intent.columnLookup.desiredPosition ?? 1000,
          }
        : { columnId: this.firstBoardColumn, position: 3000 }
      : undefined;
    const validAssigneeIds = params.intent.desiredAssigneeIds
      ? params.intent.desiredAssigneeIds.filter((id) => this.validProfiles.has(id)).sort()
      : undefined;
    const validDepartmentIds = params.intent.desiredDepartmentIds
      ? params.intent.desiredDepartmentIds.filter((id) => this.validDepartments.has(id)).sort()
      : undefined;
    return { column, validAssigneeIds, validDepartmentIds };
  }

  async applyRevertAndInsertEvent(params: ApplyRevertRepoParams) {
    const entry = this.tasks.get(params.taskId)!;
    const prev = entry.task;
    const nextTask: TaskRecord = {
      ...prev,
      ...params.plan.taskPatch,
      assignees:
        params.plan.replaceAssigneeIds !== undefined
          ? params.plan.replaceAssigneeIds.map((id) => ({ ...makeMember(id, `User ${id.slice(-2)}`), acceptedAt: null }))
          : prev.assignees,
      assignedDepartments:
        params.plan.replaceDepartmentIds !== undefined
          ? params.plan.replaceDepartmentIds.map((id) => ({ id, name: 'Media' }))
          : prev.assignedDepartments,
      version: prev.version + 1,
      updatedAt: params.now,
    };
    this.tasks.set(params.taskId, { ...entry, task: nextTask });
    const inserted = this.seedEvent({
      taskId: params.taskId,
      boardId: params.boardId,
      actorId: params.actorId,
      type: params.plan.compensatingType,
      changes: params.plan.compensatingChanges,
      revertsEventId: params.revertsEventId,
      forced: params.forced,
      createdAt: params.now,
    });
    return { task: nextTask, eventId: inserted.id };
  }

  async boardExists(boardId: string): Promise<boolean> {
    return this.boards.has(boardId);
  }

  async listBoardTrash(params: ListBoardTrashRepoParams) {
    const rows = Array.from(this.tasks.values())
      .map((entry) => entry.task)
      .filter((t) => {
        if (t.boardId !== params.boardId || t.deletedAt === null) return false;
        if (params.actor.isAdmin || !t.isHidden) return true;
        return (
          t.createdBy === params.actor.id ||
          t.assignees.some((a) => a.id === params.actor.id) ||
          t.assignedDepartments.some((d) => params.actor.departmentIds?.includes(d.id))
        );
      })
      .sort((a, b) => b.deletedAt!.getTime() - a.deletedAt!.getTime() || b.id.localeCompare(a.id));
    const filtered = params.cursor
      ? rows.filter(
          (t) =>
            t.deletedAt!.getTime() < params.cursor!.deletedAt.getTime() ||
            (t.deletedAt!.getTime() === params.cursor!.deletedAt.getTime() &&
              t.id < params.cursor!.id),
        )
      : rows;
    const hasMore = filtered.length > params.limit;
    return { rows: hasMore ? filtered.slice(0, params.limit) : filtered, hasMore };
  }
}

const MOCK_TX_RUNNER: TransactionRunner = {
  runInTransaction: async <T>(fn: (tx: TransactionContext) => Promise<T>) =>
    fn({} as TransactionContext),
};

function createHarness() {
  const clock = new FakeClock('2026-11-26T04:00:00.000Z');
  const repo = new InMemoryTaskEventsRepository();
  repo.tasks.set(TASK_ID, { task: makeTask(), boardArchivedAt: null });
  const logs: string[] = [];
  const logger = new StructuredLogger({
    writeOut: (line) => logs.push(line),
    writeErr: (line) => logs.push(line),
  });
  const service = new TaskEventsService({
    taskEventsRepo: repo,
    transactionRunner: MOCK_TX_RUNNER,
    clock,
    logger,
  });
  return { clock, repo, service, logs };
}

const ADMIN: AuthActor = { id: ADMIN_ID, isActive: true, isAdmin: true, permissions: [] };
const INACTIVE: AuthActor = { id: ADMIN_ID, isActive: false, isAdmin: true, permissions: [] };
const CREATOR: AuthActor = { id: CREATOR_ID, isActive: true, isAdmin: false, permissions: ['task.create'] };
const ASSIGNEE_UPDATE: AuthActor = { id: ASSIGNEE_ID, isActive: true, isAdmin: false, permissions: ['task.update_assigned'] };
const DEPT_UPDATE: AuthActor = { id: DEPT_MEMBER_ID, isActive: true, isAdmin: false, permissions: ['task.update_assigned'], departmentIds: [DEPT_ID] };
const ANY_EDITOR: AuthActor = { id: EDITOR_ID, isActive: true, isAdmin: false, permissions: ['task.update_any'] };
const ASSIGNER: AuthActor = { id: ASSIGNER_ID, isActive: true, isAdmin: false, permissions: ['task.assign'] };
const DELETER: AuthActor = { id: DELETER_ID, isActive: true, isAdmin: false, permissions: ['task.delete'] };
const OUTSIDER: AuthActor = { id: OUTSIDER_ID, isActive: true, isAdmin: false, permissions: ['task.update_assigned'] };
const HIDDEN_SUPER_OUTSIDER: AuthActor = {
  id: OUTSIDER_ID,
  isActive: true,
  isAdmin: false,
  permissions: ['task.update_any', 'task.assign', 'task.delete', 'comment.delete_any'],
};

describe('task-events schemas, policy, commands & TaskEventsService', () => {
  it('validates schemas, optional JSON body, canonical cursors, and command registry', async () => {
    expect(REVERTABLE_TASK_EVENT_TYPES).toHaveLength(6);
    expect(NON_REVERTABLE_TASK_EVENT_TYPES).toHaveLength(6);
    for (const t of REVERTABLE_TASK_EVENT_TYPES) {
      expect(isRevertableTaskEventType(t)).toBe(true);
      expect(TASK_EVENT_COMMAND_REGISTRY[t]).toBeDefined();
      expect(getRevertCommand(t)).toBe(TASK_EVENT_COMMAND_REGISTRY[t]);
    }
    for (const t of NON_REVERTABLE_TASK_EVENT_TYPES) {
      expect(isRevertableTaskEventType(t)).toBe(false);
      expect(getRevertCommand(t)).toBeNull();
    }
    expect(getRevertCommand('unknown.event')).toBeNull();

    expect(listTaskEventsQuerySchema.parse({ cursor: '', limit: null })).toEqual({ cursor: undefined, limit: 20 });
    expect(listBoardTrashQuerySchema.parse({ cursor: undefined, limit: '50' })).toEqual({ cursor: undefined, limit: 50 });
    expect(() => listTaskEventsQuerySchema.parse({ limit: 101 })).toThrow();
    expect(revertTaskEventRequestSchema.parse({})).toEqual({ force: false });
    expect(revertTaskEventRequestSchema.parse({ force: true })).toEqual({ force: true });
    expect(() => revertTaskEventRequestSchema.parse({ force: 'true' })).toThrow();
    expect(() => revertTaskEventRequestSchema.parse({ extra: 1 })).toThrow();

    await expect(parseOptionalJsonBody(new Request('http://localhost/x', { method: 'POST' }))).resolves.toEqual({});
    await expect(parseOptionalJsonBody(new Request('http://localhost/x', { method: 'POST', body: '   ' }))).resolves.toEqual({});
    await expect(
      parseOptionalJsonBody(new Request('http://localhost/x', { method: 'POST', body: '{"force":true}' })),
    ).resolves.toEqual({ force: true });
    await expect(
      parseOptionalJsonBody(new Request('http://localhost/x', { method: 'POST', body: '{bad' })),
    ).rejects.toMatchObject({ httpStatus: 400, code: 'INVALID_JSON' });

    const evtCursor = encodeTaskEventCursor({ createdAt: new Date('2026-11-26T04:00:00.000Z'), id: TASK_ID });
    expect(decodeTaskEventCursor(evtCursor)).toEqual({ createdAt: new Date('2026-11-26T04:00:00.000Z'), id: TASK_ID });
    expect(() => decodeTaskEventCursor(`${evtCursor}==`)).toThrow();
    expect(() => decodeTaskEventCursor('invalid')).toThrow();

    const trashCursor = encodeBoardTrashCursor({ deletedAt: new Date('2026-11-26T04:00:00.000Z'), id: TASK_ID });
    expect(decodeBoardTrashCursor(trashCursor)).toEqual({ deletedAt: new Date('2026-11-26T04:00:00.000Z'), id: TASK_ID });
    expect(() => decodeBoardTrashCursor(`${trashCursor}==`)).toThrow();

    expect(() => assertCanViewTaskEvents(INACTIVE, makeTask())).toThrow();
    expect(() => assertCanViewTaskEvents(HIDDEN_SUPER_OUTSIDER, makeTask({ isHidden: true }))).toThrow();
    expect(() => assertCanViewTaskEvents(OUTSIDER, makeTask({ deletedAt: new Date() }))).toThrow();
    expect(() => assertCanViewTaskEvents(DELETER, makeTask({ deletedAt: new Date() }))).not.toThrow();
  });

  it('lists task events newest-first with revertable flag, cursor pagination, and AC-20 hidden 404', async () => {
    const { clock, repo, service } = createHarness();
    const e1 = repo.seedEvent({
      taskId: TASK_ID,
      boardId: BOARD_ID,
      actorId: CREATOR_ID,
      type: 'task.created',
      changes: { column_id: COL_A },
      revertsEventId: null,
      forced: false,
      createdAt: clock.now(),
    });
    clock.advanceByMs(1000);
    const e2 = repo.seedEvent({
      taskId: TASK_ID,
      boardId: BOARD_ID,
      actorId: EDITOR_ID,
      type: 'task.updated',
      changes: { priority: { from: 2, to: 4 } },
      revertsEventId: null,
      forced: false,
      createdAt: clock.now(),
    });
    clock.advanceByMs(1000);
    const e3 = repo.seedEvent({
      taskId: TASK_ID,
      boardId: BOARD_ID,
      actorId: ASSIGNEE_ID,
      type: 'comment.added',
      changes: { comment_id: '80000000-0000-4000-8000-000000000001' },
      revertsEventId: null,
      forced: false,
      createdAt: clock.now(),
    });

    const page1 = await service.listTaskEvents(OUTSIDER, TASK_ID, { limit: 2 });
    expect(page1.items.map((i) => [i.id, i.revertable])).toEqual([
      [e3.id, false],
      [e2.id, true],
    ]);
    expect(page1.meta.nextCursor).toBeTruthy();
    expect(Object.keys(page1.items[0]!.actor).sort()).toEqual([
      'avatarUrl',
      'departments',
      'fullName',
      'id',
      'isActive',
      'leftAt',
    ]);

    const page2 = await service.listTaskEvents(OUTSIDER, TASK_ID, { cursor: page1.meta.nextCursor!, limit: 2 });
    expect(page2.items.map((i) => [i.id, i.revertable])).toEqual([[e1.id, false]]);
    expect(page2.meta.nextCursor).toBeNull();

    // AC-20: hidden task returns 404 to non-viewer, 200 to dept/direct assignee & creator
    repo.tasks.set(TASK_ID, { task: makeTask({ isHidden: true }), boardArchivedAt: null });
    await expect(service.listTaskEvents(HIDDEN_SUPER_OUTSIDER, TASK_ID, { limit: 20 })).rejects.toMatchObject({
      httpStatus: 404,
      code: 'NOT_FOUND',
    });
    const deptView = await service.listTaskEvents(DEPT_UPDATE, TASK_ID, { limit: 20 });
    expect(deptView.items).toHaveLength(3);

    // Soft-deleted task events: 404 without task.delete, 200 with task.delete
    repo.tasks.set(TASK_ID, { task: makeTask({ isHidden: false, deletedAt: new Date() }), boardArchivedAt: null });
    await expect(service.listTaskEvents(ANY_EDITOR, TASK_ID, { limit: 20 })).rejects.toMatchObject({
      httpStatus: 404,
      code: 'NOT_FOUND',
    });
    const trashViewer = await service.listTaskEvents(DELETER, TASK_ID, { limit: 20 });
    expect(trashViewer.items).toHaveLength(3);
  });

  it('reverts task.updated, enforces AC-18 conflicts/force, AC-19 permissions, and AC-20 hidden 404', async () => {
    const { clock, repo, service, logs } = createHarness();
    const evtComment = repo.seedEvent({
      taskId: TASK_ID,
      boardId: BOARD_ID,
      actorId: CREATOR_ID,
      type: 'comment.added',
      changes: { comment_id: '80000000-0000-4000-8000-000000000001' },
      revertsEventId: null,
      forced: false,
      createdAt: clock.now(),
    });
    const evtUpdateTitle = repo.seedEvent({
      taskId: TASK_ID,
      boardId: BOARD_ID,
      actorId: EDITOR_ID,
      type: 'task.updated',
      changes: { title: { from: 'Old Title', to: 'New Title' } },
      revertsEventId: null,
      forced: false,
      createdAt: clock.now(),
    });
    const evtUpdatePrio = repo.seedEvent({
      taskId: TASK_ID,
      boardId: BOARD_ID,
      actorId: EDITOR_ID,
      type: 'task.updated',
      changes: { priority: { from: 2, to: 4 } },
      revertsEventId: null,
      forced: false,
      createdAt: clock.now(),
    });
    repo.tasks.set(TASK_ID, {
      task: makeTask({ title: 'New Title', priority: 4, version: 3 }),
      boardArchivedAt: null,
    });

    // Non-revertable -> 400
    await expect(
      service.revertTaskEvent(ADMIN, TASK_ID, evtComment.id, { force: false }),
    ).rejects.toMatchObject({ httpStatus: 400, code: 'EVENT_NOT_REVERTABLE' });

    // AC-20: non-viewer on hidden task gets 404 EVEN for non-revertable event or super permissions!
    repo.tasks.set(TASK_ID, {
      task: makeTask({ title: 'New Title', priority: 4, isHidden: true, version: 3 }),
      boardArchivedAt: null,
    });
    await expect(
      service.revertTaskEvent(HIDDEN_SUPER_OUTSIDER, TASK_ID, evtComment.id, { force: false }),
    ).rejects.toMatchObject({ httpStatus: 404, code: 'NOT_FOUND' });

    // AC-19: non-assignee without task.update_any gets 403
    repo.tasks.set(TASK_ID, {
      task: makeTask({ title: 'New Title', priority: 4, isHidden: false, version: 3 }),
      boardArchivedAt: null,
    });
    await expect(
      service.revertTaskEvent(OUTSIDER, TASK_ID, evtUpdatePrio.id, { force: false }),
    ).rejects.toMatchObject({ httpStatus: 403, code: 'FORBIDDEN' });

    // Independent field revert succeeds cleanly without touching priority
    const revertedTitle = await service.revertTaskEvent(DEPT_UPDATE, TASK_ID, evtUpdateTitle.id, { force: false });
    expect(revertedTitle.task.title).toBe('Old Title');
    expect(revertedTitle.task.priority).toBe(4);
    expect(revertedTitle.revertedEventId).toBe(evtUpdateTitle.id);

    // Modify priority further -> AC-18 409 REVERT_CONFLICT on priority, then force=true succeeds
    repo.tasks.set(TASK_ID, {
      task: makeTask({ title: 'Old Title', priority: 1, version: 4 }),
      boardArchivedAt: null,
    });
    await expect(
      service.revertTaskEvent(ASSIGNEE_UPDATE, TASK_ID, evtUpdatePrio.id, { force: false }),
    ).rejects.toMatchObject({
      httpStatus: 409,
      code: 'REVERT_CONFLICT',
      details: { conflictingFields: ['priority'] },
    });

    clock.advanceByMs(1000);
    const forcedPrio = await service.revertTaskEvent(ANY_EDITOR, TASK_ID, evtUpdatePrio.id, { force: true });
    expect(forcedPrio.task.priority).toBe(2);
    const compensating = repo.events.get(forcedPrio.eventId)!;
    expect(compensating).toMatchObject({
      type: 'task.updated',
      revertsEventId: evtUpdatePrio.id,
      forced: true,
      changes: { priority: { from: 1, to: 2 } },
    });
    expect(logs.join('\n')).not.toContain('Old Title');
  });

  it('reverts task.moved (including WQ-33 deleted-column fallback), assignees, hidden toggle, deleted & restored', async () => {
    const { clock, repo, service } = createHarness();

    // 1. task.moved fallback to first column when `from` column was deleted
    const moveEvt = repo.seedEvent({
      taskId: TASK_ID,
      boardId: BOARD_ID,
      actorId: EDITOR_ID,
      type: 'task.moved',
      changes: { column_id: { from: COL_DELETED, to: COL_B }, position: { from: 1000, to: 2000 } },
      revertsEventId: null,
      forced: false,
      createdAt: clock.now(),
    });
    repo.tasks.set(TASK_ID, { task: makeTask({ columnId: COL_B, position: '2000', version: 2 }), boardArchivedAt: null });
    const moveReverted = await service.revertTaskEvent(ANY_EDITOR, TASK_ID, moveEvt.id, { force: false });
    expect(moveReverted.task.columnId).toBe(COL_A);
    expect(moveReverted.task.position).toBe(3000);

    // 2. task.assignees_changed: requires task.assign, filters purged profile & deleted dept
    const assignEvt = repo.seedEvent({
      taskId: TASK_ID,
      boardId: BOARD_ID,
      actorId: ASSIGNER_ID,
      type: 'task.assignees_changed',
      changes: {
        assignee_ids: { from: [ASSIGNEE_ID, PURGED_USER_ID], to: [] },
        department_ids: { from: [DEPT_ID, DELETED_DEPT_ID], to: [] },
      },
      revertsEventId: null,
      forced: false,
      createdAt: clock.now(),
    });
    repo.tasks.set(TASK_ID, {
      task: makeTask({ assignees: [], assignedDepartments: [], version: 3 }),
      boardArchivedAt: null,
    });
    await expect(service.revertTaskEvent(ANY_EDITOR, TASK_ID, assignEvt.id, { force: false })).rejects.toMatchObject({
      httpStatus: 403,
      code: 'FORBIDDEN',
    });
    const assignReverted = await service.revertTaskEvent(ASSIGNER, TASK_ID, assignEvt.id, { force: false });
    expect(assignReverted.task.assignees.map((a) => a.id)).toEqual([ASSIGNEE_ID]);
    expect(assignReverted.task.assignedDepartments.map((d) => d.id)).toEqual([DEPT_ID]);

    // 3. task.hidden_changed: creator or admin only
    const hiddenEvt = repo.seedEvent({
      taskId: TASK_ID,
      boardId: BOARD_ID,
      actorId: CREATOR_ID,
      type: 'task.hidden_changed',
      changes: { is_hidden: { from: false, to: true } },
      revertsEventId: null,
      forced: false,
      createdAt: clock.now(),
    });
    repo.tasks.set(TASK_ID, { task: makeTask({ isHidden: true, version: 4 }), boardArchivedAt: null });
    await expect(service.revertTaskEvent(ASSIGNEE_UPDATE, TASK_ID, hiddenEvt.id, { force: false })).rejects.toMatchObject({
      httpStatus: 403,
      code: 'FORBIDDEN',
    });
    const hiddenReverted = await service.revertTaskEvent(CREATOR, TASK_ID, hiddenEvt.id, { force: false });
    expect(hiddenReverted.task.isHidden).toBe(false);

    // 4. task.deleted -> compensating task.restored; blocked when board archived; 404 on other events when soft-deleted
    const deletedAt = clock.now();
    const deleteEvt = repo.seedEvent({
      taskId: TASK_ID,
      boardId: BOARD_ID,
      actorId: DELETER_ID,
      type: 'task.deleted',
      changes: { deleted_at: { from: null, to: deletedAt.toISOString() } },
      revertsEventId: null,
      forced: false,
      createdAt: deletedAt,
    });
    repo.tasks.set(TASK_ID, { task: makeTask({ columnId: null, deletedAt, version: 5 }), boardArchivedAt: deletedAt });
    await expect(service.revertTaskEvent(ANY_EDITOR, TASK_ID, deleteEvt.id, { force: false })).rejects.toMatchObject({
      httpStatus: 403,
      code: 'FORBIDDEN',
    });
    await expect(service.revertTaskEvent(DELETER, TASK_ID, deleteEvt.id, { force: false })).rejects.toMatchObject({
      httpStatus: 409,
      code: 'BOARD_ARCHIVED',
    });
    await expect(service.revertTaskEvent(ANY_EDITOR, TASK_ID, hiddenEvt.id, { force: false })).rejects.toMatchObject({
      httpStatus: 404,
      code: 'NOT_FOUND',
    });
    await expect(service.revertTaskEvent(DELETER, TASK_ID, deleteEvt.id, { force: false })).rejects.toMatchObject({
      httpStatus: 409,
      code: 'BOARD_ARCHIVED',
    });
    repo.tasks.set(TASK_ID, { task: makeTask({ columnId: null, deletedAt, version: 5 }), boardArchivedAt: null });
    await expect(service.revertTaskEvent(ADMIN, TASK_ID, hiddenEvt.id, { force: false })).rejects.toMatchObject({
      httpStatus: 409,
      code: 'TASK_DELETED',
    });
    const restored = await service.revertTaskEvent(DELETER, TASK_ID, deleteEvt.id, { force: false });
    expect(restored.task.deletedAt).toBeNull();
    expect(restored.task.columnId).toBe(COL_A);
    expect(repo.events.get(restored.eventId)?.type).toBe('task.restored');

    // 5. Reverting task.restored -> conflict on column_id if moved, then force=true re-deletes
    const restoreEvt = repo.events.get(restored.eventId)!;
    repo.tasks.set(TASK_ID, { task: makeTask({ columnId: COL_B, deletedAt: null, version: 6 }), boardArchivedAt: null });
    await expect(service.revertTaskEvent(DELETER, TASK_ID, restoreEvt.id, { force: false })).rejects.toMatchObject({
      httpStatus: 409,
      code: 'REVERT_CONFLICT',
      details: { conflictingFields: ['column_id'] },
    });
    const reDeleted = await service.revertTaskEvent(DELETER, TASK_ID, restoreEvt.id, { force: true });
    expect(reDeleted.task.deletedAt).not.toBeNull();
    expect(repo.events.get(reDeleted.eventId)?.type).toBe('task.deleted');
  });

  it('lists board trash with task.delete authorization, board 404, WQ-17 hidden exclusion, and pagination', async () => {
    const { repo, service } = createHarness();
    const T1 = '60000000-0000-4000-8000-000000000011';
    const T2 = '60000000-0000-4000-8000-000000000012';
    const T3_HIDDEN = '60000000-0000-4000-8000-000000000013';
    repo.tasks.set(T1, { task: makeTask({ id: T1, deletedAt: new Date('2026-11-26T01:00:00.000Z') }), boardArchivedAt: null });
    repo.tasks.set(T2, { task: makeTask({ id: T2, deletedAt: new Date('2026-11-26T02:00:00.000Z') }), boardArchivedAt: null });
    repo.tasks.set(T3_HIDDEN, {
      task: makeTask({ id: T3_HIDDEN, isHidden: true, deletedAt: new Date('2026-11-26T03:00:00.000Z') }),
      boardArchivedAt: null,
    });

    await expect(service.listBoardTrash(ANY_EDITOR, BOARD_ID, { limit: 20 })).rejects.toMatchObject({
      httpStatus: 403,
      code: 'FORBIDDEN',
    });
    await expect(
      service.listBoardTrash(DELETER, '40000000-0000-4000-8000-000000000099', { limit: 20 }),
    ).rejects.toMatchObject({ httpStatus: 404, code: 'NOT_FOUND' });

    const deleterPage1 = await service.listBoardTrash(DELETER, BOARD_ID, { limit: 1 });
    expect(deleterPage1.items.map((t) => t.id)).toEqual([T2]);
    expect(deleterPage1.meta.nextCursor).toBeTruthy();

    const deleterPage2 = await service.listBoardTrash(DELETER, BOARD_ID, {
      cursor: deleterPage1.meta.nextCursor!,
      limit: 1,
    });
    expect(deleterPage2.items.map((t) => t.id)).toEqual([T1]);
    expect(deleterPage2.meta.nextCursor).toBeNull();

    const adminTrash = await service.listBoardTrash(ADMIN, BOARD_ID, { limit: 20 });
    expect(adminTrash.items.map((t) => t.id)).toEqual([T3_HIDDEN, T2, T1]);
  });

  it('reverts start_at and is_completed diffs in task.updated and enforces date range + conflicts', async () => {
    const { clock, repo, service } = createHarness();
    const startFrom = '2026-11-28T00:00:00.000Z';
    const startTo = '2026-11-29T00:00:00.000Z';
    repo.tasks.set(TASK_ID, {
      task: makeTask({
        startAt: new Date(startTo),
        dueAt: new Date('2026-12-01T10:00:00.000Z'),
        isCompleted: true,
        completedAt: clock.now(),
        version: 2,
      }),
      boardArchivedAt: null,
    });
    const updEvt = repo.seedEvent({
      taskId: TASK_ID,
      boardId: BOARD_ID,
      actorId: ASSIGNEE_ID,
      type: 'task.updated',
      changes: {
        start_at: { from: startFrom, to: startTo },
        is_completed: { from: false, to: true },
      },
      revertsEventId: null,
      forced: false,
      createdAt: clock.now(),
    });

    const reverted = await service.revertTaskEvent(ASSIGNEE_UPDATE, TASK_ID, updEvt.id, { force: false });
    expect(reverted.task.startAt).toBe(startFrom);
    expect(reverted.task.isCompleted).toBe(false);
    expect(reverted.task.completedAt).toBeNull();
    expect(repo.events.get(reverted.eventId)?.changes).toMatchObject({
      start_at: { from: startTo, to: startFrom },
      is_completed: { from: true, to: false },
    });

    // Reverting again detects start_at & is_completed conflicts when state moved away
    await expect(
      service.revertTaskEvent(ASSIGNEE_UPDATE, TASK_ID, updEvt.id, { force: false }),
    ).rejects.toMatchObject({
      httpStatus: 409,
      code: 'REVERT_CONFLICT',
      details: { conflictingFields: ['start_at', 'is_completed'] },
    });

    // Reverting start_at after a shortened dueAt fails cleanly with 400 INVALID_DATE_RANGE
    repo.tasks.set(TASK_ID, {
      task: makeTask({
        startAt: new Date('2026-11-25T00:00:00.000Z'),
        dueAt: new Date('2026-11-27T00:00:00.000Z'),
        version: 4,
      }),
      boardArchivedAt: null,
    });
    const rangeConflictEvt = repo.seedEvent({
      taskId: TASK_ID,
      boardId: BOARD_ID,
      actorId: ASSIGNEE_ID,
      type: 'task.updated',
      changes: {
        start_at: { from: '2026-11-29T00:00:00.000Z', to: '2026-11-25T00:00:00.000Z' },
      },
      revertsEventId: null,
      forced: false,
      createdAt: clock.now(),
    });
    await expect(
      service.revertTaskEvent(ASSIGNEE_UPDATE, TASK_ID, rangeConflictEvt.id, { force: false }),
    ).rejects.toMatchObject({ httpStatus: 400, code: 'INVALID_DATE_RANGE' });

    // Reverting historical task.updated with null start_at/due_at fails 409 REVERT_CONFLICT (even with force=true)
    const legacyNullEvt = repo.seedEvent({
      taskId: TASK_ID,
      boardId: BOARD_ID,
      actorId: ASSIGNEE_ID,
      type: 'task.updated',
      changes: {
        start_at: { from: null, to: '2026-11-25T00:00:00.000Z' },
        due_at: { from: null, to: '2026-11-27T00:00:00.000Z' },
      },
      revertsEventId: null,
      forced: false,
      createdAt: clock.now(),
    });
    await expect(
      service.revertTaskEvent(ASSIGNEE_UPDATE, TASK_ID, legacyNullEvt.id, { force: true }),
    ).rejects.toMatchObject({
      httpStatus: 409,
      code: 'REVERT_CONFLICT',
      details: { conflictingFields: ['start_at', 'due_at'] },
    });
  });
});

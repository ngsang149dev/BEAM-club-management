import { z } from 'zod';
import { badRequest, notFound } from '@/lib/errors';
import { uuidSchema } from '@/lib/members';
import {
  assertCanViewTask,
  type TaskRecord,
  toTaskVisibilitySubject,
} from '@/server/modules/tasks';
import { type AuthActor, hasPermission } from '@/server/shared/authorize';
import type { BoardTrashCursor, TaskEventCursor } from './types';

const isoTimestampSchema = z.iso.datetime({ offset: true });

function encodeTimestampIdCursor(
  field: 'createdAt' | 'deletedAt',
  timestamp: Date,
  id: string,
): string {
  return Buffer.from(
    JSON.stringify({ [field]: timestamp.toISOString(), id }),
    'utf8',
  ).toString('base64url');
}

function parseTimestampIdCursor(
  raw: string,
  field: 'createdAt' | 'deletedAt',
): { readonly timestamp: Date; readonly id: string } {
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  if (Buffer.from(decoded, 'utf8').toString('base64url') !== raw) {
    throw new Error('Non-canonical base64url cursor');
  }
  const parsed = JSON.parse(decoded) as unknown;
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Cursor must be object');
  }
  const record = parsed as Record<string, unknown>;
  const validIso = isoTimestampSchema.safeParse(record[field]);
  const validId = uuidSchema.safeParse(record.id);
  if (!validIso.success || !validId.success) {
    throw new Error('Invalid cursor fields');
  }
  return { timestamp: new Date(validIso.data), id: validId.data };
}

export function encodeTaskEventCursor(cursor: TaskEventCursor): string {
  return encodeTimestampIdCursor('createdAt', cursor.createdAt, cursor.id);
}

export function decodeTaskEventCursor(raw: string): TaskEventCursor {
  try {
    const parsed = parseTimestampIdCursor(raw, 'createdAt');
    return { createdAt: parsed.timestamp, id: parsed.id };
  } catch {
    throw badRequest('errors.invalidCursor', {}, 'INVALID_CURSOR');
  }
}

export function encodeBoardTrashCursor(cursor: BoardTrashCursor): string {
  return encodeTimestampIdCursor('deletedAt', cursor.deletedAt, cursor.id);
}

export function decodeBoardTrashCursor(raw: string): BoardTrashCursor {
  try {
    const parsed = parseTimestampIdCursor(raw, 'deletedAt');
    return { deletedAt: parsed.timestamp, id: parsed.id };
  } catch {
    throw badRequest('errors.invalidCursor', {}, 'INVALID_CURSOR');
  }
}

export function assertCanViewTaskEvents(actor: AuthActor, task: TaskRecord): void {
  // Visibility runs first so probing hidden tasks always returns 404 (AC-20).
  assertCanViewTask(actor, toTaskVisibilitySubject(task));
  if (task.deletedAt !== null && !hasPermission(actor, 'task.delete')) {
    throw notFound('errors.notFound', {}, 'NOT_FOUND');
  }
}

export function assertCanAccessSoftDeletedEvent(
  actor: AuthActor,
  task: TaskRecord,
  eventType: string,
): void {
  if (
    task.deletedAt !== null &&
    eventType !== 'task.deleted' &&
    !hasPermission(actor, 'task.delete')
  ) {
    throw notFound('errors.notFound', {}, 'NOT_FOUND');
  }
}

export function sameSortedStringSets(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, idx) => value === b[idx]);
}

import { z } from 'zod';
import { badRequest } from '@/lib/errors';
import { uuidSchema } from '@/lib/members';
import type {
  DepartmentRecipientRecord,
  NotificationCursor,
  NotificationDepartmentSummaryRecord,
  NotificationPayloadRecord,
} from './types';

export interface DeduplicatedDepartmentRecipient {
  readonly userId: string;
  readonly email: string;
  readonly fullName: string;
  readonly locale: 'vi' | 'en';
  readonly representativeDepartmentId: string | null;
  readonly departmentNames: readonly string[];
  readonly departmentName: string | null;
}

const isoTimestampSchema = z.iso.datetime({ offset: true });

export function encodeNotificationCursor(cursor: NotificationCursor): string {
  return Buffer.from(
    JSON.stringify({
      createdAt: cursor.createdAt.toISOString(),
      id: cursor.id,
    }),
    'utf8',
  ).toString('base64url');
}

export function decodeNotificationCursor(raw: string): NotificationCursor {
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    if (Buffer.from(decoded, 'utf8').toString('base64url') !== raw) {
      throw new Error('Non-canonical base64url cursor');
    }
    const parsed = JSON.parse(decoded) as {
      createdAt?: unknown;
      id?: unknown;
    } | null;
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid cursor object');
    }
    const createdAt = new Date(isoTimestampSchema.parse(parsed.createdAt));
    const id = uuidSchema.parse(parsed.id);
    return { createdAt, id };
  } catch {
    throw badRequest('errors.invalidCursor', {}, 'INVALID_CURSOR');
  }
}

export function buildNotificationPayload(params: {
  readonly isHiddenTask: boolean;
  readonly taskTitle: string;
  readonly boardName: string;
  readonly departmentName: string | null;
}): NotificationPayloadRecord {
  return {
    taskTitle: params.isHiddenTask ? null : params.taskTitle,
    boardName: params.boardName,
    departmentName: params.departmentName,
  };
}

interface RecipientAccumulator {
  readonly userId: string;
  readonly email: string;
  readonly fullName: string;
  readonly locale: 'vi' | 'en';
  readonly matchedDeptIds: Set<string>;
}

function groupMembersByUser(
  members: readonly DepartmentRecipientRecord[],
  actorId: string,
): Map<string, RecipientAccumulator> {
  const byUser = new Map<string, RecipientAccumulator>();
  for (const member of members) {
    if (member.userId === actorId) continue;
    const existing = byUser.get(member.userId);
    if (existing) {
      existing.matchedDeptIds.add(member.departmentId);
      continue;
    }
    byUser.set(member.userId, {
      userId: member.userId,
      email: member.email,
      fullName: member.fullName,
      locale: member.locale,
      matchedDeptIds: new Set([member.departmentId]),
    });
  }
  return byUser;
}

export function dedupeDepartmentRecipients(params: {
  readonly departments: readonly NotificationDepartmentSummaryRecord[];
  readonly members: readonly DepartmentRecipientRecord[];
  readonly actorId: string;
}): DeduplicatedDepartmentRecipient[] {
  const orderedDepts = [...params.departments].sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
  const byUser = groupMembersByUser(params.members, params.actorId);
  return Array.from(byUser.values())
    .sort((a, b) => a.userId.localeCompare(b.userId))
    .map((entry) => {
      const matched = orderedDepts.filter((d) => entry.matchedDeptIds.has(d.id));
      const departmentNames = matched.map((d) => d.name);
      return {
        userId: entry.userId,
        email: entry.email,
        fullName: entry.fullName,
        locale: entry.locale,
        representativeDepartmentId: matched[0]?.id ?? null,
        departmentNames,
        departmentName: departmentNames.length > 0 ? departmentNames.join(', ') : null,
      };
    });
}

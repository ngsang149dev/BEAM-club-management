import {
  queryUserSummaryRows,
  type DbExecutor,
  type RawUserSummaryDepartmentRow,
  type RawUserSummaryProfileRow,
} from './db';

export interface UserDepartmentSummaryRecord {
  readonly id: string;
  readonly name: string;
}

export interface UserSummaryRecord {
  readonly id: string;
  readonly fullName: string;
  readonly avatarUpdatedAt: Date | null;
  readonly isActive: boolean;
  readonly leftAt: Date | null;
  readonly departments: readonly UserDepartmentSummaryRecord[];
}

export function buildUserSummariesMap(
  profileRows: readonly RawUserSummaryProfileRow[],
  departmentRows: readonly RawUserSummaryDepartmentRow[],
): Map<string, UserSummaryRecord> {
  const deptsByUser = new Map<string, UserDepartmentSummaryRecord[]>();
  for (const row of departmentRows) {
    const existing = deptsByUser.get(row.userId) ?? [];
    existing.push({ id: row.departmentId, name: row.departmentName });
    deptsByUser.set(row.userId, existing);
  }
  const map = new Map<string, UserSummaryRecord>();
  for (const row of profileRows) {
    map.set(row.id, {
      id: row.id,
      fullName: row.fullName,
      avatarUpdatedAt: row.avatarUpdatedAt,
      isActive: row.isActive,
      leftAt: row.leftAt,
      departments: deptsByUser.get(row.id) ?? [],
    });
  }
  return map;
}

export async function loadUserSummariesMap(
  executor: DbExecutor,
  userIds: readonly string[],
): Promise<Map<string, UserSummaryRecord>> {
  const [profileRows, deptRows] = await queryUserSummaryRows(executor, userIds);
  return buildUserSummariesMap(profileRows, deptRows);
}

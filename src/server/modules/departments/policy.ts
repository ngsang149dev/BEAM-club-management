import { conflict } from '@/lib/errors';

export function assertDepartmentCanBeDeleted(department: {
  readonly memberCount: number;
  readonly boardCount: number;
}): void {
  if (department.memberCount > 0 || department.boardCount > 0) {
    throw conflict(
      'errors.departmentInUse',
      {
        memberCount: department.memberCount,
        boardCount: department.boardCount,
      },
      'DEPARTMENT_IN_USE',
    );
  }
}

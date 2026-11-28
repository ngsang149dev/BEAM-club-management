import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import enMessages from '../../../messages/en.json';
import viMessages from '../../../messages/vi.json';
import { PermissionsProvider, type PermissionCode } from '@/features/shared/permissions/can';
import {
  buildCreateTaskRequestPayload,
  CreateTaskModal,
} from '@/features/tasks/components/CreateTaskModal';
import {
  buildReplaceTaskAssigneesPayload,
  editTaskSchema,
} from '@/features/tasks/drawer-helpers';
import {
  getTodayVnIso,
  hoChiMinhInputToUtcIso,
  requireHoChiMinhInputToUtcIso,
} from '@/features/tasks/formatters';

function renderModal(locale: 'vi' | 'en', permissions: PermissionCode[] = ['task.create']) {
  const qc = new QueryClient();
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider
        locale={locale}
        messages={locale === 'vi' ? viMessages : enMessages}
        timeZone="Asia/Ho_Chi_Minh"
      >
        <PermissionsProvider permissions={permissions}>
          <CreateTaskModal onClose={vi.fn()} />
        </PermissionsProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

describe('CR-14-02 mandatory task dates, CreateTaskModal, and payload builders', () => {
  it('converts UTC+7 date strings cleanly and rejects missing/invalid dates', () => {
    expect(hoChiMinhInputToUtcIso('2026-11-26')).toBe('2026-11-25T17:00:00.000Z');
    expect(hoChiMinhInputToUtcIso('')).toBeNull();
    expect(requireHoChiMinhInputToUtcIso('2026-11-26')).toBe('2026-11-25T17:00:00.000Z');
    expect(() => requireHoChiMinhInputToUtcIso('')).toThrow('Invalid date input');
  });

  it('requires both startAtInput & dueAtInput and enforces startAt <= dueAt in editTaskSchema', () => {
    const missingStart = editTaskSchema.safeParse({
      title: 'Valid title',
      description: '',
      startAtInput: '',
      dueAtInput: '2026-11-28',
    });
    expect(missingStart.success).toBe(false);

    const missingDue = editTaskSchema.safeParse({
      title: 'Valid title',
      description: '',
      startAtInput: '2026-11-26',
      dueAtInput: '',
    });
    expect(missingDue.success).toBe(false);

    const invertedRange = editTaskSchema.safeParse({
      title: 'Valid title',
      description: '',
      startAtInput: '2026-11-29',
      dueAtInput: '2026-11-28',
    });
    expect(invertedRange.success).toBe(false);
    if (!invertedRange.success) {
      expect(invertedRange.error.issues[0]?.message).toBe('invalidDateRange');
      expect(invertedRange.error.issues[0]?.path).toEqual(['dueAtInput']);
    }

    const equalDates = editTaskSchema.safeParse({
      title: 'Valid title',
      description: 'Desc',
      startAtInput: '2026-11-28',
      dueAtInput: '2026-11-28',
    });
    expect(equalDates.success).toBe(true);
  });

  it('builds CreateTaskRequest with mandatory startAt/dueAt and permission-gated assignees', () => {
    const restricted = buildCreateTaskRequestPayload({
      values: {
        title: '  Thiết kế backdrop  ',
        description: '  In khổ A0  ',
        startAtInput: '2026-11-26',
        dueAtInput: '2026-11-29',
        isHidden: true,
      },
      canAssign: false,
      assigneeIds: ['u-1'],
      departmentIds: ['d-1'],
      notifyInApp: true,
      notifyEmail: true,
    });
    expect(restricted).toEqual({
      title: 'Thiết kế backdrop',
      description: 'In khổ A0',
      startAt: '2026-11-25T17:00:00.000Z',
      dueAt: '2026-11-28T17:00:00.000Z',
      priority: 2,
      assigneeIds: [],
      departmentIds: [],
      notifyInApp: false,
      notifyEmail: false,
      notifyDepartmentMembers: false,
      isHidden: true,
    });

    const assignable = buildCreateTaskRequestPayload({
      values: {
        title: 'Chốt kịch bản',
        description: '',
        startAtInput: '2026-11-26',
        dueAtInput: '2026-11-27',
        isHidden: false,
      },
      canAssign: true,
      assigneeIds: ['u-1'],
      departmentIds: ['d-1'],
      notifyInApp: false,
      notifyEmail: true,
    });
    expect(assignable).toEqual({
      title: 'Chốt kịch bản',
      description: null,
      startAt: '2026-11-25T17:00:00.000Z',
      dueAt: '2026-11-26T17:00:00.000Z',
      priority: 2,
      assigneeIds: ['u-1'],
      departmentIds: ['d-1'],
      notifyInApp: false,
      notifyEmail: true,
      notifyDepartmentMembers: true,
      isHidden: false,
    });
  });

  it('preserves assigneeIds only when member catalog is visible in buildReplaceTaskAssigneesPayload', () => {
    expect(
      buildReplaceTaskAssigneesPayload({
        departmentIds: ['d-1'],
        assigneeIds: ['u-1'],
        canViewMembers: false,
        notifyInApp: true,
        notifyEmail: false,
        version: 3,
      })
    ).toEqual({
      departmentIds: ['d-1'],
      notifyInApp: true,
      notifyEmail: false,
      notifyDepartmentMembers: true,
      version: 3,
    });

    expect(
      buildReplaceTaskAssigneesPayload({
        departmentIds: ['d-1'],
        assigneeIds: ['u-1'],
        canViewMembers: true,
        notifyInApp: false,
        notifyEmail: false,
        version: 4,
      })
    ).toEqual({
      departmentIds: ['d-1'],
      assigneeIds: ['u-1'],
      notifyInApp: false,
      notifyEmail: false,
      notifyDepartmentMembers: false,
      version: 4,
    });
  });

  it('renders CreateTaskModal prefilled with today UTC+7, required date fields, no clear buttons, and no UTC+7/priority clutter', () => {
    const todayVn = getTodayVnIso();
    const viHtml = renderModal('vi');
    expect(viHtml).toContain(`value="${todayVn}"`);
    expect(viHtml).toContain('required=""');
    expect(viHtml).toContain('Ngày bắt đầu');
    expect(viHtml).toContain('Hạn chót');
    expect(viHtml).not.toContain('(UTC+7)');
    expect(viHtml).not.toContain('task-due-clear-btn');
    expect(viHtml).not.toContain('Mức độ ưu tiên');

    const enHtml = renderModal('en');
    expect(enHtml).toContain(`value="${todayVn}"`);
    expect(enHtml).toContain('Start date');
    expect(enHtml).toContain('Due date');
    expect(enHtml).not.toContain('(UTC+7)');
    expect(enHtml).not.toContain('Priority');
  });
});

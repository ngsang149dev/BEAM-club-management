import type { ReactNode } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '../../../messages/en.json';
import viMessages from '../../../messages/vi.json';
import { ApiClientError, type components } from '@/features/shared/api/client';
import { PermissionsProvider, type PermissionCode } from '@/features/shared/permissions/can';

const apiFetchMock = vi.hoisted(() => vi.fn());

const reminderHooksMock = vi.hoisted(() => ({
  useReminderSettingsQuery: vi.fn(),
  useUpdateReminderSettingsMutation: vi.fn(() => ({
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    error: null as unknown,
  })),
}));

const authHooksMock = vi.hoisted(() => ({
  useMeQuery: vi.fn(),
}));

vi.mock('@/features/shared/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/features/shared/api/client')>(
    '@/features/shared/api/client'
  );
  return { ...actual, apiFetch: apiFetchMock };
});

vi.mock('@/features/reminders/hooks/useReminderSettings', async () => {
  const actual = await vi.importActual<
    typeof import('@/features/reminders/hooks/useReminderSettings')
  >('@/features/reminders/hooks/useReminderSettings');
  return { ...actual, ...reminderHooksMock };
});

vi.mock('@/features/auth/hooks/useAuth', async () => {
  const actual = await vi.importActual<typeof import('@/features/auth/hooks/useAuth')>(
    '@/features/auth/hooks/useAuth'
  );
  return { ...actual, ...authHooksMock };
});

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { ReminderEmailPreview } from '@/features/reminders/components/ReminderEmailPreview';
import { PreviewHeader } from '@/features/reminders/components/ReminderEmailPreviewParts';
import { ReminderMilestonesCard } from '@/features/reminders/components/ReminderMilestonesCard';
import { RemindersAdminView } from '@/features/reminders/components/RemindersAdminView';
import {
  REMINDERS_QUERY_KEYS,
  buildUpdateReminderSettingsMutationOptions,
  describeReminderError,
  invalidateAfterReminderSettingsUpdate,
} from '@/features/reminders/hooks/useReminderSettings';
import {
  MAX_MILESTONE_COUNT,
  updateReminderSettingsSchema as libUpdateReminderSettingsSchema,
} from '@/lib/reminders';
import {
  addMilestoneDay,
  areReminderDraftsEqual,
  buildReminderEmailPreviewData,
  formatVnSendHour,
  isAllMilestonesOff,
  normalizeDaysBefore,
  parseCustomMilestoneDay,
  removeMilestoneDay,
  restoreDefaultMilestones,
  toggleMilestoneDay,
  updateReminderSettingsSchema,
} from '@/features/reminders/preview-helpers';

type ReminderSettingsDto = components['schemas']['ReminderSettingsDto'];
type TaskDto = components['schemas']['TaskDto'];

const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const NOW_FIXED_MS = Date.parse('2026-11-26T00:00:00.000Z'); // 07:00 on 2026-11-26 UTC+7

const SAMPLE_SETTINGS: ReminderSettingsDto = {
  daysBefore: [2, 1],
  remindOverdue: true,
  sendHourVn: 7,
  updatedAt: '2026-11-25T02:15:00.000Z',
  updatedBy: {
    id: '00000000-0000-4000-8000-000000000002',
    fullName: 'Trần Thị B',
    isActive: true,
    leftAt: null,
    departments: [],
  },
};

function makeTask(overrides: Partial<TaskDto>): TaskDto {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    boardId: '22222222-2222-4222-8222-222222222222',
    columnId: '33333333-3333-4333-8333-333333333333',
    title: 'Sample open task',
    description: null,
    startAt: '2026-11-20T00:00:00.000Z',
    dueAt: '2026-11-27T00:00:00.000Z',
    isCompleted: false,
    completedAt: null,
    priority: 2,
    position: 1000,
    isHidden: false,
    version: 1,
    deletedAt: null,
    assignees: [
      {
        id: '00000000-0000-4000-8000-000000000099',
        fullName: 'Le Van Khac',
        isActive: true,
        leftAt: null,
        departments: [],
        acceptedAt: null,
      },
    ],
    assignedDepartments: [{ id: 'dept-1', name: 'Truyền thông' }],
    deliverables: [],
    deliverableCount: 0,
    creator: {
      id: '00000000-0000-4000-8000-000000000088',
      fullName: 'Pham Nguoi Tao',
      isActive: true,
      leftAt: null,
      departments: [],
    },
    commentCount: 0,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-20T00:00:00.000Z',
    ...overrides,
  };
}

function renderWithIntl(node: ReactNode, locale: 'vi' | 'en' = 'vi') {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === 'vi' ? viMessages : enMessages}
      timeZone="Asia/Ho_Chi_Minh"
    >
      {node}
    </NextIntlClientProvider>
  );
}

function renderRemindersView(options: {
  permissions?: PermissionCode[];
  isAdmin?: boolean;
  locale?: 'vi' | 'en';
}) {
  return renderWithIntl(
    <PermissionsProvider
      isAdmin={options.isAdmin ?? false}
      permissions={options.permissions ?? []}
    >
      <RemindersAdminView />
    </PermissionsProvider>,
    options.locale ?? 'vi'
  );
}

describe('RemindersAdminView (S12), ReminderEmailPreview (E01) & helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reminderHooksMock.useUpdateReminderSettingsMutation.mockReturnValue({
      mutate: vi.fn(),
      reset: vi.fn(),
      isPending: false,
      error: null,
    });
    reminderHooksMock.useReminderSettingsQuery.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      data: { settings: SAMPLE_SETTINGS },
    });
    authHooksMock.useMeQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        profile: {
          id: '00000000-0000-4000-8000-000000000001',
          fullName: 'Nguyễn Văn A',
          studentId: '21110001',
          email: 'a.nguyen@eiu.edu.vn',
          locale: 'vi',
          isActive: true,
          leftAt: null,
          isAdmin: true,
          mustChangePassword: false,
          departments: [],
        },
        permissions: ['reminder.configure'],
      },
    });
  });

  it('renders 403 ErrorState and disables all queries when missing reminder.configure', () => {
    const html = renderRemindersView({ permissions: ['member.view'], isAdmin: false });
    expect(html).toContain('403');
    expect(html).toContain('Bạn không cấu hình được nhắc deadline');
    expect(reminderHooksMock.useReminderSettingsQuery).toHaveBeenCalledWith(false);
    expect(authHooksMock.useMeQuery).toHaveBeenCalledWith(false);
  });

  it('allows reminder.configure non-admin, shows 07:00 schedule, live preview matching milestones, and leaks zero PII/UUID', () => {
    const html = renderRemindersView({ permissions: ['reminder.configure'], isAdmin: false });
    expect(reminderHooksMock.useReminderSettingsQuery).toHaveBeenCalledWith(true);
    expect(authHooksMock.useMeQuery).toHaveBeenCalledWith(true);

    expect(html).toContain('Còn 2 ngày');
    expect(html).toContain('Còn 1 ngày');
    expect(html).toContain('Đã quá hạn');
    expect(html).toContain('Nhắc 1 lần khi công việc vừa quá hạn.');
    expect(html).not.toContain('mỗi ngày cho đến khi xong');
    expect(html).toContain('data-testid="reminders-schedule-chip"');
    expect(html).toContain('07:00 · GMT+7');
    expect(html).toContain('Trần Thị B');
    expect(html).not.toContain('rem-day-chip');
    expect(html).not.toContain('rem-email-kicker');
    expect(html).not.toContain('rem-preview-note');
    expect(html).not.toContain('rem-sample-banner');
    expect(html).not.toContain('rem-sample-chip');
    expect(html).not.toContain('rem-email-lang');
    expect(html).not.toContain('Xem mẫu minh họa');
    expect(html).not.toContain('rem-email-task-prio');
    expect(html).not.toContain('ui-prio');
    expect(html).not.toContain('rem-email-foot');
    expect(html).not.toContain('Mỗi người một email, mỗi ngày.');
    expect(html).toContain('Nguyễn Văn A');
    expect(html).toContain('Chuẩn bị slide giới thiệu CLB');
    expect(html).toContain('href="/progress"');
    expect(html).not.toContain('21110001');
    expect(html).not.toContain('a.nguyen@eiu.edu.vn');
    expect(html).not.toContain('Le Van Khac');
    expect(html).not.toContain('Pham Nguoi Tao');
    expect(html).not.toContain('Gửi thử cho tôi');
    expect(html).not.toContain('Lịch sử gửi');
    expect(html).not.toMatch(UUID_REGEX);
  });

  it('handles milestone draft helpers, custom days 0..365, sorting, and all-off restore defaults', () => {
    expect(normalizeDaysBefore([1, 7, 2, 1, -1, 366, 0, 1.5])).toEqual([7, 2, 1, 0]);
    expect(parseCustomMilestoneDay('0')).toBe(0);
    expect(parseCustomMilestoneDay('365')).toBe(365);
    expect(parseCustomMilestoneDay('-1')).toBeNull();
    expect(parseCustomMilestoneDay('366')).toBeNull();
    expect(parseCustomMilestoneDay('1.5')).toBeNull();
    expect(parseCustomMilestoneDay('abc')).toBeNull();
    expect(parseCustomMilestoneDay('')).toBeNull();

    expect(toggleMilestoneDay([2, 1], 2)).toEqual([1]);
    expect(toggleMilestoneDay([1], 2)).toEqual([2, 1]);
    expect(addMilestoneDay([2, 1], 0)).toEqual([2, 1, 0]);
    expect(addMilestoneDay([2, 1], 14)).toEqual([14, 2, 1]);
    expect(removeMilestoneDay([14, 2, 1], 2)).toEqual([14, 1]);

    expect(isAllMilestonesOff({ daysBefore: [], remindOverdue: false })).toBe(true);
    expect(isAllMilestonesOff({ daysBefore: [0], remindOverdue: false })).toBe(false);
    expect(isAllMilestonesOff({ daysBefore: [], remindOverdue: true })).toBe(false);

    const defaults = restoreDefaultMilestones();
    expect(defaults).toEqual({ daysBefore: [2, 1], remindOverdue: true });
    expect(
      areReminderDraftsEqual({ daysBefore: [1, 2], remindOverdue: true }, defaults)
    ).toBe(true);
    expect(formatVnSendHour(7)).toBe('07:00');

    const allOffHtml = renderWithIntl(
      <ReminderMilestonesCard
        daysBefore={[]}
        remindOverdue={false}
        disabled={false}
        onToggleDay={vi.fn()}
        onAddDay={vi.fn()}
        onRemoveDay={vi.fn()}
        onToggleOverdue={vi.fn()}
        onRestoreDefaults={vi.fn()}
      />,
      'vi'
    );
    expect(allOffHtml).toContain('ui-banner is-warn');
    expect(allOffHtml).toContain('Sẽ không gửi email nhắc nào');
    expect(allOffHtml).toContain('Bật lại mốc mặc định');

    const allOffEnHtml = renderWithIntl(
      <ReminderMilestonesCard
        daysBefore={[]}
        remindOverdue={false}
        disabled={false}
        onToggleDay={vi.fn()}
        onAddDay={vi.fn()}
        onRemoveDay={vi.fn()}
        onToggleOverdue={vi.fn()}
        onRestoreDefaults={vi.fn()}
      />,
      'en'
    );
    expect(allOffEnHtml).toContain('No reminder email will be sent');
    expect(allOffEnHtml).toContain('Restore default milestones');
    expect(allOffEnHtml).toContain('Sent once when a task becomes overdue.');

    const customHtml = renderWithIntl(
      <ReminderMilestonesCard
        daysBefore={[3, 2, 1, 0]}
        remindOverdue
        disabled={false}
        onToggleDay={vi.fn()}
        onAddDay={vi.fn()}
        onRemoveDay={vi.fn()}
        onToggleOverdue={vi.fn()}
        onRestoreDefaults={vi.fn()}
      />,
      'vi'
    );
    expect(customHtml).toContain('reminders-custom-chip-3');
    expect(customHtml).toContain('reminders-custom-chip-0');
    expect(customHtml).toContain('Còn 3 ngày');
    expect(customHtml).toContain('Hôm nay (0)');
    expect(customHtml).not.toContain('reminders-custom-chip-2');
    expect(customHtml).not.toContain('reminders-custom-chip-1');
  });

  it('builds E01 preview matching milestones, dueAt ordering, WQ-27 redaction, and renders live locale & empty states', () => {
    const tasks: TaskDto[] = [
      makeTask({
        id: 't-over-earlier',
        title: 'Overdue earlier',
        dueAt: '2026-11-24T00:00:00.000Z',
      }),
      makeTask({
        id: 't-over-recent',
        title: 'Overdue recent',
        dueAt: '2026-11-25T00:00:00.000Z',
      }),
      makeTask({
        id: 't-today-hidden',
        title: 'CONFIDENTIAL_TODAY_TASK',
        dueAt: '2026-11-26T00:00:00.000Z',
        isHidden: true,
        assignedDepartments: [{ id: 'd-1', name: 'HiddenDept' }],
      }),
      makeTask({
        id: 't-soon-1',
        title: 'Due in 1 day',
        dueAt: '2026-11-27T00:00:00.000Z',
      }),
      makeTask({
        id: 't-soon-2',
        title: 'Due in 2 days',
        dueAt: '2026-11-28T00:00:00.000Z',
      }),
      makeTask({
        id: 't-unmatched-5d',
        title: 'Unmatched 5 days task',
        dueAt: '2026-12-01T00:00:00.000Z',
      }),
      makeTask({
        id: 't-deleted',
        title: 'Soft deleted task',
        dueAt: '2026-11-25T00:00:00.000Z',
        deletedAt: '2026-11-25T01:00:00.000Z',
      }),
    ];

    const preview = buildReminderEmailPreviewData({
      tasks,
      daysBefore: [2, 1, 0],
      remindOverdue: true,
      nowMs: NOW_FIXED_MS,
    });

    expect(preview.totalCount).toBe(5);
    expect(preview.groups.map((g) => g.key)).toEqual(['overdue', 'today', 'upcoming']);
    expect(preview.groups[0]?.items.map((i) => i.title)).toEqual([
      'Overdue earlier',
      'Overdue recent',
    ]);
    expect(preview.groups[1]?.items[0]).toMatchObject({
      isHidden: true,
      title: null,
      departmentNames: [],
    });
    expect(preview.groups[2]?.items.map((i) => i.title)).toEqual([
      'Due in 1 day',
      'Due in 2 days',
    ]);

    const enPreviewHtml = renderWithIntl(
      <ReminderEmailPreview
        recipientName="Nguyễn Văn A"
        sendHourVn={7}
        daysBefore={[2, 1, 0]}
        remindOverdue
        nowMs={NOW_FIXED_MS}
      />,
      'en'
    );
    expect(enPreviewHtml).toContain('Tasks need your attention');
    expect(enPreviewHtml).toContain('Hi Nguyễn Văn A,');
    expect(enPreviewHtml).toContain('Overdue');
    expect(enPreviewHtml).toContain('Due today');
    expect(enPreviewHtml).toContain('Coming up');
    expect(enPreviewHtml).toContain('Prepare club intro slides');
    expect(enPreviewHtml).toContain('Draft MC script');
    expect(enPreviewHtml).toContain('Finalize sponsor list');
    expect(enPreviewHtml).toContain('Design year-end banner');
    expect(enPreviewHtml).toContain('href="/progress"');
    expect(enPreviewHtml).not.toContain('rem-email-lang');
    expect(enPreviewHtml).not.toContain('rem-sample-chip');
    expect(enPreviewHtml).not.toContain('rem-email-task-prio');
    expect(enPreviewHtml).not.toContain('ui-prio');
    expect(enPreviewHtml).not.toContain('rem-email-foot');

    const headerVi = renderWithIntl(<PreviewHeader />, 'vi');
    expect(headerVi).toContain('Xem trước email');
    expect(headerVi).not.toContain('rem-sample-chip');
    expect(headerVi).not.toContain('rem-preview-controls');

    const emptyHtml = renderWithIntl(
      <ReminderEmailPreview
        recipientName="Nguyễn Văn A"
        sendHourVn={7}
        daysBefore={[]}
        remindOverdue={false}
        nowMs={NOW_FIXED_MS}
      />,
      'vi'
    );
    expect(emptyHtml).toContain('Không có gì để nhắc — không gửi email rỗng');
    expect(emptyHtml).not.toContain('<button');
    expect(emptyHtml).not.toContain('Xem mẫu minh họa');
  });

  it('executes PUT /settings/reminders mutation, invalidates reminderSettings & auditLogs, and maps errors', async () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');

    const responsePayload = {
      settings: { ...SAMPLE_SETTINGS, daysBefore: [3, 1], remindOverdue: false },
    };
    apiFetchMock.mockResolvedValueOnce(responsePayload);

    const options = buildUpdateReminderSettingsMutationOptions(queryClient);
    const result = await options.mutationFn({ daysBefore: [3, 1], remindOverdue: false });
    expect(apiFetchMock).toHaveBeenCalledWith('/settings/reminders', {
      method: 'put',
      body: { daysBefore: [3, 1], remindOverdue: false },
    });
    expect(result).toEqual(responsePayload);

    await options.onSuccess(result);
    expect(setQueryDataSpy).toHaveBeenCalledWith(REMINDERS_QUERY_KEYS.settings, responsePayload);

    await invalidateAfterReminderSettingsUpdate(queryClient);
    const invalidatedRoots = invalidateSpy.mock.calls.map(
      ([arg]) => (arg as { queryKey: readonly string[] }).queryKey[0]
    );
    expect(invalidatedRoots).toContain('reminderSettings');
    expect(invalidatedRoots).toContain('auditLogs');

    expect(
      describeReminderError(
        new ApiClientError({
          status: 403,
          code: 'FORBIDDEN',
          messageKey: 'errors.forbidden',
          details: {},
          requestId: 'req-rem-403',
        })
      )
    ).toEqual({ key: 'forbidden', requestId: 'req-rem-403' });
  });

  it('reuses shared @/lib/reminders schema (===, .max(30), .strict()) and enforces max-30 preset checkbox states', () => {
    expect(updateReminderSettingsSchema).toBe(libUpdateReminderSettingsSchema);
    expect(MAX_MILESTONE_COUNT).toBe(30);

    const thirtyOneDays = Array.from({ length: 31 }, (_, i) => i);
    expect(
      updateReminderSettingsSchema.safeParse({
        daysBefore: thirtyOneDays,
        remindOverdue: true,
      }).success
    ).toBe(false);

    expect(
      updateReminderSettingsSchema.safeParse({
        daysBefore: [2, 1],
        remindOverdue: true,
        unexpectedField: true,
      }).success
    ).toBe(false);

    const thirtyUncheckedPresets = Array.from({ length: 30 }, (_, i) => i + 10);
    expect(addMilestoneDay(thirtyUncheckedPresets, 5)).toHaveLength(30);
    expect(toggleMilestoneDay(thirtyUncheckedPresets, 2)).toHaveLength(30);
    expect(toggleMilestoneDay(thirtyUncheckedPresets, 10)).toHaveLength(29);

    const htmlAllPresetsUnchecked = renderWithIntl(
      <ReminderMilestonesCard
        daysBefore={thirtyUncheckedPresets}
        remindOverdue={false}
        disabled={false}
        onToggleDay={vi.fn()}
        onAddDay={vi.fn()}
        onRemoveDay={vi.fn()}
        onToggleOverdue={vi.fn()}
        onRestoreDefaults={vi.fn()}
      />,
      'vi'
    );
    const checkboxInputsAllUnchecked = [...htmlAllPresetsUnchecked.matchAll(/<input[^>]*type="checkbox"[^>]*>/g)].map(
      (m) => m[0]
    );
    expect(checkboxInputsAllUnchecked).toHaveLength(3);
    expect(checkboxInputsAllUnchecked[0]).toContain('disabled=""');
    expect(checkboxInputsAllUnchecked[1]).toContain('disabled=""');
    expect(checkboxInputsAllUnchecked[2]).not.toContain('disabled=""');

    const thirtyWithDayTwo = [2, ...Array.from({ length: 29 }, (_, i) => i + 10)];
    const htmlDayTwoChecked = renderWithIntl(
      <ReminderMilestonesCard
        daysBefore={thirtyWithDayTwo}
        remindOverdue
        disabled={false}
        onToggleDay={vi.fn()}
        onAddDay={vi.fn()}
        onRemoveDay={vi.fn()}
        onToggleOverdue={vi.fn()}
        onRestoreDefaults={vi.fn()}
      />,
      'vi'
    );
    const checkboxInputsDayTwo = [...htmlDayTwoChecked.matchAll(/<input[^>]*type="checkbox"[^>]*>/g)].map(
      (m) => m[0]
    );
    expect(checkboxInputsDayTwo).toHaveLength(3);
    expect(checkboxInputsDayTwo[0]).toContain('checked=""');
    expect(checkboxInputsDayTwo[0]).not.toContain('disabled=""');
    expect(checkboxInputsDayTwo[1]).toContain('disabled=""');
    expect(checkboxInputsDayTwo[2]).toContain('checked=""');
    expect(checkboxInputsDayTwo[2]).not.toContain('disabled=""');
  });
});

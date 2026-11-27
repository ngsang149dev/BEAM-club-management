'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ErrorState } from '@/components/ErrorState';
import { BoardTrashModal } from '@/features/boards/components/BoardTrashModal';
import { CreateTaskModal } from '@/features/tasks/components/CreateTaskModal';
import { TaskDetailDrawer } from '@/features/tasks/components/TaskDetailDrawer';
import { describeTaskError } from '@/features/tasks/error-mapping';
import {
  buildYearCalendar,
  computeCalendarTierCounts,
  filterCalendarTasks,
  packCalendarLanes,
} from '../calendar-math';
import { useCalendarTasks } from '../hooks/useCalendarTasks';
import { useCalendarViewport } from '../hooks/useCalendarViewport';
import { CalendarLegend } from './CalendarLegend';
import { CalendarTimeline } from './CalendarTimeline';
import { CalendarToolbar } from './CalendarToolbar';
import { CalendarUnscheduledTray } from './CalendarUnscheduledTray';

function CalendarErrorBody({ error, onRetry }: { readonly error: unknown; readonly onRetry: () => void }) {
  const tCal = useTranslations('calendar');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('errors');
  const err = describeTaskError(error);

  return (
    <div className="hcal-error-wrap">
      <ErrorState
        variant="500"
        title={tCal('loadError')}
        description={tErr(err?.key ?? 'unknown')}
        requestId={err?.requestId}
        requestIdLabel={tErr('requestIdLabel')}
        actions={<button type="button" className="ui-btn primary" onClick={onRetry}>{tCommon('retry')}</button>}
      />
    </div>
  );
}

function CalendarModals({
  createOpen,
  trashOpen,
  selectedTaskId,
  onCloseCreate,
  onCloseTrash,
  onCloseTask,
}: {
  readonly createOpen: boolean;
  readonly trashOpen: boolean;
  readonly selectedTaskId: string | null;
  readonly onCloseCreate: () => void;
  readonly onCloseTrash: () => void;
  readonly onCloseTask: () => void;
}) {
  const tCal = useTranslations('calendar');
  return (
    <>
      {createOpen ? <CreateTaskModal onClose={onCloseCreate} /> : null}
      {trashOpen ? (
        <BoardTrashModal
          boardId={null}
          boardName={tCal('workspaceBoardName')}
          onClose={onCloseTrash}
        />
      ) : null}
      <TaskDetailDrawer taskId={selectedTaskId} onClose={onCloseTask} />
    </>
  );
}

function useCalendarWorkspaceData() {
  const locale = useLocale();
  const calTasks = useCalendarTasks();
  const { todayIso, currentVnYear, state, tasksQuery, departments } = calTasks;
  const calendar = useMemo(
    () => buildYearCalendar(state.year, todayIso, locale === 'en' ? 'en' : 'vi'),
    [state.year, todayIso, locale]
  );
  const isReady = !tasksQuery.isPending && !tasksQuery.isError;
  const viewport = useCalendarViewport(calendar, isReady);
  const allTasks = useMemo(() => tasksQuery.data?.items ?? [], [tasksQuery.data]);
  const counts = useMemo(() => computeCalendarTierCounts(allTasks, todayIso), [allTasks, todayIso]);
  const filtered = useMemo(
    () => filterCalendarTasks(allTasks, state.deadlineFilter, todayIso),
    [allTasks, state.deadlineFilter, todayIso]
  );
  const packed = useMemo(
    () => packCalendarLanes(filtered, calendar.yearStartIso, calendar.totalDays),
    [filtered, calendar.yearStartIso, calendar.totalDays]
  );

  return {
    calTasks,
    calendar,
    viewport,
    counts,
    lanes: packed.lanes,
    unscheduled: packed.unscheduled,
    departments,
    currentVnYear,
    currentVnMonthIndex: Number.parseInt(todayIso.slice(5, 7), 10) - 1,
    hasActiveFilters: Boolean(state.deadlineFilter !== 'all' || state.departmentId || state.q.trim()),
  };
}

function CalendarBodyContent({
  data,
}: {
  readonly data: ReturnType<typeof useCalendarWorkspaceData>;
}) {
  const tCommon = useTranslations('common');
  const { tasksQuery, todayIso, openTaskModal, resetFilters } = data.calTasks;

  if (tasksQuery.isPending) {
    return <div className="hcal-loading-wrap"><p className="auth-loading" role="status">{tCommon('loading')}</p></div>;
  }
  if (tasksQuery.isError) {
    return <CalendarErrorBody error={tasksQuery.error} onRetry={() => void tasksQuery.refetch()} />;
  }

  const handleJumpMonthHeader = (mIdx: number) => {
    const mInfo = data.calendar.months[mIdx];
    if (!mInfo) return;
    if (data.viewport.zoomValue < 40) {
      data.viewport.animateZoomTo(50, mInfo.startIndex + mInfo.dayCount / 2);
    } else {
      data.viewport.jumpToMonth(mIdx, true);
    }
  };

  return (
    <CalendarTimeline
      scrollerRef={data.viewport.scrollerRef}
      canvasRef={data.viewport.canvasRef}
      calendar={data.calendar}
      zoomTier={data.viewport.zoomTier}
      todayIso={todayIso}
      currentVnMonthIndex={data.currentVnMonthIndex}
      isCurrentYear={data.calTasks.state.year === data.currentVnYear}
      lanes={data.lanes}
      hasActiveFilters={data.hasActiveFilters}
      onScroll={data.viewport.syncMonthFromScroll}
      panHandlers={data.viewport.panHandlers}
      onJumpToMonth={handleJumpMonthHeader}
      onOpenTask={(taskId) => { if (!data.viewport.canSkipClick()) openTaskModal(taskId); }}
      onResetFilters={resetFilters}
    />
  );
}

export function CalendarWorkspaceView() {
  const tCal = useTranslations('calendar');
  const [createOpen, setCreateOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const data = useCalendarWorkspaceData();
  const { state, setYear, setDeadlineFilter, setDepartmentId, setSearchQuery, openTaskModal, closeTaskModal } = data.calTasks;

  const handleCenterToday = () => {
    if (state.year !== data.currentVnYear) {
      setYear(data.currentVnYear);
      return;
    }
    data.viewport.centerOnToday(true);
  };

  return (
    <section className="hcal-shell" aria-label={tCal('title')}>
      <CalendarToolbar
        year={state.year}
        selectedMonthIndex={data.viewport.selectedMonthIndex}
        months={data.calendar.months}
        zoomValue={data.viewport.zoomValue}
        zoomTier={data.viewport.zoomTier}
        counts={data.counts}
        deadlineFilter={state.deadlineFilter}
        departmentId={state.departmentId}
        q={state.q}
        departments={data.departments}
        showTrashButton
        onYearChange={setYear}
        onSelectMonth={(mIdx) => data.viewport.jumpToMonth(mIdx, true)}
        onCenterToday={handleCenterToday}
        onZoomSliderChange={data.viewport.onSliderChange}
        onZoomPreset={(val) => data.viewport.animateZoomTo(val)}
        onDeadlineFilterChange={setDeadlineFilter}
        onDepartmentChange={setDepartmentId}
        onSearchChange={setSearchQuery}
        onOpenCreate={() => setCreateOpen(true)}
        onOpenTrash={() => setTrashOpen(true)}
      />
      <CalendarBodyContent data={data} />
      <CalendarUnscheduledTray tasks={data.unscheduled} todayIso={data.calTasks.todayIso} onOpenTask={openTaskModal} />
      <CalendarLegend />
      <CalendarModals
        createOpen={createOpen}
        trashOpen={trashOpen}
        selectedTaskId={state.selectedTaskId}
        onCloseCreate={() => setCreateOpen(false)}
        onCloseTrash={() => setTrashOpen(false)}
        onCloseTask={closeTaskModal}
      />
    </section>
  );
}

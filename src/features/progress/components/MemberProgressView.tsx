'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ErrorState } from '@/components/ErrorState';
import { TaskDetailDrawer } from '@/features/tasks/components/TaskDetailDrawer';
import { describeTaskError } from '@/features/tasks/error-mapping';
import { useMemberProgress } from '../hooks/useMemberProgress';
import { ProgressCommentsModal } from './ProgressCommentsModal';
import { ProgressHeaderBar } from './ProgressHeaderBar';
import { ProgressInspectorPane } from './ProgressInspectorPane';
import { ProgressTaskListPane } from './ProgressTaskListPane';

function ProgressLoadError({
  title,
  error,
  onRetry,
}: {
  readonly title: string;
  readonly error: unknown;
  readonly onRetry: () => void;
}) {
  const tCommon = useTranslations('common');
  const tErr = useTranslations('errors');
  const err = describeTaskError(error);

  return (
    <ErrorState
      variant="500"
      title={title}
      description={tErr(err?.key ?? 'unknown')}
      requestId={err?.requestId}
      requestIdLabel={tErr('requestIdLabel')}
      actions={
        <button type="button" className="ui-btn primary" onClick={onRetry}>
          {tCommon('retry')}
        </button>
      }
    />
  );
}

function ProgressWorkspaceGrid({
  progress,
  onOpenDetail,
  onOpenComments,
}: {
  readonly progress: ReturnType<typeof useMemberProgress>;
  readonly onOpenDetail: (taskId: string) => void;
  readonly onOpenComments: (taskId: string) => void;
}) {
  return (
    <div className="prog-grid">
      <ProgressTaskListPane
        mode={progress.mode}
        identity={progress.memberIdentity}
        tasks={progress.filteredTasks}
        targetMemberId={progress.targetMemberId}
        selectedTaskId={progress.selectedTask?.id ?? null}
        filter={progress.filter}
        searchQuery={progress.searchQuery}
        isPending={progress.memberTasksQuery.isPending}
        isError={progress.memberTasksQuery.isError}
        error={progress.memberTasksQuery.error}
        onFilterChange={progress.setFilter}
        onSearchChange={progress.setSearchQuery}
        onRetry={() => void progress.memberTasksQuery.refetch()}
        onSelectTask={progress.selectTask}
      />
      <ProgressInspectorPane
        task={progress.selectedTask}
        targetMemberId={progress.targetMemberId}
        currentUserId={progress.currentUserId}
        isSelf={progress.isSelf}
        isAdmin={progress.isAdmin}
        canUpdateAny={progress.canUpdateAny}
        canUpdateAssigned={progress.canUpdateAssigned}
        onOpenDetail={onOpenDetail}
        onOpenComments={onOpenComments}
        onRefresh={() => void progress.memberTasksQuery.refetch()}
      />
    </div>
  );
}

export function MemberProgressView() {
  const t = useTranslations('progress');
  const tCommon = useTranslations('common');
  const progress = useMemberProgress();
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(null);
  const [commentsModalTaskId, setCommentsModalTaskId] = useState<string | null>(null);

  if (progress.meQuery.isPending) return <p className="auth-loading" role="status">{tCommon('loading')}</p>;
  if (progress.meQuery.isError) {
    return <ProgressLoadError title={t('loadTasksError')} error={progress.meQuery.error} onRetry={() => void progress.meQuery.refetch()} />;
  }

  const commentsModalTask = commentsModalTaskId
    ? (progress.directTasks.find((task) => task.id === commentsModalTaskId) ?? null)
    : null;

  return (
    <div className="prog-workspace">
      <ProgressHeaderBar
        canInspectClubMembers={progress.canInspectClubMembers}
        mode={progress.mode}
        onModeChange={progress.setMode}
        departments={progress.departmentsQuery.data?.items ?? []}
        selectedDepartmentId={progress.selectedDepartmentId}
        onDepartmentChange={progress.setSelectedDepartmentId}
        members={progress.deptMembers}
        selectedMember={progress.selectedMember}
        workloadMap={progress.workloadMap}
        onSelectMember={progress.selectMember}
        onStepMember={progress.stepMember}
        stats={progress.stats}
      />
      {progress.mode === 'team' && progress.membersQuery.isError ? (
        <ProgressLoadError title={t('loadMembersError')} error={progress.membersQuery.error} onRetry={() => void progress.membersQuery.refetch()} />
      ) : null}
      <ProgressWorkspaceGrid progress={progress} onOpenDetail={setDrawerTaskId} onOpenComments={setCommentsModalTaskId} />
      <TaskDetailDrawer taskId={drawerTaskId} onClose={() => setDrawerTaskId(null)} />
      <ProgressCommentsModal task={commentsModalTask} onClose={() => setCommentsModalTaskId(null)} />
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ErrorState } from '@/components/ErrorState';
import { MemberAvatar } from '@/components/MemberAvatar';
import { useSessionQuery } from '@/features/auth/hooks/useAuth';
import { isMemberDetail, type MemberListItem } from '@/features/members/hooks/useMembers';
import { usePermissions } from '@/features/shared/permissions/can';
import { PERMISSION_PRESETS } from '@/lib/permissions';
import { describePermissionsError } from '../error-mapping';
import { usePermissionsEditorState } from '../hooks/usePermissionsEditorState';
import { AdminFlagPanel } from './AdminFlagPanel';
import { PermissionMatrixGroups } from './PermissionMatrixGroups';
import { PermissionPresetModal, type PresetOption } from './PermissionPresetModal';
import { PermissionsMemberList } from './PermissionsMemberList';

function PermissionsHeaderBar({
  member,
  isAdminFlag,
  presets,
  onPickPreset,
}: {
  member: MemberListItem;
  isAdminFlag: boolean;
  presets: readonly PresetOption[];
  onPickPreset: (preset: PresetOption) => void;
}) {
  const t = useTranslations('permissionsAdmin');
  const tPerm = useTranslations('permissions');
  const deptText =
    member.departments.length > 0
      ? member.departments.map((dept) => dept.name).join(', ')
      : t('noDepartment');

  return (
    <div className="perm-top">
      <div className="perm-who">
        <MemberAvatar
          memberId={member.id}
          fullName={member.fullName}
          avatarUrl={member.avatarUrl}
          isActive={member.isActive}
        />
        <div>
          <h2>{member.fullName}</h2>
          <span>{isAdminFlag ? t('roleAdmin') : t('roleMember')} · {deptText}</span>
        </div>
      </div>
      <div className="perm-presets">
        <span className="perm-presets-label">{t('presetsLabel')}</span>
        <div className="perm-preset-row">
          {presets.map((preset) => (
            <button key={preset.code} type="button" className="perm-preset" onClick={() => onPickPreset(preset)}>
              <span>{tPerm(`presets.${preset.code}`)}</span>
              <b>{t('presetCountBadge', { count: preset.permissionCodes.length })}</b>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PermissionsErrorBanner({ saveError }: { saveError: unknown }) {
  const tErr = useTranslations('errors');
  const err = describePermissionsError(saveError);
  if (!err) return null;

  return (
    <div className="ui-banner is-danger" role="alert">
      <div className="ui-banner-body">
        <span className="ui-banner-text">{tErr(err.key)}</span>
        {err.requestId ? <span className="ui-banner-meta">{tErr('requestIdLabel')}: {err.requestId}</span> : null}
      </div>
    </div>
  );
}

function PermissionsSaveBar({
  effectiveCount,
  isDirty,
  isSaving,
  onDiscard,
  onSave,
}: {
  effectiveCount: number;
  isDirty: boolean;
  isSaving: boolean;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const t = useTranslations('permissionsAdmin');

  return (
    <div className="perm-savebar">
      <div className="perm-effective">
        <span className="ui-chip perm-effective-badge">
          {t('effectiveSummaryCount', { count: effectiveCount })}
        </span>
        {isDirty ? <span className="perm-unsaved-note">{t('unsavedChanges')}</span> : null}
      </div>
      <div className="perm-save-actions">
        <button type="button" className="ui-btn ghost" disabled={!isDirty || isSaving} onClick={onDiscard}>
          {t('discardChanges')}
        </button>
        <button type="button" className="ui-btn primary" disabled={!isDirty || isSaving} onClick={onSave}>
          {isSaving ? t('savingChanges') : t('saveChanges')}
        </button>
      </div>
    </div>
  );
}

function PermissionsQueryErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  const t = useTranslations('permissionsAdmin');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('errors');
  const err = describePermissionsError(error);
  const isForbidden = err?.key === 'forbidden';

  return (
    <ErrorState
      variant={isForbidden ? '403' : '500'}
      code={isForbidden ? tErr('403.code') : undefined}
      title={isForbidden ? t('forbiddenTitle') : t('loadErrorTitle')}
      description={isForbidden ? t('forbiddenDescription') : tErr(err?.key ?? 'unknown')}
      requestId={err?.requestId}
      requestIdLabel={tErr('requestIdLabel')}
      actions={<button type="button" className="ui-btn primary" onClick={onRetry}>{tCommon('retry')}</button>}
    />
  );
}

function resolvePresets(items?: readonly PresetOption[]): PresetOption[] {
  if (items && items.length > 0) return [...items];
  return PERMISSION_PRESETS.map((p) => ({ code: p.code, permissionCodes: p.permissions }));
}

function PermissionsMainColumn({
  state,
  currentUserId,
}: {
  state: ReturnType<typeof usePermissionsEditorState>;
  currentUserId: string | null;
}) {
  const t = useTranslations('permissionsAdmin');
  const member = state.activeMember;

  if (!member) {
    return (
      <section className="perm-main">
        <div className="admin-card admin-empty-box"><p className="admin-card-hint">{t('selectMemberPrompt')}</p></div>
      </section>
    );
  }
  if (state.memberPermQuery.isError) {
    return (
      <section className="perm-main">
        <PermissionsQueryErrorState error={state.memberPermQuery.error} onRetry={() => state.memberPermQuery.refetch()} />
      </section>
    );
  }

  const presets = resolvePresets(state.presetsQuery.data?.items);
  const isMemberAdmin = state.memberPermQuery.data?.isAdmin ?? (isMemberDetail(member) && member.isAdmin);

  return (
    <section className="perm-main">
      <PermissionsHeaderBar member={member} isAdminFlag={isMemberAdmin} presets={presets} onPickPreset={(p) => { state.presetMutation.reset(); state.setPendingPreset(p); }} />
      <PermissionsErrorBanner saveError={state.replaceMutation.error} />
      <AdminFlagPanel memberName={member.fullName} isAdmin={isMemberAdmin} isSelf={member.id === currentUserId} isUpdating={state.adminMutation.isPending} error={state.adminMutation.error} onToggleAdmin={state.toggleAdminFlag} />
      <PermissionMatrixGroups catalogItems={state.catalogQuery.data?.items} selectedCodes={state.effectiveCodes} disabled={state.memberPermQuery.isPending || state.replaceMutation.isPending} isLoading={state.memberPermQuery.isPending} onTogglePermission={state.togglePermission} />
      <PermissionsSaveBar effectiveCount={state.effectiveCodes.length} isDirty={state.isDirty} isSaving={state.replaceMutation.isPending} onDiscard={state.discardDraft} onSave={state.savePermissions} />
    </section>
  );
}

export function PermissionsAdminView() {
  const { isAdmin } = usePermissions();
  const t = useTranslations('permissionsAdmin');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('errors');
  const sessionQuery = useSessionQuery(isAdmin);
  const state = usePermissionsEditorState(isAdmin);

  if (!isAdmin) {
    return (
      <ErrorState
        variant="403"
        code={tErr('403.code')}
        title={t('forbiddenTitle')}
        description={t('forbiddenDescription')}
        actions={<Link href="/" className="ui-btn primary">{tCommon('goHome')}</Link>}
      />
    );
  }
  if (state.membersQuery.isError) {
    return <PermissionsQueryErrorState error={state.membersQuery.error} onRetry={() => state.membersQuery.refetch()} />;
  }

  return (
    <div className="admin-page-stack">
      <div className="perm-layout">
        <PermissionsMemberList
          members={state.members}
          selectedUserId={state.activeMember?.id ?? null}
          searchQuery={state.searchQuery}
          isPending={state.membersQuery.isPending}
          hasNextPage={Boolean(state.membersQuery.hasNextPage)}
          isFetchingNextPage={state.membersQuery.isFetchingNextPage}
          onSearchChange={state.setSearchQuery}
          onSelectMember={state.selectMember}
          onLoadMore={() => state.membersQuery.fetchNextPage()}
        />
        <PermissionsMainColumn state={state} currentUserId={sessionQuery.data?.userId ?? null} />
      </div>
      {state.pendingPreset ? (
        <PermissionPresetModal
          preset={state.pendingPreset}
          currentPermissions={state.serverCodes}
          isApplying={state.presetMutation.isPending}
          error={state.presetMutation.error}
          onClose={() => { state.presetMutation.reset(); state.setPendingPreset(null); }}
          onConfirm={state.confirmPreset}
        />
      ) : null}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useDebouncedValue } from '@/features/shared/hooks/useDebouncedValue';
import type { PermissionCode } from '@/features/shared/permissions/can';
import { computePermissionDiff, dedupeCanonicalPermissions } from '@/lib/permissions';
import type { PresetOption } from '../components/PermissionPresetModal';
import {
  useApplyPermissionPresetMutation,
  useMemberPermissionsQuery,
  usePermissionCatalogQuery,
  usePermissionMembersQuery,
  usePermissionPresetsQuery,
  useReplaceMemberPermissionsMutation,
  useUpdateAdminFlagMutation,
} from './usePermissionsAdmin';

interface DraftSelection {
  readonly userId: string;
  readonly codes: PermissionCode[];
}

function toggleCode(current: readonly PermissionCode[], code: PermissionCode): PermissionCode[] {
  const exists = current.includes(code);
  const next = exists ? current.filter((item) => item !== code) : [...current, code];
  return dedupeCanonicalPermissions(next);
}

function resolveDraftAndDirty(
  activeUserId: string | null,
  draft: DraftSelection | null,
  serverCodes: PermissionCode[]
) {
  const effectiveCodes = activeUserId && draft?.userId === activeUserId ? draft.codes : serverCodes;
  const diff = computePermissionDiff(serverCodes, effectiveCodes);
  const isDirty = Boolean(activeUserId) && (diff.added.length > 0 || diff.removed.length > 0);
  return { effectiveCodes, isDirty };
}

export function usePermissionsEditorState(isAdmin: boolean) {
  const t = useTranslations('permissionsAdmin');
  const tPerm = useTranslations('permissions');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftSelection | null>(null);
  const [pendingPreset, setPendingPreset] = useState<PresetOption | null>(null);

  const debouncedSearchQuery = useDebouncedValue(searchQuery, 250);
  const catalogQuery = usePermissionCatalogQuery(isAdmin);
  const presetsQuery = usePermissionPresetsQuery(isAdmin);
  const membersQuery = usePermissionMembersQuery(debouncedSearchQuery, isAdmin);
  const members = isAdmin
    ? (membersQuery.data?.pages.flatMap((page) => page.items).filter((member) => member.isActive) ?? [])
    : [];
  const activeMember = members.find((m) => m.id === selectedId) ?? members[0] ?? null;
  const activeUserId = activeMember?.id ?? null;

  const memberPermQuery = useMemberPermissionsQuery(activeUserId, isAdmin);
  const replaceMutation = useReplaceMemberPermissionsMutation();
  const presetMutation = useApplyPermissionPresetMutation();
  const adminMutation = useUpdateAdminFlagMutation();

  const serverCodes = memberPermQuery.data?.permissionCodes ?? [];
  const { effectiveCodes, isDirty } = resolveDraftAndDirty(activeUserId, draft, serverCodes);

  return {
    searchQuery, setSearchQuery, pendingPreset, setPendingPreset,
    catalogQuery, presetsQuery, membersQuery, members, activeMember,
    memberPermQuery, replaceMutation, presetMutation, adminMutation,
    serverCodes, effectiveCodes, isDirty,
    selectMember: (userId: string) => { replaceMutation.reset(); presetMutation.reset(); adminMutation.reset(); setDraft(null); setSelectedId(userId); },
    togglePermission: (code: PermissionCode) => { if (!activeUserId) return; replaceMutation.reset(); setDraft({ userId: activeUserId, codes: toggleCode(effectiveCodes, code) }); },
    discardDraft: () => { replaceMutation.reset(); setDraft(null); },
    savePermissions: () => {
      if (!activeMember) return;
      replaceMutation.mutate({ userId: activeMember.id, permissionCodes: effectiveCodes }, { onSuccess: () => { setDraft(null); toast.success(t('savedToast', { name: activeMember.fullName })); } });
    },
    confirmPreset: () => {
      if (!activeMember || !pendingPreset) return;
      presetMutation.mutate({ userId: activeMember.id, presetCode: pendingPreset.code }, { onSuccess: () => { setDraft(null); toast.success(t('presetAppliedToast', { name: tPerm(`presets.${pendingPreset.code}`) })); setPendingPreset(null); } });
    },
    toggleAdminFlag: (nextIsAdmin: boolean) => {
      if (!activeMember) return;
      adminMutation.reset();
      adminMutation.mutate({ userId: activeMember.id, isAdmin: nextIsAdmin }, { onSuccess: () => toast.success(t(nextIsAdmin ? 'adminGrantedToast' : 'adminRevokedToast', { name: activeMember.fullName })) });
    },
  };
}

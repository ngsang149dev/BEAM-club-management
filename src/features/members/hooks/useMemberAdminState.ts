'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useDepartmentsQuery } from '@/features/departments/hooks/useDepartments';
import { useDebouncedValue } from '@/features/shared/hooks/useDebouncedValue';
import { isApiClientError } from '@/features/shared/api/client';
import {
  useActivateMemberMutation,
  useCreateMemberMutation,
  useDeactivateMemberMutation,
  useMembersInfiniteQuery,
  useRemoveMemberAvatarMutation,
  useResetMemberPasswordMutation,
  useUpdateMemberAvatarMutation,
  useUpdateMemberMutation,
  type MemberListItem,
  type MembersFilterState,
  type UpdateMemberRequest,
} from './useMembers';
import type { CreateMemberValues } from '../schemas';

export const DEFAULT_ADMIN_FILTERS: MembersFilterState = {
  q: '',
  departmentId: '',
  status: 'all',
  limit: 20,
};

export type AdminModalState =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'edit'; member: MemberListItem }
  | { kind: 'resetPassword'; member: MemberListItem }
  | { kind: 'status'; member: MemberListItem; action: 'deactivate' | 'activate' };

function useMemberAdminMutations() {
  return {
    createMutation: useCreateMemberMutation(),
    updateMutation: useUpdateMemberMutation(),
    deactivateMutation: useDeactivateMemberMutation(),
    activateMutation: useActivateMemberMutation(),
    resetPasswordMutation: useResetMemberPasswordMutation(),
    updateAvatarMutation: useUpdateMemberAvatarMutation(),
    removeAvatarMutation: useRemoveMemberAvatarMutation(),
  };
}

function buildAdminActionHandlers(params: {
  modalState: AdminModalState;
  mutations: ReturnType<typeof useMemberAdminMutations>;
  t: ReturnType<typeof useTranslations<'memberAdmin'>>;
  tErr: ReturnType<typeof useTranslations<'errors'>>;
  onSuccess: (message: string) => void;
}) {
  const { modalState, mutations, t, tErr, onSuccess } = params;

  return {
    submitCreate: (values: CreateMemberValues) => {
      mutations.createMutation.mutate(values, {
        onSuccess: (res) => onSuccess(t('createdToast', { name: res.member.fullName })),
      });
    },
    submitEdit: (payload: UpdateMemberRequest) => {
      if (modalState.kind !== 'edit') return;
      mutations.updateMutation.mutate(
        { id: modalState.member.id, payload },
        { onSuccess: (res) => onSuccess(t('updatedToast', { name: res.member.fullName })) }
      );
    },
    submitResetPassword: (newPassword: string) => {
      if (modalState.kind !== 'resetPassword') return;
      mutations.resetPasswordMutation.mutate(
        { id: modalState.member.id, payload: { newPassword } },
        {
          onSuccess: (res) => onSuccess(t('passwordResetToast', { name: res.member.fullName })),
          onError: (err) => {
            if (isApiClientError(err) && (err.code === 'FORBIDDEN' || err.status === 403)) {
              toast.error(tErr('forbidden'));
            }
          },
        }
      );
    },
    confirmStatusChange: () => {
      if (modalState.kind !== 'status') return;
      const isDeactivate = modalState.action === 'deactivate';
      const mutate = isDeactivate ? mutations.deactivateMutation.mutate : mutations.activateMutation.mutate;
      mutate(modalState.member.id, {
        onSuccess: (res) => onSuccess(t(isDeactivate ? 'deactivatedToast' : 'activatedToast', { name: res.member.fullName })),
      });
    },
  };
}

function buildAvatarActionHandlers(params: {
  modalState: AdminModalState;
  mutations: ReturnType<typeof useMemberAdminMutations>;
  t: ReturnType<typeof useTranslations<'memberAdmin'>>;
  setModalState: React.Dispatch<React.SetStateAction<AdminModalState>>;
}) {
  const { modalState, mutations, t, setModalState } = params;
  const syncMember = (updated: MemberListItem) => {
    setModalState((prev) =>
      prev.kind === 'edit' && prev.member.id === updated.id
        ? { ...prev, member: updated }
        : prev
    );
  };

  return {
    clearAvatarErrors: () => {
      mutations.updateAvatarMutation.reset();
      mutations.removeAvatarMutation.reset();
    },
    submitUploadAvatar: async (dataUrl: string) => {
      if (modalState.kind !== 'edit') return;
      const res = await mutations.updateAvatarMutation.mutateAsync({ id: modalState.member.id, dataUrl });
      syncMember(res.member);
      toast.success(t('avatarUpdatedToast', { name: res.member.fullName }));
    },
    submitRemoveAvatar: async () => {
      if (modalState.kind !== 'edit') return;
      const res = await mutations.removeAvatarMutation.mutateAsync(modalState.member.id);
      syncMember(res.member);
      toast.success(t('avatarRemovedToast', { name: res.member.fullName }));
    },
  };
}

export function useMemberAdminState(allowed: boolean, canViewList: boolean) {
  const t = useTranslations('memberAdmin');
  const tErr = useTranslations('errors');
  const [filters, setFilters] = useState<MembersFilterState>(DEFAULT_ADMIN_FILTERS);
  const debouncedQ = useDebouncedValue(filters.q, 250);
  const [modalState, setModalState] = useState<AdminModalState>({ kind: 'closed' });

  const departmentsQuery = useDepartmentsQuery(allowed);
  const membersQuery = useMembersInfiniteQuery({ ...filters, q: debouncedQ }, canViewList);
  const mutations = useMemberAdminMutations();

  const closeModal = () => {
    mutations.createMutation.reset();
    mutations.updateMutation.reset();
    mutations.deactivateMutation.reset();
    mutations.activateMutation.reset();
    mutations.resetPasswordMutation.reset();
    mutations.updateAvatarMutation.reset();
    mutations.removeAvatarMutation.reset();
    setModalState({ kind: 'closed' });
  };

  const handleSuccess = (message: string) => {
    toast.success(message);
    closeModal();
  };

  const handlers = buildAdminActionHandlers({ modalState, mutations, t, tErr, onSuccess: handleSuccess });
  const avatarHandlers = buildAvatarActionHandlers({ modalState, mutations, t, setModalState });

  return {
    filters,
    setFilters,
    modalState,
    setModalState,
    departmentsQuery,
    membersQuery,
    ...mutations,
    closeModal,
    ...handlers,
    ...avatarHandlers,
  };
}

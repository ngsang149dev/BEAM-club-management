'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useDepartmentsQuery } from '@/features/departments/hooks/useDepartments';
import { isApiClientError } from '@/features/shared/api/client';
import {
  useActivateMemberMutation,
  useCreateMemberMutation,
  useDeactivateMemberMutation,
  useMembersInfiniteQuery,
  useResetMemberPasswordMutation,
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

export function useMemberAdminState(allowed: boolean, canViewList: boolean) {
  const t = useTranslations('memberAdmin');
  const tErr = useTranslations('errors');
  const [filters, setFilters] = useState<MembersFilterState>(DEFAULT_ADMIN_FILTERS);
  const [modalState, setModalState] = useState<AdminModalState>({ kind: 'closed' });
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const departmentsQuery = useDepartmentsQuery(allowed);
  const membersQuery = useMembersInfiniteQuery(filters, canViewList);
  const mutations = useMemberAdminMutations();

  const closeModal = () => {
    mutations.createMutation.reset();
    mutations.updateMutation.reset();
    mutations.deactivateMutation.reset();
    mutations.activateMutation.reset();
    mutations.resetPasswordMutation.reset();
    setModalState({ kind: 'closed' });
  };

  const handleSuccess = (message: string) => {
    setToastMessage(message);
    closeModal();
  };

  const handlers = buildAdminActionHandlers({ modalState, mutations, t, tErr, onSuccess: handleSuccess });

  return {
    filters,
    setFilters,
    modalState,
    setModalState,
    toastMessage,
    departmentsQuery,
    membersQuery,
    ...mutations,
    closeModal,
    ...handlers,
  };
}

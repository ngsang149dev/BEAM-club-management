'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { MAX_LOGIN_GALLERY_ITEMS } from '@/lib/media';
import { describeBrandingError } from '../error-mapping';
import {
  useCreateGalleryItemMutation,
  useDeleteGalleryItemMutation,
  useReorderGalleryMutation,
  useUpdateGalleryItemMutation,
  type CreateLoginGalleryItemRequest,
  type LoginGalleryItemDto,
  type UpdateLoginGalleryItemRequest,
} from './useBranding';

export type GalleryModalState =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'edit'; item: LoginGalleryItemDto }
  | { kind: 'delete'; item: LoginGalleryItemDto };

export function swapAdjacentGalleryIds(
  items: readonly LoginGalleryItemDto[],
  index: number,
  direction: -1 | 1,
): string[] | null {
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= items.length) {
    return null;
  }
  const ids = items.map((item) => item.id);
  const currentId = ids[index];
  const neighborId = ids[targetIndex];
  if (!currentId || !neighborId) {
    return null;
  }
  ids[index] = neighborId;
  ids[targetIndex] = currentId;
  return ids;
}

function useGalleryMutationBundle() {
  const createMutation = useCreateGalleryItemMutation();
  const updateMutation = useUpdateGalleryItemMutation();
  const deleteMutation = useDeleteGalleryItemMutation();
  const reorderMutation = useReorderGalleryMutation();

  const resetAllErrors = () => {
    createMutation.reset();
    updateMutation.reset();
    deleteMutation.reset();
    reorderMutation.reset();
  };

  return { createMutation, updateMutation, deleteMutation, reorderMutation, resetAllErrors };
}

export function useLoginGalleryAdmin(items: readonly LoginGalleryItemDto[]) {
  const t = useTranslations('branding.gallery');
  const [modalState, setModalState] = useState<GalleryModalState>({ kind: 'closed' });
  const muts = useGalleryMutationBundle();
  const sortedItems = [...items].sort((a, b) => a.orderIndex - b.orderIndex);
  const isAtLimit = sortedItems.length >= MAX_LOGIN_GALLERY_ITEMS;

  const closeModal = () => { muts.resetAllErrors(); setModalState({ kind: 'closed' }); };
  const openCreate = () => { if (!isAtLimit) { muts.resetAllErrors(); setModalState({ kind: 'create' }); } };
  const openEdit = (item: LoginGalleryItemDto) => { muts.resetAllErrors(); setModalState({ kind: 'edit', item }); };
  const openDelete = (item: LoginGalleryItemDto) => { muts.resetAllErrors(); setModalState({ kind: 'delete', item }); };

  const handleCreate = async (payload: CreateLoginGalleryItemRequest) => {
    await muts.createMutation.mutateAsync(payload);
    toast.success(t('createdToast'));
    closeModal();
  };

  const handleEdit = async (id: string, payload: UpdateLoginGalleryItemRequest) => {
    await muts.updateMutation.mutateAsync({ id, payload });
    toast.success(t('updatedToast'));
    closeModal();
  };

  const handleDelete = async (id: string) => {
    await muts.deleteMutation.mutateAsync(id);
    toast.success(t('deletedToast'));
    closeModal();
  };

  const handleMove = async (index: number, direction: -1 | 1) => {
    const nextIds = swapAdjacentGalleryIds(sortedItems, index, direction);
    if (!nextIds) return;
    muts.reorderMutation.reset();
    try {
      await muts.reorderMutation.mutateAsync({ itemIds: nextIds });
      toast.success(t('reorderedToast'));
    } catch {
      // Rendered inline via reorderErrorKey.
    }
  };

  return {
    sortedItems,
    isAtLimit,
    modalState,
    createMutation: muts.createMutation,
    updateMutation: muts.updateMutation,
    deleteMutation: muts.deleteMutation,
    reorderMutation: muts.reorderMutation,
    reorderErrorKey: describeBrandingError(muts.reorderMutation.error),
    closeModal, openCreate, openEdit, openDelete, handleCreate, handleEdit, handleDelete, handleMove,
  };
}

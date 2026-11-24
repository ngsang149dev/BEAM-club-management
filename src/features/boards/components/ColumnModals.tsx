'use client';

import { useId } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { updateColumnRequestSchema, type UpdateColumnRequestInput } from '@/lib/boards';
import type { ColumnDto } from '../hooks/useBoards';
import { BoardErrorBanner, BoardModalFrame } from './BoardModals';

export interface ColumnUpsertModalProps {
  mode: 'create' | 'rename';
  column?: ColumnDto;
  isSubmitting: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (values: UpdateColumnRequestInput) => void;
}

export function ColumnUpsertModal({
  mode,
  column,
  isSubmitting,
  error,
  onClose,
  onSubmit,
}: ColumnUpsertModalProps) {
  const t = useTranslations('boards');
  const tCommon = useTranslations('common');
  const inputId = useId();
  const { register, handleSubmit, formState: { errors } } = useForm<UpdateColumnRequestInput>({
    resolver: zodResolver(updateColumnRequestSchema),
    defaultValues: { name: column?.name ?? '' },
  });

  const title = mode === 'create' ? t('columnCreateTitle') : t('columnRenameTitle');
  const submitLabel = mode === 'create' ? t('columnCreateSubmit') : t('columnRenameSubmit');

  return (
    <BoardModalFrame title={title} onClose={onClose}>
      <form className="ui-modal-body" method="post" onSubmit={handleSubmit(onSubmit)} noValidate>
        <BoardErrorBanner error={error} />
        <div className="ui-field">
          <label className="ui-label" htmlFor={inputId}>{t('columnNameLabel')}</label>
          <input id={inputId} className="ui-input" type="text" placeholder={t('columnNamePlaceholder')} aria-invalid={Boolean(errors.name)} {...register('name')} />
          {errors.name ? <p className="ui-field-error" role="alert">{t('validationColumnName')}</p> : null}
        </div>
        <div className="ui-modal-actions">
          <button type="button" className="ui-btn ghost" onClick={onClose} disabled={isSubmitting}>{tCommon('cancel')}</button>
          <button type="submit" className="ui-btn primary" disabled={isSubmitting}>{isSubmitting ? t('saving') : submitLabel}</button>
        </div>
      </form>
    </BoardModalFrame>
  );
}

export interface ColumnDeleteModalProps {
  column: ColumnDto;
  visibleTaskCount?: number;
  isDeleting: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: () => void;
}

export function ColumnDeleteModal({
  column,
  visibleTaskCount,
  isDeleting,
  error,
  onClose,
  onConfirm,
}: ColumnDeleteModalProps) {
  const t = useTranslations('boards');
  const tCommon = useTranslations('common');
  const count = visibleTaskCount ?? column.taskCount;

  return (
    <BoardModalFrame title={t('columnDeleteTitle')} onClose={onClose}>
      <div className="ui-modal-body">
        <p className="ui-modal-copy">{t('columnDeleteBody', { name: column.name })}</p>
        {count > 0 ? (
          <div className="ui-banner is-warn" role="status">
            <div className="ui-banner-body">
              <span className="ui-banner-text">{t('columnDeleteHasTasksWarn', { count })}</span>
            </div>
          </div>
        ) : null}
        <BoardErrorBanner error={error} />
        <div className="ui-modal-actions">
          <button type="button" className="ui-btn ghost" onClick={onClose} disabled={isDeleting}>{tCommon('cancel')}</button>
          <button type="button" className="ui-btn danger" onClick={onConfirm} disabled={isDeleting}>
            {isDeleting ? t('deleting') : t('columnDeleteConfirm')}
          </button>
        </div>
      </div>
    </BoardModalFrame>
  );
}

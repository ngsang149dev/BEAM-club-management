'use client';

import type { ReactNode } from 'react';
import { useId } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { z } from 'zod';
import { useEscapeClose } from '@/features/departments/components/DepartmentModals';
import type { DepartmentDto } from '@/features/departments/hooks/useDepartments';
import { boardNameSchema } from '@/lib/boards';
import { describeBoardError } from '../error-mapping';
import type { BoardSummaryDto } from '../hooks/useBoards';

const boardFormSchema = z.object({
  name: boardNameSchema,
  departmentId: z.string(),
});

export type BoardFormValues = z.infer<typeof boardFormSchema>;

export function BoardErrorBanner({ error }: { error: unknown }) {
  const tErr = useTranslations('errors');
  const descriptor = describeBoardError(error);
  if (!descriptor) return null;

  return (
    <div className="ui-banner is-danger" role="alert">
      <div className="ui-banner-body">
        <span className="ui-banner-text">{tErr(descriptor.key)}</span>
        {descriptor.requestId ? (
          <span className="ui-banner-meta">{tErr('requestIdLabel')}: {descriptor.requestId}</span>
        ) : null}
      </div>
    </div>
  );
}

export function BoardModalFrame({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const tCommon = useTranslations('common');
  const titleId = useId();
  useEscapeClose(true, onClose);

  return (
    <div className="ui-modal-backdrop" role="presentation">
      <div className="ui-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="ui-modal-header">
          <h2 id={titleId} className="ui-modal-title">{title}</h2>
          <button type="button" className="ui-icon-btn" aria-label={tCommon('close')} onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export interface BoardUpsertModalProps {
  mode: 'create' | 'edit';
  board?: BoardSummaryDto;
  departments: readonly DepartmentDto[];
  isSubmitting: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (payload: { name: string; departmentId: string | null }) => void;
}

export function BoardUpsertModal({
  mode,
  board,
  departments,
  isSubmitting,
  error,
  onClose,
  onSubmit,
}: BoardUpsertModalProps) {
  const t = useTranslations('boards');
  const tCommon = useTranslations('common');
  const baseId = useId();
  const { register, handleSubmit, formState: { errors } } = useForm<BoardFormValues>({
    resolver: zodResolver(boardFormSchema),
    defaultValues: {
      name: board?.name ?? '',
      departmentId: board?.department?.id ?? '',
    },
  });

  const title = mode === 'create' ? t('boardFormCreateTitle') : t('boardFormEditTitle');
  const submitLabel = mode === 'create' ? t('boardCreateSubmit') : t('boardEditSubmit');

  return (
    <BoardModalFrame title={title} onClose={onClose}>
      <form
        className="ui-modal-body"
        method="post"
        onSubmit={handleSubmit((vals) => onSubmit({ name: vals.name.trim(), departmentId: vals.departmentId || null }))}
        noValidate
      >
        <BoardErrorBanner error={error} />
        <div className="ui-field">
          <label className="ui-label" htmlFor={`${baseId}-name`}>{t('boardNameLabel')}</label>
          <input id={`${baseId}-name`} className="ui-input" type="text" placeholder={t('boardNamePlaceholder')} aria-invalid={Boolean(errors.name)} {...register('name')} />
          {errors.name ? <p className="ui-field-error" role="alert">{t('validationBoardName')}</p> : null}
        </div>
        <div className="ui-field">
          <label className="ui-label" htmlFor={`${baseId}-dept`}>{t('boardDepartmentLabel')}</label>
          <select id={`${baseId}-dept`} className="ui-select" {...register('departmentId')}>
            <option value="">{t('clubWideLabel')}</option>
            {departments.map((dept) => <option key={dept.id} value={dept.id}>{dept.name}</option>)}
          </select>
          <p className="ui-field-hint">{t('boardDepartmentHint')}</p>
        </div>
        <div className="ui-modal-actions">
          <button type="button" className="ui-btn ghost" onClick={onClose} disabled={isSubmitting}>{tCommon('cancel')}</button>
          <button type="submit" className="ui-btn primary" disabled={isSubmitting}>{isSubmitting ? t('saving') : submitLabel}</button>
        </div>
      </form>
    </BoardModalFrame>
  );
}

export function BoardArchiveModal({
  board,
  isArchiving,
  error,
  onClose,
  onConfirm,
}: {
  board: BoardSummaryDto;
  isArchiving: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations('boards');
  const tCommon = useTranslations('common');

  return (
    <BoardModalFrame title={t('archiveModalTitle')} onClose={onClose}>
      <div className="ui-modal-body">
        <p className="ui-modal-copy">{t('archiveModalBody', { name: board.name })}</p>
        <BoardErrorBanner error={error} />
        <div className="ui-modal-actions">
          <button type="button" className="ui-btn ghost" onClick={onClose} disabled={isArchiving}>{tCommon('cancel')}</button>
          <button type="button" className="ui-btn danger" onClick={onConfirm} disabled={isArchiving}>
            {isArchiving ? t('archiving') : t('archiveConfirm')}
          </button>
        </div>
      </div>
    </BoardModalFrame>
  );
}

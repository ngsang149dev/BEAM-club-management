'use client';

import type { ReactNode } from 'react';
import { useEffect, useId } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { departmentUpsertRequestSchema, type DepartmentUpsertRequestInput } from '@/lib/members';
import { describeDepartmentError } from '../error-mapping';
import type { DepartmentDto } from '../hooks/useDepartments';

export function useEscapeClose(isOpen: boolean, onClose: () => void) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);
}

function getDepartmentErrorText(
  error: unknown,
  tErr: ReturnType<typeof useTranslations<'errors'>>
): string | null {
  const descriptor = describeDepartmentError(error);
  if (!descriptor) return null;
  return descriptor.key === 'departmentInUse' && descriptor.values
    ? tErr('departmentInUse', descriptor.values)
    : tErr(descriptor.key);
}

function DepartmentModalFrame({
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
          <button type="button" className="ui-icon-btn" aria-label={tCommon('close')} onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export interface DepartmentUpsertModalProps {
  mode: 'create' | 'rename';
  department?: DepartmentDto;
  isSubmitting: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (values: DepartmentUpsertRequestInput) => void;
}

export function DepartmentUpsertModal({
  mode,
  department,
  isSubmitting,
  error,
  onClose,
  onSubmit,
}: DepartmentUpsertModalProps) {
  const t = useTranslations('departmentsAdmin');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('errors');
  const inputId = useId();
  const { register, handleSubmit, formState: { errors } } = useForm<DepartmentUpsertRequestInput>({
    resolver: zodResolver(departmentUpsertRequestSchema),
    defaultValues: { name: department?.name ?? '' },
  });

  const serverError = getDepartmentErrorText(error, tErr);
  const titleText = mode === 'create' ? t('createModalTitle') : t('renameModalTitle');
  const submitText = mode === 'create' ? t('createSubmit') : t('renameSubmit');

  return (
    <DepartmentModalFrame title={titleText} onClose={onClose}>
      <form className="ui-modal-body" method="post" onSubmit={handleSubmit(onSubmit)} noValidate>
        {serverError ? <div className="ui-banner is-danger" role="alert"><div className="ui-banner-body"><span className="ui-banner-text">{serverError}</span></div></div> : null}
        <div className="ui-field">
          <label className="ui-label" htmlFor={inputId}>{t('nameLabel')}</label>
          <input id={inputId} className="ui-input" type="text" placeholder={t('namePlaceholder')} aria-invalid={Boolean(errors.name)} {...register('name')} />
          {errors.name ? <p className="ui-field-error" role="alert">{t('validationNameRequired')}</p> : null}
        </div>
        <div className="ui-modal-actions">
          <button type="button" className="ui-btn ghost" onClick={onClose} disabled={isSubmitting}>{tCommon('cancel')}</button>
          <button type="submit" className="ui-btn primary" disabled={isSubmitting}>{isSubmitting ? t('saving') : submitText}</button>
        </div>
      </form>
    </DepartmentModalFrame>
  );
}

export interface DepartmentDeleteModalProps {
  department: DepartmentDto;
  isDeleting: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: () => void;
}

export function DepartmentDeleteModal({
  department,
  isDeleting,
  error,
  onClose,
  onConfirm,
}: DepartmentDeleteModalProps) {
  const t = useTranslations('departmentsAdmin');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('errors');
  const serverError = getDepartmentErrorText(error, tErr);
  const hasUsage = department.memberCount > 0 || department.boardCount > 0;

  return (
    <DepartmentModalFrame title={t('deleteModalTitle')} onClose={onClose}>
      <div className="ui-modal-body">
        <p className="ui-modal-copy">{t('deleteConfirmPrompt', { name: department.name })}</p>
        {hasUsage ? (
          <div className="ui-banner is-warn" role="status">
            <div className="ui-banner-body">
              <span className="ui-banner-text">
                {t('deleteBlockedHint', { memberCount: department.memberCount, boardCount: department.boardCount })}
              </span>
            </div>
          </div>
        ) : null}
        {serverError ? <div className="ui-banner is-danger" role="alert"><div className="ui-banner-body"><span className="ui-banner-text">{serverError}</span></div></div> : null}
        <div className="ui-modal-actions">
          <button type="button" className="ui-btn ghost" onClick={onClose} disabled={isDeleting}>{tCommon('cancel')}</button>
          <button type="button" className="ui-btn danger" onClick={onConfirm} disabled={isDeleting}>{isDeleting ? t('deleting') : t('deleteConfirm')}</button>
        </div>
      </div>
    </DepartmentModalFrame>
  );
}

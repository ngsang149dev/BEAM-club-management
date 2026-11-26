'use client';

import type { ReactNode } from 'react';
import { useEffect, useId } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { z } from 'zod';
import { departmentNameSchema, uuidSchema } from '@/lib/members';
import { describeDepartmentError } from '../error-mapping';
import type {
  DepartmentDto,
  DepartmentLeadCandidate,
  DepartmentUpsertRequest,
} from '../hooks/useDepartments';

const departmentUpsertFormSchema = z.object({
  name: departmentNameSchema,
  leadUserId: z.union([z.literal(''), uuidSchema]),
});

export type DepartmentUpsertFormValues = z.infer<typeof departmentUpsertFormSchema>;

export interface LeadSelectOption {
  readonly id: string;
  readonly label: string;
}

export function buildLeadSelectOptions(
  candidates: readonly DepartmentLeadCandidate[],
  currentLead: DepartmentDto['lead'] | undefined,
  leftBadgeText: string
): LeadSelectOption[] {
  const options: LeadSelectOption[] = candidates.map((member) => ({
    id: member.id,
    label: member.isActive ? member.fullName : `${member.fullName} ${leftBadgeText}`,
  }));
  if (currentLead && !candidates.some((member) => member.id === currentLead.id)) {
    options.unshift({
      id: currentLead.id,
      label: currentLead.isActive
        ? currentLead.fullName
        : `${currentLead.fullName} ${leftBadgeText}`,
    });
  }
  return options;
}

export function buildDepartmentUpsertPayload(
  values: DepartmentUpsertFormValues,
  includeLeadUserId: boolean
): DepartmentUpsertRequest {
  const name = values.name.trim();
  if (!includeLeadUserId) {
    return { name };
  }
  const rawLead = values.leadUserId.trim();
  const normalizedLead = rawLead === '' ? null : rawLead;
  uuidSchema.nullable().parse(normalizedLead);
  return { name, leadUserId: normalizedLead };
}

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
  leadCandidates?: readonly DepartmentLeadCandidate[];
  showLeadSelector?: boolean;
  isSubmitting: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (values: DepartmentUpsertRequest) => void;
}

function DepartmentLeadSelectField({
  options,
  defaultValue,
  registration,
}: {
  options: readonly LeadSelectOption[];
  defaultValue: string;
  registration: ReturnType<ReturnType<typeof useForm<DepartmentUpsertFormValues>>['register']>;
}) {
  const t = useTranslations('departmentsAdmin');
  const selectId = useId();

  return (
    <div className="ui-field">
      <label className="ui-label" htmlFor={selectId}>{t('leadLabel')}</label>
      <select id={selectId} className="ui-select" defaultValue={defaultValue} {...registration}>
        <option value="">{t('leadUnassigned')}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>{option.label}</option>
        ))}
      </select>
    </div>
  );
}

function DepartmentErrorAlert({ error }: { error: unknown }) {
  const tErr = useTranslations('errors');
  const message = getDepartmentErrorText(error, tErr);
  if (!message) return null;

  return (
    <div className="ui-banner is-danger" role="alert">
      <div className="ui-banner-body">
        <span className="ui-banner-text">{message}</span>
      </div>
    </div>
  );
}

function getUpsertFormDefaults(department?: DepartmentDto): DepartmentUpsertFormValues {
  return {
    name: department?.name ?? '',
    leadUserId: department?.lead?.id ?? '',
  };
}

export function DepartmentUpsertModal({
  mode,
  department,
  leadCandidates = [],
  showLeadSelector = false,
  isSubmitting,
  error,
  onClose,
  onSubmit,
}: DepartmentUpsertModalProps) {
  const t = useTranslations('departmentsAdmin');
  const tCommon = useTranslations('common');
  const tMember = useTranslations('member');
  const inputId = useId();
  const defaults = getUpsertFormDefaults(department);
  const { register, handleSubmit, formState: { errors } } = useForm<DepartmentUpsertFormValues>({
    resolver: zodResolver(departmentUpsertFormSchema),
    defaultValues: defaults,
  });

  const isCreate = mode === 'create';
  const leadOptions = buildLeadSelectOptions(leadCandidates, department?.lead, tMember('leftBadge'));
  const submitLabel = isSubmitting ? t('saving') : t(isCreate ? 'createSubmit' : 'renameSubmit');

  return (
    <DepartmentModalFrame title={t(isCreate ? 'createModalTitle' : 'renameModalTitle')} onClose={onClose}>
      <form
        className="ui-modal-body"
        method="post"
        onSubmit={handleSubmit((values) => onSubmit(buildDepartmentUpsertPayload(values, showLeadSelector)))}
        noValidate
      >
        <DepartmentErrorAlert error={error} />
        <div className="ui-field">
          <label className="ui-label" htmlFor={inputId}>{t('nameLabel')}</label>
          <input id={inputId} className="ui-input" type="text" placeholder={t('namePlaceholder')} aria-invalid={Boolean(errors.name)} {...register('name')} />
          {errors.name ? <p className="ui-field-error" role="alert">{t('validationNameRequired')}</p> : null}
        </div>
        {showLeadSelector ? (
          <DepartmentLeadSelectField
            options={leadOptions}
            defaultValue={defaults.leadUserId}
            registration={register('leadUserId')}
          />
        ) : null}
        <div className="ui-modal-actions">
          <button type="button" className="ui-btn ghost" onClick={onClose} disabled={isSubmitting}>{tCommon('cancel')}</button>
          <button type="submit" className="ui-btn primary" disabled={isSubmitting}>{submitLabel}</button>
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

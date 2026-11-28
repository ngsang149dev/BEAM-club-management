'use client';

import type { ReactNode } from 'react';
import { useId } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useEscapeClose } from '@/features/shared/hooks/useEscapeClose';
import type { DepartmentDto } from '@/features/departments/hooks/useDepartments';
import { usePermissions } from '@/features/shared/permissions/can';
import { DEFAULT_ALLOWED_EMAIL_DOMAIN } from '@/lib/members';
import { isMemberDetail, type MemberListItem, type UpdateMemberRequest } from '../hooks/useMembers';
import { AvatarUploadControl } from './AvatarUploadControl';
import {
  buildValidatedUpdatePayload,
  createMemberWithDomainSchema,
  editMemberFormSchema,
  generateCompliantPassword,
  type CreateMemberValues,
  type EditMemberFormValues,
} from '../schemas';
import {
  DepartmentCheckboxGroup,
  InitialPasswordField,
  MemberLocaleSelect,
  ReadOnlyStudentIdField,
  formatMemberServerError,
} from './MemberFormFields';

function toggleIdSelection(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

function MemberDrawerShell({
  title,
  serverError,
  isSubmitting,
  submitLabel,
  onClose,
  onSubmit,
  children,
}: {
  title: string;
  serverError: string | null;
  isSubmitting: boolean;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
}) {
  const tCommon = useTranslations('common');
  const titleId = useId();
  useEscapeClose(true, onClose);

  return (
    <div className="ui-drawer-backdrop" role="presentation">
      <aside className="ui-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="ui-modal-header">
          <h2 id={titleId} className="ui-modal-title">{title}</h2>
          <button type="button" className="ui-icon-btn" aria-label={tCommon('close')} onClick={onClose}>
            ✕
          </button>
        </div>
        <form className="ui-drawer-body" method="post" onSubmit={onSubmit} noValidate>
          {serverError ? (
            <div className="ui-banner is-danger" role="alert">
              <div className="ui-banner-body">
                <span className="ui-banner-text">{serverError}</span>
              </div>
            </div>
          ) : null}
          {children}
          <div className="ui-modal-actions">
            <button type="button" className="ui-btn ghost" onClick={onClose} disabled={isSubmitting}>
              {tCommon('cancel')}
            </button>
            <button type="submit" className="ui-btn primary" disabled={isSubmitting}>
              {submitLabel}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function MemberFullNameAndEmailFields({
  baseId,
  fullNameRegistration,
  emailRegistration,
  fullNameError,
  emailError,
  emailPlaceholder,
}: {
  baseId: string;
  fullNameRegistration: React.InputHTMLAttributes<HTMLInputElement>;
  emailRegistration: React.InputHTMLAttributes<HTMLInputElement>;
  fullNameError?: boolean;
  emailError?: boolean;
  emailPlaceholder: string;
}) {
  const t = useTranslations('memberAdmin');

  return (
    <>
      <div className="ui-field">
        <label className="ui-label" htmlFor={`${baseId}-name`}>{t('fullNameLabel')}</label>
        <input id={`${baseId}-name`} className="ui-input" type="text" placeholder={t('fullNamePlaceholder')} aria-invalid={Boolean(fullNameError)} {...fullNameRegistration} />
        {fullNameError ? <p className="ui-field-error" role="alert">{t('validationFullName')}</p> : null}
      </div>
      <div className="ui-field">
        <label className="ui-label" htmlFor={`${baseId}-email`}>{t('emailLabel')}</label>
        <input id={`${baseId}-email`} className="ui-input" type="email" placeholder={emailPlaceholder} aria-invalid={Boolean(emailError)} {...emailRegistration} />
        <p className="ui-field-hint">{t('emailHint', { domain: DEFAULT_ALLOWED_EMAIL_DOMAIN })}</p>
        {emailError ? <p className="ui-field-error" role="alert">{t('validationEmailDomain', { domain: DEFAULT_ALLOWED_EMAIL_DOMAIN })}</p> : null}
      </div>
    </>
  );
}

export interface MemberCreateDrawerProps {
  departments: DepartmentDto[];
  isSubmitting: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (values: CreateMemberValues) => void;
}

const DEFAULT_CREATE_VALUES: CreateMemberValues = {
  fullName: '',
  studentId: '',
  email: '',
  departmentIds: [],
  locale: 'vi',
  initialPassword: '',
};

export function MemberCreateDrawer({
  departments,
  isSubmitting,
  error,
  onClose,
  onSubmit,
}: MemberCreateDrawerProps) {
  const t = useTranslations('memberAdmin');
  const tErr = useTranslations('errors');
  const baseId = useId();
  const { register, control, setValue, handleSubmit, formState: { errors } } =
    useForm<CreateMemberValues>({ resolver: zodResolver(createMemberWithDomainSchema), defaultValues: DEFAULT_CREATE_VALUES });

  const departmentIds = useWatch({ control, name: 'departmentIds' }) ?? [];
  const locale = useWatch({ control, name: 'locale' }) ?? 'vi';
  const handleGenerate = () =>
    setValue('initialPassword', generateCompliantPassword(), { shouldDirty: true, shouldValidate: true });

  return (
    <MemberDrawerShell
      title={t('createDrawerTitle')}
      serverError={formatMemberServerError(error, tErr)}
      isSubmitting={isSubmitting}
      submitLabel={isSubmitting ? t('creating') : t('createSubmit')}
      onClose={onClose}
      onSubmit={handleSubmit(onSubmit)}
    >
      <div className="ui-field">
        <label className="ui-label" htmlFor={`${baseId}-sid`}>{t('studentIdLabel')}</label>
        <input id={`${baseId}-sid`} className="ui-input mono" type="text" placeholder={t('studentIdPlaceholder')} aria-invalid={Boolean(errors.studentId)} {...register('studentId')} />
        <p className="ui-field-hint">{t('studentIdHint')}</p>
        {errors.studentId ? <p className="ui-field-error" role="alert">{t('validationStudentId')}</p> : null}
      </div>
      <MemberFullNameAndEmailFields
        baseId={baseId}
        fullNameRegistration={register('fullName')}
        emailRegistration={register('email')}
        fullNameError={Boolean(errors.fullName)}
        emailError={Boolean(errors.email)}
        emailPlaceholder={t('emailPlaceholder')}
      />
      <InitialPasswordField registration={register('initialPassword')} hasError={Boolean(errors.initialPassword)} disabled={isSubmitting} onGenerate={handleGenerate} />
      <DepartmentCheckboxGroup departments={departments} selectedIds={departmentIds} onToggle={(id) => setValue('departmentIds', toggleIdSelection(departmentIds, id), { shouldDirty: true })} />
      <MemberLocaleSelect value={locale} onChange={(next) => setValue('locale', next === 'en' ? 'en' : 'vi', { shouldDirty: true })} />
    </MemberDrawerShell>
  );
}

export interface MemberEditDrawerProps {
  member: MemberListItem;
  canViewDetail: boolean;
  departments: DepartmentDto[];
  isSubmitting: boolean;
  error: unknown;
  avatarBusy?: boolean;
  avatarError?: unknown;
  onUploadAvatar?: (dataUrl: string) => Promise<unknown> | void;
  onRemoveAvatar?: () => Promise<unknown> | void;
  onClearAvatarError?: () => void;
  onClose: () => void;
  onSubmit: (payload: UpdateMemberRequest) => void;
}

const NOOP_AVATAR = () => undefined;

function MemberEditAvatarSection(props: {
  member: MemberListItem;
  isSubmitting: boolean;
  avatarBusy?: boolean;
  avatarError?: unknown;
  onUploadAvatar?: (dataUrl: string) => Promise<unknown> | void;
  onRemoveAvatar?: () => Promise<unknown> | void;
  onClearAvatarError?: () => void;
}) {
  const t = useTranslations('memberAdmin');
  const { isAdmin, can } = usePermissions();
  if (!isAdmin && !can('member.update')) {
    return null;
  }
  return (
    <AvatarUploadControl
      memberId={props.member.id}
      fullName={props.member.fullName}
      avatarUrl={props.member.avatarUrl}
      isActive={props.member.isActive}
      isBusy={props.avatarBusy}
      serverError={props.avatarError}
      disabled={props.isSubmitting}
      label={t('memberAvatarTitle')}
      onUpload={props.onUploadAvatar ?? NOOP_AVATAR}
      onRemove={props.onRemoveAvatar ?? NOOP_AVATAR}
      onClearError={props.onClearAvatarError}
    />
  );
}

function buildEditDefaults(member: MemberListItem, canViewDetail: boolean) {
  const detail = canViewDetail && isMemberDetail(member) ? member : null;
  return {
    detail,
    defaultValues: {
      fullName: member.fullName,
      email: detail?.email ?? '',
      departmentIds: member.departments.map((dept) => dept.id),
      locale: detail?.locale ?? ('' as const),
    },
  };
}

export function MemberEditDrawer(props: MemberEditDrawerProps) {
  const t = useTranslations('memberAdmin');
  const tErr = useTranslations('errors');
  const baseId = useId();
  const { detail, defaultValues } = buildEditDefaults(props.member, props.canViewDetail);
  const { register, control, setValue, setError, handleSubmit, formState: { errors } } =
    useForm<EditMemberFormValues>({ resolver: zodResolver(editMemberFormSchema), defaultValues });

  const departmentIds = useWatch({ control, name: 'departmentIds' });
  const locale = useWatch({ control, name: 'locale' });

  const handleValidEdit = (values: EditMemberFormValues) => {
    const validated = buildValidatedUpdatePayload(values, Boolean(detail));
    if (!validated.ok) {
      setError(validated.field, { message: validated.issue });
      return;
    }
    props.onSubmit(validated.payload);
  };

  return (
    <MemberDrawerShell
      title={t('editDrawerTitle')}
      serverError={formatMemberServerError(props.error, tErr)}
      isSubmitting={props.isSubmitting}
      submitLabel={props.isSubmitting ? t('updating') : t('updateSubmit')}
      onClose={props.onClose}
      onSubmit={handleSubmit(handleValidEdit)}
    >
      <MemberEditAvatarSection
        member={props.member}
        isSubmitting={props.isSubmitting}
        avatarBusy={props.avatarBusy}
        avatarError={props.avatarError}
        onUploadAvatar={props.onUploadAvatar}
        onRemoveAvatar={props.onRemoveAvatar}
        onClearAvatarError={props.onClearAvatarError}
      />
      <ReadOnlyStudentIdField studentId={detail?.studentId ?? null} />
      <MemberFullNameAndEmailFields
        baseId={baseId}
        fullNameRegistration={register('fullName')}
        emailRegistration={register('email')}
        fullNameError={Boolean(errors.fullName)}
        emailError={Boolean(errors.email)}
        emailPlaceholder={
          detail ? t('emailPlaceholder') : t('emailPlaceholderMasked', { domain: DEFAULT_ALLOWED_EMAIL_DOMAIN })
        }
      />
      <DepartmentCheckboxGroup departments={props.departments} selectedIds={departmentIds} onToggle={(id) => setValue('departmentIds', toggleIdSelection(departmentIds, id), { shouldDirty: true })} />
      <MemberLocaleSelect value={locale} allowKeepCurrent={!detail} onChange={(next) => setValue('locale', next, { shouldDirty: true })} />
    </MemberDrawerShell>
  );
}

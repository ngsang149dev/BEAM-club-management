'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import type { DepartmentDto } from '@/features/departments/hooks/useDepartments';
import { describeMemberError } from '../error-mapping';

export function formatMemberServerError(
  error: unknown,
  tErr: ReturnType<typeof useTranslations<'errors'>>
): string | null {
  const descriptor = describeMemberError(error);
  if (!descriptor) {
    return null;
  }
  return descriptor.key === 'invalidEmailDomain' && descriptor.values
    ? tErr('invalidEmailDomain', descriptor.values)
    : tErr(descriptor.key);
}

export function DepartmentCheckboxGroup({
  departments,
  selectedIds,
  onToggle,
}: {
  departments: DepartmentDto[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  const t = useTranslations('memberAdmin');
  const labelId = useId();

  return (
    <fieldset className="ui-fieldset" aria-labelledby={labelId}>
      <legend id={labelId} className="ui-label">{t('departmentsLabel')}</legend>
      {departments.length === 0 ? (
        <p className="ui-field-hint">{t('departmentsEmpty')}</p>
      ) : (
        <div className="dept-checkbox-grid">
          {departments.map((dept) => {
            const checked = selectedIds.includes(dept.id);
            return (
              <label key={dept.id} className={checked ? 'dept-check-item is-checked' : 'dept-check-item'}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(dept.id)}
                />
                <span>{dept.name}</span>
              </label>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

export function MemberLocaleSelect({
  value,
  allowKeepCurrent = false,
  onChange,
}: {
  value: '' | 'vi' | 'en';
  allowKeepCurrent?: boolean;
  onChange: (next: '' | 'vi' | 'en') => void;
}) {
  const t = useTranslations('memberAdmin');
  const id = useId();

  const handleChange = (raw: string) => {
    if (raw === 'en' || raw === 'vi') {
      onChange(raw);
      return;
    }
    onChange(allowKeepCurrent ? '' : 'vi');
  };

  return (
    <div className="ui-field">
      <label className="ui-label" htmlFor={id}>{t('localeLabel')}</label>
      <select id={id} className="ui-select" value={value} onChange={(event) => handleChange(event.target.value)}>
        {allowKeepCurrent ? <option value="">{t('localeKeepCurrent')}</option> : null}
        <option value="vi">{t('localeVi')}</option>
        <option value="en">{t('localeEn')}</option>
      </select>
    </div>
  );
}

export function ReadOnlyStudentIdField({ studentId }: { studentId: string | null }) {
  const t = useTranslations('memberAdmin');
  const id = useId();

  if (studentId === null) {
    return (
      <div className="ui-field">
        <span className="ui-label">{t('studentIdLabel')}</span>
        <p className="ui-field-hint">{t('studentIdHiddenNotice')}</p>
      </div>
    );
  }

  return (
    <div className="ui-field">
      <label className="ui-label" htmlFor={id}>{t('studentIdLabel')}</label>
      <input id={id} className="ui-input mono" type="text" value={studentId} readOnly disabled />
      <p className="ui-field-hint">{t('studentIdHint')}</p>
    </div>
  );
}

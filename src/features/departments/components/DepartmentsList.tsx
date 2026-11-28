'use client';

import { useTranslations } from 'next-intl';
import type { DepartmentDto } from '../hooks/useDepartments';

function DepartmentLeadBadge({ lead }: { lead: DepartmentDto['lead'] }) {
  const t = useTranslations('departmentsAdmin');
  const tMember = useTranslations('member');

  if (!lead) {
    return <span className="ui-chip dept-lead-chip is-unassigned">{t('leadUnassignedBadge')}</span>;
  }
  return (
    <span className={lead.isActive ? 'ui-chip dept-lead-chip' : 'ui-chip dept-lead-chip is-inactive'}>
      {t('leadBadge', { name: lead.fullName })}
      {!lead.isActive ? <span className="member-left-badge"> {tMember('leftBadge')}</span> : null}
    </span>
  );
}

function DepartmentRow({
  department,
  onRename,
  onDelete,
}: {
  department: DepartmentDto;
  onRename: (dept: DepartmentDto) => void;
  onDelete: (dept: DepartmentDto) => void;
}) {
  const t = useTranslations('departmentsAdmin');

  return (
    <li className="dept-row">
      <div className="dept-row-main">
        <span className="dept-row-name">{department.name}</span>
        <div className="dept-row-badges">
          <DepartmentLeadBadge lead={department.lead} />
          <span className="ui-chip">{t('memberCountBadge', { count: department.memberCount })}</span>
        </div>
      </div>
      <div className="dept-row-actions">
        <button type="button" className="ui-btn ghost is-sm" onClick={() => onRename(department)}>
          {t('renameAction')}
        </button>
        <button type="button" className="ui-btn danger is-sm" onClick={() => onDelete(department)}>
          {t('deleteAction')}
        </button>
      </div>
    </li>
  );
}

function DepartmentSection({
  title,
  departments,
  emptyText,
  onRename,
  onDelete,
}: {
  title: string;
  departments: DepartmentDto[];
  emptyText: string;
  onRename: (dept: DepartmentDto) => void;
  onDelete: (dept: DepartmentDto) => void;
}) {
  return (
    <section className="admin-card">
      <div className="admin-card-header">
        <div>
          <h2 className="admin-card-title">{title}</h2>
        </div>
        <span className="ui-chip">{departments.length}</span>
      </div>
      {departments.length === 0 ? (
        <p className="admin-empty-inline">{emptyText}</p>
      ) : (
        <ul className="dept-list">
          {departments.map((department) => (
            <DepartmentRow
              key={department.id}
              department={department}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export function DepartmentsLoadedList({
  departments,
  onRename,
  onDelete,
}: {
  departments: DepartmentDto[];
  onRename: (dept: DepartmentDto) => void;
  onDelete: (dept: DepartmentDto) => void;
}) {
  const t = useTranslations('departmentsAdmin');

  if (departments.length === 0) {
    return (
      <div className="admin-card admin-empty-box">
        <h2 className="admin-card-title">{t('emptyListTitle')}</h2>
        <p className="admin-card-hint">{t('emptyListDescription')}</p>
      </div>
    );
  }

  const inUse = departments.filter((dept) => dept.memberCount > 0 || dept.boardCount > 0);
  const unused = departments.filter((dept) => dept.memberCount === 0 && dept.boardCount === 0);

  return (
    <div className="admin-sections-stack">
      <DepartmentSection
        title={t('inUseSectionTitle')}
        departments={inUse}
        emptyText={t('emptySectionText')}
        onRename={onRename}
        onDelete={onDelete}
      />
      <DepartmentSection
        title={t('unusedSectionTitle')}
        departments={unused}
        emptyText={t('emptySectionText')}
        onRename={onRename}
        onDelete={onDelete}
      />
    </div>
  );
}

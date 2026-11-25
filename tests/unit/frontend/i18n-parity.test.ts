import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '@/lib/permissions';

type MessageTree = { [key: string]: string | MessageTree };

function loadMessages(locale: 'vi' | 'en'): MessageTree {
  const filePath = path.resolve(process.cwd(), 'messages', `${locale}.json`);
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw) as MessageTree;
}

function collectLeafEntries(node: MessageTree, prefix = ''): Map<string, string> {
  const entries = new Map<string, string>();
  for (const [key, value] of Object.entries(node)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      entries.set(fullKey, value);
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const [nestedKey, nestedValue] of collectLeafEntries(value, fullKey)) {
        entries.set(nestedKey, nestedValue);
      }
    } else {
      throw new Error(`Invalid i18n value type at key "${fullKey}"`);
    }
  }
  return entries;
}

describe('i18n message dictionaries (vi/en)', () => {
  it('maintains recursive key parity between vi.json and en.json', () => {
    const viEntries = collectLeafEntries(loadMessages('vi'));
    const enEntries = collectLeafEntries(loadMessages('en'));

    const viKeys = [...viEntries.keys()].sort();
    const enKeys = [...enEntries.keys()].sort();

    expect(enKeys).toEqual(viKeys);
  });

  it('contains no empty or whitespace-only string values', () => {
    for (const locale of ['vi', 'en'] as const) {
      const entries = collectLeafEntries(loadMessages(locale));
      for (const [key, value] of entries) {
        expect(value.trim().length, `${locale}:${key} must be non-empty`).toBeGreaterThan(0);
      }
    }
  });

  it('includes all required E1-03 foundation namespaces and tokens', () => {
    const viEntries = collectLeafEntries(loadMessages('vi'));
    const enEntries = collectLeafEntries(loadMessages('en'));

    const requiredKeys = [
      'app.name',
      'app.title',
      'nav.boards',
      'nav.myTasks',
      'nav.members',
      'nav.profile',
      'nav.memberAdmin',
      'nav.permissions',
      'nav.departments',
      'nav.reminders',
      'nav.auditLog',
      'nav.archive',
      'nav.drawerAriaLabel',
      'common.loading',
      'common.retry',
      'common.cancel',
      'common.save',
      'common.close',
      'common.backToBoards',
      'common.goHome',
      'common.signInAgain',
      'common.undo',
      'priority.low',
      'priority.medium',
      'priority.high',
      'priority.urgent',
      'member.leftBadge',
      'language.vi',
      'language.en',
      'home.title',
      'errors.requestIdLabel',
      'errors.validation',
      'errors.401.title',
      'errors.403.title',
      'errors.404.title',
      'errors.409.title',
      'errors.429.title',
      'errors.500.title',
      'errors.offline.title',
      'errors.sessionExpired.title',
    ];

    for (const key of requiredKeys) {
      expect(viEntries.has(key), `Missing vi key: ${key}`).toBe(true);
      expect(enEntries.has(key), `Missing en key: ${key}`).toBe(true);
    }

    expect(viEntries.get('member.leftBadge')).toBe('(đã rời)');
    expect(enEntries.get('member.leftBadge')).toBe('(left)');
  });

  it('includes auth, profile, and all 18 permission catalog keys in both locales', () => {
    const viEntries = collectLeafEntries(loadMessages('vi'));
    const enEntries = collectLeafEntries(loadMessages('en'));

    const authAndProfileKeys = [
      'auth.title',
      'auth.subtitle',
      'auth.studentIdLabel',
      'auth.studentIdPlaceholder',
      'auth.passwordLabel',
      'auth.passwordPlaceholder',
      'auth.showPassword',
      'auth.hidePassword',
      'auth.devSeedHint',
      'auth.rememberLabel',
      'auth.signInButton',
      'auth.signingIn',
      'auth.invalidCredentials',
      'auth.rateLimited',
      'auth.sessionExpiredTitle',
      'auth.sessionExpiredBody',
      'auth.networkError',
      'profile.title',
      'profile.contactTitle',
      'profile.studentIdLabel',
      'profile.emailLabel',
      'profile.departmentsTitle',
      'profile.permissionsTitle',
      'profile.adminAllPermissions',
      'profile.sessionTitle',
      'profile.rememberLabel',
      'profile.rememberOn',
      'profile.rememberOff',
      'profile.expiresAtLabel',
      'profile.signOutButton',
      'profile.signingOut',
      'profile.languageSaveError',
      'profile.changePasswordTitle',
      'profile.forceChangePasswordTitle',
      'profile.currentPasswordLabel',
      'profile.newPasswordLabel',
      'profile.confirmPasswordLabel',
      'profile.changePasswordButton',
      'errors.invalidCurrentPassword',
      'errors.initialPasswordRequired',
      'memberAdmin.initialPasswordLabel',
      'memberAdmin.generatePasswordButton',
      'memberAdmin.resetPasswordAction',
      'memberAdmin.resetPasswordModalTitle',
      'auditLogs.actions.memberPasswordReset',
    ];

    for (const key of authAndProfileKeys) {
      expect(viEntries.has(key), `Missing vi key: ${key}`).toBe(true);
      expect(enEntries.has(key), `Missing en key: ${key}`).toBe(true);
    }

    expect(PERMISSIONS).toHaveLength(18);
    for (const perm of PERMISSIONS) {
      expect(viEntries.has(perm.descriptionKey), `Missing vi key: ${perm.descriptionKey}`).toBe(true);
      expect(enEntries.has(perm.descriptionKey), `Missing en key: ${perm.descriptionKey}`).toBe(true);
    }
  });

  it('includes members, memberAdmin, departmentsAdmin, and E3 error keys in both locales', () => {
    const viEntries = collectLeafEntries(loadMessages('vi'));
    const enEntries = collectLeafEntries(loadMessages('en'));

    const e3Keys = [
      'errors.invalidEmailDomain',
      'errors.studentIdExists',
      'errors.emailExists',
      'errors.lastActiveAdmin',
      'errors.invalidDepartmentIds',
      'errors.studentIdImmutable',
      'errors.invalidCursor',
      'errors.departmentNameExists',
      'errors.departmentInUse',
      'members.title',
      'members.searchPlaceholder',
      'members.departmentFilterLabel',
      'members.statusActive',
      'members.statusInactive',
      'members.statusAll',
      'members.colStudentId',
      'members.colEmail',
      'members.loadMore',
      'members.emptyTitle',
      'memberAdmin.title',
      'memberAdmin.addMember',
      'memberAdmin.studentIdHint',
      'memberAdmin.emailHint',
      'memberAdmin.deactivateModalTitle',
      'memberAdmin.deactivateModalBody',
      'memberAdmin.cannotListWithoutViewTitle',
      'departmentsAdmin.title',
      'departmentsAdmin.addDepartment',
      'departmentsAdmin.inUseSectionTitle',
      'departmentsAdmin.unusedSectionTitle',
      'departmentsAdmin.deleteModalTitle',
      'departmentsAdmin.deleteBlockedHint',
      'errors.invalidImageFormat',
      'errors.imageTooLarge',
      'media.uploadPhoto',
      'media.changePhoto',
      'media.removePhoto',
      'media.avatarHint',
      'branding.modalTitle',
      'branding.uploadButton',
      'branding.restoreDefaultButton',
      'profile.avatarUpdatedToast',
      'profile.avatarRemovedToast',
      'memberAdmin.clubLogoButton',
      'memberAdmin.memberAvatarTitle',
      'auditLogs.actions.memberAvatarUpdated',
      'auditLogs.actions.memberAvatarRemoved',
      'auditLogs.actions.brandingLogoUpdated',
      'auditLogs.actions.brandingLogoRemoved',
      'auditLogs.detailLabels.assetKey',
      'auditLogs.detailLabels.mimeType',
      'auditLogs.detailLabels.byteLength',
      'auditLogs.detailLabels.removed',
      'auditLogs.detailLabels.forceChangeOnLogin',
      'auditLogs.detailLabels.sessionsRevoked',
      'auditLogs.detailValues.yes',
      'auditLogs.detailValues.no',
      'errors.cannotRevokeOwnAdmin',
      'permissionsAdmin.cannotRevokeSelfHint',
      'memberAdmin.rowActionsMenu',
      'errors.boardArchived',
      'errors.boardHasNoColumns',
      'errors.taskNotDeleted',
      'errors.memberAlreadyActive',
      'errors.boardNotArchived',
      'errors.entityNotArchived',
      'archive.title',
      'archive.tabs.tasks',
      'archive.tabs.members',
      'archive.tabs.boards',
      'archive.retentionTitle',
      'archive.purgeModalTitle',
      'auditLogs.actions.archiveMemberRestored',
      'auditLogs.actions.archiveBoardRestored',
      'auditLogs.actions.archiveTaskPurged',
      'auditLogs.actions.archiveBoardPurged',
      'auditLogs.actions.archiveMemberPurged',
      'auditLogs.actions.archiveRetentionUpdated',
      'auditLogs.detailLabels.retentionDays',
      'auditLogs.detailLabels.previousRetentionDays',
      'auditLogs.detailLabels.purgeMode',
      'auditLogs.detailLabels.cascadedTasks',
      'auditLogs.detailLabels.taskId',
      'auditLogs.detailLabels.boardId',
      'auditLogs.detailLabels.purgedMemberId',
      'tasks.departmentsLabel',
      'tasks.assignedDepartmentsLabel',
      'tasks.departmentsEmpty',
      'tasks.notifySectionTitle',
      'tasks.notifyInAppLabel',
      'tasks.notifyEmailLabel',
      'tasks.individualAssigneesSummary',
      'tasks.saveAssignments',
      'tasks.savingAssignees',
      'tasks.departmentsUpdatedToast',
      'myTasks.departmentFilterLabel',
      'myTasks.allDepartments',
      'notifications.bellAriaLabel',
      'notifications.unreadBadgeTitle',
      'notifications.heading',
      'notifications.markAllRead',
      'notifications.taskDepartmentAssigned',
      'notifications.taskAssigned',
      'notifications.hiddenTaskDepartmentAssigned',
      'notifications.hiddenTaskAssigned',
    ];

    for (const key of e3Keys) {
      expect(viEntries.has(key), `Missing vi key: ${key}`).toBe(true);
      expect(enEntries.has(key), `Missing en key: ${key}`).toBe(true);
    }
  });

  it('maintains identical ICU placeholder variables between vi.json and en.json', () => {
    const extractIcuVariables = (message: string): string[] => {
      const names = new Set<string>();
      for (const match of message.matchAll(/\{([a-zA-Z0-9_]+)\}/g)) {
        const varName = match[1];
        if (varName) names.add(varName);
      }
      return [...names].sort();
    };

    const viEntries = collectLeafEntries(loadMessages('vi'));
    const enEntries = collectLeafEntries(loadMessages('en'));

    for (const [key, viValue] of viEntries) {
      const enValue = enEntries.get(key) ?? '';
      expect(extractIcuVariables(enValue), `ICU placeholder mismatch at key "${key}"`).toEqual(
        extractIcuVariables(viValue)
      );
    }
  });
});

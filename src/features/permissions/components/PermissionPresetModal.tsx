'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { useEscapeClose } from '@/features/shared/hooks/useEscapeClose';
import type { PermissionCode } from '@/features/shared/permissions/can';
import { computePermissionDiff, type PermissionPresetCode } from '@/lib/permissions';
import { describePermissionsError, type PermissionsErrorDescriptor } from '../error-mapping';

export interface PresetOption {
  readonly code: PermissionPresetCode;
  readonly permissionCodes: readonly PermissionCode[];
}

export interface PermissionPresetModalProps {
  preset: PresetOption;
  currentPermissions: readonly PermissionCode[];
  isApplying: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: () => void;
}

function PresetErrorBanner({ descriptor }: { descriptor: PermissionsErrorDescriptor | null }) {
  const tErr = useTranslations('errors');
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

export function PermissionPresetModal({
  preset,
  currentPermissions,
  isApplying,
  error,
  onClose,
  onConfirm,
}: PermissionPresetModalProps) {
  const t = useTranslations('permissionsAdmin');
  const tPerm = useTranslations('permissions');
  const tCommon = useTranslations('common');
  const titleId = useId();

  useEscapeClose(true, onClose);

  const presetName = tPerm(`presets.${preset.code}`);
  const diff = computePermissionDiff(currentPermissions, preset.permissionCodes);

  return (
    <div className="ui-modal-backdrop" role="presentation">
      <div className="ui-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="ui-modal-header">
          <h2 id={titleId} className="ui-modal-title">{t('presetModalTitle', { name: presetName })}</h2>
          <button type="button" className="ui-icon-btn" aria-label={tCommon('close')} onClick={onClose}>✕</button>
        </div>
        <div className="ui-modal-body">
          <p className="ui-modal-copy">{t('presetModalBody', { name: presetName, total: preset.permissionCodes.length })}</p>
          <div className="preset-diff">
            <span><b>{t('presetAddsLabel')}</b> +{diff.added.length}</span>
            <span><b>{t('presetRemovesLabel')}</b> -{diff.removed.length}</span>
          </div>
          <PresetErrorBanner descriptor={describePermissionsError(error)} />
          <div className="ui-modal-actions">
            <button type="button" className="ui-btn ghost" onClick={onClose} disabled={isApplying}>{tCommon('cancel')}</button>
            <button type="button" className="ui-btn primary" onClick={onConfirm} disabled={isApplying}>
              {isApplying ? t('presetApplying') : t('presetConfirmButton')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

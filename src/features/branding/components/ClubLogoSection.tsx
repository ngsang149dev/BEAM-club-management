'use client';

import { useTranslations } from 'next-intl';
import { ClubLogo } from '@/components/ClubLogo';
import {
  BRAND_ASSET_FILE_ACCEPT,
  LOGO_IMAGE_COMPRESSION_OPTIONS,
} from '@/features/shared/image-compress';
import {
  useBrandingQuery,
  useRemoveClubLogoMutation,
  useUpdateClubLogoMutation,
} from '../hooks/useBranding';
import { BrandAssetSection, useBrandAssetActions } from './BrandAssetEditor';

export function ClubLogoSection() {
  const t = useTranslations('branding');
  const brandingQuery = useBrandingQuery(true);
  const updateMutation = useUpdateClubLogoMutation();
  const removeMutation = useRemoveClubLogoMutation();
  const logoUrl = brandingQuery.data?.logoUrl ?? null;
  const hasCustomLogo = Boolean(logoUrl);

  const actions = useBrandAssetActions({
    compressionOptions: LOGO_IMAGE_COMPRESSION_OPTIONS,
    onUpload: (payload) => updateMutation.mutateAsync(payload),
    onRemove: () => removeMutation.mutateAsync(),
    resetMutations: () => {
      updateMutation.reset();
      removeMutation.reset();
    },
    updatedToast: t('updatedToast'),
    removedToast: t('removedToast'),
    mutationError: updateMutation.error ?? removeMutation.error,
    isMutating: updateMutation.isPending,
    isRemoving: removeMutation.isPending,
  });

  const uploadLabel = actions.isUploading
    ? t('uploading')
    : hasCustomLogo
      ? t('replaceButton')
      : t('uploadButton');

  return (
    <BrandAssetSection
      sectionId="club-logo-section-title"
      title={t('modalTitle')}
      subtitle={t('modalSubtitle')}
      hasCustomAsset={hasCustomLogo}
      activeStatusLabel={t('customLogoActive')}
      defaultStatusLabel={t('defaultBadgeActive')}
      uploadHint={t('uploadHint')}
      uploadLabel={uploadLabel}
      accept={BRAND_ASSET_FILE_ACCEPT}
      isRemoving={actions.isRemoving}
      isBusy={actions.isBusy}
      errorKey={actions.errorKey}
      preview={<ClubLogo logoUrl={logoUrl} alt={t('logoAlt')} size="lg" />}
      onFileChange={(event) => void actions.handleFileChange(event)}
      onRestoreDefault={() => void actions.handleRestoreDefault()}
    />
  );
}

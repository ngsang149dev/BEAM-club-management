'use client';

import { useTranslations } from 'next-intl';
import { ClubLogo } from '@/components/ClubLogo';
import { ClubWordmark } from '@/components/ClubWordmark';
import {
  BRAND_ASSET_FILE_ACCEPT,
  WORDMARK_IMAGE_COMPRESSION_OPTIONS,
} from '@/features/shared/image-compress';
import {
  useBrandingQuery,
  useRemoveClubWordmarkMutation,
  useUpdateClubWordmarkMutation,
} from '../hooks/useBranding';
import { BrandAssetSection, useBrandAssetActions } from './BrandAssetEditor';

export function ClubWordmarkSection() {
  const t = useTranslations('branding');
  const brandingQuery = useBrandingQuery(true);
  const updateMutation = useUpdateClubWordmarkMutation();
  const removeMutation = useRemoveClubWordmarkMutation();
  const logoUrl = brandingQuery.data?.logoUrl ?? null;
  const wordmarkUrl = brandingQuery.data?.wordmarkUrl ?? null;
  const hasCustomWordmark = Boolean(wordmarkUrl);

  const actions = useBrandAssetActions({
    compressionOptions: WORDMARK_IMAGE_COMPRESSION_OPTIONS,
    onUpload: (payload) => updateMutation.mutateAsync(payload),
    onRemove: () => removeMutation.mutateAsync(),
    resetMutations: () => {
      updateMutation.reset();
      removeMutation.reset();
    },
    updatedToast: t('wordmarkUpdatedToast'),
    removedToast: t('wordmarkRemovedToast'),
    mutationError: updateMutation.error ?? removeMutation.error,
    isMutating: updateMutation.isPending,
    isRemoving: removeMutation.isPending,
  });

  const uploadLabel = actions.isUploading
    ? t('uploading')
    : hasCustomWordmark
      ? t('wordmarkReplaceButton')
      : t('wordmarkUploadButton');

  return (
    <BrandAssetSection
      sectionId="club-wordmark-section-title"
      title={t('wordmarkTitle')}
      subtitle={t('wordmarkSubtitle')}
      hasCustomAsset={hasCustomWordmark}
      activeStatusLabel={t('customWordmarkActive')}
      defaultStatusLabel={t('defaultWordmarkActive')}
      uploadHint={t('wordmarkUploadHint')}
      uploadLabel={uploadLabel}
      accept={BRAND_ASSET_FILE_ACCEPT}
      isRemoving={actions.isRemoving}
      isBusy={actions.isBusy}
      errorKey={actions.errorKey}
      preview={
        <div className="club-wordmark-preview-stage">
          <ClubLogo logoUrl={logoUrl} alt="" />
          <ClubWordmark wordmarkUrl={wordmarkUrl} className="app-brand-text" />
        </div>
      }
      onFileChange={(event) => void actions.handleFileChange(event)}
      onRestoreDefault={() => void actions.handleRestoreDefault()}
    />
  );
}

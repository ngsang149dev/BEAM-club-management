'use client';

import { createElement, useId, useRef, useState, type ChangeEvent } from 'react';
import { useForm, type UseFormRegister, type FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { z } from 'zod';
import { useEscapeClose } from '@/features/shared/hooks/useEscapeClose';
import {
  compressImageFileToDataUrl,
  GALLERY_IMAGE_COMPRESSION_OPTIONS,
  IMAGE_FILE_ACCEPT,
  isImageCompressError,
} from '@/features/shared/image-compress';
import {
  galleryTitleSchema,
  LOGIN_GALLERY_CAPTION_MAX,
  LOGIN_GALLERY_TITLE_MAX,
} from '@/lib/media';
import { describeBrandingError, type BrandingErrorKey } from '../error-mapping';
import type {
  CreateLoginGalleryItemRequest,
  LoginGalleryItemDto,
  UpdateLoginGalleryItemRequest,
} from '../hooks/useBranding';

const galleryItemFormSchema = z.object({
  title: galleryTitleSchema,
  caption: z.string().trim().max(LOGIN_GALLERY_CAPTION_MAX),
});

type GalleryItemFormValues = z.infer<typeof galleryItemFormSchema>;

function useGalleryImagePicker(onClearApiError?: () => void) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [compressError, setCompressError] = useState<unknown>(null);
  const [imageRequiredError, setImageRequiredError] = useState(false);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    onClearApiError?.();
    setCompressError(null);
    setImageRequiredError(false);
    setIsCompressing(true);
    try {
      setDataUrl(await compressImageFileToDataUrl(file, GALLERY_IMAGE_COMPRESSION_OPTIONS));
    } catch (err) {
      if (isImageCompressError(err)) setCompressError(err);
    } finally {
      setIsCompressing(false);
    }
  };

  return { dataUrl, isCompressing, compressError, imageRequiredError, setImageRequiredError, handleFileChange };
}

function GalleryImagePreviewBox({
  previewSrc,
  title,
  isBusy,
  onPickClick,
}: {
  previewSrc: string | null;
  title: string;
  isBusy: boolean;
  onPickClick: () => void;
}) {
  const t = useTranslations('branding.gallery');
  return (
    <div className="gallery-modal-upload-row">
      <div className="gallery-modal-preview">
        {previewSrc
          ? createElement('img', { src: previewSrc, alt: title || t('previewAlt'), className: 'gallery-modal-preview-img' })
          : <span className="gallery-modal-preview-empty">{t('noImageSelected')}</span>}
      </div>
      <div className="gallery-modal-upload-meta">
        <button type="button" className="ui-btn secondary is-sm" disabled={isBusy} onClick={onPickClick}>
          {previewSrc ? t('replaceImageButton') : t('selectImageButton')}
        </button>
        <p className="ui-field-hint">{t('imageHint')}</p>
      </div>
    </div>
  );
}

function GalleryModalErrorBanner({ errorKey, imageRequiredError }: { errorKey: BrandingErrorKey | null; imageRequiredError: boolean }) {
  const t = useTranslations('branding.gallery');
  const tErr = useTranslations('errors');
  const message = imageRequiredError ? t('validationImageRequired') : errorKey ? tErr(errorKey) : null;
  if (!message) return null;
  return (
    <div className="ui-banner is-danger" role="alert">
      <div className="ui-banner-body"><span className="ui-banner-text">{message}</span></div>
    </div>
  );
}

function GalleryTextFields({
  register,
  errors,
  isBusy,
}: {
  register: UseFormRegister<GalleryItemFormValues>;
  errors: FieldErrors<GalleryItemFormValues>;
  isBusy: boolean;
}) {
  const t = useTranslations('branding.gallery');
  const titleInputId = useId();
  const captionInputId = useId();

  return (
    <>
      <div className="ui-field">
        <label className="ui-label" htmlFor={titleInputId}>{t('titleLabel')}</label>
        <input id={titleInputId} className="ui-input" maxLength={LOGIN_GALLERY_TITLE_MAX} placeholder={t('titlePlaceholder')} disabled={isBusy} {...register('title')} />
        {errors.title ? <p className="ui-field-error">{t('validationTitle')}</p> : null}
      </div>
      <div className="ui-field">
        <label className="ui-label" htmlFor={captionInputId}>{t('captionLabel')}</label>
        <textarea id={captionInputId} className="ui-textarea" rows={2} maxLength={LOGIN_GALLERY_CAPTION_MAX} placeholder={t('captionPlaceholder')} disabled={isBusy} {...register('caption')} />
        {errors.caption ? <p className="ui-field-error">{t('validationCaption')}</p> : null}
      </div>
    </>
  );
}

function submitGalleryModalForm(params: {
  mode: 'create' | 'edit';
  item?: LoginGalleryItemDto;
  values: GalleryItemFormValues;
  picker: ReturnType<typeof useGalleryImagePicker>;
  onCreate: (payload: CreateLoginGalleryItemRequest) => Promise<void>;
  onEdit: (id: string, payload: UpdateLoginGalleryItemRequest) => Promise<void>;
}): Promise<void> {
  const caption = params.values.caption.trim() || null;
  const title = params.values.title.trim();
  if (params.mode === 'create') {
    if (!params.picker.dataUrl) {
      params.picker.setImageRequiredError(true);
      return Promise.resolve();
    }
    return params.onCreate({ title, caption, dataUrl: params.picker.dataUrl });
  }
  if (!params.item) return Promise.resolve();
  return params.onEdit(params.item.id, {
    title,
    caption,
    ...(params.picker.dataUrl ? { dataUrl: params.picker.dataUrl } : {}),
  });
}

function resolveGalleryModalLabels(
  mode: 'create' | 'edit',
  isSubmitting: boolean,
  t: ReturnType<typeof useTranslations<'branding.gallery'>>,
) {
  return {
    heading: mode === 'create' ? t('createModalTitle') : t('editModalTitle'),
    submitLabel: isSubmitting
      ? t('saving')
      : mode === 'create'
        ? t('createSubmit')
        : t('editSubmit'),
  };
}

function buildDefaultGalleryValues(item?: LoginGalleryItemDto): GalleryItemFormValues {
  if (!item) {
    return { title: '', caption: '' };
  }
  return { title: item.title, caption: item.caption ?? '' };
}

function useGalleryModalController(props: {
  mode: 'create' | 'edit';
  item?: LoginGalleryItemDto;
  isSubmitting: boolean;
  error: unknown;
  onClearError?: () => void;
  onClose: () => void;
  onCreate: (payload: CreateLoginGalleryItemRequest) => Promise<void>;
  onEdit: (id: string, payload: UpdateLoginGalleryItemRequest) => Promise<void>;
}) {
  const t = useTranslations('branding.gallery');
  const picker = useGalleryImagePicker(props.onClearError);
  const isBusy = props.isSubmitting || picker.isCompressing;
  useEscapeClose(!isBusy, props.onClose);

  const form = useForm<GalleryItemFormValues>({
    resolver: zodResolver(galleryItemFormSchema),
    defaultValues: buildDefaultGalleryValues(props.item),
  });

  const labels = resolveGalleryModalLabels(props.mode, props.isSubmitting, t);
  const previewSrc = picker.dataUrl || props.item?.imageUrl || null;
  const rawErrorKey = describeBrandingError(picker.compressError ?? props.error);
  const errorKey: BrandingErrorKey | null =
    rawErrorKey === 'imageTooLarge' ? 'galleryImageTooLarge' : rawErrorKey;
  const onSubmit = form.handleSubmit((values) =>
    void submitGalleryModalForm({ mode: props.mode, item: props.item, values, picker, onCreate: props.onCreate, onEdit: props.onEdit }),
  );

  return {
    form,
    labels,
    previewSrc,
    errorKey,
    isBusy,
    imageTitle: props.item ? props.item.title : '',
    imageRequiredError: picker.imageRequiredError,
    handleFileChange: picker.handleFileChange,
    onSubmit,
  };
}

export function LoginGalleryItemModal(props: {
  mode: 'create' | 'edit';
  item?: LoginGalleryItemDto;
  isSubmitting: boolean;
  error: unknown;
  onClearError?: () => void;
  onClose: () => void;
  onCreate: (payload: CreateLoginGalleryItemRequest) => Promise<void>;
  onEdit: (id: string, payload: UpdateLoginGalleryItemRequest) => Promise<void>;
}) {
  const t = useTranslations('branding.gallery');
  const tCommon = useTranslations('common');
  const titleId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ctrl = useGalleryModalController(props);

  return (
    <div className="ui-modal-backdrop" role="presentation">
      <div className="ui-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="ui-modal-header">
          <h2 id={titleId} className="ui-modal-title">{ctrl.labels.heading}</h2>
          <button type="button" className="ui-icon-btn" aria-label={tCommon('close')} onClick={props.onClose} disabled={ctrl.isBusy}>✕</button>
        </div>
        <form className="ui-modal-body" onSubmit={ctrl.onSubmit} noValidate>
          <GalleryModalErrorBanner errorKey={ctrl.errorKey} imageRequiredError={ctrl.imageRequiredError} />
          <input ref={fileInputRef} type="file" accept={IMAGE_FILE_ACCEPT} className="avatar-file-input" aria-label={t('selectImageButton')} tabIndex={-1} disabled={ctrl.isBusy} onChange={(e) => void ctrl.handleFileChange(e)} />
          <GalleryImagePreviewBox previewSrc={ctrl.previewSrc} title={ctrl.imageTitle} isBusy={ctrl.isBusy} onPickClick={() => fileInputRef.current?.click()} />
          <GalleryTextFields register={ctrl.form.register} errors={ctrl.form.formState.errors} isBusy={ctrl.isBusy} />
          <div className="ui-modal-actions">
            <button type="button" className="ui-btn ghost" onClick={props.onClose} disabled={ctrl.isBusy}>{tCommon('cancel')}</button>
            <button type="submit" className="ui-btn primary" disabled={ctrl.isBusy}>{ctrl.labels.submitLabel}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function LoginGalleryDeleteModal({
  item,
  isDeleting,
  error,
  onClose,
  onConfirm,
}: {
  item: LoginGalleryItemDto;
  isDeleting: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const t = useTranslations('branding.gallery');
  const tCommon = useTranslations('common');
  const tErr = useTranslations('errors');
  const titleId = useId();
  const errorKey = describeBrandingError(error);
  useEscapeClose(!isDeleting, onClose);

  return (
    <div className="ui-modal-backdrop" role="presentation">
      <div className="ui-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="ui-modal-header">
          <h2 id={titleId} className="ui-modal-title">{t('deleteModalTitle')}</h2>
          <button type="button" className="ui-icon-btn" aria-label={tCommon('close')} onClick={onClose} disabled={isDeleting}>✕</button>
        </div>
        <div className="ui-modal-body">
          {errorKey ? <div className="ui-banner is-danger" role="alert"><div className="ui-banner-body"><span className="ui-banner-text">{tErr(errorKey)}</span></div></div> : null}
          <p className="ui-modal-copy">{t('deleteModalBody', { title: item.title })}</p>
          <div className="ui-modal-actions">
            <button type="button" className="ui-btn ghost" onClick={onClose} disabled={isDeleting}>{tCommon('cancel')}</button>
            <button type="button" className="ui-btn danger" onClick={() => void onConfirm()} disabled={isDeleting}>{isDeleting ? t('deleting') : t('deleteConfirm')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

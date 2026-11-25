'use client';

import { createElement } from 'react';
import { useTranslations } from 'next-intl';
import { MAX_LOGIN_GALLERY_ITEMS } from '@/lib/media';
import type { LoginGalleryItemDto } from '../hooks/useBranding';
import { useLoginGalleryAdmin } from '../hooks/useLoginGalleryAdmin';
import { LoginGalleryDeleteModal, LoginGalleryItemModal } from './LoginGalleryItemModal';

function GalleryItemActions({
  title,
  index,
  total,
  isReordering,
  onMoveLeft,
  onMoveRight,
  onEdit,
  onDelete,
}: {
  title: string;
  index: number;
  total: number;
  isReordering: boolean;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('branding.gallery');

  return (
    <div className="gallery-admin-actions">
      <div className="gallery-admin-move-group">
        <button type="button" className="ui-btn ghost is-sm" aria-label={t('moveLeftLabel', { title })} disabled={index === 0 || isReordering} onClick={onMoveLeft}>
          ←
        </button>
        <button type="button" className="ui-btn ghost is-sm" aria-label={t('moveRightLabel', { title })} disabled={index === total - 1 || isReordering} onClick={onMoveRight}>
          →
        </button>
      </div>
      <div className="gallery-admin-edit-group">
        <button type="button" className="ui-btn ghost is-sm" disabled={isReordering} onClick={onEdit}>
          {t('editAction')}
        </button>
        <button type="button" className="ui-btn danger is-sm" disabled={isReordering} onClick={onDelete}>
          {t('deleteAction')}
        </button>
      </div>
    </div>
  );
}

function GalleryItemCard(props: {
  item: LoginGalleryItemDto;
  index: number;
  total: number;
  isReordering: boolean;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { item, index } = props;

  return (
    <article className="gallery-admin-card">
      <div className="gallery-admin-thumb-wrap">
        {createElement('img', { src: item.imageUrl, alt: item.title, className: 'gallery-admin-thumb' })}
        <span className="gallery-admin-order">#{index + 1}</span>
      </div>
      <div className="gallery-admin-meta">
        <h3 className="gallery-admin-title">{item.title}</h3>
        {item.caption ? <p className="gallery-admin-caption">{item.caption}</p> : null}
      </div>
      <GalleryItemActions
        title={item.title}
        index={props.index}
        total={props.total}
        isReordering={props.isReordering}
        onMoveLeft={props.onMoveLeft}
        onMoveRight={props.onMoveRight}
        onEdit={props.onEdit}
        onDelete={props.onDelete}
      />
    </article>
  );
}

function GalleryModalHost({ admin }: { admin: ReturnType<typeof useLoginGalleryAdmin> }) {
  const modal = admin.modalState;
  if (modal.kind === 'create') {
    return (
      <LoginGalleryItemModal
        mode="create"
        isSubmitting={admin.createMutation.isPending}
        error={admin.createMutation.error}
        onClearError={() => admin.createMutation.reset()}
        onClose={admin.closeModal}
        onCreate={admin.handleCreate}
        onEdit={admin.handleEdit}
      />
    );
  }
  if (modal.kind === 'edit') {
    return (
      <LoginGalleryItemModal
        key={modal.item.id}
        mode="edit"
        item={modal.item}
        isSubmitting={admin.updateMutation.isPending}
        error={admin.updateMutation.error}
        onClearError={() => admin.updateMutation.reset()}
        onClose={admin.closeModal}
        onCreate={admin.handleCreate}
        onEdit={admin.handleEdit}
      />
    );
  }
  if (modal.kind === 'delete') {
    return (
      <LoginGalleryDeleteModal
        item={modal.item}
        isDeleting={admin.deleteMutation.isPending}
        error={admin.deleteMutation.error}
        onClose={admin.closeModal}
        onConfirm={() => admin.handleDelete(modal.item.id)}
      />
    );
  }
  return null;
}

function GallerySectionHeader({
  count,
  disabled,
  onAdd,
}: {
  count: number;
  disabled: boolean;
  onAdd: () => void;
}) {
  const t = useTranslations('branding.gallery');

  return (
    <div className="admin-card-header gallery-admin-header">
      <div>
        <div className="gallery-admin-title-row">
          <h2 id="login-gallery-section-title" className="admin-card-title">{t('sectionTitle')}</h2>
          <span className="ui-chip">{t('countBadge', { count, max: MAX_LOGIN_GALLERY_ITEMS })}</span>
        </div>
        <p className="admin-card-hint">{t('sectionSubtitle')}</p>
      </div>
      <button type="button" className="ui-btn primary" disabled={disabled} onClick={onAdd}>
        {t('addButton')}
      </button>
    </div>
  );
}

export function LoginGalleryAdminSection({ items }: { items: readonly LoginGalleryItemDto[] }) {
  const t = useTranslations('branding.gallery');
  const tErr = useTranslations('errors');
  const admin = useLoginGalleryAdmin(items);
  const count = admin.sortedItems.length;

  return (
    <section className="admin-card" aria-labelledby="login-gallery-section-title">
      <GallerySectionHeader count={count} disabled={admin.isAtLimit || admin.reorderMutation.isPending} onAdd={admin.openCreate} />
      {admin.isAtLimit ? (
        <div className="ui-banner is-warn" role="status">
          <div className="ui-banner-body"><span className="ui-banner-text">{t('limitReachedHint', { max: MAX_LOGIN_GALLERY_ITEMS })}</span></div>
        </div>
      ) : null}
      {admin.reorderErrorKey ? (
        <div className="ui-banner is-danger" role="alert">
          <div className="ui-banner-body"><span className="ui-banner-text">{tErr(admin.reorderErrorKey)}</span></div>
        </div>
      ) : null}
      {count === 0 ? (
        <div className="gallery-admin-empty">
          <p className="admin-card-title">{t('emptyTitle')}</p>
          <p className="admin-card-hint">{t('emptyDescription')}</p>
        </div>
      ) : (
        <div className="gallery-admin-grid">
          {admin.sortedItems.map((item, index) => (
            <GalleryItemCard
              key={item.id}
              item={item}
              index={index}
              total={count}
              isReordering={admin.reorderMutation.isPending}
              onMoveLeft={() => void admin.handleMove(index, -1)}
              onMoveRight={() => void admin.handleMove(index, 1)}
              onEdit={() => admin.openEdit(item)}
              onDelete={() => admin.openDelete(item)}
            />
          ))}
        </div>
      )}
      <GalleryModalHost admin={admin} />
    </section>
  );
}

import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '../../../messages/en.json';
import viMessages from '../../../messages/vi.json';
import { ApiClientError } from '@/features/shared/api/client';
import { PermissionsProvider } from '@/features/shared/permissions/can';
import { MAX_LOGIN_GALLERY_ITEMS } from '@/lib/media';

const brandingHookMock = vi.hoisted(() => ({
  useBrandingQuery: vi.fn(),
  useUpdateClubLogoMutation: vi.fn(() => ({ mutateAsync: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useRemoveClubLogoMutation: vi.fn(() => ({ mutateAsync: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useUpdateClubWordmarkMutation: vi.fn(() => ({ mutateAsync: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useRemoveClubWordmarkMutation: vi.fn(() => ({ mutateAsync: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useCreateGalleryItemMutation: vi.fn(() => ({ mutateAsync: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useUpdateGalleryItemMutation: vi.fn(() => ({ mutateAsync: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useDeleteGalleryItemMutation: vi.fn(() => ({ mutateAsync: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useReorderGalleryMutation: vi.fn(() => ({ mutateAsync: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
}));

vi.mock('@/features/branding/hooks/useBranding', async () => {
  const actual = await vi.importActual<typeof import('@/features/branding/hooks/useBranding')>(
    '@/features/branding/hooks/useBranding'
  );
  return { ...actual, ...brandingHookMock };
});

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { BrandingAdminView } from '@/features/branding/components/BrandingAdminView';
import { LoginGalleryDeleteModal, LoginGalleryItemModal } from '@/features/branding/components/LoginGalleryItemModal';
import { describeBrandingError } from '@/features/branding/error-mapping';
import type { LoginGalleryItemDto } from '@/features/branding/hooks/useBranding';
import { swapAdjacentGalleryIds } from '@/features/branding/hooks/useLoginGalleryAdmin';
import { BRAND_ASSET_FILE_ACCEPT } from '@/features/shared/image-compress';

function makeGalleryItem(index: number): LoginGalleryItemDto {
  return {
    id: `10000000-0000-4000-8000-0000000000${String(index + 1).padStart(2, '0')}`,
    title: `Khoảnh khắc ${index + 1}`,
    caption: index % 2 === 0 ? `Chú thích ${index + 1}` : null,
    imageUrl: `/api/v1/branding/gallery/item-${index + 1}/image?v=100`,
    orderIndex: index,
    updatedAt: '2026-11-26T00:00:00.000Z',
  };
}

function renderWithIntl(node: ReactNode, locale: 'vi' | 'en' = 'vi') {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={locale === 'vi' ? viMessages : enMessages} timeZone="Asia/Ho_Chi_Minh">
      {node}
    </NextIntlClientProvider>
  );
}

describe('BrandingAdminView & LoginGalleryAdminSection (CR-07-02)', () => {
  beforeEach(() => {
    brandingHookMock.useBrandingQuery.mockReset();
    brandingHookMock.useBrandingQuery.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      data: { logoUrl: null, wordmarkUrl: null, updatedAt: null, galleryItems: [] },
    });
  });

  it('renders 403 ErrorState and disables query for non-admin users', () => {
    const html = renderWithIntl(
      <PermissionsProvider isAdmin={false} permissions={['member.view', 'member.update', 'board.update']}>
        <BrandingAdminView />
      </PermissionsProvider>
    );
    expect(html).toContain('403');
    expect(brandingHookMock.useBrandingQuery).toHaveBeenCalledWith(false);
  });

  it('renders ClubLogoSection, ClubWordmarkSection, and LoginGalleryAdminSection empty state (0 / 12) for admins', () => {
    const html = renderWithIntl(
      <PermissionsProvider isAdmin permissions={[]}>
        <BrandingAdminView />
      </PermissionsProvider>
    );
    expect(brandingHookMock.useBrandingQuery).toHaveBeenCalledWith(true);
    expect(html).toContain('Logo CLB BEAM');
    expect(html).toContain('Ảnh chữ thương hiệu');
    expect(html).toContain('class="branding-identity-grid"');
    expect(html).toContain('class="club-wordmark-preview-stage"');
    expect(html).toContain(`accept="${BRAND_ASSET_FILE_ACCEPT}"`);
    expect(html).toContain('Mặc định');
    expect(html).toContain('Tải ảnh chữ mới');
    expect(html).toContain('Khung ảnh trang đăng nhập');
    expect(html).toContain('0 / 12');
    expect(html).toContain('<button type="button" class="ui-btn primary">Thêm ảnh</button>');
    expect(html).toContain('Chưa có ảnh nào được tải lên');
    expect(html).toContain('<button type="button" class="ui-btn ghost" disabled="">Khôi phục mặc định</button>');
  });

  it('renders gallery cards with order badges, move controls, custom wordmark, and disables Add when 12 items reached', () => {
    const twoItems = [makeGalleryItem(1), makeGalleryItem(0)];
    brandingHookMock.useBrandingQuery.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      data: {
        logoUrl: '/api/v1/branding/logo?v=10',
        wordmarkUrl: '/api/v1/branding/wordmark?v=20',
        updatedAt: '2026-11-26T00:00:00.000Z',
        galleryItems: twoItems,
      },
    });
    const listHtml = renderWithIntl(
      <PermissionsProvider isAdmin permissions={[]}>
        <BrandingAdminView />
      </PermissionsProvider>
    );
    expect(listHtml).toContain('Đã có ảnh chữ');
    expect(listHtml).toContain('Thay ảnh chữ khác');
    expect(listHtml).toContain('src="/api/v1/branding/wordmark?v=20"');
    expect(listHtml).toContain('2 / 12');
    expect(listHtml).toContain('#1');
    expect(listHtml).toContain('#2');
    expect(listHtml).toContain('Khoảnh khắc 1');
    expect(listHtml).toContain('Khoảnh khắc 2');
    expect(listHtml).toContain('src="/api/v1/branding/gallery/item-1/image?v=100"');

    const fullItems = Array.from({ length: MAX_LOGIN_GALLERY_ITEMS }, (_, idx) => makeGalleryItem(idx));
    brandingHookMock.useBrandingQuery.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      data: { logoUrl: null, wordmarkUrl: null, updatedAt: null, galleryItems: fullItems },
    });
    const fullEnHtml = renderWithIntl(
      <PermissionsProvider isAdmin permissions={[]}>
        <BrandingAdminView />
      </PermissionsProvider>,
      'en'
    );
    expect(fullEnHtml).toContain('12 / 12');
    expect(fullEnHtml).toContain('Maximum of 12 photos reached');
    expect(fullEnHtml).toMatch(/<button[^>]*disabled=""[^>]*>Add photo<\/button>/);
  });

  it('maps GALLERY_LIMIT_REACHED and INVALID_GALLERY_ORDER, swaps adjacent IDs, and renders gallery modals cleanly', () => {
    expect(
      describeBrandingError(
        new ApiClientError({ status: 409, code: 'GALLERY_LIMIT_REACHED', messageKey: 'errors.galleryLimitReached', details: {} })
      )
    ).toBe('galleryLimitReached');
    expect(
      describeBrandingError(
        new ApiClientError({ status: 400, code: 'INVALID_GALLERY_ORDER', messageKey: 'errors.invalidGalleryOrder', details: {} })
      )
    ).toBe('invalidGalleryOrder');

    const items = [makeGalleryItem(0), makeGalleryItem(1), makeGalleryItem(2)];
    expect(swapAdjacentGalleryIds(items, 0, -1)).toBeNull();
    expect(swapAdjacentGalleryIds(items, 2, 1)).toBeNull();
    expect(swapAdjacentGalleryIds(items, 0, 1)).toEqual([items[1]!.id, items[0]!.id, items[2]!.id]);

    const editModalHtml = renderWithIntl(
      <LoginGalleryItemModal
        mode="edit"
        item={items[0]}
        isSubmitting={false}
        error={new ApiClientError({ status: 409, code: 'GALLERY_LIMIT_REACHED', messageKey: 'errors.galleryLimitReached', details: {} })}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onEdit={vi.fn()}
      />
    );
    expect(editModalHtml).toContain('Chỉnh sửa ảnh Polaroid');
    expect(editModalHtml).toContain('Khoảnh khắc 1');
    expect(editModalHtml).toContain('Đã đạt tối đa 12 khung ảnh trang đăng nhập.');

    const deleteModalHtml = renderWithIntl(
      <LoginGalleryDeleteModal
        item={items[0]!}
        isDeleting={false}
        error={null}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
      'en'
    );
    expect(deleteModalHtml).toContain('Delete login photo');
    expect(deleteModalHtml).toContain('Khoảnh khắc 1');

    const tooLargeGalleryModalHtml = renderWithIntl(
      <LoginGalleryItemModal
        mode="create"
        isSubmitting={false}
        error={new ApiClientError({ status: 400, code: 'IMAGE_TOO_LARGE', messageKey: 'errors.imageTooLarge', details: {} })}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onEdit={vi.fn()}
      />,
      'en'
    );
    expect(tooLargeGalleryModalHtml).toContain('512 KB');
    expect(tooLargeGalleryModalHtml).not.toContain('256 KB after compression');
  });
});

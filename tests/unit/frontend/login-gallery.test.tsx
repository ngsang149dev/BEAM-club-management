import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import enMessages from '../../../messages/en.json';
import viMessages from '../../../messages/vi.json';
import { LoginPhotoWall } from '@/features/auth/components/LoginPhotoWall';
import { LoginShowcase } from '@/features/auth/components/LoginShowcase';
import { BRANDING_QUERY_KEYS, type BrandingResponse } from '@/features/branding/hooks/useBranding';

function renderShowcase(locale: 'vi' | 'en', branding?: BrandingResponse) {
  const messages = locale === 'en' ? enMessages : viMessages;
  if (!branding) {
    return renderToStaticMarkup(
      <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Ho_Chi_Minh">
        <LoginShowcase />
      </NextIntlClientProvider>
    );
  }
  const queryClient = new QueryClient();
  queryClient.setQueryData(BRANDING_QUERY_KEYS.branding, branding);
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Ho_Chi_Minh">
      <QueryClientProvider client={queryClient}>
        <LoginShowcase />
      </QueryClientProvider>
    </NextIntlClientProvider>
  );
}

describe('LoginShowcase & LoginPhotoWall (CR-07-02)', () => {
  it('renders 4 curated BEAM sample Polaroid frames with inline SVG artwork when galleryItems is empty', () => {
    const viHtml = renderShowcase('vi');
    expect(viHtml).toContain('class="login-left"');
    expect(viHtml).not.toContain('<section class="login-left" aria-hidden="true"');
    expect(viHtml).toContain('aria-label="Khoảnh khắc CLB BEAM"');
    expect(viHtml).toContain('4 khung ảnh');
    expect(viHtml).toContain('aria-label="Ảnh trước"');
    expect(viHtml).toContain('aria-label="Ảnh tiếp theo"');
    expect(viHtml).toContain('Gặp mặt đầu kỳ');
    expect(viHtml).toContain('Workshop Thiết kế');
    expect(viHtml).toContain('Build Sprint CLB');
    expect(viHtml).toContain('Ngày hội BEAM');
    expect(viHtml).toContain('class="login-word-text"');
    expect(viHtml).toContain('<b>BEAM</b>');
    expect((viHtml.match(/class="login-polaroid-svg"/g) ?? [])).toHaveLength(4);
    expect(viHtml).not.toContain('login-mini-col');

    const enHtml = renderShowcase('en');
    expect(enHtml).toContain('4 frames');
    expect(enHtml).toContain('aria-label="Previous photo"');
    expect(enHtml).toContain('aria-label="Next photo"');
    expect(enHtml).toContain('Semester Kickoff');
    expect(enHtml).toContain('BEAM Open Day');
  });

  it('switches immediately to uploaded galleryItems sorted by orderIndex and renders custom logo and wordmark', () => {
    const html = renderShowcase('vi', {
      logoUrl: '/api/v1/branding/logo?v=88',
      wordmarkUrl: '/api/v1/branding/wordmark?v=99',
      updatedAt: '2026-11-26T00:00:00.000Z',
      galleryItems: [
        {
          id: 'g-2',
          title: 'Second Frame',
          caption: 'Caption two',
          imageUrl: '/api/v1/branding/gallery/g-2/image?v=2',
          orderIndex: 1,
          updatedAt: '2026-11-26T00:00:00.000Z',
        },
        {
          id: 'g-1',
          title: 'First Frame',
          caption: null,
          imageUrl: '/api/v1/branding/gallery/g-1/image?v=1',
          orderIndex: 0,
          updatedAt: '2026-11-26T00:00:00.000Z',
        },
      ],
    });

    expect(html).toContain('src="/api/v1/branding/logo?v=88"');
    expect(html).toContain('src="/api/v1/branding/wordmark?v=99"');
    expect(html).toContain('class="club-wordmark-img"');
    expect(html).not.toContain('<b>BEAM</b>');
    expect(html).toContain('2 khung ảnh');
    expect(html).toContain('src="/api/v1/branding/gallery/g-1/image?v=1"');
    expect(html).toContain('src="/api/v1/branding/gallery/g-2/image?v=2"');
    expect(html).toContain('Caption two');
    expect(html).not.toContain('login-polaroid-svg');
    expect(html).not.toContain('Gặp mặt đầu kỳ');
    expect(html.indexOf('First Frame')).toBeLessThan(html.indexOf('Second Frame'));
  });

  it('renders draggable track and arrow buttons directly via LoginPhotoWall', () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={enMessages} timeZone="Asia/Ho_Chi_Minh">
        <LoginPhotoWall items={[]} />
      </NextIntlClientProvider>
    );
    expect(html).toContain('role="region"');
    expect(html).toContain('class="login-photo-wall-track"');
    expect(html).toContain('aria-label="Previous photo"');
    expect(html).toContain('aria-label="Next photo"');
  });
});

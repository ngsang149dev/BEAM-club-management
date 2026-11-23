import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import enMessages from '../../../messages/en.json';
import viMessages from '../../../messages/vi.json';
import { applyLocaleSelection, LanguageSwitch } from '@/components/LanguageSwitch';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

describe('LanguageSwitch and applyLocaleSelection', () => {
  it('renders active pressed state matching current locale', () => {
    const htmlVi = renderToStaticMarkup(
      <NextIntlClientProvider locale="vi" messages={viMessages} timeZone="Asia/Ho_Chi_Minh">
        <LanguageSwitch />
      </NextIntlClientProvider>
    );
    expect(htmlVi).toContain('aria-pressed="true"');
    expect(htmlVi).toContain('>VI<');
    expect(htmlVi).toContain('>EN<');

    const htmlEn = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={enMessages} timeZone="Asia/Ho_Chi_Minh">
        <LanguageSwitch />
      </NextIntlClientProvider>
    );
    expect(htmlEn).toContain('aria-pressed="true"');
  });

  it('does nothing when selecting the already-active locale', async () => {
    const onLocaleChange = vi.fn();
    const writeCookie = vi.fn();
    const refresh = vi.fn();

    const changed = await applyLocaleSelection({
      currentLocale: 'vi',
      nextLocale: 'vi',
      onLocaleChange,
      writeCookie,
      refresh,
    });

    expect(changed).toBe(false);
    expect(onLocaleChange).not.toHaveBeenCalled();
    expect(writeCookie).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('writes cookie and refreshes directly when no onLocaleChange callback is provided', async () => {
    const writeCookie = vi.fn();
    const refresh = vi.fn();

    const changed = await applyLocaleSelection({
      currentLocale: 'vi',
      nextLocale: 'en',
      writeCookie,
      refresh,
    });

    expect(changed).toBe(true);
    expect(writeCookie).toHaveBeenCalledWith('en');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('awaits onLocaleChange before writing cookie and refreshing once', async () => {
    const events: string[] = [];
    const onLocaleChange = vi.fn(async () => {
      events.push('persist');
    });
    const writeCookie = vi.fn(() => events.push('cookie'));
    const refresh = vi.fn(() => events.push('refresh'));

    const changed = await applyLocaleSelection({
      currentLocale: 'vi',
      nextLocale: 'en',
      onLocaleChange,
      writeCookie,
      refresh,
    });

    expect(changed).toBe(true);
    expect(onLocaleChange).toHaveBeenCalledWith('en');
    expect(events).toEqual(['persist', 'cookie', 'refresh']);
  });

  it('does NOT write cookie or refresh when onLocaleChange rejects', async () => {
    const onLocaleChange = vi.fn(async () => {
      throw new Error('PATCH /me failed');
    });
    const writeCookie = vi.fn();
    const refresh = vi.fn();

    await expect(
      applyLocaleSelection({
        currentLocale: 'vi',
        nextLocale: 'en',
        onLocaleChange,
        writeCookie,
        refresh,
      })
    ).rejects.toThrow('PATCH /me failed');

    expect(writeCookie).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});

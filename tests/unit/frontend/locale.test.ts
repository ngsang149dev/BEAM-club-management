import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  resolveLocale,
  writeLocaleCookie,
} from '@/i18n/locale';

describe('i18n locale helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defines expected cookie name, default locale, and supported locales', () => {
    expect(LOCALE_COOKIE).toBe('beam_locale');
    expect(DEFAULT_LOCALE).toBe('vi');
    expect(SUPPORTED_LOCALES).toEqual(['vi', 'en']);
  });

  it('validates supported locales strictly', () => {
    expect(isSupportedLocale('vi')).toBe(true);
    expect(isSupportedLocale('en')).toBe(true);
    expect(isSupportedLocale('fr')).toBe(false);
    expect(isSupportedLocale('VI')).toBe(false);
    expect(isSupportedLocale('')).toBe(false);
    expect(isSupportedLocale(undefined)).toBe(false);
    expect(isSupportedLocale(null)).toBe(false);
  });

  it('resolves valid locales and falls back to DEFAULT_LOCALE otherwise', () => {
    expect(resolveLocale('vi')).toBe('vi');
    expect(resolveLocale('en')).toBe('en');
    expect(resolveLocale('jp')).toBe('vi');
    expect(resolveLocale(undefined)).toBe('vi');
    expect(resolveLocale(null)).toBe('vi');
  });

  it('writes beam_locale cookie safely in SSR and browser contexts', () => {
    expect(() => writeLocaleCookie('en')).not.toThrow();

    const docMock = { cookie: '' };
    vi.stubGlobal('document', docMock);
    vi.stubGlobal('window', { location: { protocol: 'http:' } });

    writeLocaleCookie('en');
    expect(docMock.cookie).toBe('beam_locale=en; Path=/; Max-Age=31536000; SameSite=Lax');

    vi.stubGlobal('window', { location: { protocol: 'https:' } });
    writeLocaleCookie('vi');
    expect(docMock.cookie).toBe('beam_locale=vi; Path=/; Max-Age=31536000; SameSite=Lax; Secure');
  });
});

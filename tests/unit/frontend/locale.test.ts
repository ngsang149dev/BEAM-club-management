import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  resolveLocale,
} from '@/i18n/locale';

describe('i18n locale helpers', () => {
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
});

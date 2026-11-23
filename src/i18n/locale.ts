export const SUPPORTED_LOCALES = ['vi', 'en'] as const;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = 'vi';

export const LOCALE_COOKIE = 'beam_locale';

export function isSupportedLocale(value: string | null | undefined): value is AppLocale {
  return value === 'vi' || value === 'en';
}

export function resolveLocale(value: string | null | undefined): AppLocale {
  return isSupportedLocale(value) ? value : DEFAULT_LOCALE;
}

export function writeLocaleCookie(locale: AppLocale): void {
  if (typeof document === 'undefined') {
    return;
  }
  const secureFlag =
    typeof window !== 'undefined' && window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${secureFlag}`;
}

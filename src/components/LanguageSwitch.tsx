'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { LOCALE_COOKIE, SUPPORTED_LOCALES, type AppLocale } from '@/i18n/locale';

export interface LanguageSwitchProps {
  onLocaleChange?: (locale: AppLocale) => void | Promise<void>;
}

function writeLocaleCookie(locale: AppLocale): void {
  const secureFlag =
    typeof window !== 'undefined' && window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${secureFlag}`;
}

export function LanguageSwitch({ onLocaleChange }: LanguageSwitchProps) {
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations('language');
  const [isPending, startTransition] = useTransition();

  function handleSelect(nextLocale: AppLocale): void {
    if (nextLocale === locale || isPending) {
      return;
    }
    writeLocaleCookie(nextLocale);
    startTransition(() => {
      if (onLocaleChange) {
        void onLocaleChange(nextLocale);
      }
      router.refresh();
    });
  }

  return (
    <div className="lang-switch" role="group" aria-label={t('ariaLabel')}>
      {SUPPORTED_LOCALES.map((code) => {
        const label = code === 'vi' ? t('vi') : t('en');
        const fullName = code === 'vi' ? t('viName') : t('enName');
        return (
          <button
            key={code}
            type="button"
            className="lang-switch-btn"
            aria-pressed={locale === code}
            title={fullName}
            disabled={isPending}
            onClick={() => handleSelect(code)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

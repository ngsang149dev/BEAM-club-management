'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { SUPPORTED_LOCALES, writeLocaleCookie, type AppLocale } from '@/i18n/locale';

export interface LanguageSwitchProps {
  onLocaleChange?: (locale: AppLocale) => unknown | Promise<unknown>;
}

export interface ApplyLocaleSelectionOptions {
  currentLocale: string;
  nextLocale: AppLocale;
  onLocaleChange?: (locale: AppLocale) => unknown | Promise<unknown>;
  writeCookie: (locale: AppLocale) => void;
  refresh: () => void;
}

export async function applyLocaleSelection({
  currentLocale,
  nextLocale,
  onLocaleChange,
  writeCookie,
  refresh,
}: ApplyLocaleSelectionOptions): Promise<boolean> {
  if (nextLocale === currentLocale) {
    return false;
  }
  if (onLocaleChange) {
    await onLocaleChange(nextLocale);
  }
  writeCookie(nextLocale);
  refresh();
  return true;
}

export function LanguageSwitch({ onLocaleChange }: LanguageSwitchProps) {
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations('language');
  const [isSaving, setIsSaving] = useState(false);
  const [isPending, startTransition] = useTransition();
  const isBusy = isSaving || isPending;

  async function handleSelect(nextLocale: AppLocale): Promise<void> {
    if (nextLocale === locale || isBusy) {
      return;
    }
    setIsSaving(true);
    try {
      await applyLocaleSelection({
        currentLocale: locale,
        nextLocale,
        onLocaleChange,
        writeCookie: writeLocaleCookie,
        refresh: () => startTransition(() => router.refresh()),
      });
    } catch {
      // Caller surfaces persistence error; keep cookie and UI unchanged.
    } finally {
      setIsSaving(false);
    }
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
            disabled={isBusy}
            onClick={() => void handleSelect(code)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

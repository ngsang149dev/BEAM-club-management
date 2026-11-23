import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { LOCALE_COOKIE, resolveLocale, type AppLocale } from './locale';

async function loadLocaleMessages(locale: AppLocale): Promise<Record<string, unknown>> {
  if (locale === 'en') {
    return (await import('../../messages/en.json')).default;
  }
  return (await import('../../messages/vi.json')).default;
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  const locale = resolveLocale(cookieLocale ?? requested);

  return {
    locale,
    timeZone: 'Asia/Ho_Chi_Minh',
    messages: await loadLocaleMessages(locale),
  };
});

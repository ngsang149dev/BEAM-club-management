import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import { QueryProvider } from '@/features/shared/providers/QueryProvider';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app');
  return {
    title: t('title'),
    description: t('subtitle'),
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Ho_Chi_Minh">
          <QueryProvider>{children}</QueryProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

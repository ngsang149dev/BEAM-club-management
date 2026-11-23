import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import enMessages from '../../../messages/en.json';
import viMessages from '../../../messages/vi.json';
import { LoginForm, LoginStatusBanner, resolveBannerConfig } from '@/features/auth/components/LoginForm';
import { ApiClientError } from '@/features/shared/api/client';
import { loginFormSchema } from '@/lib/auth';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: vi.fn(),
    refresh: vi.fn(),
    push: vi.fn(),
  }),
}));

function renderLogin(locale: 'vi' | 'en', props: { expired?: boolean; returnTo?: string } = {}) {
  const queryClient = new QueryClient();
  const messages = locale === 'en' ? enMessages : viMessages;
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Ho_Chi_Minh">
      <QueryClientProvider client={queryClient}>
        <LoginForm {...props} />
      </QueryClientProvider>
    </NextIntlClientProvider>
  );
}

describe('LoginForm (S01)', () => {
  it('renders a POST form with one studentId input (autocomplete="username"), no password field, and unchecked remember checkbox with hint', () => {
    const htmlVi = renderLogin('vi');

    expect(htmlVi).toMatch(/<form[^>]*method="post"/);
    const inputs = htmlVi.match(/<input\b[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(2);

    const textInputs = inputs.filter((tag) => tag.includes('type="text"'));
    expect(textInputs).toHaveLength(1);
    expect(textInputs[0]).toContain('autoComplete="username"');
    expect(htmlVi).not.toContain('type="password"');

    const checkboxes = inputs.filter((tag) => tag.includes('type="checkbox"'));
    expect(checkboxes).toHaveLength(1);
    expect(checkboxes[0]).not.toContain('checked');

    expect(htmlVi).toContain('Chỉ tích trên thiết bị của bạn.');
    expect(htmlVi).not.toContain('Phiên đã hết hạn');

    const htmlEn = renderLogin('en');
    expect(htmlEn).toContain('Only tick this on your own device.');
    expect(htmlEn).toContain('Sign in');
  });

  it('validates studentId bounds via shared loginFormSchema', () => {
    expect(loginFormSchema.safeParse({ studentId: '  21010001  ', remember: false }).success).toBe(true);
    expect(loginFormSchema.safeParse({ studentId: '   ', remember: false }).success).toBe(false);
    expect(loginFormSchema.safeParse({ studentId: 'A'.repeat(65), remember: false }).success).toBe(false);
    expect(loginFormSchema.safeParse({ studentId: 'A'.repeat(64), remember: true }).success).toBe(true);
  });

  it('renders session expired banner when expired is true in both locales', () => {
    const htmlVi = renderLogin('vi', { expired: true, returnTo: '/my-tasks' });
    expect(htmlVi).toContain('Phiên đã hết hạn');
    expect(htmlVi).toContain('Vui lòng đăng nhập lại để tiếp tục.');

    const htmlEn = renderLogin('en', { expired: true, returnTo: '/my-tasks' });
    expect(htmlEn).toContain('Your session has expired');
    expect(htmlEn).toContain('Please sign in again to continue.');
  });

  it('resolves and renders 429 countdown, network error, and generic 401/validation banners', () => {
    const rateErr = new ApiClientError({
      status: 429,
      code: 'TOO_MANY_REQUESTS',
      messageKey: 'errors.tooManyRequests',
      details: { retryAfterSeconds: 125 },
    });
    expect(resolveBannerConfig(rateErr, false, false)).toEqual({ kind: 'warn', type: 'rate', wait: '02:05' });

    const netErr = new ApiClientError({
      status: 0,
      code: 'NETWORK_ERROR',
      messageKey: 'errors.network',
      details: {},
    });
    expect(resolveBannerConfig(netErr, false, false)).toEqual({ kind: 'danger', type: 'network' });

    const invalidErr = new ApiClientError({
      status: 401,
      code: 'UNAUTHORIZED',
      messageKey: 'errors.unauthorized',
      details: {},
    });
    expect(resolveBannerConfig(invalidErr, false, false)).toEqual({ kind: 'danger', type: 'invalid' });
    expect(resolveBannerConfig(null, true, false)).toEqual({ kind: 'danger', type: 'invalid' });

    const renderBanner = (error: unknown, hasValidationError = false) =>
      renderToStaticMarkup(
        <NextIntlClientProvider locale="vi" messages={viMessages} timeZone="Asia/Ho_Chi_Minh">
          <LoginStatusBanner error={error} hasValidationError={hasValidationError} expired={false} />
        </NextIntlClientProvider>
      );

    expect(renderBanner(rateErr)).toContain('02:05');
    expect(renderBanner(netErr)).toContain('Không thể kết nối đến máy chủ');
    expect(renderBanner(invalidErr)).toContain('Không thể đăng nhập. Kiểm tra lại MSSV hoặc liên hệ admin.');
    expect(renderBanner(null, true)).toContain('Không thể đăng nhập. Kiểm tra lại MSSV hoặc liên hệ admin.');
  });
});

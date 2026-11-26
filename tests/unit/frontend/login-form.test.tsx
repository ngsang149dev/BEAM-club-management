import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import enMessages from '../../../messages/en.json';
import viMessages from '../../../messages/vi.json';
import {
  LoginForm,
  LoginStatusBanner,
  resolveBannerConfig,
  resolveExplicitReturnTo,
} from '@/features/auth/components/LoginForm';
import { resolveLoginRedirectTarget, type LoginResponse } from '@/features/auth/hooks/useAuth';
import { ApiClientError } from '@/features/shared/api/client';
import { loginFormSchema } from '@/lib/auth';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: vi.fn(),
    refresh: vi.fn(),
    push: vi.fn(),
  }),
}));

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(),
}));

import LoginPage from '@/app/login/page';

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
  it('renders a POST form with studentId (autocomplete="username"), password (autocomplete="current-password"), show/hide toggle, and unchecked remember checkbox', () => {
    const htmlVi = renderLogin('vi');

    expect(htmlVi).toMatch(/<form[^>]*method="post"/);
    const inputs = htmlVi.match(/<input\b[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(3);

    const textInputs = inputs.filter((tag) => tag.includes('type="text"'));
    expect(textInputs).toHaveLength(1);
    expect(textInputs[0]).toContain('autoComplete="username"');

    const passwordInputs = inputs.filter((tag) => tag.includes('type="password"'));
    expect(passwordInputs).toHaveLength(1);
    expect(passwordInputs[0]).toContain('autoComplete="current-password"');

    expect(htmlVi).toContain('aria-label="Hiện mật khẩu"');
    expect(htmlVi).toContain('aria-pressed="false"');

    const checkboxes = inputs.filter((tag) => tag.includes('type="checkbox"'));
    expect(checkboxes).toHaveLength(1);
    expect(checkboxes[0]).not.toContain('checked');

    expect(htmlVi).toContain('Ghi nhớ đăng nhập');
    expect(htmlVi).not.toContain('Chỉ tích trên thiết bị của bạn.');
    expect(htmlVi).not.toContain('không có mật khẩu');
    expect(htmlVi).not.toContain('Phiên đã hết hạn');
    expect(htmlVi).toContain(viMessages.auth.collabLabel);
    expect(htmlVi).toContain('href="https://www.facebook.com/eiu.beam.club"');
    expect(htmlVi).toContain('href="https://www.facebook.com/ng.sanggg149"');
    expect(htmlVi).toContain('target="_blank"');
    expect(htmlVi).toContain('rel="noopener noreferrer"');
    expect(htmlVi).toContain('BEAM CLUB');
    expect(htmlVi).toContain('Sang');
    expect(htmlVi).toContain('class="login-collab-x"');

    const htmlEn = renderLogin('en');
    expect(htmlEn).toContain('Remember me');
    expect(htmlEn).not.toContain('Only tick this on your own device.');
    expect(htmlEn).toContain('aria-label="Show password"');
    expect(htmlEn).toContain('Sign in');
    expect(htmlEn).not.toContain('no self sign-up, password or OTP');
    expect(htmlEn).toContain(enMessages.auth.collabLabel);
    expect(htmlEn).toContain('href="https://www.facebook.com/eiu.beam.club"');
    expect(htmlEn).toContain('href="https://www.facebook.com/ng.sanggg149"');
  });

  it('validates studentId and password bounds via shared loginFormSchema', () => {
    expect(
      loginFormSchema.safeParse({ studentId: '  21010001  ', password: 'Password1!', remember: false }).success
    ).toBe(true);
    expect(
      loginFormSchema.safeParse({ studentId: '   ', password: 'Password1!', remember: false }).success
    ).toBe(false);
    expect(
      loginFormSchema.safeParse({ studentId: '21010001', password: '', remember: false }).success
    ).toBe(false);
    expect(
      loginFormSchema.safeParse({ studentId: '21010001', password: 'P'.repeat(129), remember: false }).success
    ).toBe(false);
    expect(
      loginFormSchema.safeParse({ studentId: 'A'.repeat(65), password: 'Password1!', remember: false }).success
    ).toBe(false);
    expect(
      loginFormSchema.safeParse({ studentId: 'A'.repeat(64), password: 'Password1!', remember: true }).success
    ).toBe(true);
  });

  it('resolves explicit returnTo and mustChangePassword post-login redirect targets safely', async () => {
    expect(resolveExplicitReturnTo(undefined)).toBeNull();
    expect(resolveExplicitReturnTo('   ')).toBeNull();
    expect(resolveExplicitReturnTo('/my-tasks')).toBe('/my-tasks');
    expect(resolveExplicitReturnTo('https://evil.example/steal')).toBeNull();

    const unsafePageEl = await LoginPage({
      searchParams: Promise.resolve({ returnTo: 'https://evil.example/phish' }),
    });
    expect(unsafePageEl.props.returnTo).toBeUndefined();

    const safePageEl = await LoginPage({
      searchParams: Promise.resolve({ expired: '1', returnTo: '/my-tasks?priority=4' }),
    });
    expect(safePageEl.props.expired).toBe(true);
    expect(safePageEl.props.returnTo).toBe('/my-tasks?priority=4');

    const emptyPageEl = await LoginPage({
      searchParams: Promise.resolve({}),
    });
    expect(emptyPageEl.props.returnTo).toBeUndefined();

    const baseUser: LoginResponse['user'] = {
      id: '00000000-0000-4000-8000-000000000001',
      fullName: 'Nguyen Van A',
      isActive: true,
      leftAt: null,
      departments: [],
      studentId: '21010001',
      email: 'nva@eiu.edu.vn',
      locale: 'vi',
      isAdmin: false,
      mustChangePassword: true,
    };

    expect(
      resolveLoginRedirectTarget(null, {
        user: baseUser,
        redirectTo: '/boards',
        expiresAt: '2026-11-25T00:00:00.000Z',
      })
    ).toBe('/profile?changePassword=1');

    expect(
      resolveLoginRedirectTarget('/my-tasks', {
        user: baseUser,
        redirectTo: '/my-tasks',
        expiresAt: '2026-11-25T00:00:00.000Z',
      })
    ).toBe('/my-tasks');

    expect(
      resolveLoginRedirectTarget(null, {
        user: { ...baseUser, mustChangePassword: false },
        redirectTo: '/boards',
        expiresAt: '2026-11-25T00:00:00.000Z',
      })
    ).toBe('/boards');
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
    expect(renderBanner(invalidErr)).toContain('Không thể đăng nhập. Kiểm tra lại MSSV và mật khẩu, hoặc liên hệ admin.');
    expect(renderBanner(null, true)).toContain('Không thể đăng nhập. Kiểm tra lại MSSV và mật khẩu, hoặc liên hệ admin.');
  });
});

import { describe, expect, it } from 'vitest';
import { loadConfig } from '@/server/shared/config';

const BASE_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://beam_dev:beam_dev_password@localhost:5432/beam_dev',
  SESSION_SECRET: 'test-session-secret-0123456789abcdef',
  CRON_SECRET: 'test-cron-secret-0123',
};

describe('loadConfig', () => {
  it('applies documented defaults for optional and TTL variables', () => {
    const config = loadConfig(BASE_ENV);

    expect(config).toEqual({
      nodeEnv: 'test',
      databaseUrl: BASE_ENV.DATABASE_URL,
      testDatabaseUrl: undefined,
      sessionSecret: BASE_ENV.SESSION_SECRET,
      sessionTtlDefaultHours: 24,
      sessionTtlRememberDays: 30,
      allowedEmailDomain: 'eiu.edu.vn',
      cronSecret: BASE_ENV.CRON_SECRET,
      smtp: {
        host: undefined,
        port: undefined,
        user: undefined,
        pass: undefined,
        from: undefined,
      },
      appUrl: 'http://localhost:3000',
      undoToastSeconds: 10,
    });
  });

  it('normalizes ALLOWED_EMAIL_DOMAIN and treats blank optional vars as undefined', () => {
    const config = loadConfig({
      ...BASE_ENV,
      ALLOWED_EMAIL_DOMAIN: '  @EIU.EDU.VN ',
      SMTP_HOST: '',
      SMTP_PORT: '  ',
      SMTP_USER: '',
      SMTP_PASS: '',
      SMTP_FROM: '',
      SESSION_TTL_DEFAULT_HOURS: '12',
      SESSION_TTL_REMEMBER_DAYS: '14',
      UNDO_TOAST_SECONDS: '15',
      NEXT_PUBLIC_APP_URL: 'https://beam.example.org',
    });

    expect(config.allowedEmailDomain).toBe('eiu.edu.vn');
    expect(config.sessionTtlDefaultHours).toBe(12);
    expect(config.sessionTtlRememberDays).toBe(14);
    expect(config.undoToastSeconds).toBe(15);
    expect(config.appUrl).toBe('https://beam.example.org');
    expect(config.smtp.host).toBeUndefined();
    expect(config.smtp.port).toBeUndefined();
  });

  it('rejects missing or invalid configuration without leaking secret values', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'test',
        SESSION_SECRET: 'too-short',
        CRON_SECRET: 'short',
        NEXT_PUBLIC_APP_URL: 'not-a-url',
      }),
    ).toThrow(/DATABASE_URL/);

    let caughtMessage = '';
    try {
      loadConfig({
        ...BASE_ENV,
        SESSION_SECRET: 'secret-value-short',
        NEXT_PUBLIC_APP_URL: 'invalid-url',
      });
    } catch (error) {
      caughtMessage = (error as Error).message;
    }

    expect(caughtMessage).toContain('NEXT_PUBLIC_APP_URL');
    expect(caughtMessage).not.toContain('secret-value-short');
    expect(caughtMessage).not.toContain(BASE_ENV.DATABASE_URL!);
  });
});

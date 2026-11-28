import { z } from 'zod';
import { DEV_SEED_PASSWORD } from './password';

export interface SmtpConfig {
  readonly host?: string;
  readonly port?: number;
  readonly user?: string;
  readonly pass?: string;
  readonly from?: string;
}

export interface Config {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly databaseUrl: string;
  readonly testDatabaseUrl?: string;
  readonly sessionSecret: string;
  readonly sessionTtlMinutes: number;
  readonly allowedEmailDomain: string;
  readonly defaultInitialPassword?: string;
  readonly cronSecret: string;
  readonly smtp: SmtpConfig;
  readonly appUrl: string;
}

function emptyToUndefined(value: unknown): unknown {
  if (typeof value === 'string' && value.trim() === '') {
    return undefined;
  }
  return value;
}

const optionalNonEmptyString = z.preprocess(
  emptyToUndefined,
  z.string().trim().min(1).optional(),
);

const optionalPort = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int().min(1).max(65535).optional(),
);

const envSchema = z.object({
  NODE_ENV: z.preprocess(
    emptyToUndefined,
    z.enum(['development', 'test', 'production']).default('development'),
  ),
  DATABASE_URL: z.string().trim().min(1),
  TEST_DATABASE_URL: optionalNonEmptyString,
  SESSION_SECRET: z.string().min(16),
  SESSION_TTL_MINUTES: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(1440).default(30),
  ),
  ALLOWED_EMAIL_DOMAIN: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .min(1)
      .default('eiu.edu.vn')
      .transform((domain) => domain.toLowerCase().replace(/^@+/, '')),
  ),
  DEFAULT_INITIAL_PASSWORD: z.preprocess(
    emptyToUndefined,
    z.string().min(8).max(128).optional(),
  ),
  CRON_SECRET: z.string().min(8),
  SMTP_HOST: optionalNonEmptyString,
  SMTP_PORT: optionalPort,
  SMTP_USER: optionalNonEmptyString,
  SMTP_PASS: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  SMTP_FROM: optionalNonEmptyString,
  NEXT_PUBLIC_APP_URL: z.preprocess(
    emptyToUndefined,
    z.url().default('http://localhost:3000'),
  ),
});

function formatInvalidKeys(issues: readonly z.core.$ZodIssue[]): string {
  const keys = Array.from(
    new Set(issues.map((issue) => issue.path.map(String).join('.') || 'env')),
  );
  return keys.join(', ');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const keys = formatInvalidKeys(parsed.error.issues);
    throw new Error(`Invalid environment configuration for: ${keys}`);
  }

  const data = parsed.data;
  return {
    nodeEnv: data.NODE_ENV,
    databaseUrl: data.DATABASE_URL,
    testDatabaseUrl: data.TEST_DATABASE_URL,
    sessionSecret: data.SESSION_SECRET,
    sessionTtlMinutes: data.SESSION_TTL_MINUTES,
    allowedEmailDomain: data.ALLOWED_EMAIL_DOMAIN,
    defaultInitialPassword:
      data.DEFAULT_INITIAL_PASSWORD ??
      (data.NODE_ENV === 'production' ? undefined : DEV_SEED_PASSWORD),
    cronSecret: data.CRON_SECRET,
    smtp: {
      host: data.SMTP_HOST,
      port: data.SMTP_PORT,
      user: data.SMTP_USER,
      pass: data.SMTP_PASS,
      from: data.SMTP_FROM,
    },
    appUrl: data.NEXT_PUBLIC_APP_URL,
  };
}

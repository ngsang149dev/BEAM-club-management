import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  AppError,
  badRequest,
  conflict,
  forbidden,
  notFound,
  tooManyRequests,
  unauthorized,
} from '@/lib/errors';
import { FakeClock } from '@/server/shared/clock';
import { createContainer } from '@/server/shared/composition';
import type { Config } from '@/server/shared/config';
import type { Database } from '@/server/shared/db';
import { toErrorResponse } from '@/server/shared/http';
import type { Logger } from '@/server/shared/logger';
import { NoopMailer } from '@/server/shared/mailer';
import type { TransactionRunner } from '@/server/shared/transaction';

function createMockLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('AppError factories and toErrorResponse', () => {
  it('constructs typed AppError helpers with expected HTTP status codes', () => {
    expect(badRequest().httpStatus).toBe(400);
    expect(unauthorized().httpStatus).toBe(401);
    expect(forbidden().httpStatus).toBe(403);
    expect(notFound().httpStatus).toBe(404);
    expect(conflict().httpStatus).toBe(409);
    expect(tooManyRequests().httpStatus).toBe(429);
  });

  it('maps AppError to unified error envelope with requestId and PII redaction', async () => {
    const logger = createMockLogger();
    const err = conflict(
      'errors.taskVersionConflict',
      { currentVersion: 3, email: 'leak@eiu.edu.vn' },
      'VERSION_CONFLICT',
    );

    const response = toErrorResponse(err, logger, 'req-409');
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(response.headers.get('x-request-id')).toBe('req-409');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body).toEqual({
      error: {
        code: 'VERSION_CONFLICT',
        messageKey: 'errors.taskVersionConflict',
        details: {
          currentVersion: 3,
          email: '[REDACTED]',
          requestId: 'req-409',
        },
      },
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('maps ZodError (v4 issues) to 400 VALIDATION_ERROR without leaking emails', async () => {
    const logger = createMockLogger();
    const schema = z.object({ email: z.email(), priority: z.number().min(1).max(4) });
    const parsed = schema.safeParse({ email: 'bad@gmail.com', priority: 9 });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const response = toErrorResponse(parsed.error, logger, 'req-400');
    const body = (await response.json()) as {
      error: { code: string; messageKey: string; details: { requestId: string; issues: unknown[] } };
    };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.messageKey).toBe('errors.validation');
    expect(body.error.details.requestId).toBe('req-400');
    expect(body.error.details.issues.length).toBeGreaterThan(0);
  });

  it('masks unexpected errors as 500 INTERNAL_ERROR without exposing stack or PII', async () => {
    const logger = createMockLogger();
    const boom = new Error('DB failure for user dev01@eiu.edu.vn');
    const app500 = new AppError('CUSTOM_500', 'errors.internal', 500, { step: 'tx' });

    const resUnexpected = toErrorResponse(boom, logger, 'req-500-a');
    const bodyUnexpected = await resUnexpected.json();
    expect(resUnexpected.status).toBe(500);
    expect(resUnexpected.headers.get('cache-control')).toBe('no-store');
    expect(resUnexpected.headers.get('x-request-id')).toBe('req-500-a');
    expect(bodyUnexpected).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        messageKey: 'errors.internal',
        details: { requestId: 'req-500-a' },
      },
    });
    expect(JSON.stringify(bodyUnexpected)).not.toContain('dev01@eiu.edu.vn');
    expect(logger.error).toHaveBeenCalledTimes(1);

    const resApp500 = toErrorResponse(app500, logger, 'req-500-b');
    expect(resApp500.status).toBe(500);
    expect(logger.error).toHaveBeenCalledTimes(2);
  });
});

describe('composition container', () => {
  it('wires injectable ports without requiring real DB connections when overridden', async () => {
    const fakeConfig: Config = {
      nodeEnv: 'test',
      databaseUrl: 'postgresql://unused:unused@localhost:5432/unused',
      sessionSecret: 'test-session-secret-0123456789abcdef',
      sessionTtlMinutes: 30,
      sessionTtlDefaultHours: 24,
      sessionTtlRememberDays: 30,
      allowedEmailDomain: 'eiu.edu.vn',
      cronSecret: 'test-cron-secret',
      smtp: {},
      appUrl: 'http://localhost:3000',
      undoToastSeconds: 10,
    };
    const fakeClock = new FakeClock('2026-11-23T00:00:00.000Z');
    const mockDb = {} as Database;
    const mockTxRunner: TransactionRunner = {
      runInTransaction: async (fn) => fn(mockDb),
    };
    const mailer = new NoopMailer();
    const logger = createMockLogger();

    const container = createContainer({
      config: fakeConfig,
      clock: fakeClock,
      logger,
      mailer,
      db: mockDb,
      transactionRunner: mockTxRunner,
    });

    expect(container.clock.now().toISOString()).toBe('2026-11-23T00:00:00.000Z');
    fakeClock.advanceByMs(60_000);
    expect(container.clock.now().toISOString()).toBe('2026-11-23T00:01:00.000Z');
    await expect(
      container.mailer.send({ to: 'dev@eiu.edu.vn', subject: 'hi', text: 'test' }),
    ).resolves.toBeUndefined();
    await expect(container.dispose()).resolves.toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { StructuredLogger } from '@/server/shared/logger';

describe('StructuredLogger PII redaction', () => {
  it('writes single-line JSON and redacts sensitive keys recursively', () => {
    const outLines: string[] = [];
    const errLines: string[] = [];
    const logger = new StructuredLogger({
      writeOut: (line) => outLines.push(line),
      writeErr: (line) => errLines.push(line),
    });

    logger.info('Auth check completed', {
      requestId: 'req-123',
      studentId: 'MSSV-DEV-001',
      student_id: 'MSSV-DEV-002',
      email: 'dev-member-01@eiu.edu.vn',
      password: 'pw',
      token: 'raw-token',
      tokenHash: 'hash-val',
      cookie: 'beam_session=abc',
      authorization: 'Bearer xyz',
      secret: 'top-secret',
      smtpPass: 'smtp-secret',
      nested: {
        userEmail: 'nested@eiu.edu.vn',
        items: [{ tokenHash: 'inner-hash', safeCount: 3 }],
      },
    });

    expect(outLines).toHaveLength(1);
    expect(errLines).toHaveLength(0);

    const parsed = JSON.parse(outLines[0]!) as {
      level: string;
      message: string;
      meta: Record<string, unknown>;
    };
    expect(parsed.level).toBe('info');
    expect(parsed.meta.requestId).toBe('req-123');
    expect(parsed.meta.studentId).toBe('[REDACTED]');
    expect(parsed.meta.student_id).toBe('[REDACTED]');
    expect(parsed.meta.email).toBe('[REDACTED]');
    expect(parsed.meta.password).toBe('[REDACTED]');
    expect(parsed.meta.token).toBe('[REDACTED]');
    expect(parsed.meta.tokenHash).toBe('[REDACTED]');
    expect(parsed.meta.cookie).toBe('[REDACTED]');
    expect(parsed.meta.authorization).toBe('[REDACTED]');
    expect(parsed.meta.secret).toBe('[REDACTED]');
    expect(parsed.meta.smtpPass).toBe('[REDACTED]');

    const nested = parsed.meta.nested as {
      userEmail: string;
      items: Array<{ tokenHash: string; safeCount: number }>;
    };
    expect(nested.userEmail).toBe('[REDACTED]');
    expect(nested.items[0]).toEqual({ tokenHash: '[REDACTED]', safeCount: 3 });
  });

  it('scrubs email-shaped strings from messages, arrays, and Error instances', () => {
    const errLines: string[] = [];
    const logger = new StructuredLogger({
      writeOut: () => undefined,
      writeErr: (line) => errLines.push(line),
    });

    const err = new Error('Failed sending reminder to member.test@eiu.edu.vn');
    logger.error('Failure for alice@example.com in batch', {
      notes: ['Contact bob@eiu.edu.vn later'],
      error: err,
    });

    expect(errLines).toHaveLength(1);
    expect(errLines[0]).not.toContain('alice@example.com');
    expect(errLines[0]).not.toContain('bob@eiu.edu.vn');
    expect(errLines[0]).not.toContain('member.test@eiu.edu.vn');

    const parsed = JSON.parse(errLines[0]!) as {
      level: string;
      message: string;
      meta: { notes: string[]; error: { message: string } };
    };
    expect(parsed.level).toBe('error');
    expect(parsed.message).toBe('Failure for [REDACTED_EMAIL] in batch');
    expect(parsed.meta.notes[0]).toBe('Contact [REDACTED_EMAIL] later');
    expect(parsed.meta.error.message).toBe(
      'Failed sending reminder to [REDACTED_EMAIL]',
    );
  });

  it('redacts extended sensitive key variants and Error.cause PII', () => {
    const errLines: string[] = [];
    const logger = new StructuredLogger({
      writeOut: () => undefined,
      writeErr: (line) => errLines.push(line),
    });

    const cause = new Error('Root cause for member@eiu.edu.vn');
    const wrapped = new Error('Wrapper failure', { cause });

    logger.error('Extended redaction check', {
      mssv: 'MSSV-DEV-001',
      targetStudentId: 'MSSV-DEV-002',
      studentIds: ['MSSV-DEV-001'],
      pass: 'plain-pass',
      databaseUrl: 'postgresql://user:pw@localhost:5432/db',
      mail: 'direct@eiu.edu.vn',
      'set-cookie': 'beam_session=opaque',
      tokenHashes: ['hash-1'],
      error: wrapped,
    });

    expect(errLines).toHaveLength(1);
    const parsed = JSON.parse(errLines[0]!) as {
      meta: Record<string, unknown> & { error: { cause: { message: string } } };
    };
    expect(parsed.meta.mssv).toBe('[REDACTED]');
    expect(parsed.meta.targetStudentId).toBe('[REDACTED]');
    expect(parsed.meta.studentIds).toBe('[REDACTED]');
    expect(parsed.meta.pass).toBe('[REDACTED]');
    expect(parsed.meta.databaseUrl).toBe('[REDACTED]');
    expect(parsed.meta.mail).toBe('[REDACTED]');
    expect(parsed.meta['set-cookie']).toBe('[REDACTED]');
    expect(parsed.meta.tokenHashes).toBe('[REDACTED]');
    expect(parsed.meta.error.cause.message).toBe(
      'Root cause for [REDACTED_EMAIL]',
    );
  });

  it('handles circular references safely without throwing', () => {
    const outLines: string[] = [];
    const logger = new StructuredLogger({
      writeOut: (line) => outLines.push(line),
    });

    const circular: Record<string, unknown> = { label: 'node' };
    circular.self = circular;

    logger.warn('Circular meta', { circular });

    expect(outLines).toHaveLength(1);
    const parsed = JSON.parse(outLines[0]!) as {
      meta: { circular: { label: string; self: string } };
    };
    expect(parsed.meta.circular.self).toBe('[Circular]');
  });
});

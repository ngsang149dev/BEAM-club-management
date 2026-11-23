export type LogLevel = 'info' | 'warn' | 'error';

export type LogMeta = Record<string, unknown>;

export interface Logger {
  info(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  error(message: string, meta?: LogMeta): void;
}

export interface StructuredLoggerOptions {
  readonly writeOut?: (line: string) => void;
  readonly writeErr?: (line: string) => void;
}

const REDACTED = '[REDACTED]';
const REDACTED_EMAIL = '[REDACTED_EMAIL]';
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

const SENSITIVE_KEYS = new Set([
  'studentid',
  'studentids',
  'mssv',
  'email',
  'emails',
  'mail',
  'password',
  'pass',
  'token',
  'tokens',
  'tokenhash',
  'tokenhashes',
  'cookie',
  'cookies',
  'setcookie',
  'authorization',
  'secret',
  'secrets',
  'smtppass',
  'sessionsecret',
  'cronsecret',
  'databaseurl',
]);

const SENSITIVE_SUFFIXES = [
  'studentid',
  'studentids',
  'email',
  'emails',
  'mail',
  'token',
  'tokens',
  'tokenhash',
  'tokenhashes',
  'secret',
  'secrets',
  'password',
  'pass',
  'cookie',
  'cookies',
] as const;

export function scrubPiiText(text: string): string {
  return text.replace(EMAIL_PATTERN, REDACTED_EMAIL);
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[_-]/g, '');
  if (SENSITIVE_KEYS.has(normalized) || normalized.includes('mssv')) {
    return true;
  }
  return SENSITIVE_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

function sanitizeError(error: Error, seen: WeakSet<object>): Record<string, unknown> {
  const result: Record<string, unknown> = {
    name: error.name,
    message: scrubPiiText(error.message),
  };
  const extra = error as Error & { code?: unknown; hint?: unknown };
  if (typeof extra.code === 'string') {
    result.code = extra.code;
  }
  if (typeof extra.hint === 'string') {
    result.hint = extra.hint;
  }
  if (error.cause !== undefined) {
    result.cause = sanitizeValue(error.cause, seen);
  }
  return result;
}

function sanitizeRecord(
  record: Record<string, unknown>,
  seen: WeakSet<object>,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    output[key] = isSensitiveKey(key) ? REDACTED : sanitizeValue(value, seen);
  }
  return output;
}

function sanitizeObject(value: object, seen: WeakSet<object>): unknown {
  if (seen.has(value)) {
    return '[Circular]';
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  seen.add(value);
  try {
    if (value instanceof Error) {
      return sanitizeError(value, seen);
    }
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeValue(item, seen));
    }
    return sanitizeRecord(value as Record<string, unknown>, seen);
  } finally {
    seen.delete(value);
  }
}

export function sanitizeValue(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (typeof value === 'string') {
    return scrubPiiText(value);
  }
  if (typeof value === 'object' && value !== null) {
    return sanitizeObject(value, seen);
  }
  return value;
}

export function redactLogMeta(meta?: LogMeta): LogMeta | undefined {
  if (!meta) {
    return undefined;
  }
  return sanitizeRecord(meta, new WeakSet());
}

export class StructuredLogger implements Logger {
  private readonly writeOut: (line: string) => void;
  private readonly writeErr: (line: string) => void;

  constructor(options: StructuredLoggerOptions = {}) {
    this.writeOut =
      options.writeOut ?? ((line: string) => process.stdout.write(`${line}\n`));
    this.writeErr =
      options.writeErr ?? ((line: string) => process.stderr.write(`${line}\n`));
  }

  info(message: string, meta?: LogMeta): void {
    this.emit('info', message, meta);
  }

  warn(message: string, meta?: LogMeta): void {
    this.emit('warn', message, meta);
  }

  error(message: string, meta?: LogMeta): void {
    this.emit('error', message, meta);
  }

  private emit(level: LogLevel, message: string, meta?: LogMeta): void {
    const payload: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      message: scrubPiiText(message),
    };
    const sanitizedMeta = redactLogMeta(meta);
    if (sanitizedMeta && Object.keys(sanitizedMeta).length > 0) {
      payload.meta = sanitizedMeta;
    }
    const line = JSON.stringify(payload);
    if (level === 'error') {
      this.writeErr(line);
      return;
    }
    this.writeOut(line);
  }
}

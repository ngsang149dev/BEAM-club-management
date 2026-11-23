import { NextResponse } from 'next/server';
import { z } from 'zod';
import { type ApiErrorPayload, isAppError } from '@/lib/errors';
import { type Logger, redactLogMeta, scrubPiiText } from './logger';

interface FormattedZodIssue {
  readonly path: string[];
  readonly code: string;
  readonly message: string;
}

function mapZodIssues(issues: readonly z.core.$ZodIssue[]): FormattedZodIssue[] {
  return issues.map((issue) => ({
    path: issue.path.map(String),
    code: issue.code,
    message: scrubPiiText(issue.message),
  }));
}

function sanitizeErrorDetails(
  details: Record<string, unknown>,
  requestId: string,
): Record<string, unknown> {
  const safe = redactLogMeta(details) ?? {};
  return {
    ...safe,
    requestId,
  };
}

interface JsonErrorOptions {
  readonly code: string;
  readonly messageKey: string;
  readonly status: number;
  readonly details: Record<string, unknown>;
  readonly requestId: string;
}

function jsonError({
  code,
  messageKey,
  status,
  details,
  requestId,
}: JsonErrorOptions): NextResponse<ApiErrorPayload> {
  const headers: Record<string, string> = {
    'Cache-Control': 'no-store',
  };
  if (requestId) {
    headers['x-request-id'] = requestId;
  }
  return NextResponse.json(
    {
      error: {
        code,
        messageKey,
        details,
      },
    },
    { status, headers },
  );
}

export function toErrorResponse(
  error: unknown,
  logger: Logger,
  requestId: string,
): NextResponse<ApiErrorPayload> {
  if (isAppError(error)) {
    const details = sanitizeErrorDetails(error.details, requestId);
    if (error.httpStatus >= 500) {
      logger.error('Application error', { requestId, code: error.code, error });
    }
    return jsonError({
      code: error.code,
      messageKey: error.messageKey,
      status: error.httpStatus,
      details,
      requestId,
    });
  }

  if (error instanceof z.ZodError) {
    return jsonError({
      code: 'VALIDATION_ERROR',
      messageKey: 'errors.validation',
      status: 400,
      details: {
        requestId,
        issues: mapZodIssues(error.issues),
      },
      requestId,
    });
  }

  logger.error('Unhandled API error', { requestId, error });
  return jsonError({
    code: 'INTERNAL_ERROR',
    messageKey: 'errors.internal',
    status: 500,
    details: { requestId },
    requestId,
  });
}

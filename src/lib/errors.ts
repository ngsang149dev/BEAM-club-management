export interface ApiErrorPayload {
  error: {
    code: string;
    messageKey: string;
    details: Record<string, unknown>;
  };
}

export class AppError extends Error {
  readonly code: string;
  readonly messageKey: string;
  readonly httpStatus: number;
  readonly details: Record<string, unknown>;

  constructor(
    code: string,
    messageKey: string,
    httpStatus: number,
    details: Record<string, unknown> = {},
  ) {
    super(messageKey);
    this.name = 'AppError';
    this.code = code;
    this.messageKey = messageKey;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function badRequest(
  messageKey = 'errors.badRequest',
  details: Record<string, unknown> = {},
  code = 'BAD_REQUEST',
): AppError {
  return new AppError(code, messageKey, 400, details);
}

export function unauthorized(
  messageKey = 'errors.unauthorized',
  details: Record<string, unknown> = {},
  code = 'UNAUTHORIZED',
): AppError {
  return new AppError(code, messageKey, 401, details);
}

export function forbidden(
  messageKey = 'errors.forbidden',
  details: Record<string, unknown> = {},
  code = 'FORBIDDEN',
): AppError {
  return new AppError(code, messageKey, 403, details);
}

export function notFound(
  messageKey = 'errors.notFound',
  details: Record<string, unknown> = {},
  code = 'NOT_FOUND',
): AppError {
  return new AppError(code, messageKey, 404, details);
}

export function conflict(
  messageKey = 'errors.conflict',
  details: Record<string, unknown> = {},
  code = 'CONFLICT',
): AppError {
  return new AppError(code, messageKey, 409, details);
}

export function tooManyRequests(
  messageKey = 'errors.tooManyRequests',
  details: Record<string, unknown> = {},
  code = 'TOO_MANY_REQUESTS',
): AppError {
  return new AppError(code, messageKey, 429, details);
}

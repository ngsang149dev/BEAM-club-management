import { z } from 'zod';

export function emptyToUndefined(value: unknown): unknown {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === 'string' && value.trim() === '') {
    return undefined;
  }
  return value;
}

export function parseStrictBooleanInput(raw: unknown): unknown {
  const value = emptyToUndefined(raw);
  if (value === undefined || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return raw;
}

export function parseIntegerInput(raw: unknown): unknown {
  const value = emptyToUndefined(raw);
  if (value === undefined || typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return Number(value.trim());
  }
  return Number.NaN;
}

export function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, '\\$&');
}

export const optionalUuidQuerySchema = z.preprocess(
  emptyToUndefined,
  z.uuid().optional(),
);

export const optionalCursorQuerySchema = z.preprocess(
  emptyToUndefined,
  z.string().trim().min(1).max(512).optional(),
);

export const optionalIsoDateQuerySchema = z.preprocess(
  emptyToUndefined,
  z.iso
    .datetime({ offset: true })
    .transform((iso) => new Date(iso))
    .optional(),
);

export function createQueryLimitSchema(max = 100, defaultValue = 20) {
  return z.preprocess(
    parseIntegerInput,
    z.number().int().min(1).max(max).default(defaultValue),
  );
}

export const defaultQueryLimitSchema = createQueryLimitSchema(100, 20);

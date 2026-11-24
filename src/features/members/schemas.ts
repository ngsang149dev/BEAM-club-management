import { z } from 'zod';
import {
  DEFAULT_ALLOWED_EMAIL_DOMAIN,
  createMemberFormSchema,
  isAllowedEmailDomain,
  resetMemberPasswordFormSchema,
  updateMemberRequestSchema,
  type ResetMemberPasswordFormInput,
} from '@/lib/members';
import type { UpdateMemberRequest } from './hooks/useMembers';

export { resetMemberPasswordFormSchema, type ResetMemberPasswordFormInput };

const UPPER_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER_CHARS = 'abcdefghijkmnopqrstuvwxyz';
const DIGIT_CHARS = '23456789';
const SYMBOL_CHARS = '!@#$%^&*';
const ALL_PASSWORD_CHARS = `${UPPER_CHARS}${LOWER_CHARS}${DIGIT_CHARS}${SYMBOL_CHARS}`;

function nextRandomInt(max: number): number {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const buffer = new Uint32Array(1);
    cryptoObj.getRandomValues(buffer);
    return (buffer[0] ?? 0) % max;
  }
  return Math.floor(Math.random() * max);
}

function pickChar(pool: string): string {
  return pool.charAt(nextRandomInt(pool.length));
}

export function generateCompliantPassword(length = 12): string {
  const targetLength = Math.max(12, Math.min(128, length));
  const chars = [
    pickChar(UPPER_CHARS),
    pickChar(LOWER_CHARS),
    pickChar(DIGIT_CHARS),
    pickChar(SYMBOL_CHARS),
  ];
  while (chars.length < targetLength) {
    chars.push(pickChar(ALL_PASSWORD_CHARS));
  }
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = nextRandomInt(i + 1);
    const tmp = chars[i] ?? '';
    chars[i] = chars[j] ?? '';
    chars[j] = tmp;
  }
  return chars.join('');
}

export const createMemberWithDomainSchema = createMemberFormSchema.superRefine((values, ctx) => {
  if (!isAllowedEmailDomain(values.email, DEFAULT_ALLOWED_EMAIL_DOMAIN)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['email'],
      message: 'INVALID_EMAIL_DOMAIN',
    });
  }
});

export const editMemberFormSchema = z.object({
  fullName: z.string().trim().min(1, 'VALIDATION_FULL_NAME').max(120, 'VALIDATION_FULL_NAME'),
  email: z.string().trim(),
  departmentIds: z.array(z.string().uuid()),
  locale: z.enum(['', 'vi', 'en']),
});

export type CreateMemberValues = z.infer<typeof createMemberWithDomainSchema>;
export type EditMemberFormValues = z.infer<typeof editMemberFormSchema>;

function toUpdateCandidate(values: EditMemberFormValues): UpdateMemberRequest {
  const trimmedEmail = values.email.trim();
  const locale = values.locale === 'vi' || values.locale === 'en' ? values.locale : undefined;
  return {
    fullName: values.fullName.trim(),
    departmentIds: values.departmentIds,
    ...(locale ? { locale } : {}),
    ...(trimmedEmail ? { email: trimmedEmail.toLowerCase() } : {}),
  };
}

export function buildValidatedUpdatePayload(
  values: EditMemberFormValues,
  requireEmail: boolean
):
  | { ok: true; payload: UpdateMemberRequest }
  | { ok: false; field: 'fullName' | 'email'; issue: 'invalidDomain' | 'invalidForm' } {
  if (requireEmail && values.email.trim().length === 0) {
    return { ok: false, field: 'email', issue: 'invalidDomain' };
  }

  const parsed = updateMemberRequestSchema.safeParse(toUpdateCandidate(values));
  if (!parsed.success) {
    const isEmailError = parsed.error.issues[0]?.path[0] === 'email';
    return {
      ok: false,
      field: isEmailError ? 'email' : 'fullName',
      issue: isEmailError ? 'invalidDomain' : 'invalidForm',
    };
  }

  if (parsed.data.email && !isAllowedEmailDomain(parsed.data.email, DEFAULT_ALLOWED_EMAIL_DOMAIN)) {
    return { ok: false, field: 'email', issue: 'invalidDomain' };
  }

  return { ok: true, payload: parsed.data };
}

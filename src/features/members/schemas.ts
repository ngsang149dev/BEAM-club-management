import { z } from 'zod';
import {
  DEFAULT_ALLOWED_EMAIL_DOMAIN,
  createMemberFormSchema,
  isAllowedEmailDomain,
  updateMemberRequestSchema,
} from '@/lib/members';
import type { UpdateMemberRequest } from './hooks/useMembers';

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

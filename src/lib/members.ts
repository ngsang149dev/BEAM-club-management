import { z } from 'zod';
import { newPasswordSchema, studentIdSchema } from './auth';

export const DEFAULT_ALLOWED_EMAIL_DOMAIN = 'eiu.edu.vn';

export const uuidSchema = z.uuid();
export const memberFullNameSchema = z.string().trim().min(1).max(120);
export const memberEmailSchema = z
  .string()
  .trim()
  .pipe(z.email())
  .transform((value) => value.toLowerCase());

export const departmentNameSchema = z.string().trim().min(1).max(120);

export const departmentUpsertRequestSchema = z.object({
  name: departmentNameSchema,
  leadUserId: uuidSchema.nullable().optional(),
});

export type DepartmentUpsertRequestInput = z.infer<
  typeof departmentUpsertRequestSchema
>;

export function isAllowedEmailDomain(email: string, allowedDomain: string): boolean {
  const normalizedAllowed = allowedDomain.trim().toLowerCase().replace(/^@+/, '');
  if (normalizedAllowed.length === 0) {
    return false;
  }
  const parts = email.trim().toLowerCase().split('@');
  if (parts.length !== 2) {
    return false;
  }
  const [localPart, domainPart] = parts;
  if (!localPart || !domainPart) {
    return false;
  }
  return domainPart === normalizedAllowed;
}

export const createMemberFormSchema = z.object({
  studentId: studentIdSchema,
  email: memberEmailSchema,
  fullName: memberFullNameSchema,
  departmentIds: z.array(uuidSchema),
  locale: z.enum(['vi', 'en']),
  initialPassword: newPasswordSchema,
});

export type CreateMemberFormInput = z.infer<typeof createMemberFormSchema>;

export const createMemberRequestSchema = z.object({
  studentId: studentIdSchema,
  email: memberEmailSchema,
  fullName: memberFullNameSchema,
  departmentIds: z.array(uuidSchema).default([]),
  locale: z.enum(['vi', 'en']).default('vi'),
  initialPassword: newPasswordSchema.optional(),
});

export type CreateMemberRequestInput = z.infer<typeof createMemberRequestSchema>;

export const resetMemberPasswordFormSchema = z
  .object({
    newPassword: newPasswordSchema,
    confirmPassword: newPasswordSchema,
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });

export type ResetMemberPasswordFormInput = z.infer<
  typeof resetMemberPasswordFormSchema
>;

export const resetMemberPasswordRequestSchema = z
  .object({
    newPassword: newPasswordSchema,
  })
  .strict();

export type ResetMemberPasswordRequestInput = z.infer<
  typeof resetMemberPasswordRequestSchema
>;

export const updateMemberRequestSchema = z
  .object({
    email: memberEmailSchema.optional(),
    fullName: memberFullNameSchema.optional(),
    departmentIds: z.array(uuidSchema).optional(),
    locale: z.enum(['vi', 'en']).optional(),
  })
  .strict();

export type UpdateMemberRequestInput = z.infer<typeof updateMemberRequestSchema>;

function emptyToUndefined(value: unknown): unknown {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === 'string' && value.trim() === '') {
    return undefined;
  }
  return value;
}

function parseStrictBooleanInput(raw: unknown): unknown {
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

function parseLimitInput(raw: unknown): unknown {
  const value = emptyToUndefined(raw);
  if (value === undefined || typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return Number(value.trim());
  }
  return Number.NaN;
}

export const listMembersQuerySchema = z.object({
  q: z.preprocess(emptyToUndefined, z.string().trim().max(120).optional()),
  departmentId: z.preprocess(emptyToUndefined, uuidSchema.optional()),
  isActive: z.preprocess(parseStrictBooleanInput, z.boolean().optional()),
  cursor: z.preprocess(
    emptyToUndefined,
    z.string().trim().min(1).max(512).optional(),
  ),
  limit: z.preprocess(
    parseLimitInput,
    z.number().int().min(1).max(100).default(20),
  ),
});

export type ListMembersQueryInput = z.infer<typeof listMembersQuerySchema>;

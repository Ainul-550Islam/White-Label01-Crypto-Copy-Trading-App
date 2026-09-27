import { z } from 'zod';
import {
  countryCodeSchema,
  currencySchema,
  emailSchema,
  localeSchema,
  paginationQuerySchema,
  phoneSchema,
  plainTextSchema,
  timezoneSchema,
  urlSchema,
  uuidSchema,
} from './primitives';
import { passwordSchema } from './password.policy';

export const userStatusSchema = z.enum([
  'PENDING_VERIFICATION',
  'ACTIVE',
  'SUSPENDED',
  'LOCKED',
  'DEACTIVATED',
]);

export const kycStatusSchema = z.enum([
  'NOT_STARTED',
  'PENDING',
  'IN_REVIEW',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
]);

export const createUserSchema = z.object({
  email: emailSchema,
  password: passwordSchema.optional(),
  firstName: plainTextSchema(64).optional(),
  lastName: plainTextSchema(64).optional(),
  phone: phoneSchema.optional(),
  locale: localeSchema.optional(),
  preferredCurrency: currencySchema.optional(),
  countryCode: countryCodeSchema.optional(),
  timezone: timezoneSchema.optional(),
  roleKeys: z.array(z.string().trim().min(2).max(64)).max(10).default([]),
  sendInvite: z.boolean().default(true),
});
export type CreateUserSchema = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    firstName: plainTextSchema(64).optional(),
    lastName: plainTextSchema(64).optional(),
    displayName: plainTextSchema(64).optional(),
    phone: phoneSchema.nullable().optional(),
    avatarUrl: urlSchema.nullable().optional(),
    bio: plainTextSchema(500).nullable().optional(),
    countryCode: countryCodeSchema.nullable().optional(),
    timezone: timezoneSchema.optional(),
    locale: localeSchema.optional(),
    preferredCurrency: currencySchema.optional(),
    marketingOptIn: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateUserSchema = z.infer<typeof updateUserSchema>;

export const adminUpdateUserSchema = updateUserSchema.innerType().extend({
  status: userStatusSchema.optional(),
  emailVerified: z.boolean().optional(),
});
export type AdminUpdateUserSchema = z.infer<typeof adminUpdateUserSchema>;

export const listUsersQuerySchema = paginationQuerySchema.extend({
  status: userStatusSchema.optional(),
  kycStatus: kycStatusSchema.optional(),
  roleKey: z.string().trim().max(64).optional(),
  tenantId: uuidSchema.optional(),
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),
  includeDeleted: z.coerce.boolean().default(false),
});
export type ListUsersQuerySchema = z.infer<typeof listUsersQuerySchema>;

export const suspendUserSchema = z.object({
  reason: plainTextSchema(500),
  notifyUser: z.boolean().default(true),
});
export type SuspendUserSchema = z.infer<typeof suspendUserSchema>;

export const assignRolesSchema = z.object({
  roleIds: z.array(uuidSchema).min(1, 'At least one role is required').max(10),
  expiresAt: z.coerce.date().optional(),
});
export type AssignRolesSchema = z.infer<typeof assignRolesSchema>;

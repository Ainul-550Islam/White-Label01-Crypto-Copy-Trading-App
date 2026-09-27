import { z } from 'zod';
import { paginationQuerySchema, plainTextSchema, uuidSchema } from './primitives';

export const roleScopeSchema = z.enum(['PLATFORM', 'TENANT']);

export const permissionKeySchema = z
  .string()
  .trim()
  .max(64)
  .regex(/^(\*|[a-z][a-z0-9_]*:(\*|[a-z][a-z0-9_]*))$/, 'Permissions use the "resource:action" form');

export const createRoleSchema = z.object({
  key: z
    .string()
    .trim()
    .toUpperCase()
    .min(3)
    .max(64)
    .regex(/^[A-Z][A-Z0-9_]*$/, 'Role keys are UPPER_SNAKE_CASE'),
  name: plainTextSchema(120),
  description: plainTextSchema(500).nullable().optional(),
  scope: roleScopeSchema.default('TENANT'),
  permissionKeys: z.array(permissionKeySchema).min(1).max(200),
});
export type CreateRoleSchema = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z
  .object({
    name: plainTextSchema(120).optional(),
    description: plainTextSchema(500).nullable().optional(),
    permissionKeys: z.array(permissionKeySchema).min(1).max(200).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateRoleSchema = z.infer<typeof updateRoleSchema>;

export const listRolesQuerySchema = paginationQuerySchema.extend({
  scope: roleScopeSchema.optional(),
  includeSystem: z.coerce.boolean().default(true),
});
export type ListRolesQuerySchema = z.infer<typeof listRolesQuerySchema>;

export const revokeRoleSchema = z.object({
  roleId: uuidSchema,
});
export type RevokeRoleSchema = z.infer<typeof revokeRoleSchema>;

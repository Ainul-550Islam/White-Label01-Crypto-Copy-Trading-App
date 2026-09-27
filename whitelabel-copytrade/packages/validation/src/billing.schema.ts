import { z } from 'zod';
import {
  basisPointsSchema,
  currencySchema,
  decimalStringSchema,
  paginationQuerySchema,
  plainTextSchema,
  uuidSchema,
} from './primitives';

export const billingIntervalSchema = z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY', 'LIFETIME']);
export const planAudienceSchema = z.enum(['TENANT', 'END_USER']);
export const subscriptionStatusSchema = z.enum([
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'CANCELED',
  'EXPIRED',
  'PAUSED',
]);

export const planLimitsSchema = z.object({
  maxUsers: z.number().int().positive().nullable().default(null),
  maxTraders: z.number().int().positive().nullable().default(null),
  maxFollowersPerTrader: z.number().int().positive().nullable().default(null),
  maxExchangeAccountsPerUser: z.number().int().positive().nullable().default(null),
  maxCopySubscriptionsPerFollower: z.number().int().positive().nullable().default(null),
  maxApiRequestsPerMinute: z.number().int().positive().nullable().default(null),
  websocketConnections: z.number().int().positive().nullable().default(null),
  customDomain: z.boolean().default(false),
  whiteLabelMobileApp: z.boolean().default(false),
  prioritySupport: z.boolean().default(false),
});
export type PlanLimitsSchema = z.infer<typeof planLimitsSchema>;

export const createPlanSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(48)
    .regex(/^[a-z][a-z0-9_-]*$/, 'Plan codes are lowercase kebab or snake case'),
  name: plainTextSchema(120),
  description: plainTextSchema(500).nullable().optional(),
  audience: planAudienceSchema.default('TENANT'),
  price: decimalStringSchema,
  currency: currencySchema.default('USD'),
  interval: billingIntervalSchema.default('MONTHLY'),
  trialDays: z.number().int().min(0).max(365).default(0),
  performanceFeeBps: basisPointsSchema.default(0),
  platformFeeBps: basisPointsSchema.default(0),
  limits: planLimitsSchema,
  features: z.array(plainTextSchema(120)).max(60).default([]),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
  tenantId: uuidSchema.nullable().default(null),
});
export type CreatePlanSchema = z.infer<typeof createPlanSchema>;

export const updatePlanSchema = createPlanSchema
  .partial()
  .omit({ code: true })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdatePlanSchema = z.infer<typeof updatePlanSchema>;

export const listPlansQuerySchema = paginationQuerySchema.extend({
  audience: planAudienceSchema.optional(),
  isActive: z.coerce.boolean().optional(),
});
export type ListPlansQuerySchema = z.infer<typeof listPlansQuerySchema>;

export const assignSubscriptionSchema = z.object({
  planId: uuidSchema,
  seatsPurchased: z.number().int().min(1).max(100000).default(1),
  trialDays: z.number().int().min(0).max(365).optional(),
  startImmediately: z.boolean().default(true),
  externalCustomerId: z.string().trim().max(128).optional(),
  externalSubscriptionId: z.string().trim().max(128).optional(),
});
export type AssignSubscriptionSchema = z.infer<typeof assignSubscriptionSchema>;

export const cancelSubscriptionSchema = z.object({
  cancelAtPeriodEnd: z.boolean().default(true),
  reason: plainTextSchema(500).optional(),
});
export type CancelSubscriptionSchema = z.infer<typeof cancelSubscriptionSchema>;

import { z } from 'zod';
import {
  basisPointsSchema,
  countryCodeSchema,
  currencySchema,
  domainSchema,
  emailSchema,
  hexColorSchema,
  localeSchema,
  paginationQuerySchema,
  phoneSchema,
  plainTextSchema,
  slugSchema,
  timezoneSchema,
  urlSchema,
  uuidSchema,
} from './primitives';
import { passwordSchema } from './password.policy';

export const tenantStatusSchema = z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'ARCHIVED']);

export const brandingSchema = z.object({
  appName: plainTextSchema(64),
  logoUrl: urlSchema.nullable().optional(),
  logoDarkUrl: urlSchema.nullable().optional(),
  faviconUrl: urlSchema.nullable().optional(),
  primaryColor: hexColorSchema.default('#1B2A4A'),
  secondaryColor: hexColorSchema.default('#0F172A'),
  accentColor: hexColorSchema.default('#22C55E'),
  backgroundColor: hexColorSchema.default('#FFFFFF'),
  textColor: hexColorSchema.default('#0B1220'),
  fontFamily: plainTextSchema(64).default('Inter'),
  themeMode: z.enum(['light', 'dark', 'system']).default('system'),
  supportEmail: emailSchema.nullable().optional(),
  supportUrl: urlSchema.nullable().optional(),
  termsUrl: urlSchema.nullable().optional(),
  privacyUrl: urlSchema.nullable().optional(),
  /** Custom CSS is sanitised server-side before it is served to browsers. */
  customCss: z.string().max(20000).nullable().optional(),
  socialLinks: z.record(z.string().max(32), urlSchema).default({}),
});
export type BrandingSchema = z.infer<typeof brandingSchema>;

export const updateBrandingSchema = brandingSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'At least one branding field must be provided' },
);
export type UpdateBrandingSchema = z.infer<typeof updateBrandingSchema>;

export const createTenantSchema = z.object({
  slug: slugSchema,
  name: plainTextSchema(120),
  legalName: plainTextSchema(160).optional(),
  contactEmail: emailSchema,
  contactPhone: phoneSchema.optional(),
  countryCode: countryCodeSchema.optional(),
  defaultLocale: localeSchema.default('en'),
  supportedLocales: z.array(localeSchema).min(1).default(['en']),
  defaultCurrency: currencySchema.default('USD'),
  supportedCurrencies: z.array(currencySchema).min(1).default(['USD']),
  timezone: timezoneSchema.default('UTC'),
  platformFeeBps: basisPointsSchema.default(0),
  performanceFeeBps: basisPointsSchema.default(2000),
  maxUsers: z.number().int().positive().max(1_000_000).nullable().default(null),
  maxTraders: z.number().int().positive().max(100_000).nullable().default(null),
  planId: uuidSchema.optional(),
  branding: brandingSchema.partial().optional(),
  owner: z
    .object({
      email: emailSchema,
      password: passwordSchema,
      firstName: plainTextSchema(64).optional(),
      lastName: plainTextSchema(64).optional(),
    })
    .optional(),
});
export type CreateTenantSchema = z.infer<typeof createTenantSchema>;

export const updateTenantSchema = z
  .object({
    name: plainTextSchema(120).optional(),
    legalName: plainTextSchema(160).nullable().optional(),
    contactEmail: emailSchema.optional(),
    contactPhone: phoneSchema.nullable().optional(),
    countryCode: countryCodeSchema.nullable().optional(),
    defaultLocale: localeSchema.optional(),
    supportedLocales: z.array(localeSchema).min(1).optional(),
    defaultCurrency: currencySchema.optional(),
    supportedCurrencies: z.array(currencySchema).min(1).optional(),
    timezone: timezoneSchema.optional(),
    platformFeeBps: basisPointsSchema.optional(),
    performanceFeeBps: basisPointsSchema.optional(),
    maxUsers: z.number().int().positive().max(1_000_000).nullable().optional(),
    maxTraders: z.number().int().positive().max(100_000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateTenantSchema = z.infer<typeof updateTenantSchema>;

export const updateTenantStatusSchema = z.object({
  status: tenantStatusSchema,
  reason: plainTextSchema(500).optional(),
});
export type UpdateTenantStatusSchema = z.infer<typeof updateTenantStatusSchema>;

export const listTenantsQuerySchema = paginationQuerySchema.extend({
  status: tenantStatusSchema.optional(),
  includeDeleted: z.coerce.boolean().default(false),
});
export type ListTenantsQuerySchema = z.infer<typeof listTenantsQuerySchema>;

export const tenantSettingSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z][a-z0-9_.]*$/, 'Setting keys are lowercase dot/underscore separated'),
  value: z.unknown(),
  category: z.string().trim().min(2).max(32).default('general'),
  description: plainTextSchema(240).nullable().optional(),
});
export type TenantSettingSchema = z.infer<typeof tenantSettingSchema>;

export const upsertTenantSettingsSchema = z.object({
  settings: z.array(tenantSettingSchema).min(1).max(50),
});
export type UpsertTenantSettingsSchema = z.infer<typeof upsertTenantSettingsSchema>;

export const createTenantDomainSchema = z.object({
  domain: domainSchema,
  isPrimary: z.boolean().default(false),
});
export type CreateTenantDomainSchema = z.infer<typeof createTenantDomainSchema>;

export const toggleFeatureFlagSchema = z.object({
  enabled: z.boolean(),
  rolloutPercentage: z.number().int().min(0).max(100).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type ToggleFeatureFlagSchema = z.infer<typeof toggleFeatureFlagSchema>;

export const createFeatureFlagSchema = z.object({
  key: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, 'Feature flag keys are lowercase snake_case'),
  name: plainTextSchema(120),
  description: plainTextSchema(500).nullable().optional(),
  isGlobalDefault: z.boolean().default(false),
  rolloutPercentage: z.number().int().min(0).max(100).default(100),
});
export type CreateFeatureFlagSchema = z.infer<typeof createFeatureFlagSchema>;

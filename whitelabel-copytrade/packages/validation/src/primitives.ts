import { z } from 'zod';
import { PAGINATION_DEFAULTS, SUPPORTED_CURRENCIES, SUPPORTED_LOCALES } from '@wlct/config';

export const uuidSchema = z.string().uuid('Must be a valid UUID');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(5, 'Email is too short')
  .max(254, 'Email is too long')
  .email('Must be a valid email address');

/** E.164 phone numbers only, which keeps SMS/2FA providers happy. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, 'Phone must be in E.164 format, e.g. +8801712345678');

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Slug must be at least 3 characters')
  .max(63, 'Slug must be at most 63 characters')
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Slug may contain lowercase letters, digits and hyphens')
  .refine((value) => !value.includes('--'), 'Slug may not contain consecutive hyphens')
  .refine(
    (value) =>
      ![
        'www',
        'api',
        'admin',
        'app',
        'auth',
        'static',
        'assets',
        'cdn',
        'mail',
        'support',
        'status',
        'docs',
      ].includes(value),
    'This slug is reserved',
  );

export const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(
    /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/,
    'Must be a valid fully qualified domain name',
  );

export const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'Must be a hex color, e.g. #1B2A4A');

export const urlSchema = z.string().trim().url('Must be a valid URL').max(2048);

export const localeSchema = z.enum(SUPPORTED_LOCALES);

export const currencySchema = z.enum(SUPPORTED_CURRENCIES);

export const timezoneSchema = z
  .string()
  .trim()
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Must be a valid IANA timezone, e.g. Asia/Dhaka');

export const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(2, 'Must be a 2-letter ISO 3166-1 alpha-2 country code');

export const deviceIdSchema = z
  .string()
  .trim()
  .min(8, 'Device id is too short')
  .max(128, 'Device id is too long')
  .regex(/^[A-Za-z0-9._:-]+$/, 'Device id contains unsupported characters');

export const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6,8}$/, 'Authenticator code must be 6-8 digits');

export const recoveryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/, 'Recovery code format is XXXX-XXXX-XXXX');

export const basisPointsSchema = z
  .number()
  .int('Basis points must be an integer')
  .min(0, 'Basis points cannot be negative')
  .max(10000, 'Basis points cannot exceed 10000 (100%)');

export const decimalStringSchema = z
  .string()
  .trim()
  .regex(/^-?\d{1,18}(\.\d{1,18})?$/, 'Must be a decimal number');

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(PAGINATION_DEFAULTS.PAGE),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGINATION_DEFAULTS.MAX_LIMIT)
    .default(PAGINATION_DEFAULTS.LIMIT),
  sortBy: z.string().trim().max(64).optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().trim().max(128).optional(),
});

export type PaginationQueryInput = z.infer<typeof paginationQuerySchema>;

/** Rejects strings containing HTML tags or script-ish payloads. */
export const plainTextSchema = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => !/<[^>]*>/.test(value), 'HTML markup is not allowed')
    .refine((value) => !/javascript:/i.test(value), 'Unsafe content is not allowed');

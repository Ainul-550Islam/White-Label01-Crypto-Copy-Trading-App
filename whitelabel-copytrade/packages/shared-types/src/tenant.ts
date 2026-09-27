import type { ISODateString, SupportedCurrency, SupportedLocale, UUID } from './common';

export enum TenantStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  ARCHIVED = 'ARCHIVED',
}

export enum TenantDomainStatus {
  PENDING_DNS = 'PENDING_DNS',
  PENDING_CERTIFICATE = 'PENDING_CERTIFICATE',
  ACTIVE = 'ACTIVE',
  FAILED = 'FAILED',
}

export interface TenantBrandingDto {
  id: UUID;
  tenantId: UUID;
  appName: string;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  themeMode: 'light' | 'dark' | 'system';
  supportEmail: string | null;
  supportUrl: string | null;
  termsUrl: string | null;
  privacyUrl: string | null;
  customCss: string | null;
  socialLinks: Record<string, string>;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface TenantSettingDto {
  id: UUID;
  tenantId: UUID;
  key: string;
  value: unknown;
  category: string;
  isSecret: boolean;
  description: string | null;
  updatedAt: ISODateString;
}

export interface TenantDomainDto {
  id: UUID;
  tenantId: UUID;
  domain: string;
  isPrimary: boolean;
  status: TenantDomainStatus;
  verificationToken: string;
  verifiedAt: ISODateString | null;
  createdAt: ISODateString;
}

export interface TenantDto {
  id: UUID;
  slug: string;
  name: string;
  legalName: string | null;
  status: TenantStatus;
  ownerUserId: UUID | null;
  defaultLocale: SupportedLocale;
  supportedLocales: SupportedLocale[];
  defaultCurrency: SupportedCurrency;
  supportedCurrencies: SupportedCurrency[];
  timezone: string;
  contactEmail: string | null;
  contactPhone: string | null;
  countryCode: string | null;
  platformFeeBps: number;
  performanceFeeBps: number;
  maxUsers: number | null;
  maxTraders: number | null;
  branding?: TenantBrandingDto;
  domains?: TenantDomainDto[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
  deletedAt: ISODateString | null;
}

export interface FeatureFlagDto {
  id: UUID;
  key: string;
  name: string;
  description: string | null;
  isGlobalDefault: boolean;
  rolloutPercentage: number;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface TenantFeatureFlagDto {
  id: UUID;
  tenantId: UUID;
  featureFlagId: UUID;
  key: string;
  enabled: boolean;
  rolloutPercentage: number | null;
  metadata: Record<string, unknown>;
  updatedAt: ISODateString;
}

/** Public, unauthenticated bootstrap payload used by mobile + web clients. */
export interface TenantPublicConfigDto {
  tenantId: UUID;
  slug: string;
  name: string;
  status: TenantStatus;
  branding: Omit<TenantBrandingDto, 'tenantId' | 'id' | 'createdAt' | 'updatedAt'>;
  defaultLocale: SupportedLocale;
  supportedLocales: SupportedLocale[];
  defaultCurrency: SupportedCurrency;
  supportedCurrencies: SupportedCurrency[];
  features: Record<string, boolean>;
  registrationEnabled: boolean;
  twoFactorRequired: boolean;
}

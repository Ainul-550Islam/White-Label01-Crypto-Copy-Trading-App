import type { BillingInterval, SubscriptionStatus, PlanLimits, TenantStatus } from '@wlct/shared-types';

/**
 * SaaS control-plane domain types.
 * No duplication of plan definitions - all resolved from canonical catalog.
 */

export enum TenantLifecycleState {
  PENDING = 'PENDING',
  PROVISIONING = 'PROVISIONING',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  PAST_DUE = 'PAST_DUE',
  CANCELED = 'CANCELED',
  DELETED = 'DELETED',
}

export enum ProvisioningState {
  NOT_STARTED = 'NOT_STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  RETRYING = 'RETRYING',
}

export interface SaasTenantSummary {
  id: string;
  slug: string;
  name: string;
  legalName: string | null;
  status: TenantStatus;
  lifecycleState: TenantLifecycleState;
  provisioningState: ProvisioningState;
  contactEmail: string | null;
  countryCode: string | null;
  defaultCurrency: string;
  createdAt: string;
  updatedAt: string;
  subscriptionSummary: SaasSubscriptionSummary | null;
  brandingState: SaasBrandingState | null;
  customDomainState: SaasCustomDomainState | null;
  whiteLabelState: SaasWhiteLabelState | null;
  usageSummary: SaasUsageSummary | null;
}

export interface SaasSubscriptionSummary {
  id: string | null;
  tenantId: string;
  planId: string | null;
  planCode: string | null;
  planName: string | null;
  status: SubscriptionStatus | null;
  interval: BillingInterval | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  isActive: boolean;
  isPastDue: boolean;
  renewalDate: string | null;
  seatsPurchased: number | null;
}

export interface SaasPlanSummary {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price: string;
  currency: string;
  interval: BillingInterval;
  trialDays: number;
  limits: PlanLimits;
  features: string[];
  isActive: boolean;
  sortOrder: number;
  audience: string;
}

export interface SaasEntitlementSummary {
  featureKey: string;
  enabled: boolean;
  source: 'plan_features' | 'plan_limits_boolean' | 'feature_flag' | 'none';
  planCode: string | null;
  subscriptionStatus: string | null;
  reason: string | null;
}

export interface SaasLimitSummary {
  limitKey: string;
  configuredLimit: number | null;
  currentUsage: number;
  remaining: number | null;
  unlimited: boolean;
  percentageUsed: number | null;
  source: 'plan_limits' | 'tenant_override' | 'none';
}

export interface SaasBrandingState {
  tenantId: string;
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
  themeMode: string;
  supportEmail: string | null;
  supportUrl: string | null;
  termsUrl: string | null;
  privacyUrl: string | null;
  hasCustomCss: boolean;
  updatedAt: string | null;
}

export interface SaasCustomDomainState {
  tenantId: string;
  domain: string | null;
  isPrimary: boolean;
  status: string | null;
  verifiedAt: string | null;
  verificationRequired: boolean;
  entitlementAllowed: boolean;
  entitlementReason: string | null;
}

export interface SaasWhiteLabelState {
  tenantId: string;
  eligible: boolean;
  entitlementAllowed: boolean;
  entitlementReason: string | null;
  provisioningState: 'NOT_REQUESTED' | 'REQUESTED' | 'PROVISIONING' | 'ACTIVE' | 'DISABLED' | 'REJECTED';
  requestedAt: string | null;
  enabledAt: string | null;
  configuration: Record<string, unknown> | null;
}

export interface SaasUsageSummary {
  tenantId: string;
  maxUsers: number | null;
  currentUsers: number;
  maxTraders: number | null;
  currentTraders: number;
  apiRequestsPerMinute: number | null;
  websocketConnections: number | null;
}

export interface SaasProvisioningResult {
  tenantId: string;
  tenantSlug: string;
  provisioningState: ProvisioningState;
  subscriptionId: string | null;
  planId: string | null;
  brandingId: string | null;
  message: string;
  idempotent: boolean;
}

export enum SaasAdminAction {
  PROVISION_TENANT = 'PROVISION_TENANT',
  ASSIGN_PLAN = 'ASSIGN_PLAN',
  CHANGE_PLAN = 'CHANGE_PLAN',
  CHANGE_INTERVAL = 'CHANGE_INTERVAL',
  CANCEL_SUBSCRIPTION = 'CANCEL_SUBSCRIPTION',
  SUSPEND_TENANT = 'SUSPEND_TENANT',
  ACTIVATE_TENANT = 'ACTIVATE_TENANT',
  UPDATE_BRANDING = 'UPDATE_BRANDING',
  REGISTER_DOMAIN = 'REGISTER_DOMAIN',
  VERIFY_DOMAIN = 'VERIFY_DOMAIN',
  REMOVE_DOMAIN = 'REMOVE_DOMAIN',
  REQUEST_WHITE_LABEL = 'REQUEST_WHITE_LABEL',
  ENABLE_WHITE_LABEL = 'ENABLE_WHITE_LABEL',
  DISABLE_WHITE_LABEL = 'DISABLE_WHITE_LABEL',
  VIEW_FEATURE_ACCESS = 'VIEW_FEATURE_ACCESS',
}

export interface SaasTenantDetail extends SaasTenantSummary {
  entitlements: SaasEntitlementSummary[];
  limits: SaasLimitSummary[];
  availableActions: SaasAdminAction[];
  billingCustomer: {
    billingName: string | null;
    billingEmail: string | null;
    billingCountry: string | null;
    preferredCurrency: string | null;
  } | null;
  domains: Array<{
    id: string;
    domain: string;
    isPrimary: boolean;
    status: string;
    verifiedAt: string | null;
    createdAt: string;
  }>;
  featureFlags: Array<{
    key: string;
    enabled: boolean;
    value: unknown;
  }>;
}

export interface SaasTenantListFilter {
  status?: TenantStatus;
  planCode?: string;
  search?: string;
  includeDeleted?: boolean;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface SaasTenantListResult {
  items: SaasTenantSummary[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

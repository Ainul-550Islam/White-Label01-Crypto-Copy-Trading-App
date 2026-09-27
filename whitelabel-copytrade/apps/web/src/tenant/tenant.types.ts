/**
 * Tenant/branding/domain/plan/entitlement view models.
 * All data is backend-authoritative, never trusted from arbitrary browser input.
 */

export interface TenantBranding {
  logoUrl?: string;
  faviconUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  backgroundColor?: string;
  textColor?: string;
  fontFamily?: string;
  customCss?: string; // backend-sanitized only
  appName?: string;
  supportEmail?: string;
  supportUrl?: string;
}

export interface TenantPlan {
  id: string;
  name: string;
  tier: string;
  features: string[];
  limits: Record<string, number>;
}

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: string;
  domain?: string;
  customDomain?: string;
  branding?: TenantBranding;
  plan?: TenantPlan;
  entitlements: Record<string, boolean>;
  limits?: Record<string, number>;
  supportEmail?: string;
  supportUrl?: string;
  isCustomDomain?: boolean;
  resolvedVia?: 'custom_domain' | 'subdomain' | 'authenticated_context' | 'platform_default';
}

export interface TenantResolution {
  tenant: Tenant;
  resolvedVia: string;
  isCustomDomain: boolean;
  isPlatformDefault: boolean;
}

export interface EntitlementCheck {
  hasEntitlement: boolean;
  limit?: number;
  usage?: number;
  remaining?: number;
  upgradeRequired?: boolean;
}

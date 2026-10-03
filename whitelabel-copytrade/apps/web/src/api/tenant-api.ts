import { apiClient } from './api-client';
import { ApiError } from './api-errors';

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

export interface TenantInfo {
  id: string;
  slug: string;
  name: string;
  status: string;
  domain?: string;
  customDomain?: string;
  branding?: TenantBranding;
  plan?: {
    id: string;
    name: string;
    tier: string;
  };
  entitlements: Record<string, boolean>;
  limits?: Record<string, number>;
  features?: string[];
}

export interface TenantResolutionResponse {
  tenant: TenantInfo;
  resolvedVia: 'custom_domain' | 'subdomain' | 'authenticated_context' | 'platform_default';
  isCustomDomain: boolean;
}

/**
 * GET /v1/tenants/public-config (TenantPublicConfigDto). @Public on the
 * backend and on the proxy allowlist: the tenant is resolved server-side
 * from the forwarded Host (custom domain or sub-domain), never from input
 * the browser chooses.
 */
interface PublicTenantConfig {
  tenantId: string;
  slug: string;
  name: string;
  status: string;
  branding: Record<string, unknown> | null;
  defaultLocale?: string;
  supportedLocales?: string[];
  defaultCurrency?: string;
  supportedCurrencies?: string[];
  features: Record<string, boolean>;
  registrationEnabled?: boolean;
  twoFactorRequired?: boolean;
}

/** GET /v1/tenants/current (TenantDto) - requires tenant:read. */
interface CurrentTenant {
  id: string;
  slug: string;
  name: string;
  status: string;
  branding?: Record<string, unknown> | null;
  domains?: Array<{ domain: string; isPrimary?: boolean; verifiedAt?: string | null; status?: string }>;
}

const BRANDING_KEYS: ReadonlyArray<keyof TenantBranding> = [
  'logoUrl',
  'faviconUrl',
  'primaryColor',
  'secondaryColor',
  'accentColor',
  'backgroundColor',
  'textColor',
  'fontFamily',
  'customCss',
  'appName',
  'supportEmail',
  'supportUrl',
];

/** Backend branding uses null for "not set"; the UI treats absent as not set. */
export function toBranding(raw: Record<string, unknown> | null | undefined): TenantBranding | undefined {
  if (!raw) return undefined;
  const branding: TenantBranding = {};
  for (const key of BRANDING_KEYS) {
    const value = raw[key];
    if (typeof value === 'string' && value.length > 0) {
      branding[key] = value;
    }
  }
  return branding;
}

export function toTenantInfo(config: PublicTenantConfig): TenantInfo {
  const branding = toBranding(config.branding);
  return {
    id: config.tenantId,
    slug: config.slug,
    name: config.name,
    status: config.status,
    branding,
    entitlements: config.features ?? {},
    features: Object.entries(config.features ?? {})
      .filter(([, enabled]) => enabled)
      .map(([key]) => key),
  };
}

/**
 * The backend does not report which rule matched, so this is derived from
 * the host for display only. Security never depends on it: the tenant itself
 * always comes from backend resolution.
 */
export function describeResolution(
  host: string | undefined,
  slug: string
): Pick<TenantResolutionResponse, 'resolvedVia' | 'isCustomDomain'> {
  const hostname = ((host ?? '').split(':')[0] ?? '').toLowerCase();
  if (!hostname || hostname === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    return { resolvedVia: 'platform_default', isCustomDomain: false };
  }
  if ((hostname.split('.')[0] ?? '') === slug.toLowerCase()) {
    return { resolvedVia: 'subdomain', isCustomDomain: false };
  }
  return { resolvedVia: 'custom_domain', isCustomDomain: true };
}

async function getPublicConfig(): Promise<PublicTenantConfig> {
  return apiClient.get<PublicTenantConfig>('/v1/tenants/public-config');
}

export const tenantApi = {
  /**
   * Resolves the tenant for the current host before sign-in. The `host`
   * argument is only used to describe how it was resolved; the proxy forwards
   * the real Host header and the backend decides the tenant.
   */
  resolve: async (host?: string): Promise<TenantResolutionResponse> => {
    const config = await getPublicConfig();
    const tenant = toTenantInfo(config);
    return { tenant, ...describeResolution(host, tenant.slug) };
  },

  /**
   * Organisation of the signed-in user. Tenant administrators get the full
   * record; customers (no tenant:read) get the public configuration of the
   * same tenant instead of a 403.
   */
  getCurrent: async (): Promise<TenantInfo> => {
    const config = await getPublicConfig();
    const base = toTenantInfo(config);
    try {
      const current = await apiClient.get<CurrentTenant>('/v1/tenants/current');
      const primary = current.domains?.find((d) => d.isPrimary) ?? current.domains?.[0];
      return {
        ...base,
        id: current.id,
        slug: current.slug,
        name: current.name,
        status: current.status,
        branding: toBranding(current.branding) ?? base.branding,
        customDomain: primary?.domain,
      };
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        return base;
      }
      throw err;
    }
  },

  getBranding: async (): Promise<TenantBranding> => {
    const config = await getPublicConfig();
    return toBranding(config.branding) ?? {};
  },

  getEntitlements: async (): Promise<Record<string, boolean>> => {
    const config = await getPublicConfig();
    return config.features ?? {};
  },

  /**
   * Numeric plan limits of the organisation's subscription
   * (GET /v1/billing/subscription/limits, subscription:read). The backend
   * mixes numbers and boolean capabilities and returns null without an active
   * subscription; only the numeric limits are returned here.
   */
  getLimits: async (): Promise<Record<string, number>> => {
    const raw = await apiClient.get<Record<string, number | boolean | null> | null>('/v1/billing/subscription/limits');
    const limits: Record<string, number> = {};
    for (const [key, value] of Object.entries(raw ?? {})) {
      if (typeof value === 'number') limits[key] = value;
    }
    return limits;
  },
};

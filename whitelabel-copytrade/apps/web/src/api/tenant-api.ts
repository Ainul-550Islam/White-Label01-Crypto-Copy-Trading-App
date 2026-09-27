import { apiClient } from './api-client';

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

export const tenantApi = {
  resolve: (host?: string) =>
    apiClient.get<TenantResolutionResponse>('/v1/tenants/resolve', {
      searchParams: host ? { host } : {},
    }),

  getCurrent: () => apiClient.get<TenantInfo>('/v1/tenants/current'),

  getBranding: () => apiClient.get<TenantBranding>('/v1/tenants/current/branding'),

  getEntitlements: () => apiClient.get<Record<string, boolean>>('/v1/tenants/current/entitlements'),

  getLimits: () => apiClient.get<Record<string, number>>('/v1/tenants/current/limits'),
};

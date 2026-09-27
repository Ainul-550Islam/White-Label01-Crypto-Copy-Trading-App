'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Tenant } from './tenant.types';
import { tenantApi } from '@/api/tenant-api';
import { ApiError } from '@/api/api-errors';

/**
 * Resolves current tenant safely from authenticated backend context/custom domain
 * without trusting arbitrary browser input.
 * Tenant resolution flow:
 * Request Host → Domain Resolution → Backend Tenant Resolution → Authenticated Session → Tenant Ownership Validation → Branding → Entitlements
 */

interface TenantContextValue {
  tenant: Tenant | null;
  isLoading: boolean;
  error: string | null;
  isCustomDomain: boolean;
  resolvedVia: string | null;
  refreshTenant: () => Promise<void>;
}

const TenantContext = createContext<TenantContextValue>({
  tenant: null,
  isLoading: true,
  error: null,
  isCustomDomain: false,
  resolvedVia: null,
  refreshTenant: async () => {},
});

export function useTenant(): TenantContextValue {
  const ctx = useContext(TenantContext);
  if (!ctx) {
    throw new Error('useTenant must be used within TenantProvider');
  }
  return ctx;
}

interface TenantProviderProps {
  children: ReactNode;
}

export function TenantProvider({ children }: TenantProviderProps): JSX.Element {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isCustomDomain, setIsCustomDomain] = useState<boolean>(false);
  const [resolvedVia, setResolvedVia] = useState<string | null>(null);

  const resolveTenant = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Never resolve tenant solely from localStorage, query param, client header, or path param
      // Always verify via backend authoritative resolution
      const host = typeof window !== 'undefined' ? window.location.host : undefined;
      const resolution = await tenantApi.resolve(host);
      
      // Validate tenant ownership via authenticated session is done server-side
      // Frontend only displays backend-verified tenant
      setTenant(resolution.tenant as unknown as Tenant);
      setIsCustomDomain(resolution.isCustomDomain);
      setResolvedVia(resolution.resolvedVia);
    } catch (err) {
      const apiErr = err as ApiError;
      // If tenant resolution fails, try fallback to current tenant from authenticated context
      try {
        const current = await tenantApi.getCurrent();
        setTenant(current as unknown as Tenant);
        setIsCustomDomain(false);
        setResolvedVia('authenticated_context');
      } catch {
        setError(apiErr.getUserMessage());
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    resolveTenant();
  }, []);

  return (
    <TenantContext.Provider
      value={{
        tenant,
        isLoading,
        error,
        isCustomDomain,
        resolvedVia,
        refreshTenant: resolveTenant,
      }}
    >
      {children}
    </TenantContext.Provider>
  );
}

export function useEntitlement(feature: string): boolean {
  const { tenant } = useTenant();
  if (!tenant) return false;
  return tenant.entitlements[feature] ?? false;
}

export function useTenantBranding(): Tenant['branding'] | null {
  const { tenant } = useTenant();
  return tenant?.branding ?? null;
}

'use client';

import { ReactNode, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext, clearSensitiveSessionState } from '@/auth/auth.store';
import { Session } from '@/auth/auth.types';
import { authApi } from '@/api/auth-api';
import { ApiError } from '@/api/api-errors';
import { TenantProvider } from '@/tenant/tenant-context';
import { TenantBrandingProvider } from '@/tenant/tenant-branding';
import { ErrorBoundary } from './error-boundary';
import { getRuntimeConfig } from '@/config/runtime-config';
import { trackPageView } from '@/telemetry/web-telemetry';

/**
 * Root application composition, providers, router, error boundary,
 * authentication bootstrap, tenant bootstrap, and global lifecycle handling.
 */

const config = getRuntimeConfig();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: config.queryStaleTimeMs,
      gcTime: config.queryGcTimeMs,
      retry: (failureCount, error: unknown) => {
        const apiErr = error as ApiError;
        if (apiErr?.status === 401 || apiErr?.status === 403 || apiErr?.status === 404) return false;
        return failureCount < 2;
      },
    },
  },
});

function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refreshSession = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await authApi.getSession();
      setSession({
        user: {
          id: res.user.id,
          email: res.user.email,
          tenantId: res.user.tenantId,
          roles: res.user.roles,
          displayName: res.user.displayName,
        },
        tenant: res.tenant,
        entitlements: res.entitlements,
        isAuthenticated: true,
      });
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.status === 401) {
        setSession(null);
      } else {
        setError(apiErr.getUserMessage());
      }
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } catch {
      // ignore
    } finally {
      clearSensitiveSessionState();
      setSession(null);
      window.location.href = '/login';
    }
  };

  useEffect(() => {
    refreshSession();
  }, []);

  useEffect(() => {
    // Global lifecycle: track page views with correlation
    if (typeof window !== 'undefined') {
      trackPageView(window.location.pathname);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ session, isLoading, isAuthenticated: !!session, error, refreshSession, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function App({ children }: { children: ReactNode }): JSX.Element {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TenantProvider>
          <TenantBrandingProvider>
            <AuthProvider>{children}</AuthProvider>
          </TenantBrandingProvider>
        </TenantProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

// Re-export AuthProvider for backward compat
export { AuthProvider };

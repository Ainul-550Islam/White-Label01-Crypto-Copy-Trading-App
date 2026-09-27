'use client';

import { ReactNode, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './auth.store';

/**
 * Protected-route authorization UX. Backend remains authoritative.
 * Frontend route guards are UX only, not security boundary.
 */

interface AuthGuardProps {
  children: ReactNode;
  requireAuth?: boolean;
  requireEntitlement?: string;
  requireRole?: string[];
  fallback?: ReactNode;
}

export function AuthGuard({
  children,
  requireAuth = true,
  requireEntitlement,
  requireRole,
  fallback,
}: AuthGuardProps): JSX.Element {
  const { session, isLoading, isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && requireAuth && !isAuthenticated) {
      router.replace('/login');
    }
  }, [isLoading, isAuthenticated, requireAuth, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-sm text-muted">Loading session...</div>
      </div>
    );
  }

  if (requireAuth && !isAuthenticated) {
    return (fallback as JSX.Element) ?? (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-sm">Redirecting to login...</div>
      </div>
    );
  }

  if (requireEntitlement && session) {
    const hasEntitlement = session.entitlements[requireEntitlement];
    if (!hasEntitlement) {
      return (
        <div className="flex min-h-[50vh] items-center justify-center p-8">
          <div className="text-center">
            <h2 className="text-lg font-semibold">Feature not available</h2>
            <p className="mt-2 text-sm text-muted">
              This feature requires an upgraded plan. Please check your billing page.
            </p>
          </div>
        </div>
      );
    }
  }

  if (requireRole && requireRole.length > 0 && session) {
    const hasRole = requireRole.some((r) => session.user.roles.includes(r));
    if (!hasRole) {
      return (
        <div className="flex min-h-[50vh] items-center justify-center p-8">
          <div className="text-center">
            <h2 className="text-lg font-semibold">Access denied</h2>
            <p className="mt-2 text-sm text-muted">You do not have permission to access this page.</p>
          </div>
        </div>
      );
    }
  }

  return <>{children}</>;
}

export function PublicOnlyGuard({ children }: { children: ReactNode }): JSX.Element {
  const { isLoading, isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace('/dashboard');
    }
  }, [isLoading, isAuthenticated, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-sm text-muted">Loading...</div>
      </div>
    );
  }

  if (isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-sm">Redirecting to dashboard...</div>
      </div>
    );
  }

  return <>{children}</>;
}

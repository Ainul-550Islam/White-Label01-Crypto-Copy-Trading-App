'use client';

import { ReactNode } from 'react';
import { useTenant } from '@/tenant/tenant-context';
import Link from 'next/link';

/**
 * UX-level entitlement presentation using backend-resolved entitlement data.
 * Backend remains authoritative; this is UX only.
 */

interface EntitlementGateProps {
  feature: string;
  children: ReactNode;
  fallback?: ReactNode;
  showUpgrade?: boolean;
}

export function EntitlementGate({ feature, children, fallback, showUpgrade = true }: EntitlementGateProps): JSX.Element {
  const { tenant } = useTenant();
  const hasEntitlement = tenant?.entitlements[feature] ?? false;

  if (hasEntitlement) {
    return <>{children}</>;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  if (showUpgrade) {
    return (
      <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-6 text-center">
        <h3 className="font-semibold">Upgrade Required</h3>
        <p className="mt-2 text-sm text-muted">
          This feature requires an upgraded plan. Your current plan does not include <strong>{feature}</strong>.
        </p>
        <Link href="/billing/plans" className="mt-4 inline-block rounded bg-primary px-4 py-2 text-sm font-medium text-white">
          View Plans
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded border p-4 text-center text-sm text-muted">
      Feature <strong>{feature}</strong> not available in current plan.
    </div>
  );
}

export function useHasEntitlement(feature: string): boolean {
  const { tenant } = useTenant();
  return tenant?.entitlements[feature] ?? false;
}

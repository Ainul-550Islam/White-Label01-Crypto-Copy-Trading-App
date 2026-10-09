import type { JSX } from 'react';
import type { Metadata } from 'next';

import { getConsoleClaims, hasPermission } from '@/lib/console-claims';
import PlanCatalogManagement from '@/modules/billing/plans/plan-catalog-management';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Plan catalogue' };

/**
 * Round 7: the plan catalogue over /v1/billing/plans. Listing needs plan:read;
 * the create / edit / activate / deactivate / archive controls are rendered
 * only for plan:manage holders, and the API enforces the same permission (and
 * platform-vs-tenant ownership of each plan) on every write regardless.
 */
export default async function PlansPage(): Promise<JSX.Element> {
  const claims = await getConsoleClaims();
  return <PlanCatalogManagement canManage={hasPermission(claims, 'plan:manage')} />;
}

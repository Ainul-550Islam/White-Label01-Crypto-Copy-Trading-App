import type { Metadata } from 'next';

import OwnPlanLimitsPanel from '@/modules/billing/entitlements/own-plan-limits-panel';
import BillingPortalPage from '@/modules/billing/portal/billing-portal-page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Billing' };

/**
 * Round 7: the organisation's billing portal (overview, invoices, payments,
 * usage) followed by the plan limits the API enforces. Data comes from
 * /v1/billing/portal/* and /v1/billing/subscription/limits; the API requires
 * subscription:read for all of it and scopes everything to the caller's tenant.
 */
export default function BillingPage(): JSX.Element {
  return (
    <>
      <BillingPortalPage />
      <OwnPlanLimitsPanel />
    </>
  );
}

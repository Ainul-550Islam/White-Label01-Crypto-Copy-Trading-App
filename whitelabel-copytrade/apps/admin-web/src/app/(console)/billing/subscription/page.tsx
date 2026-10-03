import type { Metadata } from 'next';

import SubscriptionManagementPage from '@/modules/billing/portal/subscription-management';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Manage subscription' };

/**
 * Round 7: cancel, resume, change plan and change interval through
 * /v1/billing/portal/subscription/*. Every write needs subscription:manage
 * and is decided by the API.
 */
export default function BillingSubscriptionPage(): JSX.Element {
  return <SubscriptionManagementPage />;
}

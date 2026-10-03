import type { Metadata } from 'next';

import PlanComparisonPage from '@/modules/billing/portal/plan-comparison';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Compare plans' };

/**
 * Round 7: plan comparison and upgrade. Starting a checkout needs
 * subscription:manage; the API decides provider and price, never the browser.
 * It is also the cancel URL of every checkout the portal starts.
 */
export default function BillingPlansPage(): JSX.Element {
  return <PlanComparisonPage />;
}

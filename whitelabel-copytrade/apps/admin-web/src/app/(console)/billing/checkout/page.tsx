import type { Metadata } from 'next';
import Link from 'next/link';

import { ErrorNotice } from '@/components/ui';
import CheckoutPage from '@/modules/billing/portal/checkout-page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Checkout' };

/**
 * Round 7: two entry points share this route.
 *  - /billing/checkout?planId=<id> starts a checkout for that plan;
 *  - the provider redirects back to /billing/checkout?checkout_id=<id>
 *    (or payment_id / session_id), and CheckoutPage asks the API for the real
 *    payment state - the query string itself is never trusted as success.
 * With neither, there is nothing to do, so the page says so.
 */
export default function BillingCheckoutPage({
  searchParams,
}: {
  searchParams: { planId?: string; checkout_id?: string; payment_id?: string; session_id?: string };
}): JSX.Element {
  const planId = typeof searchParams.planId === 'string' ? searchParams.planId.trim() : '';
  const returning = Boolean(searchParams.checkout_id || searchParams.payment_id || searchParams.session_id);

  if (!planId && !returning) {
    return (
      <div className="p-6 space-y-4">
        <ErrorNotice title="No plan selected" message="Choose a plan first, then start the checkout from there." />
        <Link href="/billing/plans" className="text-sm text-blue-600 hover:underline">
          Compare plans
        </Link>
      </div>
    );
  }

  return <CheckoutPage planId={planId} />;
}

'use client';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { billingApi } from '@/api/billing-api';
import { ApiError } from '@/api/api-errors';
import { PageContainer } from '@/layout/page-container';
export function CheckoutPage(): JSX.Element {
  const searchParams = useSearchParams();
  const planId = searchParams.get('planId') ?? '';
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const handleCheckout = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await billingApi.createCheckout({ planId, successUrl: window.location.origin + '/billing', cancelUrl: window.location.origin + '/billing/plans' });
      window.location.href = res.checkoutUrl;
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr.getUserMessage());
    } finally {
      setLoading(false);
    }
  };
  return (
    <PageContainer title="Checkout" description="Real backend checkout flow, no hardcoded prices">
      <div className="max-w-md rounded border bg-card p-4">
        <p className="text-sm">Plan ID: {planId}</p>
        <p className="mt-1 text-xs text-muted">You will be redirected to secure checkout. Prices are backend-authoritative.</p>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <button onClick={handleCheckout} disabled={loading || !planId} className="mt-4 w-full rounded bg-primary px-4 py-2 text-sm text-white disabled:opacity-50">{loading ? 'Redirecting...' : 'Proceed to Checkout'}</button>
      </div>
    </PageContainer>
  );
}

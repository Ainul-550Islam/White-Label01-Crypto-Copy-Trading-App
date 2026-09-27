'use client';

import React, { useEffect, useState } from 'react';
import { createCheckoutSession, getCheckoutStatus, getPaymentStatus } from './billing-portal-api';

/**
 * Checkout page that creates backend checkout session and redirects to provider.
 * After redirect, verifies actual payment/subscription state from backend.
 * Never trusts ?success=true alone.
 */
export default function CheckoutPage({ planId, onClose }: { planId: string; onClose?: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<any>(null);
  const [verificationState, setVerificationState] = useState<'idle' | 'pending' | 'verifying' | 'success' | 'failed' | 'cancelled' | 'expired'>('idle');
  const [paymentId, setPaymentId] = useState<string | null>(null);

  // Check if returning from provider
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkoutId = params.get('checkout_id') || params.get('payment_id') || params.get('session_id');
    const paymentIdParam = params.get('payment_id');

    if (checkoutId || paymentIdParam) {
      const id = checkoutId || paymentIdParam;
      if (id) {
        setPaymentId(id);
        setVerificationState('verifying');
        verifyPayment(id);
      }
    }
  }, []);

  const verifyPayment = async (id: string) => {
    setVerificationState('verifying');
    try {
      // Always call backend to verify actual payment state
      const status = await getCheckoutStatus(id);
      const paymentStatus = await getPaymentStatus(id).catch(() => null);

      if (status.status === 'COMPLETED' || status.paymentStatus === 'SUCCEEDED' || paymentStatus?.status === 'SUCCEEDED') {
        setVerificationState('success');
      } else if (status.status === 'FAILED' || status.paymentStatus === 'FAILED') {
        setVerificationState('failed');
      } else if (status.status === 'CANCELLED' || status.paymentStatus === 'CANCELLED') {
        setVerificationState('cancelled');
      } else if (status.status === 'EXPIRED' || status.paymentStatus === 'EXPIRED') {
        setVerificationState('expired');
      } else {
        setVerificationState('pending');
        // Poll for pending
        setTimeout(() => verifyPayment(id), 3000);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to verify payment');
      setVerificationState('failed');
    }
  };

  const handleCreateCheckout = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await createCheckoutSession({
        planId,
        successUrl: `${window.location.origin}/billing/checkout?checkout_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${window.location.origin}/billing/plans`,
      });

      setCheckout(result);
      setPaymentId(result.paymentId || result.checkoutId);

      // Redirect to provider checkout URL - backend decides provider/price
      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
      } else {
        setError('No checkout URL returned');
      }
    } catch (e: any) {
      setError(e.message || 'Failed to create checkout');
    } finally {
      setLoading(false);
    }
  };

  // Verification states UI
  if (verificationState !== 'idle') {
    return (
      <div className="p-6 max-w-md mx-auto">
        <div className="bg-white border rounded-lg p-6 text-center">
          {verificationState === 'verifying' && (
            <>
              <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4" />
              <h3 className="font-semibold">Verifying payment...</h3>
              <p className="text-sm text-gray-500 mt-1">Checking backend payment state, please wait</p>
              <p className="text-xs text-gray-400 mt-2">Payment ID: {paymentId}</p>
            </>
          )}
          {verificationState === 'pending' && (
            <>
              <div className="h-8 w-8 bg-yellow-100 rounded-full mx-auto mb-4 flex items-center justify-center">⏳</div>
              <h3 className="font-semibold">Payment pending</h3>
              <p className="text-sm text-gray-500 mt-1">Provider is processing your payment</p>
              <button onClick={() => paymentId && verifyPayment(paymentId)} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded text-sm">Refresh Status</button>
            </>
          )}
          {verificationState === 'success' && (
            <>
              <div className="h-8 w-8 bg-green-100 rounded-full mx-auto mb-4 flex items-center justify-center text-green-600">✓</div>
              <h3 className="font-semibold text-green-800">Payment successful!</h3>
              <p className="text-sm text-gray-600 mt-1">Your subscription has been updated. Verified from backend.</p>
              <button onClick={() => (window.location.href = '/billing')} className="mt-4 px-4 py-2 bg-green-600 text-white rounded text-sm">Go to Billing</button>
            </>
          )}
          {verificationState === 'failed' && (
            <>
              <div className="h-8 w-8 bg-red-100 rounded-full mx-auto mb-4 flex items-center justify-center text-red-600">✗</div>
              <h3 className="font-semibold text-red-800">Payment failed</h3>
              <p className="text-sm text-gray-500 mt-1">Your payment could not be processed</p>
              {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
              <div className="mt-4 flex gap-2 justify-center">
                <button onClick={() => setVerificationState('idle')} className="px-4 py-2 bg-blue-600 text-white rounded text-sm">Try Again</button>
                <button onClick={() => (window.location.href = '/billing')} className="px-4 py-2 border rounded text-sm">Back to Billing</button>
              </div>
            </>
          )}
          {verificationState === 'cancelled' && (
            <>
              <h3 className="font-semibold">Payment cancelled</h3>
              <p className="text-sm text-gray-500 mt-1">You cancelled the checkout</p>
              <button onClick={() => (window.location.href = '/billing/plans')} className="mt-4 px-4 py-2 bg-gray-600 text-white rounded text-sm">Back to Plans</button>
            </>
          )}
          {verificationState === 'expired' && (
            <>
              <h3 className="font-semibold">Checkout expired</h3>
              <p className="text-sm text-gray-500 mt-1">This checkout session has expired</p>
              <button onClick={() => setVerificationState('idle')} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded text-sm">Create New Checkout</button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-md mx-auto">
      <div className="bg-white border rounded-lg p-6">
        <h2 className="text-xl font-bold mb-4">Secure Checkout</h2>
        <p className="text-sm text-gray-600 mb-4">You will be redirected to our secure payment provider. Your plan price is determined by backend catalog, never by frontend.</p>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700 mb-4">{error}</div>
        )}

        {checkout ? (
          <div className="space-y-3 text-sm">
            <p><span className="text-gray-500">Plan:</span> {checkout.planName} ({checkout.planCode})</p>
            <p><span className="text-gray-500">Amount:</span> {checkout.amount} {checkout.currency}</p>
            <p><span className="text-gray-500">Provider:</span> {checkout.provider}</p>
            <p><span className="text-gray-500">Status:</span> {checkout.status}</p>
            {checkout.checkoutUrl && (
              <a href={checkout.checkoutUrl} className="block mt-4 w-full text-center py-2 bg-blue-600 text-white rounded">Go to Provider Checkout</a>
            )}
          </div>
        ) : (
          <>
            <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs text-blue-800 mb-4">
              <p>🔒 Secure checkout via backend. Provider secrets never exposed to frontend.</p>
              <p className="mt-1">After payment, we verify actual payment state from backend - never trust URL params alone.</p>
            </div>
            <button
              onClick={handleCreateCheckout}
              disabled={loading}
              className="w-full py-3 bg-blue-600 text-white rounded font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Creating secure checkout...' : 'Proceed to Secure Checkout'}
            </button>
            {onClose && (
              <button onClick={onClose} className="w-full mt-2 py-2 border rounded text-sm">Cancel</button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

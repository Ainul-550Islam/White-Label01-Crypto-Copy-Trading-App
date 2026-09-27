'use client';

import React, { useEffect, useState } from 'react';
import {
  getCurrentSubscription,
  getAvailablePlans,
  cancelSubscription,
  resumeSubscription,
  changePlan,
  changeInterval,
  createCheckoutSession,
} from './billing-portal-api';

/**
 * Admin-web subscription management UI.
 * All mutations via authenticated backend APIs, never direct frontend state mutation.
 */
export default function SubscriptionManagementPage() {
  const [subscriptionState, setSubscriptionState] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [subState, plansRes] = await Promise.all([getCurrentSubscription(), getAvailablePlans()]);
      setSubscriptionState(subState);
      setPlans(plansRes.plans || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load subscription');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCancel = async () => {
    setActionLoading('cancel');
    setMessage(null);
    try {
      const result = await cancelSubscription({ reason: cancelReason, atPeriodEnd: true });
      setMessage(`Subscription will cancel at ${result.effectiveAt ? new Date(result.effectiveAt).toLocaleDateString() : 'period end'}`);
      setShowCancelDialog(false);
      await fetchData();
    } catch (e: any) {
      setMessage(`Cancel failed: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleResume = async () => {
    setActionLoading('resume');
    setMessage(null);
    try {
      const result = await resumeSubscription();
      setMessage(result.message || 'Subscription resumed');
      await fetchData();
    } catch (e: any) {
      setMessage(`Resume failed: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleChangePlan = async (planId: string) => {
    setActionLoading(`plan_${planId}`);
    setMessage(null);
    try {
      const result = await changePlan({ planId, atPeriodEnd: false });
      if (result.requiresCheckout) {
        setMessage(`Upgrade requires checkout. Price delta: ${result.priceDelta}. Creating checkout...`);
        const checkout = await createCheckoutSession({
          planId,
          successUrl: window.location.origin + '/billing?checkout_success=true',
          cancelUrl: window.location.origin + '/billing/subscription',
        });
        if (checkout.checkoutUrl) {
          window.location.href = checkout.checkoutUrl;
          return;
        }
      }
      setMessage(result.message || 'Plan changed successfully');
      await fetchData();
    } catch (e: any) {
      setMessage(`Plan change failed: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleChangeInterval = async (newInterval: string) => {
    setActionLoading(`interval_${newInterval}`);
    setMessage(null);
    try {
      const result = await changeInterval({ newInterval, atPeriodEnd: true });
      setMessage(result.message || `Interval change to ${newInterval} scheduled`);
      await fetchData();
    } catch (e: any) {
      setMessage(`Interval change failed: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3" />
          <div className="h-32 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded p-4">
          <p className="text-red-800">{error}</p>
          <button onClick={fetchData} className="mt-2 px-3 py-1 bg-red-600 text-white rounded text-sm">Retry</button>
        </div>
      </div>
    );
  }

  const sub = subscriptionState?.subscription;
  const canCancel = subscriptionState?.canCancel;
  const canResume = subscriptionState?.canResume;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Subscription Management</h1>

      {message && <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-800">{message}</div>}

      {/* Current State */}
      <div className="bg-white border rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">Current Subscription</h2>
        {sub ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-gray-500">Plan</p>
              <p className="font-medium">{sub.plan?.name || sub.planId}</p>
            </div>
            <div>
              <p className="text-gray-500">Status</p>
              <p className="font-medium">{sub.status}</p>
              {sub.cancelAtPeriodEnd && <p className="text-xs text-orange-600">Cancels at period end</p>}
            </div>
            <div>
              <p className="text-gray-500">Current Period End</p>
              <p className="font-medium">{sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleDateString() : 'N/A'}</p>
            </div>
            <div>
              <p className="text-gray-500">Interval</p>
              <p className="font-medium">{sub.plan?.interval || 'N/A'}</p>
            </div>
            <div>
              <p className="text-gray-500">Seats</p>
              <p className="font-medium">{sub.seatsPurchased || 1}</p>
            </div>
          </div>
        ) : (
          <p className="text-gray-500 text-sm">No active subscription</p>
        )}
      </div>

      {/* Actions */}
      <div className="bg-white border rounded-lg p-6">
        <h3 className="font-semibold mb-4">Available Actions</h3>
        <div className="flex flex-wrap gap-3">
          {canCancel && (
            <button onClick={() => setShowCancelDialog(true)} disabled={!!actionLoading} className="px-4 py-2 bg-red-600 text-white rounded text-sm hover:bg-red-700 disabled:opacity-50">
              Cancel at Period End
            </button>
          )}
          {canResume && (
            <button onClick={handleResume} disabled={!!actionLoading} className="px-4 py-2 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50">
              {actionLoading === 'resume' ? 'Resuming...' : 'Resume Subscription'}
            </button>
          )}
          {subscriptionState?.effectiveActions?.map((action: string) => (
            <span key={action} className="px-3 py-1 bg-gray-100 text-gray-700 rounded text-xs border">{action}</span>
          ))}
        </div>

        {showCancelDialog && (
          <div className="mt-6 border-t pt-4">
            <h4 className="font-medium mb-2">Confirm Cancellation</h4>
            <p className="text-sm text-gray-600 mb-3">Your subscription will remain active until the end of the current billing period.</p>
            <input
              type="text"
              placeholder="Reason (optional)"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm mb-3"
            />
            <div className="flex gap-2">
              <button onClick={handleCancel} disabled={actionLoading === 'cancel'} className="px-4 py-2 bg-red-600 text-white rounded text-sm disabled:opacity-50">
                {actionLoading === 'cancel' ? 'Cancelling...' : 'Confirm Cancel at Period End'}
              </button>
              <button onClick={() => setShowCancelDialog(false)} className="px-4 py-2 border rounded text-sm">Keep Subscription</button>
            </div>
          </div>
        )}
      </div>

      {/* Change Plan */}
      <div className="bg-white border rounded-lg p-6">
        <h3 className="font-semibold mb-4">Change Plan</h3>
        <p className="text-sm text-gray-600 mb-4">All plan data from canonical catalog, no hardcoded pricing. Payment required for upgrades handled via secure checkout.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans.map((plan: any) => (
            <div key={plan.id} className={`border rounded p-4 ${sub?.planId === plan.id ? 'border-blue-500 bg-blue-50' : ''}`}>
              <p className="font-medium">{plan.name}</p>
              <p className="text-sm text-gray-500">{plan.code} - {plan.interval}</p>
              <p className="text-lg font-bold mt-2">{plan.price} {plan.currency}</p>
              {sub?.planId !== plan.id ? (
                <button onClick={() => handleChangePlan(plan.id)} disabled={!!actionLoading} className="mt-3 w-full py-1.5 bg-blue-600 text-white rounded text-sm disabled:opacity-50">
                  {actionLoading === `plan_${plan.id}` ? 'Processing...' : 'Change to this Plan'}
                </button>
              ) : (
                <span className="mt-3 block w-full text-center py-1.5 bg-gray-100 text-gray-500 rounded text-sm">Current</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Change Interval */}
      <div className="bg-white border rounded-lg p-6">
        <h3 className="font-semibold mb-4">Change Billing Interval</h3>
        <div className="flex gap-2">
          {['MONTHLY', 'QUARTERLY', 'YEARLY'].map((interval) => (
            <button
              key={interval}
              onClick={() => handleChangeInterval(interval)}
              disabled={!!actionLoading || sub?.plan?.interval === interval}
              className={`px-4 py-2 rounded text-sm ${sub?.plan?.interval === interval ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-white border hover:bg-gray-50'}`}
            >
              {actionLoading === `interval_${interval}` ? '...' : interval}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-2">Interval changes take effect at period end per existing subscription semantics</p>
      </div>
    </div>
  );
}

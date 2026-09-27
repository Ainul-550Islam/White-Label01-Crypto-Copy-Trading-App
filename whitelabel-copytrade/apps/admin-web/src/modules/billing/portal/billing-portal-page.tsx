'use client';

import React, { useEffect, useState } from 'react';
import {
  getBillingOverview,
  listInvoices,
  listPayments,
} from './billing-portal-api';

/**
 * Main SaaS billing dashboard: current plan, subscription status, usage,
 * invoices, payment history, and available actions.
 * No hardcoded plan data - all from API.
 */
export default function BillingPortalPage() {
  const [overview, setOverview] = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [ov, invRes, payRes] = await Promise.all([
        getBillingOverview(),
        listInvoices({ limit: 5 }),
        listPayments({ limit: 5 }),
      ]);
      setOverview(ov);
      setInvoices(invRes.invoices || []);
      setPayments(payRes.payments || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load billing data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3" />
          <div className="h-32 bg-gray-200 rounded" />
          <div className="h-48 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded p-4">
          <h3 className="text-red-800 font-medium">Error loading billing data</h3>
          <p className="text-red-600 text-sm mt-1">{error}</p>
          <button onClick={fetchData} className="mt-3 px-4 py-2 bg-red-600 text-white rounded text-sm">Retry</button>
        </div>
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <p className="text-gray-500">No billing data available</p>
          <button onClick={fetchData} className="mt-2 text-blue-600 text-sm">Refresh</button>
        </div>
      </div>
    );
  }

  const sub = overview.subscription;
  const currentPlan = overview.currentPlan;
  const usage = overview.usage;
  const isInactive = !sub?.isActive;

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Billing & Subscription</h1>
        <button onClick={fetchData} className="text-sm text-gray-600 hover:text-gray-900">Refresh</button>
      </div>

      {/* Current Subscription */}
      <div className="bg-white border rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">Current Subscription</h2>
        {isInactive ? (
          <div className="bg-yellow-50 border border-yellow-200 rounded p-4">
            <p className="text-yellow-800">No active subscription</p>
            <p className="text-yellow-600 text-sm mt-1">Choose a plan to get started</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-gray-500">Plan</p>
              <p className="font-medium">{currentPlan?.name || sub.planName || 'Unknown'}</p>
              <p className="text-xs text-gray-400">{sub.planCode}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Status</p>
              <span className={`inline-flex px-2 py-1 rounded text-xs font-medium ${sub.isActive ? 'bg-green-100 text-green-800' : sub.isPastDue ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'}`}>
                {sub.status || 'UNKNOWN'}
              </span>
              {sub.willCancelAtPeriodEnd && <p className="text-xs text-orange-600 mt-1">Cancels at period end</p>}
            </div>
            <div>
              <p className="text-sm text-gray-500">Renewal Date</p>
              <p className="font-medium">{sub.renewalDate ? new Date(sub.renewalDate).toLocaleDateString() : 'N/A'}</p>
              {sub.trialActive && <p className="text-xs text-blue-600">Trial active until {sub.trialEndsAt ? new Date(sub.trialEndsAt).toLocaleDateString() : ''}</p>}
            </div>
            <div>
              <p className="text-sm text-gray-500">Interval</p>
              <p className="font-medium">{sub.interval || currentPlan?.interval || 'N/A'}</p>
            </div>
          </div>
        )}
      </div>

      {/* Usage */}
      {usage && (
        <div className="bg-white border rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Usage & Limits</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {usage.items?.map((item: any) => (
              <div key={item.key} className="border rounded p-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium">{item.label}</span>
                  <span className="text-xs text-gray-500">{item.unlimited ? 'Unlimited' : `${item.current}/${item.limit}`}</span>
                </div>
                {!item.unlimited && (
                  <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
                    <div className="bg-blue-600 h-2 rounded-full" style={{ width: `${Math.min(100, item.percentageUsed || 0)}%` }} />
                  </div>
                )}
                {item.remaining !== null && !item.unlimited && (
                  <p className="text-xs text-gray-500 mt-1">{item.remaining} remaining</p>
                )}
              </div>
            ))}
          </div>
          {usage.features?.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-medium mb-2">Features</h3>
              <div className="flex flex-wrap gap-2">
                {usage.features.map((f: any) => (
                  <span key={f.key} className={`px-2 py-1 rounded text-xs ${f.included ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
                    {f.label}: {f.included ? 'Included' : 'Not included'}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Latest Invoice & Payment */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white border rounded-lg p-6">
          <h3 className="font-semibold mb-3">Latest Invoice</h3>
          {overview.latestInvoice ? (
            <div className="space-y-2 text-sm">
              <p><span className="text-gray-500">Number:</span> {overview.latestInvoice.invoiceNumber}</p>
              <p><span className="text-gray-500">Status:</span> <span className={`px-2 py-0.5 rounded text-xs ${overview.latestInvoice.status === 'PAID' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>{overview.latestInvoice.status}</span></p>
              <p><span className="text-gray-500">Total:</span> {overview.latestInvoice.total} {overview.latestInvoice.currency}</p>
              <p><span className="text-gray-500">Due:</span> {overview.latestInvoice.amountDue} {overview.latestInvoice.currency}</p>
            </div>
          ) : (
            <p className="text-sm text-gray-500">No invoices yet</p>
          )}
          {invoices.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-gray-600 mb-2">Recent Invoices</p>
              {invoices.slice(0, 3).map((inv: any) => (
                <div key={inv.id} className="flex justify-between text-xs py-1 border-b">
                  <span>{inv.invoiceNumber}</span>
                  <span className={inv.status === 'PAID' ? 'text-green-600' : 'text-yellow-600'}>{inv.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border rounded-lg p-6">
          <h3 className="font-semibold mb-3">Latest Payment</h3>
          {overview.latestPayment ? (
            <div className="space-y-2 text-sm">
              <p><span className="text-gray-500">Provider:</span> {overview.latestPayment.provider}</p>
              <p><span className="text-gray-500">Status:</span> <span className={`px-2 py-0.5 rounded text-xs ${overview.latestPayment.status === 'SUCCEEDED' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>{overview.latestPayment.status}</span></p>
              <p><span className="text-gray-500">Amount:</span> {overview.latestPayment.amount} {overview.latestPayment.currency}</p>
              <p><span className="text-gray-500">Date:</span> {new Date(overview.latestPayment.createdAt).toLocaleDateString()}</p>
            </div>
          ) : (
            <p className="text-sm text-gray-500">No payments yet</p>
          )}
          {payments.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-gray-600 mb-2">Recent Payments</p>
              {payments.slice(0, 3).map((pay: any) => (
                <div key={pay.id} className="flex justify-between text-xs py-1 border-b">
                  <span>{pay.amount} {pay.currency}</span>
                  <span className={pay.status === 'SUCCEEDED' ? 'text-green-600' : 'text-yellow-600'}>{pay.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Available Actions */}
      {overview.availableActions?.length > 0 && (
        <div className="bg-white border rounded-lg p-6">
          <h3 className="font-semibold mb-3">Available Actions</h3>
          <div className="flex flex-wrap gap-2">
            {overview.availableActions.map((action: string) => (
              <span key={action} className="px-3 py-1 bg-blue-50 text-blue-700 rounded text-sm border border-blue-200">{action.replace(/_/g, ' ')}</span>
            ))}
          </div>
        </div>
      )}

      {/* Billing Customer */}
      {overview.billingCustomer && (
        <div className="bg-white border rounded-lg p-6">
          <h3 className="font-semibold mb-3">Billing Profile</h3>
          <div className="text-sm space-y-1">
            <p><span className="text-gray-500">Name:</span> {overview.billingCustomer.billingName}</p>
            <p><span className="text-gray-500">Email:</span> {overview.billingCustomer.billingEmail}</p>
            <p><span className="text-gray-500">Country:</span> {overview.billingCustomer.billingCountry}</p>
            <p><span className="text-gray-500">Currency:</span> {overview.billingCustomer.preferredCurrency}</p>
          </div>
        </div>
      )}
    </div>
  );
}

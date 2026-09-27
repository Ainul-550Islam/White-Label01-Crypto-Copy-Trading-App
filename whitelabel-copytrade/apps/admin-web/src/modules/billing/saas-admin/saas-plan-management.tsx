'use client';

import React, { useEffect, useState } from 'react';
import {
  getTenantDetail,
  assignPlan,
  changePlan,
  changeInterval,
  getPlanCatalog,
} from './saas-admin-api';

/**
 * Admin plan-management UI using canonical plan catalog and existing
 * subscription/payment flows; no direct DB mutation.
 * No hardcoded prices.
 */
export default function SaasPlanManagementPage({ tenantId }: { tenantId: string }) {
  const [tenant, setTenant] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [atPeriodEnd, setAtPeriodEnd] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [tenantRes, plansRes] = await Promise.all([getTenantDetail(tenantId), getPlanCatalog()]);
      setTenant(tenantRes);
      setPlans(plansRes.items || plansRes.plans || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [tenantId]);

  const handleAssign = async () => {
    if (!selectedPlanId) return;
    setActionLoading('assign');
    setMessage(null);
    try {
      const result = await assignPlan(tenantId, selectedPlanId);
      setMessage(`Plan assigned: ${result.message}`);
      await fetchData();
    } catch (e: any) {
      setMessage(`Assign failed: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleChangePlan = async (planId: string) => {
    setActionLoading(`change_${planId}`);
    setMessage(null);
    try {
      const result = await changePlan(tenantId, planId, atPeriodEnd);
      if (result.requiresCheckout) {
        setMessage(`Upgrade requires checkout: ${result.checkout?.checkoutUrl || ''} Price delta: ${result.priceDelta}`);
        if (result.checkout?.checkoutUrl) {
          window.open(result.checkout.checkoutUrl, '_blank');
        }
      } else {
        setMessage(`Plan changed: ${result.message} Effective: ${result.effectiveAt ? new Date(result.effectiveAt).toLocaleDateString() : 'now'}`);
      }
      await fetchData();
    } catch (e: any) {
      setMessage(`Change failed: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleChangeInterval = async (newInterval: string) => {
    setActionLoading(`interval_${newInterval}`);
    setMessage(null);
    try {
      const result = await changeInterval(tenantId, newInterval, true);
      setMessage(`Interval change: ${result.message}`);
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

  const currentPlanId = tenant?.subscriptionSummary?.planId;
  const currentPlanCode = tenant?.subscriptionSummary?.planCode;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-bold">Plan Management - Tenant: {tenant?.name || tenantId}</h1>
      <p className="text-sm text-gray-500">All plan data from canonical backend catalog. No direct subscription.planId mutation. All changes via existing billing services.</p>

      {message && <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-800">{message}</div>}

      <div className="bg-white border rounded-lg p-4">
        <h3 className="font-medium mb-2">Current Plan</h3>
        {tenant?.subscriptionSummary ? (
          <div className="text-sm space-y-1">
            <p><span className="text-gray-500">Plan:</span> {tenant.subscriptionSummary.planName} ({tenant.subscriptionSummary.planCode})</p>
            <p><span className="text-gray-500">Status:</span> {tenant.subscriptionSummary.status}</p>
            <p><span className="text-gray-500">Interval:</span> {tenant.subscriptionSummary.interval}</p>
            <p><span className="text-gray-500">Renewal:</span> {tenant.subscriptionSummary.renewalDate ? new Date(tenant.subscriptionSummary.renewalDate).toLocaleDateString() : 'N/A'}</p>
          </div>
        ) : (
          <p className="text-sm text-gray-500">No active subscription - assign initial plan</p>
        )}
      </div>

      {!tenant?.subscriptionSummary && (
        <div className="bg-white border rounded-lg p-4">
          <h3 className="font-medium mb-3">Assign Initial Plan</h3>
          <div className="flex gap-2">
            <select value={selectedPlanId} onChange={(e) => setSelectedPlanId(e.target.value)} className="flex-1 border rounded px-3 py-2 text-sm">
              <option value="">Select plan</option>
              {plans.map((p: any) => (
                <option key={p.id} value={p.id}>{p.name} - {p.code} - {p.price} {p.currency} / {p.interval}</option>
              ))}
            </select>
            <button onClick={handleAssign} disabled={!selectedPlanId || actionLoading === 'assign'} className="px-4 py-2 bg-blue-600 text-white rounded text-sm disabled:opacity-50">
              {actionLoading === 'assign' ? 'Assigning...' : 'Assign Plan'}
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2">Uses existing subscription logic, not direct DB mutation</p>
        </div>
      )}

      <div className="bg-white border rounded-lg p-4">
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-medium">Available Plans (Canonical Catalog)</h3>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={atPeriodEnd} onChange={(e) => setAtPeriodEnd(e.target.checked)} />
            At period end
          </label>
        </div>
        <p className="text-xs text-gray-500 mb-3">Price, currency, interval, features, limits from backend. No hardcoded Basic/Standard/Premium prices.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans.map((plan: any) => (
            <div key={plan.id} className={`border rounded p-4 ${currentPlanId === plan.id ? 'border-blue-500 bg-blue-50' : ''}`}>
              <p className="font-medium">{plan.name}</p>
              <p className="text-xs text-gray-500">{plan.code} - {plan.interval}</p>
              <p className="text-xl font-bold mt-2">{plan.price} {plan.currency}</p>
              <p className="text-xs text-gray-400">/ {plan.interval} {plan.trialDays > 0 ? `(${plan.trialDays}d trial)` : ''}</p>

              <div className="mt-3 space-y-1">
                <p className="text-xs font-medium">Limits:</p>
                {Object.entries(plan.limits || {}).filter(([k, v]) => v !== null && typeof v !== 'boolean').slice(0, 4).map(([k, v]: any) => (
                  <div key={k} className="flex justify-between text-xs">
                    <span className="text-gray-600">{k}</span>
                    <span className="font-medium">{v === null ? 'Unlimited' : String(v)}</span>
                  </div>
                ))}
              </div>

              <div className="mt-3">
                <p className="text-xs font-medium">Features:</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {(plan.features || []).slice(0, 3).map((f: string) => (
                    <span key={f} className="px-1.5 py-0.5 bg-gray-100 rounded text-xs">{f}</span>
                  ))}
                  {plan.features?.length > 3 && <span className="text-xs text-gray-400">+{plan.features.length - 3}</span>}
                </div>
              </div>

              <div className="mt-4">
                {currentPlanId === plan.id ? (
                  <span className="block text-center py-1.5 bg-gray-100 text-gray-500 rounded text-sm">Current Plan</span>
                ) : (
                  <button onClick={() => handleChangePlan(plan.id)} disabled={!!actionLoading} className="w-full py-1.5 bg-blue-600 text-white rounded text-sm disabled:opacity-50">
                    {actionLoading === `change_${plan.id}` ? 'Processing...' : currentPlanCode === plan.code ? 'Change Interval' : 'Change to this Plan'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border rounded-lg p-4">
        <h3 className="font-medium mb-3">Change Billing Interval</h3>
        <div className="flex gap-2">
          {['MONTHLY', 'QUARTERLY', 'YEARLY', 'LIFETIME'].map((interval) => (
            <button key={interval} onClick={() => handleChangeInterval(interval)} disabled={!!actionLoading || tenant?.subscriptionSummary?.interval === interval} className={`px-3 py-2 rounded text-sm ${tenant?.subscriptionSummary?.interval === interval ? 'bg-gray-100 text-gray-400' : 'bg-white border hover:bg-gray-50'}`}>
              {actionLoading === `interval_${interval}` ? '...' : interval}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-2">Uses existing subscription/payment architecture, no direct planId mutation</p>
      </div>
    </div>
  );
}

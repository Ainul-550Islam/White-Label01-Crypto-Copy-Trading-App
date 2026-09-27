'use client';

import React, { useEffect, useState } from 'react';
import { getPlanComparison, changePlan, createCheckoutSession } from './billing-portal-api';

/**
 * Dynamic plan comparison UI - fetches canonical plan/features/limits from backend.
 * No hardcoded prices or limits.
 */
export default function PlanComparisonPage() {
  const [comparison, setComparison] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const fetchComparison = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getPlanComparison();
      setComparison(data);
    } catch (e: any) {
      setError(e.message || 'Failed to load plans');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchComparison();
  }, []);

  const handleSelectPlan = async (planId: string) => {
    setActionLoading(planId);
    setMessage(null);
    try {
      const result = await changePlan({ planId, atPeriodEnd: false });
      if (result.requiresCheckout) {
        // Need checkout for upgrade
        setMessage(`Upgrade requires payment. Price delta: ${result.priceDelta}. Proceeding to checkout...`);
        const checkout = await createCheckoutSession({
          planId,
          successUrl: window.location.origin + '/billing?checkout_success=true',
          cancelUrl: window.location.origin + '/billing/plans',
        });
        if (checkout.checkoutUrl) {
          window.location.href = checkout.checkoutUrl;
          return;
        }
      }
      setMessage(result.message || 'Plan change successful');
      await fetchComparison();
    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3" />
          <div className="grid grid-cols-3 gap-4">
            <div className="h-64 bg-gray-200 rounded" />
            <div className="h-64 bg-gray-200 rounded" />
            <div className="h-64 bg-gray-200 rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded p-4">
          <p className="text-red-800">{error}</p>
          <button onClick={fetchComparison} className="mt-2 px-3 py-1 bg-red-600 text-white rounded text-sm">Retry</button>
        </div>
      </div>
    );
  }

  if (!comparison || !comparison.plans?.length) {
    return (
      <div className="p-6 text-center py-12">
        <p className="text-gray-500">No plans available</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Compare Plans</h1>
      <p className="text-gray-600">Choose the plan that fits your needs. All pricing from canonical billing catalog.</p>

      {message && (
        <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-800">{message}</div>
      )}

      {/* Plan Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {comparison.plans.map((plan: any) => (
          <div key={plan.id} className={`border rounded-lg p-6 ${plan.isCurrent ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200'}`}>
            {plan.isCurrent && <span className="inline-block px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded mb-2">Current Plan</span>}
            <h3 className="text-xl font-bold">{plan.name}</h3>
            <p className="text-sm text-gray-500 mt-1">{plan.description || ''}</p>
            <div className="mt-4">
              <span className="text-3xl font-bold">{plan.price}</span>
              <span className="text-gray-500 ml-1">{plan.currency}</span>
              <span className="text-sm text-gray-400"> / {plan.interval}</span>
            </div>
            {plan.trialDays > 0 && <p className="text-xs text-green-600 mt-2">{plan.trialDays} day trial</p>}

            <div className="mt-4 space-y-2">
              <p className="text-sm font-medium">Limits:</p>
              {Object.entries(plan.limits || {}).map(([key, value]: any) => {
                if (value === null || value === undefined) return null;
                if (typeof value === 'boolean') return null;
                return (
                  <div key={key} className="flex justify-between text-xs">
                    <span className="text-gray-600">{key.replace(/([A-Z])/g, ' $1')}</span>
                    <span className="font-medium">{value === null ? 'Unlimited' : String(value)}</span>
                  </div>
                );
              })}
            </div>

            <div className="mt-4">
              <p className="text-sm font-medium mb-1">Features:</p>
              <ul className="space-y-1">
                {(plan.features || []).slice(0, 5).map((f: string) => (
                  <li key={f} className="text-xs text-gray-600 flex items-center">
                    <span className="text-green-500 mr-1">✓</span> {f}
                  </li>
                ))}
                {plan.features?.length > 5 && <li className="text-xs text-gray-400">+{plan.features.length - 5} more</li>}
              </ul>
            </div>

            <div className="mt-6">
              {plan.isCurrent ? (
                <button disabled className="w-full py-2 bg-gray-100 text-gray-500 rounded text-sm cursor-not-allowed">Current Plan</button>
              ) : (
                <button
                  onClick={() => handleSelectPlan(plan.id)}
                  disabled={!!actionLoading}
                  className={`w-full py-2 rounded text-sm font-medium ${plan.upgradeEligible ? 'bg-blue-600 text-white hover:bg-blue-700' : plan.downgradeEligible ? 'bg-gray-800 text-white hover:bg-gray-900' : 'bg-white border border-gray-300 hover:bg-gray-50'}`}
                >
                  {actionLoading === plan.id ? 'Processing...' : plan.upgradeEligible ? 'Upgrade' : plan.downgradeEligible ? 'Downgrade' : 'Select Plan'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Features Matrix */}
      {comparison.featuresMatrix?.length > 0 && (
        <div className="bg-white border rounded-lg p-6 overflow-x-auto">
          <h3 className="font-semibold mb-4">Feature Comparison</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2">Feature</th>
                {comparison.plans.map((p: any) => (
                  <th key={p.id} className="text-center py-2">{p.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {comparison.featuresMatrix.map((row: any) => (
                <tr key={row.featureKey} className="border-b">
                  <td className="py-2">{row.label}</td>
                  {comparison.plans.map((p: any) => (
                    <td key={p.id} className="text-center py-2">
                      {row.plans[p.id] ? <span className="text-green-600">✓</span> : <span className="text-gray-300">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Limits Matrix */}
      {comparison.limitsMatrix?.length > 0 && (
        <div className="bg-white border rounded-lg p-6 overflow-x-auto">
          <h3 className="font-semibold mb-4">Limits Comparison</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2">Limit</th>
                {comparison.plans.map((p: any) => (
                  <th key={p.id} className="text-center py-2">{p.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {comparison.limitsMatrix.map((row: any) => (
                <tr key={row.limitKey} className="border-b">
                  <td className="py-2">{row.label}</td>
                  {comparison.plans.map((p: any) => (
                    <td key={p.id} className="text-center py-2">
                      {row.plans[p.id] === null ? 'Unlimited' : String(row.plans[p.id])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

'use client';

import React, { useEffect, useState } from 'react';

import { ApiError } from '@/lib/api-error';

import { checkTenantFeature, getTenantFeatureAccess } from './entitlement-api';
import type { FeatureCheckResult, TenantFeatureAccess } from './entitlement-types';

/**
 * Platform operator view of ONE tenant's effective entitlements (round 7):
 * the features and limits the API derives from the tenant's plan and feature
 * flags, with current usage, plus a single-feature check that returns the
 * API's own decision and reason. Read-only: entitlements change only through
 * the tenant's plan (see the plan panel on the same page) or feature flags.
 */
export default function TenantEntitlementsPanel({ tenantId }: { tenantId: string }) {
  const [access, setAccess] = useState<TenantFeatureAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [featureKey, setFeatureKey] = useState('');
  const [check, setCheck] = useState<FeatureCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setAccess(await getTenantFeatureAccess(tenantId));
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'Failed to load entitlements');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const runCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    const key = featureKey.trim();
    if (!key) return;
    setChecking(true);
    setCheck(null);
    setCheckError(null);
    try {
      setCheck(await checkTenantFeature(tenantId, key));
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : 'Check failed');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="bg-white border rounded-lg p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Effective entitlements</h2>
        <button onClick={load} className="text-sm text-gray-600 hover:text-gray-900">
          Refresh
        </button>
      </div>
      <p className="text-xs text-gray-500">
        Derived by the API from the tenant&apos;s plan and feature flags. Change the plan to change them.
      </p>

      {loading ? (
        <div className="animate-pulse h-32 bg-gray-200 rounded" />
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-800">{error}</div>
      ) : access ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="font-medium text-sm mb-2">Features</h3>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {access.features.length === 0 && <p className="text-xs text-gray-500">No features</p>}
              {access.features.map((f) => (
                <div key={f.featureKey} className="flex justify-between text-xs border-b py-1">
                  <span>
                    {f.featureKey}
                    <span className="text-gray-400 ml-1">({f.source})</span>
                  </span>
                  <span className={f.enabled ? 'text-green-600' : 'text-gray-400'}>{f.enabled ? 'Enabled' : f.reason || 'Disabled'}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="font-medium text-sm mb-2">Limits and usage</h3>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {access.limits.length === 0 && <p className="text-xs text-gray-500">No limits</p>}
              {access.limits.map((l) => (
                <div key={l.limitKey} className="text-xs border-b py-1">
                  <div className="flex justify-between">
                    <span>{l.limitKey}</span>
                    <span>{l.unlimited ? 'Unlimited' : `${l.currentUsage} / ${l.configuredLimit ?? '-'} (${l.remaining ?? 0} left)`}</span>
                  </div>
                  {!l.unlimited && l.percentageUsed !== null && (
                    <div className="mt-1 w-full bg-gray-200 rounded-full h-2">
                      <div className="bg-blue-600 h-2 rounded-full" style={{ width: `${Math.min(100, Math.max(0, l.percentageUsed))}%` }} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <form onSubmit={runCheck} className="flex gap-2">
        <input
          type="text"
          placeholder="Check a feature key, e.g. custom_domain"
          value={featureKey}
          onChange={(e) => setFeatureKey(e.target.value)}
          className="flex-1 border rounded px-3 py-2 text-sm"
        />
        <button type="submit" disabled={checking || !featureKey.trim()} className="px-4 py-2 bg-gray-800 text-white rounded text-sm disabled:opacity-50">
          {checking ? 'Checking...' : 'Check'}
        </button>
      </form>
      {checkError && <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-800">{checkError}</div>}
      {check && (
        <div className={`border rounded p-3 text-sm ${check.allowed ? 'bg-green-100' : 'bg-yellow-50'}`}>
          <p className="font-medium">
            {check.featureKey}: {check.allowed ? 'allowed' : 'not allowed'}
          </p>
          <p className="text-xs text-gray-600 mt-1">
            Source {check.source}; plan {check.planCode ?? 'none'}; subscription {check.subscriptionStatus ?? 'none'}
            {check.reason ? `; ${check.reason}` : ''}
          </p>
        </div>
      )}
    </div>
  );
}

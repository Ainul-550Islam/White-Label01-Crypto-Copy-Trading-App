'use client';

import React, { useEffect, useState } from 'react';

import { LIMIT_LABELS } from '../plans/plan-formatters';
import type { PlanLimits } from '../plans/plan-types';

import { getOwnPlanLimits } from './entitlement-api';
import type { OwnPlanLimits } from './entitlement-types';

/**
 * The caller's own plan limits (round 7), from GET /v1/billing/subscription/limits:
 * exactly what the API enforces for this organisation. No subscription means
 * no limits object, which is shown as such rather than as defaults.
 */
export default function OwnPlanLimitsPanel() {
  const [limits, setLimits] = useState<OwnPlanLimits | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getOwnPlanLimits()
      .then((value) => setLimits(value ?? null))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load plan limits'));
  }, []);

  return (
    <div className="p-6">
      <div className="bg-white border rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">Plan limits enforced by the platform</h2>
        {error ? (
          <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-800">{error}</div>
        ) : limits === undefined ? (
          <div className="animate-pulse h-32 bg-gray-200 rounded" />
        ) : limits === null ? (
          <p className="text-sm text-gray-500">No active subscription, so no plan limits apply yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
            {(Object.keys(LIMIT_LABELS) as Array<keyof PlanLimits>).map((key) => {
              const value = limits[key];
              return (
                <div key={key} className="flex justify-between border-b py-1">
                  <span className="text-gray-500">{LIMIT_LABELS[key]}</span>
                  <span className="font-medium">
                    {typeof value === 'boolean' ? (value ? 'Included' : 'Not included') : value === null || value === undefined ? 'Unlimited' : value.toLocaleString('en-US')}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// # Responsibility: customer settings surface for user-wide concurrent position-slot and open-order ceilings.

'use client';
import type { JSX } from 'react';

import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { userPositionLimitsApi } from '@/api/user-position-limits-api';

export const USER_POSITION_LIMITS_QUERY_KEY = ['user-position-limits', 'me'] as const;
const MAX_LIMIT = 2_147_483_647;

function parseLimitInput(value: string, label: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${label} must be a whole number, zero, or blank.`);
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_LIMIT) {
    throw new Error(`${label} must be between 0 and ${MAX_LIMIT}.`);
  }
  return parsed;
}

function usageValue(value: number | undefined): string {
  return value === undefined ? 'Unknown' : value.toLocaleString('en-US');
}

export function PositionLimitSettings(): JSX.Element {
  const queryClient = useQueryClient();
  const limitsQuery = useQuery({
    queryKey: USER_POSITION_LIMITS_QUERY_KEY,
    queryFn: () => userPositionLimitsApi.getMyLimits(),
    staleTime: 15_000,
    retry: false,
  });

  const [draft, setDraft] = useState<Partial<{ maxConcurrentPositions: string; maxOpenOrders: string }>>({});
  const maxConcurrentPositions = draft.maxConcurrentPositions ?? (
    limitsQuery.data?.limits.maxConcurrentPositions == null
      ? ''
      : String(limitsQuery.data.limits.maxConcurrentPositions)
  );
  const maxOpenOrders = draft.maxOpenOrders ?? (
    limitsQuery.data?.limits.maxOpenOrders == null
      ? ''
      : String(limitsQuery.data.limits.maxOpenOrders)
  );

  const saveMutation = useMutation({
    mutationFn: () =>
      userPositionLimitsApi.updateMyLimits({
        maxConcurrentPositions: parseLimitInput(maxConcurrentPositions, 'Maximum concurrent positions'),
        maxOpenOrders: parseLimitInput(maxOpenOrders, 'Maximum open orders'),
      }),
    onSuccess: () => {
      setDraft({});
      void queryClient.invalidateQueries({ queryKey: USER_POSITION_LIMITS_QUERY_KEY });
    },
  });

  if (limitsQuery.isLoading) {
    return (
      <section className="rounded-lg border bg-card p-5" data-testid="position-limit-settings-loading" aria-live="polite">
        <p className="text-sm text-muted">Loading your position and order limits…</p>
      </section>
    );
  }

  if (limitsQuery.error || !limitsQuery.data) {
    const message = limitsQuery.error instanceof Error ? limitsQuery.error.message : 'No limit settings were returned.';
    return (
      <section className="rounded-lg border border-red-300 bg-card p-5" data-testid="position-limit-settings-error" role="alert">
        <h2 className="font-semibold">Position limits unavailable</h2>
        <p className="mt-2 text-sm text-muted">{message}</p>
        <button
          type="button"
          onClick={() => void limitsQuery.refetch()}
          className="mt-4 rounded border px-3 py-2 text-sm font-medium"
        >
          Retry
        </button>
      </section>
    );
  }

  const view = limitsQuery.data;
  const usage = view.usageState === 'CURRENT' ? view.usage : null;
  const errorMessage = saveMutation.error instanceof Error ? saveMutation.error.message : null;

  return (
    <section className="space-y-5" data-testid="position-limit-settings" aria-labelledby="position-limit-settings-heading">
      <div className="rounded-lg border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="position-limit-settings-heading" className="text-lg font-semibold">Concurrent position and order limits</h2>
            <p className="mt-1 text-sm text-muted">
              Optional integer ceilings applied across your non-deleted trading accounts, including PAPER and LIVE accounts.
            </p>
          </div>
          <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${view.configured ? 'border-emerald-300 text-emerald-700' : 'border-gray-300 text-muted'}`}>
            {view.configured ? 'Configured' : 'No user-wide ceiling'}
          </span>
        </div>

        <form
          className="mt-5 space-y-5"
          data-testid="position-limit-settings-form"
          onSubmit={(event) => {
            event.preventDefault();
            saveMutation.mutate();
          }}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1.5 text-sm">
              <span className="font-medium">Maximum concurrent position slots</span>
              <input
                aria-label="Maximum concurrent position slots"
                type="number"
                min={0}
                max={MAX_LIMIT}
                step={1}
                inputMode="numeric"
                value={maxConcurrentPositions}
                onChange={(event) => setDraft((current) => ({ ...current, maxConcurrentPositions: event.target.value }))}
                placeholder="No limit"
                className="w-full rounded-md border bg-background px-3 py-2"
              />
              <span className="block text-xs text-muted">
                Counts distinct account/symbol exposure and pending OMS symbols without trusting a caller-supplied reduce-only flag to bypass the ceiling.
              </span>
            </label>

            <label className="space-y-1.5 text-sm">
              <span className="font-medium">Maximum open orders</span>
              <input
                aria-label="Maximum open orders"
                type="number"
                min={0}
                max={MAX_LIMIT}
                step={1}
                inputMode="numeric"
                value={maxOpenOrders}
                onChange={(event) => setDraft((current) => ({ ...current, maxOpenOrders: event.target.value }))}
                placeholder="No limit"
                className="w-full rounded-md border bg-background px-3 py-2"
              />
              <span className="block text-xs text-muted">
                Counts active OMS intents and canonical open orders once per client order ID, including cancellation requests.
              </span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={saveMutation.isPending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {saveMutation.isPending ? 'Saving…' : 'Save limits'}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft((current) => ({ ...current, maxConcurrentPositions: '' }));
                setDraft((current) => ({ ...current, maxOpenOrders: '' }));
                saveMutation.reset();
              }}
              className="rounded-md border px-4 py-2 text-sm font-medium"
            >
              Clear fields
            </button>
            {saveMutation.isSuccess && <span className="text-sm text-emerald-700" role="status">Limits saved and audited.</span>}
          </div>

          {errorMessage && <p className="text-sm text-red-700" role="alert">Could not save limits: {errorMessage}</p>}
        </form>
      </div>

      <div className="rounded-lg border bg-card p-5">
        <h3 className="font-semibold">Current usage</h3>
        {usage ? (
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3" data-testid="position-limit-usage">
            <div className="rounded-md border p-3">
              <dt className="text-muted">Position slots</dt>
              <dd className="mt-1 font-mono text-lg font-semibold">{usageValue(usage.openPositionSlots)}</dd>
            </div>
            <div className="rounded-md border p-3">
              <dt className="text-muted">Open orders</dt>
              <dd className="mt-1 font-mono text-lg font-semibold">{usageValue(usage.openOrderCount)}</dd>
            </div>
            <div className="rounded-md border p-3">
              <dt className="text-muted">Owned accounts included</dt>
              <dd className="mt-1 font-mono text-lg font-semibold">{usageValue(usage.ownedAccountCount)}</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-3 text-sm text-amber-700" role="status" data-testid="position-limit-usage-unknown">
            Usage is unknown because one or more canonical position/order sources could not be read. The platform does not substitute zero.
          </p>
        )}
        <p className="mt-3 text-xs text-muted">Usage sampled at {new Date(view.asOf).toISOString()} UTC.</p>
      </div>

      <div className="rounded-lg border bg-card p-5 text-sm">
        <h3 className="font-semibold">How enforcement works</h3>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-muted">
          <li>Open OMS intents reserve slots before they are persisted; concurrent submissions are serialized per tenant and account owner.</li>
          <li>Positions and active OMS trades hold a slot until their canonical lifecycle reports them closed. Orders in cancellation or reconciliation states remain counted.</li>
          <li>A blank field means no user-wide ceiling; zero blocks new reservations. Lowering a limit does not cancel existing orders or positions.</li>
          <li>These are count limits, not notional or balance limits. Existing account risk checks, live-trading enablement, exchange credentials, kill switches, and execution gates still apply.</li>
          <li>Limits guard orders submitted through the platform OMS. Orders placed directly at an exchange cannot be blocked before they are synchronized into platform records.</li>
        </ul>
        <p className="mt-3 text-xs text-muted">The usage view unions canonical non-zero positions, active OMS trades, and pending OMS/canonical order symbols by account and symbol; active order rows are de-duplicated by client order ID.</p>
      </div>
    </section>
  );
}

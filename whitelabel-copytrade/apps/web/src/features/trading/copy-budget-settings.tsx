// # Responsibility: the follower's global copy budget — one cap across every active copy subscription, edited as decimal strings, with the remaining budget shown honestly.
//
// WHY THIS SCREEN IS CAREFUL ABOUT NUMBERS
// ----------------------------------------
// The budget is the ceiling on how much of a follower's money can be at risk
// through copy trading at once. Three mistakes would each be invisible and
// expensive:
//
//   1. Arithmetic in `number`. The cap is a decimal string; parsing it into a
//      float to add exposure to it introduces error exactly where the customer is
//      checking their own limit. Every comparison here is done on the strings the
//      server sent, so what is displayed is what is enforced.
//   2. Showing an unknown as a zero. When the server cannot measure exposure (no
//      equity reading, no FX rate) it says so; the meter then shows "unknown" and
//      the form still works. A meter pinned at 0% would tell a customer at their
//      limit that they have room.
//   3. Silent reduction. The API can REDUCE an order to fit the remaining budget.
//      The customer is told this can happen before they set a cap, in the same
//      place they set it.
'use client';
import type { JSX } from 'react';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { copyOpsApi, type CopyBudget } from '@/api/copy-ops-api';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { LoadingState } from '@/components/loading-state';

export const COPY_BUDGET_QUERY_KEY = ['copy-trading', 'budget'] as const;

/** A decimal the server will accept: no exponent, no sign, no locale separators. */
const DECIMAL_INPUT = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

/** Validates the two inputs as decimal strings without ever converting them to floats. */
export function validateBudgetInput(input: { maxActiveExposure: string; perTraderCap: string }): {
  ok: boolean;
  error: string | null;
} {
  const max = input.maxActiveExposure.trim();
  const perTrader = input.perTraderCap.trim();
  if (max.length === 0) return { ok: false, error: 'Enter a maximum active exposure.' };
  if (!DECIMAL_INPUT.test(max)) {
    return { ok: false, error: 'Use digits with an optional decimal point, for example 2500.00.' };
  }
  if (perTrader.length > 0 && !DECIMAL_INPUT.test(perTrader)) {
    return { ok: false, error: 'The per-trader cap must be a number like 500.00, or left blank.' };
  }
  if (perTrader.length > 0 && compareDecimals(perTrader, max) > 0) {
    return { ok: false, error: 'The per-trader cap cannot be larger than the total budget.' };
  }
  return { ok: true, error: null };
}

/**
 * Exact comparison of two non-negative decimal strings.
 *
 * Implemented by aligning the fractional parts and comparing digit by digit, which
 * is exact for any precision the database can store (28,12 here) and cannot
 * disagree with the server's own comparison the way a float would.
 */
export function compareDecimals(a: string, b: string): number {
  const [aWholeRaw, aFraction = ''] = a.split('.');
  const aWhole = aWholeRaw ?? '0';
  const [bWholeRaw, bFraction = ''] = b.split('.');
  const bWhole = bWholeRaw ?? '0';
  const wholeTrimmedA = aWhole.replace(/^0+(?=\d)/, '');
  const wholeTrimmedB = bWhole.replace(/^0+(?=\d)/, '');
  if (wholeTrimmedA.length !== wholeTrimmedB.length) {
    return wholeTrimmedA.length > wholeTrimmedB.length ? 1 : -1;
  }
  if (wholeTrimmedA !== wholeTrimmedB) return wholeTrimmedA > wholeTrimmedB ? 1 : -1;
  const width = Math.max(aFraction.length, bFraction.length);
  const fractionA = aFraction.padEnd(width, '0');
  const fractionB = bFraction.padEnd(width, '0');
  if (fractionA === fractionB) return 0;
  return fractionA > fractionB ? 1 : -1;
}

function formatPercent(budget: CopyBudget): string {
  if (budget.utilisationPercent === null) return 'unknown';
  return `${budget.utilisationPercent}%`;
}

function meterTone(utilisationPercent: number | null): string {
  if (utilisationPercent === null) return 'bg-slate-300';
  if (utilisationPercent >= 100) return 'bg-red-500';
  if (utilisationPercent >= 80) return 'bg-amber-500';
  return 'bg-emerald-500';
}

export function CopyBudgetSettings(): JSX.Element {
  const queryClient = useQueryClient();
  const budgetQuery = useQuery({
    queryKey: COPY_BUDGET_QUERY_KEY,
    queryFn: () => copyOpsApi.getBudget(),
    staleTime: 30_000,
    retry: false,
  });

  const [maxDraft, setMaxDraft] = useState<string | null>(null);
  const [perTraderDraft, setPerTraderDraft] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const budget = budgetQuery.data;
  const maxActiveExposure = maxDraft ?? budget?.maxActiveExposure ?? '';
  const perTraderCap = perTraderDraft ?? budget?.perTraderCap ?? '';
  const validation = useMemo(
    () => validateBudgetInput({ maxActiveExposure, perTraderCap }),
    [maxActiveExposure, perTraderCap],
  );

  const saveMutation = useMutation({
    mutationFn: () =>
      copyOpsApi.updateBudget({
        maxActiveExposure: maxActiveExposure.trim(),
        perTraderCap: perTraderCap.trim() === '' ? null : perTraderCap.trim(),
      }),
    onSuccess: (updated) => {
      setFormError(null);
      // The drafts are dropped here, in the handler that knows the save happened, so
      // both fields go back to tracking the server value. Doing this in an effect
      // keyed on `saved` would set state synchronously during an effect body - a
      // rejected pattern - and would briefly render the old numbers beside a
      // "saved" badge.
      setMaxDraft(null);
      setPerTraderDraft(null);
      setSaved(true);
      queryClient.setQueryData(COPY_BUDGET_QUERY_KEY, updated);
    },
    onError: (error: unknown) => {
      setFormError(error instanceof Error ? error.message : 'Your budget could not be saved.');
    },
  });

  if (budgetQuery.isLoading) return <LoadingState />;
  if (budgetQuery.error) {
    return <ErrorState error={budgetQuery.error} onRetry={() => void budgetQuery.refetch()} />;
  }
  if (!budget) {
    return (
      <EmptyState
        title="No copy budget set"
        description="Set a maximum to cap how much of your balance can be at risk through copy trading at once."
      />
    );
  }

  const utilisation = budget.utilisationPercent;

  return (
    <div className="grid gap-4">
      <div className="rounded border bg-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Active copy budget</h2>
          <span className="text-xs text-muted">
            {budget.updatedAt ? `Updated ${new Date(budget.updatedAt).toLocaleString()}` : 'Not yet updated'}
          </span>
        </div>

        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Limit</dt>
            <dd className="font-mono">
              {budget.maxActiveExposure} {budget.currency}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">In use</dt>
            <dd className="font-mono">
              {budget.currentExposure === null ? 'Unknown' : `${budget.currentExposure} ${budget.currency}`}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Remaining</dt>
            <dd className="font-mono">
              {budget.remaining === null ? 'Unknown' : `${budget.remaining} ${budget.currency}`}
            </dd>
          </div>
        </dl>

        <div className="mt-3">
          <div
            className="h-2 w-full overflow-hidden rounded bg-slate-200"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={utilisation ?? undefined}
            aria-valuetext={utilisation === null ? 'Current usage is unknown' : `${utilisation}% of your budget is in use`}
            aria-label="Budget utilisation"
          >
            <div
              className={`h-full ${meterTone(utilisation)}`}
              style={{ width: `${utilisation === null ? 0 : Math.min(100, utilisation)}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-muted">
            {utilisation === null
              ? 'Current usage could not be measured, so no percentage is shown.'
              : `${formatPercent(budget)} of your budget is in use.`}
          </p>
        </div>

        {budget.unavailableReason && (
          <p className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900" role="status">
            {budget.unavailableReason}
          </p>
        )}
      </div>

      <form
        className="rounded border bg-card p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!validation.ok) {
            setFormError(validation.error);
            return;
          }
          saveMutation.mutate();
        }}
      >
        <h2 className="text-sm font-semibold">Change your budget</h2>
        <p className="mt-1 text-xs text-muted">
          This ceiling applies across every copy subscription at once. An order that would take you past it is
          reduced to what remains, or refused when nothing remains — so a new position never pushes you over.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Maximum active exposure</span>
            <input
              className="rounded border px-3 py-2 font-mono"
              inputMode="decimal"
              value={maxActiveExposure}
              onChange={(event) => {
                setMaxDraft(event.target.value);
                // The confirmation describes the value that was saved, so it stops
                // being true the moment the customer edits again.
                setSaved(false);
              }}
              aria-describedby="budget-max-help"
            />
            <span id="budget-max-help" className="text-xs text-muted">
              Denominated in {budget.currency}.
            </span>
          </label>

          <label className="grid gap-1 text-sm">
            <span className="font-medium">Per-trader cap (optional)</span>
            <input
              className="rounded border px-3 py-2 font-mono"
              inputMode="decimal"
              value={perTraderCap}
              onChange={(event) => {
                setPerTraderDraft(event.target.value);
                setSaved(false);
              }}
              placeholder="No separate cap"
              aria-describedby="budget-trader-help"
            />
            <span id="budget-trader-help" className="text-xs text-muted">
              Stops any one trader taking your whole budget. Leave blank for no separate limit.
            </span>
          </label>
        </div>

        {!validation.ok && (maxDraft !== null || perTraderDraft !== null) && (
          <p className="mt-2 text-xs text-red-700" role="alert">
            {validation.error}
          </p>
        )}
        {formError && (
          <p className="mt-2 text-xs text-red-700" role="alert">
            {formError}
          </p>
        )}
        {saved && (
          <p className="mt-2 text-xs text-emerald-700" role="status">
            Budget saved.
          </p>
        )}

        <button
          type="submit"
          className="mt-3 rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={!validation.ok || saveMutation.isPending}
        >
          {saveMutation.isPending ? 'Saving…' : 'Save budget'}
        </button>
      </form>
    </div>
  );
}

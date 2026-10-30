// # Responsibility: the follower's copy-trading budget - the cap, what is committed against it, and the two ways to change it (save a new limit, or reduce it immediately).
//
// The three limits are shown as three different numbers because they are different claims:
// `maxActiveExposure` is what the customer asked for, `effectiveCap` is what the API will actually
// enforce (the lower of their cap and the tenant ceiling), and `committed` is an ALLOCATION ESTIMATE
// from copy subscriptions rather than a live exchange reading - which the panel says next to it.
'use client';
import type { JSX } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { copyTradingExtendedApi, DECIMAL_STRING, type CopyBudget } from '@/api/copy-trading-extended-api';
import { useAuth } from '@/auth/auth.store';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { LoadingState } from '@/components/loading-state';
import { StatusBadge } from '@/components/status-badge';
import { useCopy } from '@/i18n';
import { newIdempotencyKey } from '@/lib/idempotency-key';

export const copyBudgetQueryKey = ['copy-trading', 'budget'] as const;

/** The form-level reason a save would be refused, decided before the request and identical to the DTO's rules. */
export function budgetInputProblem(input: { maxActiveExposure: string; perTraderCap: string; currency: string }): 'amount' | 'currency' | null {
  if (!DECIMAL_STRING.test(input.maxActiveExposure.trim())) return 'amount';
  if (input.perTraderCap.trim() !== '' && !DECIMAL_STRING.test(input.perTraderCap.trim())) return 'amount';
  if (!/^[A-Z0-9]{2,12}$/.test(input.currency.trim().toUpperCase())) return 'currency';
  return null;
}

export function CopyBudgetScreen(): JSX.Element {
  const { t } = useCopy();
  // The reduction is re-checked against the response, so it needs the identity the API answered for.
  // It comes from the session the page was rendered under, never from a field on the form.
  const { session } = useAuth();
  const owner = { tenantId: session?.user.tenantId ?? '', userId: session?.user.id ?? '' };
  const queryClient = useQueryClient();
  const budgetQuery = useQuery({ queryKey: copyBudgetQueryKey, queryFn: () => copyTradingExtendedApi.getBudget(), retry: false });
  const [exposure, setExposure] = useState('');
  const [perTrader, setPerTrader] = useState('');
  const [currency, setCurrency] = useState('');
  const [reduction, setReduction] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const saveKey = useRef(newIdempotencyKey('budget-save'));
  const reduceKey = useRef(newIdempotencyKey('budget-reduce'));

  const budget: CopyBudget | undefined = budgetQuery.data;

  const saveMutation = useMutation({
    mutationFn: () => {
      const code = currency.trim().toUpperCase();
      const problem = budgetInputProblem({ maxActiveExposure: exposure, perTraderCap: perTrader, currency: code });
      if (problem !== null) throw new Error(t('budget.invalidAmount'));
      return copyTradingExtendedApi.putBudget(
        {
          maxActiveExposure: exposure.trim(),
          perTraderCap: perTrader.trim() ? perTrader.trim() : null,
          currency: code,
        },
        saveKey.current,
      );
    },
    onSuccess: (next) => {
      setProblem(null);
      setNotice(t('budget.saved'));
      saveKey.current = newIdempotencyKey('budget-save');
      queryClient.setQueryData(copyBudgetQueryKey, next);
    },
    onError: (error) => setProblem(error instanceof Error ? error.message : t('common.error')),
  });

  const reduceMutation = useMutation({
    mutationFn: () => {
      if (!DECIMAL_STRING.test(reduction.trim())) throw new Error(t('budget.invalidAmount'));
      const code = (budget?.currency ?? currency).trim().toUpperCase();
      if (!/^[A-Z0-9]{2,12}$/.test(code)) throw new Error(t('budget.invalidAmount'));
      if (!owner.tenantId || !owner.userId) throw new Error(t('common.error'));
      return copyTradingExtendedApi.reduceBudget({ maxActiveExposure: reduction.trim(), currency: code }, reduceKey.current, owner);
    },
    onSuccess: (next) => {
      setProblem(null);
      setNotice(t('budget.reduceNote'));
      reduceKey.current = newIdempotencyKey('budget-reduce');
      queryClient.setQueryData(copyBudgetQueryKey, next);
    },
    onError: (error) => setProblem(error instanceof Error ? error.message : t('common.error')),
  });

  if (budgetQuery.isPending) return <LoadingState message={t('common.loading')} />;
  if (budgetQuery.isError) return <ErrorState error={budgetQuery.error} onRetry={() => void budgetQuery.refetch()} />;
  if (!budget) return <EmptyState title={t('budget.title')} description={t('common.unavailable')} />;

  return (
    <section aria-labelledby="budget-heading" className="space-y-6">
      <header>
        <h2 id="budget-heading" className="text-lg font-semibold">{t('budget.title')}</h2>
        <p className="mt-1 text-sm text-muted">{t('budget.intro')}</p>
      </header>

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-xs text-muted">{t('budget.maxActiveExposure')}</dt><dd className="text-sm font-semibold">{budget.maxActiveExposure ?? t('common.unavailable')}</dd></div>
        <div><dt className="text-xs text-muted">{t('budget.effectiveCap')}</dt><dd className="text-sm font-semibold">{budget.effectiveCap ?? t('common.unavailable')}</dd></div>
        <div><dt className="text-xs text-muted">{t('budget.committed')}</dt><dd className="text-sm font-semibold">{budget.currentExposure ?? t('common.unavailable')}</dd></div>
        <div><dt className="text-xs text-muted">{t('budget.remaining')}</dt><dd className="text-sm font-semibold">{budget.remaining ?? t('common.unavailable')}</dd></div>
        <div><dt className="text-xs text-muted">{t('budget.ceiling')}</dt><dd className="text-sm font-semibold">{budget.tenantCeiling ?? t('common.unavailable')}</dd></div>
        <div><dt className="text-xs text-muted">{t('budget.perTraderCap')}</dt><dd className="text-sm font-semibold">{budget.perTraderCap ?? t('common.unavailable')}</dd></div>
        <div><dt className="text-xs text-muted">{t('budget.utilisation')}</dt><dd className="text-sm font-semibold">{budget.utilisationBps ?? t('common.unavailable')}</dd></div>
        <div><dt className="text-xs text-muted">{t('common.status')}</dt><dd><StatusBadge status={budget.exposureStatus} /></dd></div>
      </dl>
      <p className="text-xs text-muted">{t('budget.exposureNote')}</p>

      <form
        className="grid gap-3 sm:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          setNotice(null);
          saveMutation.mutate();
        }}
      >
        <label className="block text-sm">
          <span className="font-medium">{t('budget.maxActiveExposure')}</span>
          <input className="mt-1 w-full rounded border px-3 py-2" inputMode="decimal" value={exposure} onChange={(event) => setExposure(event.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="font-medium">{t('budget.perTraderCap')}</span>
          <input className="mt-1 w-full rounded border px-3 py-2" inputMode="decimal" value={perTrader} onChange={(event) => setPerTrader(event.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="font-medium">{t('budget.currency')}</span>
          <input className="mt-1 w-full rounded border px-3 py-2" value={currency || (budget.currency ?? '')} onChange={(event) => setCurrency(event.target.value)} />
        </label>
        <button type="submit" className="rounded bg-primary px-3 py-2 text-sm text-white" disabled={saveMutation.isPending}>
          {t('budget.save')}
        </button>
      </form>

      <form
        className="grid items-end gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          setNotice(null);
          reduceMutation.mutate();
        }}
      >
        <label className="block text-sm">
          <span className="font-medium">{t('budget.reduceAmount')}</span>
          <input className="mt-1 w-full rounded border px-3 py-2" inputMode="decimal" value={reduction} onChange={(event) => setReduction(event.target.value)} />
          <span className="mt-1 block text-xs text-muted">{t('budget.reduceNote')}</span>
        </label>
        <button type="submit" className="rounded border px-3 py-2 text-sm" disabled={reduceMutation.isPending}>
          {t('budget.reduce')}
        </button>
      </form>

      <p role="status" aria-live="polite" className="min-h-[1.25rem] text-sm">
        {problem ? <span className="text-danger">{problem}</span> : notice ?? ''}
      </p>
    </section>
  );
}

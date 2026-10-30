// # Responsibility: a trader's leader-fee policy - the disclosed profit share, the high-water-mark scope and the effective-dated history - plus the operator form that adds a new version.
//
// The policy is effective-dated: a change appends a version and closes the previous one, so a fee
// already charged is never explained by a rate that did not exist at the time. The history list is the
// only view that shows that, which is why it is here and not behind a separate screen.
'use client';
import type { JSX } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import {
  copyTradingExtendedApi,
  type LeaderFeePolicyVersion,
  type PublicLeaderFeePolicy,
} from '@/api/copy-trading-extended-api';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { LoadingState } from '@/components/loading-state';
import { useCopy } from '@/i18n';
import { newIdempotencyKey } from '@/lib/idempotency-key';

export const leaderFeeQueryKey = (traderId: string, currency: string) => ['copy-trading', 'leader-fee', traderId, currency] as const;
export const leaderFeeHistoryQueryKey = (traderId: string, currency: string) => ['copy-trading', 'leader-fee-history', traderId, currency] as const;

const FEE_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'BTC', 'ETH', 'USDT', 'USDC'] as const;

export function LeaderFeeScreen({ initialTraderId = '', canManageFees = false }: { initialTraderId?: string; canManageFees?: boolean }): JSX.Element {
  const { t } = useCopy();
  const queryClient = useQueryClient();
  const [traderId, setTraderId] = useState(initialTraderId);
  const [requested, setRequested] = useState(initialTraderId.trim());
  const [currency, setCurrency] = useState('USD');
  const [bps, setBps] = useState('');
  const [scope, setScope] = useState<'PER_FOLLOWER_CURRENCY' | 'PER_TRADER_CURRENCY'>('PER_FOLLOWER_CURRENCY');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const key = useRef(newIdempotencyKey('leader-fee'));

  const policyQuery = useQuery({
    queryKey: leaderFeeQueryKey(requested, currency),
    queryFn: () => copyTradingExtendedApi.getLeaderFeePolicy(requested, currency),
    enabled: requested.length > 0,
    retry: false,
  });
  const historyQuery = useQuery({
    queryKey: leaderFeeHistoryQueryKey(requested, currency),
    queryFn: () => copyTradingExtendedApi.getLeaderFeeHistory(requested, currency),
    enabled: requested.length > 0 && canManageFees,
    retry: false,
  });

  const setPolicy = useMutation({
    mutationFn: () => {
      const value = Number(bps.trim());
      if (!Number.isInteger(value) || value < 0 || value > 10000) throw new Error(t('budget.invalidAmount'));
      return copyTradingExtendedApi.setLeaderFeePolicy(requested, {
        idempotencyKey: key.current,
        currency,
        profitShareBps: value,
        highWaterMarkScope: scope,
        ...(effectiveFrom ? { effectiveFrom } : {}),
      });
    },
    onSuccess: () => {
      setProblem(null);
      setNotice(t('fees.history'));
      key.current = newIdempotencyKey('leader-fee');
      void queryClient.invalidateQueries({ queryKey: leaderFeeQueryKey(requested, currency) });
      void queryClient.invalidateQueries({ queryKey: leaderFeeHistoryQueryKey(requested, currency) });
    },
    onError: (error) => setProblem(error instanceof Error ? error.message : t('common.error')),
  });

  const policy: PublicLeaderFeePolicy | undefined = policyQuery.data;
  const history: LeaderFeePolicyVersion[] = historyQuery.data?.data ?? [];

  return (
    <section aria-labelledby="fees-heading" className="space-y-4">
      <header>
        <h2 id="fees-heading" className="text-lg font-semibold">{t('fees.title')}</h2>
        <p className="mt-1 text-sm text-muted">{t('fees.intro')}</p>
      </header>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setRequested(traderId.trim());
        }}
      >
        <label className="block text-sm">
          <span className="font-medium">{t('fees.traderId')}</span>
          <input className="mt-1 w-full rounded border px-3 py-2" value={traderId} onChange={(event) => setTraderId(event.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="font-medium">{t('fees.currency')}</span>
          <select className="mt-1 w-full rounded border px-3 py-2" value={currency} onChange={(event) => setCurrency(event.target.value)}>
            {FEE_CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}
          </select>
        </label>
        <button type="submit" className="rounded bg-primary px-3 py-2 text-sm text-white" disabled={traderId.trim().length === 0}>
          {t('fees.load')}
        </button>
      </form>

      {requested.length === 0 && <EmptyState title={t('fees.title')} description={t('fees.intro')} />}
      {requested.length > 0 && policyQuery.isPending && <LoadingState message={t('common.loading')} />}
      {policyQuery.isError && <ErrorState error={policyQuery.error} onRetry={() => void policyQuery.refetch()} />}

      {policy && (
        <div aria-live="polite" className="space-y-2">
          {policy.status === 'UNCONFIGURED' || policy.policy === null ? (
            <EmptyState title={t('fees.empty')} description={t('fees.intro')} />
          ) : (
            <dl className="grid gap-2 sm:grid-cols-3">
              <div><dt className="text-xs text-muted">{t('fees.profitShareBps')}</dt><dd className="text-sm">{policy.policy.profitShareBps}</dd></div>
              <div><dt className="text-xs text-muted">{t('fees.highWaterMark')}</dt><dd className="text-sm">{policy.policy.highWaterMarkScope}</dd></div>
              <div><dt className="text-xs text-muted">{t('fees.calculationVersion')}</dt><dd className="text-sm">{policy.policy.version}</dd></div>
              <div><dt className="text-xs text-muted">{t('fees.feeAmount')}</dt><dd className="text-sm">{policy.feeCalculation.reason}</dd></div>
            </dl>
          )}
        </div>
      )}

      {canManageFees && (
        <>
          <h3 className="text-md font-semibold">{t('fees.history')}</h3>
          {historyQuery.isPending && requested.length > 0 && <LoadingState message={t('common.loading')} />}
          {historyQuery.isError && <ErrorState error={historyQuery.error} onRetry={() => void historyQuery.refetch()} />}
          {historyQuery.isSuccess && history.length === 0 && <EmptyState title={t('fees.empty')} description={t('fees.intro')} />}
          {history.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th scope="col" className="text-left">{t('fees.profitShareBps')}</th>
                  <th scope="col" className="text-left">{t('fees.highWaterMark')}</th>
                  <th scope="col" className="text-left">{t('fees.calculationVersion')}</th>
                  <th scope="col" className="text-left">{t('benchmark.period')}</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.id}>
                    <td>{row.profitShareBps}</td>
                    <td>{row.highWaterMarkScope}</td>
                    <td>{row.version}</td>
                    <td>{row.effectiveFrom} – {row.effectiveTo ?? t('common.unavailable')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <form
            className="grid items-end gap-3 sm:grid-cols-4"
            onSubmit={(event) => {
              event.preventDefault();
              setNotice(null);
              setPolicy.mutate();
            }}
          >
            <label className="block text-sm">
              <span className="font-medium">{t('fees.profitShareBps')}</span>
              <input className="mt-1 w-full rounded border px-3 py-2" inputMode="numeric" value={bps} onChange={(event) => setBps(event.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="font-medium">{t('fees.highWaterMark')}</span>
              <select className="mt-1 w-full rounded border px-3 py-2" value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}>
                <option value="PER_FOLLOWER_CURRENCY">PER_FOLLOWER_CURRENCY</option>
                <option value="PER_TRADER_CURRENCY">PER_TRADER_CURRENCY</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-medium">{t('benchmark.asOf')}</span>
              <input type="date" className="mt-1 w-full rounded border px-3 py-2" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} />
            </label>
            <button type="submit" className="rounded border px-3 py-2 text-sm" disabled={setPolicy.isPending}>
              {t('common.save')}
            </button>
          </form>
          <p role="status" aria-live="polite" className="min-h-[1.25rem] text-sm">
            {problem ? <span className="text-danger">{problem}</span> : notice ?? ''}
          </p>
        </>
      )}
    </section>
  );
}

// # Responsibility: the portfolio-accounting screen - choose an accounting profile, then read its net asset value, profit and loss, holdings, periods and statements.
//
// Every figure on this page is a decimal string computed by the accounting service; this component
// renders them and never adds, converts or re-rounds one. Where the service reports that it cannot
// publish a figure (a missing mark price, an open period), the page shows the reason instead of a
// number, because a client-side substitute would be a second, unpublished NAV.
'use client';
import type { JSX } from 'react';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import {
  portfolioAccountingApi,
  type AccountingProfile,
  type HoldingRow,
  type NavView,
  type PagedRows,
  type PnlView,
  type StatementRow,
} from '@/api/portfolio-accounting-api';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { LoadingState } from '@/components/loading-state';
import { StatusBadge } from '@/components/status-badge';
import { useCopy } from '@/i18n';
import { newIdempotencyKey } from '@/lib/idempotency-key';

export const accountingProfilesQueryKey = ['portfolio-accounting', 'profiles'] as const;
export const accountingNavQueryKey = (profileId: string) => ['portfolio-accounting', 'nav', profileId] as const;
export const accountingPnlQueryKey = (profileId: string) => ['portfolio-accounting', 'pnl', profileId] as const;
export const accountingHoldingsQueryKey = (profileId: string) => ['portfolio-accounting', 'holdings', profileId] as const;
export const accountingStatementsQueryKey = (profileId: string) => ['portfolio-accounting', 'statements', profileId] as const;
export const accountingPeriodsQueryKey = (profileId: string) => ['portfolio-accounting', 'periods', profileId] as const;

/**
 * `initialProfileId` opens a profile directly, which is what a statement link or a bookmarked URL does.
 * Without it the screen asks which profile to read rather than guessing one.
 */
/**
 * Which branch the screen is in, as one value.
 *
 * The component renders `loading` while the profile list is in flight, `error` when it was refused or
 * failed (through the shared ErrorState, which maps the API's message and never prints a raw body), and
 * `ready` once a profile list has arrived - possibly empty, which is its own branch in the markup.
 */
export type AccountingPhase = 'loading' | 'error' | 'ready';

export function accountingPhase(state: { isPending: boolean; isError: boolean }): AccountingPhase {
  if (state.isPending) return 'loading';
  if (state.isError) return 'error';
  return 'ready';
}

export function AccountingOverview({ initialProfileId = '' }: { initialProfileId?: string }): JSX.Element {
  const { t } = useCopy();
  const [profileId, setProfileId] = useState(initialProfileId);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const exportKey = useRefKey();

  const profilesQuery = useQuery({ queryKey: accountingProfilesQueryKey, queryFn: () => portfolioAccountingApi.listProfiles({ limit: 50 }), retry: false });
  const navQuery = useQuery({ queryKey: accountingNavQueryKey(profileId), queryFn: () => portfolioAccountingApi.getNav({ profileId }), enabled: profileId !== '', retry: false });
  const pnlQuery = useQuery({ queryKey: accountingPnlQueryKey(profileId), queryFn: () => portfolioAccountingApi.getPnl({ profileId }), enabled: profileId !== '', retry: false });
  const holdingsQuery = useQuery({ queryKey: accountingHoldingsQueryKey(profileId), queryFn: () => portfolioAccountingApi.getHoldings({ profileId, limit: 50 }), enabled: profileId !== '', retry: false });
  const statementsQuery = useQuery({ queryKey: accountingStatementsQueryKey(profileId), queryFn: () => portfolioAccountingApi.listStatements({ profileId }), enabled: profileId !== '', retry: false });
  const periodsQuery = useQuery({ queryKey: accountingPeriodsQueryKey(profileId), queryFn: () => portfolioAccountingApi.listPeriods({ profileId }), enabled: profileId !== '', retry: false });

  const exportMutation = useMutation({
    mutationFn: (statementId: string) => portfolioAccountingApi.exportStatement(statementId, 'JSON'),
    onSuccess: () => { setProblem(null); setNotice(t('accounting.exportStatement')); },
    onError: () => { setNotice(null); setProblem(t('common.error')); },
  });

  const phase = accountingPhase(profilesQuery);
  if (phase === 'loading') return <LoadingState message={t('common.loading')} />;
  if (phase === 'error') return <ErrorState error={profilesQuery.error} onRetry={() => void profilesQuery.refetch()} />;

  const profiles: AccountingProfile[] = profilesQuery.data?.data ?? [];
  const nav: NavView | undefined = navQuery.data;
  const pnl: PnlView | undefined = pnlQuery.data;
  const holdings: HoldingRow[] = holdingsQuery.data?.data ?? [];
  const statements: StatementRow[] = statementsQuery.data?.data ?? [];
  const periods: PagedRows<{ id: string; state: string; startsAt: string; endsAt: string }>['data'] = periodsQuery.data?.data ?? [];

  return (
    <section aria-labelledby="accounting-heading" className="space-y-6">
      <header>
        <h2 id="accounting-heading" className="text-lg font-semibold">{t('accounting.title')}</h2>
        <p className="mt-1 text-sm text-muted">{t('accounting.intro')}</p>
      </header>

      <label className="block max-w-sm text-sm">
        <span className="font-medium">{t('accounting.profile')}</span>
        <select className="mt-1 w-full rounded border px-3 py-2" value={profileId} onChange={(event) => setProfileId(event.target.value)}>
          <option value="">{t('accounting.profileRequired')}</option>
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>{profile.scope} · {profile.baseCurrency}</option>
          ))}
        </select>
      </label>

      {profiles.length === 0 && <EmptyState title={t('accounting.empty')} description={t('accounting.intro')} />}

      {profileId !== '' && (
        <div className="space-y-6" aria-live="polite">
          <section>
            <h3 className="text-md font-semibold">{t('accounting.nav')}</h3>
            {navQuery.isPending && <LoadingState message={t('common.loading')} />}
            {navQuery.isError && <ErrorState error={navQuery.error} onRetry={() => void navQuery.refetch()} />}
            {nav && (
              <dl className="grid gap-2 sm:grid-cols-3">
                <div><dt className="text-xs text-muted">{t('accounting.nav')}</dt><dd className="text-sm font-semibold">{nav.nav}</dd></div>
                <div><dt className="text-xs text-muted">{t('accounting.cash')}</dt><dd className="text-sm font-semibold">{nav.cash}</dd></div>
                <div><dt className="text-xs text-muted">{t('common.status')}</dt><dd><StatusBadge status={nav.dataCompleteness} /></dd></div>
              </dl>
            )}
            {nav && !nav.canPublish && <p className="mt-2 text-sm text-muted">{t('accounting.notAvailable')} {nav.valuationState ?? ''}</p>}
          </section>

          <section>
            <h3 className="text-md font-semibold">{t('accounting.pnl')}</h3>
            {pnlQuery.isPending && <LoadingState message={t('common.loading')} />}
            {pnlQuery.isError && <ErrorState error={pnlQuery.error} onRetry={() => void pnlQuery.refetch()} />}
            {pnl && (
              <dl className="grid gap-2 sm:grid-cols-4">
                <div><dt className="text-xs text-muted">{t('accounting.realised')}</dt><dd className="text-sm">{pnl.realized}</dd></div>
                <div><dt className="text-xs text-muted">{t('accounting.unrealised')}</dt><dd className="text-sm">{pnl.unrealized}</dd></div>
                <div><dt className="text-xs text-muted">{t('common.amount')}</dt><dd className="text-sm">{pnl.gross} / {pnl.net}</dd></div>
                <div><dt className="text-xs text-muted">{t('common.status')}</dt><dd><StatusBadge status={pnl.dataCompleteness ?? 'UNKNOWN'} /></dd></div>
              </dl>
            )}
          </section>

          <section>
            <h3 className="text-md font-semibold">{t('accounting.holdings')}</h3>
            {holdingsQuery.isPending && <LoadingState message={t('common.loading')} />}
            {holdingsQuery.isError && <ErrorState error={holdingsQuery.error} onRetry={() => void holdingsQuery.refetch()} />}
            {holdingsQuery.isSuccess && holdings.length === 0 && <EmptyState title={t('accounting.empty')} description={t('accounting.empty')} />}
            {holdings.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th scope="col" className="text-left">{t('common.asset')}</th>
                    <th scope="col" className="text-left">{t('accounting.quantity')}</th>
                    <th scope="col" className="text-left">{t('accounting.costBasis')}</th>
                  </tr>
                </thead>
                <tbody>
                  {holdings.map((holding) => (
                    <tr key={`${holding.symbol}-${holding.asset}`}>
                      <td>{holding.symbol}</td>
                      <td>{holding.quantity}</td>
                      <td>{holding.costBasis ?? t('common.unavailable')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section>
            <h3 className="text-md font-semibold">{t('accounting.periods')}</h3>
            {periodsQuery.isPending && <LoadingState message={t('common.loading')} />}
            {periodsQuery.isError && <ErrorState error={periodsQuery.error} onRetry={() => void periodsQuery.refetch()} />}
            {periodsQuery.isSuccess && periods.length === 0 && <EmptyState title={t('accounting.openPeriods')} description={t('accounting.empty')} />}
            {periods.length > 0 && (
              <ul className="space-y-1 text-sm">
                {periods.map((period) => (
                  <li key={period.id}>{period.startsAt} – {period.endsAt} <StatusBadge status={period.state} /></li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="text-md font-semibold">{t('accounting.statements')}</h3>
            {statementsQuery.isPending && <LoadingState message={t('common.loading')} />}
            {statementsQuery.isError && <ErrorState error={statementsQuery.error} onRetry={() => void statementsQuery.refetch()} />}
            {statementsQuery.isSuccess && statements.length === 0 && <EmptyState title={t('accounting.statementEmpty')} description={t('accounting.statementEmpty')} />}
            {statements.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th scope="col" className="text-left">{t('common.status')}</th>
                    <th scope="col" className="text-left">{t('benchmark.asOf')}</th>
                    <th scope="col" className="text-left">{t('common.action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {statements.map((statement) => (
                    <tr key={statement.id}>
                      <td>{statement.state ?? statement.kind ?? t('common.unavailable')}</td>
                      <td>{statement.generatedAt}</td>
                      <td>
                        <button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => exportMutation.mutate(statement.id)} disabled={exportMutation.isPending}>
                          {t('accounting.exportStatement')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p role="status" aria-live="polite" className="mt-2 min-h-[1.25rem] text-sm">
              {problem ? <span className="text-danger">{problem}</span> : notice ?? ''}
            </p>
          </section>
        </div>
      )}
    </section>
  );
}

/** One key per screen lifetime: an export retried after a timeout re-sends the same request. */
function useRefKey(): { current: string } {
  const [holder] = useState(() => ({ current: newIdempotencyKey('statement-export') }));
  return holder;
}

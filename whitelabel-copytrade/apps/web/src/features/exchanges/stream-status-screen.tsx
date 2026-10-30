// # Responsibility: the customer's own exchange user-data stream health and the venue status board, with "the engine did not answer" kept distinct from "the stream is healthy".
//
// The health route throws when the engine is unreachable. That is the behaviour this screen relies on:
// an unanswered engine must never be rendered as a green stream, because a customer who reads green
// will keep a position open believing stop orders are being mirrored.
'use client';
import type { JSX } from 'react';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { exchangeUserStreamApi, type ExchangeUserStreamHealth, type VenueStatusView } from '@/api/exchange-user-stream-api';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { LoadingState } from '@/components/loading-state';
import { StatusBadge } from '@/components/status-badge';
import { useCopy } from '@/i18n';

export const streamHealthQueryKey = (accountId: string) => ['exchanges', 'user-stream', accountId] as const;
export const venueStatusQueryKey = (venues: readonly string[]) => ['exchanges', 'venue-status', venues.join(',')] as const;

export function StreamStatusScreen({ initialAccountId = '' }: { initialAccountId?: string }): JSX.Element {
  const { t } = useCopy();
  const [accountId, setAccountId] = useState(initialAccountId);
  const [requested, setRequested] = useState(initialAccountId.trim());
  const [venuesInput, setVenuesInput] = useState('');
  const venues = venuesInput.split(',').map((value) => value.trim().toUpperCase()).filter((value) => value.length > 0);

  const healthQuery = useQuery({
    queryKey: streamHealthQueryKey(requested),
    queryFn: () => exchangeUserStreamApi.getStreamHealth(requested),
    enabled: requested !== '',
    retry: false,
  });
  const venueQuery = useQuery({
    queryKey: venueStatusQueryKey(venues),
    queryFn: () => exchangeUserStreamApi.listVenueStatus(venues.length > 0 ? venues : undefined),
    retry: false,
  });

  const health: ExchangeUserStreamHealth | undefined = healthQuery.data;
  const venueStatuses: VenueStatusView[] = venueQuery.data?.venues ?? [];

  return (
    <section aria-labelledby="stream-heading" className="space-y-6">
      <header>
        <h2 id="stream-heading" className="text-lg font-semibold">{t('stream.title')}</h2>
        <p className="mt-1 text-sm text-muted">{t('stream.intro')}</p>
      </header>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setRequested(accountId.trim());
        }}
      >
        <label className="block text-sm">
          <span className="font-medium">{t('stream.accountId')}</span>
          <input className="mt-1 w-full rounded border px-3 py-2" value={accountId} onChange={(event) => setAccountId(event.target.value)} />
        </label>
        <button type="submit" className="rounded bg-primary px-3 py-2 text-sm text-white" disabled={accountId.trim() === ''}>
          {t('stream.state')}
        </button>
      </form>

      {requested === '' && <EmptyState title={t('stream.title')} description={t('stream.intro')} />}
      {requested !== '' && healthQuery.isPending && <LoadingState message={t('common.loading')} />}
      {healthQuery.isError && (
        <div role="alert" className="rounded border border-warning p-3 text-sm">{t('stream.engineUnavailable')}</div>
      )}
      {health && (
        <dl aria-live="polite" className="grid gap-2 sm:grid-cols-3">
          <div><dt className="text-xs text-muted">{t('stream.venue')}</dt><dd className="text-sm">{health.venue ?? t('common.unavailable')}</dd></div>
          <div><dt className="text-xs text-muted">{t('stream.state')}</dt><dd><StatusBadge status={health.state} /></dd></div>
          <div><dt className="text-xs text-muted">{t('stream.reason')}</dt><dd className="text-sm">{health.reasonCode}</dd></div>
          <div><dt className="text-xs text-muted">{t('stream.lastEvent')}</dt><dd className="text-sm">{health.lastEventAt ?? t('common.unavailable')}</dd></div>
          <div><dt className="text-xs text-muted">{t('stream.reconnects')}</dt><dd className="text-sm">{health.reconnectCount ?? t('common.unavailable')}</dd></div>
          <div><dt className="text-xs text-muted">{t('stream.listenKeyAge')}</dt><dd className="text-sm">{health.listenKeyAgeMs ?? t('common.unavailable')}</dd></div>
          <div><dt className="text-xs text-muted">{t('stream.engineReported')}</dt><dd className="text-sm">{String(health.engineReported)}</dd></div>
        </dl>
      )}

      <section aria-labelledby="venues-heading">
        <h3 id="venues-heading" className="text-md font-semibold">{t('stream.venues')}</h3>
        <label className="mt-2 block max-w-sm text-sm">
          <span className="font-medium">{t('common.filters')}</span>
          <input className="mt-1 w-full rounded border px-3 py-2" value={venuesInput} onChange={(event) => setVenuesInput(event.target.value)} placeholder="BINANCE,COINBASE" />
        </label>
        {venueQuery.isPending && <LoadingState message={t('common.loading')} />}
        {venueQuery.isError && <ErrorState error={venueQuery.error} onRetry={() => void venueQuery.refetch()} />}
        {venueQuery.isSuccess && venueStatuses.length === 0 && <EmptyState title={t('stream.empty')} description={t('stream.venueEmpty')} />}
        {venueStatuses.length > 0 && (
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr>
                <th scope="col" className="text-left">{t('stream.venue')}</th>
                <th scope="col" className="text-left">{t('stream.venueState')}</th>
                <th scope="col" className="text-left">{t('stream.source')}</th>
                <th scope="col" className="text-left">{t('stream.verified')}</th>
                <th scope="col" className="text-left">{t('stream.checkedAt')}</th>
              </tr>
            </thead>
            <tbody>
              {venueStatuses.map((venue) => (
                <tr key={venue.venue}>
                  <td>{venue.venue}</td>
                  <td><StatusBadge status={venue.state} /></td>
                  <td>{venue.source}</td>
                  <td>{String(venue.verified)}</td>
                  <td>{venue.checkedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </section>
  );
}

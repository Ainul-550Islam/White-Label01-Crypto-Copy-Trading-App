// # Renders public trader metrics with verified provenance and owner-only portfolio exposure.
'use client';
import type { JSX } from 'react';

import { useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { tradingApi } from '@/api/trading-api';
import { customerExposureApi } from '@/api/customer-exposure-api';
import { PageContainer } from '@/layout/page-container';
import { StatusBadge } from '@/components/status-badge';
import { LoadingState } from '@/components/loading-state';
import { ErrorState } from '@/components/error-state';
import { TraderRiskScore } from './trader-risk-score';
import { ShareTraderDialog } from './share-trader-dialog';
import { shareApi, type ShareLinkSummary } from '@/api/copy-ops-api';

/**
 * Stable empty list for the share query's initial state.
 *
 * `?? []` in the render would make a new array every time and force the memoised
 * filtering inside the dialog to recompute for no reason.
 */
const NO_SHARE_LINKS: readonly ShareLinkSummary[] = [];

/**
 * The owner's entry point to a public share link.
 *
 * Only rendered for the trader themselves: a visitor must not see a button that
 * opens a dialog whose every action the API would refuse. The section is also the
 * only place a customer can find links they handed out earlier, including revoked
 * ones, because "it is gone" has to be checkable rather than asserted.
 */
function ShareProfileSection({
  traderId,
  displayName,
  existingLinks,
}: {
  traderId: string;
  displayName: string;
  existingLinks: readonly ShareLinkSummary[];
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const mine = existingLinks.filter((link) => link.subjectType === 'TRADER' && link.subjectId === traderId);
  const live = mine.filter((link) => link.revokedAt === null);

  return (
    <section className="rounded border bg-card p-4" aria-label="Share your profile">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">Share your profile</h2>
          <p className="mt-1 text-xs text-muted">
            A share link shows only the details you tick, and nothing is shared until you choose. Links expire, and you
            can revoke one at any time.
          </p>
        </div>
        <button type="button" className="rounded border px-3 py-1.5 text-sm hover:bg-slate-50" onClick={() => setOpen(true)}>
          Create a share link
        </button>
      </div>

      {mine.length > 0 && (
        <p className="mt-2 text-xs text-muted">
          {live.length === 0
            ? 'You have no active share links for this profile.'
            : `${live.length} active share link${live.length === 1 ? '' : 's'} for this profile.`}
        </p>
      )}

      <ShareTraderDialog
        open={open}
        subjectType="TRADER"
        subjectId={traderId}
        subjectLabel={displayName}
        onClose={() => setOpen(false)}
        existing={[...mine]}
      />
    </section>
  );
}

export function TraderDetailPage({ id }: { id: string }): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['trader', id],
    queryFn: () => tradingApi.getTrader(id),
  });
  const strategies = useQuery({
    queryKey: ['trader', id, 'strategies'],
    queryFn: () => tradingApi.listTraderStrategies(id, { page: 1, limit: 20 }),
    enabled: Boolean(data),
  });
  const exposure = useQuery({
    queryKey: ['trader-profile-exposure', id],
    queryFn: () => customerExposureApi.getTraderExposure(id),
    enabled: data?.viewerIsOwner === true,
    staleTime: 5_000,
  });
  const existingLinksQuery = useQuery({
    queryKey: ['share-links'],
    queryFn: () => shareApi.list(),
    enabled: data?.viewerIsOwner === true,
    staleTime: 30_000,
    retry: false,
  });

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!data) return <div className="p-4 text-sm">Trader not found</div>;

  const metrics = data.publicMetrics;
  return (
    <PageContainer title={data.displayName} description="Trader profile and source-backed public statistics">
      <div className="space-y-4">
        <div className="space-y-4 rounded border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              <StatusBadge status={data.verificationState} />
              {data.isFeatured && <StatusBadge status="FEATURED" variant="info" />}
            </div>
            <div className="flex gap-2">
              <Link href={`/traders/${data.traderId}/performance`} className="rounded border px-3 py-1 text-xs font-medium hover:bg-slate-50">Performance Analytics</Link>
              <Link href={`/traders/compare?ids=${encodeURIComponent(data.traderId)}`} className="rounded border px-3 py-1 text-xs font-medium hover:bg-slate-50">Compare</Link>
            </div>
          </div>
          <p className="text-sm">{data.bio ?? 'No bio'}</p>
          <p className="text-xs text-muted">Venues: {data.supportedVenues.join(', ') || '—'}</p>
        </div>

        <section className="grid gap-4 rounded border bg-card p-4 sm:grid-cols-2" aria-label="Trader public statistics">
          <div>
            <h2 className="font-semibold">Active followers</h2>
            {metrics?.activeFollowers.status === 'AVAILABLE' && metrics.activeFollowers.value !== null ? (
              <p className="mt-1">{metrics.activeFollowers.value} <span className="text-xs text-muted">{metrics.activeFollowers.source}</span></p>
            ) : <p className="mt-1">Active subscription records could not be verified.</p>}
            <p className="text-xs text-muted">Stored profile follower totals are not displayed because they do not establish the number of active subscriptions. The profile followerCount is not authoritative.</p>
            {metrics?.activeFollowers.asOf && <time className="text-xs text-muted" dateTime={metrics.activeFollowers.asOf}>{metrics.activeFollowers.asOf}</time>}
          </div>
          <div>
            <h2 className="font-semibold">Assets under management (AUM)</h2>
            <p className="mt-1">{metrics?.aum.status === 'AVAILABLE' && metrics.aum.value !== null ? `${metrics.aum.value} ${metrics.aum.currency ?? ''}` : 'Unavailable'}</p>
            <p className="text-xs text-muted">no account equity or estimate is substituted for an authoritative follower portfolio valuation.</p>
          </div>
          <div className="sm:col-span-2">
            <h2 className="font-semibold">Recent trading activity</h2>
            {metrics?.activity.status === 'AVAILABLE' ? (
              <>
                <p className="mt-1 text-xs text-muted">{metrics.activity.source} · {metrics.activity.sampledFillCount ?? 'Unavailable'} sampled fills of at most {metrics.activity.sampleLimit}</p>
                {metrics.activity.volumeByQuoteAsset.length ? (
                  <ul className="mt-2 flex flex-wrap gap-3">{metrics.activity.volumeByQuoteAsset.map((entry) => <li key={entry.asset} className="font-mono">{entry.amount} {entry.asset}</li>)}</ul>
                ) : <p className="mt-1 text-sm">No verified quote-asset volume is available.</p>}
                <p className="text-xs text-muted">{metrics.activity.latestRecordedFillAt ? `Latest recorded fill: ${metrics.activity.latestRecordedFillAt}` : 'Latest recorded fill unavailable'} · {metrics.activity.calculationMethod ?? 'Calculation method unavailable'}</p>
              </>
            ) : <p className="mt-1">{metrics?.activity.reason === 'SOURCE_READ_FAILED' ? 'Canonical fill provenance could not be verified.' : 'Execution records could not be verified.'}</p>}
          </div>
        </section>

        {metrics?.riskScore && <TraderRiskScore result={metrics.riskScore} />}

        {data.viewerIsOwner && (
          <section className="rounded border bg-card p-4" aria-label="Private trader profile exposure">
            <h2 className="font-semibold">Your trader-profile exposure</h2>
            {exposure.isLoading ? <p role="status" className="mt-2 text-sm text-muted">Loading your trader-profile exposure…</p>
              : exposure.error ? <p role="alert" className="mt-2 text-sm text-muted">Your exposure is unavailable.</p>
                : exposure.data ? <p role="status" className="mt-2 text-sm">{exposure.data.state} · as of {exposure.data.asOf}; simulated records and cash balances are excluded.</p>
                  : <p role="status" className="mt-2 text-sm text-muted">Your trader-profile exposure is unavailable.</p>}
          </section>
        )}

        {data.viewerIsOwner && (
          <ShareProfileSection
            traderId={data.traderId}
            displayName={data.displayName}
            existingLinks={existingLinksQuery.data ?? NO_SHARE_LINKS}
          />
        )}

        <div className="rounded border bg-card p-4">
          <h3 className="font-semibold">Strategies</h3>
          {strategies.isLoading ? <LoadingState /> : strategies.error ? <ErrorState error={strategies.error} onRetry={() => void strategies.refetch()} /> : (strategies.data?.data ?? []).length === 0 ? <p className="mt-2 text-xs text-muted">No published strategies.</p> : (
            <ul className="mt-2 space-y-2">{(strategies.data?.data ?? []).map((strategy) => <li key={strategy.strategyId} className="flex items-center justify-between text-sm"><Link href={`/strategies/${strategy.strategyId}`} className="underline">{strategy.name}</Link><StatusBadge status={strategy.status} /></li>)}</ul>
          )}
        </div>
      </div>
    </PageContainer>
  );
}

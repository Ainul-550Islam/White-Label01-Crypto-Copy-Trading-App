// # Uses persisted closed-period TWR rankings and keeps incomplete windows explicitly unranked.
'use client';
import type { JSX } from 'react';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { tradingApi, type TraderRankingTimeframe } from '@/api/trading-api';
import { PageContainer } from '@/layout/page-container';
import { TradingStateBoundary } from '@/components/trading-state';

export function LeaderboardPage(): JSX.Element {
  const [timeframe, setTimeframe] = useState<TraderRankingTimeframe>('30D');
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['leaderboard', timeframe],
    queryFn: () => tradingApi.getLeaderboard({ timeframe, limit: 25 }),
  });
  const rows = data?.data ?? [];
  const methodology = data?.methodology;

  return (
    <PageContainer
      title="Trader Leaderboard"
      description="Ranks traders only from complete, reconciled, contiguous closed-period time-weighted returns."
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs font-medium text-muted" htmlFor="leaderboard-timeframe">
          Ranking window
          <select id="leaderboard-timeframe" value={timeframe} onChange={(event) => setTimeframe(event.target.value as TraderRankingTimeframe)} className="rounded border px-3 py-1.5 text-xs">
            <option value="7D">7D</option><option value="30D">30D</option><option value="90D">90D</option>
          </select>
        </label>
        <Link href="/traders/compare" className="text-xs font-medium underline">Compare Top Traders →</Link>
      </div>
      {methodology && (
        <section className="mb-4 rounded border bg-card p-3 text-xs" data-testid="leaderboard-methodology">
          <h2 className="font-semibold">{timeframe} time-weighted return</h2>
          <p className="mt-1">{methodology.description}</p>
          <p className="mt-1">{methodology.rankedCount} ranked; {methodology.unrankedCount} unranked; {methodology.minimumPeriodCount} closed periods required.</p>
          <p className="mt-1">Start flows are included in opening NAV; end flows are excluded from closing NAV.</p>
          {methodology.asOf && <p className="mt-1">As of <time dateTime={methodology.asOf}>{methodology.asOf}</time>; this is not a claim of current market data.</p>}
          {methodology.reason && <p className="mt-1">{methodology.reason}</p>}
        </section>
      )}
      <TradingStateBoundary isLoading={isLoading} error={error} isEmpty={rows.length === 0} emptyTitle="Leaderboard is unavailable" emptyDescription="No verified ranking records are available for this window." onRetry={() => void refetch()}>
        <div className="overflow-x-auto rounded border bg-card">
          <table className="w-full text-left text-xs">
            <thead><tr className="border-b bg-slate-50 text-muted"><th className="p-3">Rank</th><th className="p-3">Trader</th><th className="p-3">Verification</th><th className="p-3">{timeframe} time-weighted return</th><th className="p-3">Evidence</th><th className="p-3">Action</th></tr></thead>
            <tbody className="divide-y">
              {rows.map((row) => {
                const available = row.periodStatus === 'AVAILABLE' && typeof row.periodReturnPercent === 'string' && row.calculationVersion !== null;
                return (
                  <tr key={row.traderId}>
                    <td className="p-3 font-mono font-semibold">{available && row.rank !== null ? `#${row.rank}` : '—'}</td>
                    <td className="p-3 font-medium"><Link href={`/traders/${encodeURIComponent(row.traderId)}`} className="underline">{row.displayName}</Link></td>
                    <td className="p-3">{row.verificationState}</td>
                    <td className="p-3 font-mono">{available ? `${row.periodReturnPercent}%` : 'Unranked — return unavailable'}</td>
                    <td className="p-3">{available ? `${row.observationCount ?? 0} closed periods · ${row.sourceCalculationVersion ?? row.calculationVersion}${row.sourceCalculationVersion && row.calculationVersion ? ` · ${row.calculationVersion}` : ""}` : row.unavailableReason ?? 'No verified period evidence'}</td>
                    <td className="p-3"><Link href={`/traders/${encodeURIComponent(row.traderId)}/performance`} className="underline">Analytics</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </TradingStateBoundary>
    </PageContainer>
  );
}

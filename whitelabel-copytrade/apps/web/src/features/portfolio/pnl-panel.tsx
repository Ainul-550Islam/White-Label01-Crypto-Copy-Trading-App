'use client';
import { useQuery } from '@tanstack/react-query';
import { portfolioApi } from '@/api/portfolio-api';
import { Money } from '@/components/money';
import { LoadingState } from '@/components/loading-state';
export function PnlPanel(): JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['portfolio', 'pnl'],
    queryFn: () => portfolioApi.getPnl({ period: '30d' }),
  });
  if (isLoading) return <LoadingState />;
  const records = data ?? [];
  return (
    <div className="rounded border bg-card p-4">
      <h3 className="font-semibold">PnL</h3>
      <ul className="mt-3 space-y-2">
        {records.slice(0,5).map((r,i) => (
          <li key={i} className="flex justify-between text-sm">
            <span>{r.period}</span><Money value={r.net} currency={r.currency} showSign />
          </li>
        ))}
        {records.length===0 && <p className="text-xs text-muted">No PnL data</p>}
      </ul>
    </div>
  );
}

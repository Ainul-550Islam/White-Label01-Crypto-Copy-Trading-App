'use client';
import { useQuery } from '@tanstack/react-query';
import { portfolioApi } from '@/api/portfolio-api';
import { Money } from '@/components/money';
import { StatusBadge } from '@/components/status-badge';
import { LoadingState } from '@/components/loading-state';
export function HoldingsTable(): JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['portfolio', 'holdings'],
    queryFn: () => portfolioApi.getHoldings({ page: 1, limit: 50 }),
  });
  if (isLoading) return <LoadingState />;
  const holdings = data?.data ?? [];
  return (
    <div className="rounded border bg-card">
      <div className="p-4"><h3 className="font-semibold">Holdings</h3></div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-y bg-gray-50 text-xs text-muted">
            <tr><th className="p-2 text-left">Symbol</th><th className="p-2 text-right">Quantity</th><th className="p-2 text-right">Market Value</th><th className="p-2">Valuation</th></tr>
          </thead>
          <tbody>
            {holdings.map((h) => (
              <tr key={h.id} className="border-b">
                <td className="p-2">{h.symbol}</td>
                <td className="p-2 text-right">{h.quantity}</td>
                <td className="p-2 text-right"><Money value={h.marketValue ?? '—'} /></td>
                <td className="p-2"><StatusBadge status={h.valuationState} /></td>
              </tr>
            ))}
            {holdings.length===0 && <tr><td colSpan={4} className="p-4 text-center text-xs text-muted">No holdings</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

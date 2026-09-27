'use client';
import { useQuery } from '@tanstack/react-query';
import { portfolioApi } from '@/api/portfolio-api';
import { Money } from '@/components/money';
import { LoadingState } from '@/components/loading-state';
export function AttributionTable(): JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['portfolio', 'attribution'],
    queryFn: () => portfolioApi.getAttribution({ dimension: 'STRATEGY' }),
  });
  if (isLoading) return <LoadingState />;
  const rows = data ?? [];
  return (
    <div className="rounded border bg-card">
      <div className="p-4"><h3 className="font-semibold">Attribution</h3></div>
      <table className="w-full text-sm">
        <thead className="border-y bg-gray-50 text-xs text-muted"><tr><th className="p-2 text-left">Dimension</th><th className="p-2 text-left">Key</th><th className="p-2 text-right">PnL</th><th className="p-2 text-right">Return</th></tr></thead>
        <tbody>
          {rows.map((r,i) => (
            <tr key={i} className="border-b"><td className="p-2">{r.dimension}</td><td className="p-2">{r.key}</td><td className="p-2 text-right"><Money value={r.pnl} showSign /></td><td className="p-2 text-right">{r.returnPct}%</td></tr>
          ))}
          {rows.length===0 && <tr><td colSpan={4} className="p-4 text-center text-xs text-muted">No attribution data</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

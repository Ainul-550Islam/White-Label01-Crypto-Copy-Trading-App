'use client';
import { useQuery } from '@tanstack/react-query';
import { portfolioApi } from '@/api/portfolio-api';
import { StatusBadge } from '@/components/status-badge';
export function ValuationStatus(): JSX.Element {
  const { data } = useQuery({
    queryKey: ['portfolio', 'valuation-status'],
    queryFn: () => portfolioApi.getValuationStatus(),
  });
  if (!data) return <div className="text-xs text-muted">Valuation status unavailable</div>;
  return (
    <div className="rounded border bg-card p-3 text-xs">
      <div className="flex items-center gap-2"><span>Valuation:</span><StatusBadge status={data.state} /><span>Last: {new Date(data.lastValuationAt).toLocaleString()}</span></div>
      {data.missingPrices?.length>0 && <p className="mt-1 text-yellow-700">Missing prices: {data.missingPrices.join(', ')}</p>}
      {data.fxStatus && data.fxStatus!=='VALID' && <p className="mt-1 text-yellow-700">FX: {data.fxStatus}</p>}
    </div>
  );
}

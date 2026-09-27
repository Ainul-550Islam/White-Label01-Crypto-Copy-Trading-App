'use client';
import { useQuery } from '@tanstack/react-query';
import { tradingApi } from '@/api/trading-api';
import { StatusBadge } from '@/components/status-badge';
import { LoadingState } from '@/components/loading-state';
export function TradingStatus(): JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['trading-status'],
    queryFn: () => tradingApi.getTradingStatus(),
  });
  if (isLoading) return <LoadingState />;
  if (!data) return <div className="text-xs text-muted">Trading status unavailable</div>;
  return (
    <div className="rounded border bg-card p-4 text-sm">
      <div className="flex gap-2"><StatusBadge status={data.eligibility} />{data.isLive ? <StatusBadge status="LIVE" variant="success" /> : <StatusBadge status="NOT LIVE" variant="warning" />}</div>
      {data.restrictions.length>0 && <div className="mt-2"><p className="font-medium">Restrictions:</p><ul className="list-disc pl-4 text-xs">{data.restrictions.map((r,i) => <li key={i}>{r.type}: {r.reason}</li>)}</ul></div>}
      {data.maintenance?.active && <p className="mt-2 text-xs text-yellow-700">Maintenance: {data.maintenance.message}</p>}
    </div>
  );
}

'use client';
import { useQuery } from '@tanstack/react-query';
import { portfolioApi } from '@/api/portfolio-api';
import { LoadingState } from '@/components/loading-state';
export function PerformanceChart(): JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['portfolio', 'performance'],
    queryFn: () => portfolioApi.getPerformance({ period: '30d', granularity: '1d' }),
  });
  if (isLoading) return <LoadingState />;
  const points = data ?? [];
  return (
    <div className="rounded border bg-card p-4">
      <h3 className="font-semibold">Performance</h3>
      <p className="text-xs text-muted">Backend-returned series only, no frontend calculation</p>
      <div className="mt-4 h-40 overflow-x-auto">
        {points.length===0 ? <p className="text-xs text-muted">No performance data</p> :
          <div className="flex items-end gap-1">
            {points.slice(0,30).map((p,i) => (
              <div key={i} className="flex flex-col items-center">
                <div className="w-2 bg-primary" style={{ height: `${Math.min(100, Math.max(5, parseFloat(p.returnPct) + 50))}px` }} title={`${p.timestamp}: ${p.returnPct}%`} />
              </div>
            ))}
          </div>
        }
      </div>
    </div>
  );
}

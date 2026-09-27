'use client';
import { useQuery } from '@tanstack/react-query';
import { billingApi } from '@/api/billing-api';
import { PageContainer } from '@/layout/page-container';
import { LoadingState } from '@/components/loading-state';
export function UsagePage(): JSX.Element {
  const { data, isLoading } = useQuery({ queryKey: ['billing', 'usage'], queryFn: () => billingApi.getUsage() });
  return (
    <PageContainer title="Usage" description="Backend usage/quota/metering data">
      {isLoading ? <LoadingState /> :
        <div className="grid gap-4 md:grid-cols-2">
          {(data ?? []).map((u) => (
            <div key={u.meter} className="rounded border bg-card p-4">
              <h4 className="font-medium">{u.meter}</h4>
              <div className="mt-2 h-2 w-full rounded bg-gray-200"><div className="h-2 rounded bg-primary" style={{ width: `${Math.min(100, (u.current / Math.max(1, u.limit)) * 100)}%` }} /></div>
              <p className="mt-1 text-xs text-muted">{u.current} / {u.limit} (remaining {u.limit - u.current})</p>
              <p className="text-xs">Period: {new Date(u.periodStart).toLocaleDateString()} - {new Date(u.periodEnd).toLocaleDateString()}</p>
            </div>
          ))}
        </div>
      }
    </PageContainer>
  );
}

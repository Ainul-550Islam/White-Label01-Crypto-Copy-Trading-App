'use client';
import { useQuery } from '@tanstack/react-query';
import { tradingApi } from '@/api/trading-api';
import { PageContainer } from '@/layout/page-container';
import { StatusBadge } from '@/components/status-badge';
import { LoadingState } from '@/components/loading-state';
import { CopySubscriptionFlow } from './copy-subscription-flow';
export function StrategyDetailPage({ id }: { id: string }): JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['strategy', id],
    queryFn: () => tradingApi.getStrategy(id),
  });
  if (isLoading) return <LoadingState />;
  if (!data) return <div className="p-4">Strategy not found</div>;
  return (
    <PageContainer title={data.name} description="Strategy metadata from authoritative backend">
      <div className="space-y-4">
        <div className="rounded border bg-card p-4">
          <div className="flex gap-2"><StatusBadge status={data.status} /><StatusBadge status={data.health} /><StatusBadge status={data.type} /></div>
          <p className="mt-2 text-sm">{data.description ?? 'No description'}</p>
          <p className="mt-2 text-xs text-muted">Trader: {data.traderName} Version: {data.version}</p>
          <p className="text-xs">Can Copy: {data.eligibility.canCopy ? 'Yes' : 'No'} {data.eligibility.reasons?.join(', ')}</p>
        </div>
        {data.eligibility.canCopy && <CopySubscriptionFlow strategyId={data.id} />}
      </div>
    </PageContainer>
  );
}

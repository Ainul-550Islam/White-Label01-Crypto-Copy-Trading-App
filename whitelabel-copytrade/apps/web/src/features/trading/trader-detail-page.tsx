'use client';
import { useQuery } from '@tanstack/react-query';
import { tradingApi } from '@/api/trading-api';
import { PageContainer } from '@/layout/page-container';
import { StatusBadge } from '@/components/status-badge';
import { LoadingState } from '@/components/loading-state';
import { ErrorState } from '@/components/error-state';
export function TraderDetailPage({ id }: { id: string }): JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ['trader', id],
    queryFn: () => tradingApi.getTrader(id),
  });
  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} />;
  if (!data) return <div className="p-4 text-sm">Trader not found</div>;
  return (
    <PageContainer title={data.displayName} description="Trader profile from authoritative backend">
      <div className="space-y-4 rounded border bg-card p-4">
        <div className="flex gap-2"><StatusBadge status={data.verificationState} /><StatusBadge status={data.status} /></div>
        <p className="text-sm">{data.bio ?? 'No bio'}</p>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>Total Return: {data.performance.totalReturn}</div>
          <div>Monthly: {data.performance.monthlyReturn}</div>
          <div>Max Drawdown: {data.performance.maxDrawdown}</div>
          <div>Win Rate: {data.performance.winRate}</div>
        </div>
      </div>
    </PageContainer>
  );
}

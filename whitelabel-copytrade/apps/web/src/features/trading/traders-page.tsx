'use client';
import { useQuery } from '@tanstack/react-query';
import { tradingApi } from '@/api/trading-api';
import { PageContainer } from '@/layout/page-container';
import { StatusBadge } from '@/components/status-badge';
import { Money } from '@/components/money';
import { LoadingState } from '@/components/loading-state';
import Link from 'next/link';
export function TradersPage(): JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['traders'],
    queryFn: () => tradingApi.listTraders({ page: 1, limit: 20 }),
  });
  return (
    <PageContainer title="Traders" description="Discover traders from backend-authoritative sources">
      {isLoading ? <LoadingState /> :
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {(data?.data ?? []).map((t) => (
            <Link key={t.id} href={`/traders/${t.id}`} className="rounded border bg-card p-4 hover:shadow">
              <div className="flex justify-between"><h3 className="font-semibold">{t.displayName}</h3><StatusBadge status={t.verificationState} /></div>
              <p className="mt-2 text-xs text-muted">Return: {t.performance.totalReturn} | Drawdown: {t.performance.maxDrawdown}</p>
              <p className="text-xs">Followers: {t.followerCount} Strategies: {t.strategyCount}</p>
            </Link>
          ))}
        </div>
      }
    </PageContainer>
  );
}

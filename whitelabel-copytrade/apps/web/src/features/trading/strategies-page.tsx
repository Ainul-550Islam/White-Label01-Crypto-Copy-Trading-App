'use client';
import { useQuery } from '@tanstack/react-query';
import { tradingApi } from '@/api/trading-api';
import { PageContainer } from '@/layout/page-container';
import { StatusBadge } from '@/components/status-badge';
import { LoadingState } from '@/components/loading-state';
import Link from 'next/link';
export function StrategiesPage(): JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['strategies'],
    queryFn: () => tradingApi.listStrategies({ page: 1, limit: 20 }),
  });
  return (
    <PageContainer title="Strategies" description="Strategy catalog and eligibility from backend">
      {isLoading ? <LoadingState /> :
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {(data?.data ?? []).map((s) => (
            <Link key={s.id} href={`/strategies/${s.id}`} className="rounded border bg-card p-4 hover:shadow">
              <div className="flex justify-between"><h3 className="font-semibold">{s.name}</h3><StatusBadge status={s.status} /></div>
              <p className="text-xs text-muted">Trader: {s.traderName} | Health: {s.health}</p>
              <p className="mt-1 text-xs">Eligibility: {s.eligibility.canCopy ? 'Can Copy' : (s.eligibility.reasons?.join(', ') ?? 'Not eligible')}</p>
            </Link>
          ))}
        </div>
      }
    </PageContainer>
  );
}

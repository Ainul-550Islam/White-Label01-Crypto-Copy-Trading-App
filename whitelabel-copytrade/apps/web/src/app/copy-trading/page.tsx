'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { AppShell } from '@/layout/app-shell';
import { PageContainer } from '@/layout/page-container';
import { useQuery } from '@tanstack/react-query';
import { tradingApi } from '@/api/trading-api';
import { StatusBadge } from '@/components/status-badge';
import { Money } from '@/components/money';
import { LoadingState } from '@/components/loading-state';
export default function Page(): JSX.Element {
  const { data, isLoading } = useQuery({ queryKey: ['copy-subs'], queryFn: () => tradingApi.listCopySubscriptions() });
  return (
    <AuthGuard>
      <AppShell>
        <PageContainer title="Copy Trading" description="Subscriptions from backend">
          {isLoading ? <LoadingState /> : <ul className="space-y-2">{(data?.data ?? []).map((s) => <li key={s.id} className="rounded border p-3 text-sm flex justify-between"><span>{s.strategyId}</span><span><Money value={s.allocationAmount} /> <StatusBadge status={s.status} /></span></li>)}</ul>}
        </PageContainer>
      </AppShell>
    </AuthGuard>
  );
}

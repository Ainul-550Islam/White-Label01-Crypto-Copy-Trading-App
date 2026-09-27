'use client';
/**
 * Exchange accounts list
 * Security: Never exposes exchange secrets, only backend-verified status
 */
import { useQuery } from '@tanstack/react-query';
import { exchangeApi } from '@/api/exchange-api';
import { PageContainer } from '@/layout/page-container';
import { StatusBadge } from '@/components/status-badge';
import { LoadingState } from '@/components/loading-state';
import { EmptyState } from '@/components/empty-state';
import Link from 'next/link';
export function ExchangeAccountsPage(): JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['exchanges', 'accounts'],
    queryFn: () => exchangeApi.listAccounts(),
  });
  return (
    <PageContainer title="Exchange Accounts" description="Customer exchange-account list, no secret exposure" actions={<Link href="/exchanges/connect" className="rounded bg-primary px-4 py-2 text-sm text-white">Connect Exchange</Link>}>
      {isLoading ? <LoadingState /> : (data?.data.length===0 ? <EmptyState title="No exchange accounts" description="Connect your exchange to start trading" action={{ label: 'Connect', href: '/exchanges/connect' }} /> :
        <div className="grid gap-4 md:grid-cols-2">
          {(data?.data ?? []).map((a) => (
            <Link key={a.id} href={`/exchanges/${a.id}`} className="rounded border bg-card p-4 hover:shadow">
              <div className="flex justify-between"><span className="font-medium">{a.exchange}</span><StatusBadge status={a.health} /></div>
              <p className="text-xs text-muted">{a.label ?? a.id} | Status: {a.status}</p>
              <p className="text-xs">Trading: {a.tradingEnabled ? 'Enabled' : 'Disabled'}</p>
            </Link>
          ))}
        </div>
      )}
    </PageContainer>
  );
}

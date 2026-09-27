'use client';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/api-client';
import { PageContainer } from '@/layout/page-container';
import { StatusBadge } from '@/components/status-badge';
import { LoadingState } from '@/components/loading-state';
export function AccountPage(): JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['account', 'institutional'],
    queryFn: () => apiClient.get<{ id: string; state: string; complianceStatus: string; riskStatus: string; name: string }>('/client-lifecycle/accounts/current'),
  });
  return (
    <PageContainer title="Institutional Account" description="Account overview, status, restrictions">
      {isLoading ? <LoadingState /> : data ? <div className="rounded border bg-card p-4 space-y-2 text-sm"><p>Name: {data.name}</p><div className="flex gap-2"><StatusBadge status={data.state} /><StatusBadge status={data.complianceStatus} /><StatusBadge status={data.riskStatus} /></div></div> : <p className="text-sm text-muted">No account data</p>}
    </PageContainer>
  );
}

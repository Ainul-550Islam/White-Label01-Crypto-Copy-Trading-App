'use client';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/api-client';
import { PageContainer } from '@/layout/page-container';
import { LoadingState } from '@/components/loading-state';
import { StatusBadge } from '@/components/status-badge';
export function RelationshipsPage(): JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['account', 'relationships'],
    queryFn: () => apiClient.get<{ data: Array<{ id: string; type: string; status: string; targetId: string }> }>('/client-lifecycle/relationships'),
  });
  return (
    <PageContainer title="Relationships" description="Authorized trader/follower/strategy relationships">
      {isLoading ? <LoadingState /> :
        <table className="w-full text-sm"><thead className="border-y bg-gray-50 text-xs text-muted"><tr><th className="p-2 text-left">Type</th><th className="p-2">Status</th><th className="p-2">Target</th></tr></thead>
        <tbody>{(data?.data ?? []).map((r) => <tr key={r.id} className="border-b"><td className="p-2">{r.type}</td><td className="p-2"><StatusBadge status={r.status} /></td><td className="p-2 font-mono text-xs">{r.targetId.slice(0,8)}</td></tr>)}</tbody></table>
      }
    </PageContainer>
  );
}

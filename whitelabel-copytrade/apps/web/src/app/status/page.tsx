'use client';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/api-client';
import { PageContainer } from '@/layout/page-container';
import { StatusBadge } from '@/components/status-badge';
export default function Page(): JSX.Element {
  const { data } = useQuery({ queryKey: ['status'], queryFn: () => apiClient.get<{ status: string; maintenance?: { active: boolean; message: string } }>('/operations/status') });
  return <PageContainer title="System Status"><div className="rounded border p-4"><StatusBadge status={data?.status ?? 'UNKNOWN'} /><p className="mt-2 text-sm">{data?.maintenance?.active ? data.maintenance.message : 'All systems operational'}</p></div></PageContainer>;
}

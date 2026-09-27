'use client';
/**
 * Restrictions page
 * Handles NO_TRADING, NO_WITHDRAWAL, ACCOUNT_LOCKED etc with reason from backend
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/api-client';
import { PageContainer } from '@/layout/page-container';
import { StatusBadge } from '@/components/status-badge';
import { LoadingState } from '@/components/loading-state';
export function RestrictionsPage(): JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['account', 'restrictions'],
    queryFn: () => apiClient.get<{ data: Array<{ id: string; restrictionType: string; reason: string; status: string; scope: string }> }>('/client-lifecycle/restrictions'),
  });
  return (
    <PageContainer title="Restrictions" description="Existing account restrictions and reasons from backend">
      {isLoading ? <LoadingState /> :
        <div className="space-y-2">
          {(data?.data ?? []).map((r) => (
            <div key={r.id} className="rounded border bg-card p-3 text-sm">
              <div className="flex gap-2"><StatusBadge status={r.restrictionType} variant="danger" /><StatusBadge status={r.status} /></div>
              <p className="mt-1 text-xs">Scope: {r.scope}</p>
              <p className="text-xs text-muted">Reason: {r.reason}</p>
              <p className="mt-1 text-xs text-muted">Users cannot remove restrictions from frontend. Contact support.</p>
            </div>
          ))}
          {(data?.data.length===0) && <p className="text-xs text-muted">No restrictions</p>}
        </div>
      }
    </PageContainer>
  );
}

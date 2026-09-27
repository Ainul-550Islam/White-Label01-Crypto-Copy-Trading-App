'use client';
import { useQuery } from '@tanstack/react-query';
import { fundingApi } from '@/api/funding-api';
import { FundingStatusBadge } from '@/components/status-badge';
import { LoadingState } from '@/components/loading-state';
export function FundingStatus(): JSX.Element {
  // Requested state is initial, not completed. Pending does not mean completed.
  const { data, isLoading } = useQuery({
    queryKey: ['funding', 'status'],
    queryFn: () => fundingApi.listFundingRequests({ page: 1, limit: 5 }),
  });
  if (isLoading) return <LoadingState />;
  const items = data?.data ?? [];
  return (
    <div className="rounded border bg-card p-4">
      <h3 className="font-semibold">Funding Status</h3>
      <p className="text-xs text-muted">Requested → Under Review → Approved → Submitted → Confirming → Confirmed → Failed/Reversed. Pending ≠ completed.</p>
      <ul className="mt-3 space-y-1">
        {items.map((f) => (
          <li key={f.id} className="flex justify-between text-xs"><span>{f.type} {f.asset} {f.amount}</span><FundingStatusBadge state={f.state} /></li>
        ))}
        {items.length===0 && <p className="text-xs text-muted">No funding requests</p>}
      </ul>
    </div>
  );
}

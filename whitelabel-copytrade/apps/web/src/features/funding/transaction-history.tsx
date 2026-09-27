'use client';
import { useQuery } from '@tanstack/react-query';
import { fundingApi } from '@/api/funding-api';
import { Money } from '@/components/money';
import { FundingStatusBadge } from '@/components/status-badge';
import { LoadingState } from '@/components/loading-state';
export function TransactionHistory(): JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['funding', 'history'],
    queryFn: () => fundingApi.listFundingRequests({ page: 1, limit: 20 }),
  });
  if (isLoading) return <LoadingState />;
  const items = data?.data ?? [];
  return (
    <div className="rounded border bg-card">
      <div className="p-4"><h3 className="font-semibold">Transaction History</h3><p className="text-xs text-muted">Persisted funding/withdrawal history from backend</p></div>
      <table className="w-full text-sm">
        <thead className="border-y bg-gray-50 text-xs text-muted"><tr><th className="p-2 text-left">Type</th><th className="p-2 text-left">Asset</th><th className="p-2 text-right">Amount</th><th className="p-2">State</th><th className="p-2 text-left">Date</th></tr></thead>
        <tbody>
          {items.map((f) => (
            <tr key={f.id} className="border-b"><td className="p-2">{f.type}</td><td className="p-2">{f.asset}</td><td className="p-2 text-right"><Money value={f.amount} /></td><td className="p-2"><FundingStatusBadge state={f.state} /></td><td className="p-2 text-xs">{new Date(f.createdAt).toLocaleString()}</td></tr>
          ))}
          {items.length===0 && <tr><td colSpan={5} className="p-4 text-center text-xs text-muted">No transactions</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

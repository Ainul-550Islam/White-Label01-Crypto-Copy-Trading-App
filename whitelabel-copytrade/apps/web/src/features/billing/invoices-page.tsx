'use client';
import { useQuery } from '@tanstack/react-query';
import { billingApi } from '@/api/billing-api';
import { PageContainer } from '@/layout/page-container';
import { Money } from '@/components/money';
import { StatusBadge } from '@/components/status-badge';
import { LoadingState } from '@/components/loading-state';
export function InvoicesPage(): JSX.Element {
  const { data, isLoading } = useQuery({ queryKey: ['billing', 'invoices'], queryFn: () => billingApi.listInvoices({ page: 1, limit: 20 }) });
  return (
    <PageContainer title="Invoices" description="Persisted invoice history from backend">
      {isLoading ? <LoadingState /> :
        <table className="w-full text-sm">
          <thead className="border-y bg-gray-50 text-xs text-muted"><tr><th className="p-2 text-left">Number</th><th className="p-2">Status</th><th className="p-2 text-right">Amount</th><th className="p-2">Date</th></tr></thead>
          <tbody>
            {(data?.data ?? []).map((inv) => (
              <tr key={inv.id} className="border-b"><td className="p-2">{inv.number}</td><td className="p-2"><StatusBadge status={inv.status} /></td><td className="p-2 text-right"><Money value={inv.amount} currency={inv.currency} /></td><td className="p-2 text-xs">{new Date(inv.createdAt).toLocaleDateString()}</td></tr>
            ))}
          </tbody>
        </table>
      }
    </PageContainer>
  );
}

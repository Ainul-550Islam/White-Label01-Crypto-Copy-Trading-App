"use client";
import { useQuery } from "@tanstack/react-query";
import { billingApi } from "@/api/billing-api";
import { PageContainer } from "@/layout/page-container";
import { Money } from "@/components/money";
import { StatusBadge } from "@/components/status-badge";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : "—";
}

export function InvoicesPage(): JSX.Element {
  const invoices = useQuery({
    queryKey: ["billing", "invoices"],
    queryFn: () => billingApi.listInvoices({ limit: 50 }),
  });
  const payments = useQuery({
    queryKey: ["billing", "payments"],
    queryFn: () => billingApi.listPayments({ limit: 20 }),
  });

  return (
    <PageContainer
      title="Invoices"
      description="Persisted invoice history from backend"
    >
      {invoices.isLoading ? (
        <LoadingState message="Loading invoices..." />
      ) : invoices.error ? (
        <ErrorState
          error={invoices.error}
          onRetry={() => void invoices.refetch()}
        />
      ) : (invoices.data?.data ?? []).length === 0 ? (
        <EmptyState
          title="No invoices yet"
          description="Invoices are issued at the start of each billing period."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-y bg-gray-50 text-xs text-muted">
              <tr>
                <th className="p-2 text-left">Number</th>
                <th className="p-2 text-left">Period</th>
                <th className="p-2">Status</th>
                <th className="p-2 text-right">Tax</th>
                <th className="p-2 text-right">Total</th>
                <th className="p-2 text-right">Due</th>
                <th className="p-2">Issued</th>
              </tr>
            </thead>
            <tbody>
              {(invoices.data?.data ?? []).map((inv) => (
                <tr key={inv.id} className="border-b">
                  <td className="p-2">{inv.number}</td>
                  <td className="p-2 text-xs">
                    {formatDate(inv.periodStart)} – {formatDate(inv.periodEnd)}
                  </td>
                  <td className="p-2 text-center">
                    <StatusBadge status={inv.status} />
                  </td>
                  <td className="p-2 text-right">
                    <Money value={inv.taxTotal} currency={inv.currency} />
                  </td>
                  <td className="p-2 text-right">
                    <Money value={inv.total} currency={inv.currency} />
                  </td>
                  <td className="p-2 text-right">
                    <Money value={inv.amountDue} currency={inv.currency} />
                  </td>
                  <td className="p-2 text-center text-xs">
                    {formatDate(inv.issueDate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="mt-8 text-sm font-semibold">Payments</h3>
      {payments.isLoading ? (
        <LoadingState message="Loading payments..." />
      ) : payments.error ? (
        <ErrorState
          error={payments.error}
          onRetry={() => void payments.refetch()}
        />
      ) : (payments.data?.data ?? []).length === 0 ? (
        <p className="mt-2 text-xs text-muted">No payments yet.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {(payments.data?.data ?? []).map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between rounded border bg-card p-3 text-sm"
            >
              <div>
                <p>
                  {p.provider}
                  {p.planCode ? ` · ${p.planCode}` : ""}
                </p>
                <p className="text-xs text-muted">
                  {formatDate(p.paidAt ?? p.failedAt ?? p.createdAt)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Money value={p.amount} currency={p.currency} />
                <StatusBadge status={p.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}

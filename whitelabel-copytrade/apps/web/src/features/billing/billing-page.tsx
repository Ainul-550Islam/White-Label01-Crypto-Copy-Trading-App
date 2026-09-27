'use client';
import { PageContainer } from '@/layout/page-container';
import { useQuery } from '@tanstack/react-query';
import { billingApi } from '@/api/billing-api';
import { Money } from '@/components/money';
import { StatusBadge } from '@/components/status-badge';
import { LoadingState } from '@/components/loading-state';
import Link from 'next/link';
export function BillingPage(): JSX.Element {
  const { data: sub, isLoading: subLoading } = useQuery({ queryKey: ['billing', 'subscription'], queryFn: () => billingApi.getCurrentSubscription() });
  const { data: usage, isLoading: usageLoading } = useQuery({ queryKey: ['billing', 'usage'], queryFn: () => billingApi.getUsage() });
  return (
    <PageContainer title="Billing" description="Customer billing dashboard from backend" actions={<div className="flex gap-2"><Link href="/billing/plans" className="rounded border px-4 py-2 text-sm">View Plans</Link><Link href="/billing/invoices" className="rounded border px-4 py-2 text-sm">Invoices</Link></div>}>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded border bg-card p-4">
          <h3 className="font-semibold">Subscription</h3>
          {subLoading ? <LoadingState /> : sub ? <div className="mt-2 text-sm"><p>{sub.planName} <StatusBadge status={sub.status} /></p><p className="text-xs text-muted">Period ends {new Date(sub.currentPeriodEnd).toLocaleDateString()}</p></div> : <p className="text-xs text-muted">No subscription</p>}
        </div>
        <div className="rounded border bg-card p-4">
          <h3 className="font-semibold">Usage</h3>
          {usageLoading ? <LoadingState /> : <ul className="mt-2 space-y-1 text-xs">{(usage ?? []).map((u) => <li key={u.meter} className="flex justify-between"><span>{u.meter}</span><span>{u.current}/{u.limit}</span></li>)}</ul>}
        </div>
      </div>
    </PageContainer>
  );
}

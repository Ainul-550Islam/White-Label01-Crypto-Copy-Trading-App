'use client';
import { useQuery } from '@tanstack/react-query';
import { billingApi } from '@/api/billing-api';
import { PageContainer } from '@/layout/page-container';
import { StatusBadge } from '@/components/status-badge';
import { LoadingState } from '@/components/loading-state';
import { ConfirmationDialog } from '@/components/confirmation-dialog';
import { useState } from 'react';
export function SubscriptionPage(): JSX.Element {
  const { data, isLoading, refetch } = useQuery({ queryKey: ['billing', 'subscription', 'current'], queryFn: () => billingApi.getCurrentSubscription() });
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  if (isLoading) return <LoadingState />;
  if (!data) return <PageContainer title="Subscription"><p className="text-sm text-muted">No active subscription</p></PageContainer>;
  return (
    <PageContainer title="Subscription" description="Subscription status and lifecycle from backend">
      <div className="rounded border bg-card p-4">
        <div className="flex justify-between"><h3 className="font-semibold">{data.planName}</h3><StatusBadge status={data.status} /></div>
        <p className="mt-2 text-xs text-muted">Current period: {new Date(data.currentPeriodStart).toLocaleDateString()} - {new Date(data.currentPeriodEnd).toLocaleDateString()}</p>
        <p className="text-xs">Cancel at period end: {data.cancelAtPeriodEnd ? 'Yes' : 'No'}</p>
        <div className="mt-4 flex gap-2">
          <button onClick={() => setConfirmOpen(true)} className="rounded border px-3 py-1 text-xs">Cancel</button>
          <button onClick={async () => { setLoading(true); await billingApi.resumeSubscription(); setLoading(false); refetch(); }} className="rounded border px-3 py-1 text-xs" disabled={loading}>Resume</button>
        </div>
      </div>
      <ConfirmationDialog open={confirmOpen} title="Cancel Subscription" description="Are you sure you want to cancel your subscription? You will retain access until period end." variant="destructive" confirmLabel="Cancel Subscription" onConfirm={async () => { await billingApi.cancelSubscription({ cancelAtPeriodEnd: true }); setConfirmOpen(false); refetch(); }} onCancel={() => setConfirmOpen(false)} />
    </PageContainer>
  );
}

'use client';
import { useQuery } from '@tanstack/react-query';
import { billingApi } from '@/api/billing-api';
import { Money } from '@/components/money';
import { LoadingState } from '@/components/loading-state';
import Link from 'next/link';
export function PlanComparison(): JSX.Element {
  const { data, isLoading } = useQuery({ queryKey: ['billing', 'plans'], queryFn: () => billingApi.listPlans() });
  if (isLoading) return <LoadingState />;
  const plans = data ?? [];
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {plans.map((p) => (
        <div key={p.id} className="rounded border bg-card p-4">
          <h3 className="font-semibold">{p.name} {p.isPopular && <span className="ml-2 rounded bg-primary px-2 py-0.5 text-xs text-white">Popular</span>}</h3>
          <p className="mt-2"><Money value={p.price} currency={p.currency} /> / {p.billingInterval}</p>
          <ul className="mt-3 space-y-1 text-xs">{p.features.map((f,i) => <li key={i}>✓ {f}</li>)}</ul>
          <Link href={`/billing/checkout?planId=${p.id}`} className="mt-4 block rounded bg-primary px-4 py-2 text-center text-sm text-white">Choose {p.name}</Link>
        </div>
      ))}
      {plans.length===0 && <p className="text-xs text-muted">No plans available</p>}
    </div>
  );
}

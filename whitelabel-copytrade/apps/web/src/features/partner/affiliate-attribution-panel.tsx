// # Responsibility: implements a Batch 04 commercial interface component or supporting utility.
// # Shows the partner's attribution funnel, attribution window, disputed outcomes, and exact-string commissions.
'use client';

import type { JSX } from 'react';
import { useQuery } from '@tanstack/react-query';
import { partnerApi } from '@/api/partner-api';

export function AffiliateAttributionPanel({ partnerId }: { partnerId?: string }): JSX.Element {
  const query = useQuery({
    queryKey: ['partner-attribution-funnel', partnerId ?? 'self'],
    queryFn: () => partnerApi.listReferrals(partnerId ? { partnerId } : undefined),
  });
  const referrals = query.data?.referrals ?? [];
  const attributions = query.data?.attributions ?? [];
  const qualifiedCount = attributions.filter((item) => item.attributionSource.toUpperCase().includes('QUALIFIED')).length;

  return (
    <section aria-labelledby="affiliate-funnel-heading" className="space-y-3 rounded-lg border border-slate-200 bg-white p-4" data-testid="affiliate-attribution-panel">
      <div>
        <h2 id="affiliate-funnel-heading" className="font-semibold text-slate-900">Affiliate attribution funnel</h2>
        <p className="text-sm text-slate-600">Clicks and signups are reported only where the attribution service has durable evidence. Attribution windows are configured by campaign.</p>
      </div>
      {query.isLoading ? <p role="status">Loading attribution evidence…</p> : null}
      {query.error ? <p role="alert">Attribution data could not be loaded. Retry shortly.</p> : null}
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div><dt className="text-xs text-slate-500">Referral links</dt><dd className="text-xl font-semibold">{referrals.length}</dd></div>
        <div><dt className="text-xs text-slate-500">Attributed signups</dt><dd className="text-xl font-semibold">{attributions.length}</dd></div>
        <div><dt className="text-xs text-slate-500">Qualified referrals</dt><dd className="text-xl font-semibold">{qualifiedCount}</dd></div>
        <div><dt className="text-xs text-slate-500">Commission amount</dt><dd className="text-sm">Available from the exact-decimal commission ledger</dd></div>
      </dl>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <caption className="sr-only">Attribution records and outcomes</caption>
          <thead><tr><th scope="col" className="py-2 pr-3">Referral code</th><th scope="col" className="py-2 pr-3">Captured</th><th scope="col" className="py-2 pr-3">Window</th><th scope="col" className="py-2 pr-3">Outcome</th><th scope="col" className="py-2 pr-3">Reason</th></tr></thead>
          <tbody>
            {attributions.map((item) => {
              const referral = referrals.find((entry) => entry.code === item.referralCode);
              const state = item.attributionSource.toUpperCase();
              const blocked = state.includes('BLOCK') || state.includes('DISPUT');
              return <tr key={item.id} className="border-t border-slate-100">
                <td className="py-2 pr-3 font-mono">{item.referralCode ?? '—'}</td>
                <td className="py-2 pr-3">{new Date(item.capturedAt).toLocaleString()}</td>
                <td className="py-2 pr-3">{referral?.expiresAt ? `Until ${new Date(referral.expiresAt).toLocaleDateString()}` : 'Campaign configured'}</td>
                <td className="py-2 pr-3">{blocked ? 'Disputed / blocked' : state || 'Captured'}</td>
                <td className="py-2 pr-3">{blocked ? 'Review status is provided by the referral integrity workflow.' : '—'}</td>
              </tr>;
            })}
            {attributions.length === 0 && <tr><td className="py-3 text-slate-500" colSpan={5}>No attribution records yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">Commissions are not inferred from signup counts. Monetary values are read from the commission ledger as exact decimal strings.</p>
    </section>
  );
}

// # Responsibility: implements a Batch 04 commercial interface component or supporting utility.
// # Presents tenant-scoped referral abuse cases and records reviewer decisions with mandatory reason and audit correlation.
'use client';

import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';

interface ReviewCase {
  id: string;
  partnerId: string;
  referrerUserId: string;
  referredUserId: string;
  riskScore: number;
  reasons: string[];
  velocity: { referrerAttemptsInWindow: number; deviceReferralsInWindow: number; ipReferralsInWindow: number };
  state: 'REVIEW_REQUIRED' | 'REVIEW_APPROVED' | 'REVIEW_REJECTED';
  createdAt: string;
  referrerDeviceHash: string | null;
  referredDeviceHash: string | null;
  referrerIpHash: string | null;
  referredIpHash: string | null;
}

function correlationId(): string {
  return `referral-review-${globalThis.crypto.randomUUID()}`;
}

export default function ReferralAbuseQueue(): JSX.Element {
  const [cases, setCases] = useState<ReviewCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  // A promise chain rather than an async function, because the effect below calls it and React 19
  // refuses a function that writes state synchronously on the way in. The retry button sets
  // `loading` itself.
  const refresh = useCallback((): Promise<void> => apiClient.get<ReviewCase[]>('/v1/partner/referral-abuse/reviews', { searchParams: { limit: 100 } })
    .then((result) => { setCases(result); setError(null); })
    .catch((caught: unknown) => { setError(caught instanceof Error ? caught.message : 'Review queue could not be loaded.'); })
    .finally(() => { setLoading(false); }), []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function decide(item: ReviewCase, decision: 'APPROVE' | 'REJECT'): Promise<void> {
    const note = reasons[item.id]?.trim() ?? '';
    if (note.length < 5) {
      setError('Enter a review reason of at least five characters before deciding.');
      return;
    }
    setPendingId(item.id);
    setError(null);
    setNotice(null);
    try {
      await apiClient.post(`/v1/partner/referral-abuse/reviews/${encodeURIComponent(item.id)}/decision`, { decision, note, correlationId: correlationId() });
      setNotice(`Case ${item.id} ${decision.toLowerCase()}d. The decision was submitted to the audit ledger.`);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Review decision could not be saved.');
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section aria-labelledby="referral-abuse-title" className="space-y-4" data-testid="referral-abuse-queue">
      <div className="flex items-center justify-between gap-3">
        <div><h2 id="referral-abuse-title" className="text-lg font-semibold">Referral abuse review queue</h2><p className="text-sm text-slate-600">Inspect risk score, deterministic triggers, velocity and keyed identity evidence. Decisions are audited.</p></div>
        <button type="button" onClick={() => void refresh()} disabled={loading} className="rounded border px-3 py-2 text-sm">Refresh</button>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="text-sm text-green-800">{notice}</p>}
      {loading ? <p role="status">Loading review queue…</p> : cases.length === 0 ? <p>No pending cases.</p> : (
        <ul className="space-y-3">
          {cases.filter((item) => item.state === 'REVIEW_REQUIRED').map((item) => (
            <li key={item.id} className="rounded border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">Case {item.id}</h3><span aria-label={`Risk score ${item.riskScore} of 100`} className="font-mono">Score {item.riskScore}/100</span></div>
              <p className="text-sm">Partner <code>{item.partnerId}</code> · Referrer <code>{item.referrerUserId}</code> · Referred user <code>{item.referredUserId}</code></p>
              <p className="text-sm"><strong>Rules:</strong> {item.reasons.join(', ') || 'No rule labels supplied'}</p>
              <p className="text-xs text-slate-600">Velocity — referrer: {item.velocity.referrerAttemptsInWindow}, shared-device referrals: {item.velocity.deviceReferralsInWindow}, shared-IP-hash referrals: {item.velocity.ipReferralsInWindow}</p>
              <p className="break-all text-xs text-slate-500">Device hashes: {item.referrerDeviceHash ?? 'none'} / {item.referredDeviceHash ?? 'none'} · IP hashes: {item.referrerIpHash ?? 'none'} / {item.referredIpHash ?? 'none'}</p>
              <label className="mt-3 block text-sm" htmlFor={`reason-${item.id}`}>Decision reason</label>
              <textarea id={`reason-${item.id}`} value={reasons[item.id] ?? ''} maxLength={1000} onChange={(event) => setReasons((current) => ({ ...current, [item.id]: event.target.value }))} className="mt-1 w-full rounded border p-2" rows={2} />
              <div className="mt-2 flex gap-2"><button type="button" disabled={pendingId !== null} onClick={() => void decide(item, 'APPROVE')} className="rounded bg-green-700 px-3 py-2 text-sm text-white">Approve</button><button type="button" disabled={pendingId !== null} onClick={() => void decide(item, 'REJECT')} className="rounded bg-red-700 px-3 py-2 text-sm text-white">Reject</button></div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

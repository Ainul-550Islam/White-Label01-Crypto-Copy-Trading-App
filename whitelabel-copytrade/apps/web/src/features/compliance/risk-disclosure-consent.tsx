// # Responsibility: implements a Batch 04 commercial interface component or supporting utility.
// # Provides explicit unchecked consent for the current risk disclosure and sends its version and content hash to the API.
'use client';

import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { apiClient } from '@/api/api-client';

type Disclosure = { document: 'RISK_DISCLOSURE'; version: string; content: string; contentHash: string };
export default function RiskDisclosureConsent(): JSX.Element {
  const [disclosure, setDisclosure] = useState<Disclosure | null>(null);
  const [affirmative, setAffirmative] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { let live = true; apiClient.get<Disclosure[]>('/v1/compliance/policies/current').then((items) => { const item = items.find((value) => value.document === 'RISK_DISCLOSURE'); if (live) setDisclosure(item ?? null); }).catch((caught: unknown) => { if (live) setError(caught instanceof Error ? caught.message : 'Risk disclosure unavailable.'); }); return () => { live = false; }; }, []);
  async function submit(): Promise<void> {
    if (!disclosure || !affirmative) return;
    setError(null); setMessage(null);
    try { await apiClient.post('/v1/compliance/policies/accept', disclosure); setMessage(`Risk disclosure ${disclosure.version} accepted.`); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Consent could not be durably recorded.'); }
  }
  return <section aria-labelledby="risk-disclosure-heading" className="rounded border border-amber-300 bg-amber-50 p-4"><h2 id="risk-disclosure-heading" className="font-semibold">Risk disclosure</h2>{disclosure ? <><p className="mt-2 text-sm">{disclosure.content}</p><p className="mt-2 break-all text-xs">Version {disclosure.version} · SHA-256 <code>{disclosure.contentHash}</code></p><label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={affirmative} onChange={(event) => setAffirmative(event.target.checked)} />I understand that copy trading can lose value, including the full amount allocated, and that historical results do not guarantee future outcomes.</label><button type="button" disabled={!affirmative} onClick={() => void submit()} className="mt-3 rounded bg-amber-800 px-3 py-2 text-white disabled:opacity-50">Accept risk disclosure</button></> : <p role="status">Loading current risk disclosure…</p>}{error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}</section>;
}

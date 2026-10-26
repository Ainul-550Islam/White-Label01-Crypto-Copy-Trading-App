// # Responsibility: renders the Batch 04 commercial user interface for its route.
// # Presents current policy text and requires deliberate reading and unchecked affirmative action before acceptance.
'use client';

import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { apiClient } from '@/api/api-client';

type Policy = { document: 'TERMS' | 'RISK_DISCLOSURE' | 'PRIVACY'; version: string; content: string; contentHash: string };
export default function PolicyAcceptancePage(): JSX.Element {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [read, setRead] = useState<Record<string, boolean>>({});
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => { let live = true; apiClient.get<Policy[]>('/v1/compliance/policies/current').then((items) => { if (live) setPolicies(items); }).catch((caught: unknown) => { if (live) setError(caught instanceof Error ? caught.message : 'Current policies could not be loaded.'); }); return () => { live = false; }; }, []);
  async function accept(policy: Policy): Promise<void> {
    if (!read[policy.document] || !accepted[policy.document]) { setError('Read the document and actively check its acceptance box first.'); return; }
    setError(null); setStatus(null);
    try { await apiClient.post('/v1/compliance/policies/accept', { document: policy.document, version: policy.version, contentHash: policy.contentHash }); setStatus(`${policy.document} version ${policy.version} accepted.`); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Acceptance was not recorded.'); }
  }
  return <main id="main-content" className="mx-auto max-w-3xl space-y-5"><header><h1 className="text-2xl font-bold">Required policies</h1><p className="text-sm text-slate-600">Acceptance is recorded for the exact document version and SHA-256 content hash. A later version requires new acceptance.</p></header>
    {error && <p role="alert" className="text-red-700">{error}</p>}{status && <p role="status">{status}</p>}
    {policies.map((policy) => <section key={policy.document} className="space-y-3 rounded border bg-white p-4"><h2 className="text-lg font-semibold">{policy.document.replaceAll('_', ' ')}</h2><p className="text-sm">Version {policy.version}</p><pre className="whitespace-pre-wrap rounded bg-slate-50 p-3 text-sm">{policy.content}</pre><p className="break-all text-xs text-slate-500">Content SHA-256: <code>{policy.contentHash}</code></p><button type="button" onClick={() => setRead((current) => ({ ...current, [policy.document]: true }))} className="rounded border px-3 py-2">I have read this document</button><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={accepted[policy.document] ?? false} onChange={(event) => setAccepted((current) => ({ ...current, [policy.document]: event.target.checked }))} />I explicitly accept this version.</label><button type="button" disabled={!read[policy.document] || !accepted[policy.document]} onClick={() => void accept(policy)} className="rounded bg-blue-700 px-3 py-2 text-white disabled:opacity-50">Accept current version</button></section>)}
  </main>;
}

// # Responsibility: renders the Batch 04 commercial user interface for its route.
// # Lets an authenticated user request access/export or deletion, inspect the request timeline, and download a verified export manifest.
'use client';

import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/api/api-client';

interface PrivacyRequest { id: string; requestType: string; state: string; jurisdiction: string; requestedAt: string; updatedAt: string; blockedReason: string | null; legalHoldBlock: boolean; retentionBlock: boolean; }
interface PrivacyExport { id: string; requestId: string; exportVersion: string; fileHash: string | null; dataCategories: string[]; recordCount: number; sourceReferences: string[]; generatedAt: string; dataAsOf: string; methodology: string; }

function randomKey(prefix: string): string { return `${prefix}-${crypto.randomUUID()}`; }

export default function DataExportPage(): JSX.Element {
  const [requests, setRequests] = useState<PrivacyRequest[]>([]);
  const [jurisdiction, setJurisdiction] = useState('BD');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [exportResult, setExportResult] = useState<PrivacyExport | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try { setRequests(await apiClient.get<PrivacyRequest[]>('/v1/privacy/requests')); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Privacy requests could not be loaded.'); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function createRequest(requestType: 'ACCESS' | 'EXPORT' | 'DELETION'): Promise<void> {
    setBusy(true); setError(null); setNotice(null); setExportResult(null);
    try {
      const payload = { requestType, jurisdiction, reason: reason.trim() || undefined, idempotencyKey: randomKey('privacy-request'), correlationId: randomKey('privacy-correlation') };
      const request = requestType === 'DELETION'
        ? await apiClient.post<PrivacyRequest>('/v1/privacy/requests/deletion', payload)
        : await apiClient.post<PrivacyRequest>('/v1/privacy/requests', payload);
      setNotice(`${requestType} request ${request.id} entered state ${request.state}.`);
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Your request could not be submitted.'); }
    finally { setBusy(false); }
  }

  async function generateExport(request: PrivacyRequest): Promise<void> {
    setBusy(true); setError(null); setNotice(null); setExportResult(null);
    try {
      const result = await apiClient.post<PrivacyExport>(`/v1/privacy/requests/${encodeURIComponent(request.id)}/export`, { correlationId: randomKey('privacy-export') });
      setExportResult(result); setNotice(`Export manifest prepared for ${result.recordCount} discovered records. Verify its SHA-256 before retaining it.`);
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Export preparation failed.'); }
    finally { setBusy(false); }
  }

  async function downloadManifest(): Promise<void> {
    if (!exportResult) return;
    setBusy(true); setError(null);
    try {
      const issued = await apiClient.post<{ token: string; expiresAt: string }>(`/v1/privacy/requests/${encodeURIComponent(exportResult.requestId)}/download-token`, {});
      const manifest = await apiClient.get<PrivacyExport>(`/v1/privacy/requests/download/${encodeURIComponent(issued.token)}`);
      const content = JSON.stringify({ format: 'privacy-export-manifest-v1', ...manifest }, null, 2);
      const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `privacy-export-${manifest.id}-manifest.json`; anchor.click(); URL.revokeObjectURL(url);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'One-time export download failed.'); }
    finally { setBusy(false); }
  }

  return <div className="mx-auto max-w-4xl space-y-5" data-testid="data-export-page">
    <header><h1 className="text-2xl font-bold">Your data access and privacy requests</h1><p className="text-sm text-slate-600">Requests are scoped to your authenticated account and organisation. Export inventory covers profile, security, exchange, trading, accounting, audit, and compliance data subject to legal retention and active holds.</p></header>
    <section className="space-y-3 rounded border bg-white p-4"><h2 className="font-semibold">Create a request</h2><div><label htmlFor="privacy-jurisdiction" className="block text-sm">Jurisdiction</label><input id="privacy-jurisdiction" value={jurisdiction} maxLength={16} onChange={(event) => setJurisdiction(event.target.value.toUpperCase())} className="mt-1 rounded border p-2" /></div><div><label htmlFor="privacy-reason" className="block text-sm">Optional reason</label><textarea id="privacy-reason" value={reason} maxLength={2000} onChange={(event) => setReason(event.target.value)} className="mt-1 w-full rounded border p-2" rows={2} /></div><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void createRequest('ACCESS')} className="rounded border px-3 py-2">Request access</button><button type="button" disabled={busy} onClick={() => void createRequest('EXPORT')} className="rounded bg-blue-700 px-3 py-2 text-white">Request export</button><button type="button" disabled={busy} onClick={() => void createRequest('DELETION')} className="rounded border border-red-300 px-3 py-2 text-red-800">Request deletion (step-up required)</button></div></section>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}{notice && <p role="status" className="text-sm text-green-800">{notice}</p>}
    {exportResult && <section className="space-y-2 rounded border border-green-300 bg-green-50 p-4"><h2 className="font-semibold">Export manifest</h2><p>Version {exportResult.exportVersion} · {exportResult.recordCount} records · generated {new Date(exportResult.generatedAt).toISOString()}</p><p className="break-all text-xs">SHA-256 <code>{exportResult.fileHash ?? 'unavailable'}</code></p><p className="text-sm">Included classes: {exportResult.dataCategories.join(', ') || 'none'}</p><p className="text-xs">{exportResult.methodology}</p><button type="button" onClick={downloadManifest} className="rounded border px-3 py-2">Download export manifest</button></section>}
    <section className="space-y-3"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Request timeline</h2><button type="button" onClick={() => void refresh()} disabled={busy} className="rounded border px-3 py-2">Refresh</button></div>{requests.length === 0 ? <p className="text-sm text-slate-600">No privacy requests have been submitted.</p> : <ol className="space-y-3">{requests.map((request) => <li key={request.id} className="rounded border bg-white p-4"><div className="flex flex-wrap justify-between gap-2"><strong>{request.requestType}</strong><span className="rounded bg-slate-100 px-2 py-1 text-xs">{request.state}</span></div><p className="text-xs text-slate-600">Requested {new Date(request.requestedAt).toLocaleString()} · updated {new Date(request.updatedAt).toLocaleString()}</p>{request.retentionBlock && <p className="text-sm text-amber-800">Blocked by statutory retention.</p>}{request.legalHoldBlock && <p className="text-sm text-amber-800">Blocked by active legal hold.</p>}{request.blockedReason && <p className="text-sm">Reason: {request.blockedReason}</p>}{(request.requestType === 'ACCESS' || request.requestType === 'EXPORT') && <button type="button" disabled={busy} onClick={() => void generateExport(request)} className="mt-2 rounded border px-3 py-2">Generate export when ready</button>}</li>)}</ol>}</section>
  </div>;
}

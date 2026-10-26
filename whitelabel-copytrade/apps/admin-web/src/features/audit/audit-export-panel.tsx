// # Responsibility: implements a Batch 04 commercial interface component or supporting utility.
// # Builds filtered tenant audit exports, downloads the manifest-bearing archive, and verifies its digest and hash chain in-browser.
'use client';

import type { FormEvent, JSX } from 'react';
import { useState } from 'react';
import { businessAdminApi, type AuditExportFilters, type AuditExportResult } from '@/api/business-admin-api';

interface ExportFilters { actorId: string; actionType: string; entityType: string; entityId: string; outcome: string; }
const blankFilters: ExportFilters = { actorId: '', actionType: '', entityType: '', entityId: '', outcome: '' };
const ENTITY_TYPES = ['', 'REQUEST', 'REPORT', 'EVIDENCE_PACKAGE', 'LEGAL_HOLD', 'RETENTION_CANDIDATE', 'CONSENT'];

function toHex(buffer: ArrayBuffer): string { return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join(''); }
async function sha256(text: string): Promise<string> { return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))); }

export default function AuditExportPanel(): JSX.Element {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(tomorrow);
  const [filters, setFilters] = useState(blankFilters);
  const [result, setResult] = useState<AuditExportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); setBusy(true); setMessage(null); setError(null); setResult(null);
    try {
      const [tenant, actor] = await Promise.all([businessAdminApi.currentTenant(), businessAdminApi.currentActor()]);
      const tenantId = tenant.id;
      const actorId = actor.id ?? actor.userId;
      if (!tenantId || !actorId) throw new Error('Authenticated tenant or operator identity is unavailable.');
      const exportFilters: AuditExportFilters = {};
      if (filters.actorId.trim()) exportFilters.actorId = filters.actorId.trim();
      if (filters.actionType.trim()) exportFilters.actionType = filters.actionType.trim();
      if (filters.entityType) exportFilters.entityType = filters.entityType as NonNullable<AuditExportFilters['entityType']>;
      if (filters.entityId.trim()) exportFilters.entityId = filters.entityId.trim();
      if (filters.outcome.trim()) exportFilters.outcome = filters.outcome.trim();
      const submitted = await businessAdminApi.createAuditExport({
        tenantId, operatorId: actorId, correlationId: `audit-export-${crypto.randomUUID()}`,
        periodStart: new Date(`${startDate}T00:00:00.000Z`).toISOString(),
        periodEnd: new Date(`${endDate}T00:00:00.000Z`).toISOString(),
        filters: exportFilters,
      });
      let exported: AuditExportResult;
      if (!('fileContents' in submitted)) {
        setMessage(`Large export queued as ${submitted.id}; waiting for completion…`);
        let completed: AuditExportResult | undefined;
        for (let attempt = 0; attempt < 120; attempt += 1) {
          await new Promise<void>((resolve) => setTimeout(resolve, 1_500));
          const state = await businessAdminApi.getAuditExportJob(submitted.id);
          if (state.state === 'completed') { completed = state.result; break; }
          if (state.state === 'failed') throw new Error(state.failureReason ?? 'Audit export job failed.');
        }
        if (!completed) throw new Error(`Audit export job ${submitted.id} is still processing. The job remains available to check again.`);
        exported = completed;
      } else {
        exported = submitted;
      }
      setResult(exported); setMessage(`Export ready: ${exported.recordCount} rows. Verify the manifest before relying on the downloaded file.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Audit export failed.'); }
    finally { setBusy(false); }
  }

  async function verify(): Promise<void> {
    if (!result) return;
    setBusy(true); setMessage(null); setError(null);
    try {
      const parsed = JSON.parse(result.fileContents) as { manifest: AuditExportResult['manifest']; rows: Array<Record<string, unknown> & { previousHash: string; rowHash: string }> };
      let previousHash = '0'.repeat(64);
      for (const row of parsed.rows) {
        if (row.previousHash !== previousHash) throw new Error(`Hash-chain link is invalid at row ${String(row.id)}.`);
        const { previousHash: _previousHash, rowHash, ...base } = row;
        const calculated = await sha256(`${previousHash}\n${JSON.stringify(base)}`);
        if (calculated !== rowHash) throw new Error(`Hash-chain row digest is invalid at row ${String(row.id)}.`);
        previousHash = rowHash;
      }
      const content = JSON.stringify({ tenantId: parsed.manifest.tenantId, periodStart: parsed.manifest.periodStart, periodEndExclusive: parsed.manifest.periodEndExclusive, filters: parsed.manifest.filters, rows: parsed.rows });
      const digest = await sha256(content);
      if (digest !== parsed.manifest.sha256 || digest !== result.fileHash) throw new Error('Export SHA-256 digest does not match; the file may have been modified.');
      if (previousHash !== parsed.manifest.chainTip) throw new Error('Manifest chain tip does not match the row chain.');
      setMessage(`Integrity verified: ${parsed.rows.length} rows; SHA-256 and chained row hashes match.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Integrity verification failed.'); }
    finally { setBusy(false); }
  }

  function download(): void {
    if (!result) return;
    const blob = new Blob([result.fileContents], { type: 'application/json;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = href; link.download = `audit-export-${result.id}.json`; link.click(); URL.revokeObjectURL(href);
  }

  function setFilter(key: keyof ExportFilters, value: string): void { setFilters((current) => ({ ...current, [key]: value })); }

  return <section aria-labelledby="audit-export-heading" className="space-y-4 rounded-lg border border-slate-200 bg-white p-4" data-testid="audit-export-panel">
    <div><h2 id="audit-export-heading" className="text-lg font-semibold">Audit export</h2><p className="text-sm text-slate-600">Filter by actor, action, entity and outcome. Exported actor identifiers are one-way hashed; tenant scope comes from the authenticated session.</p></div>
    <form onSubmit={(event) => void submit(event)} className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <div><label htmlFor="audit-from" className="block text-sm">Start date (UTC)</label><input id="audit-from" type="date" required value={startDate} onChange={(event) => setStartDate(event.target.value)} className="w-full rounded border p-2" /></div>
      <div><label htmlFor="audit-to" className="block text-sm">End date (exclusive, UTC)</label><input id="audit-to" type="date" required value={endDate} onChange={(event) => setEndDate(event.target.value)} className="w-full rounded border p-2" /></div>
      <div><label htmlFor="audit-actor" className="block text-sm">Actor user ID</label><input id="audit-actor" value={filters.actorId} onChange={(event) => setFilter('actorId', event.target.value)} className="w-full rounded border p-2" /></div>
      <div><label htmlFor="audit-action" className="block text-sm">Action type</label><input id="audit-action" value={filters.actionType} onChange={(event) => setFilter('actionType', event.target.value)} className="w-full rounded border p-2" /></div>
      <div><label htmlFor="audit-entity-type" className="block text-sm">Entity type</label><select id="audit-entity-type" value={filters.entityType} onChange={(event) => setFilter('entityType', event.target.value)} className="w-full rounded border p-2">{ENTITY_TYPES.map((kind) => <option key={kind} value={kind}>{kind || 'Any entity'}</option>)}</select></div>
      <div><label htmlFor="audit-entity-id" className="block text-sm">Entity ID</label><input id="audit-entity-id" value={filters.entityId} onChange={(event) => setFilter('entityId', event.target.value)} className="w-full rounded border p-2" /></div>
      <div><label htmlFor="audit-outcome" className="block text-sm">Outcome</label><input id="audit-outcome" value={filters.outcome} onChange={(event) => setFilter('outcome', event.target.value)} className="w-full rounded border p-2" /></div>
      <div className="flex items-end"><button type="submit" disabled={busy || startDate >= endDate} className="rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-50">{busy ? 'Preparing…' : 'Generate export'}</button></div>
    </form>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}{message && <p role="status" className="text-sm text-green-800">{message}</p>}
    {result && <div className="space-y-2 rounded bg-slate-50 p-3"><p className="text-sm">Rows: {result.manifest.rowCount} · SHA-256: <code className="break-all">{result.manifest.sha256}</code></p><p className="break-all text-xs">Chain tip: <code>{result.manifest.chainTip}</code></p><div className="flex gap-2"><button type="button" disabled={busy} onClick={() => void verify()} className="rounded border px-3 py-2">Verify integrity</button><button type="button" onClick={download} className="rounded border px-3 py-2">Download export + manifest</button></div></div>}
  </section>;
}

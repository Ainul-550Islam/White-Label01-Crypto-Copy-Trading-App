// # Responsibility: implements a Batch 04 commercial interface component or supporting utility.
// # Displays tenant retention policy, legal holds, candidate dry-runs, and auditable retention-run history.
'use client';

import type { FormEvent, JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';

interface Tenant { id: string; }
interface Actor { id: string; userId?: string; }
interface RetentionPolicy { id: string; dataClass: string; jurisdiction: string; retentionPeriodDays: number; retentionStartEvent: string; eligibleAction: string; policyVersion: string; legalHoldOverride: boolean; requiresApproval: boolean; }
interface RetentionCandidate { id: string; dataClass: string; sourceSystem: string; sourceId: string; state: string; retentionEndAt: string; eligibleAction: string; blockedByLegalHold: boolean; }
interface LegalHold { id: string; state: string; caseReference: string; reason: string; affectedDataClasses: string[]; createdAt: string; }
const jurisdictions = ['BD', 'US', 'GB', 'EU'];

export default function DataRetentionConsole(): JSX.Element {
  const [tenantId, setTenantId] = useState('');
  const [actorId, setActorId] = useState('');
  const [jurisdiction, setJurisdiction] = useState('BD');
  const [policies, setPolicies] = useState<RetentionPolicy[]>([]);
  const [candidates, setCandidates] = useState<RetentionCandidate[]>([]);
  const [holds, setHolds] = useState<LegalHold[]>([]);
  const [preview, setPreview] = useState<RetentionCandidate | null>(null);
  const [dataClass, setDataClass] = useState('');
  const [sourceSystem, setSourceSystem] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [retentionStartAt, setRetentionStartAt] = useState('');
  const [caseReference, setCaseReference] = useState('');
  const [holdReason, setHoldReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async (tenant: string, jurisdictionValue: string) => {
    const [policyRows, candidateRows, holdRows] = await Promise.all([
      apiClient.get<RetentionPolicy[]>('/v1/governance/retention/policies', { searchParams: { tenantId: tenant, jurisdiction: jurisdictionValue } }),
      apiClient.get<RetentionCandidate[]>('/v1/governance/retention/candidates', { searchParams: { tenantId: tenant } }),
      apiClient.get<LegalHold[]>('/v1/governance/legal-holds', { searchParams: { tenantId: tenant } }),
    ]);
    setPolicies(policyRows); setCandidates(candidateRows); setHolds(holdRows);
    setDataClass((current) => policyRows.some((item) => item.dataClass === current) ? current : policyRows[0]?.dataClass ?? '');
  }, []);

  useEffect(() => {
    let live = true;
    Promise.all([apiClient.get<Tenant>('/v1/tenants/current'), apiClient.get<Actor>('/v1/users/me')]).then(async ([tenant, actor]) => {
      const id = tenant.id; const operator = actor.id ?? actor.userId ?? '';
      if (!id || !operator) throw new Error('Tenant or authenticated reviewer identity is unavailable.');
      if (live) { setTenantId(id); setActorId(operator); await refresh(id, jurisdiction); }
    }).catch((caught: unknown) => { if (live) setError(caught instanceof Error ? caught.message : 'Retention console could not be loaded.'); });
    return () => { live = false; };
  }, [refresh, jurisdiction]);

  async function runPreview(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); setBusy(true); setError(null); setNotice(null); setPreview(null);
    try {
      const candidate = await apiClient.post<RetentionCandidate>('/v1/governance/retention/evaluate', { tenantId, operatorId: actorId, dataClass, sourceSystem, sourceId, jurisdiction, retentionStartAt: new Date(`${retentionStartAt}T00:00:00.000Z`).toISOString(), correlationId: `retention-preview-${crypto.randomUUID()}` });
      setPreview(candidate); setNotice('Dry-run evaluated by the canonical retention engine. No delete or anonymize operation was executed.');
      await refresh(tenantId, jurisdiction);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Retention preview failed.'); }
    finally { setBusy(false); }
  }

  async function createAndActivateHold(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); setBusy(true); setError(null); setNotice(null);
    try {
      const classes = policies.filter((item) => item.jurisdiction === jurisdiction).map((item) => item.dataClass);
      if (classes.length === 0) throw new Error('No policy data classes are loaded for this jurisdiction.');
      const draft = await apiClient.post<LegalHold>('/v1/governance/legal-holds', { tenantId, caseReference, reason: holdReason, affectedDataClasses: classes, affectedJurisdictions: [jurisdiction], affectedSubjects: [], createdBy: actorId, correlationId: `legal-hold-${crypto.randomUUID()}` });
      await apiClient.post(`/v1/governance/legal-holds/${encodeURIComponent(draft.id)}/activate`, { tenantId, activatedBy: actorId, correlationId: `legal-hold-activate-${crypto.randomUUID()}` });
      setCaseReference(''); setHoldReason(''); setNotice(`Legal hold ${draft.id} activated; retention deletion is blocked for its scope.`);
      await refresh(tenantId, jurisdiction);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Legal hold could not be activated.'); }
    finally { setBusy(false); }
  }

  async function releaseHold(hold: LegalHold): Promise<void> {
    const reason = window.prompt('Provide the reviewer reason for releasing this legal hold:')?.trim() ?? '';
    if (reason.length < 10) { setError('A release reason of at least ten characters is required.'); return; }
    setBusy(true); setError(null); setNotice(null);
    try { await apiClient.post(`/v1/governance/legal-holds/${encodeURIComponent(hold.id)}/release`, { tenantId, releasedBy: actorId, correlationId: `legal-hold-release-${crypto.randomUUID()}`, reason }); setNotice(`Legal hold ${hold.id} release requested and audited.`); await refresh(tenantId, jurisdiction); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Hold release failed.'); }
    finally { setBusy(false); }
  }

  return <section className="space-y-5" data-testid="data-retention-console"><header><h1 className="text-2xl font-bold">Data retention and privacy controls</h1><p className="text-sm text-slate-600">Policy periods come from the jurisdiction policy engine; the console does not permit weakening statutory retention. Dry-run previews never execute deletion.</p></header>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}{notice && <p role="status" className="text-sm text-green-800">{notice}</p>}
    <div className="flex items-center gap-2"><label htmlFor="retention-jurisdiction">Jurisdiction</label><select id="retention-jurisdiction" value={jurisdiction} onChange={(event) => { setJurisdiction(event.target.value); void refresh(tenantId, event.target.value).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Could not reload jurisdiction policy.')); }} className="rounded border p-2">{jurisdictions.map((code) => <option key={code}>{code}</option>)}</select></div>
    <section className="space-y-2 rounded border bg-white p-4"><h2 className="font-semibold">Retention policy by data class</h2><div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr><th className="p-2">Data class</th><th className="p-2">Policy version</th><th className="p-2">Retention days</th><th className="p-2">After period</th><th className="p-2">Legal-hold override</th><th className="p-2">Approval</th></tr></thead><tbody>{policies.map((policy) => <tr key={policy.id} className="border-t"><td className="p-2">{policy.dataClass}</td><td className="p-2">{policy.policyVersion}</td><td className="p-2">{policy.retentionPeriodDays}</td><td className="p-2">{policy.eligibleAction}</td><td className="p-2">{policy.legalHoldOverride ? 'Yes — deletion blocked' : 'No'}</td><td className="p-2">{policy.requiresApproval ? 'Reviewer required' : 'Policy-defined'}</td></tr>)}</tbody></table></div></section>
    <form onSubmit={(event) => void runPreview(event)} className="space-y-3 rounded border bg-white p-4"><h2 className="font-semibold">Dry-run preview for a data record</h2><div className="grid gap-3 md:grid-cols-2"><div><label htmlFor="retention-class" className="block text-sm">Data class</label><select id="retention-class" value={dataClass} onChange={(event) => setDataClass(event.target.value)} className="w-full rounded border p-2">{policies.map((policy) => <option key={policy.id} value={policy.dataClass}>{policy.dataClass}</option>)}</select></div><div><label htmlFor="retention-start" className="block text-sm">Retention start date</label><input id="retention-start" type="date" required value={retentionStartAt} onChange={(event) => setRetentionStartAt(event.target.value)} className="w-full rounded border p-2" /></div><div><label htmlFor="retention-source" className="block text-sm">Source system</label><input id="retention-source" required value={sourceSystem} onChange={(event) => setSourceSystem(event.target.value)} className="w-full rounded border p-2" /></div><div><label htmlFor="retention-source-id" className="block text-sm">Source record ID</label><input id="retention-source-id" required value={sourceId} onChange={(event) => setSourceId(event.target.value)} className="w-full rounded border p-2" /></div></div><button type="submit" disabled={busy || !tenantId || !dataClass} className="rounded bg-blue-700 px-3 py-2 text-white">Preview only</button>{preview && <pre className="overflow-x-auto rounded bg-slate-50 p-3 text-xs">{JSON.stringify(preview, null, 2)}</pre>}</form>
    <form onSubmit={(event) => void createAndActivateHold(event)} className="space-y-3 rounded border bg-white p-4"><h2 className="font-semibold">Create and activate legal hold</h2><div><label htmlFor="hold-case" className="block text-sm">Case reference</label><input id="hold-case" required minLength={3} value={caseReference} onChange={(event) => setCaseReference(event.target.value)} className="w-full rounded border p-2" /></div><div><label htmlFor="hold-reason" className="block text-sm">Reason</label><textarea id="hold-reason" required minLength={10} value={holdReason} onChange={(event) => setHoldReason(event.target.value)} className="w-full rounded border p-2" /></div><button type="submit" disabled={busy || !tenantId} className="rounded bg-amber-800 px-3 py-2 text-white">Activate legal hold</button></form>
    <section className="space-y-2"><h2 className="text-lg font-semibold">Legal hold and retention run history</h2><ul className="space-y-2">{holds.map((hold) => <li key={hold.id} className="rounded border bg-white p-3"><strong>{hold.caseReference}</strong> · {hold.state}<p className="text-sm">{hold.reason} · Data: {hold.affectedDataClasses.join(', ')}</p>{hold.state === 'ACTIVE' && <button type="button" disabled={busy} onClick={() => void releaseHold(hold)} className="rounded border px-3 py-1">Release with reviewer reason</button>}</li>)}</ul><div className="rounded border bg-white p-3"><h3 className="font-medium">Retention candidates</h3>{candidates.length === 0 ? <p className="text-sm text-slate-600">No candidate history returned.</p> : <ul>{candidates.map((candidate) => <li key={candidate.id} className="border-t py-2 text-sm">{candidate.dataClass} · {candidate.sourceSystem}/{candidate.sourceId} · {candidate.state} · {candidate.blockedByLegalHold ? 'BLOCKED BY LEGAL HOLD' : candidate.eligibleAction}</li>)}</ul>}</div></section>
  </section>;
}

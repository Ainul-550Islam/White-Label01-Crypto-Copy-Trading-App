'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent, type JSX } from 'react';
import { developerPlatformApi, type Credential, type IssuedCredential, type StepUpMethod } from '@/api/developer-platform-api';
import { useDeveloperI18n } from './i18n';
import { SecretReveal } from './secret-reveal';
import { StepUpDialog } from './step-up-dialog';
import { confirmIssuedCredential } from './mutation-response';
import { ApplicationPageControls, useApplicationPages } from './application-pages';

const PAGE_SIZE = 10;
type Pending = { kind: 'create'; applicationId: string; label: string; expiresInDays?: number; key: string; identity: string }
  | { kind: 'rotate' | 'revoke'; credential: Credential; key: string; identity: string };
export function credentialStatus(row: Credential, now = Date.now()): 'revoked' | 'expired' | 'active' | 'unknown' {
  if (row.revokedAt) return 'revoked';
  if (row.expiresAt) {
    const expires = Date.parse(row.expiresAt);
    if (!Number.isFinite(expires)) return 'unknown';
    if (expires <= now) return 'expired';
  }
  return 'active';
}

export function ApiKeyTable({ canManage }: { canManage: boolean }): JSX.Element {
  const { t } = useDeveloperI18n();
  const requestNumber = useRef(0);
  const applications = useApplicationPages(canManage);
  const [keys, setKeys] = useState<Credential[]>([]);
  const [applicationId, setApplicationId] = useState('');
  const [label, setLabel] = useState('');
  const [days, setDays] = useState('');
  const [secret, setSecret] = useState<IssuedCredential | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const intentKeys = useRef(new Map<string, string>());
  function intentKey(identity: string): string {
    const key = intentKeys.current.get(identity) ?? crypto.randomUUID();
    intentKeys.current.set(identity, key);
    return key;
  }
  const [verificationError, setVerificationError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const cursor = cursors[cursors.length - 1];
  const load = useCallback(async () => {
    const request = ++requestNumber.current;
    setLoading(true);
    try {
      const credentials = await developerPlatformApi.listCredentials({ kind: 'API_KEY', limit: PAGE_SIZE, cursor });
      if (request !== requestNumber.current) return;
      setKeys(credentials.rows.filter((credential) => credential.kind === 'API_KEY'));
      setNextCursor(credentials.nextCursor ?? null); setError('');
    } catch { if (request === requestNumber.current) setError(t.failed); }
    finally { if (request === requestNumber.current) setLoading(false); }
  }, [t.failed, cursor]);
  useEffect(() => { void load(); return () => { requestNumber.current += 1; }; }, [load]);
  useEffect(() => {
    if (applications.loading || applications.error) return;
    const eligible = applications.rows.filter((app) => app.state !== 'REVOKED');
    setApplicationId((current) => eligible.some((app) => app.id === current) ? current : (eligible[0]?.id ?? ''));
  }, [applications.rows, applications.loading, applications.error]);
  function prepareCreate(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (secret || busy || !applications.rows.some((app) => app.id === applicationId && app.state !== 'REVOKED') || label.trim().length < 3) return;
    const expiry = days ? Number(days) : undefined;
    if (expiry !== undefined && (!Number.isInteger(expiry) || expiry < 1 || expiry > 3650)) return;
    setVerificationError('');
    const identity = JSON.stringify(['create', applicationId, label.trim(), expiry ?? null]);
    setPending({ kind: 'create', applicationId, label: label.trim(), ...(expiry === undefined ? {} : { expiresInDays: expiry }), identity, key: intentKey(identity) });
  }
  async function verify(method: StepUpMethod, value: string): Promise<void> {
    if (!pending || busy) return;
    setBusy(true); setVerificationError(''); setError(''); setNotice('');
    try {
      await developerPlatformApi.verifyStepUp(pending.kind === 'revoke' ? 'API_KEY_REVOKE' : 'API_KEY_CREATE', method, value, crypto.randomUUID());
    } catch { setVerificationError(t.verificationFailed); setBusy(false); return; }
    const intent = pending;
    setPending(null);
    try {
      if (intent.kind === 'create') {
        const issued = await developerPlatformApi.createCredential(intent.applicationId, { label: intent.label, ...(intent.expiresInDays === undefined ? {} : { expiresInDays: intent.expiresInDays }) }, intent.key);
        confirmIssuedCredential(issued);
        setSecret(issued); setLabel(''); setDays('');
      } else if (intent.kind === 'rotate') {
        const issued = await developerPlatformApi.rotateCredential(intent.credential.applicationId, intent.credential.keyId, undefined, intent.key);
        confirmIssuedCredential(issued, intent.credential.keyId);
        setSecret(issued);
      } else {
        await developerPlatformApi.revokeCredential(intent.credential.applicationId, intent.credential.keyId, undefined, intent.key);
        setNotice(t.keyRevoked);
      }
      intentKeys.current.delete(intent.identity);
      await load();
    } catch { setError(t.uncertain); }
    finally { setBusy(false); }
  }
  const shown = keys;
  return <section className="dev-stack" aria-labelledby="api-keys-title">
    <h1 id="api-keys-title">{t.keys}</h1>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {pending && <StepUpDialog description={pending.kind === 'revoke' ? t.confirmRevoke : pending.kind === 'rotate' ? t.confirmRotate : t.createKey} busy={busy} error={verificationError} onCancel={() => setPending(null)} onVerify={verify} />}
    {secret && <SecretReveal secret={secret.secret} keyId={secret.keyId} onClose={() => { setSecret(null); setNotice(t.secretClosed); }} />}
    {canManage && !secret && <form onSubmit={prepareCreate} className="dev-card dev-form">
      <h2>{t.createKey}</h2>
      <label>{t.application}<select required value={applicationId} onChange={(event) => setApplicationId(event.target.value)}>
        <option value="">{t.chooseApplication}</option>{applications.rows.filter((app) => app.state !== 'REVOKED').map((app) => <option key={app.id} value={app.id}>{app.name} · {app.environment}</option>)}
      </select></label>
      <label>{t.label}<input required minLength={3} maxLength={120} value={label} onChange={(event) => setLabel(event.target.value)} /></label>
      <label>{t.expiresIn}<input type="number" min={1} max={3650} step={1} value={days} onChange={(event) => setDays(event.target.value)} /></label>
      <ApplicationPageControls pages={applications} disabled={busy} />
      {applications.error && <div role="alert">{t.failed} <button type="button" className="dev-button" onClick={applications.retry}>{t.retry}</button></div>}
      <p className="dev-muted">{t.scopeNotice}</p>{!applications.rows.some((app) => app.state !== 'REVOKED') && !applications.loading && !applications.error && <p>{t.noEligibleOnPage}</p>}
      <button className="dev-button" type="submit" disabled={busy || loading || applications.loading || applications.error || !applicationId}>{busy ? t.saving : t.create}</button>
    </form>}
    {!canManage && <p className="dev-muted">{t.manageNeeded}</p>}
    {loading ? <p role="status">{t.loading}</p> : <div className="dev-card">
      {keys.length === 0 && !error ? <p>{t.noKeys}</p> : <div className="dev-table-wrap"><table className="dev-table">
        <thead><tr><th scope="col">{t.label}</th><th scope="col">{t.keyId}</th><th scope="col">{t.status}</th><th scope="col">{t.scopes}</th><th scope="col">{t.expires}</th>{canManage && <th scope="col">{t.rotate} / {t.revoke}</th>}</tr></thead>
        <tbody>{shown.map((key) => {
          const status = credentialStatus(key);
          return <tr key={key.id}><td>{key.label}</td><td><code>{key.keyId}</code></td><td>{status === 'unknown' ? '—' : t[status]}</td><td>{key.scopes.join(', ')}</td><td>{key.expiresAt ?? t.never}</td>
            {canManage && <td>{!key.revokedAt && <div className="dev-actions">
              <button type="button" className="dev-button" disabled={busy || Boolean(secret)} onClick={() => { setVerificationError(''); setPending({ kind: 'rotate', credential: key, identity: `rotate:${key.keyId}`, key: intentKey(`rotate:${key.keyId}`) }); }}>{t.rotate}</button>
              <button type="button" className="dev-button" disabled={busy || Boolean(secret)} onClick={() => { setVerificationError(''); setPending({ kind: 'revoke', credential: key, identity: `revoke:${key.keyId}`, key: intentKey(`revoke:${key.keyId}`) }); }}>{t.revoke}</button>
            </div>}</td>}</tr>;
        })}</tbody>
      </table></div>}
      {(cursors.length > 1 || nextCursor) && <div className="dev-actions">
        <button type="button" className="dev-button" disabled={busy || cursors.length <= 1} onClick={() => setCursors((value) => value.slice(0, -1))}>{t.previous}</button>
        <span aria-live="polite">{cursors.length}</span>
        <button type="button" className="dev-button" disabled={busy || !nextCursor} onClick={() => { if (nextCursor) setCursors((value) => [...value, nextCursor]); }}>{t.next}</button>
      </div>}
    </div>}
  </section>;
}

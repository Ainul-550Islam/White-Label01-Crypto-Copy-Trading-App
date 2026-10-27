'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent, type JSX } from 'react';
import {
  developerPlatformApi, type ApplicationInput, type DeveloperApplication, type DeveloperEnvironment,
  type DeveloperStepUpAction, type ScopeDefinition, type StepUpMethod,
} from '@/api/developer-platform-api';
import { localizedState, useDeveloperI18n } from './i18n';
import { StepUpDialog } from './step-up-dialog';
import { confirmApplicationCreate, confirmApplicationScopes, confirmApplicationUpdate, confirmState } from './mutation-response';

const PAGE_SIZE = 10;
const REDIRECT = /^https:\/\/[A-Za-z0-9.\-_:]+[A-Za-z0-9/\-._~%]*$|^http:\/\/localhost(:\d+)?[A-Za-z0-9/\-._~%]*$/;
export function validApplicationRedirects(uris: string[], environment: DeveloperEnvironment): boolean {
  return uris.length >= 1 && uris.length <= 16 && uris.every((uri) => {
    if (uri.length > 512 || !REDIRECT.test(uri) || (environment === 'PRODUCTION' && !uri.startsWith('https://'))) return false;
    try {
      const url = new URL(uri);
      return Boolean(url.hostname) && !url.username && !url.password && !url.search && !url.hash &&
        (url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost'));
    } catch { return false; }
  });
}

type LifecycleAction = 'activate' | 'suspend' | 'reactivate' | 'revoke' | 'approve';
type Editor = { kind: 'create' } | { kind: 'update' | 'scopes'; application: DeveloperApplication };
type Pending =
  | { kind: 'create'; input: ApplicationInput; identity: string; key: string }
  | { kind: 'update'; id: string; input: Pick<ApplicationInput, 'name' | 'description' | 'redirectUris'>; identity: string; key: string }
  | { kind: 'scopes'; id: string; scopes: string[]; identity: string; key: string }
  | { kind: LifecycleAction; id: string; identity: string; key: string };

export function ApplicationsPanel({ canManage, canApprove }: { canManage: boolean; canApprove: boolean }): JSX.Element {
  const { t } = useDeveloperI18n();
  const requestNumber = useRef(0);
  const formHeading = useRef<HTMLHeadingElement>(null);
  const intents = useRef(new Map<string, string>());
  const [rows, setRows] = useState<DeveloperApplication[]>([]);
  const [catalog, setCatalog] = useState<ScopeDefinition[]>([]);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const cursor = cursors[cursors.length - 1];
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [formError, setFormError] = useState('');
  const [verificationError, setVerificationError] = useState('');
  const [editor, setEditor] = useState<Editor>({ kind: 'create' });
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [environment, setEnvironment] = useState<DeveloperEnvironment>('SANDBOX');
  const [redirects, setRedirects] = useState('');
  const [scopes, setScopes] = useState<string[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [detail, setDetail] = useState<DeveloperApplication | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const detailRequest = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestNumber.current;
    setLoading(true);
    try {
      const [page, choices] = await Promise.all([
        developerPlatformApi.listApplications({ limit: PAGE_SIZE, cursor }), developerPlatformApi.scopeCatalog(),
      ]);
      if (request !== requestNumber.current) return;
      setRows(page.rows); setNextCursor(page.nextCursor ?? null); setCatalog(choices.scopes); setError('');
    } catch { if (request === requestNumber.current) setError(t.failed); }
    finally { if (request === requestNumber.current) setLoading(false); }
  }, [cursor, t.failed]);
  useEffect(() => { void load(); return () => { requestNumber.current += 1; }; }, [load]);

  async function showDetails(id: string): Promise<void> {
    const request = ++detailRequest.current;
    setDetailLoading(true); setDetail(null); setError('');
    try {
      const application = await developerPlatformApi.getApplication(id);
      if (request === detailRequest.current) setDetail(application);
    } catch { if (request === detailRequest.current) setError(t.failed); }
    finally { if (request === detailRequest.current) setDetailLoading(false); }
  }
  function resetEditor(): void {
    setEditor({ kind: 'create' }); setName(''); setDescription(''); setEnvironment('SANDBOX');
    setRedirects(''); setScopes([]); setFormError('');
  }
  function openEditor(kind: 'update' | 'scopes', application: DeveloperApplication): void {
    setEditor({ kind, application }); setName(application.name); setDescription(application.description);
    setEnvironment(application.environment); setRedirects(application.redirectUris.join('\n')); setScopes(application.scopes);
    setFormError(''); setNotice('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    requestAnimationFrame(() => formHeading.current?.focus());
  }
  function intent(identity: string): { identity: string; key: string } {
    const key = intents.current.get(identity) ?? crypto.randomUUID();
    intents.current.set(identity, key);
    return { identity, key };
  }
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (busy) return;
    setFormError(''); setVerificationError('');
    if (editor.kind === 'scopes') {
      if (!scopes.length) { setFormError(t.selectScopes); return; }
      const input = { id: editor.application.id, scopes: [...scopes].sort() };
      setPending({ kind: 'scopes', ...input, ...intent(JSON.stringify(['scopes', input])) });
      return;
    }
    const uris = [...new Set(redirects.split(/\r?\n/).map((uri) => uri.trim()).filter(Boolean))];
    if (!validApplicationRedirects(uris, environment)) { setFormError(t.invalidRedirects); return; }
    const common = { name: name.trim(), description: description.trim(), redirectUris: uris };
    if (editor.kind === 'update') {
      const input = { id: editor.application.id, input: common };
      setPending({ kind: 'update', ...input, ...intent(JSON.stringify(['update', input])) });
    } else {
      if (!scopes.length) { setFormError(t.selectScopes); return; }
      const input: ApplicationInput = { ...common, environment, requestedScopes: [...scopes].sort() };
      setPending({ kind: 'create', input, ...intent(JSON.stringify(['create', input])) });
    }
  }
  function prepare(kind: LifecycleAction, application: DeveloperApplication): void {
    if (busy) return;
    const identity = `${kind}:${application.id}`;
    setVerificationError(''); setPending({ kind, id: application.id, ...intent(identity) });
  }
  function proofAction(value: Pending): DeveloperStepUpAction {
    switch (value.kind) {
      case 'create': return 'DEVELOPER_APPLICATION_CREATE';
      case 'update': return 'DEVELOPER_APPLICATION_UPDATE';
      case 'scopes': return 'DEVELOPER_APPLICATION_SCOPE_CHANGE';
      case 'activate': return 'DEVELOPER_APPLICATION_ACTIVATE';
      case 'suspend': return 'DEVELOPER_APPLICATION_SUSPEND';
      case 'reactivate': return 'DEVELOPER_APPLICATION_REACTIVATE';
      case 'revoke': return 'DEVELOPER_APPLICATION_REVOKE';
      case 'approve': return 'DEVELOPER_APPLICATION_APPROVE';
    }
  }
  const confirmation = pending?.kind === 'create' ? t.createApplication : pending?.kind === 'update' ? t.editApplication
    : pending?.kind === 'scopes' ? t.editScopes : pending?.kind === 'activate' ? t.confirmAppActivate
    : pending?.kind === 'suspend' ? t.confirmAppSuspend : pending?.kind === 'reactivate' ? t.confirmAppReactivate
    : pending?.kind === 'revoke' ? t.confirmAppRevoke : t.confirmAppApprove;
  async function verify(method: StepUpMethod, value: string): Promise<void> {
    if (!pending || busy) return;
    setBusy(true); setVerificationError(''); setError(''); setNotice('');
    try { await developerPlatformApi.verifyStepUp(proofAction(pending), method, value, crypto.randomUUID()); }
    catch { setVerificationError(t.verificationFailed); setBusy(false); return; }
    const current = pending; setPending(null);
    try {
      switch (current.kind) {
        case 'create': confirmApplicationCreate(await developerPlatformApi.createApplication(current.input, current.key), current.input); setNotice(t.applicationCreated); resetEditor(); break;
        case 'update': confirmApplicationUpdate(await developerPlatformApi.updateApplication(current.id, current.input, current.key), current.id, current.input); setNotice(t.applicationUpdated); resetEditor(); break;
        case 'scopes': confirmApplicationScopes(await developerPlatformApi.updateScopes(current.id, { scopes: current.scopes }, current.key), current.id, current.scopes); setNotice(t.applicationUpdated); resetEditor(); break;
        case 'activate': confirmState(await developerPlatformApi.activateApplication(current.id, current.key), current.id, ['ACTIVE']); setNotice(t.applicationChanged); break;
        case 'suspend': confirmState(await developerPlatformApi.suspendApplication(current.id, undefined, current.key), current.id, ['SUSPENDED']); setNotice(t.applicationChanged); break;
        case 'reactivate': confirmState(await developerPlatformApi.requestApplicationReactivation(current.id, undefined, current.key), current.id, ['REACTIVATION_REVIEW', 'ACTIVE']); setNotice(t.applicationChanged); break;
        case 'revoke': confirmState(await developerPlatformApi.revokeApplication(current.id, undefined, current.key), current.id, ['REVOKED']); setNotice(t.applicationChanged); break;
        case 'approve': confirmState(await developerPlatformApi.approveApplicationReactivation(current.id, current.key), current.id, ['ACTIVE']); setNotice(t.applicationChanged); break;
      }
      intents.current.delete(current.identity);
      await load();
    } catch { setError(t.uncertain); }
    finally { setBusy(false); }
  }
  const scopeChoices = [...new Set([...catalog.map((item) => item.scope), ...scopes])];
  return <section className="dev-stack" aria-labelledby="applications-title">
    <h1 id="applications-title">{t.applications}</h1>
    {error && <div role="alert">{error} <button type="button" className="dev-button" onClick={() => void load()}>{t.retry}</button></div>}
    {notice && <p role="status" aria-live="polite">{notice}</p>}
    {pending && <StepUpDialog description={confirmation} busy={busy} error={verificationError} onCancel={() => setPending(null)} onVerify={verify} />}
    {!canManage && <p className="dev-muted">{t.manageNeeded}</p>}
    {detailLoading && <p role="status">{t.loading}</p>}
    {detail && <section className="dev-card" aria-labelledby="application-details-title">
      <h2 id="application-details-title">{t.details}: {detail.name}</h2>
      <p><strong>{t.status}:</strong> {localizedState(detail.state, t)}</p>
      <p><strong>{t.redirectUris}:</strong></p><ul>{detail.redirectUris.map((uri) => <li key={uri}><code>{uri}</code></li>)}</ul>
      <p><strong>{t.scopes}:</strong> {detail.scopes.join(', ')}</p>
      <button type="button" className="dev-button" onClick={() => { detailRequest.current += 1; setDetail(null); }}>{t.close}</button>
    </section>}
    {canManage && !loading && catalog.length > 0 && <form className="dev-card dev-form" onSubmit={submit}>
      <h2 ref={formHeading} tabIndex={-1}>{editor.kind === 'create' ? t.createApplication : editor.kind === 'update' ? t.editApplication : t.editScopes}</h2>
      {formError && <p role="alert">{formError}</p>}
      {editor.kind !== 'scopes' && <>
        <label>{t.applicationName}<input required minLength={3} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>{t.description}<textarea maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        {editor.kind === 'create' && <label>{t.environment}<select value={environment} onChange={(event) => setEnvironment(event.target.value as DeveloperEnvironment)}>
          <option value="SANDBOX">{t.sandbox}</option><option value="PRODUCTION">{t.production}</option>
        </select></label>}
        <label>{t.redirectUris}<textarea required aria-describedby="application-redirect-help" value={redirects} onChange={(event) => setRedirects(event.target.value)} /></label>
        <p className="dev-muted" id="application-redirect-help">{t.redirectHelp}</p>
      </>}
      {editor.kind !== 'update' && <>
        <label>{t.scopes}<select multiple required aria-label={t.scopes} aria-describedby="application-scope-help" value={scopes}
          onChange={(event) => setScopes(Array.from(event.currentTarget.selectedOptions, (option) => option.value))}>
          {scopeChoices.map((scope) => <option key={scope} value={scope}>{scope}</option>)}
        </select></label>
        <p className="dev-muted" id="application-scope-help">{t.scopePlanNotice} {t.helpEvents}</p>
      </>}
      <div className="dev-actions"><button type="submit" className="dev-button" disabled={busy || (editor.kind !== 'update' && !scopeChoices.length)}>{busy ? t.saving : editor.kind === 'create' ? t.create : t.save}</button>
        {editor.kind !== 'create' && <button type="button" className="dev-button" onClick={resetEditor}>{t.cancel}</button>}
      </div>
    </form>}
    {loading ? <p role="status">{t.loading}</p> : <div className="dev-card">
      {rows.length === 0 && !error ? <p>{t.noApplications}</p> : <div className="dev-table-wrap"><table className="dev-table">
        <thead><tr><th scope="col">{t.applicationName}</th><th scope="col">{t.environment}</th><th scope="col">{t.status}</th><th scope="col">{t.scopes}</th>{canManage && <th scope="col">{t.edit}</th>}</tr></thead>
        <tbody>{rows.map((app) => <tr key={app.id}>
          <td>{app.name}<br /><code>{app.clientId}</code><br /><button type="button" className="dev-button" onClick={() => void showDetails(app.id)}>{t.details}</button></td><td>{app.environment === 'PRODUCTION' ? t.production : t.sandbox}</td><td>{localizedState(app.state, t)}</td><td>{app.scopes.join(', ')}</td>
          {canManage && <td>{app.state !== 'REVOKED' && <div className="dev-actions">
            <button type="button" className="dev-button" disabled={busy} onClick={() => openEditor('update', app)}>{t.edit}</button>
            <button type="button" className="dev-button" disabled={busy} onClick={() => openEditor('scopes', app)}>{t.editScopes}</button>
            {app.state === 'PENDING' && <button type="button" className="dev-button" disabled={busy} onClick={() => prepare('activate', app)}>{t.activate}</button>}
            {app.state === 'ACTIVE' && <button type="button" className="dev-button" disabled={busy} onClick={() => prepare('suspend', app)}>{t.suspend}</button>}
            {app.state === 'SUSPENDED' && <button type="button" className="dev-button" disabled={busy} onClick={() => prepare('reactivate', app)}>{t.requestReactivation}</button>}
            {app.state === 'REACTIVATION_REVIEW' && canApprove && <button type="button" className="dev-button" disabled={busy} onClick={() => prepare('approve', app)}>{t.approveReactivation}</button>}
            {app.state !== 'PENDING' && <button type="button" className="dev-button" disabled={busy} onClick={() => prepare('revoke', app)}>{t.revoke}</button>}
          </div>}</td>}
        </tr>)}</tbody>
      </table></div>}
      {(cursors.length > 1 || nextCursor) && <div className="dev-actions">
        <button type="button" className="dev-button" disabled={busy || cursors.length <= 1} onClick={() => setCursors((value) => value.slice(0, -1))}>{t.previous}</button>
        <span aria-live="polite">{cursors.length}</span>
        <button type="button" className="dev-button" disabled={busy || !nextCursor} onClick={() => { if (nextCursor) setCursors((value) => [...value, nextCursor]); }}>{t.next}</button>
      </div>}
    </div>}
  </section>;
}

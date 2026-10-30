'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { developerPlatformApi, type EventType, type StepUpMethod, type WebhookSubscription } from '@/api/developer-platform-api';
import { localizedState, useDeveloperI18n } from './i18n';
import { WebhookEndpointForm } from './webhook-endpoint-form';
import { SecretReveal } from './secret-reveal';
import { StepUpDialog } from './step-up-dialog';
import { confirmState, confirmWebhookSecret } from './mutation-response';

type Action = 'pause' | 'resume' | 'revoke' | 'rotate';
type Pending = { action: Action; hook: WebhookSubscription; identity: string; key: string };

export function WebhookList({ canManage }: { canManage: boolean }): JSX.Element {
  const { t } = useDeveloperI18n();
  const requestNumber = useRef(0);
  const [events, setEvents] = useState<EventType[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookSubscription[]>([]);
  const [editing, setEditing] = useState<WebhookSubscription | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [verificationError, setVerificationError] = useState('');
  const keys = useRef(new Map<string, string>());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [generation, setGeneration] = useState(0);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const cursor = cursors[cursors.length - 1];
  // A promise chain rather than an async function, because the effect below calls it and React 19
  // refuses a function that writes state synchronously on the way in. Paging and retry set
  // `loading` in their own handlers.
  const load = useCallback((): Promise<void> => {
    const request = ++requestNumber.current;
    return Promise.all([developerPlatformApi.eventTypes(), developerPlatformApi.listWebhooks({ limit: 10, cursor })])
      .then(([catalogue, list]) => {
        if (request !== requestNumber.current) return;
        setEvents(catalogue.eventTypes); setWebhooks(list.rows); setNextCursor(list.nextCursor ?? null); setError('');
      })
      .catch(() => { if (request === requestNumber.current) setError(t.failed); })
      .finally(() => { if (request === requestNumber.current) setLoading(false); });
  }, [t.failed, cursor]);
  useEffect(() => { void load(); return () => { requestNumber.current += 1; }; }, [load]);

  function prepare(action: Action, hook: WebhookSubscription): void {
    if (busy || secret) return;
    const identity = `${action}:${hook.id}`;
    const key = keys.current.get(identity) ?? crypto.randomUUID();
    keys.current.set(identity, key);
    setVerificationError('');
    setPending({ action, hook, identity, key });
  }
  async function verify(method: StepUpMethod, value: string): Promise<void> {
    if (!pending || busy) return;
    setBusy(true); setVerificationError(''); setError(''); setNotice('');
    const action = pending.action === 'pause' ? 'WEBHOOK_PAUSE' : pending.action === 'resume' ? 'WEBHOOK_RESUME' : pending.action === 'revoke' ? 'WEBHOOK_REVOKE' : 'WEBHOOK_SECRET_ROTATE';
    try { await developerPlatformApi.verifyStepUp(action, method, value, crypto.randomUUID()); }
    catch { setVerificationError(t.verificationFailed); setBusy(false); return; }
    const intent = pending;
    setPending(null);
    try {
      if (intent.action === 'pause') confirmState(await developerPlatformApi.pauseWebhook(intent.hook.id, intent.key), intent.hook.id, ['PAUSED']);
      else if (intent.action === 'resume') confirmState(await developerPlatformApi.resumeWebhook(intent.hook.id, intent.key), intent.hook.id, ['ACTIVE']);
      else if (intent.action === 'revoke') confirmState(await developerPlatformApi.revokeWebhook(intent.hook.id, intent.key), intent.hook.id, ['REVOKED']);
      else {
        const issued = await developerPlatformApi.rotateWebhookSecret(intent.hook.id, intent.key);
        confirmWebhookSecret(issued);
        setSecret(issued.secret);
      }
      keys.current.delete(intent.identity);
      setNotice(t.webhookChanged);
      await load();
    } catch { setError(t.uncertain); }
    finally { setBusy(false); }
  }
  const description = pending?.action === 'pause' ? t.confirmPauseWebhook : pending?.action === 'resume' ? t.confirmResumeWebhook : pending?.action === 'revoke' ? t.confirmRevokeWebhook : t.confirmRotateWebhook;

  return <section className="dev-stack" aria-labelledby="webhooks-title">
    <h1 id="webhooks-title">{t.webhooks}</h1>
    {error && <div role="alert">{error} <button type="button" className="dev-button" onClick={() => void load()}>{t.retry}</button></div>}
    {notice && <p role="status" aria-live="polite">{notice}</p>}
    {pending && <StepUpDialog description={description} busy={busy} error={verificationError} onCancel={() => setPending(null)} onVerify={verify} />}
    {secret && <SecretReveal secret={secret} onClose={() => { setSecret(null); setNotice(t.secretClosed); }} />}
    {!canManage && <p className="dev-muted">{t.manageNeeded}</p>}
    {canManage && !secret && !loading && !error && <WebhookEndpointForm key={editing?.id ?? `new-${generation}`} events={events} existing={editing ?? undefined}
      onSecret={(value) => { setNotice(''); setSecret(value); }}
      onSaved={() => { setEditing(null); setGeneration((value) => value + 1); void load(); }}
      onCancel={editing ? () => setEditing(null) : undefined} />}
    {loading ? <p role="status">{t.loading}</p> : <div className="dev-card">
      {webhooks.length === 0 && !error ? <p>{t.noWebhooks}</p> : <div className="dev-table-wrap"><table className="dev-table">
        <thead><tr><th scope="col">{t.endpoint}</th><th scope="col">{t.status}</th><th scope="col">{t.events}</th><th scope="col">{t.deliveries}</th>{canManage && <th scope="col">{t.edit}</th>}</tr></thead>
        <tbody>{webhooks.map((hook) => <tr key={hook.id}><td>{hook.endpointUrl}</td><td>{localizedState(hook.state, t)}</td><td>{hook.eventTypes.join(', ')}</td>
          <td><Link href={`/developer/webhooks/${encodeURIComponent(hook.id)}/deliveries`}>{t.deliveries}</Link></td>
          {canManage && <td>{hook.state !== 'REVOKED' && <div className="dev-actions">
            <button type="button" className="dev-button" disabled={busy || Boolean(secret)} onClick={() => { setEditing(hook); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>{t.edit}</button>
            {hook.state === 'ACTIVE' ? <button type="button" className="dev-button" disabled={busy || Boolean(secret)} onClick={() => prepare('pause', hook)}>{t.pause}</button> : <button type="button" className="dev-button" disabled={busy || Boolean(secret)} onClick={() => prepare('resume', hook)}>{t.resume}</button>}
            <button type="button" className="dev-button" disabled={busy || Boolean(secret)} onClick={() => prepare('rotate', hook)}>{t.rotateSecret}</button>
            <button type="button" className="dev-button" disabled={busy || Boolean(secret)} onClick={() => prepare('revoke', hook)}>{t.revoke}</button>
          </div>}</td>}</tr>)}</tbody>
      </table></div>}
      {(cursors.length > 1 || nextCursor) && <div className="dev-actions">
        <button type="button" className="dev-button" disabled={busy || cursors.length <= 1} onClick={() => setCursors((value) => value.slice(0, -1))}>{t.previous}</button>
        <span aria-live="polite">{cursors.length}</span>
        <button type="button" className="dev-button" disabled={busy || !nextCursor} onClick={() => { if (nextCursor) setCursors((value) => [...value, nextCursor]); }}>{t.next}</button>
      </div>}
    </div>}
  </section>;
}

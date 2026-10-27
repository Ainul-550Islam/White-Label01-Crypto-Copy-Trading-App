'use client';
import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';
import { developerPlatformApi, type EventType, type StepUpMethod, type WebhookInput, type WebhookSubscription } from '@/api/developer-platform-api';
import { useDeveloperI18n } from './i18n';
import { StepUpDialog } from './step-up-dialog';
import { ApplicationPageControls, useApplicationPages } from './application-pages';
import { confirmWebhook, confirmWebhookSecret } from './mutation-response';

const SERVER_HTTPS = /^https:\/\/[A-Za-z0-9.\-_:]+[A-Za-z0-9/\-._~%]*$/;
export function validWebhookUrl(value: string, _production: boolean): boolean {
  if (value.length > 512 || !SERVER_HTTPS.test(value)) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.port || !url.hostname || url.username || url.password || url.search || url.hash) return false;
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false;
    const address = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)?.slice(1).map(Number);
    if (!address) return true; // DNS answers are checked and pinned at delivery time.
    const [a = 0, b = 0, c = 0] = address;
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 192 && ((b === 168) || (b === 88 && c === 99))) ||
      (a === 198 && ((b === 18 || b === 19) || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113));
  } catch { return false; }
}

export function WebhookEndpointForm({ events, existing, onSaved, onSecret, onCancel }: {
  events: EventType[]; existing?: WebhookSubscription;
  onSaved: () => void; onSecret: (secret: string) => void; onCancel?: () => void;
}): JSX.Element {
  const { t } = useDeveloperI18n();
  const applications = useApplicationPages(!existing);
  const available = applications.rows.filter((app) => app.state === 'ACTIVE' && app.scopes.includes('webhooks:manage'));
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (existing) heading.current?.focus(); }, [existing]);
  const [appId, setAppId] = useState(existing?.applicationId ?? '');
  useEffect(() => {
    if (existing || applications.loading || applications.error) return;
    const eligible = applications.rows.filter((app) => app.state === 'ACTIVE' && app.scopes.includes('webhooks:manage'));
    setAppId((current) => eligible.some((app) => app.id === current) ? current : (eligible[0]?.id ?? ''));
  }, [existing, applications.rows, applications.loading, applications.error]);
  const [endpoint, setEndpoint] = useState(existing?.endpointUrl ?? '');
  const [eventTypes, setEventTypes] = useState<string[]>(existing?.eventTypes ?? []);
  const [description, setDescription] = useState(existing?.description ?? '');
  const intent = useRef<{ fingerprint: string; key: string } | null>(null);
  const [pending, setPending] = useState<{ input: WebhookInput; key: string } | null>(null);
  const [verificationError, setVerificationError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const app = applications.rows.find((item) => item.id === appId);
  const choices = [...new Set([...events.map((event) => event.eventType), ...eventTypes])];

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (busy || !appId || (!existing && !available.some((item) => item.id === appId))) return;
    const url = endpoint.trim();
    if (!validWebhookUrl(url, (existing?.environment ?? app?.environment) === 'PRODUCTION')) { setError(t.validUrl); return; }
    if (!eventTypes.length || eventTypes.length > 32) { setError(t.chooseEvents); return; }
    const input = { applicationId: appId, endpointUrl: url, eventTypes: [...eventTypes], description: description.trim() };
    const fingerprint = JSON.stringify({ id: existing?.id, input });
    if (intent.current?.fingerprint !== fingerprint) intent.current = { fingerprint, key: crypto.randomUUID() };
    setError(''); setVerificationError(''); setPending({ input, key: intent.current.key });
  }
  async function verify(method: StepUpMethod, value: string): Promise<void> {
    if (!pending || busy) return;
    setBusy(true); setVerificationError('');
    try {
      await developerPlatformApi.verifyStepUp(existing ? 'WEBHOOK_UPDATE' : 'WEBHOOK_CREATE', method, value, crypto.randomUUID());
    } catch { setVerificationError(t.verificationFailed); setBusy(false); return; }
    const current = pending;
    setPending(null);
    try {
      if (existing) {
        const saved = await developerPlatformApi.updateWebhook(existing.id, { endpointUrl: current.input.endpointUrl, eventTypes: current.input.eventTypes, description: current.input.description }, current.key);
        confirmWebhook(saved, current.input, existing.id);
      } else {
        const issued = await developerPlatformApi.createWebhook(current.input, current.key);
        confirmWebhookSecret(issued);
        confirmWebhook(issued.subscription, current.input);
        onSecret(issued.secret);
      }
      intent.current = null;
      onSaved();
    } catch { setError(t.uncertain); }
    finally { setBusy(false); }
  }
  return <>
    {pending && <StepUpDialog description={existing ? t.editWebhook : t.createWebhook} busy={busy} error={verificationError} onCancel={() => setPending(null)} onVerify={verify} />}
    <form className="dev-card dev-form" onSubmit={submit}>
    <h2 ref={heading} tabIndex={-1}>{existing ? t.editWebhook : t.createWebhook}</h2>
    {error && <p role="alert">{error}</p>}
    {!existing && <label>{t.application}<select required value={appId} onChange={(event) => setAppId(event.target.value)}>
      <option value="">{t.chooseApplication}</option>{available.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.environment}</option>)}
    </select></label>}
    {!existing && <ApplicationPageControls pages={applications} disabled={busy} />}
    {!existing && applications.error && <div role="alert">{t.failed} <button type="button" className="dev-button" onClick={applications.retry}>{t.retry}</button></div>}
    {!existing && !applications.loading && !applications.error && !available.length && <p>{t.noEligibleOnPage}</p>}
    <label>{t.endpoint}<input type="url" required maxLength={512} value={endpoint} onChange={(event) => setEndpoint(event.target.value)} /></label>
    <label>{t.events}<select multiple required aria-describedby="developer-event-help" value={eventTypes}
      onChange={(event) => setEventTypes(Array.from(event.currentTarget.selectedOptions, (option) => option.value))}>
      {choices.map((name) => <option key={name} value={name}>{name}</option>)}
    </select></label>
    <p id="developer-event-help" className="dev-muted">{choices.length ? t.helpEvents : t.noEvents}</p>
    <label>{t.description}<textarea maxLength={200} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
    <div className="dev-actions"><button className="dev-button" type="submit" disabled={busy || (!existing && (applications.loading || applications.error)) || !appId || !choices.length}>{busy ? t.saving : existing ? t.save : t.create}</button>
      {onCancel && <button className="dev-button" type="button" onClick={onCancel}>{t.cancel}</button>}
    </div>
  </form></>;
}

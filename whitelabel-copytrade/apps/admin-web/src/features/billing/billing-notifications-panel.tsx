'use client';

import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';

import {
  billingNotificationsAdminApi,
  webhookRows,
  type BillingWebhook,
  type HistoryQuery,
} from '@/api/billing-notifications-admin-api';
import { ApiError } from '@/lib/api-error';
import { Badge, Card, DataTable, ErrorNotice, StatTile } from '@/components/ui';
import { formatDateTime, formatRelative } from '@/lib/format';
import { theme, toneForStatus } from '@/lib/theme';
import { useResource } from '@/features/shared/use-resource';

/**
 * Billing notification delivery: history, webhook endpoints, the worker and
 * reconciliation.
 *
 * Secrets are shown exactly once, immediately after creation or rotation, because
 * that is all the API ever returns - there is no route that reads a webhook
 * secret back. The console therefore:
 *
 *  * keeps a freshly issued secret in memory for the current render only, with a
 *    warning that it cannot be retrieved again;
 *  * never pre-fills a secret input;
 *  * asks for the new secret to be typed twice on rotation, since a typo there
 *    silently breaks every delivery.
 */
export function BillingNotificationsPanel(): JSX.Element {
  const [draft, setDraft] = useState<HistoryQuery>({});
  const [query, setQuery] = useState<HistoryQuery>({});
  const [version, setVersion] = useState(0);

  const history = useResource(() => billingNotificationsAdminApi.getHistory({ ...query, limit: 50 }), [query, version], { errorMessage: 'Notification history could not be loaded.' });
  const webhooks = useResource(() => billingNotificationsAdminApi.listWebhooks(), [version], { errorMessage: 'Webhook endpoints could not be loaded.' });
  const stuck = useResource(() => billingNotificationsAdminApi.detectStuck(24), [version], { errorMessage: 'Stuck notifications could not be checked.' });

  const [form, setForm] = useState({ endpointUrl: '', eventTypes: '', secret: '', description: '' });
  const [rotating, setRotating] = useState<{ webhook: BillingWebhook; secret: string; repeat: string } | null>(null);
  const [deleting, setDeleting] = useState<BillingWebhook | null>(null);
  const [issuedSecret, setIssuedSecret] = useState<{ label: string; secret: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (message || error) statusRef.current?.focus();
  }, [message, error]);

  function parseEventTypes(text: string): { value?: string[]; error?: string } {
    const parts = text.split(',').map((part) => part.trim()).filter((part) => part !== '');
    if (parts.length === 0) return { error: 'List at least one event type, separated by commas.' };
    return { value: parts };
  }

  async function create(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError('');
    setMessage('');
    setIssuedSecret(null);

    const endpointUrl = form.endpointUrl.trim();
    if (!/^https:\/\//i.test(endpointUrl)) {
      setError('The endpoint must be an https URL. Billing payloads are never sent over plain http.');
      return;
    }
    const events = parseEventTypes(form.eventTypes);
    if (events.error || !events.value) {
      setError(events.error ?? 'List at least one event type.');
      return;
    }
    if (form.secret.trim().length < 16) {
      setError('The signing secret must be at least 16 characters.');
      return;
    }

    setBusy(true);
    try {
      const created = await billingNotificationsAdminApi.createWebhook(
        { endpointUrl, eventTypes: events.value, secret: form.secret.trim(), ...(form.description.trim() ? { description: form.description.trim() } : {}) },
        crypto.randomUUID(),
      );
      setMessage('The webhook endpoint was created.');
      setIssuedSecret({ label: endpointUrl, secret: created.secret });
      setForm({ endpointUrl: '', eventTypes: '', secret: '', description: '' });
      setVersion((current) => current + 1);
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 409
          ? 'An endpoint with this URL already exists for the organisation.'
          : caught instanceof ApiError && caught.status === 422
            ? 'The service refused this endpoint. Check the URL and the event types.'
            : 'The endpoint was not created.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function rotate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!rotating) return;
    if (rotating.secret.length < 16) {
      setError('The new signing secret must be at least 16 characters.');
      return;
    }
    if (rotating.secret !== rotating.repeat) {
      setError('The two secrets do not match. Re-enter them identically.');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');
    setIssuedSecret(null);
    try {
      const result = await billingNotificationsAdminApi.rotateSecret(rotating.webhook.id, { newSecret: rotating.secret }, crypto.randomUUID());
      setMessage('The signing secret was rotated. Deliveries signed with the old secret will now fail verification.');
      setIssuedSecret({ label: rotating.webhook.endpointUrl, secret: result.secret });
      setRotating(null);
      setVersion((current) => current + 1);
    } catch {
      setError('The secret was not rotated. The existing secret is still in use.');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(webhook: BillingWebhook): Promise<void> {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await billingNotificationsAdminApi.updateWebhook(webhook.id, { enabled: !webhook.enabled }, crypto.randomUUID());
      setMessage(webhook.enabled ? 'The endpoint was disabled; nothing more is delivered to it.' : 'The endpoint was enabled.');
      setVersion((current) => current + 1);
    } catch {
      setError('The change was not applied.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!deleting) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await billingNotificationsAdminApi.deleteWebhook(deleting.id, crypto.randomUUID());
      setMessage('The endpoint was removed. Its delivery history remains.');
      setDeleting(null);
      setVersion((current) => current + 1);
    } catch {
      setError('The endpoint was not removed.');
    } finally {
      setBusy(false);
    }
  }

  async function runWorker(): Promise<void> {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await billingNotificationsAdminApi.processWorker(50, crypto.randomUUID());
      setMessage(`The worker processed ${result.processed} notification(s)${result.failed ? `, ${result.failed} failed` : ''}.`);
      setVersion((current) => current + 1);
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 403 ? 'Worker runs are restricted to platform operators.' : 'The worker did not run.');
    } finally {
      setBusy(false);
    }
  }

  async function reconcileAll(): Promise<void> {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await billingNotificationsAdminApi.reconcileAll(50, crypto.randomUUID());
      setMessage(`Reconciled ${result.tenantsChecked} tenant(s); ${result.discrepanciesFound} discrepancy(ies) found.`);
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 403 ? 'Reconciliation is restricted to platform operators.' : 'Reconciliation did not run.');
    } finally {
      setBusy(false);
    }
  }

  const endpoints = webhookRows(webhooks.data);
  const historyRows = history.data?.data ?? [];

  return (
    <div style={{ display: 'grid', gap: theme.space(6) }}>
      <Card title="Delivery posture" description="Worker, stuck sends and reconciliation in one place.">
        <div style={{ display: 'flex', gap: theme.space(3), flexWrap: 'wrap', marginBottom: theme.space(4) }}>
          <StatTile label="Endpoints" value={endpoints.length} hint={`${endpoints.filter((row) => row.enabled).length} enabled`} />
          <StatTile label="Stuck notifications" value={stuck.data?.count ?? '—'} hint={stuck.data ? `Older than ${stuck.data.thresholdHours}h` : undefined} />
          <StatTile label="Recent rows" value={history.data?.total ?? '—'} />
        </div>
        <div style={{ display: 'flex', gap: theme.space(2), flexWrap: 'wrap' }}>
          <button type="button" disabled={busy} onClick={() => void runWorker()}>Process queued notifications</button>
          <button type="button" disabled={busy} onClick={() => void reconcileAll()}>Reconcile deliveries</button>
          <button type="button" disabled={busy} onClick={() => setVersion((current) => current + 1)}>Refresh</button>
        </div>
        <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" style={{ margin: `${theme.space(3)} 0 0`, minHeight: 20, fontSize: 13, color: theme.color.textMuted }}>{message}</p>
        {error && <ErrorNotice title="Action not completed" message={error} />}

        {stuck.data && stuck.data.count > 0 && (
          <div style={{ marginTop: theme.space(4) }}>
            <DataTable
              rows={stuck.data.stuck}
              rowKey={(row) => row.id}
              emptyTitle="Nothing stuck"
              columns={[
                { key: 'event', header: 'Event', render: (row) => row.eventKey },
                { key: 'channel', header: 'Channel', render: (row) => row.channel },
                { key: 'status', header: 'Status', render: (row) => <Badge tone={toneForStatus(row.status)}>{row.status}</Badge> },
                { key: 'at', header: 'Queued', render: (row) => formatRelative(row.createdAt) },
              ]}
            />
          </div>
        )}
      </Card>

      {issuedSecret && (
        <Card title="Copy this secret now" description="The service returns a signing secret only once. It cannot be read back, so store it in your secret manager before leaving this page.">
          <p style={{ marginTop: 0, fontSize: 13 }}>{issuedSecret.label}</p>
          <pre style={{ margin: 0, padding: theme.space(3), background: theme.color.surfaceRaised, borderRadius: 6, fontSize: 13, overflowX: 'auto' }}>{issuedSecret.secret}</pre>
          <div style={{ marginTop: theme.space(3) }}>
            <button type="button" onClick={() => setIssuedSecret(null)}>I have stored it</button>
          </div>
        </Card>
      )}

      <Card title="Endpoints" description="Where billing events are delivered. A secret is set at creation and can only be rotated, never read.">
        {webhooks.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading endpoints…</p>}
        {webhooks.error && <ErrorNotice title="Endpoints unavailable" message={webhooks.error} />}
        {webhooks.data && (
          <DataTable
            rows={endpoints}
            rowKey={(row) => row.id}
            emptyTitle="No webhook endpoints"
            emptyDescription="Add one below to start receiving billing events."
            columns={[
              { key: 'url', header: 'Endpoint', render: (row) => <code style={{ fontSize: 12 }}>{row.endpointUrl}</code> },
              { key: 'events', header: 'Events', render: (row) => row.eventTypes.join(', ') },
              { key: 'enabled', header: 'State', render: (row) => <Badge tone={row.enabled ? 'success' : 'neutral'}>{row.enabled ? 'Enabled' : 'Disabled'}</Badge> },
              { key: 'delivery', header: 'Last delivery', render: (row) => formatRelative(row.lastDeliveryAt) },
              { key: 'failures', header: 'Failures', align: 'right', render: (row) => (row.failureCount === undefined ? '—' : String(row.failureCount)) },
              {
                key: 'actions',
                header: 'Actions',
                render: (row) => (
                  <div style={{ display: 'flex', gap: theme.space(2), flexWrap: 'wrap' }}>
                    <button type="button" disabled={busy} onClick={() => void toggle(row)}>{row.enabled ? 'Disable' : 'Enable'}</button>
                    <button type="button" disabled={busy} onClick={() => { setRotating({ webhook: row, secret: '', repeat: '' }); setError(''); setMessage(''); setIssuedSecret(null); }}>Rotate secret</button>
                    <button type="button" disabled={busy} onClick={() => { setDeleting(row); setError(''); setMessage(''); }}>Remove</button>
                  </div>
                ),
              },
            ]}
          />
        )}
      </Card>

      <Card title="Add an endpoint" description="HTTPS only. The secret you choose signs the payloads the receiver validates.">
        <form onSubmit={(event) => void create(event)} aria-label="Add a billing webhook endpoint" style={{ display: 'grid', gap: theme.space(3), maxWidth: 560 }}>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Endpoint URL
            <input required type="url" inputMode="url" placeholder="https://" value={form.endpointUrl} onChange={(event) => setForm((current) => ({ ...current, endpointUrl: event.target.value }))} disabled={busy} />
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Event types (comma separated)
            <input required value={form.eventTypes} onChange={(event) => setForm((current) => ({ ...current, eventTypes: event.target.value }))} disabled={busy} />
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Signing secret (16+ characters)
            <input required type="password" autoComplete="new-password" value={form.secret} onChange={(event) => setForm((current) => ({ ...current, secret: event.target.value }))} disabled={busy} />
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Description (optional)
            <input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} disabled={busy} />
          </label>
          <div>
            <button type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add endpoint'}</button>
          </div>
        </form>
      </Card>

      {rotating && (
        <Card title={`Rotate the secret for ${rotating.webhook.endpointUrl}`} description="The receiver must be updated with the new secret, or every delivery will fail verification.">
          <form onSubmit={(event) => void rotate(event)} aria-label="Rotate a webhook secret" style={{ display: 'grid', gap: theme.space(3), maxWidth: 520 }}>
            <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
              New secret (16+ characters)
              <input required type="password" autoComplete="new-password" value={rotating.secret} onChange={(event) => setRotating((current) => (current ? { ...current, secret: event.target.value } : current))} disabled={busy} />
            </label>
            <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
              Repeat the new secret
              <input required type="password" autoComplete="new-password" value={rotating.repeat} onChange={(event) => setRotating((current) => (current ? { ...current, repeat: event.target.value } : current))} disabled={busy} />
            </label>
            <div style={{ display: 'flex', gap: theme.space(2) }}>
              <button type="submit" disabled={busy}>{busy ? 'Rotating…' : 'Confirm rotation'}</button>
              <button type="button" disabled={busy} onClick={() => { setRotating(null); setError(''); }}>Cancel</button>
            </div>
          </form>
        </Card>
      )}

      {deleting && (
        <Card title={`Remove ${deleting.endpointUrl}`} description="Deliveries to this endpoint stop immediately. Its history stays available.">
          <form onSubmit={(event) => void remove(event)} aria-label="Remove a webhook endpoint" style={{ display: 'flex', gap: theme.space(2) }}>
            <button type="submit" disabled={busy}>{busy ? 'Removing…' : 'Confirm removal'}</button>
            <button type="button" disabled={busy} onClick={() => setDeleting(null)}>Keep it</button>
          </form>
        </Card>
      )}

      <Card title="Delivery history" description="Every notification attempt with its channel and result.">
        <form
          onSubmit={(event) => { event.preventDefault(); setQuery({ ...draft }); }}
          aria-label="Filter notification history"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: theme.space(3), alignItems: 'end', marginBottom: theme.space(4) }}
        >
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Event key
            <input value={draft.eventKey ?? ''} onChange={(event) => setDraft((current) => ({ ...current, eventKey: event.target.value || undefined }))} disabled={history.loading} />
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Channel
            <input value={draft.channel ?? ''} onChange={(event) => setDraft((current) => ({ ...current, channel: event.target.value || undefined }))} disabled={history.loading} />
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Status
            <input value={draft.status ?? ''} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value || undefined }))} disabled={history.loading} />
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            From
            <input type="date" value={draft.fromDate ?? ''} onChange={(event) => setDraft((current) => ({ ...current, fromDate: event.target.value || undefined }))} disabled={history.loading} />
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            To
            <input type="date" value={draft.toDate ?? ''} onChange={(event) => setDraft((current) => ({ ...current, toDate: event.target.value || undefined }))} disabled={history.loading} />
          </label>
          <div style={{ display: 'flex', gap: theme.space(2) }}>
            <button type="submit" disabled={history.loading}>Apply</button>
            <button type="button" disabled={history.loading} onClick={() => { setDraft({}); setQuery({}); }}>Clear</button>
          </div>
        </form>

        {history.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading history…</p>}
        {history.error && <ErrorNotice title="History unavailable" message={history.error} />}
        {history.data && (
          <DataTable
            rows={historyRows}
            rowKey={(row) => row.id}
            emptyTitle="No notifications"
            emptyDescription="No notification matches this filter."
            columns={[
              { key: 'event', header: 'Event', render: (row) => <code style={{ fontSize: 12 }}>{row.eventKey}</code> },
              { key: 'channel', header: 'Channel', render: (row) => row.channel },
              { key: 'status', header: 'Status', render: (row) => <Badge tone={toneForStatus(row.status)}>{row.status}</Badge> },
              { key: 'recipient', header: 'Recipient', render: (row) => row.recipient ?? '—' },
              { key: 'attempts', header: 'Attempts', align: 'right', render: (row) => (row.attempts === undefined ? '—' : String(row.attempts)) },
              { key: 'error', header: 'Error', render: (row) => row.errorMessage ?? '—' },
              { key: 'at', header: 'Created', render: (row) => formatDateTime(row.createdAt) },
              { key: 'sent', header: 'Sent', render: (row) => (row.sentAt ? formatDateTime(row.sentAt) : '—') },
            ]}
          />
        )}
      </Card>
    </div>
  );
}

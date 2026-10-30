'use client';

import { useEffect, useRef, useState, type JSX } from 'react';

import {
  billingNotificationsAdminApi,
  type InboxQuery,
  type NotificationPreference,
  type UpdatePreferenceInput,
} from '@/api/billing-notifications-admin-api';
import { Badge, Card, DataTable, EmptyState, ErrorNotice, StatTile } from '@/components/ui';
import { formatDateTime, formatRelative } from '@/lib/format';
import { theme, toneForStatus } from '@/lib/theme';
import { useResource } from '@/features/shared/use-resource';

/**
 * The operator's own billing inbox and notification preferences.
 *
 * These routes are user-scoped: the API derives the user from the session, so
 * this page can never read or change another person's inbox even though it sits
 * in an admin console. Every write here is idempotent-keyed, because marking a
 * message read twice must not produce a second audit event.
 */
const CHANNELS = ['EMAIL', 'SMS', 'PUSH', 'IN_APP', 'WEBHOOK'] as const;
const CATEGORIES = ['TRANSACTIONAL', 'MARKETING', 'SECURITY', 'BILLING'] as const;

export function BillingInboxPanel(): JSX.Element {
  const [query, setQuery] = useState<InboxQuery>({ limit: 20 });
  const [version, setVersion] = useState(0);

  const inbox = useResource(() => billingNotificationsAdminApi.getInbox(query), [query, version], { errorMessage: 'Your inbox could not be loaded.' });
  const unread = useResource(() => billingNotificationsAdminApi.getUnreadCount(), [version], { errorMessage: 'The unread count could not be loaded.' });
  const preferences = useResource(() => billingNotificationsAdminApi.getPreferences(), [version], { errorMessage: 'Your preferences could not be loaded.' });

  const [draft, setDraft] = useState<{ channel: string; eventKey: string; category: string; enabled: boolean }>({ channel: 'EMAIL', eventKey: '', category: 'BILLING', enabled: true });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (message || error) statusRef.current?.focus();
  }, [message, error]);

  async function markRead(id: string): Promise<void> {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await billingNotificationsAdminApi.markInboxRead(id, crypto.randomUUID());
      setMessage('The message was marked read.');
      setVersion((current) => current + 1);
    } catch {
      setError('The message could not be marked read.');
    } finally {
      setBusy(false);
    }
  }

  async function markAllRead(): Promise<void> {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await billingNotificationsAdminApi.markAllInboxRead(crypto.randomUUID());
      setMessage(`${result.updated} message(s) were marked read.`);
      setVersion((current) => current + 1);
    } catch {
      setError('The messages could not be marked read.');
    } finally {
      setBusy(false);
    }
  }

  async function savePreference(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    const input: UpdatePreferenceInput = {
      channel: draft.channel,
      enabled: draft.enabled,
      ...(draft.eventKey.trim() ? { eventKey: draft.eventKey.trim() } : {}),
      ...(draft.category ? { category: draft.category } : {}),
    };
    try {
      await billingNotificationsAdminApi.updatePreference(input, crypto.randomUUID());
      setMessage(`Preference saved: ${draft.channel} ${draft.enabled ? 'enabled' : 'disabled'}${draft.eventKey.trim() ? ` for ${draft.eventKey.trim()}` : ' for every event'}.`);
      setDraft((current) => ({ ...current, eventKey: '' }));
      setVersion((current) => current + 1);
    } catch {
      setError('The preference was not saved. Your existing settings still apply.');
    } finally {
      setBusy(false);
    }
  }

  const rows = inbox.data?.data ?? [];
  const preferenceRows = preferences.data?.data ?? [];

  return (
    <div style={{ display: 'grid', gap: theme.space(6) }}>
      <Card
        title="Your inbox"
        description="Billing messages the platform sent to you. These are your own; the API scopes them to your session."
        actions={
          <div style={{ display: 'flex', gap: theme.space(2) }}>
            <label style={{ display: 'flex', gap: theme.space(2), alignItems: 'center', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={Boolean(query.unreadOnly)}
                onChange={(event) => setQuery((current) => ({ ...current, unreadOnly: event.target.checked || undefined }))}
                disabled={busy}
              />
              Unread only
            </label>
            <button type="button" disabled={busy} onClick={() => void markAllRead()}>Mark all read</button>
          </div>
        }
      >
        <div style={{ display: 'flex', gap: theme.space(3), flexWrap: 'wrap', marginBottom: theme.space(4) }}>
          <StatTile label="Unread" value={unread.data?.unreadCount ?? '—'} />
          <StatTile label="Listed" value={rows.length} />
        </div>

        <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" style={{ margin: `0 0 ${theme.space(3)}`, minHeight: 20, fontSize: 13, color: theme.color.textMuted }}>{message}</p>
        {error && <ErrorNotice title="Action not completed" message={error} />}

        {inbox.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading inbox…</p>}
        {inbox.error && <ErrorNotice title="Inbox unavailable" message={inbox.error} />}
        {inbox.data && rows.length === 0 && (
          <EmptyState title={query.unreadOnly ? 'Nothing unread' : 'No messages'} description="Billing messages appear here as the platform sends them." />
        )}

        {rows.length > 0 && (
          <DataTable
            rows={rows}
            rowKey={(row) => row.id}
            emptyTitle="No messages"
            columns={[
              { key: 'read', header: 'Read', render: (row) => <Badge tone={row.read ? 'neutral' : 'warning'}>{row.read ? 'Read' : 'Unread'}</Badge> },
              { key: 'event', header: 'Event', render: (row) => <code style={{ fontSize: 12 }}>{row.eventKey}</code> },
              { key: 'subject', header: 'Subject', render: (row) => row.subject ?? '—' },
              { key: 'channel', header: 'Channel', render: (row) => <Badge tone={toneForStatus(row.channel)}>{row.channel}</Badge> },
              { key: 'at', header: 'Received', render: (row) => (row.createdAt ? formatRelative(row.createdAt) : '—') },
              {
                key: 'actions',
                header: 'Actions',
                render: (row) =>
                  row.read ? (
                    <span style={{ fontSize: 12, color: theme.color.textMuted }}>{row.readAt ? formatDateTime(row.readAt) : 'Read'}</span>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => void markRead(row.id)}>Mark read</button>
                  ),
              },
            ]}
          />
        )}
      </Card>

      <Card title="Preferences" description="Which channels carry which billing events for you. A preference applies to every event of that channel unless an event key is set.">
        {preferences.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading preferences…</p>}
        {preferences.error && <ErrorNotice title="Preferences unavailable" message={preferences.error} />}

        <form onSubmit={(event) => void savePreference(event)} aria-label="Set a notification preference" style={{ display: 'flex', gap: theme.space(3), alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: theme.space(4) }}>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Channel
            <select value={draft.channel} onChange={(event) => setDraft((current) => ({ ...current, channel: event.target.value }))} disabled={busy}>
              {CHANNELS.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Category
            <select value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))} disabled={busy}>
              {CATEGORIES.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13, minWidth: 220 }}>
            Event key (optional)
            <input value={draft.eventKey} onChange={(event) => setDraft((current) => ({ ...current, eventKey: event.target.value }))} disabled={busy} />
          </label>
          <label style={{ display: 'flex', gap: theme.space(2), alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))} disabled={busy} />
            Enabled
          </label>
          <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save preference'}</button>
        </form>

        {preferences.data && preferenceRows.length === 0 && (
          <EmptyState title="No preferences set" description="Nothing has been configured, so the service defaults apply." />
        )}

        {preferenceRows.length > 0 && (
          <DataTable
            rows={preferenceRows}
            rowKey={(row, index) => row.id ?? `${row.channel}-${row.eventKey ?? 'all'}-${index}`}
            emptyTitle="No preferences"
            columns={[
              { key: 'channel', header: 'Channel', render: (row: NotificationPreference) => <Badge tone={toneForStatus(row.channel)}>{row.channel}</Badge> },
              { key: 'event', header: 'Event', render: (row: NotificationPreference) => row.eventKey ?? 'All billing events' },
              { key: 'category', header: 'Category', render: (row: NotificationPreference) => row.category ?? '—' },
              { key: 'enabled', header: 'State', render: (row: NotificationPreference) => <Badge tone={row.enabled ? 'success' : 'neutral'}>{row.enabled ? 'Enabled' : 'Disabled'}</Badge> },
              { key: 'locale', header: 'Locale', render: (row: NotificationPreference) => row.locale ?? 'Default' },
            ]}
          />
        )}

        <p style={{ margin: `${theme.space(3)} 0 0`, fontSize: 12, color: theme.color.textMuted }}>
          These routes act on your own account only: the service derives the user from your session, and reading another user&rsquo;s preferences needs tenant management.
        </p>
      </Card>
    </div>
  );
}

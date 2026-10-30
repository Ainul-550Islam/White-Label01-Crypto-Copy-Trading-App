'use client';

import { useState, type FormEvent, type JSX } from 'react';

import { omsAdminApi, toRows, type AuditQuery, type OmsAuditEntry } from '@/api/oms-admin-api';
import { Card, DataTable, ErrorNotice } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { theme } from '@/lib/theme';
import { useResource } from '@/features/shared/use-resource';

/**
 * The OMS audit trail.
 *
 * `detail` is an opaque object on the wire. It is rendered as a short, escaped
 * summary - never as raw HTML and never with secret-looking keys printed - so an
 * audit view cannot become a leak channel for provider payloads that happen to
 * contain a key or a signature.
 */
const REDACTED_KEYS = ['apikey', 'api_key', 'secret', 'signature', 'token', 'password', 'authorization', 'listenkey'];

function summarise(detail: unknown): string {
  if (detail === null || detail === undefined) return '—';
  if (typeof detail !== 'object') return String(detail);

  const parts: string[] = [];
  for (const [rawKey, value] of Object.entries(detail as Record<string, unknown>)) {
    const key = rawKey.toLowerCase();
    if (REDACTED_KEYS.some((blocked) => key.includes(blocked))) {
      parts.push(`${rawKey}: [redacted]`);
      continue;
    }
    const rendered = value === null || value === undefined ? '—' : typeof value === 'object' ? '(object)' : String(value);
    parts.push(`${rawKey}: ${rendered}`);
  }
  return parts.length > 0 ? parts.slice(0, 6).join(' · ') : '—';
}

export function OmsAuditLog(): JSX.Element {
  const [draft, setDraft] = useState<AuditQuery>({});
  const [query, setQuery] = useState<AuditQuery>({});

  const audit = useResource(() => omsAdminApi.getAuditHistory(query), [query], { errorMessage: 'The audit history could not be loaded.' });
  const rows = toRows<OmsAuditEntry>(audit.data).rows;

  return (
    <div style={{ display: 'grid', gap: theme.space(6) }}>
      <Card title="Filters" description="Audit entries are immutable. Filter by intent, event type or account to narrow the history.">
        <form
          onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setQuery({ ...draft }); }}
          aria-label="Filter the audit history"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: theme.space(3), alignItems: 'end' }}
        >
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Event type
            <input value={draft.eventType ?? ''} onChange={(event) => setDraft((current) => ({ ...current, eventType: event.target.value || undefined }))} disabled={audit.loading} />
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Account id
            <input value={draft.accountId ?? ''} onChange={(event) => setDraft((current) => ({ ...current, accountId: event.target.value || undefined }))} disabled={audit.loading} />
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Symbol
            <input value={draft.symbol ?? ''} onChange={(event) => setDraft((current) => ({ ...current, symbol: event.target.value || undefined }))} disabled={audit.loading} />
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            From
            <input type="date" value={draft.from ?? ''} onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value || undefined }))} disabled={audit.loading} />
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            To
            <input type="date" value={draft.to ?? ''} onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value || undefined }))} disabled={audit.loading} />
          </label>
          <div style={{ display: 'flex', gap: theme.space(2) }}>
            <button type="submit" disabled={audit.loading}>Apply</button>
            <button type="button" disabled={audit.loading} onClick={() => { setDraft({}); setQuery({}); }}>Clear</button>
          </div>
        </form>
      </Card>

      <Card title="Audit trail" description="Who did what, in order. Sensitive-looking values are redacted rather than echoed.">
        {audit.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading audit entries…</p>}
        {audit.error && <ErrorNotice title="Audit unavailable" message={audit.error} />}
        {audit.data && (
          <DataTable
            rows={rows}
            rowKey={(row) => row.id}
            emptyTitle="No audit entries"
            emptyDescription="No event matches this filter."
            columns={[
              { key: 'event', header: 'Event', render: (row) => <code style={{ fontSize: 12 }}>{row.eventType}</code> },
              { key: 'intent', header: 'Order intent', render: (row) => (row.intentId ? <code style={{ fontSize: 12 }}>{row.intentId.slice(0, 8)}</code> : '—') },
              { key: 'actor', header: 'Actor', render: (row) => row.actor ?? 'System' },
              { key: 'detail', header: 'Detail', render: (row) => summarise(row.detail) },
              { key: 'at', header: 'At', render: (row) => formatDateTime(row.createdAt) },
            ]}
          />
        )}
      </Card>
    </div>
  );
}

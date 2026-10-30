'use client';

import { useState, type JSX } from 'react';

import { exchangeAdminApi, exchangeRows, type UserStreamSession } from '@/api/exchange-admin-api';
import { Badge, Card, DataTable, EmptyState, ErrorNotice, StatTile } from '@/components/ui';
import { useResource } from '@/features/shared/use-resource';

/**
 * Operator view of the exchange user-data streams.
 *
 * The list is bounded and the per-account health read is on demand: asking the engine for every account
 * on page load is how a stream monitor becomes an outage of its own. A failed health read is shown as a
 * failure, never as a healthy stream - the whole point of the screen is to notice silence.
 */
export function UserStreamHealth({ limit = 25 }: { limit?: number }): JSX.Element {
  const streams = useResource(() => exchangeAdminApi.listUserStreams(limit), [limit], { errorMessage: 'User streams could not be loaded.' });
  const [accountId, setAccountId] = useState('');
  const [requested, setRequested] = useState('');
  const health = useResource(() => exchangeAdminApi.getUserStream(requested), [requested], {
    enabled: requested.length > 0,
    errorMessage: 'The engine did not answer for this account.',
  });

  const rows: UserStreamSession[] = exchangeRows<UserStreamSession>(streams.data);

  return (
    <Card title="User data streams">
      {streams.error && <ErrorNotice title="User streams" message={streams.error} />}
      {!streams.loading && !streams.error && rows.length === 0 && (
        <EmptyState title="No stream sessions" description="No account has an open user-data stream." />
      )}
      {rows.length > 0 && (
        <DataTable
          rows={rows}
          rowKey={(row) => `${row.accountId}-${row.venue}`}
          columns={[
            { key: 'account', header: 'Account', render: (row) => row.accountId },
            { key: 'venue', header: 'Venue', render: (row) => row.venue },
            { key: 'status', header: 'Status', render: (row) => <Badge tone={row.status === 'LIVE' ? 'success' : 'warning'}>{row.status}</Badge> },
            { key: 'last-heartbeat', header: 'Last heartbeat', render: (row) => row.lastHeartbeatAt ?? 'Never' },
            { key: 'expires', header: 'Expires', render: (row) => row.expiresAt ?? 'Not available' },
          ]}
        />
      )}

      <h3 className="mt-4 text-sm font-semibold">Stream health for one account</h3>
      <form
        className="mt-2 flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setRequested(accountId.trim());
        }}
      >
        <label className="block text-sm">
          <span className="font-medium">Exchange account</span>
          <input className="mt-1 w-full rounded border px-3 py-2" value={accountId} onChange={(event) => setAccountId(event.target.value)} />
        </label>
        <button type="submit" className="rounded border px-3 py-2 text-sm" disabled={accountId.trim().length === 0}>
          Read health
        </button>
      </form>

      {health.error && <ErrorNotice title="Stream health" message={health.error} />}
      {health.data && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StatTile label="Account" value={health.data.accountId} />
          <StatTile label="Venue" value={health.data.venue} />
          <StatTile label="Status" value={<Badge tone={health.data.status === 'LIVE' ? 'success' : 'warning'}>{health.data.status}</Badge>} hint="A stream the engine did not answer for is never shown as live." />
          <StatTile label="Last heartbeat" value={health.data.lastHeartbeatAt ?? 'Never'} />
          <StatTile label="Expires" value={health.data.expiresAt ?? 'Not available'} hint={health.data.listenKeyRef ?? 'No listen key reference reported.'} />
          <StatTile label="Reconnects" value={health.data.reconnectCount === null || health.data.reconnectCount === undefined ? 'Not available' : String(health.data.reconnectCount)} hint={health.data.lastError ?? undefined} />
        </div>
      )}
    </Card>
  );
}

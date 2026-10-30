'use client';

import { useMemo, useState, type JSX } from 'react';

import { exchangeAdminApi, exchangeRows, type UserStreamSession } from '@/api/exchange-admin-api';
import { Badge, Card, DataTable, ErrorNotice, StatTile } from '@/components/ui';
import { formatDateTime, formatRelative } from '@/lib/format';
import { theme, toneForStatus } from '@/lib/theme';
import { useResource } from '@/features/shared/use-resource';

/**
 * User data streams.
 *
 * Order state only advances when a venue's user stream is healthy, so this page
 * exists to answer one question quickly: which sessions are stale? A stream is
 * treated as stale when its heartbeat is older than the service's own expiry,
 * and the count is shown separately from the stream's self-reported status -
 * a session can claim `ACTIVE` while its heartbeat has stopped.
 *
 * There is no restart or refresh route on the controller, so none is offered.
 */
const STALE_AFTER_MS = 5 * 60 * 1000;

function heartbeatAge(row: UserStreamSession): number | null {
  if (!row.lastHeartbeatAt) return null;
  const at = Date.parse(row.lastHeartbeatAt);
  return Number.isNaN(at) ? null : Date.now() - at;
}

export function UserStreamTable(): JSX.Element {
  const [version, setVersion] = useState(0);
  const streams = useResource(() => exchangeAdminApi.listUserStreams(100), [version], { errorMessage: 'User streams could not be loaded.' });
  const [status, setStatus] = useState('');

  const rows = useMemo(() => {
    const all = exchangeRows(streams.data);
    return status ? all.filter((row) => row.status?.toUpperCase() === status) : all;
  }, [streams.data, status]);

  const stale = rows.filter((row) => {
    const age = heartbeatAge(row);
    return age === null || age > STALE_AFTER_MS;
  });

  return (
    <div style={{ display: 'grid', gap: theme.space(6) }}>
      <Card
        title="User streams"
        description="Each row is a venue session feeding order and balance updates. A stale heartbeat means order state may be behind the venue."
        actions={
          <div style={{ display: 'flex', gap: theme.space(2), alignItems: 'flex-end' }}>
            <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
              Status
              <select value={status} onChange={(event) => setStatus(event.target.value)} disabled={streams.loading}>
                <option value="">All statuses</option>
                {['ACTIVE', 'CONNECTING', 'RECONNECTING', 'STALE', 'CLOSED'].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <button type="button" disabled={streams.loading} onClick={() => setVersion((current) => current + 1)}>Refresh</button>
          </div>
        }
      >
        {streams.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading streams…</p>}
        {streams.error && <ErrorNotice title="User streams unavailable" message={streams.error} />}

        {streams.data && (
          <>
            <div style={{ display: 'flex', gap: theme.space(3), flexWrap: 'wrap', marginBottom: theme.space(4) }}>
              <StatTile label="Sessions" value={rows.length} />
              <StatTile label="Stale heartbeats" value={stale.length} hint={stale.length > 0 ? 'Order state may lag the venue' : 'All heartbeats current'} />
            </div>

            {stale.length > 0 && (
              <ErrorNotice
                title={`${stale.length} stream(s) without a recent heartbeat`}
                message="Treat order state for these accounts as unconfirmed until the stream recovers. Do not assume the exchange received nothing."
              />
            )}

            <DataTable
              rows={rows}
              rowKey={(row) => row.id || `${String(row.accountId)}-${String(row.venue)}`}
              emptyTitle={status ? 'No streams in this state' : 'No user streams'}
              emptyDescription="Streams appear once an account is connected to a venue."
              columns={[
                { key: 'account', header: 'Account', render: (row) => <code style={{ fontSize: 12 }}>{String(row.accountId).slice(0, 8)}</code> },
                { key: 'venue', header: 'Venue', render: (row) => row.venue },
                { key: 'status', header: 'Status', render: (row) => <Badge tone={toneForStatus(row.status)}>{row.status}</Badge> },
                {
                  key: 'heartbeat',
                  header: 'Heartbeat',
                  render: (row) => {
                    const age = heartbeatAge(row);
                    if (age === null) return <span style={{ color: theme.color.danger, fontSize: 13 }}>Never seen</span>;
                    return (
                      <span style={{ fontSize: 13, color: age > STALE_AFTER_MS ? theme.color.danger : undefined }}>
                        {formatRelative(row.lastHeartbeatAt)}
                      </span>
                    );
                  },
                },
                { key: 'attempts', header: 'Reconnects', align: 'right', render: (row) => (row.reconnectCount === null || row.reconnectCount === undefined ? '—' : String(row.reconnectCount)) },
                { key: 'expires', header: 'Expires', render: (row) => (row.expiresAt ? formatDateTime(row.expiresAt) : '—') },
                { key: 'error', header: 'Last error', render: (row) => (row.lastError ? <code style={{ fontSize: 12 }}>{row.lastError}</code> : '—') },
              ]}
            />
          </>
        )}
      </Card>
    </div>
  );
}

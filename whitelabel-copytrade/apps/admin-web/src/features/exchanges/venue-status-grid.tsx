'use client';

import { useState, type JSX } from 'react';

import { exchangeAdminApi, exchangeRows, type VenueStatus } from '@/api/exchange-admin-api';
import { Badge, Card, DataTable, EmptyState, ErrorNotice } from '@/components/ui';
import { useResource } from '@/features/shared/use-resource';

/**
 * The venue board: what each venue reports, where that report came from, and whether an operator
 * override is currently deciding the answer.
 *
 * `source` is the important column. OVERRIDE means a person decided this; FEED means the venue told us;
 * ACCOUNT_HEALTH means it was inferred from accounts and is therefore a reading about our connections,
 * not about the venue; NONE means nothing is known. Collapsing those into one coloured dot would let an
 * inference be read as an announcement.
 */
const stateTone = (state: string): 'success' | 'warning' | 'danger' | 'neutral' => {
  switch (state.toUpperCase()) {
    case 'OPERATIONAL':
    case 'HEALTHY':
      return 'success';
    case 'DEGRADED':
    case 'MAINTENANCE':
      return 'warning';
    case 'OUTAGE':
    case 'DOWN':
      return 'danger';
    default:
      return 'neutral';
  }
};

export function VenueStatusGrid(): JSX.Element {
  const [filter, setFilter] = useState('');
  const venues = useResource(() => exchangeAdminApi.listVenueStatus(filter ? filter.split(',').map((value) => value.trim().toUpperCase()).filter(Boolean) : undefined), [filter], {
    errorMessage: 'Venue status could not be loaded.',
  });

  const rows: VenueStatus[] = exchangeRows<VenueStatus>(venues.data);

  return (
    <Card title="Venue status">
      <label className="block max-w-sm text-sm">
        <span className="font-medium">Venues (comma separated, empty for all)</span>
        <input
          className="mt-1 w-full rounded border px-3 py-2"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="BINANCE,COINBASE"
        />
      </label>

      {venues.error && <ErrorNotice title="Venue status" message={venues.error} />}
      {venues.loading && <p className="mt-2 text-sm text-muted">Loading venue status…</p>}
      {!venues.loading && !venues.error && rows.length === 0 && (
        <EmptyState title="No venue status" description="No venue is registered, or none has reported a status." />
      )}

      {rows.length > 0 && (
        <div className="mt-3">
          <DataTable
            rows={rows}
            rowKey={(row) => row.venue}
            columns={[
              { key: 'venue', header: 'Venue', render: (row) => row.venue },
              { key: 'status', header: 'Status', render: (row) => <Badge tone={stateTone(row.status)}>{row.status}</Badge> },
              { key: 'reason', header: 'Reason', render: (row) => row.reason ?? 'Not reported' },
              { key: 'override', header: 'Override until', render: (row) => row.overrideUntil ?? 'No override' },
              { key: 'overridden-by', header: 'Overridden by', render: (row) => row.overriddenBy ?? '—' },
              { key: 'updated-at', header: 'Updated at', render: (row) => row.updatedAt ?? 'Never' },
            ]}
          />
        </div>
      )}

      <p className="mt-2 text-xs text-muted">
        An override is a decision by an operator and carries the reason it was set; without one, the status is
        whatever the venue or the account-health feed last reported. This panel never infers a status.
      </p>
    </Card>
  );
}

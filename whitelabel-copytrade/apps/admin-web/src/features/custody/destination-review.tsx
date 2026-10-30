'use client';

import { useMemo, useState, type JSX } from 'react';

import { custodyAdminApi, type DestinationAuditView } from '@/api/custody-admin-api';
import { Badge, Card, DataTable, EmptyState, ErrorNotice } from '@/components/ui';
import { formatDateTime, formatRelative } from '@/lib/format';
import { theme, toneForStatus } from '@/lib/theme';

import { formatDuration } from '@/features/shared/money';
import { useResource } from '@/features/shared/use-resource';

/**
 * Read-only view of where a customer's funds are allowed to go.
 *
 * The API is GET-only on purpose: an operator who could add, activate or delete
 * a destination for a customer would defeat the cooldown that exists to stop a
 * stolen session redirecting funds. So there is no approve or revoke button
 * here, and this component does not pretend otherwise - it shows the state, the
 * remaining cooldown and the owner of each destination so support can answer
 * the question without being able to change the answer.
 */
export function DestinationReview(): JSX.Element {
  const [filter, setFilter] = useState<'ALL' | 'PENDING' | 'ACTIVE' | 'REVOKED'>('ALL');
  const destinations = useResource(
    () => custodyAdminApi.listDestinations({ limit: 200 }),
    [],
    { errorMessage: 'Withdrawal destinations could not be loaded.' },
  );

  const rows = useMemo(() => {
    const all = destinations.data?.data ?? [];
    if (filter === 'ALL') return all;
    return all.filter((row) => row.status.toUpperCase() === filter);
  }, [destinations.data, filter]);

  const cooling = (destinations.data?.data ?? []).filter((row) => row.remainingCooldownMs > 0);

  return (
    <div style={{ display: 'grid', gap: theme.space(6) }}>
      <Card
        title="Destinations"
        description="Read-only. Activating or removing a destination is the customer&apos;s own action after the cooldown; operators cannot override it."
        actions={
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Status
            <select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} disabled={destinations.loading}>
              <option value="ALL">All statuses</option>
              <option value="PENDING">Pending cooldown</option>
              <option value="ACTIVE">Active</option>
              <option value="REVOKED">Revoked</option>
            </select>
          </label>
        }
      >
        {destinations.loading && <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading destinations…</p>}
        {destinations.error && <ErrorNotice title="Destinations unavailable" message={destinations.error} />}

        {destinations.data && cooling.length > 0 && (
          <p role="status" aria-live="polite" style={{ marginTop: 0, fontSize: 13, color: theme.color.warning }}>
            {cooling.length} destination{cooling.length === 1 ? ' is' : 's are'} still inside the security cooldown and cannot receive funds yet.
          </p>
        )}

        <DestinationTable rows={rows} filter={filter} loading={destinations.loading} error={destinations.error} />
      </Card>

      <Card title="Why there is no override here" description="The control this page describes, stated plainly so it is not mistaken for a missing feature.">
        <ul style={{ margin: 0, paddingLeft: theme.space(5), fontSize: 13, color: theme.color.textMuted, display: 'grid', gap: theme.space(2) }}>
          <li>A destination only becomes active after the customer&apos;s own cooldown elapses, so a stolen session cannot redirect a withdrawal immediately.</li>
          <li>Operators can read every destination for the organisation, which is what a support call needs.</li>
          <li>No console action can activate, edit or delete a destination, so there is nothing to persuade an operator to do.</li>
          <li>Each destination records the policy decisions the API returned with it; that list is empty until the audit join ships.</li>
        </ul>
      </Card>
    </div>
  );
}

function DestinationLabel({ row }: { row: DestinationAuditView }): JSX.Element {
  return (
    <span>
      <span style={{ fontWeight: 600 }}>{row.label || 'Untitled destination'}</span>
      {row.revokedAt && (
        <span style={{ display: 'block', fontSize: 12, color: theme.color.textMuted }}>Revoked {formatDateTime(row.revokedAt)}</span>
      )}
    </span>
  );
}

/** Long addresses are truncated in the middle so the head and tail stay checkable. */
function shortenAddress(address: string): string {
  if (address.length <= 20) return address;
  return `${address.slice(0, 10)}…${address.slice(-8)}`;
}

/**
 * Pure view of the destination list. `loading`, `error` and the filtered empty
 * state are separate returns so the tests can assert each one; the container
 * above only decides which data to pass in.
 */
export function DestinationTable({
  rows,
  filter,
  loading,
  error,
}: {
  rows: DestinationAuditView[];
  filter: 'ALL' | 'PENDING' | 'ACTIVE' | 'REVOKED';
  loading: boolean;
  error: string | null;
}): JSX.Element {
  if (loading) {
    return <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading destinations…</p>;
  }
  if (error) {
    return <ErrorNotice title="Destinations unavailable" message={error} />;
  }
  return (
    <DataTable
      rows={rows}
      rowKey={(row) => row.id}
      emptyTitle={filter === 'ALL' ? 'No withdrawal destinations' : 'No destinations with this status'}
      emptyDescription="A destination appears here once the customer adds one; it stays in the cooldown column until the wait is over."
      columns={[
        { key: 'label', header: 'Label', render: (row) => <DestinationLabel row={row} /> },
        { key: 'address', header: 'Address', render: (row) => <code style={{ fontSize: 12, wordBreak: 'break-all' }}>{shortenAddress(row.address)}</code> },
        { key: 'network', header: 'Network', render: (row) => row.network },
        { key: 'user', header: 'Owner', render: (row) => <code style={{ fontSize: 12 }}>{row.userId.slice(0, 8)}</code> },
        { key: 'status', header: 'Status', render: (row) => <Badge tone={toneForStatus(row.status)}>{row.status}</Badge> },
        { key: 'cooldown', header: 'Cooldown', render: (row) => (row.remainingCooldownMs > 0 ? formatDuration(row.remainingCooldownMs) : 'Complete') },
        { key: 'activates', header: 'Activates', render: (row) => formatDateTime(row.activatesAt) },
        { key: 'created', header: 'Added', render: (row) => `${formatDateTime(row.createdAt)} (${formatRelative(row.createdAt)})` },
      ]}
    />
  );
}

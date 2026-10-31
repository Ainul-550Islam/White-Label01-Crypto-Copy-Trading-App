// # Responsibility: the operator console for exchange-key capability health — a filterable, paged table of every key in the tenant with its read/trade/withdraw posture, what needs a human, and an explicit statement that the summary covers only the rows shown.
'use client';

import { useState, type JSX } from 'react';

import {
  exchangeKeyHealthAdminApi,
  KEY_ACTION_COPY,
  toneForOverall,
  type CapabilityRow,
  type ExchangeKeyHealthRow,
  type KeyHealthQuery,
} from '@/api/exchange-key-health-admin-api';
import { Badge, Card, DataTable, EmptyState, ErrorNotice, StatTile } from '@/components/ui';
import { formatDateTime, formatRelative } from '@/lib/format';
import { theme } from '@/lib/theme';
import { useResource } from '@/features/shared/use-resource';

/**
 * Exchange-key health.
 *
 * Read-only by design: rotating, revoking or re-verifying a key is an existing,
 * separately step-up-gated exchange-account action, and this screen links to none
 * of them implicitly - it names the action a human must take and leaves the
 * operator to take it where the audit trail records it.
 *
 * Two reading rules are baked into the layout:
 *
 *  * a key whose permissions were never verified is UNKNOWN, not healthy. The badge
 *    tones treat UNKNOWN as a warning for exactly that reason;
 *  * the summary tiles count only the rows this page evaluated, and the card says
 *    so whenever the page is smaller than the tenant's total. A count over a
 *    truncated page presented as a tenant figure is how an operator concludes a
 *    tenant is healthy when half its keys were never read.
 */
const VENUES = ['BINANCE', 'BYBIT', 'OKX', 'KRAKEN', 'COINBASE', 'OTHER_CONFIGURED'] as const;
const ACCOUNT_STATES = ['PENDING', 'ACTIVE', 'DISABLED', 'REVOKED', 'ERROR'] as const;

function capabilitySummary(row: ExchangeKeyHealthRow, kind: CapabilityRow['capability']): string {
  const capability = row.capabilities.find((entry) => entry.capability === kind);
  if (!capability) return 'Not reported';
  return capability.granted ? 'Granted' : 'Not granted';
}

export function ExchangeKeyHealthConsole(): JSX.Element {
  const [venue, setVenue] = useState('');
  const [status, setStatus] = useState('');
  const [limit, setLimit] = useState(50);

  const query: KeyHealthQuery = {
    venue: venue === '' ? undefined : venue,
    status: status === '' ? undefined : status,
    limit,
  };
  const health = useResource(() => exchangeKeyHealthAdminApi.list(query), [venue, status, limit], {
    errorMessage: 'Exchange key health could not be loaded.',
  });

  const rows: ExchangeKeyHealthRow[] = health.data?.data ?? [];
  const total = health.data?.total ?? 0;
  const evaluated = health.data?.evaluated ?? rows.length;
  const summary = health.data?.summary;
  const pageIsPartial = total > evaluated;

  return (
    <div style={{ display: 'grid', gap: theme.space(4) }}>
      <Card
        title="Key capability health"
        description="Each key is evaluated from its stored verification and health evidence. A key whose permissions were never verified is reported as unknown, not as healthy."
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: theme.space(3), marginBottom: theme.space(4) }}>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Venue
            <select value={venue} onChange={(event) => setVenue(event.target.value)}>
              <option value="">All venues</option>
              {VENUES.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Account state
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All states</option>
              {ACCOUNT_STATES.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
          <label style={{ display: 'grid', gap: theme.space(1), fontSize: 13 }}>
            Rows
            <select value={limit} onChange={(event) => setLimit(Number.parseInt(event.target.value, 10))}>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </label>
          <button type="button" onClick={() => health.reload()} disabled={health.loading}>Reload</button>
        </div>

        {health.loading && (
          <p role="status" aria-live="polite" style={{ color: theme.color.textMuted }}>Loading key health…</p>
        )}
        {health.error && <ErrorNotice title="Key health unavailable" message={health.error} />}
        {!health.loading && !health.error && rows.length === 0 && (
          <EmptyState
            title="No exchange keys match"
            description="No account in this tenant matches the filters. A tenant with no keys has nothing to evaluate."
          />
        )}

        {summary && rows.length > 0 && (
          <>
            {pageIsPartial && (
              <p style={{ margin: '0 0 12px', fontSize: 13, color: theme.color.textMuted }}>
                Showing {evaluated} of {total} key(s). These counts describe the rows on this page, not the whole tenant.
              </p>
            )}
            <div style={{ display: 'grid', gap: theme.space(3), gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
              <StatTile label="Healthy" value={String(summary.healthy)} />
              <StatTile label="Degraded" value={String(summary.degraded)} />
              <StatTile label="At risk" value={String(summary.risk)} hint="A key that can withdraw is at risk even if it works." />
              <StatTile label="Unhealthy" value={String(summary.unhealthy)} />
              <StatTile label="Unknown" value={String(summary.unknown)} hint="Never verified. Not evidence of health." />
              <StatTile label="Need action" value={String(summary.requiresAction)} />
            </div>
          </>
        )}
      </Card>

      {rows.length > 0 && (
        <Card title="Keys" description="One row per account. Key material is never returned by the API; only the last four characters of the API key are shown.">
          <DataTable
            rows={rows}
            rowKey={(row) => row.accountId}
            columns={[
              { key: 'label', header: 'Account', render: (row) => row.label || row.accountId },
              { key: 'venue', header: 'Venue', render: (row) => `${row.venue} · ${row.environment}` },
              { key: 'suffix', header: 'Key ending', render: (row) => (row.apiKeyLastFour ? `…${row.apiKeyLastFour}` : 'Not recorded') },
              { key: 'read', header: 'Read', render: (row) => capabilitySummary(row, 'READ') },
              { key: 'trade', header: 'Trade', render: (row) => capabilitySummary(row, 'TRADE') },
              {
                key: 'withdraw',
                header: 'Withdraw',
                render: (row) => {
                  const capability = row.capabilities.find((entry) => entry.capability === 'WITHDRAW');
                  if (!capability) return 'Not reported';
                  return capability.state === 'RISK' ? <Badge tone="danger">Enabled</Badge> : 'Not granted';
                },
              },
              {
                key: 'overall',
                header: 'Overall',
                render: (row) => <Badge tone={toneForOverall(row.overall)}>{row.overall}</Badge>,
              },
              {
                key: 'verified',
                header: 'Last verified',
                render: (row) => (row.verifiedAt ? `${formatDateTime(row.verifiedAt)} (${formatRelative(row.verifiedAt)})` : 'Never'),
              },
              {
                key: 'actions',
                header: 'Needs a human',
                render: (row) =>
                  row.requiresAction.length === 0
                    ? 'Nothing'
                    : row.requiresAction.map((action) => KEY_ACTION_COPY[action] ?? action).join(' '),
              },
            ]}
          />
        </Card>
      )}
    </div>
  );
}

import type { Metadata } from 'next';

import { Badge, Card, DataTable, ErrorNotice, PageHeader, StatTile } from '@/components/ui';
import { ApiError } from '@/lib/api-error';
import { formatDateTime, formatRelative, titleCase } from '@/lib/format';
import { serverFetch } from '@/lib/server-api';
import { theme } from '@/lib/theme';

import { RiskSwitchControls, RiskSwitchRowActions } from './switch-controls';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Risk' };

/**
 * The risk console (Part 8) - the posture screen, plus the two controls that
 * belong on ANY screen: pulling a stop, and (with ceremony) clearing one.
 *
 * What this page is, precisely: a viewer of the mirrored risk state plus a
 * thin front-end for the API's kill-switch lifecycle. Every figure shown is
 * the latest SYNCED snapshot metadata, timestamped as such - the console
 * never claims a live venue read, because it never performs one. The panel
 * labelled "stale" is honest about staleness, and the whole page says the
 * sentence the docs say: risk controls reduce operational risk but cannot
 * guarantee against all losses.
 *
 * What this page is NOT: an order surface. There is no order queue here, no
 * approve/reject button, no "submit anyway", and no config editor. Limit
 * revisions are a CLI/API act with a typed confirmation and a reason; a
 * form on a status dashboard is how limits get "quickly bumped" at 3am by
 * whoever has the page open. Switches are different: pulling one is the one
 * action that can never make the system more dangerous, which is exactly
 * why the ENGAGE control sits here and the CLEAR control carries a typed
 * phrase and a prior acknowledgement.
 *
 * Panel-level degradation, same rule as datasets: one failed fetch disables
 * one card, not the page.
 */

interface RiskStatus {
  engineEnabled: boolean;
  failClosed: boolean;
  maxRiskStateAgeMs: number;
  snapshotRefreshMs: number;
  refreshOutpacesStaleness: boolean;
  platformCeilings: Record<string, string | number>;
  engagedSwitchCount: number;
  triggeredProtectionCount: number;
  latestSnapshotPerAccount: Array<{
    id: string;
    accountId: string;
    snapshotVersion: string;
    capturedAt: string;
    equity: string | null;
    accountGrossNotional: string | null;
    netDailyPnl: string | null;
    openOrderCount: number | null;
    staleSources: string[];
    isComplete: boolean;
    isSimulated: boolean;
  }>;
  staleAccounts: string[];
  eventsLast24hBySeverity: Record<string, number>;
  note: string;
}

interface RiskSwitchRow {
  id: string;
  scope: string;
  target: string | null;
  isEngaged: boolean;
  status: string;
  reason: string | null;
  triggeredByRule: string | null;
  severity: string | null;
  requiresExplicitClear: boolean;
  engagedAt: string | null;
  acknowledgedAt: string | null;
  clearedAt: string | null;
  updatedAt: string;
}

interface RiskEventRow {
  id: string;
  createdAt: string;
  eventType: string;
  severity: string;
  message: string;
  ruleId: string | null;
  scope: string | null;
  accountId: string | null;
  isSimulated: boolean;
}

interface AccountRow {
  id: string;
  label: string;
  venue: string;
  status: string;
  tradingMode: string;
  isSandbox: boolean;
}

async function loadConsole(): Promise<{
  status: RiskStatus | null;
  switches: RiskSwitchRow[];
  events: RiskEventRow[];
  accounts: AccountRow[];
  failures: string[];
}> {
  const failures: string[] = [];
  const track = async <T,>(label: string, promise: Promise<T>): Promise<T | null> => {
    try {
      return await promise;
    } catch (error) {
      failures.push(`${label}: ${(error as Error).message}`);
      return null;
    }
  };

  const [status, switches, eventsPage, accountsPage] = await Promise.all([
    track('risk status', serverFetch<RiskStatus>('/risk/status')),
    track('kill switches', serverFetch<RiskSwitchRow[]>('/risk/kill-switches')),
    track('risk events', serverFetch<{ items: RiskEventRow[] }>('/risk/events', {
      searchParams: { limit: 25, sortOrder: 'desc', sortBy: 'createdAt' },
    })),
    track(
      'trading accounts',
      serverFetch<{ items: AccountRow[] }>('/execution/accounts', { searchParams: { limit: 50 } }),
    ),
  ]);

  if (status && !status.refreshOutpacesStaleness) {
    // Not a fetch failure - a configuration fault the page must make loud.
    failures.push(
      'deployment misconfiguration: snapshot refresh cadence does not outpace the staleness budget',
    );
  }

  return {
    status,
    switches: switches ?? [],
    events: eventsPage?.items ?? [],
    accounts: accountsPage?.items ?? [],
    failures,
  };
}

const severityTone: Record<string, 'danger' | 'warning' | 'info' | 'neutral'> = {
  CRITICAL: 'danger',
  HIGH: 'danger',
  MEDIUM: 'warning',
  LOW: 'info',
  INFO: 'neutral',
};

function switchTone(row: RiskSwitchRow): 'danger' | 'warning' | 'neutral' {
  if (!row.isEngaged) {
    return 'neutral';
  }
  if (row.status === 'TRIGGERED') {
    return 'danger';
  }
  if (row.status === 'ACKNOWLEDGED') {
    return 'warning';
  }
  return 'warning';
}

export default async function RiskPage(): Promise<JSX.Element> {
  const { status, switches, events, accounts, failures } = await loadConsole();
  const engaged = switches.filter((row) => row.isEngaged);
  const triggered = engaged.filter((row) => row.requiresExplicitClear);
  const staleAccounts = status?.staleAccounts ?? [];
  const severityCounts = status?.eventsLast24hBySeverity ?? {};

  return (
    <>
      <PageHeader
        title="Risk"
        description="Kill switches, mirrored risk state, and the deployment's own safety envelope. Figures are the latest synced snapshot metadata - timestamped, never a live venue read."
      />

      <div style={{ marginTop: theme.space(5) }}>
        <Card
          title="Read this first"
          description="What this screen can and cannot promise."
        >
          <p style={{ color: theme.color.textMuted, fontSize: 13, margin: 0 }}>
            {status?.note ??
              'Risk controls reduce operational risk but cannot guarantee against all losses.'}{' '}
            Engaging a switch here stops new risk from being taken once the engine syncs; the
            durable row is the safety, and the engine fail-closes if it cannot see the risk
            state at all. Clearing a switch that automatic protection triggered requires an
            acknowledgement and a typed confirmation, and neither is bypassable from this
            page - if the UI ever seems to offer a one-click clear, that is a bug worth
            reporting immediately.
          </p>
        </Card>
      </div>

      {failures.length > 0 && (
        <div style={{ marginTop: theme.space(5) }}>
          <ErrorNotice title="Some panels could not be loaded" message={failures.join(' · ')} />
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: theme.space(4),
          marginTop: theme.space(6),
        }}
      >
        <StatTile
          label="Risk engine"
          value={status ? (status.engineEnabled ? 'ON' : 'OFF') : '—'}
          hint={
            status
              ? status.engineEnabled
                ? 'full rule catalog in the order path'
                : 'local tooling mode; a production deployment must boot ON'
              : 'status unavailable'
          }
        />
        <StatTile
          label="Fail-closed"
          value={status ? (status.failClosed ? 'forced' : '?') : '—'}
          hint="RISK_FAIL_CLOSED has exactly one legal value: true"
        />
        <StatTile
          label="Engaged switches"
          value={engaged.length}
          hint={`${triggered.length} triggered by automatic protection`}
        />
        <StatTile
          label="Stale mirrors"
          value={staleAccounts.length}
          hint="accounts whose snapshot mirror exceeds 2× the refresh cadence"
        />
        <StatTile
          label="Events (24h)"
          value={Object.values(severityCounts).reduce((sum, n) => sum + n, 0)}
          hint={
            [
              severityCounts.CRITICAL ? `${severityCounts.CRITICAL} critical` : null,
              severityCounts.HIGH ? `${severityCounts.HIGH} high` : null,
            ]
              .filter(Boolean)
              .join(', ') || 'no severe events'
          }
        />
      </div>

      <div style={{ display: 'grid', gap: theme.space(5), marginTop: theme.space(6) }}>
        <Card
          title="Kill switches"
          description="The engine reads these rows; a switch engaged here halts the scope, a triggered switch stays down until an operator acknowledges and clears it."
          actions={
            <RiskSwitchControls
              accounts={accounts.map((account) => ({ id: account.id, label: account.label }))}
            />
          }
        >
          <DataTable
            rows={switches}
            rowKey={(row) => row.id}
            emptyTitle="No switches engaged or recorded"
            emptyDescription="Nothing is halted. The absence of rows is health here, not missing data."
            columns={[
              { key: 'scope', header: 'Scope', render: (row) => <Badge>{row.scope}</Badge> },
              {
                key: 'target',
                header: 'Target',
                render: (row) => <code style={{ fontSize: 12 }}>{row.target ?? '—'}</code>,
              },
              {
                key: 'status',
                header: 'Status',
                render: (row) => (
                  <Badge tone={switchTone(row)}>
                    {titleCase(row.status.toLowerCase())}
                    {row.requiresExplicitClear ? ' · explicit-clear' : ''}
                  </Badge>
                ),
              },
              {
                key: 'rule',
                header: 'Triggered by',
                render: (row) => row.triggeredByRule ?? 'manual',
              },
              {
                key: 'reason',
                header: 'Reason',
                render: (row) => (
                  <span style={{ color: theme.color.textMuted, fontSize: 12 }}>
                    {row.reason ?? '—'}
                  </span>
                ),
              },
              {
                key: 'engaged',
                header: 'Engaged',
                render: (row) => (row.engagedAt ? formatRelative(row.engagedAt) : '—'),
              },
              {
                key: 'acknowledged',
                header: 'Acknowledged',
                render: (row) => (row.acknowledgedAt ? formatRelative(row.acknowledgedAt) : '—'),
              },
              {
                key: 'actions',
                header: '',
                align: 'right',
                render: (row) => <RiskSwitchRowActions row={row} />,
              },
            ]}
          />
        </Card>

        <Card
          title="Mirror freshness by account"
          description="Latest synced snapshot metadata. A missing or stale row means the engine will deny orders for lack of trustworthy state - that is the fail-closed design, not an outage of this page."
        >
          <DataTable
            rows={status?.latestSnapshotPerAccount ?? []}
            rowKey={(row) => row.id}
            emptyTitle="No snapshot mirrors yet"
            emptyDescription="Every account shows as stale until the risk-state worker has synced at least once."
            columns={[
              {
                key: 'account',
                header: 'Account',
                render: (row) => (
                  <code style={{ fontSize: 12 }}>
                    {accounts.find((account) => account.id === row.accountId)?.label ??
                      row.accountId.slice(0, 8)}
                  </code>
                ),
              },
              { key: 'version', header: 'Snapshot', render: (row) => row.snapshotVersion },
              {
                key: 'captured',
                header: 'Captured',
                render: (row) => (
                  <span
                    title={formatDateTime(row.capturedAt)}
                    style={{
                      color: staleAccounts.includes(row.accountId)
                        ? 'var(--wlct-color-danger)'
                        : undefined,
                    }}
                  >
                    {formatRelative(row.capturedAt)}
                    {staleAccounts.includes(row.accountId) ? ' · STALE' : ''}
                  </span>
                ),
              },
              {
                key: 'equity',
                header: 'Equity',
                align: 'right',
                render: (row) => row.equity ?? '—',
              },
              {
                key: 'gross',
                header: 'Gross notional',
                align: 'right',
                render: (row) => row.accountGrossNotional ?? '—',
              },
              {
                key: 'pnl',
                header: 'Net day PnL',
                align: 'right',
                render: (row) => row.netDailyPnl ?? '—',
              },
              {
                key: 'open',
                header: 'Open orders',
                align: 'right',
                render: (row) => row.openOrderCount ?? '—',
              },
              {
                key: 'sim',
                header: 'Source',
                render: (row) =>
                  row.isSimulated ? <Badge tone="info">simulated</Badge> : <Badge>live mirror</Badge>,
              },
            ]}
          />
        </Card>

        <Card
          title="Platform ceilings (deployment envelope)"
          description="GLOBAL-scope API writes above these values are refused outright; child scopes can only tighten below them."
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
              gap: theme.space(3),
            }}
          >
            {Object.entries(status?.platformCeilings ?? {}).map(([key, value]) => (
              <div
                key={key}
                style={{
                  border: `1px solid ${theme.color.border}`,
                  borderRadius: theme.radius.md,
                  padding: theme.space(3),
                }}
              >
                <div style={{ fontSize: 11, color: theme.color.textMuted }}>{key}</div>
                <div style={{ fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>
                  {String(value)}
                </div>
              </div>
            ))}
            {!status && (
              <p style={{ color: theme.color.textMuted, margin: 0 }}>
                Ceilings unavailable while the status panel fails to load.
              </p>
            )}
          </div>
        </Card>

        <Card
          title="Recent risk events"
          description="Decisions the engine recorded: breaches, refusals, protection actions, sync faults. Simulated rows (paper/backtest) are labelled and never counted as live."
        >
          <DataTable
            rows={events}
            rowKey={(row) => row.id}
            emptyTitle="No risk events recorded"
            columns={[
              {
                key: 'when',
                header: 'When',
                render: (row) => (
                  <span title={formatDateTime(row.createdAt)}>{formatRelative(row.createdAt)}</span>
                ),
              },
              {
                key: 'severity',
                header: 'Severity',
                render: (row) => (
                  <Badge tone={severityTone[row.severity] ?? 'neutral'}>{row.severity}</Badge>
                ),
              },
              { key: 'type', header: 'Event', render: (row) => titleCase(row.eventType.toLowerCase()) },
              {
                key: 'rule',
                header: 'Rule / scope',
                render: (row) => (
                  <span style={{ fontSize: 12 }}>
                    {row.ruleId ?? '—'}
                    {row.scope ? ` · ${row.scope}` : ''}
                  </span>
                ),
              },
              {
                key: 'message',
                header: 'Detail',
                render: (row) => (
                  <span style={{ color: theme.color.textMuted, fontSize: 12 }}>
                    {row.message.slice(0, 140)}
                    {row.isSimulated ? ' · simulated' : ''}
                  </span>
                ),
              },
            ]}
          />
        </Card>

        <Card
          title="Trading accounts"
          description="IDs needed as switch targets. Live-armed accounts behave exactly like paper ones here: the risk gate is identical, and it is the reason this page can speak about both."
        >
          <DataTable
            rows={accounts}
            rowKey={(row) => row.id}
            emptyTitle="No trading accounts"
            columns={[
              { key: 'label', header: 'Label', render: (row) => row.label },
              { key: 'venue', header: 'Venue', render: (row) => row.venue },
              {
                key: 'mode',
                header: 'Mode',
                render: (row) => (
                  <Badge tone={row.tradingMode === 'LIVE' && !row.isSandbox ? 'danger' : 'info'}>
                    {row.tradingMode}
                    {row.isSandbox ? ' · sandbox' : ''}
                  </Badge>
                ),
              },
              { key: 'status', header: 'Status', render: (row) => titleCase(row.status.toLowerCase()) },
              {
                key: 'id',
                header: 'Account id (switch target)',
                render: (row) => <code style={{ fontSize: 12 }}>{row.id}</code>,
              },
            ]}
          />
        </Card>
      </div>
    </>
  );
}

import type { Metadata } from 'next';

import { Badge, Card, DataTable, ErrorNotice, PageHeader, StatTile } from '@/components/ui';
import { ApiError } from '@/lib/api-error';
import { formatDateTime, formatRelative, titleCase } from '@/lib/format';
import { serverFetch } from '@/lib/server-api';
import { theme, toneForStatus } from '@/lib/theme';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Strategies' };

/**
 * Read-mostly strategy console.
 *
 * Deliberately read-only in this increment. Starting a strategy is a POST that
 * requires a written reason, a runnable published version, and - under a
 * live-armed deployment - a typed confirmation phrase. A one-click toggle on a
 * dashboard is the wrong shape for that, and shipping the toggle before the
 * confirmation flow is how a "quick test" becomes a running strategy.
 *
 * Every panel is fetched independently: a failure degrades one panel rather
 * than the page, because the moment an operator most needs this screen is the
 * moment something is already broken.
 */

interface StrategyMetrics {
  instances: {
    total: number;
    enabled: number;
    running: number;
    quarantined: number;
    unhealthy: number;
  };
  incidents: { open: number; critical: number; warning: number; info: number };
  runs: { active: number; failedLast24h: number };
  backtests: {
    queued: number;
    running: number;
    completedLast24h: number;
    failedLast24h: number;
  };
  paperSessions: { running: number; stoppedLast24h: number };
  configuration: {
    strategyEngineEnabled: boolean;
    paperTradingEnabled: boolean;
    backtestEnabled: boolean;
    maxInstances: number;
    eventQueueSize: number;
    maxProcessingLatencyMs: number;
    signalMaxAgeMs: number;
    signalDedupTtlSeconds: number;
    tradingMode: string;
    liveExecutionReachable: boolean;
  };
  latencyNote: string;
  disclaimer: string;
}

interface StrategyInstance {
  id: string;
  name: string;
  kind: string;
  version: string;
  status: string;
  enabled: boolean;
  health: string;
  venue: string;
  symbols: string[];
  consecutiveErrors: number;
  lastHeartbeatAt: string | null;
  lastErrorCode: string | null;
  quarantinedAt: string | null;
}

interface BacktestRun {
  id: string;
  runIdentifier: string;
  status: string;
  strategyKey: string;
  strategyVersion: string;
  symbol: string;
  result: {
    netPnl: string | null;
    totalTrades: number;
    winRate: string | null;
    sharpeRatio: string | null;
    maxDrawdown: string | null;
    hasSufficientObservations: boolean;
  };
  isReproducible: boolean;
  queuedAt: string;
  completedAt: string | null;
}

interface PaperSession {
  id: string;
  sessionIdentifier: string;
  status: string;
  strategyKey: string;
  symbol: string;
  currentEquity: string | null;
  realisedPnl: string;
  simulatedOrders: number;
  simulatedFills: number;
  riskRejections: number;
  startedAt: string;
}

interface StrategyIncident {
  id: string;
  incidentType: string;
  severity: string;
  symbol: string | null;
  errorCode: string | null;
  summary: string;
  createdAt: string;
  resolvedAt: string | null;
}

interface Paginated<T> {
  items: T[];
  pagination: { totalItems: number };
}

interface ConsoleData {
  metrics: StrategyMetrics | null;
  instances: StrategyInstance[];
  backtests: BacktestRun[];
  sessions: PaperSession[];
  incidents: StrategyIncident[];
  failures: string[];
}

async function loadConsole(): Promise<ConsoleData> {
  const failures: string[] = [];

  const describe = (label: string) => (error: unknown) => {
    failures.push(error instanceof ApiError ? `${label}: ${error.message}` : `${label} unavailable`);
    return null;
  };

  const [metrics, instances, backtests, sessions, incidents] = await Promise.all([
    serverFetch<StrategyMetrics>('/strategies/metrics').catch(describe('Metrics')),
    serverFetch<Paginated<StrategyInstance>>('/strategies/instances', {
      searchParams: { page: 1, limit: 20 },
    }).catch(describe('Instances')),
    serverFetch<Paginated<BacktestRun>>('/strategies/backtests', {
      searchParams: { page: 1, limit: 10 },
    }).catch(describe('Backtests')),
    serverFetch<Paginated<PaperSession>>('/strategies/paper-sessions', {
      searchParams: { page: 1, limit: 10 },
    }).catch(describe('Paper sessions')),
    serverFetch<Paginated<StrategyIncident>>('/strategies/incidents', {
      searchParams: { page: 1, limit: 10, unresolvedOnly: true },
    }).catch(describe('Incidents')),
  ]);

  return {
    metrics,
    instances: instances?.items ?? [],
    backtests: backtests?.items ?? [],
    sessions: sessions?.items ?? [],
    incidents: incidents?.items ?? [],
    failures,
  };
}

function healthTone(health: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  switch (health) {
    case 'HEALTHY':
      return 'success';
    case 'DEGRADED':
      return 'warning';
    case 'UNHEALTHY':
    case 'QUARANTINED':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** A metric that was withheld reads as "insufficient data", never as zero. */
function metricOrWithheld(value: string | null, sufficient: boolean): string {
  if (value !== null) {
    return value;
  }
  return sufficient ? '—' : 'insufficient data';
}

export default async function StrategiesPage(): Promise<JSX.Element> {
  const { metrics, instances, backtests, sessions, incidents, failures } = await loadConsole();
  const config = metrics?.configuration;

  return (
    <>
      <PageHeader
        title="Strategies"
        description="Strategy instances, simulated results and incidents for this organisation."
      />

      {failures.length > 0 && (
        <div style={{ marginTop: theme.space(5) }}>
          <ErrorNotice title="Some panels could not be loaded" message={failures.join(' · ')} />
        </div>
      )}

      {/* The single most misread fact on this page, stated before anything
          else: whether a signal from these strategies could become a real
          order in this deployment. */}
      <div style={{ marginTop: theme.space(5) }}>
        <Card
          title="Execution boundary"
          description="What the strategy layer is currently permitted to reach."
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: theme.space(2) }}>
            <Badge tone={config?.strategyEngineEnabled ? 'success' : 'neutral'}>
              Engine {config?.strategyEngineEnabled ? 'enabled' : 'disabled'}
            </Badge>
            <Badge tone={config?.paperTradingEnabled ? 'info' : 'neutral'}>
              Paper trading {config?.paperTradingEnabled ? 'enabled' : 'disabled'}
            </Badge>
            <Badge tone={config?.backtestEnabled ? 'info' : 'neutral'}>
              Backtesting {config?.backtestEnabled ? 'enabled' : 'disabled'}
            </Badge>
            <Badge tone={config?.liveExecutionReachable ? 'danger' : 'success'}>
              {config?.liveExecutionReachable
                ? 'LIVE EXECUTION REACHABLE'
                : 'Live execution not reachable'}
            </Badge>
            <Badge tone="neutral">Trading mode {config?.tradingMode ?? 'unknown'}</Badge>
          </div>
          <p style={{ color: theme.color.textMuted, fontSize: 13, marginTop: theme.space(4) }}>
            Enabling a strategy makes it emit signals. Whether a signal becomes an order is decided
            afterwards by the risk engine and the execution gates, and no strategy setting changes
            that.
          </p>
          {metrics && (
            <p style={{ color: theme.color.textMuted, fontSize: 13, margin: 0 }}>
              {metrics.latencyNote}
            </p>
          )}
        </Card>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: theme.space(4),
          marginTop: theme.space(6),
        }}
      >
        <StatTile
          label="Instances"
          value={metrics?.instances.total ?? '—'}
          hint={`${metrics?.instances.enabled ?? 0} enabled · limit ${config?.maxInstances ?? '—'}`}
        />
        <StatTile
          label="Running"
          value={metrics?.instances.running ?? '—'}
          hint={`${metrics?.runs.failedLast24h ?? 0} runs failed in 24h`}
        />
        <StatTile
          label="Unhealthy"
          value={(metrics?.instances.unhealthy ?? 0) + (metrics?.instances.quarantined ?? 0)}
          hint={`${metrics?.instances.quarantined ?? 0} quarantined`}
        />
        <StatTile
          label="Open incidents"
          value={metrics?.incidents.open ?? '—'}
          hint={`${metrics?.incidents.critical ?? 0} critical`}
        />
        <StatTile
          label="Backtests"
          value={metrics?.backtests.completedLast24h ?? '—'}
          hint={`${metrics?.backtests.queued ?? 0} queued · ${metrics?.backtests.running ?? 0} running`}
        />
        <StatTile
          label="Paper sessions"
          value={metrics?.paperSessions.running ?? '—'}
          hint={`${metrics?.paperSessions.stoppedLast24h ?? 0} stopped in 24h`}
        />
      </div>

      <div style={{ display: 'grid', gap: theme.space(5), marginTop: theme.space(6) }}>
        <Card
          title="Instances"
          description="Health is reported separately from enabled: an instance can be both enabled and unhealthy."
        >
          <DataTable
            rows={instances}
            rowKey={(row) => row.id}
            emptyTitle="No strategy instances"
            emptyDescription="Instances are created against a published strategy version."
            columns={[
              {
                key: 'name',
                header: 'Name',
                render: (row) => (
                  <div>
                    <div style={{ fontWeight: 600 }}>{row.name}</div>
                    <div style={{ color: theme.color.textMuted, fontSize: 12 }}>
                      {row.kind}@{row.version}
                    </div>
                  </div>
                ),
              },
              {
                key: 'market',
                header: 'Market',
                render: (row) => (
                  <div>
                    <div>{row.venue}</div>
                    <div style={{ color: theme.color.textMuted, fontSize: 12 }}>
                      {row.symbols.join(', ')}
                    </div>
                  </div>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                render: (row) => (
                  <div style={{ display: 'flex', gap: theme.space(2), flexWrap: 'wrap' }}>
                    <Badge tone={toneForStatus(row.status)}>{titleCase(row.status)}</Badge>
                    <Badge tone={healthTone(row.health)}>{titleCase(row.health)}</Badge>
                  </div>
                ),
              },
              {
                key: 'errors',
                header: 'Errors',
                align: 'right',
                render: (row) => (
                  <div>
                    <div>{row.consecutiveErrors}</div>
                    {row.lastErrorCode && (
                      <div style={{ color: theme.color.textMuted, fontSize: 12 }}>
                        {row.lastErrorCode}
                      </div>
                    )}
                  </div>
                ),
              },
              {
                key: 'heartbeat',
                header: 'Last heartbeat',
                render: (row) =>
                  row.lastHeartbeatAt ? formatRelative(row.lastHeartbeatAt) : 'never reported',
              },
            ]}
          />
        </Card>

        <Card
          title="Recent backtests"
          description="SIMULATED. Backtest performance is not indicative of future performance."
        >
          <DataTable
            rows={backtests}
            rowKey={(row) => row.id}
            emptyTitle="No backtests yet"
            emptyDescription="A backtest replays a stored dataset. It reaches no venue."
            columns={[
              {
                key: 'run',
                header: 'Run',
                render: (row) => (
                  <div>
                    <div style={{ fontFamily: 'monospace', fontSize: 12 }}>{row.runIdentifier}</div>
                    <div style={{ color: theme.color.textMuted, fontSize: 12 }}>
                      {row.strategyKey}@{row.strategyVersion} · {row.symbol}
                    </div>
                  </div>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                render: (row) => (
                  <div style={{ display: 'flex', gap: theme.space(2), flexWrap: 'wrap' }}>
                    <Badge tone={toneForStatus(row.status)}>{titleCase(row.status)}</Badge>
                    {!row.isReproducible && <Badge tone="warning">No checksum</Badge>}
                  </div>
                ),
              },
              {
                key: 'pnl',
                header: 'Net PnL',
                align: 'right',
                render: (row) => row.result.netPnl ?? '—',
              },
              {
                key: 'trades',
                header: 'Trades',
                align: 'right',
                render: (row) => row.result.totalTrades,
              },
              {
                key: 'sharpe',
                header: 'Sharpe',
                align: 'right',
                render: (row) =>
                  metricOrWithheld(row.result.sharpeRatio, row.result.hasSufficientObservations),
              },
              {
                key: 'completed',
                header: 'Completed',
                render: (row) => (row.completedAt ? formatDateTime(row.completedAt) : '—'),
              },
            ]}
          />
        </Card>

        <Card
          title="Paper sessions"
          description="SIMULATED FILLS against real prices. Paper performance is not indicative of live performance."
        >
          <DataTable
            rows={sessions}
            rowKey={(row) => row.id}
            emptyTitle="No paper sessions"
            emptyDescription="A paper session refuses any adapter that is not marked simulated."
            columns={[
              {
                key: 'session',
                header: 'Session',
                render: (row) => (
                  <div>
                    <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
                      {row.sessionIdentifier}
                    </div>
                    <div style={{ color: theme.color.textMuted, fontSize: 12 }}>
                      {row.strategyKey} · {row.symbol}
                    </div>
                  </div>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                render: (row) => <Badge tone={toneForStatus(row.status)}>{titleCase(row.status)}</Badge>,
              },
              {
                key: 'equity',
                header: 'Equity',
                align: 'right',
                render: (row) => row.currentEquity ?? '—',
              },
              {
                key: 'realised',
                header: 'Realised',
                align: 'right',
                render: (row) => row.realisedPnl,
              },
              {
                key: 'fills',
                header: 'Orders / fills',
                align: 'right',
                render: (row) => `${row.simulatedOrders} / ${row.simulatedFills}`,
              },
              {
                key: 'rejections',
                header: 'Risk rejections',
                align: 'right',
                render: (row) => row.riskRejections,
              },
              {
                key: 'started',
                header: 'Started',
                render: (row) => formatRelative(row.startedAt),
              },
            ]}
          />
        </Card>

        <Card
          title="Open incidents"
          description="Raised by the strategy worker. A rejected signal on its own is the system working and produces nothing here."
        >
          <DataTable
            rows={incidents}
            rowKey={(row) => row.id}
            emptyTitle="No open incidents"
            columns={[
              {
                key: 'severity',
                header: 'Severity',
                render: (row) => <Badge tone={toneForStatus(row.severity)}>{row.severity}</Badge>,
              },
              { key: 'type', header: 'Type', render: (row) => titleCase(row.incidentType) },
              {
                key: 'summary',
                header: 'Summary',
                render: (row) => (
                  <div>
                    <div>{row.summary}</div>
                    {row.errorCode && (
                      <div style={{ color: theme.color.textMuted, fontSize: 12 }}>
                        {row.errorCode}
                        {row.symbol ? ` · ${row.symbol}` : ''}
                      </div>
                    )}
                  </div>
                ),
              },
              { key: 'raised', header: 'Raised', render: (row) => formatRelative(row.createdAt) },
            ]}
          />
        </Card>

        <Card title="What these numbers are not">
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.9 }}>
            <li>Backtest performance is not indicative of future performance.</li>
            <li>Paper performance is not indicative of live performance.</li>
            <li>Simulation does not guarantee real execution quality.</li>
            <li>
              The simulator ignores queue position, market impact and venue rejections, so it
              systematically flatters a strategy that would in reality have waited or moved the
              price.
            </li>
            <li>
              Risk-adjusted figures are withheld rather than estimated when there were too few
              observations. &quot;Insufficient data&quot; is not zero.
            </li>
            <li>No strategy shipped with this platform carries a profitability claim.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}

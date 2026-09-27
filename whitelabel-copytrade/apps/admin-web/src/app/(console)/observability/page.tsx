import type { Metadata } from 'next';

import { Badge, Card, DataTable, ErrorNotice, PageHeader, StatTile } from '@/components/ui';
import { ApiError } from '@/lib/api-error';
import { formatRelative, titleCase } from '@/lib/format';
import { serverFetch } from '@/lib/server-api';
import { toneForStatus, type StatusTone } from '@/lib/theme';

import { AlertControls } from './alert-controls';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Observability' };

/**
 * The operations console (Part 9): platform health, the trading-readiness
 * gate table, queues, active alerts and incident context - one page, every
 * panel independently degrading.
 *
 * What this page deliberately is not, mirroring the API surface it reads:
 * there is no control here for risk (that is the Risk page's switches and
 * the engine's gate), no order surface, no configuration editor, and no
 * way to make anything "healthy" from the browser. The two alert controls -
 * acknowledge and force-resolve - mutate only the OPERATIONAL record of
 * who-knows-what, never trading state. Acknowledging the oldest
 * risk-staleness alert on a bad night does not unlock one order, and the
 * readiness table above the buttons exists to make that visible at a glance
 * rather than something an operator has to trust.
 *
 * Data path: this server component fetches the API's /v1/observability
 * routes. The console never touches Redis or PostgreSQL directly - the
 * dashboard consumes the backend, exactly as the spec demands, because an
 * admin panel that grew its own DB credentials would be a second,
 * un-audited control plane with a friendlier UI.
 */

interface GateView {
  gate: string;
  satisfied: boolean;
  reason: string;
  source: string;
}

interface ReadinessView {
  status: string;
  tradingReady: boolean;
  evaluatedAtMicros: string;
  blockingGates: string[];
  gates: GateView[];
  enginesReporting: string[];
  note: string;
}

interface ComponentView {
  component: string;
  status: string;
  reason: string | null;
  lastSuccessAt: string | null;
  ageMicros: string | null;
  stale: boolean;
}

interface ServiceView {
  service: string;
  status: string;
  checkedAt: string | null;
  stale: boolean;
  components: ComponentView[];
}

interface AlertView {
  id: string;
  ruleId: string;
  component: string;
  scope: string | null;
  severity: string;
  state: string;
  title: string;
  message: string | null;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  durationSeconds: number;
  acknowledgedBy: string | null;
  resolution: string | null;
}

interface QueueView {
  name: string;
  waiting: number;
  active: number;
  failed: number;
  paused: boolean;
  oldestWaitingAgeMs: number | null;
  alerting: boolean;
  critical: boolean;
}

interface IncidentView {
  id: string;
  title: string;
  status: string;
  severity: string | null;
  correlationId: string | null;
  openedAt: string;
  closedAt: string | null;
  links: Array<{ kind: string; targetId: string; note: string | null }>;
}

interface OverviewView {
  status: string;
  tradingReady: boolean;
  alertCounts: Record<string, number>;
  openAlerts: number;
  acknowledgedAlerts: number;
  services: ServiceView[];
  queues: QueueView[];
  note: string;
}

type Loaded<T> = { ok: T } | { error: string };

function severityTone(severity: string): StatusTone {
  if (severity === 'EMERGENCY' || severity === 'CRITICAL') {
    return 'danger';
  }
  if (severity === 'WARNING') {
    return 'warning';
  }
  return 'info';
}

async function load<T>(path: string, params?: Record<string, string | number>): Promise<Loaded<T>> {
  try {
    return { ok: await serverFetch<T>(path, { searchParams: params }) };
  } catch (error) {
    if (error instanceof ApiError) {
      return { error: error.message };
    }
    return { error: 'This panel could not be loaded.' };
  }
}

export default async function ObservabilityPage(): Promise<JSX.Element> {
  const [overview, readiness, alerts, incidents] = await Promise.all([
    load<OverviewView>('/observability/overview'),
    load<ReadinessView>('/observability/trading-readiness'),
    load<{ items: AlertView[] }>('/observability/alerts', { limit: 50 }),
    load<{ items: IncidentView[] }>('/observability/incidents', { limit: 10 }),
  ]);

  const open = 'ok' in alerts ? alerts.ok.items.filter((alert) => alert.state !== 'RESOLVED') : [];
  const resolvedRecently =
    'ok' in alerts ? alerts.ok.items.filter((alert) => alert.state === 'RESOLVED').slice(0, 10) : [];

  return (
    <div>
      <PageHeader
        title="Observability"
        description="Platform health, trading readiness, alerts and incidents. Reports; authorises nothing."
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, margin: '16px 0' }}>
        <StatTile
          label="Platform status"
          value={'ok' in overview ? overview.ok.status : 'UNKNOWN'}
          hint={'ok' in overview ? 'derived from service mirrors' : 'mirrors unavailable'}
        />
        <StatTile
          label="Trading ready"
          value={'ok' in readiness ? String(readiness.ok.tradingReady) : 'unknown'}
          hint={
            'ok' in readiness
              ? readiness.ok.blockingGates.length > 0
                ? `blocked by: ${readiness.ok.blockingGates.join(', ')}`
                : 'all gates satisfied'
              : 'readiness service unreachable'
          }
        />
        <StatTile label="Open alerts" value={'ok' in alerts ? String(open.length) : '—'} />
        <StatTile
          label="Open incidents"
          value={'ok' in incidents ? String(incidents.ok.items.filter((incident) => incident.status !== 'CLOSED').length) : '—'}
        />
      </div>

      {'error' in overview ? <ErrorNotice title="Overview" message={overview.error} /> : null}

      {'ok' in readiness ? (
        <Card title="Trading readiness (the nine gates)">
          <p style={{ opacity: 0.75, fontSize: 13, margin: '0 0 10px' }}>
            Fail-closed by construction: a gate with no fresh evidence reads <em>not satisfied</em>.
            This table never lets an order through and never stops one - enforcement lives in the
            risk engine.
          </p>
          <DataTable<GateView>
            rows={readiness.ok.gates}
            rowKey={(gate) => gate.gate}
            columns={[
              { key: 'gate', header: 'Gate', render: (gate) => titleCase(gate.gate.replace(/_/g, ' ')) },
              {
                key: 'satisfied',
                header: 'Satisfied',
                render: (gate) => <Badge tone={gate.satisfied ? 'success' : 'danger'}>{gate.satisfied ? 'yes' : 'no'}</Badge>,
              },
              { key: 'reason', header: 'Reason', render: (gate) => gate.reason },
              { key: 'source', header: 'Source', render: (gate) => gate.source },
            ]}
          />
          <p style={{ opacity: 0.6, fontSize: 12, marginTop: 8 }}>{readiness.ok.note}</p>
        </Card>
      ) : (
        <ErrorNotice title="Trading readiness" message={'error' in readiness ? readiness.error : ''} />
      )}

      {'ok' in overview ? (
        <Card title="Service mirrors">
          <DataTable<ServiceView>
            rows={overview.ok.services}
            rowKey={(service) => service.service}
            columns={[
              { key: 'service', header: 'Service', render: (service) => service.service },
              {
                key: 'status',
                header: 'Status',
                render: (service) => (
                  <Badge tone={service.stale ? 'warning' : toneForStatus(service.status)}>
                    {service.stale ? 'STALE' : service.status}
                  </Badge>
                ),
              },
              {
                key: 'components',
                header: 'Components',
                render: (service) =>
                  service.components.length === 0 ? (
                    <span style={{ opacity: 0.6 }}>no components published (mirror absent)</span>
                  ) : (
                    <ul style={{ margin: 0, paddingLeft: 16 }}>
                      {service.components.map((component) => (
                        <li key={component.component} style={{ fontSize: 13 }}>
                          <strong>{component.component}</strong> · {component.status}
                          {component.stale ? ' (stale)' : ''}
                          {component.reason ? ` - ${component.reason}` : ''}
                          {component.lastSuccessAt ? ` · last success ${formatRelative(component.lastSuccessAt)}` : ''}
                        </li>
                      ))}
                    </ul>
                  ),
              },
            ]}
          />
        </Card>
      ) : null}

      <Card title={`Alerts - ${open.length} open`}>
        {'error' in alerts ? (
          <ErrorNotice title="Alerts" message={alerts.error} />
        ) : (
          <>
            <DataTable<AlertView>
              rows={open}
              rowKey={(alert) => alert.id}
              columns={[
                {
                  key: 'severity',
                  header: 'Severity',
                  render: (alert) => <Badge tone={severityTone(alert.severity)}>{alert.severity}</Badge>,
                },
                {
                  key: 'condition',
                  header: 'Condition',
                  render: (alert) => (
                    <div>
                      <div>
                        <strong>{alert.title}</strong>{' '}
                        <span style={{ opacity: 0.65 }}>
                          ({alert.component}
                          {alert.scope ? `/${alert.scope}` : ''})
                        </span>
                      </div>
                      {alert.message ? <div style={{ fontSize: 12, opacity: 0.8 }}>{alert.message}</div> : null}
                    </div>
                  ),
                },
                {
                  key: 'state',
                  header: 'State',
                  render: (alert) => <Badge tone={alert.state === 'OPEN' ? 'warning' : 'info'}>{alert.state}</Badge>,
                },
                {
                  key: 'occurrences',
                  header: 'Occurrences',
                  render: (alert) => (
                    <div>
                      <div style={{ fontVariantNumeric: 'tabular-nums' }}>×{alert.occurrences}</div>
                      <div style={{ fontSize: 11, opacity: 0.7 }}>
                        for {alert.durationSeconds}s, first {formatRelative(alert.firstSeenAt)}
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'actions',
                  header: 'Actions',
                  render: (alert) => <AlertControls alert={alert} />,
                },
              ]}
            />
            {resolvedRecently.length > 0 ? (
              <details style={{ marginTop: 12 }}>
                <summary style={{ cursor: 'pointer', fontSize: 13 }}>
                  Recently resolved ({resolvedRecently.length}) - kept until retention, never silently
                </summary>
                <ul style={{ fontSize: 13 }}>
                  {resolvedRecently.map((alert) => (
                    <li key={alert.id}>
                      {alert.title} · {alert.resolution ?? 'recovered'} · {formatRelative(alert.lastSeenAt)}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        )}
      </Card>

      {'ok' in overview ? (
        <Card title="Queues">
          <DataTable<QueueView>
            rows={overview.ok.queues}
            rowKey={(queue) => queue.name}
            columns={[
              {
                key: 'name',
                header: 'Queue',
                render: (queue) => (
                  <span>
                    {queue.name} {queue.critical ? <Badge tone="warning">execution policy</Badge> : null}
                    {queue.paused ? <Badge tone="neutral">paused</Badge> : null}
                  </span>
                ),
              },
              { key: 'waiting', header: 'Waiting', render: (queue) => String(queue.waiting) },
              { key: 'active', header: 'Active', render: (queue) => String(queue.active) },
              { key: 'failed', header: 'Failed', render: (queue) => String(queue.failed) },
              {
                key: 'oldest',
                header: 'Oldest waiting',
                render: (queue) =>
                  queue.oldestWaitingAgeMs === null ? (
                    <span style={{ opacity: 0.6 }}>empty</span>
                  ) : (
                    <span style={{ opacity: queue.alerting ? 1 : 0.75, color: queue.alerting ? 'var(--wlct-color-danger)' : undefined }}>
                      {queue.oldestWaitingAgeMs}ms{queue.alerting ? ' (over policy)' : ''}
                    </span>
                  ),
              },
            ]}
          />
          <p style={{ opacity: 0.6, fontSize: 12, marginTop: 8 }}>{overview.ok.note}</p>
        </Card>
      ) : null}

      <Card title="Incidents (recent)">
        {'error' in incidents ? (
          <ErrorNotice title="Incidents" message={incidents.error} />
        ) : incidents.ok.items.length === 0 ? (
          <p style={{ opacity: 0.7, fontSize: 13 }}>No incidents recorded. Silence here is health.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {incidents.ok.items.map((incident) => (
              <li key={incident.id} style={{ marginBottom: 10, fontSize: 13 }}>
                <strong>{incident.title}</strong> ·{' '}
                <Badge tone={incident.status === 'OPEN' ? 'warning' : 'neutral'}>{incident.status}</Badge>
                {incident.correlationId ? <span style={{ opacity: 0.7 }}> · correlation {incident.correlationId}</span> : null}
                <div style={{ fontSize: 12, opacity: 0.8 }}>
                  {incident.links.map((link) => (
                    <span key={`${link.kind}-${link.targetId}`} style={{ marginRight: 10 }}>
                      {link.kind}:{link.targetId}
                      {link.note ? ` (${link.note})` : ''}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: 11, opacity: 0.6 }}>
                  opened {formatRelative(incident.openedAt)} · full record at /v1/observability/incidents/{incident.id}
                  ; linked risk and audit rows are on their own pages
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

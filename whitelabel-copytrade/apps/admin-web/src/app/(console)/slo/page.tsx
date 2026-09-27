import type { Metadata } from 'next';

import { Badge, Card, DataTable, ErrorNotice, PageHeader, StatTile } from '@/components/ui';
import { ApiError } from '@/lib/api-error';
import { formatRelative } from '@/lib/format';
import { serverFetch } from '@/lib/server-api';
import type { StatusTone } from '@/lib/theme';

import { EvaluateAllButton, FlushExportButton, RunNowButton, SloConfigForm } from './slo-controls';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Service objectives' };

/**
 * The error-budget console (Part 10): every SLO with its latest evaluation,
 * the dual-window burn verdicts, the readiness rollup, and the telemetry
 * posture that produces the numbers.
 *
 * What this page can and cannot do, stated in the same terms the API uses:
 * it publishes NEW definition VERSIONS (append-only, audited, risk-reducing
 * or cosmetic - it can never rewrite or delete an old promise), it asks the
 * evaluator to look now, and it runs one export tick. It cannot arm a fault
 * (that is an environment decision the API refuses to expose), it cannot
 * edit a stored version, and no panel here authorises anything: the
 * numbers measure and page, and the trading gates read the risk plane, not
 * this one. That is the whole contract of the telemetry layer, mirrored
 * where a human can read it.
 *
 * Data path: server component through serverFetch, like every other console
 * page. The browser never holds a bearer token and the console never talks
 * to Redis or Postgres directly.
 */

interface SloDefinitionView {
  sloId: string;
  version: number;
  service: string;
  owner: string;
  description: string;
  indicator: string;
  objective: string;
  objectivePpm: number;
  allowedPpm: number;
  windowMinutes: number;
  shortWindowMinutes: number;
  goodEvent: string;
  badEvent: string;
  warningBurnPpm: number;
  criticalBurnPpm: number;
  maxAgeMicros: string | null;
  latencyThresholdMicros: string | null;
  enabled: boolean;
  checksum: string;
  createdAt: string;
  updatedAt: string;
}

interface SloEvaluationView {
  sloId: string;
  version: number;
  checksum: string;
  indicator: string;
  service: string;
  state: string;
  evaluatedAtMicros: string;
  windowMinutes: number;
  shortWindowMinutes: number;
  targetPpm: number;
  actualPpm: number | null;
  budgetTotalEvents: number;
  budgetConsumedEvents: number;
  budgetRemainingEvents: number;
  remainingRatioPpm: number | null;
  longBurnPpm: number | null;
  shortBurnPpm: number | null;
  alertKind: string;
  samplesGood: number;
  samplesBad: number;
  dataComplete: boolean;
  reason: string | null;
}

interface SloStatusView {
  definition: SloDefinitionView;
  latest: SloEvaluationView | null;
  burnAlerting: boolean;
}

interface SloReadinessView {
  evaluatedAtMicros: string;
  total: number;
  byState: Record<string, number>;
  worstRemainingRatioPpm: number | null;
  maxLongBurnPpm: number | null;
  pagingSloIds: string[];
  unmeasuredSloIds: string[];
  note: string;
}

interface TracingStatusView {
  enabled: boolean;
  endpointConfigured: boolean;
  sampleRatio: number;
  priorityOperations: string[];
  bufferedSpans: number;
  exportedTotal: number;
  droppedTotal: number;
  consecutiveExportFailures: number;
  lastExportOutcome: string | null;
}

interface FaultsStatusView {
  enabled: boolean;
  production: boolean;
  activePoints: string[];
}

type Loaded<T> = { ok: T } | { error: string };

async function load<T>(path: string, params?: Record<string, string | number | boolean>): Promise<Loaded<T>> {
  try {
    return { ok: await serverFetch<T>(path, { searchParams: params }) };
  } catch (error) {
    if (error instanceof ApiError) {
      return { error: error.message };
    }
    return { error: 'This panel could not be loaded.' };
  }
}

function stateTone(state: string | null | undefined): StatusTone {
  switch (state) {
    case 'HEALTHY':
      return 'success';
    case 'WARNING':
      return 'warning';
    case 'CRITICAL':
    case 'EXHAUSTED':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** ppm -> "48.2%" style rendering; null stays an honest em dash, never 0. */
function ppmToPercent(ppm: number | null | undefined): string {
  if (ppm === null || ppm === undefined) {
    return '—';
  }
  return `${(ppm / 10_000).toFixed(1)}%`;
}

function ppmToTimes(ppm: number | null | undefined): string {
  if (ppm === null || ppm === undefined) {
    return '—';
  }
  return `${(ppm / 1_000_000).toFixed(2)}×`;
}

function windowLabel(minutes: number): string {
  if (minutes % 1440 === 0) {
    return `${String(minutes / 1440)}d`;
  }
  if (minutes % 60 === 0) {
    return `${String(minutes / 60)}h`;
  }
  return `${String(minutes)}m`;
}

export default async function SloPage(): Promise<JSX.Element> {
  const [statuses, readiness, tracing, faults] = await Promise.all([
    load<{ items: SloStatusView[]; total: number }>('/operational/slos', { includeDisabled: true }),
    load<SloReadinessView>('/operational/slos/readiness'),
    load<TracingStatusView>('/operational/tracing'),
    load<FaultsStatusView>('/operational/faults'),
  ]);

  const rows = 'ok' in statuses ? statuses.ok.items : [];
  const evidenced = rows.filter((row) => row.latest !== null);
  const alerting = 'ok' in readiness ? readiness.ok.pagingSloIds : [];
  const unmeasured = 'ok' in readiness ? readiness.ok.unmeasuredSloIds : [];

  return (
    <div>
      <PageHeader
        title="Service objectives"
        description="Error budgets, burn rates and the telemetry posture behind them. Reports and pages; authorises nothing."
        actions={<EvaluateAllButton />}
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
          margin: '16px 0',
        }}
      >
        <StatTile
          label="Objectives"
          value={rows.length > 0 ? String(rows.length) : '—'}
          hint={`${String(evidenced.length)} with at least one evaluation`}
        />
        <StatTile
          label="Paging now"
          value={'ok' in readiness ? String(readiness.ok.pagingSloIds.length) : '—'}
          hint={
            alerting.length > 0
              ? alerting.join(', ')
              : 'no dual-window burn condition currently met'
          }
        />
        <StatTile
          label="Worst remaining budget"
          value={'ok' in readiness ? ppmToPercent(readiness.ok.worstRemainingRatioPpm) : '—'}
          hint="the floor, not the average: one exhausted objective is the headline"
        />
        <StatTile
          label="Max long burn"
          value={'ok' in readiness ? ppmToTimes(readiness.ok.maxLongBurnPpm) : '—'}
          hint="burn multiplier over the long window"
        />
        <StatTile
          label="Unmeasured"
          value={'ok' in readiness ? String(readiness.ok.unmeasuredSloIds.length) : '—'}
          hint={unmeasured.length > 0 ? unmeasured.join(', ') : 'every objective has current evidence'}
        />
      </div>

      {'error' in readiness ? (
        <ErrorNotice title="Readiness rollup" message={readiness.error} />
      ) : (
        <Card
          title="Rollup"
          description={`Evaluated at ${formatRelative(
            new Date(Number(BigInt(readiness.ok.evaluatedAtMicros) / 1000n)).toISOString(),
          )}. States below count the LATEST evaluation of each definition.`}
        >
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            {['HEALTHY', 'WARNING', 'CRITICAL', 'EXHAUSTED', 'UNKNOWN'].map((state) => (
              <Badge key={state} tone={stateTone(state)}>
                {state}: {String(readiness.ok.byState[state] ?? 0)}
              </Badge>
            ))}
          </div>
          <p style={{ fontSize: 12, color: 'var(--wlct-color-text-muted)', margin: 0 }}>
            {readiness.ok.note}
          </p>
        </Card>
      )}

      <div style={{ marginTop: 16 }}>
        {'error' in statuses ? (
          <ErrorNotice title="Service objectives" message={statuses.error} />
        ) : (
          <Card
            title="Objectives"
            description="Latest published version and latest evaluation per objective. A row whose latest tick says dataComplete=false carries an explicit ⚠ - a thin window is reported, not averaged away."
          >
            <DataTable<SloStatusView>
              rows={rows}
              rowKey={(row) => row.definition.sloId}
              emptyTitle="No objectives configured"
              emptyDescription="The platform ships a default catalog; this tenant has none published yet."
              columns={[
                {
                  key: 'slo',
                  header: 'Objective',
                  render: (row) => (
                    <div>
                      <strong style={{ fontSize: 13 }}>{row.definition.sloId}</strong>
                      <div style={{ fontSize: 12, color: 'var(--wlct-color-text-muted)' }}>
                        {row.definition.service} · {row.definition.indicator} · v
                        {String(row.definition.version)}
                        {row.definition.enabled ? '' : ' · disabled'}
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'promise',
                  header: 'Promise',
                  render: (row) => (
                    <div style={{ fontSize: 13 }}>
                      {row.definition.objective}% / {windowLabel(row.definition.windowMinutes)}
                      <div style={{ fontSize: 12, color: 'var(--wlct-color-text-muted)' }}>
                        short {windowLabel(row.definition.shortWindowMinutes)} · allows{' '}
                        {ppmToPercent(row.definition.allowedPpm)}
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'state',
                  header: 'State',
                  render: (row) => (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Badge tone={stateTone(row.latest?.state ?? null)}>
                        {row.latest?.state ?? 'NO-EVAL'}
                      </Badge>
                      {row.burnAlerting ? <Badge tone="danger">paging</Badge> : null}
                      {row.latest !== null && !row.latest.dataComplete ? (
                        <Badge tone="warning">⚠ thin window</Badge>
                      ) : null}
                    </div>
                  ),
                },
                {
                  key: 'budget',
                  header: 'Budget left',
                  align: 'right',
                  render: (row) => (
                    <div style={{ fontSize: 13, textAlign: 'right' }}>
                      {ppmToPercent(row.latest?.remainingRatioPpm)}
                      <div style={{ fontSize: 12, color: 'var(--wlct-color-text-muted)' }}>
                        {row.latest === null
                          ? 'no evidence yet'
                          : `${String(row.latest.budgetConsumedEvents)} of ${String(
                              row.latest.budgetTotalEvents,
                            )} events burned`}
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'burn',
                  header: 'Burn (short / long)',
                  align: 'right',
                  render: (row) => (
                    <div style={{ fontSize: 13, textAlign: 'right' }}>
                      {ppmToTimes(row.latest?.shortBurnPpm)} / {ppmToTimes(row.latest?.longBurnPpm)}
                      <div style={{ fontSize: 12, color: 'var(--wlct-color-text-muted)' }}>
                        {row.latest === null
                          ? '—'
                          : `pages at ${ppmToTimes(row.definition.criticalBurnPpm)} both windows`}
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'samples',
                  header: 'Samples (g/b)',
                  align: 'right',
                  render: (row) => (
                    <div style={{ fontSize: 13, textAlign: 'right' }}>
                      {row.latest === null
                        ? '—'
                        : `${String(row.latest.samplesGood)} / ${String(row.latest.samplesBad)}`}
                      <div style={{ fontSize: 12, color: 'var(--wlct-color-text-muted)' }}>
                        {row.latest?.reason ??
                          (row.latest === null ? 'not evaluated yet' : 'ok')}
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'evaluated',
                  header: 'Evaluated',
                  render: (row) => (
                    <div style={{ fontSize: 13 }}>
                      {row.latest === null
                        ? 'never'
                        : formatRelative(
                            new Date(
                              Number(BigInt(row.latest.evaluatedAtMicros) / 1000n),
                            ).toISOString(),
                          )}
                    </div>
                  ),
                },
                {
                  key: 'controls',
                  header: '',
                  align: 'right',
                  render: (row) => (
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <RunNowButton sloId={row.definition.sloId} />
                      <SloConfigForm definition={row.definition} />
                    </div>
                  ),
                },
              ]}
            />
          </Card>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 16,
          marginTop: 16,
        }}
      >
        <Card
          title="Telemetry posture"
          description="What THIS api process exports and where it goes, as configured. The endpoint is reported as configured/not - URLs belong in deployment, not panels."
          actions={<FlushExportButton />}
        >
          {'error' in tracing ? (
            <ErrorNotice title="Tracing status" message={tracing.error} />
          ) : (
            <dl style={{ fontSize: 13, margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 16px' }}>
              <dt>Export</dt>
              <dd style={{ margin: 0 }}>
                {tracing.ok.enabled
                  ? tracing.ok.endpointConfigured
                    ? 'on'
                    : 'on, but nowhere to go (counts as drops)'
                  : 'off'}
              </dd>
              <dt>Sample ratio</dt>
              <dd style={{ margin: 0 }}>{tracing.ok.sampleRatio}</dd>
              <dt>Always-traced operations</dt>
              <dd style={{ margin: 0 }}>
                {tracing.ok.priorityOperations.length > 0
                  ? tracing.ok.priorityOperations.join(', ')
                  : 'none'}
              </dd>
              <dt>Buffered / exported / dropped</dt>
              <dd style={{ margin: 0 }}>
                {String(tracing.ok.bufferedSpans)} / {String(tracing.ok.exportedTotal)} /{' '}
                {String(tracing.ok.droppedTotal)}
              </dd>
              <dt>Consecutive failures</dt>
              <dd style={{ margin: 0 }}>
                {String(tracing.ok.consecutiveExportFailures)}
                {tracing.ok.lastExportOutcome !== null
                  ? ` · last: ${tracing.ok.lastExportOutcome}`
                  : ''}
              </dd>
            </dl>
          )}
        </Card>

        <Card
          title="Fault injection"
          description="Armed only through environment configuration, only outside production; the API exposes no arm lever, so the only runtime operation is consumption at the instrumented points. This card is why 'absence of injected failure' and 'no injection here' are different sentences."
        >
          {'error' in faults ? (
            <ErrorNotice title="Fault posture" message={faults.error} />
          ) : (
            <dl style={{ fontSize: 13, margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 16px' }}>
              <dt>Deployment</dt>
              <dd style={{ margin: 0 }}>{faults.ok.production ? 'production' : 'non-production'}</dd>
              <dt>Armed</dt>
              <dd style={{ margin: 0 }}>
                <Badge tone={faults.ok.enabled ? 'warning' : 'neutral'}>
                  {faults.ok.enabled ? 'YES — tests only' : 'no'}
                </Badge>
              </dd>
              <dt>Active points</dt>
              <dd style={{ margin: 0 }}>
                {faults.ok.activePoints.length > 0 ? faults.ok.activePoints.join(', ') : 'none'}
              </dd>
            </dl>
          )}
        </Card>
      </div>
    </div>
  );
}

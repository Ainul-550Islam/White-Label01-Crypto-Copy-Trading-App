import type { Metadata } from 'next';

import { Badge, Card, DataTable, ErrorNotice, PageHeader, StatTile } from '@/components/ui';
import { ApiError } from '@/lib/api-error';
import { formatDateTime, formatRelative, titleCase } from '@/lib/format';
import { serverFetch } from '@/lib/server-api';
import { theme, toneForStatus } from '@/lib/theme';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Datasets' };

/**
 * Historical dataset console (Part 7) - a foundation, deliberately read-only.
 *
 * What this page is for: an operator scanning which datasets exist, whether
 * they are VALID, what windows they cover, what their checksums are, and
 * what ingestion is doing or did and failed. Every number is metadata over
 * frozen files; nothing here reads event rows, so nothing here can become a
 * way to exfiltrate or "fix" a dataset.
 *
 * Why no buttons: ingesting, validating, quarantining and archiving all have
 * API routes with reasons and typed confirmations, and this console is not
 * where those flows get their first UI. A "Quarantine" button next to a
 * table row is one careless click away from withdrawing the dataset a
 * team's backtests were citing, and the confirmation phrase that makes that
 * safe is an interaction design decision, not a checkbox. The CLI and the
 * API carry the write paths; this page tells the truth about state.
 *
 * Every panel degrades independently: a failed fetch disables one card, not
 * the page, because the moment an operator most needs this screen is the
 * moment something is already broken.
 */

interface Paginated<T> {
  items: T[];
  pagination: { page: number; limit: number; totalItems: number };
}

interface DatasetRow {
  id: string;
  datasetKey: string;
  name: string;
  venue: string;
  marketType: string;
  symbols: string[];
  eventKinds: string[];
  granularity: string | null;
  startMicros: string;
  endMicros: string;
  status: string;
  latestVersion: number | null;
  schemaVersion: number;
  canonicalSchemaVersion: number;
  createdAt: string;
  updatedAt: string;
}

interface IngestionRunRow {
  id: string;
  datasetId: string | null;
  datasetKeyHint: string | null;
  version: number | null;
  status: string;
  stage: string | null;
  errorText: string | null;
  stagingKey: string;
  sourceKind: string;
  bytesDownloaded: string;
  eventsWritten: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

interface ValidationRow {
  id: string;
  versionId: string;
  status: string;
  infoCount: number;
  warningCount: number;
  errorCount: number;
  fatalCount: number;
  durationMicros: string | null;
  startedAt: string;
  finishedAt: string | null;
}

interface CoverageRow {
  datasetKey: string;
  version: number;
  venue: string;
  symbol: string;
  marketType: string;
  eventKinds: string[];
  startMicros: string;
  endMicros: string;
  eventCount: number;
  contentChecksum: string;
  completeness: string;
}

interface ConsoleData {
  datasets: DatasetRow[];
  runs: IngestionRunRow[];
  coverage: CoverageRow[];
  latestValidation: ValidationRow | null;
  failures: string[];
}

async function loadConsole(): Promise<ConsoleData> {
  const failures: string[] = [];

  const describe = (label: string) => (error: unknown) => {
    failures.push(error instanceof ApiError ? `${label}: ${error.message}` : `${label} unavailable`);
    return null;
  };

  const [datasets, runs] = await Promise.all([
    serverFetch<Paginated<DatasetRow>>('/datasets', {
      searchParams: { page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'desc' },
    }).catch(describe('Datasets')),
    serverFetch<Paginated<IngestionRunRow>>('/datasets/ingestion-runs', {
      searchParams: { page: 1, limit: 10 },
    }).catch(describe('Ingestion runs')),
  ]);

  // Coverage is answered per dataset the operator can actually replay; the
  // console shows it for the newest dataset only in this foundation page -
  // a full symbol picker is UI for the next increment, not a reason to ship
  // a query that scans every symbol every render.
  let coverage: CoverageRow[] = [];
  let latestValidation: ValidationRow | null = null;
  const newest = datasets?.items[0];
  if (newest) {
    const symbol = newest.symbols[0];
    if (symbol) {
      const ranges = await serverFetch<CoverageRow[]>('/datasets/replay-ranges', {
        searchParams: { venue: newest.venue, symbol },
      }).catch(describe('Coverage'));
      coverage = ranges ?? [];
      if (newest.latestVersion !== null) {
        latestValidation = await serverFetch<ValidationRow | null>(
          `/datasets/${newest.datasetKey}/versions/${newest.latestVersion}/validation`,
        ).catch(describe('Latest validation'));
      }
    }
  }

  return {
    datasets: datasets?.items ?? [],
    runs: runs?.items ?? [],
    coverage,
    latestValidation,
    failures,
  };
}

function bytesLabel(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return '—';
  }
  const bytes = Number(BigInt(value));
  if (!Number.isFinite(bytes)) {
    return `${value} B`;
  }
  if (bytes >= 1 << 30) {
    return `${(bytes / (1 << 30)).toFixed(1)} GiB`;
  }
  if (bytes >= 1 << 20) {
    return `${(bytes / (1 << 20)).toFixed(1)} MiB`;
  }
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function windowLabel(startMicros: string, endMicros: string): string {
  const start = Number(BigInt(startMicros) / 1_000_000n);
  const end = Number(BigInt(endMicros) / 1_000_000n);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return `${startMicros}–${endMicros}`;
  }
  return `${formatDateTime(new Date(start * 1000).toISOString())} → ${formatDateTime(
    new Date(end * 1000).toISOString(),
  )}`;
}

function checksumShort(value: string | null | undefined): string {
  return value ? `${value.slice(0, 12)}…` : 'none';
}

export default async function DatasetsPage(): Promise<JSX.Element> {
  const { datasets, runs, coverage, latestValidation, failures } = await loadConsole();

  const validCount = datasets.filter((row) => row.status === 'VALID').length;
  const quarantinedCount = datasets.filter((row) => row.status === 'QUARANTINED').length;
  const failedRuns = runs.filter((run) => run.status === 'FAILED' || run.status === 'QUARANTINED').length;
  const bytesAcrossRuns = runs.reduce((sum, run) => sum + (Number(run.bytesDownloaded) || 0), 0);

  return (
    <>
      <PageHeader
        title="Datasets"
        description="Historical market data backing backtests. Metadata over frozen public files; no event rows are served from here, to here, or through here."
      />

      {failures.length > 0 && (
        <div style={{ marginTop: theme.space(5) }}>
          <ErrorNotice title="Some panels could not be loaded" message={failures.join(' · ')} />
        </div>
      )}

      <div style={{ marginTop: theme.space(5) }}>
        <Card
          title="What datasets are"
          description="Read this first: it is the boundary the whole screen lives inside."
        >
          <p style={{ color: theme.color.textMuted, fontSize: 13, margin: 0 }}>
            Datasets are immutable, checksummed captures of PUBLIC historical market data,
            ingested from explicit operator-triggered jobs and consumed exclusively by the
            backtest engine. A dataset version never changes after validation; new data is a
            new version. Ingestion reads public archives with no credentials of any kind, and
            no dataset, valid or otherwise, can place an order or reach a venue. Backtests over
            these datasets are simulations: BACKTEST PERFORMANCE IS NOT INDICATIVE OF FUTURE
            PERFORMANCE, and a dataset being VALID says its data is internally consistent, not
            that anything in it will repeat.
          </p>
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
        <StatTile label="Datasets" value={datasets.length} hint={`${validCount} with a VALID latest status`} />
        <StatTile label="Quarantined" value={quarantinedCount} hint="withdrawn from replay use; payloads preserved" />
        <StatTile
          label="Ingestion runs"
          value={runs.length}
          hint={`${failedRuns} failed or quarantined`}
        />
        <StatTile
          label="Bytes downloaded (shown runs)"
          value={bytesLabel(String(bytesAcrossRuns))}
          hint="public-archive fetches; no credentials involved"
        />
      </div>

      <div style={{ display: 'grid', gap: theme.space(5), marginTop: theme.space(6) }}>
        <Card
          title="Datasets"
          description="Status shown is the dataset-level rollup of its latest version. Any decision must consult the version row itself."
        >
          <DataTable
            rows={datasets}
            rowKey={(row) => row.id}
            emptyTitle="No datasets registered yet"
            emptyDescription="Ingestion is queued through POST /datasets/ingest (disabled by default) or run via the wlct-trading-datasets CLI."
            columns={[
              {
                key: 'name',
                header: 'Dataset',
                render: (row) => (
                  <div>
                    <div style={{ fontWeight: 600 }}>{row.name}</div>
                    <div style={{ color: theme.color.textMuted, fontSize: 12 }}>
                      {row.datasetKey}
                    </div>
                  </div>
                ),
              },
              {
                key: 'market',
                header: 'Coverage',
                render: (row) => (
                  <div>
                    <div>
                      {row.venue} · {row.symbols.join(', ')}
                    </div>
                    <div style={{ color: theme.color.textMuted, fontSize: 12 }}>
                      {row.eventKinds.map(titleCase).join(' / ')} · {row.marketType}
                    </div>
                  </div>
                ),
              },
              {
                key: 'window',
                header: 'Window',
                render: (row) => (
                  <span style={{ fontSize: 12 }}>{windowLabel(row.startMicros, row.endMicros)}</span>
                ),
              },
              {
                key: 'version',
                header: 'Latest',
                render: (row) => (
                  <div style={{ display: 'flex', gap: theme.space(2), alignItems: 'center' }}>
                    <Badge tone={toneForStatus(row.status)}>{titleCase(row.status)}</Badge>
                    <span style={{ color: theme.color.textMuted, fontSize: 12 }}>
                      v{row.latestVersion ?? '—'}
                    </span>
                  </div>
                ),
              },
              {
                key: 'updated',
                header: 'Updated',
                render: (row) => <span title={row.updatedAt}>{formatRelative(row.updatedAt)}</span>,
              },
            ]}
          />
        </Card>

        <Card
          title="Replay coverage for the newest dataset"
          description="Only VALID versions appear here; a range not listed is not usable for a backtest, which is the entire point of the distinction."
        >
          <DataTable
            rows={coverage}
            rowKey={(row) => `${row.datasetKey}@v${row.version}`}
            emptyTitle="No usable coverage"
            emptyDescription="Every version for this symbol is unvalidated, quarantined or archived."
            columns={[
              {
                key: 'version',
                header: 'Version',
                render: (row) => (
                  <div>
                    <div style={{ fontWeight: 600 }}>v{row.version}</div>
                    <div style={{ color: theme.color.textMuted, fontSize: 12 }}>
                      {row.datasetKey}
                    </div>
                  </div>
                ),
              },
              { key: 'symbol', header: 'Symbol', render: (row) => row.symbol },
              {
                key: 'window',
                header: 'Window',
                render: (row) => (
                  <span style={{ fontSize: 12 }}>{windowLabel(row.startMicros, row.endMicros)}</span>
                ),
              },
              {
                key: 'events',
                header: 'Events',
                render: (row) => row.eventCount.toLocaleString('en-US'),
              },
              {
                key: 'checksum',
                header: 'Content checksum',
                render: (row) => (
                  <code style={{ fontSize: 12 }} title={row.contentChecksum}>
                    {checksumShort(row.contentChecksum)}
                  </code>
                ),
              },
              {
                key: 'completeness',
                header: 'Completeness',
                render: (row) => (
                  <Badge tone={row.completeness === 'COMPLETE' ? 'success' : 'warning'}>
                    {titleCase(row.completeness)}
                  </Badge>
                ),
              },
            ]}
          />
        </Card>

        <Card
          title="Ingestion runs"
          description="Jobs live here; the work happens on the dataset worker. A FAILED or QUARANTINED run never becomes a visible version by construction."
        >
          <DataTable
            rows={runs}
            rowKey={(row) => row.id}
            emptyTitle="No ingestion jobs yet"
            emptyDescription="POST /datasets/ingest queues one once HISTORICAL_INGESTION_ENABLED is set deliberately."
            columns={[
              {
                key: 'run',
                header: 'Run',
                render: (row) => (
                  <div>
                    <div style={{ fontWeight: 600 }}>{row.sourceKind}</div>
                    <div style={{ color: theme.color.textMuted, fontSize: 12 }}>{row.stagingKey}</div>
                  </div>
                ),
              },
              {
                key: 'target',
                header: 'Target',
                render: (row) => (
                  <span style={{ fontSize: 12 }}>
                    {row.datasetKeyHint ?? '—'}
                    {row.version !== null ? `@v${row.version}` : ''}
                  </span>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                render: (row) => (
                  <div style={{ display: 'flex', gap: theme.space(2), alignItems: 'center', flexWrap: 'wrap' }}>
                    <Badge tone={toneForStatus(row.status)}>{titleCase(row.status)}</Badge>
                    {row.stage ? (
                      <span style={{ color: theme.color.textMuted, fontSize: 12 }}>{titleCase(row.stage)}</span>
                    ) : null}
                  </div>
                ),
              },
              {
                key: 'volume',
                header: 'Progress',
                render: (row) => (
                  <div style={{ fontSize: 12 }}>
                    <div>{bytesLabel(row.bytesDownloaded)} downloaded</div>
                    <div style={{ color: theme.color.textMuted }}>
                      {row.eventsWritten.toLocaleString('en-US')} events
                    </div>
                  </div>
                ),
              },
              {
                key: 'error',
                header: 'Error',
                render: (row) =>
                  row.errorText ? (
                    <span
                      style={{ color: theme.color.danger, fontSize: 12, fontFamily: 'monospace' }}
                      title={row.errorText}
                    >
                      {row.errorText.length > 60 ? `${row.errorText.slice(0, 60)}…` : row.errorText}
                    </span>
                  ) : (
                    <span style={{ color: theme.color.textMuted }}>—</span>
                  ),
              },
              {
                key: 'when',
                header: 'Created',
                render: (row) => <span title={row.createdAt}>{formatRelative(row.createdAt)}</span>,
              },
            ]}
          />
        </Card>

        {latestValidation ? (
          <Card title="Latest validation verdict" description="For the newest version of the newest dataset.">
            <div style={{ display: 'flex', gap: theme.space(2), flexWrap: 'wrap' }}>
              <Badge tone={toneForStatus(latestValidation.status)}>
                {titleCase(latestValidation.status)}
              </Badge>
              <Badge tone={latestValidation.fatalCount > 0 ? 'danger' : 'neutral'}>
                {latestValidation.fatalCount} fatal
              </Badge>
              <Badge tone={latestValidation.errorCount > 0 ? 'danger' : 'neutral'}>
                {latestValidation.errorCount} errors
              </Badge>
              <Badge tone={latestValidation.warningCount > 0 ? 'warning' : 'neutral'}>
                {latestValidation.warningCount} warnings
              </Badge>
              <Badge tone="neutral">{latestValidation.infoCount} info</Badge>
              {latestValidation.durationMicros !== null ? (
                <Badge tone="neutral">
                  {(Number(latestValidation.durationMicros) / 1000).toFixed(0)} ms
                </Badge>
              ) : null}
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}

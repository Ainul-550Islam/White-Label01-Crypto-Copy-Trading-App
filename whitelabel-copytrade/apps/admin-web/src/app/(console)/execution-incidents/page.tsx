// # NEW — Admin console route for execution incidents and stuck orders
import type { Metadata } from 'next';
import { Card, ErrorNotice, PageHeader, StatTile } from '@/components/ui';
import { serverFetch } from '@/lib/server-api';
import { theme } from '@/lib/theme';
import {
  ExecutionIncidentTable,
  type ExecutionIncidentRow,
  type ExecutionKillSwitchItem,
} from '@/modules/execution/execution-incident-table';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Execution Incidents & Safety' };

interface IncidentCountsResponse {
  open: number;
  critical: number;
  warning: number;
  info: number;
  stale: number;
}

interface ExecutionSafetyResponse {
  tradingMode: string;
  executionEnabled: boolean;
  liveTradingEnabled: boolean;
  dryRun: boolean;
  paperTrading: boolean;
  sandboxMode: boolean;
  wouldTransmitLiveOrder: boolean;
  blockingReasons: string[];
  killSwitches: ExecutionKillSwitchItem[];
}

export default async function ExecutionIncidentsPage(): Promise<JSX.Element> {
  const failures: string[] = [];
  const track = async <T,>(label: string, promise: Promise<T>): Promise<T | null> => {
    try {
      return await promise;
    } catch (err) {
      failures.push(`${label}: ${(err as Error).message}`);
      return null;
    }
  };

  const [counts, safety, incidentsPage] = await Promise.all([
    track('incident counts', serverFetch<IncidentCountsResponse>('/execution/incidents/counts')),
    track('execution safety', serverFetch<ExecutionSafetyResponse>('/execution/safety')),
    track(
      'execution incidents',
      serverFetch<{ items: ExecutionIncidentRow[] }>('/execution/incidents', {
        searchParams: { limit: 50, includeResolved: true },
      }),
    ),
  ]);

  const incidents = incidentsPage?.items ?? [];
  const killSwitches = safety?.killSwitches ?? [];

  return (
    <>
      <PageHeader
        title="Execution Incidents & Kill-Switch Console"
        description="Operational incident queue, stuck-order diagnostics, deployment safety gate status, and audited kill-switch controls."
      />

      {failures.length > 0 && (
        <div style={{ marginTop: theme.space(4) }}>
          <ErrorNotice title="Some execution panels degraded" message={failures.join(' · ')} />
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: theme.space(4),
          marginTop: theme.space(5),
        }}
      >
        <StatTile
          label="Open Incidents"
          value={counts?.open ?? 0}
          hint={`${counts?.critical ?? 0} critical · ${counts?.stale ?? 0} stale (>1h)`}
        />
        <StatTile
          label="Trading Mode"
          value={safety?.tradingMode ?? 'PAPER'}
          hint={
            safety?.wouldTransmitLiveOrder
              ? 'Live orders armed'
              : 'Live transmission blocked by safety gate'
          }
        />
        <StatTile
          label="Active Kill Switches"
          value={killSwitches.filter((k) => k.isEngaged).length}
          hint={`${killSwitches.length} total recorded switches`}
        />
        <StatTile
          label="Safety Gate Blockers"
          value={safety?.blockingReasons.length ?? 0}
          hint={safety?.blockingReasons[0] ?? 'No blockers'}
        />
      </div>

      <div style={{ marginTop: theme.space(6) }}>
        <Card
          title="Execution Incidents & Safety Controls"
          description="Engage or release scoped kill switches and resolve execution incidents with an immutable audit note."
        >
          <ExecutionIncidentTable incidents={incidents} killSwitches={killSwitches} />
        </Card>
      </div>
    </>
  );
}

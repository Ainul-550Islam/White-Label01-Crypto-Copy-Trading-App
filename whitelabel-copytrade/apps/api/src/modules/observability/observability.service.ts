import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { OBS_PUBLISHER_SERVICES } from '@wlct/config';

import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { QueueService } from '../queue/queue.service';
import { HealthService } from '../health/health.service';
import { TradingReadinessService } from '../health/trading-readiness.service';

import { parseHealthDocument, componentView } from './observability.mapper';
import { EnginePostureService } from './engine-posture.service';
import type {
  OpsOverviewSection,
  OpsOverviewView,
  OpsServiceHealthView,
  QueueStatsView,
  TradingReadinessView,
} from './observability.types';
import { ALERT_SEVERITIES, TRADING_GATES, type AlertSeverity } from './alert.constants';

/**
 * The operations panel documents. Every section here is a READ composed from
 * state the platform already keeps - Redis mirrors published by the trading
 * plane, the API's own live probes, and small aggregate queries against the
 * durable tables. Nothing here reaches into Redis or Postgres for the admin
 * UI to consume directly (the UI consumes THESE endpoints), and nothing here
 * computes anything the engine computes for enforcement: panel and gate may
 * legitimately disagree for one sample interval, and that is a fact about
 * asynchronous systems, not a bug to paper over by making the panel the
 * source of truth. It never is; that is why the risk module owns the gate.
 */
@Injectable()
export class ObservabilityService {
  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly config: AppConfigService,
    private readonly readiness: TradingReadinessService,
    private readonly healthService: HealthService,
    private readonly enginePosture: EnginePostureService,
    @InjectPinoLogger(ObservabilityService.name) private readonly logger: PinoLogger,
  ) {}

  async overview(tenantId: string | null): Promise<OpsOverviewView> {
    const [services, readiness, queueViews, alertAgg] = await Promise.all([
      this.serviceHealth(),
      this.tradingReadiness(),
      this.queuePanel(),
      this.prisma.opsAlert.groupBy({
        by: ['severity', 'state'],
        _count: { _all: true },
        ...(tenantId === null ? {} : { where: { tenantId } }),
      }),
    ]);

    const counts = Object.fromEntries(ALERT_SEVERITIES.map((severity) => [severity, 0])) as Record<
      AlertSeverity,
      number
    >;
    let open = 0;
    let acknowledged = 0;
    for (const row of alertAgg) {
      counts[row.severity as AlertSeverity] += row._count._all;
      if (row.state === 'OPEN') {
        open += row._count._all;
      }
      if (row.state === 'ACKNOWLEDGED') {
        acknowledged += row._count._all;
      }
    }

    const overall = readiness.tradingReady
      ? services.status === 'HEALTHY'
        ? 'HEALTHY'
        : 'DEGRADED'
      : readiness.status;

    return {
      status: overall,
      tradingReady: readiness.tradingReady,
      alertCounts: counts,
      openAlerts: open,
      acknowledgedAlerts: acknowledged,
      services: services.views,
      queues: queueViews,
      sections: await this.sections(services.views, queueViews, open, acknowledged),
      build: this.healthService.getBuildInfo(),
      note:
        'Derived operational view. Every value is a mirror of engine or infrastructure ' +
        'state at read time; this document is not a source of financial truth and grants nothing. ' +
        'Risk controls reduce operational risk but cannot guarantee against all losses.',
    };
  }

  async marketData(): Promise<{ services: OpsServiceHealthView[]; note: string }> {
    const services = await this.serviceHealth();
    return {
      services: services.views.map((view) => ({
        ...view,
        components: view.components.filter(
          (component) =>
            ['market_data', 'market_data_mirror', 'poller', 'quote_freshness', 'redis'].includes(
              component.component,
            ) || component.component.startsWith('feed'),
        ),
      })),
      note: 'Market-data freshness is reader-side truth: ages are computed against the data, not the poller.',
    };
  }

  async riskPanel(tenantId: string): Promise<OpsOverviewSection[]> {
    const since = new Date(Date.now() - 86_400_000);
    const [eventsBySeverity, staleProtections, engagedSwitches, riskGate] = await Promise.all([
      this.prisma.riskEvent.groupBy({
        by: ['severity'],
        where: { tenantId, createdAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.riskProtectionTrip.count({ where: { tenantId, status: 'ACTIVE' } }),
      this.prisma.killSwitch.count({ where: { scope: 'GLOBAL', isEngaged: true } }),
      this.tradingReadiness(),
    ]);

    const gateRow = (name: string): string => {
      const gate = riskGate.gates.find((candidate) => candidate.gate === name);
      return gate === undefined ? 'unknown' : gate.satisfied ? 'satisfied' : `blocked (${gate.reason})`;
    };

    return [
      {
        title: 'RISK',
        rows: [
          { label: 'risk_state_fresh', value: gateRow('risk_state_fresh'), tone: 'neutral' },
          { label: 'risk_engine', value: gateRow('risk_engine'), tone: 'neutral' },
          {
            label: 'active protections',
            value: String(staleProtections),
            tone: staleProtections > 0 ? 'bad' : 'ok',
          },
          {
            label: 'engaged GLOBAL switches',
            value: String(engagedSwitches),
            tone: engagedSwitches > 0 ? 'bad' : 'ok',
          },
          ...eventsBySeverity.map((row) => ({
            label: `risk events 24h [${row.severity}]`,
            value: String(row._count._all),
            tone: row.severity === 'CRITICAL' || row.severity === 'EMERGENCY' ? ('bad' as const) : ('neutral' as const),
          })),
        ],
      },
    ];
  }

  async executionPanel(tenantId: string): Promise<OpsOverviewSection[]> {
    const since = new Date(Date.now() - 86_400_000);
    const [ordersByStatus, openIncidents, execGate] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['status'],
        where: { tenantId, createdAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.executionIncident.count({ where: { tenantId, resolvedAt: null } }),
      this.tradingReadiness(),
    ]);
    const gate = execGate.gates.find((candidate) => candidate.gate === 'execution_adapter');

    return [
      {
        title: 'EXECUTION',
        rows: [
          {
            label: 'execution adapter (engine mirror)',
            value: gate === undefined ? 'unknown' : gate.satisfied ? 'ready' : `blocked (${gate.reason})`,
            tone: gate?.satisfied ? 'ok' : 'warn',
          },
          {
            label: 'open execution incidents',
            value: String(openIncidents),
            tone: openIncidents > 0 ? 'bad' : 'ok',
          },
          ...ordersByStatus.map((row) => ({
            label: `orders 24h [${row.status}]`,
            value: String(row._count._all),
            tone: row.status === 'REJECTED' || row.status === 'EXPIRED' ? ('warn' as const) : ('neutral' as const),
          })),
        ],
      },
      // Part 20. Everything above this line is this service's own database describing what
      // went through it; the section below is the only thing on the panel that says what the
      // process doing the placing IS - which credential source it was willing to read,
      // whether a confirmation verifier exists, how its live-enablement grading came out,
      // whether anything measures it. Two different authorities, deliberately two sections:
      // the platform's rule is that a derived fact and a self-reported one never share a row.
      await this.enginePosture.section(),
    ];
  }

  async queueStatus(): Promise<{ queues: QueueStatsView[]; note: string }> {
    return {
      queues: await this.queuePanel(),
      note:
        'Depths are BullMQ counters at read time; oldest-waiting is sampled from the head of the wait list. ' +
        'The execution queue alerts at half the age (and CRITICALLY) - the rest are control-plane queues.',
    };
  }

  async datasets(): Promise<OpsOverviewSection[]> {
    const runs = await this.prisma.datasetIngestionRun.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    return [
      {
        title: 'DATASETS',
        rows: runs.map((row) => ({
          label: `ingestion runs [${row.status}]`,
          value: String(row._count._all),
          tone: row.status === 'FAILED' || row.status === 'QUARANTINED' ? ('bad' as const) : ('neutral' as const),
        })),
      },
    ];
  }

  /**
   * Scrape-time refresh of the gauges that are QUERIES, not counters: alert
   * counts and queue depths. Best-effort with honest degradation - a
   * Postgres blip zeroes nothing and errors nothing; the gauge for that
   * scrape is simply absent, and an absent gauge reads as a gap in Grafana,
   * which is the truth ("we could not tell at that moment") rather than a
   * lie (a cached value presented as current, or a zero meaning "healthy").
   */
  async sampleDerivedGauges(registry: {
    setGauge: (name: string, labels: Record<string, string>, value: number) => void;
  }): Promise<void> {
    const [alertCounts, queues] = await Promise.allSettled([
      this.prisma.opsAlert.groupBy({ by: ['severity'], where: { state: { in: ['OPEN', 'ACKNOWLEDGED'] } }, _count: { _all: true } }),
      this.queuePanel(),
    ]);

    if (alertCounts.status === 'fulfilled') {
      const seen = new Map<string, number>(alertCounts.value.map((row) => [String(row.severity), row._count._all]));
      for (const severity of ALERT_SEVERITIES) {
        registry.setGauge('wlct_ops_alert_open_count', { severity }, seen.get(severity) ?? 0);
      }
    }
    if (queues.status === 'fulfilled') {
      for (const queue of queues.value) {
        registry.setGauge('wlct_queue_waiting_jobs', { queue: queue.name }, queue.waiting);
        registry.setGauge(
          'wlct_queue_oldest_waiting_age_ms',
          { queue: queue.name },
          queue.oldestWaitingAgeMs ?? -1,
        );
      }
    }
  }

  // ------------------------------------------------------------------
  // internals
  // ------------------------------------------------------------------
  private async tradingReadiness(): Promise<TradingReadinessView> {
    try {
      return await this.readiness.evaluate();
    } catch (error) {
      this.logger.error(
        { event: 'ops.readiness_evaluation_failed', errorType: (error as Error).name },
        'Trading readiness could not be evaluated; reporting UNHEALTHY (fail closed)',
      );
      return {
        status: 'UNHEALTHY',
        tradingReady: false,
        evaluatedAtMicros: String(BigInt(Date.now()) * 1000n),
        blockingGates: [...TRADING_GATES],
        gates: [],
        enginesReporting: [],
        note: 'evaluation failed; readiness unavailable is treated as not ready, never as ready',
      };
    }
  }

  private async serviceHealth(): Promise<{ views: OpsServiceHealthView[]; status: OpsServiceHealthView['status'] }> {
    const views: OpsServiceHealthView[] = [];
    for (const service of OBS_PUBLISHER_SERVICES) {
      let raw: string | null = null;
      try {
        raw = await this.redis.client.get(`wlct:trading:ops:health:${service}`);
      } catch (error) {
        this.logger.warn(
          { event: 'ops.health_mirror_unreadable', service, errorType: (error as Error).name },
          'Service health mirror unreadable; reported as UNKNOWN (silence is not health)',
        );
      }
      const document = raw === null ? null : parseHealthDocument(raw);
      if (document === null) {
        views.push({
          service,
          status: 'UNKNOWN',
          checkedAt: null,
          ageMicros: null,
          stale: true,
          components: [],
        });
        continue;
      }
      views.push({
        service,
        status: document.status as OpsServiceHealthView['status'],
        checkedAt: new Date(Math.round(document.checkedAtMicros / 1000)).toISOString(),
        ageMicros: null,
        stale: false,
        components: document.components.map((component) =>
          componentView({ ...component, ageMicros: component.ageMicros }, false),
        ),
      });
    }
    const rank = { HEALTHY: 0, DEGRADED: 1, UNKNOWN: 2, UNHEALTHY: 3, STOPPED: 4 } as const;
    const status = views.reduce<OpsServiceHealthView['status']>(
      (worst, view) => (rank[view.status] > rank[worst] ? view.status : worst),
      'HEALTHY',
    );
    return { views, status };
  }

  private async queuePanel(): Promise<QueueStatsView[]> {
    const thresholdMs = this.config.queueAlertAgeMs;
    try {
      const depths = await this.queues.getDepths();
      return depths.map((depth) => {
        const critical = depth.name === 'trade-execution';
        const limit = critical ? Math.floor(thresholdMs / 2) : thresholdMs;
        return {
          name: depth.name,
          waiting: depth.waiting,
          active: depth.active,
          delayed: depth.delayed,
          failed: depth.failed,
          completed: depth.completed,
          paused: depth.paused,
          oldestWaitingAgeMs: depth.oldestWaitingAgeMs,
          alerting: depth.oldestWaitingAgeMs !== null && depth.oldestWaitingAgeMs > limit,
          critical,
        };
      });
    } catch {
      return [];
    }
  }

  private async sections(
    services: OpsServiceHealthView[],
    queues: QueueStatsView[],
    open: number,
    acknowledged: number,
  ): Promise<OpsOverviewSection[]> {
    const readiness = await this.tradingReadiness();
    return [
      {
        title: 'SYSTEM',
        rows: [
          { label: 'build', value: `${readiness.enginesReporting.length > 0 ? 'engines reporting' : 'no engine mirror'}`, tone: 'neutral' },
          ...services.map((service) => ({
            label: `service ${service.service}`,
            value: service.status,
            tone: service.status === 'HEALTHY' ? ('ok' as const) : service.status === 'UNKNOWN' ? ('warn' as const) : ('bad' as const),
          })),
        ],
      },
      {
        title: 'ALERTS',
        rows: [
          { label: 'open', value: String(open), tone: open > 0 ? ('bad' as const) : ('ok' as const) },
          { label: 'acknowledged', value: String(acknowledged), tone: 'warn' as const },
          {
            label: 'trading ready',
            value: readiness.tradingReady ? 'true' : 'false',
            detail: readiness.blockingGates.join(', ') || 'all gates satisfied',
            tone: readiness.tradingReady ? ('ok' as const) : ('bad' as const),
          },
        ],
      },
      {
        title: 'QUEUES',
        rows: queues.map((queue) => ({
          label: queue.name,
          value: `waiting ${queue.waiting}, active ${queue.active}, failed ${queue.failed}`,
          detail:
            queue.oldestWaitingAgeMs === null
              ? 'oldest waiting: n/a'
              : `oldest waiting ${queue.oldestWaitingAgeMs}ms`,
          tone: queue.alerting ? ('bad' as const) : ('neutral' as const),
        })),
      },
    ];
  }
}

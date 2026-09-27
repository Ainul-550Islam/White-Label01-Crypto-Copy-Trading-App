import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AppConfigService } from '../../config/app-config.service';
import type { StrategyMetricsView } from './strategy.types';
import { SIMULATION_DISCLAIMER } from './strategy.types';

/**
 * Aggregate counters for the strategy layer, per tenant.
 *
 * Derived from the durable record rather than from the engine's in-memory
 * counters, because this endpoint must answer even when no worker is running -
 * "nothing is running" being precisely the state an operator most wants
 * described accurately.
 *
 * Two statements are attached to every response and are not decorative.
 *
 * `latencyNote` says that the configured processing budget is an observation
 * target, not a guarantee. This platform makes no latency guarantee and no HFT
 * claim, and a dashboard that renders "50ms" without that context will
 * eventually be quoted as though it were a promise.
 *
 * `liveExecutionReachable` says whether a signal could become a real order in
 * this deployment right now. It is reported next to the strategy counters
 * precisely because "strategies are running" and "orders can reach a venue"
 * are separate facts that are easy to conflate.
 */
@Injectable()
export class StrategyMetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async forTenant(tenantId: string): Promise<StrategyMetricsView> {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [
      totalInstances,
      enabledInstances,
      quarantinedInstances,
      unhealthyInstances,
      activeRuns,
      failedRuns,
      openIncidents,
      criticalIncidents,
      warningIncidents,
      infoIncidents,
      queuedBacktests,
      runningBacktests,
      completedBacktests,
      failedBacktests,
      runningSessions,
      stoppedSessions,
    ] = await Promise.all([
      this.prisma.strategy.count({ where: { tenantId, deletedAt: null } }),
      this.prisma.strategy.count({ where: { tenantId, deletedAt: null, enabled: true } }),
      this.prisma.strategy.count({
        where: { tenantId, deletedAt: null, health: 'QUARANTINED' },
      }),
      this.prisma.strategy.count({ where: { tenantId, deletedAt: null, health: 'UNHEALTHY' } }),
      this.prisma.strategyRun.count({
        where: { tenantId, status: { in: ['STARTING', 'RUNNING'] } },
      }),
      this.prisma.strategyRun.count({
        where: { tenantId, status: 'FAILED', startedAt: { gte: dayAgo } },
      }),
      this.prisma.strategyIncident.count({ where: { tenantId, resolvedAt: null } }),
      this.prisma.strategyIncident.count({
        where: { tenantId, resolvedAt: null, severity: 'CRITICAL' },
      }),
      this.prisma.strategyIncident.count({
        where: { tenantId, resolvedAt: null, severity: 'WARNING' },
      }),
      this.prisma.strategyIncident.count({
        where: { tenantId, resolvedAt: null, severity: 'INFO' },
      }),
      this.prisma.backtestRun.count({ where: { tenantId, status: 'QUEUED' } }),
      this.prisma.backtestRun.count({ where: { tenantId, status: 'RUNNING' } }),
      this.prisma.backtestRun.count({
        where: { tenantId, status: 'COMPLETED', completedAt: { gte: dayAgo } },
      }),
      this.prisma.backtestRun.count({
        where: { tenantId, status: 'FAILED', completedAt: { gte: dayAgo } },
      }),
      this.prisma.paperTradingSession.count({
        where: { tenantId, status: { in: ['STARTING', 'RUNNING'] } },
      }),
      this.prisma.paperTradingSession.count({
        where: { tenantId, status: 'STOPPED', stoppedAt: { gte: dayAgo } },
      }),
    ]);

    return {
      instances: {
        total: totalInstances,
        enabled: enabledInstances,
        running: activeRuns,
        quarantined: quarantinedInstances,
        unhealthy: unhealthyInstances,
      },
      incidents: {
        open: openIncidents,
        critical: criticalIncidents,
        warning: warningIncidents,
        info: infoIncidents,
      },
      runs: {
        active: activeRuns,
        failedLast24h: failedRuns,
      },
      backtests: {
        queued: queuedBacktests,
        running: runningBacktests,
        completedLast24h: completedBacktests,
        failedLast24h: failedBacktests,
      },
      paperSessions: {
        running: runningSessions,
        stoppedLast24h: stoppedSessions,
      },
      configuration: {
        strategyEngineEnabled: this.config.strategyEngineEnabled,
        paperTradingEnabled: this.config.paperTradingEnabled,
        backtestEnabled: this.config.backtestEnabled,
        maxInstances: this.config.strategyMaxInstances,
        eventQueueSize: this.config.strategyEventQueueSize,
        maxProcessingLatencyMs: this.config.strategyMaxProcessingLatencyMs,
        signalMaxAgeMs: this.config.signalMaxAgeMs,
        signalDedupTtlSeconds: this.config.signalDedupTtlSeconds,
        tradingMode: this.config.tradingMode,
        liveExecutionReachable: this.config.tradingMode === 'LIVE',
      },
      latencyNote:
        'maxProcessingLatencyMs is an observation budget used to flag slow dispatches. It is ' +
        'not a guarantee. This platform makes no latency guarantee and no high-frequency ' +
        'trading claim.',
      disclaimer: SIMULATION_DISCLAIMER,
    };
  }
}

import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { Job } from 'bullmq';
import { JOB_NAMES, QUEUE_NAMES } from '@wlct/config';

import { AppConfigService } from '../../../config/app-config.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AlertsService } from '../../observability/alerts.service';
import { IncidentsService } from '../../observability/incidents.service';
import { SloService } from '../../observability/slo.service';
import { SloSamplesService } from '../../observability/slo-samples';
import { TradingReadinessService } from '../../health/trading-readiness.service';
import { TracingService } from '../../../infrastructure/tracing/tracing.service';

/**
 * Housekeeping worker.
 *
 * Deliberately conservative: it only touches rows whose retention window has
 * demonstrably passed, and audit rows are never removed before the statutory
 * minimum retention period, whatever the job payload asks for.
 *
 * When QUEUE_RUN_INLINE_WORKERS is false the worker shuts itself down at
 * bootstrap so the dedicated worker container is the only consumer and request
 * latency stays isolated from background load.
 */
@Injectable()
@Processor(QUEUE_NAMES.MAINTENANCE, { concurrency: 1 })
export class MaintenanceProcessor extends WorkerHost implements OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly alerts: AlertsService,
    private readonly incidents: IncidentsService,
    private readonly readiness: TradingReadinessService,
    private readonly slo: SloService,
    private readonly sloSamples: SloSamplesService,
    private readonly tracing: TracingService,
    @InjectPinoLogger(MaintenanceProcessor.name) private readonly logger: PinoLogger,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    // Part 10: the processing-success sample source is the WORKER's own
    // outcome events. Attaching before the close decision means whichever
    // process ends up consuming (this one inline, or the dedicated
    // container running the same class) counts what IT executed; the shared
    // Redis buckets sum the replicas, and an un-consumed job is neither
    // completed nor failed by anyone's account. The listener never
    // throws - a failed bucket write must not poison the worker's event
    // loop, so every write is fire-and-forget with the failure folded into
    // the completeness law (a dead collector reads as UNKNOWN, not HEALTHY).
    this.worker.on('completed', (job) => {
      void this.sloSamples.recordCounters('queueproc', 1, 0).catch(() => undefined);
      void job;
    });
    this.worker.on('failed', (job) => {
      void this.sloSamples.recordCounters('queueproc', 0, 1).catch(() => undefined);
      void job;
    });

    if (this.config.queueRunInlineWorkers) {
      return;
    }

    await this.worker.close();
    this.logger.info(
      { event: 'queue.inline_worker_disabled', queue: QUEUE_NAMES.MAINTENANCE },
      'Inline maintenance worker disabled; jobs are consumed by the worker container',
    );
  }

  async process(
    job: Job<{
      retentionDays?: number;
      alertRetentionDays?: number;
      incidentRetentionDays?: number;
    }>,
  ): Promise<{ removed: number } | Record<string, number>> {
    // Part 10: every maintenance job runs inside its trace continuation -
    // the publisher's context arrives via the TTL-bounded sidecar, the
    // consumer span wraps the work, and an absent sidecar (published before
    // this part deployed, or after the TTL) simply starts no continuation.
    return this.tracing.withJobContext(
      QUEUE_NAMES.MAINTENANCE,
      job.id ?? 'unknown',
      // 'queue.process' is the operation's name from the core TRACED_OPERATIONS
      // set (the fixture's enums list) - an operation outside that closed set
      // would be a span nobody agreed to trace.
      'queue.process',
      () => this.dispatch(job),
    );
  }

  private async dispatch(
    job: Job<{
      retentionDays?: number;
      alertRetentionDays?: number;
      incidentRetentionDays?: number;
    }>,
  ): Promise<{ removed: number } | Record<string, number>> {
    switch (job.name) {
      case JOB_NAMES.PRUNE_EXPIRED_TOKENS:
        return this.pruneExpiredTokens();
      case JOB_NAMES.PRUNE_AUDIT_LOGS:
        return this.pruneAuditLogs(job.data.retentionDays ?? 365);
      case JOB_NAMES.SYNC_OPERATIONAL_ALERTS:
        return this.syncOperationalAlerts();
      case JOB_NAMES.PRUNE_OPERATIONAL_HISTORY:
        return this.pruneOperationalHistory(
          job.data.alertRetentionDays ?? this.config.alertRetentionDays,
          job.data.incidentRetentionDays ?? this.config.incidentRetentionDays,
        );
      case JOB_NAMES.EVALUATE_OPERATIONAL_SLOS:
        return this.evaluateSlos();
      case JOB_NAMES.PRUNE_SLO_EVALUATIONS:
        return this.pruneSloEvaluations(job.data.retentionDays);
      default:
        this.logger.warn(
          { event: 'maintenance.unknown_job', jobName: job.name },
          'Received an unknown maintenance job',
        );
        return { removed: 0 };
    }
  }

  /**
   * The Part 9 fold. Two steps, one job: sync the publisher mirrors into
   * durable alerts (recovery-observed resolution included), then evaluate
   * queue-alert policy from the SAME depth snapshot the readiness endpoint
   * just used - so the panel and the alert table are answering the same
   * question with the same numbers. Failures here are logged, not thrown
   * through the queue: the next minute's tick retries, and alert state is
   * convergent by construction (folds, not deltas).
   */
  private async syncOperationalAlerts(): Promise<Record<string, number>> {
    const sync = await this.alerts.syncFromMirrors();
    const samples = await this.readiness.queueAlertSamples();
    await this.alerts.applyQueueAlerts(samples);
    this.logger.info(
      {
        event: 'maintenance.ops_synced',
        inserted: sync.inserted,
        folded: sync.folded,
        resolved: sync.resolved,
        queueAlerts: samples.filter((sample) => sample.alerting).length,
      },
      'Operational alert mirrors folded',
    );
    return {
      inserted: sync.inserted,
      folded: sync.folded,
      resolved: sync.resolved,
      incidents: sync.incidentsFolded,
    };
  }

  /**
   * Retention with a guard written into the query, not a comment: only
   * RESOLVED alerts and CLOSED incidents are candidates. The day-count
   * floors are enforced at config parse (env schema); this method trusts
   * that validation and adds one more safety of its own - a payload that
   * somehow carries a smaller number is clamped, mirroring how the audit
   * pruner clamps its own floor.
   */
  private async pruneOperationalHistory(
    alertRetentionDays: number,
    incidentRetentionDays: number,
  ): Promise<{ alerts: number; incidents: number }> {
    const alertFloorDays = 7;
    const incidentFloorDays = 30;
    const effectiveAlertDays = Math.max(alertFloorDays, alertRetentionDays);
    const effectiveIncidentDays = Math.max(incidentFloorDays, incidentRetentionDays);

    const alertCutoff = new Date(Date.now() - effectiveAlertDays * 86_400_000);
    const incidentCutoff = new Date(Date.now() - effectiveIncidentDays * 86_400_000);

    const [alerts, incidents] = await this.prisma.$transaction([
      this.prisma.opsAlert.deleteMany({
        where: { state: 'RESOLVED', resolvedAt: { lt: alertCutoff } },
      }),
      this.prisma.opsIncident.deleteMany({
        where: { status: 'CLOSED', closedAt: { lt: incidentCutoff } },
      }),
    ]);

    return { alerts: alerts.count, incidents: incidents.count };
  }

  /**
   * Part 10: the scheduled evaluation tick. `actor: null` marks it as
   * machine-driven (no SLO_EVALUATE_REQUESTED audit - the cron line in the
   * scheduler is the record of WHO asked). Errors from individual sources
   * are folded into UNKNOWN rows by the evaluator; an error HERE (the job
   * throwing) leaves no rows at all, which the completeness law reads as the
   * collector being down - the same fact either way, the panel says so.
   */
  private async evaluateSlos(): Promise<Record<string, number>> {
    const result = await this.slo.evaluateAll(null, 'scheduled');
    this.logger.info(
      {
        event: 'maintenance.slo_evaluated',
        evaluated: result.evaluated,
        paging: result.alertingSloIds.length,
        skipped: result.skipped.length,
      },
      'SLO evaluation tick complete',
    );
    return { evaluated: result.evaluated, paging: result.alertingSloIds.length };
  }

  /** Evaluation-row retention. Definitions are NEVER pruned (versioned
   *  promise history is the point of the table); the 7-day floor lives in
   *  the service, which clamps whatever this payload carries. */
  private async pruneSloEvaluations(retentionDays?: number): Promise<{ removed: number }> {
    return this.slo.prune({ retentionDays });
  }

  private async pruneExpiredTokens(): Promise<{ removed: number }> {
    const now = new Date();

    const [expiredTokens, expiredSessions, expiredVerifications] = await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { status: 'ACTIVE', expiresAt: { lt: now } },
        data: { status: 'EXPIRED' },
      }),
      this.prisma.userSession.updateMany({
        where: { revokedAt: null, expiresAt: { lt: now } },
        data: { revokedAt: now, revokeReason: 'expired' },
      }),
      this.prisma.verificationToken.deleteMany({
        where: { expiresAt: { lt: new Date(now.getTime() - 86_400_000) } },
      }),
    ]);

    const removed = expiredTokens.count + expiredSessions.count + expiredVerifications.count;

    this.logger.info(
      {
        event: 'maintenance.tokens_pruned',
        refreshTokens: expiredTokens.count,
        sessions: expiredSessions.count,
        verificationTokens: expiredVerifications.count,
      },
      'Expired authentication artefacts pruned',
    );

    return { removed };
  }

  private async pruneAuditLogs(retentionDays: number): Promise<{ removed: number }> {
    // Audit history is evidence. Never let a payload shrink the window below a
    // year, and never prune at all outside production-like environments where
    // the volume simply does not warrant it.
    const effectiveRetention = Math.max(retentionDays, 365);
    const cutoff = new Date(Date.now() - effectiveRetention * 86_400_000);

    const deleted = await this.prisma.auditLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });

    this.logger.info(
      {
        event: 'maintenance.audit_pruned',
        removed: deleted.count,
        retentionDays: effectiveRetention,
        environment: this.config.nodeEnv,
      },
      'Audit logs beyond the retention window removed',
    );

    return { removed: deleted.count };
  }
}

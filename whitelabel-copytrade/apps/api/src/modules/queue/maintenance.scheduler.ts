import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { JOB_NAMES, QUEUE_NAMES } from '@wlct/config';

import { AppConfigService } from '../../config/app-config.service';
import { QueueService } from './queue.service';

/**
 * Registers the platform's repeatable jobs once the application is up.
 *
 * Repeat definitions are keyed by job id, so restarting or scaling the API does
 * not create duplicate schedules.
 */
@Injectable()
export class MaintenanceScheduler implements OnApplicationBootstrap {
  constructor(
    private readonly queues: QueueService,
    private readonly config: AppConfigService,
    @InjectPinoLogger(MaintenanceScheduler.name) private readonly logger: PinoLogger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      // Every 15 minutes: expire stale refresh tokens and sessions.
      await this.queues.schedule(
        QUEUE_NAMES.MAINTENANCE,
        JOB_NAMES.PRUNE_EXPIRED_TOKENS,
        {},
        '*/15 * * * *',
      );

      // Nightly at 03:20 UTC: trim audit history beyond the retention window.
      await this.queues.schedule(
        QUEUE_NAMES.MAINTENANCE,
        JOB_NAMES.PRUNE_AUDIT_LOGS,
        { retentionDays: 365 },
        '20 3 * * *',
      );

      // Part 9: every minute, fold the trading plane's alert mirrors into
      // durable rows (and reconcile queue-alert policy). The cadence is one
      // minute because that is the granularity at which a stale "0 alerts"
      // panel starts to actively mislead; the work is a handful of Redis
      // reads and upserts, sized against the DEDUPED alert count, not the
      // event rate that produced it.
      await this.queues.schedule(
        QUEUE_NAMES.MAINTENANCE,
        JOB_NAMES.SYNC_OPERATIONAL_ALERTS,
        {},
        '* * * * *',
      );

      // Nightly at 03:40 UTC: retention for resolved alerts and closed
      // incidents. Unresolved history is never touched - the service's
      // where-clauses enforce that; this schedule only decides WHEN the
      // eligible rows go.
      await this.queues.schedule(
        QUEUE_NAMES.MAINTENANCE,
        JOB_NAMES.PRUNE_OPERATIONAL_HISTORY,
        {
          alertRetentionDays: this.config.alertRetentionDays,
          incidentRetentionDays: this.config.incidentRetentionDays,
        },
        '40 3 * * *',
      );

      // Part 10: SLO evaluation. The cadence is the CONFIGURED interval
      // (clamped into the cron minute field's range); the evaluator writes
      // one row per enabled objective per tick and nothing else. It reads
      // buckets and durable tables - no trading path depends on this job,
      // and it failing for an hour costs an hour of rows, never a decision.
      const sloInterval = Math.min(59, Math.max(1, this.config.sloEvaluationIntervalMinutes));
      if (this.config.sloEnabled) {
        await this.queues.schedule(
          QUEUE_NAMES.MAINTENANCE,
          JOB_NAMES.EVALUATE_OPERATIONAL_SLOS,
          {},
          `*/${String(sloInterval)} * * * *`,
        );

        // Nightly at 03:50 UTC: evaluation-row retention (definitions are
        // never pruned; the 7-day floor is enforced in the processor).
        await this.queues.schedule(
          QUEUE_NAMES.MAINTENANCE,
          JOB_NAMES.PRUNE_SLO_EVALUATIONS,
          { retentionDays: this.config.sloRetentionDays },
          '50 3 * * *',
        );
      }

      this.logger.info({ event: 'maintenance.scheduled' }, 'Repeatable maintenance jobs registered');
    } catch (error) {
      // A scheduling failure must not stop the API from serving traffic.
      this.logger.error(
        {
          event: 'maintenance.schedule_failed',
          err: error instanceof Error ? { message: error.message, name: error.name } : undefined,
        },
        'Could not register repeatable maintenance jobs',
      );
    }
  }
}

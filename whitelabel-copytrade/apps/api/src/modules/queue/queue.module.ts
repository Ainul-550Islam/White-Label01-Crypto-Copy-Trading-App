import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '@wlct/config';

import { AppConfigModule } from '../../config/app-config.module';
import { HealthModule } from '../health/health.module';
import { ObservabilityModule } from '../observability/observability.module';
import { AppConfigService } from '../../config/app-config.service';
import { QueueService } from './queue.service';
import { MaintenanceProcessor } from './processors/maintenance.processor';
import { MaintenanceScheduler } from './maintenance.scheduler';

const REGISTERED_QUEUES = Object.values(QUEUE_NAMES);

/**
 * Background work.
 *
 * Every queue the platform will ever use is registered up-front so producers
 * can enqueue safely even before the corresponding worker exists (Part 3's
 * trading queues are declared but consumed elsewhere). Workers only run inside
 * the API process when QUEUE_RUN_INLINE_WORKERS is true - in production the
 * dedicated worker container owns them, keeping request latency isolated from
 * background load.
 */
@Global()
@Module({
  imports: [
    // Part 9: the maintenance processor folds operational alert mirrors and
    // applies queue-alert policy, which lives in the observability plane.
    // Direction check, stated because a module cycle would undo it:
    // queue <- observability <- health, and the queue module is @Global, so
    // observability never needs to import queue back. The graph stays a DAG.
    HealthModule,
    ObservabilityModule,
    BullModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        connection: config.queueRedisOptions,
        prefix: config.queuePrefix,
        defaultJobOptions: {
          attempts: config.queueDefaultAttempts,
          backoff: { type: 'exponential', delay: config.queueBackoffMs },
          removeOnComplete: config.queueRemoveOnComplete,
          removeOnFail: config.queueRemoveOnFail,
        },
      }),
    }),
    ...REGISTERED_QUEUES.map((name) => BullModule.registerQueue({ name })),
  ],
  providers: [QueueService, MaintenanceProcessor, MaintenanceScheduler],
  exports: [QueueService, BullModule],
})
export class QueueModule {}

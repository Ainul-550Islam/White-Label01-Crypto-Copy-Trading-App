/**
 * The trading-worker plane, as a module the PUBLIC API never imports.
 *
 * WorkerModule is the whole difference between "an API that also does
 * background execution work" and "a worker": it is mounted by src/worker.ts
 * only. Nothing here reaches a database or a venue directly - the processor
 * forwards to the execution engine precisely so this process keeps zero
 * money-path authority beyond queue admission itself. That is the Part 5
 * boundary (execution.module.ts: "no adapter, no signer, no credential
 * provider"), re-armed from the other side: the worker can schedule venue
 * work and cannot perform it, the engine can perform it and schedules
 * nothing.
 *
 * QueueModule comes along for the ride (it is @Global and provides the
 * BullMQ registration + the maintenance/notification workers under the
 * QUEUE_RUN_INLINE_WORKERS law the containers have always used);
 * importing it does not import any API HTTP surface, because there is no
 * HTTP in this process at all.
 */

import { Module } from '@nestjs/common';

import { AppConfigModule } from '../../config/app-config.module';
import { LoggerModule } from '../../infrastructure/logger/logger.module';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { AuditModule } from '../audit/audit.module';
import { ObservabilityModule } from '../observability/observability.module';
import { QueueModule } from '../queue/queue.module';
import { EngineInternalClient } from './engine-internal.client';
import { TradeExecutionProcessor } from './trade-execution.processor';
import { WorkerCoordinationService } from './worker-coordination.service';

@Module({
  // WorkerModule is the ROOT module of the worker process, so it registers the
  // logger exactly as AppModule does (dynamic forRoot(), see logger.module.ts):
  // RedisService and the queue workers inject named Pino loggers, and without
  // this the worker container could not boot at all (round 8, found by running
  // the compose stack; scripts/check-api-di.mjs now resolves this graph too).
  //
  // ObservabilityModule is already part of this graph (QueueModule imports it);
  // importing it here only makes its exports - the TracingService and
  // SloSamplesService instances TradeExecutionProcessor injects - visible to
  // this module. No second registry or tracer is created.
  //
  // PrismaModule: that same observability plane (and the maintenance processor
  // QueueModule runs here under QUEUE_RUN_INLINE_WORKERS) reads the database;
  // AppModule registers the client globally and so must the worker's root. The
  // trade-execution path itself still never touches the database: it forwards
  // to the execution engine. AuditModule: the alert fold writes audit rows
  // (AlertsService injects AuditService), as it does in the API process.
  imports: [
    AppConfigModule,
    LoggerModule.forRoot(),
    PrismaModule,
    RedisModule,
    AuditModule,
    ObservabilityModule,
    QueueModule,
  ],
  providers: [WorkerCoordinationService, EngineInternalClient, TradeExecutionProcessor],
})
export class WorkerModule {}

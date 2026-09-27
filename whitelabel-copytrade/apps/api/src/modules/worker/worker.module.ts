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
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { QueueModule } from '../queue/queue.module';
import { EngineInternalClient } from './engine-internal.client';
import { TradeExecutionProcessor } from './trade-execution.processor';
import { WorkerCoordinationService } from './worker-coordination.service';

@Module({
  imports: [AppConfigModule, RedisModule, QueueModule],
  providers: [WorkerCoordinationService, EngineInternalClient, TradeExecutionProcessor],
})
export class WorkerModule {}

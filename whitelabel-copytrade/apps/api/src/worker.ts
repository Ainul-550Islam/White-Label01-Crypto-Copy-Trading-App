/**
 * Trading-worker bootstrap: this process consumes; it never serves.
 *
 * There is no HTTP server here by construction, not by configuration:
 * createApplicationContext builds the DI graph and stops. An operator who
 * wants to read what the worker thinks must read its logs - which carry
 * claim state and job outcomes and never carry tokens or venue payloads.
 *
 * Lifecycle, in the order it actually matters:
 *  1. configuration parses (validateEnv inside the config module) - bad
 *     config exits nonzero before anything touches Redis;
 *  2. WORKER_ENABLED is honoured: false exits nonzero rather than running a
 *     silently-idle consumer, because "started and doing nothing" is the
 *     hardest failure mode an operator has to debug;
 *  3. the engine compatibility gate runs: the execution engine must answer,
 *     report the mode this build forwards to, and expose the command set.
 *     A worker that boots ahead of its engine would otherwise queue ack-less
 *     retries against a void and blame Redis for it;
 *  4. the coordination tick starts inside the module lifecycle and claims
 *     immediately (first tick is synchronous with construction, then every
 *     WORKER_PARTITION_RETRY_MS);
 *  5. shutdown drains: BullMQ workers pause first (no new jobs), held
 *     claims release second (owners move on without a TTL wait), connections
 *     close last. The whole sequence is bounded by
 *     WORKER_SHUTDOWN_TIMEOUT_MS; past that, process exit stands on the
 *     lease TTL - degraded, correct, and the reason TTLs exist.
 */

import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';

import { AppConfigService } from './config/app-config.service';
import { EngineInternalClient } from './modules/worker/engine-internal.client';
import { WorkerModule } from './modules/worker/worker.module';

/**
 * Refuse to start: say why, release what the context opened, and exit nonzero.
 *
 * Round 8 (Docker run): these paths used to set `process.exitCode = 1` and return.
 * That only ends the process once the event loop is empty, and after `app.close()`
 * something in the graph (BullMQ / ioredis handles) kept it alive, so a worker that
 * had refused its engine stayed "Up" with no consumer and restart: unless-stopped
 * never fired - exactly the "started and doing nothing" mode point 2 above forbids.
 * The close is bounded the same way the SIGTERM drain is, so a hung close cannot
 * hold the refusal hostage either.
 */
async function refuseToStart(
  app: INestApplicationContext,
  logger: Logger,
  shutdownTimeoutMs: number,
  message: string,
): Promise<never> {
  logger.error(message);
  const deadline = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, shutdownTimeoutMs);
    timer.unref();
  });
  try {
    await Promise.race([app.close(), deadline]);
  } catch (error) {
    logger.error(
      `close after refusal failed (${error instanceof Error ? error.message : 'unknown'}); exiting anyway`,
    );
  }
  process.exit(1);
}

async function bootstrap(): Promise<void> {
  const logger = new Logger('WorkerBootstrap');

  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
    abortOnError: false,
  });
  // Same wiring as main.ts. With bufferLogs: true and no useLogger/flushLogs, every
  // Nest Logger line - including the refusal reasons below - stayed in the buffer
  // and was never written: the round-8 Docker run showed a worker closing itself
  // 50 ms after start with no reason anywhere in its output.
  app.useLogger(app.get(PinoLogger));
  app.flushLogs();
  const config = app.get(AppConfigService);

  if (!config.workerEnabled) {
    await refuseToStart(
      app,
      logger,
      config.workerShutdownTimeoutMs,
      'WORKER_ENABLED=false: this process refuses to idle. A worker that ' +
        'consumes nothing and looks healthy is an outage with extra steps.',
    );
  }

  if (config.executionEngineToken === undefined) {
    await refuseToStart(
      app,
      logger,
      config.workerShutdownTimeoutMs,
      'EXECUTION_ENGINE_TOKEN is required by the worker: it forwards commands ' +
        'into the process that holds venue credentials.',
    );
  }

  const client = app.get(EngineInternalClient);
  try {
    const status = await client.assertEngineCompatible();
    logger.log(
      `execution engine compatible: mode=${status.mode} instance=${status.instanceId} ` +
        `store=${status.store} commands=${status.commands.join(',')}`,
    );
  } catch (error) {
    await refuseToStart(
      app,
      logger,
      config.workerShutdownTimeoutMs,
      `execution engine gate failed: ${error instanceof Error ? error.message : 'unknown'}`,
    );
  }

  app.enableShutdownHooks();
  logger.log(
    `worker ${config.workerId} online: partitions=${config.workerPartitionCount} ` +
      `membership=${config.workerMembership.length} defer=${config.workerDeferDelayMs}ms ` +
      `shutdown budget=${config.workerShutdownTimeoutMs}ms`,
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`${signal}: draining worker`);
    const deadline = new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`shutdown exceeded ${config.workerShutdownTimeoutMs}ms`)),
        config.workerShutdownTimeoutMs,
      );
      timer.unref();
    });
    try {
      await Promise.race([app.close(), deadline]);
      logger.log('worker drained cleanly');
    } catch (error) {
      // The forced path is SAFE, not hopeful: un-acked jobs stay in their
      // queues (at-least-once), and held claims expire by TTL, which is the
      // same recovery any crash follows. The log says so loudly because
      // making it quiet would be making it a lie.
      logger.error(
        `drain incomplete (${error instanceof Error ? error.message : 'unknown'}); ` +
          'exiting anyway - claims release by TTL and unacked jobs redeliver',
      );
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void bootstrap().catch((error: unknown) => {
  new Logger('WorkerBootstrap').error(
    `worker failed to start: ${error instanceof Error ? error.message : 'unknown'}`,
  );
  // Exit now rather than only setting exitCode: a half-built context keeps
  // Redis / BullMQ connections open, and those hold the event loop, so the
  // process would otherwise linger as a running container that consumes
  // nothing - the "started and doing nothing" failure described above. Exiting
  // nonzero lets the orchestrator's restart policy see and retry it.
  process.exit(1);
});

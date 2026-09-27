import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { createServer } from 'node:http';
import { JOB_NAMES, QUEUE_NAMES } from '@wlct/config';
import type { EmailJob } from '@wlct/shared-types';

import { loadConfig } from './config';
import { createLogger } from './logger';
import { EmailChannel } from './channels/email.channel';
import { PushChannel } from './channels/push.channel';

/**
 * Standalone notification worker.
 *
 * Runs the EMAIL queue outside the API process so a slow or unavailable mail
 * provider can never add latency to an HTTP request. It owns no database
 * connection by design: everything it needs (recipient, locale, branding
 * snapshot, rendered copy) travels on the job, which keeps the blast radius of
 * this container small and lets it scale independently.
 */
async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);

  const connection = new IORedis({
    host: config.REDIS_HOST,
    port: config.REDIS_PORT,
    password: config.REDIS_PASSWORD || undefined,
    db: config.REDIS_DB,
    tls: config.REDIS_TLS ? {} : undefined,
    // BullMQ requires blocking commands to wait indefinitely.
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });

  connection.on('error', (error: Error) => {
    logger.error({ event: 'redis.error', message: error.message }, 'Redis connection error');
  });

  const emailChannel = new EmailChannel(config, logger);
  const pushChannel = new PushChannel(config, logger);

  const transportReady = await emailChannel.verify();
  if (!transportReady && config.NODE_ENV === 'production') {
    throw new Error('Refusing to start: the mail transport failed verification.');
  }

  const worker = new Worker<EmailJob>(
    QUEUE_NAMES.EMAIL,
    async (job: Job<EmailJob>) => {
      if (job.name !== JOB_NAMES.SEND_EMAIL) {
        logger.warn({ event: 'email.unknown_job', jobName: job.name }, 'Unknown job skipped');
        return { delivered: false };
      }

      const startedAt = Date.now();
      const result = await emailChannel.send(job.data);

      logger.info(
        {
          event: 'email.sent',
          tenantId: job.data.tenantId,
          templateType: job.data.templateType,
          locale: job.data.locale,
          durationMs: Date.now() - startedAt,
          attempt: job.attemptsMade + 1,
        },
        'Transactional email processed',
      );

      return result;
    },
    {
      connection,
      prefix: config.QUEUE_PREFIX,
      concurrency: config.QUEUE_CONCURRENCY,
      // Providers rate limit aggressively; stay well inside typical quotas.
      limiter: { max: 50, duration: 1000 },
    },
  );

  worker.on('failed', (job: Job<EmailJob> | undefined, error: Error) => {
    logger.error(
      {
        event: 'email.failed',
        jobId: job?.id,
        tenantId: job?.data?.tenantId,
        templateType: job?.data?.templateType,
        attempt: (job?.attemptsMade ?? 0) + 1,
        err: { name: error.name, message: error.message },
      },
      'Email delivery failed',
    );
  });

  worker.on('error', (error: Error) => {
    logger.error({ event: 'worker.error', message: error.message }, 'Worker error');
  });

  // Minimal health endpoint so Docker/Kubernetes can probe the container.
  const healthServer = createServer((request, response) => {
    if (request.url === '/health' || request.url === '/health/ready') {
      const healthy = worker.isRunning() && connection.status === 'ready';
      response.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          status: healthy ? 'ok' : 'degraded',
          service: 'notification-service',
          worker: worker.isRunning() ? 'running' : 'stopped',
          redis: connection.status,
          mailDriver: config.MAIL_DRIVER,
          pushConfigured: pushChannel.isConfigured,
          uptimeSeconds: Math.floor(process.uptime()),
        }),
      );
      return;
    }

    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not_found' }));
  });

  healthServer.listen(config.NOTIFICATION_SERVICE_PORT, config.NOTIFICATION_SERVICE_HOST, () => {
    logger.info(
      {
        event: 'service.started',
        port: config.NOTIFICATION_SERVICE_PORT,
        queue: QUEUE_NAMES.EMAIL,
        concurrency: config.QUEUE_CONCURRENCY,
        mailDriver: config.MAIL_DRIVER,
      },
      'Notification service started',
    );
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ event: 'service.stopping', signal }, 'Shutting down');
    healthServer.close();
    // `close()` waits for in-flight jobs so no email is lost mid-deploy.
    await worker.close();
    await emailChannel.close();
    await connection.quit();
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`Fatal notification-service error: ${message}\n`);
  process.exit(1);
});

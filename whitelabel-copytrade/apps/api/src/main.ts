import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger as PinoLogger } from 'nestjs-pino';
import { VersioningType } from '@nestjs/common';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { Request, Response, NextFunction } from 'express';

import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';
import { setupSwagger } from './config/swagger.config';
import { RedisIoAdapter } from './modules/realtime/redis-io.adapter';
import { RedisService } from './infrastructure/redis/redis.service';
import { HEADER_REQUEST_ID } from '@wlct/config';

/**
 * Application entrypoint.
 *
 * Bootstrapping order matters: configuration is validated before anything else,
 * security middleware is installed before routing, and the HTTP server is only
 * opened once every module reports ready. Shutdown hooks are enabled so Prisma,
 * Redis and BullMQ can drain in-flight work during a rolling deploy.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    // The global exception filter owns error shaping; disable Nest's default.
    abortOnError: false,
  });

  const logger = app.get(PinoLogger);
  app.useLogger(logger);
  app.flushLogs();

  const config = app.get(AppConfigService);

  // Behind a load balancer the client IP must come from X-Forwarded-For, which
  // rate limiting and audit logging both depend on.
  app.set('trust proxy', config.trustProxyHops);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: config.isProduction
        ? {
            directives: {
              defaultSrc: ["'self'"],
              baseUri: ["'self'"],
              fontSrc: ["'self'", 'https:', 'data:'],
              formAction: ["'self'"],
              frameAncestors: ["'none'"],
              imgSrc: ["'self'", 'data:', 'https:'],
              objectSrc: ["'none'"],
              scriptSrc: ["'self'"],
              scriptSrcAttr: ["'none'"],
              styleSrc: ["'self'", 'https:', "'unsafe-inline'"],
              upgradeInsecureRequests: [],
            },
          }
        : false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: config.isProduction
        ? { maxAge: 31536000, includeSubDomains: true, preload: true }
        : false,
    }),
  );

  app.use(compression());
  app.use(cookieParser());

  // Hard cap on request size: nothing this API accepts legitimately exceeds it.
  app.useBodyParser('json', { limit: '512kb' });
  app.useBodyParser('urlencoded', { limit: '512kb', extended: true });

  // Surface the correlation id on every response, including error paths.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = (req as Request & { id?: string }).id;
    if (requestId) {
      res.setHeader(HEADER_REQUEST_ID, requestId);
    }
    next();
  });

  if (config.corsEnabled) {
    app.enableCors({
      origin: config.corsOriginValidator,
      credentials: config.corsCredentials,
      allowedHeaders: config.corsAllowedHeaders,
      exposedHeaders: config.corsExposedHeaders,
      methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      maxAge: 86400,
    });
  }

  // Health routes are excluded from the global prefix so probes can hit
  // `/health*` directly. Nest matches these entries literally, so each
  // sub-route of HealthController must be listed here; the controller itself is
  // VERSION_NEUTRAL so URI versioning does not re-add a `/v1` segment.
  app.setGlobalPrefix(config.globalPrefix, {
    exclude: ['health', 'health/ready', 'health/deep', 'health/startup', 'health/trading', 'metrics'],
  });

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: config.defaultApiVersion,
    prefix: 'v',
  });

  if (config.wsEnabled) {
    const redisIoAdapter = new RedisIoAdapter(app, config, app.get(RedisService));
    await redisIoAdapter.connectToRedis();
    app.useWebSocketAdapter(redisIoAdapter);
  }

  setupSwagger(app, config);

  app.enableShutdownHooks();

  await app.listen(config.port, config.host);

  const url = await app.getUrl();
  logger.log(
    {
      event: 'application.started',
      environment: config.nodeEnv,
      port: config.port,
      globalPrefix: config.globalPrefix,
      apiVersion: config.defaultApiVersion,
      swagger: config.swaggerEnabled ? `${url}/${config.swaggerPath}` : 'disabled',
      websocket: config.wsEnabled ? config.wsPath : 'disabled',
      executionEnabled: config.executionEnabled,
    },
    'API bootstrap complete',
  );
}

bootstrap().catch((error: unknown) => {
  // The logger may not exist yet at this point, so stderr is the only sink.
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`Fatal bootstrap error: ${message}\n`);
  process.exit(1);
});

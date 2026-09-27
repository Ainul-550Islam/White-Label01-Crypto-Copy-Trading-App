import { Global, Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PINO_REDACT_PATHS } from '@wlct/utils';
import { REDACTED_PLACEHOLDER } from '@wlct/config';

import { AppConfigService } from '../../config/app-config.service';
import { AppConfigModule } from '../../config/app-config.module';
import type { AppRequest } from '../../common/types/request.types';

/**
 * Structured logging.
 *
 * Every line is JSON in non-local environments so it can be shipped straight to
 * Loki/Datadog. Redaction is applied by pino itself (not by call sites), which
 * means a developer cannot accidentally log a password by passing an object:
 * the transport removes those paths before serialisation.
 *
 * pino-http types its hooks against the raw Node `IncomingMessage`, while the
 * values at runtime are Express requests enriched by our middleware. The hooks
 * below therefore accept the Node types and narrow once, in one place, instead
 * of scattering casts through the callbacks.
 *
 * IMPORTANT - why this module is dynamic (`LoggerModule.forRoot()`) instead of
 * a plain `@Module({ imports: [PinoLoggerModule.forRootAsync(...)] })`:
 *
 * `@InjectPinoLogger(Context)` works by pushing `Context` into a module-level
 * `Set` inside nestjs-pino at *decorator evaluation time*, and
 * `PinoLoggerModule.forRootAsync()` turns whatever is in that `Set` at *call
 * time* into `PinoLogger:<Context>` providers. A static `@Module` decorator on
 * this file evaluates `forRootAsync()` the moment this file is imported, which
 * - because the root module imports this file near the top - happens before any
 * decorated service has been loaded. The `Set` is still empty, no named
 * providers are created, and the application dies at bootstrap with
 * "Nest can't resolve dependencies of the PrismaService (AppConfigService, ?)".
 *
 * Exposing a static `forRoot()` moves the `forRootAsync()` call into the root
 * module's own `@Module({ imports: [...] })` evaluation. By that point Node has
 * finished evaluating the entire import graph of the root module, so every
 * `@InjectPinoLogger` decorator in the application has already run and every
 * named logger provider exists. This is order-independent: adding a new
 * decorated service later requires no change here.
 */
function asAppRequest(req: IncomingMessage): AppRequest {
  return req as unknown as AppRequest;
}

@Global()
@Module({})
export class LoggerModule {
  static forRoot(): DynamicModule {
    const pinoModule = PinoLoggerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        pinoHttp: {
          level: config.logLevel,
          name: config.appName,
          transport:
            config.logFormat === 'pretty'
              ? {
                  target: 'pino-pretty',
                  options: {
                    colorize: true,
                    singleLine: false,
                    translateTime: 'SYS:standard',
                    ignore: 'pid,hostname',
                  },
                }
              : undefined,
          redact: {
            paths: PINO_REDACT_PATHS,
            censor: REDACTED_PLACEHOLDER,
          },
          genReqId: (req: IncomingMessage): string =>
            asAppRequest(req).requestId ?? String((req as { id?: unknown }).id ?? ''),
          autoLogging: {
            ignore: (req: IncomingMessage): boolean => {
              const url = req.url ?? '';
              return url.startsWith('/health') || url.startsWith('/metrics');
            },
          },
          customProps: (req: IncomingMessage): Record<string, unknown> => {
            const request = asAppRequest(req);
            return {
              tenantId: request.tenantContext?.tenantId,
              userId: request.actor?.userId,
              sessionId: request.actor?.sessionId,
              locale: request.locale,
            };
          },
          serializers: {
            req: (req: IncomingMessage & { raw?: IncomingMessage }): Record<string, unknown> => {
              const source = req.raw ?? req;
              const request = asAppRequest(source);
              return {
                id: request.requestId,
                method: source.method,
                url: (source.url ?? '').split('?')[0],
                // Raw IPs are never logged; only the keyed hash.
                ipHash: request.ipHash,
                userAgent: source.headers?.['user-agent'],
                ...(config.logRequestBody ? { body: request.body } : {}),
              };
            },
            res: (res: ServerResponse): Record<string, unknown> => ({
              statusCode: res.statusCode,
            }),
            err: (error: Error): Record<string, unknown> => ({
              type: error.name,
              message: error.message,
              stack: config.isProduction ? undefined : error.stack,
            }),
          },
          customLogLevel: (
            _req: IncomingMessage,
            res: ServerResponse,
            error?: Error,
          ): 'error' | 'warn' | 'info' => {
            if (error) {
              return 'error';
            }
            if (res.statusCode >= 500) {
              return 'error';
            }
            if (res.statusCode >= 400) {
              return 'warn';
            }
            return 'info';
          },
          customSuccessMessage: (req: IncomingMessage, res: ServerResponse): string =>
            `${req.method} ${(req.url ?? '').split('?')[0]} -> ${res.statusCode}`,
          customErrorMessage: (req: IncomingMessage, res: ServerResponse, _error: Error): string =>
            `${req.method} ${(req.url ?? '').split('?')[0]} -> ${res.statusCode}`,
        },
      }),
    });

    return {
      module: LoggerModule,
      imports: [pinoModule],
      exports: [pinoModule],
    };
  }
}

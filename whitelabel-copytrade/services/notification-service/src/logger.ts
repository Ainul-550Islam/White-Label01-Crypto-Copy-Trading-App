import pino, { type Logger } from 'pino';
import { PINO_REDACT_PATHS } from '@wlct/utils';
import { REDACTED_PLACEHOLDER } from '@wlct/config';

import type { WorkerConfig } from './config';

/**
 * Structured logging for the worker. Shares the API's redaction path list so a
 * credential can never reach a log sink from either process.
 */
export function createLogger(config: WorkerConfig): Logger {
  return pino({
    name: 'notification-service',
    level: config.LOG_LEVEL,
    redact: { paths: [...PINO_REDACT_PATHS], censor: REDACTED_PLACEHOLDER },
    transport:
      config.LOG_FORMAT === 'pretty'
        ? {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
          }
        : undefined,
    base: { service: 'notification-service', env: config.NODE_ENV },
  });
}

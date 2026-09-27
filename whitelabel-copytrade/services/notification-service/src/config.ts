import { z } from 'zod';

/**
 * Worker configuration.
 *
 * Validated at boot with the same strictness as the API: an unset or malformed
 * variable stops the process rather than producing a worker that silently
 * fails to deliver mail. No secret has a default value.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  LOG_FORMAT: z.enum(['json', 'pretty']).default('json'),

  REDIS_HOST: z.string().min(1),
  REDIS_PORT: z.coerce.number().int().min(1).max(65535).default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().int().min(0).max(15).default(0),
  REDIS_TLS: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),

  QUEUE_PREFIX: z.string().min(1).default('wlct'),
  QUEUE_CONCURRENCY: z.coerce.number().int().min(1).max(200).default(10),
  QUEUE_DEFAULT_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  QUEUE_BACKOFF_MS: z.coerce.number().int().min(100).default(5000),

  MAIL_DRIVER: z.enum(['console', 'smtp', 'ses', 'sendgrid', 'postmark']).default('console'),
  MAIL_FROM_NAME: z.string().min(1).default('Copy Trading Platform'),
  MAIL_FROM_ADDRESS: z.string().email(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: z
    .string()
    .default('true')
    .transform((value) => value === 'true'),

  PUSH_PROVIDER: z.enum(['none', 'fcm', 'apns', 'expo']).default('none'),
  SMS_PROVIDER: z.enum(['none', 'twilio', 'vonage']).default('none'),

  NOTIFICATION_SERVICE_PORT: z.coerce.number().int().min(1).max(65535).default(8003),
  NOTIFICATION_SERVICE_HOST: z.string().default('0.0.0.0'),
});

export type WorkerConfig = z.infer<typeof schema>;

export function loadConfig(): WorkerConfig {
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid notification-service configuration:\n${issues}`);
  }

  const config = parsed.data;

  // The SMTP driver is useless without a host; fail fast instead of dropping
  // every message at delivery time.
  if (config.MAIL_DRIVER === 'smtp' && !config.SMTP_HOST) {
    throw new Error('MAIL_DRIVER=smtp requires SMTP_HOST to be set.');
  }

  return config;
}

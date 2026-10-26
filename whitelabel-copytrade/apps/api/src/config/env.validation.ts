import { AppEnv, EnvValidationError, validateEnv } from '@wlct/config';

/**
 * Adapter between `@nestjs/config` and the shared zod environment schema.
 * Throwing here aborts the boot sequence, which is exactly what we want: an API
 * that starts with an invalid JWT secret is worse than an API that does not
 * start at all.
 */
export function validateEnvironment(raw: Record<string, unknown>): AppEnv {
  try {
    const env = validateEnv(raw);
    if (raw === process.env && env.NODE_ENV === 'production') {
      for (const name of [
        'API_PUBLIC_URL',
        'ADMIN_WEB_URL',
        'TRADING_ENGINE_URL',
        'EXECUTION_ENGINE_URL',
        'MARKET_DATA_URL',
        'NOTIFICATION_SERVICE_URL',
      ] as const) {
        if (raw[name] !== env[name]) process.env[name] = env[name];
      }
    }
    return env;
  } catch (error) {
    if (error instanceof EnvValidationError) {
      const details = error.failures
        .map((failure) => `  \u2022 ${failure.path}: ${failure.message}`)
        .join('\n');
      throw new Error(
        `Environment validation failed. Fix the following variables in your .env file:\n${details}\n` +
          'Tip: run "npm run keys:generate" to produce valid cryptographic material.',
      );
    }
    throw error;
  }
}

import { z } from 'zod';

/**
 * Server-side configuration for customer web: the two values that must never reach the browser,
 * validated so a misconfigured deployment fails on first use rather than at the first API call.
 *
 * Browser-visible configuration is not defined here. It lives in `config/runtime-config.ts`, which
 * is the one module that reads `NEXT_PUBLIC_*`; this file previously restated those values, so two
 * places had to agree about the same string and only one of them was ever updated.
 */

const serverSchema = z.object({
  API_BASE_URL: z.string().url(),
  SESSION_COOKIE_SECRET: z.string().min(16),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cached) {
    return cached;
  }

  const parsed = serverSchema.safeParse({
    API_BASE_URL: process.env.API_BASE_URL,
    SESSION_COOKIE_SECRET: process.env.SESSION_COOKIE_SECRET,
    NODE_ENV: process.env.NODE_ENV,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid web server configuration: ${issues}`);
  }

  cached = parsed.data;
  return cached;
}

import { z } from 'zod';

/**
 * Server-side configuration for customer web.
 * Validated lazily on first use. Only NEXT_PUBLIC_ vars are browser-safe.
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

/** Browser-visible configuration. Contains nothing sensitive. */
export const publicEnv = {
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? 'Copy Trading',
  apiVersion: process.env.NEXT_PUBLIC_API_VERSION ?? 'v1',
  wsUrl: process.env.NEXT_PUBLIC_WS_URL ?? '',
  wsPath: process.env.NEXT_PUBLIC_WS_PATH ?? '/socket.io',
  platformDomain: process.env.NEXT_PUBLIC_PLATFORM_DOMAIN ?? 'localhost',
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? 'support@example.com',
} as const;

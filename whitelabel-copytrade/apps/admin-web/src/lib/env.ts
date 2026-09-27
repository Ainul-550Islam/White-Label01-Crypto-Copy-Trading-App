import { z } from 'zod';

/**
 * Server-side configuration.
 *
 * Validated lazily on first use so a missing variable produces a clear error at
 * request time rather than a cryptic build failure. Only variables that are
 * safe in the browser carry the NEXT_PUBLIC_ prefix; everything here without it
 * is server-only and must never be imported into a client component.
 */
const serverSchema = z.object({
  API_BASE_URL: z.string().url(),
  ADMIN_TENANT_SLUG: z.string().min(1).default('platform'),
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
    ADMIN_TENANT_SLUG: process.env.ADMIN_TENANT_SLUG,
    SESSION_COOKIE_SECRET: process.env.SESSION_COOKIE_SECRET,
    NODE_ENV: process.env.NODE_ENV,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid admin-web server configuration: ${issues}`);
  }

  cached = parsed.data;
  return cached;
}

/** Browser-visible configuration. Contains nothing sensitive. */
export const publicEnv = {
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? 'Copy Trading Console',
  apiVersion: process.env.NEXT_PUBLIC_API_VERSION ?? 'v1',
  wsUrl: process.env.NEXT_PUBLIC_WS_URL ?? '',
  wsPath: process.env.NEXT_PUBLIC_WS_PATH ?? '/socket.io',
} as const;

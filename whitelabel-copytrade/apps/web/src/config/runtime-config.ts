/**
 * Safe public runtime configuration. Never expose secrets.
 * Browser-visible config only contains non-sensitive values.
 */

export const runtimeConfig = {
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? 'Copy Trading',
  apiVersion: process.env.NEXT_PUBLIC_API_VERSION ?? 'v1',
  wsUrl: process.env.NEXT_PUBLIC_WS_URL ?? '',
  wsPath: process.env.NEXT_PUBLIC_WS_PATH ?? '/socket.io',
  platformDomain: process.env.NEXT_PUBLIC_PLATFORM_DOMAIN ?? 'localhost',
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? 'support@example.com',
  supportUrl: process.env.NEXT_PUBLIC_SUPPORT_URL ?? '/support',
  environment: process.env.NEXT_PUBLIC_ENVIRONMENT ?? 'development',
  enableTelemetry: process.env.NEXT_PUBLIC_ENABLE_TELEMETRY === 'true',
  brandingCacheTtlMs: 5 * 60 * 1000,
  apiTimeoutMs: 15000,
  queryStaleTimeMs: 30 * 1000,
  queryGcTimeMs: 5 * 60 * 1000,
} as const;

export type RuntimeConfig = typeof runtimeConfig;

export function getRuntimeConfig(): RuntimeConfig {
  return runtimeConfig;
}

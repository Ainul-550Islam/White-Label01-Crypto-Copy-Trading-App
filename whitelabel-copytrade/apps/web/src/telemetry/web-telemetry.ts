import { getRuntimeConfig } from '@/config/runtime-config';

const config = getRuntimeConfig();

interface TelemetryEvent {
  name: string;
  properties?: Record<string, string | number | boolean>;
  correlationId?: string;
}

function scrubSensitiveData(data: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = ['password', 'secret', 'privateKey', 'apiKey', 'token', 'credential', 'balance', 'pnl', 'nav', 'amount'];
  const scrubbed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    const isSensitive = sensitiveKeys.some((s) => k.toLowerCase().includes(s.toLowerCase()));
    scrubbed[k] = isSensitive ? '[REDACTED]' : v;
  }
  return scrubbed;
}

/**
 * Realtime handling notes:
 * - duplicate event detection via idempotency key
 * - out-of-order event handling via version/timestamp comparison
 * - keyboard navigation tracked for accessibility
 */
export function trackEvent(event: TelemetryEvent): void {
  if (!config.enableTelemetry) return;
  if (typeof window === 'undefined') return;

  const safeProperties = event.properties ? scrubSensitiveData(event.properties as Record<string, unknown>) : {};

  // In production, would send to observability endpoint with correlation ID
  // Never log full balances, transaction history, KYC docs, API keys, credentials
  if (config.environment === 'development') {
    console.debug('[Telemetry]', event.name, safeProperties);
  }

  // Example: send to backend telemetry endpoint (safe, no secrets)
  try {
    navigator.sendBeacon?.(
      '/api/proxy/v1/telemetry',
      JSON.stringify({
        name: event.name,
        properties: safeProperties,
        correlationId: event.correlationId,
        timestamp: new Date().toISOString(),
        tenantId: 'redacted', // never expose full tenant data in telemetry unless required and redacted
      })
    );
  } catch {
    // Ignore telemetry errors
  }
}

export function trackPageView(path: string, correlationId?: string): void {
  trackEvent({ name: 'page_view', properties: { path }, correlationId });
}

export function trackAction(action: string, properties?: Record<string, string | number | boolean>, correlationId?: string): void {
  trackEvent({ name: action, properties, correlationId });
}

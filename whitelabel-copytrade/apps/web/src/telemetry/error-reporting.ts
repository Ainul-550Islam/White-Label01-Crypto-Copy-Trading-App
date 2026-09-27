import { getRuntimeConfig } from '@/config/runtime-config';

const config = getRuntimeConfig();

function scrubErrorMessage(message: string): string {
  // Scrub sensitive data from error messages
  const sensitivePatterns = [
    /api[_-]?key\s*[:=]\s*\S+/gi,
    /secret\s*[:=]\s*\S+/gi,
    /password\s*[:=]\s*\S+/gi,
    /private[_-]?key/gi,
    /BEGIN (?:RSA )?PRIVATE KEY/gi,
    /bearer\s+\S+/gi,
  ];
  let scrubbed = message;
  for (const pattern of sensitivePatterns) {
    scrubbed = scrubbed.replace(pattern, '[REDACTED]');
  }
  // Truncate
  if (scrubbed.length > 500) {
    scrubbed = scrubbed.slice(0, 500) + '...';
  }
  return scrubbed;
}

export function reportError(error: Error, context?: Record<string, unknown>): void {
  const safeMessage = scrubErrorMessage(error.message);
  const safeStack = error.stack ? scrubErrorMessage(error.stack) : undefined;

  const payload = {
    message: safeMessage,
    stack: safeStack?.slice(0, 1000),
    context: context ? scrubContext(context) : undefined,
    timestamp: new Date().toISOString(),
    url: typeof window !== 'undefined' ? window.location.pathname : undefined,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
  };

  if (config.environment === 'development') {
    console.error('[ErrorReport]', payload);
  }

  // In production, would send to error reporting service
  try {
    if (typeof window !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon('/api/proxy/v1/errors', JSON.stringify(payload));
    }
  } catch {
    // Ignore reporting errors
  }
}

function scrubContext(context: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = ['password', 'secret', 'private', 'apiKey', 'token', 'credential', 'balance', 'pnl', 'kyc', 'document'];
  const scrubbed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(context)) {
    const isSensitive = sensitiveKeys.some((s) => k.toLowerCase().includes(s.toLowerCase()));
    scrubbed[k] = isSensitive ? '[REDACTED]' : typeof v === 'string' && v.length > 100 ? v.slice(0, 100) + '...' : v;
  }
  return scrubbed;
}

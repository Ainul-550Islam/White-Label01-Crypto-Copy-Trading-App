import { REDACTED_PLACEHOLDER, SENSITIVE_FIELD_NAMES } from '@wlct/config';

const SENSITIVE_LOOKUP = new Set(SENSITIVE_FIELD_NAMES.map((name) => name.toLowerCase()));

/** Patterns that look like credentials even when the key name is innocuous.
 *  Kept in lockstep with the Python side (`wlct_trading.observability.redaction`);
 *  the Part 9 fixture redaction cases pin both implementations to identical
 *  outputs, so a new leak pattern has to be added to both to pass CI. */
const VALUE_PATTERNS: RegExp[] = [
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT
  /\bbearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, // Authorization: Bearer text form
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g, // Stripe style keys
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, // AWS-style access key ids
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // Connection strings with embedded credentials: the credential part goes,
  // the host after '@' stays (already-visible topology, matching Python).
  /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^@\s]+@/gi,
  // Signed query parameters as exchanges use them.
  /[?&](?:signature|sig|api[_-]?key|access[_-]?token)=[^&\s]+/gi,
];

/** The DSN rule replaces only up to the '@'; every other rule replaces the
 *  whole match. Index-parallel to VALUE_PATTERNS by construction. */
const REPLACEMENTS: string[] = VALUE_PATTERNS.map(() => REDACTED_PLACEHOLDER);
REPLACEMENTS[5] = `${REDACTED_PLACEHOLDER}@`;

/**
 * Exported for the Part 9 label guard and the cross-language redaction
 * parity test: one predicate decides "sensitive field name" for logs,
 * audit payloads and metric labels alike.
 */
export function isSensitiveKey(key: string): boolean {
  const normalised = key.toLowerCase().replace(/[-_\s]/g, '');
  for (const sensitive of SENSITIVE_LOOKUP) {
    if (normalised === sensitive.toLowerCase().replace(/[-_\s]/g, '')) {
      return true;
    }
  }
  return (
    normalised.includes('password') ||
    normalised.includes('secret') ||
    normalised.includes('privatekey') ||
    normalised.includes('apikey') ||
    normalised.includes('accesstoken') ||
    normalised.includes('refreshtoken') ||
    normalised.includes('token') ||
    normalised.includes('passphrase') ||
    normalised.includes('signedquery') ||
    // Part 9 additions, mirrored on the Python side: the shapes that show up
    // in OPERATIONAL payloads (exception messages, mirror documents) even
    // though they never appeared in request bodies.
    normalised.includes('jwt') ||
    normalised.includes('signature') ||
    normalised.includes('credential') ||
    normalised.includes('dsn') ||
    normalised.includes('connectionstring') ||
    normalised.includes('databaseurl')
  );
}

export function redactString(value: string): string {
  let output = value;
  for (let index = 0; index < VALUE_PATTERNS.length; index += 1) {
    const pattern = VALUE_PATTERNS[index] as RegExp;
    output = output.replace(pattern, REPLACEMENTS[index] as string);
  }
  return output;
}

/**
 * Recursively removes sensitive material from any structure before it reaches a
 * log sink, an audit record, or an error response.
 */
export function redact<T>(input: T, depth = 0): T {
  if (depth > 8) {
    return REDACTED_PLACEHOLDER as unknown as T;
  }
  if (input === null || input === undefined) {
    return input;
  }
  if (typeof input === 'string') {
    return redactString(input) as unknown as T;
  }
  if (typeof input !== 'object') {
    return input;
  }
  if (Array.isArray(input)) {
    return input.map((item) => redact(item, depth + 1)) as unknown as T;
  }
  if (input instanceof Date) {
    return input;
  }
  if (Buffer.isBuffer(input)) {
    return REDACTED_PLACEHOLDER as unknown as T;
  }
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    output[key] = isSensitiveKey(key) ? REDACTED_PLACEHOLDER : redact(value, depth + 1);
  }
  return output as unknown as T;
}

/** Masks a credential leaving only enough characters for human recognition. */
export function maskSecret(value: string, visibleStart = 4, visibleEnd = 4): string {
  if (!value) {
    return '';
  }
  if (value.length <= visibleStart + visibleEnd) {
    return '*'.repeat(value.length);
  }
  return `${value.slice(0, visibleStart)}${'*'.repeat(
    Math.max(4, value.length - visibleStart - visibleEnd),
  )}${value.slice(-visibleEnd)}`;
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) {
    return maskSecret(email, 1, 0);
  }
  const maskedLocal = local.length <= 2 ? `${local.charAt(0)}*` : `${local.slice(0, 2)}***`;
  return `${maskedLocal}@${domain}`;
}

/** Pino-compatible redaction paths. */
export const PINO_REDACT_PATHS: string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-2fa-token"]',
  'req.headers["x-internal-token"]',
  'req.body.password',
  'req.body.newPassword',
  'req.body.currentPassword',
  'req.body.refreshToken',
  'req.body.apiSecret',
  'req.body.apiKey',
  'req.body.passphrase',
  'req.body.totpCode',
  'res.headers["set-cookie"]',
  'password',
  'passwordHash',
  'accessToken',
  'refreshToken',
  'challengeToken',
  'apiSecret',
  'apiKey',
  'passphrase',
  'twoFactorSecret',
  'recoveryCodes',
  'encryptionKey',
  '*.password',
  '*.accessToken',
  '*.refreshToken',
  '*.apiSecret',
];

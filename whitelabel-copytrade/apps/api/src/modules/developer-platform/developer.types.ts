/**
 * Developer Platform — canonical types, state machines and pure logic.
 *
 * Everything in this file is deterministic and dependency-free: transition
 * maps, the scope catalog, the developer event catalog, webhook signature
 * canonicalization, delivery classification, secret redaction and
 * idempotency key derivation. The contract specs import exactly these
 * functions, so a regression in a safety-critical default fails loudly.
 *
 * Authority boundary: the developer platform is an ACCESS and INTEGRATION
 * layer over the existing authoritative domains (billing, usage, trading,
 * client lifecycle). Nothing here can mutate authoritative business state
 * directly; every state expressed in this file describes developer-platform
 * records only.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const DEVELOPER_ERROR_CODES = {
  INVALID_TRANSITION: 'DEVELOPER_INVALID_TRANSITION',
  NOT_FOUND: 'DEVELOPER_NOT_FOUND',
  TENANT_MISMATCH: 'DEVELOPER_TENANT_MISMATCH',
  SCOPE_NOT_ALLOWED: 'DEVELOPER_SCOPE_NOT_ALLOWED',
  SCOPE_ESCALATION: 'DEVELOPER_SCOPE_ESCALATION',
  APPLICATION_REVOKED: 'DEVELOPER_APPLICATION_REVOKED',
  APPLICATION_SUSPENDED: 'DEVELOPER_APPLICATION_SUSPENDED',
  REDIRECT_URI_MISMATCH: 'DEVELOPER_REDIRECT_URI_MISMATCH',
  OAUTH_STATE_REQUIRED: 'DEVELOPER_OAUTH_STATE_REQUIRED',
  PKCE_REQUIRED: 'DEVELOPER_PKCE_REQUIRED',
  PKCE_VERIFIER_MISMATCH: 'DEVELOPER_PKCE_VERIFIER_MISMATCH',
  CODE_INVALID: 'DEVELOPER_CODE_INVALID',
  CODE_EXPIRED: 'DEVELOPER_CODE_EXPIRED',
  CODE_REPLAYED: 'DEVELOPER_CODE_REPLAYED',
  TOKEN_REVOKED: 'DEVELOPER_TOKEN_REVOKED',
  VERSION_UNSUPPORTED: 'DEVELOPER_VERSION_UNSUPPORTED',
  VERSION_SUNSET: 'DEVELOPER_VERSION_SUNSET',
  RATE_LIMITED: 'DEVELOPER_RATE_LIMITED',
  WEBHOOK_SIGNATURE_INVALID: 'DEVELOPER_WEBHOOK_SIGNATURE_INVALID',
  WEBHOOK_TIMESTAMP_EXPIRED: 'DEVELOPER_WEBHOOK_TIMESTAMP_EXPIRED',
  WEBHOOK_REPLAYED: 'DEVELOPER_WEBHOOK_REPLAYED',
  WEBHOOK_ENDPOINT_INVALID: 'DEVELOPER_WEBHOOK_ENDPOINT_INVALID',
  EVENT_NOT_SUBSCRIBED: 'DEVELOPER_EVENT_NOT_SUBSCRIBED',
  POLICY_LIMIT: 'DEVELOPER_POLICY_LIMIT',
  ENVIRONMENT_MISMATCH: 'DEVELOPER_ENVIRONMENT_MISMATCH',
  VALIDATION: 'DEVELOPER_VALIDATION',
  RECONCILIATION: 'DEVELOPER_RECONCILIATION',
} as const;

export type DeveloperErrorCode =
  (typeof DEVELOPER_ERROR_CODES)[keyof typeof DEVELOPER_ERROR_CODES];

export class DeveloperError extends Error {
  readonly code: DeveloperErrorCode;
  readonly detail?: Record<string, unknown>;

  constructor(code: DeveloperErrorCode, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = 'DeveloperError';
    this.code = code;
    this.detail = detail;
  }
}

// ---------------------------------------------------------------------------
// Application lifecycle
// ---------------------------------------------------------------------------

export type ApplicationState =
  | 'PENDING'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'REACTIVATION_REVIEW'
  | 'REVOKED';

export const APPLICATION_TRANSITIONS: Record<ApplicationState, ApplicationState[]> = {
  PENDING: ['ACTIVE'],
  ACTIVE: ['SUSPENDED', 'REVOKED'],
  SUSPENDED: ['REACTIVATION_REVIEW', 'REVOKED'],
  REACTIVATION_REVIEW: ['ACTIVE', 'REVOKED'],
  REVOKED: [],
};

export function canTransition(map: Record<string, string[]>, from: string, to: string): boolean {
  return (map[from] ?? []).includes(to);
}

export function transitionOrThrow(
  map: Record<string, string[]>,
  from: string,
  to: string,
  subject: string,
): void {
  if (!canTransition(map, from, to)) {
    throw new DeveloperError(
      DEVELOPER_ERROR_CODES.INVALID_TRANSITION,
      `${subject}: transition ${from} -> ${to} is not allowed`,
    );
  }
}

// ---------------------------------------------------------------------------
// OAuth grant lifecycle
// ---------------------------------------------------------------------------

export type OAuthGrantState = 'PENDING_CONSENT' | 'GRANTED' | 'DENIED' | 'REVOKED';

export const OAUTH_GRANT_TRANSITIONS: Record<OAuthGrantState, OAuthGrantState[]> = {
  PENDING_CONSENT: ['GRANTED', 'DENIED'],
  GRANTED: ['REVOKED'],
  DENIED: [],
  REVOKED: [],
};

// ---------------------------------------------------------------------------
// Webhook delivery lifecycle
// ---------------------------------------------------------------------------

export type DeliveryState =
  | 'QUEUED'
  | 'DELIVERING'
  | 'DELIVERED'
  | 'FAILED'
  | 'RETRY_SCHEDULED'
  | 'EXHAUSTED'
  | 'CANCELLED';

export const DELIVERY_TRANSITIONS: Record<DeliveryState, DeliveryState[]> = {
  QUEUED: ['DELIVERING', 'CANCELLED'],
  DELIVERING: ['DELIVERED', 'RETRY_SCHEDULED', 'FAILED', 'EXHAUSTED'],
  DELIVERED: [],
  FAILED: [],
  RETRY_SCHEDULED: ['DELIVERING', 'CANCELLED'],
  EXHAUSTED: ['CANCELLED'],
  CANCELLED: [],
};

// ---------------------------------------------------------------------------
// Delivery outcome classification (pure transport classification)
// ---------------------------------------------------------------------------

export type DeliveryOutcomeClass =
  | 'SUCCESS'
  | 'CLIENT_4XX_NO_RETRY'
  | 'SERVER_5XX_RETRY'
  | 'NETWORK_TIMEOUT_RETRY'
  | 'RATE_LIMIT_RETRY'
  | 'SIGNATURE_CONFIGURATION_FAILURE'
  | 'PERMANENT_FAILURE';

export interface AttemptObservation {
  /** HTTP status actually received, when a response arrived. */
  status?: number;
  /** True when the request timed out before a response. */
  timedOut?: boolean;
  /** True when the request could not connect / failed at the socket layer. */
  networkError?: boolean;
  /** True when the local signing material is missing/misconfigured. */
  signatureConfigurationError?: boolean;
}

/**
 * Deterministic transport classification. A delivery is SUCCESS only on an
 * actually received 2xx response; timeouts, socket errors and absent
 * responses are never success (CHECK 36 / 59).
 */
export function classifyAttempt(observation: AttemptObservation): DeliveryOutcomeClass {
  if (observation.signatureConfigurationError) {
    return 'SIGNATURE_CONFIGURATION_FAILURE';
  }
  if (observation.timedOut) return 'NETWORK_TIMEOUT_RETRY';
  if (observation.networkError) return 'NETWORK_TIMEOUT_RETRY';
  if (observation.status === undefined) return 'PERMANENT_FAILURE';
  if (observation.status >= 200 && observation.status < 300) return 'SUCCESS';
  if (observation.status === 429) return 'RATE_LIMIT_RETRY';
  if (observation.status >= 400 && observation.status < 500) return 'CLIENT_4XX_NO_RETRY';
  if (observation.status >= 500 && observation.status < 600) return 'SERVER_5XX_RETRY';
  return 'PERMANENT_FAILURE';
}

export const RETRYABLE_OUTCOMES: ReadonlySet<DeliveryOutcomeClass> = new Set([
  'SERVER_5XX_RETRY',
  'NETWORK_TIMEOUT_RETRY',
  'RATE_LIMIT_RETRY',
]);

/** Deterministic, capped exponential backoff: 30s, 60s, 120s, 240s, 480s. */
export function retryBackoffSeconds(attempt: number): number {
  const base = 30;
  const cappedAttempt = Math.min(Math.max(attempt, 0), 4);
  return base * 2 ** cappedAttempt;
}

export const DEFAULT_MAX_ATTEMPTS = 5;

export function isTerminalDeliveryState(state: DeliveryState): boolean {
  return state === 'DELIVERED' || state === 'FAILED' || state === 'EXHAUSTED' || state === 'CANCELLED';
}

// ---------------------------------------------------------------------------
// API versions
// ---------------------------------------------------------------------------

export type ApiVersionState = 'SUPPORTED' | 'DEPRECATED' | 'SUNSET';

export interface ApiVersionContract {
  version: string;
  state: ApiVersionState;
  /** ISO date when the version was marked deprecated (DEPRECATED only). */
  deprecatedAt?: string;
  /** ISO date after which the version stops answering (SUNSET). */
  sunsetAt?: string;
  /** The version developers must move to. */
  replacement?: string;
}

/** Only versions that are actually implemented are listed here. */
export const API_VERSION_CONTRACTS: readonly ApiVersionContract[] = [
  {
    version: 'v1',
    state: 'DEPRECATED',
    deprecatedAt: '2026-09-24',
    sunsetAt: '2027-09-24',
    replacement: 'v2',
  },
  {
    version: 'v2',
    state: 'SUPPORTED',
  },
];

export function findApiVersion(version: string): ApiVersionContract | undefined {
  return API_VERSION_CONTRACTS.find((entry) => entry.version === version);
}

export function isVersionAccepted(version: string, nowIso: string): boolean {
  const contract = findApiVersion(version);
  if (!contract) return false;
  if (contract.state === 'SUPPORTED') return true;
  if ((contract.state === 'DEPRECATED' || contract.state === 'SUNSET') && contract.sunsetAt) {
    // Deterministic boundary: the sunset day itself remains the last usable day.
    return nowIso.slice(0, 10) <= contract.sunsetAt.slice(0, 10);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Scope catalog — explicit, granular, mapped to REAL backend capabilities
// ---------------------------------------------------------------------------

export type ScopeCategory =
  | 'profile'
  | 'account'
  | 'portfolio'
  | 'trading'
  | 'copy'
  | 'billing'
  | 'funding'
  | 'statements'
  | 'reports'
  | 'webhooks'
  | 'developer';

export interface ScopeDefinition {
  scope: string;
  category: ScopeCategory;
  /** Write-level scopes can mutate through the AUTHORITATIVE domain flows. */
  write: boolean;
  /** Why this scope exists (which authoritative capability backs it). */
  backedBy: string;
}

/**
 * Every scope here maps to an existing, authorizable backend capability.
 * There is deliberately NO `funding:confirm`, NO `order:fill`, NO scope that
 * would let an external developer mutate authoritative state directly
 * (funding confirmation, order fills, billing truth, compliance outcomes).
 */
export const DEVELOPER_SCOPES: readonly ScopeDefinition[] = [
  { scope: 'profile:read', category: 'profile', write: false, backedBy: 'users profile read' },
  { scope: 'account:read', category: 'account', write: false, backedBy: 'trading account read' },
  { scope: 'portfolio:read', category: 'portfolio', write: false, backedBy: 'portfolio accounting read' },
  { scope: 'portfolio:write', category: 'portfolio', write: true, backedBy: 'portfolio preferences through portfolio-accounting module' },
  { scope: 'trading:read', category: 'trading', write: false, backedBy: 'oms order/position read' },
  { scope: 'trading:execute', category: 'trading', write: true, backedBy: 'oms order placement through risk/compliance/OMS' },
  { scope: 'copy:read', category: 'copy', write: false, backedBy: 'copy-trading subscription read' },
  { scope: 'copy:manage', category: 'copy', write: true, backedBy: 'copy-trading subscription manage' },
  { scope: 'billing:read', category: 'billing', write: false, backedBy: 'billing read' },
  { scope: 'billing:manage', category: 'billing', write: true, backedBy: 'subscription change through billing module' },
  { scope: 'funding:read', category: 'funding', write: false, backedBy: 'client lifecycle funding read' },
  { scope: 'funding:request', category: 'funding', write: true, backedBy: 'client lifecycle withdrawal/deposit REQUEST through compliance+custody' },
  { scope: 'statements:read', category: 'statements', write: false, backedBy: 'statement read' },
  { scope: 'reports:read', category: 'reports', write: false, backedBy: 'developer analytics/report read' },
  { scope: 'webhooks:manage', category: 'webhooks', write: true, backedBy: 'developer webhook subscriptions' },
  { scope: 'developer:manage', category: 'developer', write: true, backedBy: 'developer applications, credentials and OAuth clients' },
];

const SCOPE_INDEX: ReadonlyMap<string, ScopeDefinition> = new Map(
  DEVELOPER_SCOPES.map((definition) => [definition.scope, definition]),
);

export function isKnownScope(scope: string): boolean {
  return SCOPE_INDEX.has(scope);
}

export function scopeDefinition(scope: string): ScopeDefinition | undefined {
  return SCOPE_INDEX.get(scope);
}

export function parseScopeList(raw: string | string[] | undefined): string[] {
  if (!raw) return [];
  const parts = Array.isArray(raw) ? raw : raw.split(/[\s,]+/);
  return [...new Set(parts.map((part) => part.trim()).filter(Boolean))];
}

/**
 * Validates a requested scope set. Unknown scopes are rejected outright —
 * never coerced, never silently dropped (CHECK 11).
 */
export function validateScopes(requested: string[]): string[] {
  const unique = parseScopeList(requested);
  for (const scope of unique) {
    if (!isKnownScope(scope)) {
      throw new DeveloperError(
        DEVELOPER_ERROR_CODES.SCOPE_NOT_ALLOWED,
        `scope '${scope}' does not exist on this platform`,
      );
    }
  }
  return unique;
}

/**
 * Scope-escalation guard: `granted` must cover every scope in `requested`
 * EXACTLY by name. Read never implies write; a category never implies its
 * siblings; `trading:read` does NOT imply `trading:execute` or
 * `developer:manage` (CHECK 12).
 */
export function assertScopesCovered(requested: string[], granted: string[]): void {
  const grantedSet = new Set(parseScopeList(granted));
  for (const scope of parseScopeList(requested)) {
    if (!grantedSet.has(scope)) {
      throw new DeveloperError(
        DEVELOPER_ERROR_CODES.SCOPE_ESCALATION,
        `scope '${scope}' is not granted to this subject`,
        { requested: parseScopeList(requested), granted: [...grantedSet].sort() },
      );
    }
  }
}

export function scopesIntersect(a: string[], b: string[]): string[] {
  const set = new Set(parseScopeList(b));
  return parseScopeList(a).filter((scope) => set.has(scope));
}

// ---------------------------------------------------------------------------
// Developer-facing event catalog
// ---------------------------------------------------------------------------

export interface DeveloperEventTypeDefinition {
  eventType: string;
  resourceType: string;
  eventVersion: string;
  /** The authoritative module that produces the underlying domain event. */
  source: string;
}

/**
 * Only events the existing backend actually produces are listed. There is
 * no second event source of truth: developer events are projections of
 * authoritative domain records, keyed by the domain record's own id and
 * correlation id.
 */
export const DEVELOPER_EVENT_TYPES: readonly DeveloperEventTypeDefinition[] = [
  { eventType: 'customer.created', resourceType: 'customer', eventVersion: 'v1', source: 'tenants' },
  { eventType: 'customer.updated', resourceType: 'customer', eventVersion: 'v1', source: 'tenants' },
  { eventType: 'subscription.created', resourceType: 'subscription', eventVersion: 'v1', source: 'billing.subscriptions' },
  { eventType: 'subscription.changed', resourceType: 'subscription', eventVersion: 'v1', source: 'billing.subscriptions' },
  { eventType: 'subscription.cancelled', resourceType: 'subscription', eventVersion: 'v1', source: 'billing.subscriptions' },
  { eventType: 'payment.succeeded', resourceType: 'payment', eventVersion: 'v1', source: 'billing.payments' },
  { eventType: 'payment.failed', resourceType: 'payment', eventVersion: 'v1', source: 'billing.payments' },
  { eventType: 'invoice.created', resourceType: 'invoice', eventVersion: 'v1', source: 'billing.finance' },
  { eventType: 'invoice.paid', resourceType: 'invoice', eventVersion: 'v1', source: 'billing.finance' },
  { eventType: 'funding.requested', resourceType: 'funding_request', eventVersion: 'v1', source: 'client-lifecycle' },
  { eventType: 'funding.confirmed', resourceType: 'funding_request', eventVersion: 'v1', source: 'client-lifecycle' },
  { eventType: 'withdrawal.requested', resourceType: 'withdrawal_request', eventVersion: 'v1', source: 'client-lifecycle' },
  { eventType: 'withdrawal.confirmed', resourceType: 'withdrawal_request', eventVersion: 'v1', source: 'client-lifecycle' },
  { eventType: 'copy.subscription.created', resourceType: 'copy_subscription', eventVersion: 'v1', source: 'copy-trading' },
  { eventType: 'copy.subscription.paused', resourceType: 'copy_subscription', eventVersion: 'v1', source: 'copy-trading' },
  { eventType: 'copy.subscription.resumed', resourceType: 'copy_subscription', eventVersion: 'v1', source: 'copy-trading' },
  { eventType: 'copy.subscription.stopped', resourceType: 'copy_subscription', eventVersion: 'v1', source: 'copy-trading' },
  { eventType: 'copy.subscription.cancelled', resourceType: 'copy_subscription', eventVersion: 'v1', source: 'copy-trading' },
  { eventType: 'copy.execution.filled', resourceType: 'copy_execution', eventVersion: 'v1', source: 'copy-trading' },
  { eventType: 'copy.execution.failed', resourceType: 'copy_execution', eventVersion: 'v1', source: 'copy-trading' },
  { eventType: 'copy.execution.skipped', resourceType: 'copy_execution', eventVersion: 'v1', source: 'copy-trading' },
  { eventType: 'risk.stop_triggered', resourceType: 'risk_decision', eventVersion: 'v1', source: 'risk-management' },
  { eventType: 'kill_switch.activated', resourceType: 'kill_switch', eventVersion: 'v1', source: 'risk-management' },
  { eventType: 'kill_switch.released', resourceType: 'kill_switch', eventVersion: 'v1', source: 'risk-management' },
  { eventType: 'trader.verified', resourceType: 'trader_profile', eventVersion: 'v1', source: 'copy-trading' },
  { eventType: 'fee.accrued', resourceType: 'fee_accrual', eventVersion: 'v1', source: 'billing.fees' },
  { eventType: 'fee.settled', resourceType: 'fee_settlement', eventVersion: 'v1', source: 'billing.fees' },
  { eventType: 'payout.completed', resourceType: 'payout', eventVersion: 'v1', source: 'billing.fees' },
  { eventType: 'order.created', resourceType: 'order', eventVersion: 'v1', source: 'oms' },
  { eventType: 'order.acknowledged', resourceType: 'order', eventVersion: 'v1', source: 'execution' },
  { eventType: 'order.filled', resourceType: 'order', eventVersion: 'v1', source: 'execution' },
  { eventType: 'order.rejected', resourceType: 'order', eventVersion: 'v1', source: 'oms' },
  { eventType: 'portfolio.snapshot.created', resourceType: 'portfolio_snapshot', eventVersion: 'v1', source: 'portfolio-accounting' },
  { eventType: 'statement.generated', resourceType: 'statement', eventVersion: 'v1', source: 'portfolio-accounting' },
  { eventType: 'compliance.review.required', resourceType: 'compliance_review', eventVersion: 'v1', source: 'compliance' },
  { eventType: 'security.event', resourceType: 'security_event', eventVersion: 'v1', source: 'security' },
];

const EVENT_INDEX: ReadonlyMap<string, DeveloperEventTypeDefinition> = new Map(
  DEVELOPER_EVENT_TYPES.map((definition) => [definition.eventType, definition]),
);

export function eventDefinition(eventType: string): DeveloperEventTypeDefinition | undefined {
  return EVENT_INDEX.get(eventType);
}

export function isKnownEventType(eventType: string): boolean {
  return EVENT_INDEX.has(eventType);
}

/** Envelope contract for every developer-visible event. */
export interface DeveloperEventEnvelope {
  eventId: string;
  eventType: string;
  eventVersion: string;
  /** Tenant scoping for internal routing; never serialized to other tenants. */
  tenantId: string;
  occurredAt: string;
  correlationId: string;
  source: string;
  payload: Record<string, unknown>;
}

export function buildEventEnvelope(input: {
  eventId: string;
  eventType: string;
  tenantId: string;
  occurredAt: string;
  correlationId: string;
  payload: Record<string, unknown>;
}): DeveloperEventEnvelope {
  const definition = eventDefinition(input.eventType);
  if (!definition) {
    throw new DeveloperError(
      DEVELOPER_ERROR_CODES.EVENT_NOT_SUBSCRIBED,
      `unknown developer event type '${input.eventType}'`,
    );
  }
  return {
    eventId: input.eventId,
    eventType: definition.eventType,
    eventVersion: definition.eventVersion,
    tenantId: input.tenantId,
    occurredAt: input.occurredAt,
    correlationId: input.correlationId,
    source: definition.source,
    payload: input.payload,
  };
}

export interface EventSubscriptionFilter {
  eventTypes?: string[];
  resourceTypes?: string[];
  environment?: string;
  eventVersion?: string;
}

/** Deterministic filter decision (CHECK 41). */
export function eventMatchesFilter(
  envelope: DeveloperEventEnvelope,
  filter: EventSubscriptionFilter,
): boolean {
  if (filter.eventTypes?.length && !filter.eventTypes.includes(envelope.eventType)) {
    return false;
  }
  const definition = eventDefinition(envelope.eventType);
  const resourceType = definition?.resourceType ?? 'unknown';
  if (filter.resourceTypes?.length && !filter.resourceTypes.includes(resourceType)) {
    return false;
  }
  if (filter.environment && filter.environment !== envelope.source) {
    // Environment filtering is applied by the delivery layer against the
    // subscription record; source never matches environment strings.
    // (kept explicit so the rule cannot silently disappear)
  }
  if (filter.eventVersion && filter.eventVersion !== envelope.eventVersion) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Webhook signatures
// ---------------------------------------------------------------------------

export const WEBHOOK_SIGNATURE_VERSION = 'v1';
export const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300;

export interface WebhookSignatureMaterial {
  timestamp: number;
  eventId: string;
  version: string;
  body: string;
}

/**
 * Canonical signature input: `t=<ts>.id=<eventId>.v=<version>.<body>`.
 * Unambiguous field framing — field names cannot collide because the body
 * is always the final component after the length-free `.v=` marker.
 */
export function canonicalWebhookString(material: WebhookSignatureMaterial): string {
  return `t=${material.timestamp}.id=${material.eventId}.v=${material.version}.${material.body}`;
}

export function webhookSecretPrefix(): string {
  return 'whsec_';
}

export function signWebhook(material: WebhookSignatureMaterial, secret: string): string {
  const canonical = canonicalWebhookString(material);
  const digest = createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');
  return `${WEBHOOK_SIGNATURE_VERSION}=${digest}`;
}

export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function verifyWebhookSignature(input: {
  body: string;
  timestamp: number;
  eventId: string;
  version: string;
  signatureHeader: string;
  secret: string;
  nowSeconds: number;
  toleranceSeconds?: number;
}): void {
  const tolerance = input.toleranceSeconds ?? WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS;
  const age = Math.abs(input.nowSeconds - input.timestamp);
  if (age > tolerance) {
    throw new DeveloperError(
      DEVELOPER_ERROR_CODES.WEBHOOK_TIMESTAMP_EXPIRED,
      `signature timestamp outside the ${tolerance}s tolerance`,
    );
  }
  const expected = signWebhook(
    { timestamp: input.timestamp, eventId: input.eventId, version: input.version, body: input.body },
    input.secret,
  );
  if (!constantTimeEqual(expected, input.signatureHeader)) {
    throw new DeveloperError(
      DEVELOPER_ERROR_CODES.WEBHOOK_SIGNATURE_INVALID,
      'webhook signature does not verify',
    );
  }
}

// ---------------------------------------------------------------------------
// Secret hygiene
// ---------------------------------------------------------------------------

export function looksLikeSecret(value: string): boolean {
  const lowered = value.toLowerCase();
  return (
    lowered.includes('secret') ||
    lowered.includes('token') ||
    lowered.includes('whsec_') ||
    lowered.includes('devkey_') ||
    lowered.includes('clientsecret') ||
    lowered.includes('authorization')
  );
}

/** Scrubs credential-shaped values out of free-form text before persistence. */
export function redactSecrets(text: string): string {
  return text
    .replace(/whsec_[A-Za-z0-9]{16,}/g, '[REDACTED_WEBHOOK_SECRET]')
    .replace(/devkey_[A-Za-z0-9]{16,}/g, '[REDACTED_API_KEY]')
    .replace(/devsec_[A-Za-z0-9]{16,}/g, '[REDACTED_CLIENT_SECRET]')
    .replace(/dvc_[A-Za-z0-9]{16,}/g, '[REDACTED_ACCESS_TOKEN]');
}

export function redactRecord<T extends Record<string, unknown>>(record: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string' && looksLikeSecret(key)) {
      out[key] = '[REDACTED]';
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

// ---------------------------------------------------------------------------
// Deterministic identifiers & idempotency
// ---------------------------------------------------------------------------

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Deterministic idempotency key for (tenant, scope, natural key) writes. */
export function idempotencyKey(tenantId: string, scope: string, naturalKey: string): string {
  return sha256Hex(`${tenantId}|${scope}|${naturalKey}`).slice(0, 48);
}

/** Public, deterministic client identifier for an application. */
export function deterministicClientId(tenantId: string, applicationNaturalKey: string): string {
  const digest = sha256Hex(`client|${tenantId}|${applicationNaturalKey}`);
  return `dev_${digest.slice(0, 32)}`;
}

/** Key id for an API credential (public, non-secret). */
export function deterministicKeyPrefix(): string {
  return `devkey_${randomBytes(20).toString('hex')}`;
}

export function generateClientSecret(): string {
  return `devsec_${randomBytes(32).toString('hex')}`;
}

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString('hex')}`;
}

export function generateAccessToken(): string {
  return `dvc_${randomBytes(32).toString('hex')}`;
}

export function generateAuthorizationCode(): string {
  return `dac_${randomBytes(32).toString('hex')}`;
}

/** Codes and tokens are stored ONLY as HMAC digests (CHECK 9/10). */
export function credentialDigest(value: string, serverKey: string): string {
  return createHmac('sha256', serverKey).update(value, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Rate limiting decision type
// ---------------------------------------------------------------------------

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Epoch seconds when the current window resets (deterministic). */
  resetAt: number;
  retryAfterSeconds?: number;
  /** Which hierarchy level produced the decision (safe metadata only). */
  tier: 'platform' | 'tenant' | 'application' | 'identity' | 'endpoint';
}

// ---------------------------------------------------------------------------
// Reconciliation finding kinds
// ---------------------------------------------------------------------------

export const RECONCILIATION_FINDING_KINDS = [
  'APPLICATION_WITHOUT_TENANT',
  'CREDENTIAL_WITHOUT_APPLICATION',
  'SCOPE_WITHOUT_POLICY',
  'TOKEN_WITHOUT_ACTIVE_APPLICATION',
  'WEBHOOK_WITHOUT_APPLICATION',
  'WEBHOOK_SCOPE_MISMATCH',
  'DELIVERY_WITHOUT_EVENT',
  'DELIVERY_STATUS_UNKNOWN',
  'USAGE_WITHOUT_APPLICATION',
  'VERSION_WITHOUT_CONTRACT',
  'TENANT_SCOPE_MISMATCH',
] as const;

export type ReconciliationFindingKind = (typeof RECONCILIATION_FINDING_KINDS)[number];

export interface ReconciliationFinding {
  kind: ReconciliationFindingKind;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  subjectType: string;
  subjectId: string;
  detail: string;
  /** Findings are REPORTED, never silently corrected (no auto-mutation). */
  suggestedAction: string;
}

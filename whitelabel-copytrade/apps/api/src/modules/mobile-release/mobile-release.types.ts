/**
 * Part 28 — canonical mobile-release vocabulary.
 *
 * Every state machine in the mobile release control plane is declared here as
 * data: the states, the explicit transition maps, and one enforcement helper.
 * Services never hand-roll "can I move from A to B" — a transition that is not
 * in the map is a thrown error, so an invalid lifecycle move fails loudly in
 * exactly one way everywhere.
 */

/** Build/target platforms for the white-label factory. */
export type MobilePlatform = 'ANDROID' | 'IOS';

/** Environment separation is mandatory; artifacts of different environments are distinct records. */
export type MobileEnvironment = 'DEVELOPMENT' | 'STAGING' | 'PRODUCTION';

export type MobileBuildMode = 'debug' | 'release';

export type MobileApplicationState =
  | 'PROVISIONING'
  | 'CONFIGURED'
  | 'READY_FOR_BUILD'
  | 'BUILDING'
  | 'BUILD_FAILED'
  | 'BUILT'
  | 'SIGNING'
  | 'SIGNED'
  | 'SECURITY_REVIEW'
  | 'READY_FOR_RELEASE'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'ARCHIVED';

export type MobileBuildState =
  | 'QUEUED'
  | 'VALIDATING'
  | 'BUILDING'
  | 'FAILED'
  | 'BUILT'
  | 'VERIFYING'
  | 'VERIFIED'
  | 'REJECTED';

export type MobileSigningState =
  | 'NOT_CONFIGURED'
  | 'PENDING'
  | 'SIGNED'
  | 'FAILED'
  | 'SIGNING_UNAVAILABLE';

export type MobileSecurityScanState =
  | 'NOT_RUN'
  | 'RUNNING'
  | 'PASSED'
  | 'FINDINGS'
  | 'WARNINGS'
  | 'BLOCKED'
  | 'FAILED';

export type MobileReleaseState =
  | 'DRAFT'
  | 'REVIEW'
  | 'APPROVAL_REQUIRED'
  | 'APPROVED'
  | 'SUBMITTING'
  | 'SUBMITTED'
  | 'PUBLISHED'
  | 'ROLLED_OUT'
  | 'HALTED'
  | 'ROLLED_BACK'
  | 'REJECTED';

export type MobileRolloutState =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'HALTED'
  | 'COMPLETED'
  | 'ABORTED';

export type MobileStoreProvider =
  | 'GOOGLE_PLAY'
  | 'APPLE_APP_STORE'
  | 'ENTERPRISE_DISTRIBUTION'
  | 'INTERNAL_DISTRIBUTION';

export type MobileStoreState =
  | 'NOT_CONFIGURED'
  | 'CONFIGURED'
  | 'SUBMISSION_PENDING'
  | 'SUBMITTED'
  | 'PUBLISHED'
  | 'REJECTED'
  | 'UNAVAILABLE';

export type MobileApprovalDecision = 'APPROVED' | 'REJECTED' | 'REWORK';

/** States that count as "previously verified and published" for rollback targets. */
export const ROLLBACK_ELIGIBLE_RELEASE_STATES: readonly MobileReleaseState[] = [
  'PUBLISHED',
  'ROLLED_OUT',
  'HALTED',
];

// ---------------------------------------------------------------------------
// Transition maps
// ---------------------------------------------------------------------------

export const APPLICATION_TRANSITIONS: Readonly<
  Record<MobileApplicationState, readonly MobileApplicationState[]>
> = Object.freeze({
  PROVISIONING: ['CONFIGURED'],
  CONFIGURED: ['READY_FOR_BUILD', 'SUSPENDED', 'ARCHIVED'],
  READY_FOR_BUILD: ['BUILDING', 'SUSPENDED', 'ARCHIVED', 'CONFIGURED'],
  BUILDING: ['BUILT', 'BUILD_FAILED', 'READY_FOR_BUILD'],
  BUILD_FAILED: ['READY_FOR_BUILD', 'ARCHIVED'],
  BUILT: ['SIGNING', 'READY_FOR_BUILD'],
  SIGNING: ['SIGNED', 'BUILT'],
  SIGNED: ['SECURITY_REVIEW', 'BUILT'],
  SECURITY_REVIEW: ['READY_FOR_RELEASE', 'BUILT'],
  READY_FOR_RELEASE: ['ACTIVE', 'SUSPENDED', 'ARCHIVED'],
  ACTIVE: ['SUSPENDED', 'ARCHIVED', 'READY_FOR_BUILD'],
  SUSPENDED: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: [],
});

export const BUILD_TRANSITIONS: Readonly<Record<MobileBuildState, readonly MobileBuildState[]>> =
  Object.freeze({
    QUEUED: ['VALIDATING', 'FAILED'],
    VALIDATING: ['BUILDING', 'FAILED', 'REJECTED'],
    BUILDING: ['BUILT', 'FAILED'],
    FAILED: [],
    BUILT: ['VERIFYING', 'REJECTED'],
    VERIFYING: ['VERIFIED', 'REJECTED'],
    VERIFIED: [],
    REJECTED: [],
  });

export const RELEASE_TRANSITIONS: Readonly<
  Record<MobileReleaseState, readonly MobileReleaseState[]>
> = Object.freeze({
  DRAFT: ['REVIEW', 'APPROVAL_REQUIRED', 'REJECTED'],
  REVIEW: ['APPROVAL_REQUIRED', 'APPROVED', 'REJECTED'],
  APPROVAL_REQUIRED: ['APPROVED', 'REJECTED'],
  APPROVED: ['SUBMITTING', 'REJECTED'],
  SUBMITTING: ['SUBMITTED', 'APPROVED', 'REJECTED'],
  // SUBMITTED != PUBLISHED: only provider evidence may drive this edge.
  SUBMITTED: ['PUBLISHED', 'REJECTED'],
  // PUBLISHED != ROLLED_OUT: rollout completion requires staged evidence.
  PUBLISHED: ['ROLLED_OUT', 'HALTED', 'ROLLED_BACK'],
  ROLLED_OUT: ['ROLLED_BACK'],
  HALTED: ['ROLLED_BACK'],
  ROLLED_BACK: [],
  REJECTED: [],
});

export const ROLLOUT_TRANSITIONS: Readonly<
  Record<MobileRolloutState, readonly MobileRolloutState[]>
> = Object.freeze({
  NOT_STARTED: ['IN_PROGRESS', 'ABORTED'],
  IN_PROGRESS: ['COMPLETED', 'HALTED'],
  HALTED: ['IN_PROGRESS', 'ABORTED'],
  COMPLETED: [],
  ABORTED: [],
});

export const STORE_TRANSITIONS: Readonly<Record<MobileStoreState, readonly MobileStoreState[]>> =
  Object.freeze({
    NOT_CONFIGURED: ['CONFIGURED'],
    CONFIGURED: ['SUBMISSION_PENDING', 'UNAVAILABLE'],
    SUBMISSION_PENDING: ['SUBMITTED', 'UNAVAILABLE'],
    SUBMITTED: ['PUBLISHED', 'REJECTED', 'UNAVAILABLE'],
    PUBLISHED: [],
    REJECTED: [],
    UNAVAILABLE: ['CONFIGURED', 'SUBMISSION_PENDING'],
  });

/** Stable error codes surfaced through AppException / MobileReleaseError. */
export const MOBILE_ERROR_CODES = Object.freeze({
  ILLEGAL_TRANSITION: 'MOBILE_ILLEGAL_STATE_TRANSITION',
  APP_NOT_FOUND: 'MOBILE_APP_NOT_FOUND',
  APP_STATE: 'MOBILE_APP_STATE_CONFLICT',
  FORBIDDEN: 'MOBILE_FORBIDDEN',
  CROSS_TENANT: 'MOBILE_CROSS_TENANT_ACCESS',
  PARTNER_SCOPE: 'MOBILE_PARTNER_SCOPE_VIOLATION',
  IDENTITY_COLLISION: 'MOBILE_IDENTITY_COLLISION',
  IDENTITY_INVALID: 'MOBILE_IDENTITY_INVALID',
  BRANDING_UNSAFE: 'MOBILE_BRANDING_UNSAFE',
  BRANDING_MISSING: 'MOBILE_BRANDING_MISSING',
  CONFIG_SECRET: 'MOBILE_CONFIG_SECRET_REJECTED',
  BUILD_VALIDATION: 'MOBILE_BUILD_VALIDATION_FAILED',
  BUILD_UNAVAILABLE: 'MOBILE_BUILD_UNAVAILABLE',
  BUILD_NOT_FOUND: 'MOBILE_BUILD_NOT_FOUND',
  ARTIFACT_NOT_FOUND: 'MOBILE_ARTIFACT_NOT_FOUND',
  ARTIFACT_TAMPER: 'MOBILE_ARTIFACT_TAMPER_DETECTED',
  ARTIFACT_MISMATCH: 'MOBILE_ARTIFACT_METADATA_MISMATCH',
  SIGNING_REQUIRED: 'MOBILE_SIGNING_REQUIRED',
  SIGNING_UNAVAILABLE: 'MOBILE_SIGNING_UNAVAILABLE',
  SIGNING_REJECTED: 'MOBILE_SIGNING_MATERIAL_REJECTED',
  SIGNATURE_MISMATCH: 'MOBILE_SIGNATURE_MISMATCH',
  SCAN_REQUIRED: 'MOBILE_SECURITY_SCAN_REQUIRED',
  SCAN_BLOCKED: 'MOBILE_SECURITY_SCAN_BLOCKED',
  RELEASE_NOT_FOUND: 'MOBILE_RELEASE_NOT_FOUND',
  RELEASE_NOT_VERIFIED: 'MOBILE_RELEASE_ARTIFACT_NOT_VERIFIED',
  VERSION_CONFLICT: 'MOBILE_VERSION_ALREADY_RELEASED',
  APPROVAL_REQUIRED: 'MOBILE_APPROVAL_REQUIRED',
  SELF_APPROVAL: 'MOBILE_SELF_APPROVAL_FORBIDDEN',
  ROLLOUT_CONFLICT: 'MOBILE_ROLLOUT_CONFLICT',
  ROLLOUT_EVIDENCE: 'MOBILE_ROLLOUT_EVIDENCE_REQUIRED',
  STORE_NOT_CONFIGURED: 'MOBILE_STORE_NOT_CONFIGURED',
  STORE_UNAVAILABLE: 'MOBILE_STORE_UNAVAILABLE',
  STORE_UNSUPPORTED: 'MOBILE_STORE_OPERATION_UNSUPPORTED',
  STORE_STATE: 'MOBILE_STORE_STATE_CONFLICT',
  CRASH_PAYLOAD: 'MOBILE_CRASH_PAYLOAD_INVALID',
  CRASH_MISMATCH: 'MOBILE_CRASH_RELEASE_MISMATCH',
  ROLLBACK_TARGET: 'MOBILE_ROLLBACK_TARGET_INVALID',
  AUDIT_REQUIRED: 'MOBILE_AUDIT_ENTRY_INVALID',
  RECONCILIATION: 'MOBILE_RECONCILIATION_FINDING',
} as const);

export type MobileErrorCode = (typeof MOBILE_ERROR_CODES)[keyof typeof MOBILE_ERROR_CODES];

/** Domain error carrying a stable code; the API filter maps it to a response. */
export class MobileReleaseError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    httpStatus = 400,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'MobileReleaseError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

/**
 * The one gate every state move goes through. An illegal transition throws
 * MOBILE_ILLEGAL_STATE_TRANSITION with both states attached, so a lifecycle
 * bug is diagnosable from the error alone.
 */
export function transitionOrThrow<S extends string>(
  map: Readonly<Record<S, readonly S[]>>,
  from: S,
  to: S,
  label: string,
): S {
  const allowed = map[from] ?? [];
  if (!allowed.includes(to)) {
    throw new MobileReleaseError(
      MOBILE_ERROR_CODES.ILLEGAL_TRANSITION,
      `${label}: illegal transition ${from} -> ${to}; allowed: ${allowed.join(', ') || 'none'}`,
      409,
      { from, to, label },
    );
  }
  return to;
}

export function canTransition<S extends string>(
  map: Readonly<Record<S, readonly S[]>>,
  from: S,
  to: S,
): boolean {
  return (map[from] ?? []).includes(to);
}

// ---------------------------------------------------------------------------
// Branding and runtime configuration contracts
// ---------------------------------------------------------------------------

/** Mobile-safe branding derived from backend-sanitized TenantBranding. */
export interface MobileBranding {
  appName: string;
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  themeMode: 'system' | 'light' | 'dark';
  iconUrl: string | null;
  splashUrl: string | null;
  logoUrl: string | null;
  supportEmail: string | null;
  supportUrl: string | null;
  termsUrl: string | null;
  privacyUrl: string | null;
}

/** Allow-listed runtime configuration embedded into the app binary. */
export interface MobileRuntimeConfig {
  tenantId: string;
  applicationId: string;
  environment: MobileEnvironment;
  apiBaseUrl: string;
  branding: MobileBranding;
  featureFlags: Record<string, boolean>;
}

/**
 * Patterns that must never appear as KEYS or string VALUES in mobile runtime
 * configuration or audit evidence. Key matching is case-insensitive substring;
 * value matching catches pasted key material even under a benign-looking key.
 */
export const SECRET_KEY_PATTERNS: readonly string[] = [
  'secret',
  'password',
  'passwd',
  'privatekey',
  'private_key',
  'apikey',
  'api_key',
  'accesskey',
  'access_key',
  'signingkey',
  'signing_key',
  'keystorepassword',
  'webhooksecret',
  'serviceaccount',
  'clientsecret',
  'jwtsecret',
  'databaseurl',
  'database_url',
  'connectionstring',
  'credential',
];

export const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/, // JWT-shaped
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/, // Slack-style tokens
  /\bsk_live_[A-Za-z0-9]{10,}/, // Stripe live keys
];

/**
 * True when a key/value pair looks like a credential. Used by the config
 * service (refuse to embed) and the audit service (redact) so the definition
 * of "secret" cannot drift between them.
 */
export function looksLikeSecret(key: string, value: unknown): boolean {
  const lowerKey = key.toLowerCase();
  if (SECRET_KEY_PATTERNS.some((p) => lowerKey.includes(p))) return true;
  if (typeof value === 'string') {
    return SECRET_VALUE_PATTERNS.some((rx) => rx.test(value));
  }
  return false;
}

/** Recursively redact secret-looking entries; returns a new structure. */
export function redactSecrets<T>(input: T, depth = 0): T {
  if (depth > 8) return '[TRUNCATED]' as unknown as T;
  if (Array.isArray(input)) {
    return input.map((v) => redactSecrets(v, depth + 1)) as unknown as T;
  }
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = looksLikeSecret(k, v) ? '[REDACTED]' : redactSecrets(v, depth + 1);
    }
    return out as unknown as T;
  }
  return input;
}

// ---------------------------------------------------------------------------
// Audit vocabulary
// ---------------------------------------------------------------------------

export const AUDIT_ACTIONS = Object.freeze({
  ROLLBACK_REPLAYED: 'MOBILE_ROLLBACK_REPLAYED',
  APP_CREATED: 'APP_CREATED',
  APP_CONFIGURED: 'APP_CONFIGURED',
  APP_STATE_CHANGED: 'APP_STATE_CHANGED',
  BUILD_REQUESTED: 'BUILD_REQUESTED',
  BUILD_VALIDATED: 'BUILD_VALIDATED',
  BUILD_STARTED: 'BUILD_STARTED',
  BUILD_FINISHED: 'BUILD_FINISHED',
  BUILD_FAILED: 'BUILD_FAILED',
  ARTIFACT_RECORDED: 'ARTIFACT_RECORDED',
  ARTIFACT_VERIFIED: 'ARTIFACT_VERIFIED',
  ARTIFACT_TAMPER: 'ARTIFACT_TAMPER_DETECTED',
  SIGNING_ATTEMPTED: 'SIGNING_ATTEMPTED',
  SIGNING_COMPLETED: 'SIGNING_COMPLETED',
  SIGNING_FAILED: 'SIGNING_FAILED',
  SCAN_COMPLETED: 'SECURITY_SCAN_COMPLETED',
  RELEASE_CREATED: 'RELEASE_CREATED',
  RELEASE_APPROVED: 'RELEASE_APPROVED',
  RELEASE_REJECTED: 'RELEASE_REJECTED',
  STORE_SUBMITTED: 'STORE_SUBMITTED',
  STORE_PUBLISHED: 'STORE_PUBLISHED',
  STORE_REJECTED: 'STORE_REJECTED',
  ROLLOUT_STARTED: 'ROLLOUT_STARTED',
  ROLLOUT_ADVANCED: 'ROLLOUT_ADVANCED',
  ROLLOUT_HALTED: 'ROLLOUT_HALTED',
  ROLLOUT_COMPLETED: 'ROLLOUT_COMPLETED',
  ROLLBACK_STARTED: 'ROLLBACK_STARTED',
  ROLLBACK_COMPLETED: 'ROLLBACK_COMPLETED',
  CRASH_INGESTED: 'CRASH_INGESTED',
  RECONCILIATION_RAN: 'RECONCILIATION_RAN',
} as const);

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/** Actor shape distilled from AuthenticatedActor plus the resolved role label. */
export interface MobileActor {
  userId: string;
  tenantId: string | null;
  roles: string[];
  isPlatformUser: boolean;
}

/** Platform roles allowed to run platform-level release actions. */
export const PLATFORM_RELEASE_ROLES: readonly string[] = Object.freeze([
  'PLATFORM_ADMIN',
  'SUPER_ADMIN',
  'RELEASE_APPROVER',
  'SRE',
]);

export function isPlatformReleaseActor(actor: MobileActor): boolean {
  if (!actor.isPlatformUser) return false;
  return actor.roles.some((r) => PLATFORM_RELEASE_ROLES.includes(r));
}

/** Deterministic idempotency key material (sha256 of the canonical parts). */
export function idempotencyKey(...parts: (string | number | null | undefined)[]): string {
  // Lazy require keeps types.ts import-graph free of node types for consumers
  // that only want the vocabulary; the crypto module is a Node builtin.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createHash } = require('crypto') as typeof import('crypto');
  return createHash('sha256')
    .update(parts.map((p) => (p === null || p === undefined ? '' : String(p))).join('|'))
    .digest('hex')
    .slice(0, 64);
}

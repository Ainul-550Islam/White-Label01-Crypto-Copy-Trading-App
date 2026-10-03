/**
 * Shared vocabulary of the SSO login flow (OIDC authorization-code + SAML).
 *
 * Reason codes are machine-readable and internal: they go to the durable
 * audit trail and to metrics stages, never to an external response. External
 * responses are deliberately generic so they reveal neither tenant, user nor
 * configuration details.
 */

/** Why an SSO login was refused. Internal only. */
export enum SsoReasonCode {
  // Transaction / state
  STATE_MISSING = 'STATE_MISSING',
  STATE_UNKNOWN = 'STATE_UNKNOWN',
  STATE_EXPIRED = 'STATE_EXPIRED',
  STATE_CONSUMED = 'STATE_CONSUMED',
  TENANT_MISMATCH = 'TENANT_MISMATCH',
  PROVIDER_MISMATCH = 'PROVIDER_MISMATCH',
  BINDING_MISMATCH = 'BINDING_MISMATCH',
  DEVICE_MISMATCH = 'DEVICE_MISMATCH',
  TOO_MANY_PENDING = 'TOO_MANY_PENDING',
  RETURN_TO_INVALID = 'RETURN_TO_INVALID',
  HANDOFF_INVALID = 'HANDOFF_INVALID',

  // Configuration / provider
  PROVIDER_NOT_CONFIGURED = 'PROVIDER_NOT_CONFIGURED',
  PROVIDER_DISABLED = 'PROVIDER_DISABLED',
  CONFIG_INVALID = 'CONFIG_INVALID',
  PROVIDER_UNAVAILABLE = 'PROVIDER_UNAVAILABLE',
  IDP_ERROR = 'IDP_ERROR',

  // OIDC code redemption / ID token
  CODE_MISSING = 'CODE_MISSING',
  TOKEN_EXCHANGE_FAILED = 'TOKEN_EXCHANGE_FAILED',
  PKCE_FAILED = 'PKCE_FAILED',
  ID_TOKEN_MISSING = 'ID_TOKEN_MISSING',
  ID_TOKEN_MALFORMED = 'ID_TOKEN_MALFORMED',
  SIGNATURE_INVALID = 'SIGNATURE_INVALID',
  ALGORITHM_REJECTED = 'ALGORITHM_REJECTED',
  KEY_NOT_FOUND = 'KEY_NOT_FOUND',
  ISSUER_MISMATCH = 'ISSUER_MISMATCH',
  AUDIENCE_MISMATCH = 'AUDIENCE_MISMATCH',
  AZP_MISMATCH = 'AZP_MISMATCH',
  NONCE_MISMATCH = 'NONCE_MISMATCH',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_TIME_INVALID = 'TOKEN_TIME_INVALID',
  AUTH_TIME_TOO_OLD = 'AUTH_TIME_TOO_OLD',
  CLAIMS_MISSING = 'CLAIMS_MISSING',

  // SAML
  SAML_DISABLED = 'SAML_DISABLED',
  SAML_MALFORMED = 'SAML_MALFORMED',
  SAML_SIGNATURE_INVALID = 'SAML_SIGNATURE_INVALID',
  SAML_ISSUER_MISMATCH = 'SAML_ISSUER_MISMATCH',
  SAML_AUDIENCE_MISMATCH = 'SAML_AUDIENCE_MISMATCH',
  SAML_DESTINATION_MISMATCH = 'SAML_DESTINATION_MISMATCH',
  SAML_RECIPIENT_MISMATCH = 'SAML_RECIPIENT_MISMATCH',
  SAML_EXPIRED = 'SAML_EXPIRED',
  SAML_IN_RESPONSE_TO_MISMATCH = 'SAML_IN_RESPONSE_TO_MISMATCH',
  SAML_REPLAY = 'SAML_REPLAY',
  SAML_STATUS_NOT_SUCCESS = 'SAML_STATUS_NOT_SUCCESS',
  /** The configuration requires encrypted assertions and the response carried a plaintext one. */
  SAML_ASSERTION_NOT_ENCRYPTED = 'SAML_ASSERTION_NOT_ENCRYPTED',
  /** Single Logout needs the IdP SLO URL, our SLO URL and the SP signing pair; one is missing or invalid. */
  SAML_SLO_NOT_CONFIGURED = 'SAML_SLO_NOT_CONFIGURED',
  /** The session was created before Single Logout was available and holds no NameID / SessionIndex. */
  SAML_SLO_CONTEXT_MISSING = 'SAML_SLO_CONTEXT_MISSING',

  // Identity mapping / account
  EMAIL_MISSING = 'EMAIL_MISSING',
  EMAIL_NOT_VERIFIED = 'EMAIL_NOT_VERIFIED',
  EMAIL_DOMAIN_NOT_ALLOWED = 'EMAIL_DOMAIN_NOT_ALLOWED',
  IDENTITY_LINK_REQUIRED = 'IDENTITY_LINK_REQUIRED',
  IDENTITY_CONFLICT = 'IDENTITY_CONFLICT',
  JIT_DISABLED = 'JIT_DISABLED',
  ACCOUNT_UNAVAILABLE = 'ACCOUNT_UNAVAILABLE',
  USER_TENANT_MISMATCH = 'USER_TENANT_MISMATCH',

  // Session
  SESSION_ISSUANCE_FAILED = 'SESSION_ISSUANCE_FAILED',
}

/** Durable audit event codes (sso_audit_events.event_code). */
export enum SsoAuditEventCode {
  AUTHORIZATION_STARTED = 'SSO_AUTHORIZATION_STARTED',
  CALLBACK_RECEIVED = 'SSO_CALLBACK_RECEIVED',
  STATE_REJECTED = 'SSO_STATE_REJECTED',
  NONCE_REJECTED = 'SSO_NONCE_REJECTED',
  PKCE_FAILURE = 'SSO_PKCE_FAILURE',
  TOKEN_VALIDATION_FAILED = 'SSO_TOKEN_VALIDATION_FAILED',
  ISSUER_REJECTED = 'SSO_ISSUER_REJECTED',
  AUDIENCE_REJECTED = 'SSO_AUDIENCE_REJECTED',
  SIGNATURE_REJECTED = 'SSO_SIGNATURE_REJECTED',
  IDENTITY_MAPPING_FAILED = 'SSO_IDENTITY_MAPPING_FAILED',
  TENANT_MISMATCH = 'SSO_TENANT_MISMATCH',
  PROVIDER_UNAVAILABLE = 'SSO_PROVIDER_UNAVAILABLE',
  SAML_ASSERTION_VERIFIED = 'SSO_SAML_ASSERTION_VERIFIED',
  SAML_ASSERTION_REJECTED = 'SSO_SAML_ASSERTION_REJECTED',
  REPLAY_REJECTED = 'SSO_REPLAY_REJECTED',
  MFA_CHALLENGE_ISSUED = 'SSO_MFA_CHALLENGE_ISSUED',
  SESSION_CREATED = 'SSO_SESSION_CREATED',
  LOGIN_SUCCEEDED = 'SSO_LOGIN_SUCCEEDED',
  LOGIN_REJECTED = 'SSO_LOGIN_REJECTED',
  /** SP-initiated SAML logout: a signed LogoutRequest URL was issued for a session. */
  SAML_LOGOUT_REQUESTED = 'SSO_SAML_LOGOUT_REQUESTED',
  /** SP-initiated SAML logout: the IdP's signed LogoutResponse (Success) was verified. */
  SAML_LOGOUT_COMPLETED = 'SSO_SAML_LOGOUT_COMPLETED',
  /** IdP-initiated SAML logout: a signed LogoutRequest was verified and its sessions revoked. */
  SAML_IDP_LOGOUT_COMPLETED = 'SSO_SAML_IDP_LOGOUT_COMPLETED',
  /** A SAML logout message (either direction) was refused; reasonCode says why. */
  SAML_LOGOUT_REJECTED = 'SSO_SAML_LOGOUT_REJECTED',
}

export type SsoAuditOutcome = 'SUCCESS' | 'FAILURE' | 'INFO';

/** Closed set of metric stages (wlct_sso_failures_total{stage}). */
export type SsoFailureStage =
  | 'state'
  | 'nonce'
  | 'pkce'
  | 'token_validation'
  | 'saml_verification'
  | 'replay'
  | 'identity_mapping'
  | 'session_issuance'
  | 'provider_outage'
  | 'config';

export const SSO_FAILURE_STAGES: readonly SsoFailureStage[] = Object.freeze([
  'state',
  'nonce',
  'pkce',
  'token_validation',
  'saml_verification',
  'replay',
  'identity_mapping',
  'session_issuance',
  'provider_outage',
  'config',
]);

export type SsoLoginResult = 'started' | 'succeeded' | 'denied';

export const SSO_LOGIN_RESULTS: readonly SsoLoginResult[] = Object.freeze([
  'started',
  'succeeded',
  'denied',
]);

/**
 * A refused SSO step. `reason` is internal; `message` is for logs and the
 * audit trail and must never contain a credential, token, assertion, nonce,
 * code or verifier.
 */
export class SsoAuthError extends Error {
  constructor(
    public readonly reason: SsoReasonCode,
    message?: string,
  ) {
    super(message ?? reason);
    this.name = 'SsoAuthError';
  }
}

/** The audit event that best describes a refusal reason. */
export function auditEventForReason(reason: SsoReasonCode): SsoAuditEventCode {
  switch (reason) {
    case SsoReasonCode.STATE_MISSING:
    case SsoReasonCode.STATE_UNKNOWN:
    case SsoReasonCode.STATE_EXPIRED:
    case SsoReasonCode.PROVIDER_MISMATCH:
    case SsoReasonCode.BINDING_MISMATCH:
    case SsoReasonCode.DEVICE_MISMATCH:
    case SsoReasonCode.HANDOFF_INVALID:
      return SsoAuditEventCode.STATE_REJECTED;
    case SsoReasonCode.STATE_CONSUMED:
    case SsoReasonCode.SAML_REPLAY:
      return SsoAuditEventCode.REPLAY_REJECTED;
    case SsoReasonCode.TENANT_MISMATCH:
    case SsoReasonCode.USER_TENANT_MISMATCH:
      return SsoAuditEventCode.TENANT_MISMATCH;
    case SsoReasonCode.NONCE_MISMATCH:
      return SsoAuditEventCode.NONCE_REJECTED;
    case SsoReasonCode.PKCE_FAILED:
      return SsoAuditEventCode.PKCE_FAILURE;
    case SsoReasonCode.ISSUER_MISMATCH:
      return SsoAuditEventCode.ISSUER_REJECTED;
    case SsoReasonCode.AUDIENCE_MISMATCH:
    case SsoReasonCode.AZP_MISMATCH:
      return SsoAuditEventCode.AUDIENCE_REJECTED;
    case SsoReasonCode.SIGNATURE_INVALID:
    case SsoReasonCode.ALGORITHM_REJECTED:
    case SsoReasonCode.KEY_NOT_FOUND:
      return SsoAuditEventCode.SIGNATURE_REJECTED;
    case SsoReasonCode.CODE_MISSING:
    case SsoReasonCode.TOKEN_EXCHANGE_FAILED:
    case SsoReasonCode.ID_TOKEN_MISSING:
    case SsoReasonCode.ID_TOKEN_MALFORMED:
    case SsoReasonCode.TOKEN_EXPIRED:
    case SsoReasonCode.TOKEN_TIME_INVALID:
    case SsoReasonCode.AUTH_TIME_TOO_OLD:
    case SsoReasonCode.CLAIMS_MISSING:
    case SsoReasonCode.IDP_ERROR:
      return SsoAuditEventCode.TOKEN_VALIDATION_FAILED;
    case SsoReasonCode.SAML_DISABLED:
    case SsoReasonCode.SAML_MALFORMED:
    case SsoReasonCode.SAML_SIGNATURE_INVALID:
    case SsoReasonCode.SAML_ISSUER_MISMATCH:
    case SsoReasonCode.SAML_AUDIENCE_MISMATCH:
    case SsoReasonCode.SAML_DESTINATION_MISMATCH:
    case SsoReasonCode.SAML_RECIPIENT_MISMATCH:
    case SsoReasonCode.SAML_EXPIRED:
    case SsoReasonCode.SAML_IN_RESPONSE_TO_MISMATCH:
    case SsoReasonCode.SAML_STATUS_NOT_SUCCESS:
    case SsoReasonCode.SAML_ASSERTION_NOT_ENCRYPTED:
      return SsoAuditEventCode.SAML_ASSERTION_REJECTED;
    case SsoReasonCode.EMAIL_MISSING:
    case SsoReasonCode.EMAIL_NOT_VERIFIED:
    case SsoReasonCode.EMAIL_DOMAIN_NOT_ALLOWED:
    case SsoReasonCode.IDENTITY_LINK_REQUIRED:
    case SsoReasonCode.IDENTITY_CONFLICT:
    case SsoReasonCode.JIT_DISABLED:
    case SsoReasonCode.ACCOUNT_UNAVAILABLE:
      return SsoAuditEventCode.IDENTITY_MAPPING_FAILED;
    case SsoReasonCode.PROVIDER_UNAVAILABLE:
      return SsoAuditEventCode.PROVIDER_UNAVAILABLE;
    default:
      return SsoAuditEventCode.LOGIN_REJECTED;
  }
}

/** The metric stage a refusal reason is counted under. */
export function failureStageForReason(reason: SsoReasonCode): SsoFailureStage {
  switch (reason) {
    case SsoReasonCode.NONCE_MISMATCH:
      return 'nonce';
    case SsoReasonCode.PKCE_FAILED:
      return 'pkce';
    case SsoReasonCode.STATE_CONSUMED:
    case SsoReasonCode.SAML_REPLAY:
      return 'replay';
    case SsoReasonCode.STATE_MISSING:
    case SsoReasonCode.STATE_UNKNOWN:
    case SsoReasonCode.STATE_EXPIRED:
    case SsoReasonCode.TENANT_MISMATCH:
    case SsoReasonCode.PROVIDER_MISMATCH:
    case SsoReasonCode.BINDING_MISMATCH:
    case SsoReasonCode.DEVICE_MISMATCH:
    case SsoReasonCode.HANDOFF_INVALID:
    case SsoReasonCode.TOO_MANY_PENDING:
    case SsoReasonCode.RETURN_TO_INVALID:
      return 'state';
    case SsoReasonCode.PROVIDER_UNAVAILABLE:
      return 'provider_outage';
    case SsoReasonCode.PROVIDER_NOT_CONFIGURED:
    case SsoReasonCode.PROVIDER_DISABLED:
    case SsoReasonCode.CONFIG_INVALID:
    case SsoReasonCode.SAML_DISABLED:
    case SsoReasonCode.SAML_SLO_NOT_CONFIGURED:
    case SsoReasonCode.SAML_SLO_CONTEXT_MISSING:
      return 'config';
    case SsoReasonCode.SAML_MALFORMED:
    case SsoReasonCode.SAML_SIGNATURE_INVALID:
    case SsoReasonCode.SAML_ISSUER_MISMATCH:
    case SsoReasonCode.SAML_AUDIENCE_MISMATCH:
    case SsoReasonCode.SAML_DESTINATION_MISMATCH:
    case SsoReasonCode.SAML_RECIPIENT_MISMATCH:
    case SsoReasonCode.SAML_EXPIRED:
    case SsoReasonCode.SAML_IN_RESPONSE_TO_MISMATCH:
    case SsoReasonCode.SAML_STATUS_NOT_SUCCESS:
    case SsoReasonCode.SAML_ASSERTION_NOT_ENCRYPTED:
      return 'saml_verification';
    case SsoReasonCode.EMAIL_MISSING:
    case SsoReasonCode.EMAIL_NOT_VERIFIED:
    case SsoReasonCode.EMAIL_DOMAIN_NOT_ALLOWED:
    case SsoReasonCode.IDENTITY_LINK_REQUIRED:
    case SsoReasonCode.IDENTITY_CONFLICT:
    case SsoReasonCode.JIT_DISABLED:
    case SsoReasonCode.ACCOUNT_UNAVAILABLE:
    case SsoReasonCode.USER_TENANT_MISMATCH:
      return 'identity_mapping';
    case SsoReasonCode.SESSION_ISSUANCE_FAILED:
      return 'session_issuance';
    default:
      return 'token_validation';
  }
}

/** Transaction lifetime: abandoned logins expire after this many seconds. */
export const SSO_TRANSACTION_TTL_SECONDS = 600;
/** SAML: the hand-off code returned after the ACS is valid this long. */
export const SSO_HANDOFF_TTL_SECONDS = 120;
/** At most this many unexpired, unconsumed transactions per tenant + client IP. */
export const SSO_MAX_PENDING_PER_CLIENT = 10;
/** Upper bound on the configurable clock skew. */
export const SSO_MAX_CLOCK_SKEW_SECONDS = 300;
/** Default clock skew when a configuration does not set one. */
export const SSO_DEFAULT_CLOCK_SKEW_SECONDS = 60;
/** ID tokens older than this (iat) are refused even if exp is later. */
export const SSO_MAX_ID_TOKEN_AGE_SECONDS = 900;

/** Asymmetric JWS algorithms an ID token may use. `none` and HS* are never accepted. */
export const SSO_ASYMMETRIC_ALGORITHMS: readonly string[] = Object.freeze([
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
]);

export type SsoTransactionStatus = 'PENDING' | 'VERIFIED' | 'CONSUMED' | 'REJECTED';

/** Clamp a configured clock skew into [0, SSO_MAX_CLOCK_SKEW_SECONDS]. */
export function effectiveClockSkew(configured: number | null | undefined): number {
  if (typeof configured !== 'number' || !Number.isFinite(configured))
    return SSO_DEFAULT_CLOCK_SKEW_SECONDS;
  return Math.min(Math.max(Math.trunc(configured), 0), SSO_MAX_CLOCK_SKEW_SECONDS);
}

/**
 * A post-login return path must be app-relative: it starts with a single
 * "/" and contains no scheme, host, backslash or control character. Anything
 * else is an open-redirect vector.
 */
export function isSafeReturnTo(value: string): boolean {
  if (value.length === 0 || value.length > 512) return false;
  if (!value.startsWith('/') || value.startsWith('//')) return false;
  if (value.includes('\\')) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  return !/^\/[a-z][a-z0-9+.-]*:/i.test(value);
}

/**
 * Whether a URL may be used for an IdP endpoint or a redirect URI. HTTPS is
 * required; plain http is accepted only for loopback hosts when
 * SSO_ALLOW_INSECURE_HTTP=true outside production (local IdPs in development
 * and tests).
 */
export function isAllowedSsoUrl(raw: string, env: NodeJS.ProcessEnv = process.env): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol !== 'http:') return false;
  const insecureAllowed = env.SSO_ALLOW_INSECURE_HTTP === 'true' && env.NODE_ENV !== 'production';
  const loopback =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  return insecureAllowed && loopback;
}

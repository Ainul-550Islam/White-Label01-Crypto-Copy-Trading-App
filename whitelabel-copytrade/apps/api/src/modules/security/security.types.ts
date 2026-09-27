/**
 * Canonical security domain types: authentication factors, session state, API-key state, device state, SSO provider, security event, risk state, and policy references.
 * Preserves existing SecurityEventType / SecuritySeverity where applicable, extends for enterprise IAM.
 */

export enum AuthFactor {
  PASSWORD = 'PASSWORD',
  TOTP = 'TOTP',
  WEBAUTHN = 'WEBAUTHN',
  SAML = 'SAML',
  OIDC = 'OIDC',
  RECOVERY = 'RECOVERY',
}

export enum SessionState {
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  REVOKED = 'REVOKED',
  SUSPICIOUS = 'SUSPICIOUS',
}

export enum ApiKeyState {
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  REVOKED = 'REVOKED',
  ROTATED = 'ROTATED',
}

export enum DeviceState {
  UNKNOWN = 'UNKNOWN',
  PENDING_TRUST = 'PENDING_TRUST',
  TRUSTED = 'TRUSTED',
  REVOKED = 'REVOKED',
}

export enum SsoProvider {
  SAML = 'SAML',
  OIDC = 'OIDC',
}

export enum SecurityRisk {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum SecurityDecision {
  ALLOW = 'ALLOW',
  STEP_UP_REQUIRED = 'STEP_UP_REQUIRED',
  DENY = 'DENY',
  SUSPICIOUS = 'SUSPICIOUS',
  REVIEW_REQUIRED = 'REVIEW_REQUIRED',
}

export enum SecurityEventType {
  LOGIN_SUCCESS = 'LOGIN_SUCCESS',
  LOGIN_FAILURE = 'LOGIN_FAILURE',
  LOGOUT = 'LOGOUT',
  MFA_REQUIRED = 'MFA_REQUIRED',
  MFA_SUCCESS = 'MFA_SUCCESS',
  MFA_FAILURE = 'MFA_FAILURE',
  SSO_LOGIN_STARTED = 'SSO_LOGIN_STARTED',
  SSO_LOGIN_SUCCESS = 'SSO_LOGIN_SUCCESS',
  SSO_LOGIN_FAILURE = 'SSO_LOGIN_FAILURE',
  API_KEY_CREATED = 'API_KEY_CREATED',
  API_KEY_ROTATED = 'API_KEY_ROTATED',
  API_KEY_REVOKED = 'API_KEY_REVOKED',
  SESSION_CREATED = 'SESSION_CREATED',
  SESSION_REVOKED = 'SESSION_REVOKED',
  SESSION_SUSPICIOUS = 'SESSION_SUSPICIOUS',
  DEVICE_REGISTERED = 'DEVICE_REGISTERED',
  DEVICE_TRUSTED = 'DEVICE_TRUSTED',
  DEVICE_REVOKED = 'DEVICE_REVOKED',
  SECURITY_POLICY_CHANGED = 'SECURITY_POLICY_CHANGED',
  PRIVILEGED_ACTION = 'PRIVILEGED_ACTION',
  SECURITY_ALERT = 'SECURITY_ALERT',
  // Preserve existing types
  SUSPICIOUS_LOGIN = 'SUSPICIOUS_LOGIN',
  NEW_DEVICE_LOGIN = 'NEW_DEVICE_LOGIN',
  IMPOSSIBLE_TRAVEL = 'IMPOSSIBLE_TRAVEL',
  BRUTE_FORCE_SUSPECTED = 'BRUTE_FORCE_SUSPECTED',
  CREDENTIAL_STUFFING_SUSPECTED = 'CREDENTIAL_STUFFING_SUSPECTED',
  TOKEN_REUSE = 'TOKEN_REUSE',
  RATE_LIMIT_ABUSE = 'RATE_LIMIT_ABUSE',
  PERMISSION_ESCALATION_ATTEMPT = 'PERMISSION_ESCALATION_ATTEMPT',
  TENANT_ISOLATION_VIOLATION = 'TENANT_ISOLATION_VIOLATION',
  ENCRYPTION_FAILURE = 'ENCRYPTION_FAILURE',
}

export interface NormalizedSsoIdentity {
  provider: SsoProvider;
  issuer: string;
  subject: string;
  email: string;
  emailVerified?: boolean;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  tenantId: string;
  tenantSlug?: string;
  providerReference: string;
  groups?: string[];
  roles?: string[];
  amr?: AuthFactor[];
  safeMetadata: Record<string, any>;
}

export interface SsoProviderConfig {
  id: string;
  tenantId: string;
  providerType: SsoProvider;
  state: 'DISABLED' | 'ENABLED' | 'ENFORCED';
  issuer?: string;
  audience?: string;
  clientId?: string;
  metadataUrl?: string;
  entityId?: string;
  acsUrl?: string;
  ssoUrl?: string;
  discoveryUrl?: string;
  jwksUrl?: string;
  allowedDomains: string[];
  enforced: boolean;
  jitEnabled: boolean;
  defaultRole?: string;
  scopes: string[];
  isActive: boolean;
  createdById?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKeyRecord {
  id: string;
  tenantId: string;
  userId: string;
  name: string;
  keyId: string;
  fingerprint: string;
  scopes: string[];
  state: ApiKeyState;
  ipAllowlist: string[];
  expiresAt?: string;
  lastUsedAt?: string;
  revokedAt?: string;
  rotatedAt?: string;
  rotatedFromId?: string;
  createdById?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionSecurityRecord {
  id: string;
  userId: string;
  tenantId: string;
  deviceId: string;
  state: SessionState;
  ipHash: string;
  userAgentHash?: string;
  geoLabel?: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  idleExpiresAt?: string;
  absoluteExpiresAt?: string;
  revokedAt?: string;
  suspicious: boolean;
  trusted: boolean;
  safeMetadata: Record<string, any>;
}

export interface DeviceTrustRecord {
  id: string;
  tenantId: string;
  userId: string;
  deviceId: string;
  deviceHash: string;
  state: DeviceState;
  trustedAt?: string;
  expiresAt?: string;
  lastSeenAt: string;
  revokedAt?: string;
  ipHash?: string;
  userAgentHash?: string;
  safeMetadata: Record<string, any>;
}

export interface SecurityPolicy {
  id: string;
  tenantId: string | null;
  policyVersion: string;
  mfaRequired: boolean;
  mfaForPrivilegedRoles: boolean;
  mfaForSensitiveOperations: boolean;
  sessionAbsoluteTimeoutSec: number;
  sessionIdleTimeoutSec: number;
  maxConcurrentSessions: number;
  deviceTrustDurationDays: number;
  apiKeyExpirationDays: number;
  apiKeyRotationDays: number;
  ssoEnforced: boolean;
  allowedSsoDomains: string[];
  jitProvisioning: boolean;
  privilegedReauthRequired: boolean;
  securityNotifications: boolean;
  passwordMinLength: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SecurityEvent {
  id?: string;
  tenantId: string | null;
  userId?: string | null;
  type: SecurityEventType;
  severity: SecurityRisk;
  description: string;
  safeMetadata?: Record<string, any>;
  ipHash?: string;
  userAgent?: string;
  requestId?: string;
  createdAt?: string;
}

export interface ThreatSignal {
  id: string;
  tenantId: string;
  userId?: string;
  ruleId: string;
  riskLevel: SecurityRisk;
  decision: SecurityDecision;
  sourceEventIds: string[];
  safeSummary: string;
  policyVersion?: string;
  recommendedAction: string;
  createdAt: string;
}

export const SENSITIVE_SECURITY_FIELDS = [
  'password',
  'secret',
  'token',
  'assertion',
  'samlResponse',
  'idToken',
  'accessToken',
  'refreshToken',
  'privateKey',
  'apiKey',
  'recoveryCode',
  'clientSecret',
  'certificatePrivate',
];

export function sanitizeSecurityMetadata(metadata: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};
  for (const [k, v] of Object.entries(metadata)) {
    const lower = k.toLowerCase();
    if (SENSITIVE_SECURITY_FIELDS.some((f) => lower.includes(f.toLowerCase()))) {
      sanitized[k] = '[REDACTED]';
    } else if (typeof v === 'object' && v !== null) {
      sanitized[k] = sanitizeSecurityMetadata(v as any);
    } else {
      sanitized[k] = v;
    }
  }
  return sanitized;
}

export function hashValue(value: string): string {
  // Deterministic hash for safe reference, not cryptographic - HMAC used in persistence
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(value).digest('hex').substring(0, 16);
}

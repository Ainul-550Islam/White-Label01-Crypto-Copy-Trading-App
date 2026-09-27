/**
 * Part 20 — Institutional Client Lifecycle, Account Administration & Funding Control Plane
 * Canonical client, account, relationship, onboarding, approval, funding, withdrawal, restriction,
 * suspension, closure, and workflow states plus explicit transition maps and lifecycle constants.
 *
 * Rules:
 * - Never trust client-supplied account state, approval state, compliance state, risk state, balance, funding status, or ownership.
 * - All sensitive lifecycle transitions must be state-machine validated.
 * - All privileged transitions must be authorized by existing IAM/RBAC policies.
 * - Funding/withdrawal requests are workflow records, not proof of movement of funds.
 * - Decimal-safe financial fields wherever amounts are stored or processed.
 * - PII and sensitive account information must be protected and redacted.
 */

import { createHash } from 'crypto';

export enum ClientProfileStatus {
  PENDING = 'PENDING',
  ONBOARDING = 'ONBOARDING',
  UNDER_REVIEW = 'UNDER_REVIEW',
  APPROVED = 'APPROVED',
  ACTIVE = 'ACTIVE',
  RESTRICTED = 'RESTRICTED',
  SUSPENDED = 'SUSPENDED',
  CLOSURE_PENDING = 'CLOSURE_PENDING',
  CLOSED = 'CLOSED',
}

export enum InstitutionalAccountState {
  PENDING = 'PENDING',
  ONBOARDING = 'ONBOARDING',
  UNDER_REVIEW = 'UNDER_REVIEW',
  APPROVED = 'APPROVED',
  ACTIVE = 'ACTIVE',
  RESTRICTED = 'RESTRICTED',
  SUSPENDED = 'SUSPENDED',
  CLOSURE_PENDING = 'CLOSURE_PENDING',
  CLOSED = 'CLOSED',
}

export enum ClientOnboardingState {
  NOT_STARTED = 'NOT_STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  PENDING_REVIEW = 'PENDING_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

export enum ClientOnboardingStepType {
  PROFILE_CREATED = 'PROFILE_CREATED',
  IDENTITY_REQUIRED = 'IDENTITY_REQUIRED',
  KYC_PENDING = 'KYC_PENDING',
  AML_PENDING = 'AML_PENDING',
  SECURITY_SETUP_REQUIRED = 'SECURITY_SETUP_REQUIRED',
  COMPLIANCE_REVIEW = 'COMPLIANCE_REVIEW',
  RISK_REVIEW = 'RISK_REVIEW',
  ACCOUNT_CONFIGURATION = 'ACCOUNT_CONFIGURATION',
  EXCHANGE_BINDING = 'EXCHANGE_BINDING',
  PORTFOLIO_BINDING = 'PORTFOLIO_BINDING',
  APPROVAL = 'APPROVAL',
  ACTIVATION_ELIGIBILITY = 'ACTIVATION_ELIGIBILITY',
}

export enum ClientOnboardingStepStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  BLOCKED = 'BLOCKED',
  SKIPPED = 'SKIPPED',
}

export enum AccountOwnershipType {
  OWNER = 'OWNER',
  MANAGER = 'MANAGER',
  OPERATOR = 'OPERATOR',
  BENEFICIAL_OWNER = 'BENEFICIAL_OWNER',
}

export enum AccountRelationshipType {
  CLIENT_TO_MANAGED_ACCOUNT = 'CLIENT_TO_MANAGED_ACCOUNT',
  CLIENT_TO_PORTFOLIO = 'CLIENT_TO_PORTFOLIO',
  CLIENT_TO_EXCHANGE_ACCOUNT = 'CLIENT_TO_EXCHANGE_ACCOUNT',
  CLIENT_TO_FOLLOWER = 'CLIENT_TO_FOLLOWER',
  CLIENT_TO_TRADER = 'CLIENT_TO_TRADER',
  CLIENT_TO_STRATEGY = 'CLIENT_TO_STRATEGY',
  TRADER_TO_FOLLOWER = 'TRADER_TO_FOLLOWER',
  CLIENT_TO_CLIENT = 'CLIENT_TO_CLIENT',
  OPERATOR_TO_ACCOUNT = 'OPERATOR_TO_ACCOUNT',
}

export enum RelationshipStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  PENDING = 'PENDING',
  REVOKED = 'REVOKED',
}

export enum AccountRestrictionType {
  NO_TRADING = 'NO_TRADING',
  NO_COPY_TRADING = 'NO_COPY_TRADING',
  NO_WITHDRAWAL = 'NO_WITHDRAWAL',
  NO_DEPOSIT = 'NO_DEPOSIT',
  READ_ONLY = 'READ_ONLY',
  REVIEW_REQUIRED = 'REVIEW_REQUIRED',
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
  COMPLIANCE_HOLD = 'COMPLIANCE_HOLD',
  SECURITY_HOLD = 'SECURITY_HOLD',
  RISK_HOLD = 'RISK_HOLD',
  OPERATIONAL_HOLD = 'OPERATIONAL_HOLD',
}

export enum RestrictionScope {
  ACCOUNT = 'ACCOUNT',
  CLIENT = 'CLIENT',
  TENANT = 'TENANT',
  GLOBAL = 'GLOBAL',
}

export enum RestrictionStatus {
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  REVOKED = 'REVOKED',
  PENDING = 'PENDING',
}

export enum FundingRequestState {
  REQUESTED = 'REQUESTED',
  UNDER_REVIEW = 'UNDER_REVIEW',
  APPROVED = 'APPROVED',
  SUBMITTED = 'SUBMITTED',
  CONFIRMED = 'CONFIRMED',
  FAILED = 'FAILED',
  REVERSED = 'REVERSED',
  CANCELLED = 'CANCELLED',
}

export enum WithdrawalRequestState {
  REQUESTED = 'REQUESTED',
  UNDER_REVIEW = 'UNDER_REVIEW',
  APPROVED = 'APPROVED',
  SUBMITTED = 'SUBMITTED',
  CONFIRMED = 'CONFIRMED',
  FAILED = 'FAILED',
  REVERSED = 'REVERSED',
  CANCELLED = 'CANCELLED',
}

export enum FundingApprovalDecision {
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  PENDING = 'PENDING',
  ESCALATED = 'ESCALATED',
}

export enum ClientReviewType {
  PERIODIC = 'PERIODIC',
  MANUAL = 'MANUAL',
  COMPLIANCE = 'COMPLIANCE',
  RISK = 'RISK',
  SECURITY = 'SECURITY',
  OPERATIONAL = 'OPERATIONAL',
}

export enum ClientReviewDecision {
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  ESCALATED = 'ESCALATED',
  PENDING = 'PENDING',
  REVIEW_REQUIRED = 'REVIEW_REQUIRED',
}

export enum TradingEligibilityStatus {
  ELIGIBLE = 'ELIGIBLE',
  BLOCKED = 'BLOCKED',
  REVIEW_REQUIRED = 'REVIEW_REQUIRED',
}

// Explicit transition maps — do not permit arbitrary client-selected transitions

export const CLIENT_PROFILE_VALID_TRANSITIONS: Record<ClientProfileStatus, ClientProfileStatus[]> = {
  [ClientProfileStatus.PENDING]: [ClientProfileStatus.ONBOARDING],
  [ClientProfileStatus.ONBOARDING]: [ClientProfileStatus.UNDER_REVIEW, ClientProfileStatus.CLOSED],
  [ClientProfileStatus.UNDER_REVIEW]: [ClientProfileStatus.APPROVED, ClientProfileStatus.RESTRICTED, ClientProfileStatus.CLOSED],
  [ClientProfileStatus.APPROVED]: [ClientProfileStatus.ACTIVE, ClientProfileStatus.RESTRICTED, ClientProfileStatus.CLOSURE_PENDING],
  [ClientProfileStatus.ACTIVE]: [ClientProfileStatus.RESTRICTED, ClientProfileStatus.SUSPENDED, ClientProfileStatus.CLOSURE_PENDING],
  [ClientProfileStatus.RESTRICTED]: [ClientProfileStatus.ACTIVE, ClientProfileStatus.SUSPENDED, ClientProfileStatus.CLOSURE_PENDING],
  [ClientProfileStatus.SUSPENDED]: [ClientProfileStatus.ACTIVE, ClientProfileStatus.CLOSURE_PENDING, ClientProfileStatus.CLOSED],
  [ClientProfileStatus.CLOSURE_PENDING]: [ClientProfileStatus.CLOSED, ClientProfileStatus.ACTIVE],
  [ClientProfileStatus.CLOSED]: [], // immutable, historical records retained
};

export const INSTITUTIONAL_ACCOUNT_VALID_TRANSITIONS: Record<InstitutionalAccountState, InstitutionalAccountState[]> = {
  [InstitutionalAccountState.PENDING]: [InstitutionalAccountState.ONBOARDING],
  [InstitutionalAccountState.ONBOARDING]: [InstitutionalAccountState.UNDER_REVIEW, InstitutionalAccountState.CLOSED],
  [InstitutionalAccountState.UNDER_REVIEW]: [InstitutionalAccountState.APPROVED, InstitutionalAccountState.RESTRICTED, InstitutionalAccountState.CLOSED],
  [InstitutionalAccountState.APPROVED]: [InstitutionalAccountState.ACTIVE, InstitutionalAccountState.RESTRICTED],
  [InstitutionalAccountState.ACTIVE]: [InstitutionalAccountState.RESTRICTED, InstitutionalAccountState.SUSPENDED, InstitutionalAccountState.CLOSURE_PENDING],
  [InstitutionalAccountState.RESTRICTED]: [InstitutionalAccountState.ACTIVE, InstitutionalAccountState.SUSPENDED, InstitutionalAccountState.CLOSURE_PENDING],
  [InstitutionalAccountState.SUSPENDED]: [InstitutionalAccountState.ACTIVE, InstitutionalAccountState.CLOSURE_PENDING, InstitutionalAccountState.CLOSED],
  [InstitutionalAccountState.CLOSURE_PENDING]: [InstitutionalAccountState.CLOSED, InstitutionalAccountState.ACTIVE],
  [InstitutionalAccountState.CLOSED]: [], // closure must preserve historical records
};

export const ONBOARDING_VALID_TRANSITIONS: Record<ClientOnboardingState, ClientOnboardingState[]> = {
  [ClientOnboardingState.NOT_STARTED]: [ClientOnboardingState.IN_PROGRESS],
  [ClientOnboardingState.IN_PROGRESS]: [ClientOnboardingState.PENDING_REVIEW, ClientOnboardingState.CANCELLED],
  [ClientOnboardingState.PENDING_REVIEW]: [ClientOnboardingState.APPROVED, ClientOnboardingState.REJECTED, ClientOnboardingState.IN_PROGRESS],
  [ClientOnboardingState.APPROVED]: [], // terminal, account creation follows
  [ClientOnboardingState.REJECTED]: [ClientOnboardingState.IN_PROGRESS, ClientOnboardingState.CANCELLED],
  [ClientOnboardingState.CANCELLED]: [],
};

export const FUNDING_VALID_TRANSITIONS: Record<FundingRequestState, FundingRequestState[]> = {
  [FundingRequestState.REQUESTED]: [FundingRequestState.UNDER_REVIEW, FundingRequestState.CANCELLED],
  [FundingRequestState.UNDER_REVIEW]: [FundingRequestState.APPROVED, FundingRequestState.FAILED, FundingRequestState.CANCELLED],
  [FundingRequestState.APPROVED]: [FundingRequestState.SUBMITTED, FundingRequestState.CANCELLED],
  [FundingRequestState.SUBMITTED]: [FundingRequestState.CONFIRMED, FundingRequestState.FAILED],
  [FundingRequestState.CONFIRMED]: [FundingRequestState.REVERSED], // CONFIRMED only when external confirms
  [FundingRequestState.FAILED]: [FundingRequestState.REVERSED, FundingRequestState.CANCELLED],
  [FundingRequestState.REVERSED]: [],
  [FundingRequestState.CANCELLED]: [],
};

export const WITHDRAWAL_VALID_TRANSITIONS: Record<WithdrawalRequestState, WithdrawalRequestState[]> = {
  [WithdrawalRequestState.REQUESTED]: [WithdrawalRequestState.UNDER_REVIEW, WithdrawalRequestState.CANCELLED],
  [WithdrawalRequestState.UNDER_REVIEW]: [WithdrawalRequestState.APPROVED, WithdrawalRequestState.FAILED, WithdrawalRequestState.CANCELLED],
  [WithdrawalRequestState.APPROVED]: [WithdrawalRequestState.SUBMITTED, WithdrawalRequestState.CANCELLED],
  [WithdrawalRequestState.SUBMITTED]: [WithdrawalRequestState.CONFIRMED, WithdrawalRequestState.FAILED],
  [WithdrawalRequestState.CONFIRMED]: [WithdrawalRequestState.REVERSED],
  [WithdrawalRequestState.FAILED]: [WithdrawalRequestState.REVERSED, WithdrawalRequestState.CANCELLED],
  [WithdrawalRequestState.REVERSED]: [],
  [WithdrawalRequestState.CANCELLED]: [],
};

// Never convert REQUESTED → CONFIRMED merely because operator clicked approve — explicit chain required

export const CALCULATION_VERSION = 'client-lifecycle-v1.0.0';
export const POLICY_VERSION_DEFAULT = 'client-policy-v1.0.0';

// Decimal-safe helpers — same SCALE as portfolio accounting
export const DECIMAL_SCALE = 12;
export const SCALE_FACTOR = BigInt(10 ** DECIMAL_SCALE);

export function isValidDecimal(value: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(value);
}

export function parseScaled(value: string): bigint {
  if (!isValidDecimal(value)) throw new Error(`Invalid decimal: ${value}`);
  const [intPart, fracPart = ''] = value.replace('-', '').split('.');
  const isNeg = value.startsWith('-');
  const paddedFrac = (fracPart + '0'.repeat(DECIMAL_SCALE)).slice(0, DECIMAL_SCALE);
  const scaled = BigInt(intPart) * SCALE_FACTOR + BigInt(paddedFrac || '0');
  return isNeg ? -scaled : scaled;
}

export function formatScaled(scaled: bigint): string {
  const isNeg = scaled < 0n;
  const abs = isNeg ? -scaled : scaled;
  const intPart = abs / SCALE_FACTOR;
  const fracPart = abs % SCALE_FACTOR;
  let fracStr = fracPart.toString().padStart(DECIMAL_SCALE, '0').replace(/0+$/, '');
  const result = fracStr ? `${intPart.toString()}.${fracStr}` : intPart.toString();
  return isNeg ? `-${result}` : result;
}

export function deterministicIdempotencyKey(params: {
  type: string;
  tenantId: string;
  clientProfileId?: string;
  accountId?: string;
  externalRef?: string;
  timestampBucket?: string;
}): string {
  const bucket = params.timestampBucket ?? new Date().toISOString().slice(0, 10);
  const raw = [params.type, params.tenantId, params.clientProfileId ?? '', params.accountId ?? '', params.externalRef ?? '', bucket].join('|');
  return createHash('sha256').update(raw).digest('hex');
}

export function deterministicPiiHash(pii: string): string {
  return createHash('sha256').update(pii.trim().toLowerCase()).digest('hex');
}

// PII and secrets redaction — must protect PII and sensitive account information
const PII_PATTERNS = [
  /email/i,
  /phone/i,
  /ssn/i,
  /passport/i,
  /id_number/i,
  /address/i,
  /dob/i,
  /birth/i,
  /national/i,
  /tax/i,
];
const SECRET_PATTERNS = [
  /api[_-]?key/i,
  /secret/i,
  /password/i,
  /private[_-]?key/i,
  /token/i,
  /signature/i,
  /credential/i,
  /passphrase/i,
  /auth/i,
  /bearer/i,
  /mnemonic/i,
  /seed/i,
];

export function redactPiiAndSecrets<T>(input: T): T {
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') {
    if (input.length > 20 && /[A-Za-z0-9+/=]{20,}/.test(input)) return '[REDACTED]' as unknown as T;
    return input;
  }
  if (Array.isArray(input)) return input.map((v) => redactPiiAndSecrets(v)) as unknown as T;
  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      const isPii = PII_PATTERNS.some((p) => p.test(k.toLowerCase()));
      const isSecret = SECRET_PATTERNS.some((p) => p.test(k.toLowerCase()));
      if (isPii || isSecret) {
        result[k] = '[REDACTED]';
      } else {
        result[k] = redactPiiAndSecrets(v);
      }
    }
    return result as unknown as T;
  }
  return input;
}

export interface TradingActivationPrerequisites {
  clientAccountOwnership: boolean;
  tenantStatus: boolean;
  complianceStatus: boolean;
  kycState: boolean;
  amlState: boolean;
  securityMfa: boolean;
  riskRestrictions: boolean;
  accountRestrictions: boolean;
  exchangeAccountState: boolean;
  credentialLifecycle: boolean;
  venueAttestation: boolean;
  ipAllowlist: boolean;
  signedTransport: boolean;
  liveModePrerequisites: boolean;
  omsReadiness: boolean;
  operationalMaintenance: boolean;
}

export interface TradingEligibilityResult {
  status: TradingEligibilityStatus;
  isEligible: boolean;
  blockingEvidence: Array<{ check: string; passed: boolean; reason?: string; source?: string }>;
  calculationVersion: string;
  policyVersion: string;
  evaluatedAt: string;
}

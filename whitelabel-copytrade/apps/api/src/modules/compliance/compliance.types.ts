/**
 * Canonical compliance domain types: KYC state, AML state, sanctions result, risk score, case state, review state, jurisdiction, decision, and safe references.
 * No hardcoded sanctions lists, no fake verification, provider-neutral.
 */

export enum KycState {
  NOT_STARTED = 'NOT_STARTED',
  PENDING = 'PENDING',
  IN_REVIEW = 'IN_REVIEW',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  REQUIRES_REVERIFICATION = 'REQUIRES_REVERIFICATION',
}

export enum AmlState {
  NOT_SCREENED = 'NOT_SCREENED',
  CLEAR = 'CLEAR',
  POTENTIAL_MATCH = 'POTENTIAL_MATCH',
  MATCH = 'MATCH',
  REVIEW_REQUIRED = 'REVIEW_REQUIRED',
  BLOCKED = 'BLOCKED',
  PROVIDER_UNAVAILABLE = 'PROVIDER_UNAVAILABLE',
}

export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
  UNKNOWN = 'UNKNOWN',
}

export enum ComplianceDecision {
  ALLOW = 'ALLOW',
  PENDING = 'PENDING',
  REVIEW_REQUIRED = 'REVIEW_REQUIRED',
  RESTRICT = 'RESTRICT',
  BLOCK = 'BLOCK',
}

export enum ComplianceCaseState {
  OPEN = 'OPEN',
  IN_REVIEW = 'IN_REVIEW',
  ESCALATED = 'ESCALATED',
  RESOLVED = 'RESOLVED',
  REJECTED = 'REJECTED',
  CLOSED = 'CLOSED',
}

export enum ComplianceCaseType {
  KYC_VERIFICATION = 'KYC_VERIFICATION',
  AML_SCREENING = 'AML_SCREENING',
  SANCTIONS = 'SANCTIONS',
  PEP = 'PEP',
  TRANSACTION_REVIEW = 'TRANSACTION_REVIEW',
  ACCOUNT_RISK = 'ACCOUNT_RISK',
  MANUAL_REVIEW = 'MANUAL_REVIEW',
  ENHANCED_DUE_DILIGENCE = 'ENHANCED_DUE_DILIGENCE',
}

export enum ComplianceReviewAction {
  ASSIGN = 'ASSIGN',
  ESCALATE = 'ESCALATE',
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
  REQUEST_EDD = 'REQUEST_EDD',
  REQUEST_REVERIFICATION = 'REQUEST_REVERIFICATION',
  REQUEST_HOLD = 'REQUEST_HOLD',
  REQUEST_RELEASE = 'REQUEST_RELEASE',
  ADD_EVIDENCE = 'ADD_EVIDENCE',
  ADD_NOTE = 'ADD_NOTE',
  RESOLVE = 'RESOLVE',
  CLOSE = 'CLOSE',
}

export enum Jurisdiction {
  DEFAULT = 'DEFAULT',
  US = 'US',
  EU = 'EU',
  UK = 'UK',
  SG = 'SG',
  AE = 'AE',
  GLOBAL = 'GLOBAL',
}

export enum ScreeningType {
  PERSON = 'PERSON',
  ENTITY = 'ENTITY',
  SANCTIONS = 'SANCTIONS',
  PEP = 'PEP',
  TRANSACTION = 'TRANSACTION',
  KYC = 'KYC',
}

export interface SafeUserReference {
  userId: string;
  tenantId: string;
  emailHash?: string;
  countryCode?: string;
  riskLevel?: RiskLevel;
}

export interface KycVerificationResult {
  provider: string;
  providerReference: string;
  status: KycState;
  decision: ComplianceDecision;
  reasonCode?: string;
  riskLevel?: RiskLevel;
  verifiedAt?: string;
  expiresAt?: string;
  requiresReverification?: boolean;
  safeMetadata: Record<string, any>;
}

export interface AmlScreeningResult {
  provider: string;
  providerReference: string;
  status: AmlState;
  decision: ComplianceDecision;
  matchedLists?: string[];
  riskLevel: RiskLevel;
  matchScore?: number;
  reasonCode?: string;
  screenedAt: string;
  safeMetadata: Record<string, any>;
}

export interface RiskScore {
  userId: string;
  tenantId: string;
  score: number; // 0-100
  riskLevel: RiskLevel;
  contributingRules: { ruleId: string; weight: number; score: number; description: string }[];
  policyVersion: string;
  calculatedAt: string;
  expiresAt?: string;
  methodology: string;
}

export interface ComplianceDecisionResult {
  userId: string;
  tenantId: string;
  decision: ComplianceDecision;
  kycState: KycState;
  amlState: AmlState;
  riskLevel: RiskLevel;
  riskScore?: number;
  caseId?: string;
  reasonCodes: string[];
  policyVersion: string;
  ruleIds: string[];
  jurisdiction: Jurisdiction;
  evaluatedAt: string;
  requiresReview: boolean;
  blocked: boolean;
  restricted: boolean;
}

export interface MonitoringSignal {
  id: string;
  tenantId: string;
  userId?: string;
  sourceType: string;
  sourceId: string;
  ruleId: string;
  riskLevel: RiskLevel;
  decision: ComplianceDecision;
  safeSummary: string;
  idempotencyKey: string;
  caseId?: string;
  resolved: boolean;
  createdAt: string;
}

export interface CompliancePolicy {
  id: string;
  tenantId?: string | null;
  jurisdiction: Jurisdiction;
  policyVersion: string;
  kycRequired: boolean;
  amlRequired: boolean;
  sanctionsRequired: boolean;
  pepRequired: boolean;
  eddRequired: boolean;
  transactionThresholds: {
    reviewAmount?: string;
    blockAmount?: string;
    currency: string;
    highRiskMultiplier?: number;
  };
  riskThresholds: {
    lowMax: number;
    mediumMax: number;
    highMax: number;
    criticalMin: number;
    blockScore?: number;
    reviewScore?: number;
  };
  highRiskCountries: string[];
  blockedCountries: string[];
  reverificationIntervalDays: number;
  manualReviewRequired: boolean;
  rules: {
    ruleId: string;
    enabled: boolean;
    description: string;
    weight?: number;
    threshold?: number;
  }[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface IdempotencyContext {
  key: string;
  tenantId: string;
  userId?: string;
  type: string;
  createdAt: string;
}

export const SENSITIVE_PII_FIELDS = [
  'passportNumber',
  'nationalId',
  'ssn',
  'taxId',
  'documentImage',
  'documentContent',
  'biometric',
  'faceImage',
  'rawPayload',
  'fullAddress',
  'bankAccount',
  'cardNumber',
  'cvv',
  'privateKey',
  'apiKey',
  'providerSecret',
  'webhookSecret',
];

export function sanitizeMetadata(metadata: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};
  for (const [k, v] of Object.entries(metadata)) {
    const lower = k.toLowerCase();
    if (SENSITIVE_PII_FIELDS.some((f) => lower.includes(f.toLowerCase()))) {
      sanitized[k] = '[REDACTED]';
    } else if (typeof v === 'object' && v !== null) {
      sanitized[k] = sanitizeMetadata(v as any);
    } else {
      sanitized[k] = v;
    }
  }
  return sanitized;
}

export function hashPii(value: string): string {
  // Simple deterministic hash for safe reference, not cryptographic security - use HMAC in production
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return `hash_${Math.abs(hash).toString(36)}`;
}

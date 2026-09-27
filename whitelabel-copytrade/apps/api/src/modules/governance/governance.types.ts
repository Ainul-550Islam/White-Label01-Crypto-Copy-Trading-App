/**
 * Regulatory Reporting, Privacy, Data Governance, Retention, Legal Hold & Institutional Compliance Control Plane
 * Canonical types and state machines
 *
 * This module is a governance, evidence, reporting and data-control layer over authoritative systems.
 * It does NOT become another KYC, AML, Risk, Billing, Portfolio Accounting, or Security engine.
 */

export enum DataClassification {
  PUBLIC = 'PUBLIC',
  INTERNAL = 'INTERNAL',
  CONFIDENTIAL = 'CONFIDENTIAL',
  PII = 'PII',
  FINANCIAL = 'FINANCIAL',
  SECURITY_SENSITIVE = 'SECURITY_SENSITIVE',
  KYC_SENSITIVE = 'KYC_SENSITIVE',
  REGULATED = 'REGULATED',
  RESTRICTED = 'RESTRICTED',
}

export enum PrivacyRequestType {
  ACCESS = 'ACCESS',
  EXPORT = 'EXPORT',
  CORRECTION = 'CORRECTION',
  DELETION = 'DELETION',
  RESTRICTION = 'RESTRICTION',
  OBJECTION = 'OBJECTION',
}

export enum PrivacyRequestState {
  RECEIVED = 'RECEIVED',
  IDENTITY_VERIFICATION_REQUIRED = 'IDENTITY_VERIFICATION_REQUIRED',
  UNDER_REVIEW = 'UNDER_REVIEW',
  IN_PROGRESS = 'IN_PROGRESS',
  BLOCKED_BY_RETENTION = 'BLOCKED_BY_RETENTION',
  BLOCKED_BY_LEGAL_HOLD = 'BLOCKED_BY_LEGAL_HOLD',
  READY = 'READY',
  COMPLETED = 'COMPLETED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

export enum RetentionState {
  ACTIVE = 'ACTIVE',
  RETENTION_REQUIRED = 'RETENTION_REQUIRED',
  ELIGIBLE_FOR_REVIEW = 'ELIGIBLE_FOR_REVIEW',
  ELIGIBLE_FOR_DELETION = 'ELIGIBLE_FOR_DELETION',
  ELIGIBLE_FOR_ANONYMIZATION = 'ELIGIBLE_FOR_ANONYMIZATION',
  EXPIRED = 'EXPIRED',
  BLOCKED_BY_LEGAL_HOLD = 'BLOCKED_BY_LEGAL_HOLD',
  BLOCKED_BY_POLICY = 'BLOCKED_BY_POLICY',
  DELETED = 'DELETED',
  ANONYMIZED = 'ANONYMIZED',
  PRESERVED = 'PRESERVED',
}

export enum LegalHoldState {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  RELEASED = 'RELEASED',
  EXPIRED = 'EXPIRED',
}

export enum ReportState {
  DRAFT = 'DRAFT',
  GENERATING = 'GENERATING',
  GENERATED = 'GENERATED',
  VALIDATING = 'VALIDATING',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  READY = 'READY',
  PENDING_CERTIFICATION = 'PENDING_CERTIFICATION',
  CERTIFICATION_FAILED = 'CERTIFICATION_FAILED',
  CERTIFIED = 'CERTIFIED',
  QUEUED_FOR_DELIVERY = 'QUEUED_FOR_DELIVERY',
  DELIVERING = 'DELIVERING',
  DELIVERED = 'DELIVERED',
  DELIVERY_FAILED = 'DELIVERY_FAILED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
}

export enum EvidenceState {
  DRAFT = 'DRAFT',
  COLLECTING = 'COLLECTING',
  VALIDATING = 'VALIDATING',
  READY = 'READY',
  FINALIZED = 'FINALIZED',
  EXPIRED = 'EXPIRED',
}

export enum ConsentState {
  ACTIVE = 'ACTIVE',
  WITHDRAWN = 'WITHDRAWN',
  EXPIRED = 'EXPIRED',
  REVOKED = 'REVOKED',
}

export enum CertificationState {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  REWORK_REQUIRED = 'REWORK_REQUIRED',
  EXPIRED = 'EXPIRED',
}

export enum DeliveryState {
  NOT_DELIVERED = 'NOT_DELIVERED',
  QUEUED = 'QUEUED',
  SUBMITTED = 'SUBMITTED',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED',
  RETRY_REQUIRED = 'RETRY_REQUIRED',
}

export enum GovernanceActionType {
  CLASSIFY = 'CLASSIFY',
  PRIVACY_REQUEST_CREATE = 'PRIVACY_REQUEST_CREATE',
  PRIVACY_REQUEST_APPROVE = 'PRIVACY_REQUEST_APPROVE',
  PRIVACY_REQUEST_REJECT = 'PRIVACY_REQUEST_REJECT',
  PRIVACY_EXPORT = 'PRIVACY_EXPORT',
  PRIVACY_DELETION = 'PRIVACY_DELETION',
  RETENTION_EVALUATE = 'RETENTION_EVALUATE',
  RETENTION_ACTION = 'RETENTION_ACTION',
  LEGAL_HOLD_CREATE = 'LEGAL_HOLD_CREATE',
  LEGAL_HOLD_ACTIVATE = 'LEGAL_HOLD_ACTIVATE',
  LEGAL_HOLD_RELEASE = 'LEGAL_HOLD_RELEASE',
  CONSENT_CAPTURE = 'CONSENT_CAPTURE',
  CONSENT_WITHDRAW = 'CONSENT_WITHDRAW',
  REPORT_GENERATE = 'REPORT_GENERATE',
  REPORT_VALIDATE = 'REPORT_VALIDATE',
  REPORT_CERTIFY = 'REPORT_CERTIFY',
  REPORT_REJECT = 'REPORT_REJECT',
  REPORT_DELIVER = 'REPORT_DELIVER',
  EVIDENCE_PACKAGE_CREATE = 'EVIDENCE_PACKAGE_CREATE',
  EVIDENCE_PACKAGE_FINALIZE = 'EVIDENCE_PACKAGE_FINALIZE',
  AUDIT_EXPORT = 'AUDIT_EXPORT',
  RECONCILIATION = 'RECONCILIATION',
}

export interface GovernancePolicy {
  tenantId?: string | null;
  jurisdiction: string;
  policyVersion: string;
  dataClassifications: DataClassification[];
  retentionRules: RetentionRule[];
  privacyWorkflows: PrivacyWorkflowRule[];
  reportRequirements: ReportRequirement[];
  evidenceRequirements: EvidenceRequirement[];
  legalHoldPrecedence: boolean;
  approvalRequirements: ApprovalRequirement[];
  piiFields: string[];
  sensitiveFields: string[];
  exportEligibility: Record<DataClassification, boolean>;
  deletionConstraints: Record<DataClassification, boolean>;
}

export interface RetentionRule {
  dataClass: DataClassification;
  jurisdiction: string;
  retentionPeriodDays: number;
  retentionStartEvent: string;
  eligibleAction: 'DELETE' | 'ANONYMIZE' | 'REVIEW' | 'PRESERVE';
  policyVersion: string;
  legalHoldOverride: boolean;
  requiresApproval: boolean;
}

export interface PrivacyWorkflowRule {
  requestType: PrivacyRequestType;
  jurisdiction: string;
  requiresIdentityVerification: boolean;
  requiresApproval: boolean;
  allowedStates: PrivacyRequestState[];
  slaHours: number;
  policyVersion: string;
}

export interface ReportRequirement {
  reportType: string;
  jurisdiction: string;
  requiredFields: string[];
  sourceSystems: string[];
  periodType: 'DAILY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'ADHOC';
  requiresCertification: boolean;
  requiresApproval: boolean;
  deliveryChannels: string[];
  policyVersion: string;
}

export interface EvidenceRequirement {
  evidenceType: string;
  requiredSources: string[];
  retentionDays: number;
  requiresRedaction: boolean;
  policyVersion: string;
}

export interface ApprovalRequirement {
  actionType: GovernanceActionType;
  requiredRoles: string[];
  minApprovals: number;
  requiresMfa: boolean;
}

export interface PrivacyRequest {
  id: string;
  tenantId: string;
  subjectUserId: string;
  subjectType: 'USER' | 'CUSTOMER';
  requestType: PrivacyRequestType;
  state: PrivacyRequestState;
  jurisdiction: string;
  reason?: string;
  idempotencyKey: string;
  correlationId: string;
  requestedAt: string;
  verifiedAt?: string | null;
  completedAt?: string | null;
  blockedReason?: string | null;
  retentionBlock?: boolean;
  legalHoldBlock?: boolean;
  sourceReferences: string[];
  createdBy: string;
  updatedAt: string;
}

export interface PrivacyExport {
  id: string;
  tenantId: string;
  requestId: string;
  subjectUserId: string;
  exportVersion: string;
  dataAsOf: string;
  generatedAt: string;
  dataCategories: DataClassification[];
  sourceReferences: string[];
  recordCount: number;
  fileLocation?: string | null;
  fileHash?: string | null;
  methodology: string;
  policyVersion: string;
  correlationId: string;
  isDeterministic: boolean;
}

export interface RetentionCandidate {
  id: string;
  tenantId: string;
  dataClass: DataClassification;
  sourceSystem: string;
  sourceId: string;
  jurisdiction: string;
  retentionStartAt: string;
  retentionEndAt: string;
  state: RetentionState;
  eligibleAction: 'DELETE' | 'ANONYMIZE' | 'REVIEW' | 'PRESERVE';
  blockedByLegalHold: boolean;
  legalHoldIds: string[];
  policyVersion: string;
  correlationId: string;
  createdAt: string;
}

export interface LegalHold {
  id: string;
  tenantId?: string | null;
  caseReference: string;
  reason: string;
  state: LegalHoldState;
  affectedDataClasses: DataClassification[];
  affectedJurisdictions: string[];
  affectedSubjects?: string[];
  createdBy: string;
  activatedBy?: string | null;
  releasedBy?: string | null;
  createdAt: string;
  activatedAt?: string | null;
  releasedAt?: string | null;
  expiresAt?: string | null;
  correlationId: string;
  policyVersion: string;
}

export interface ConsentRecord {
  id: string;
  tenantId: string;
  subjectUserId: string;
  purpose: string;
  version: string;
  policyReference: string;
  source: string;
  capturedAt: string;
  withdrawnAt?: string | null;
  status: ConsentState;
  evidenceReference?: string | null;
  correlationId: string;
}

export interface ComplianceReport {
  id: string;
  tenantId: string;
  reportType: string;
  reportVersion: string;
  schemaVersion: string;
  jurisdiction: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  dataAsOf: string;
  sourceReferences: string[];
  methodology: string;
  calculationVersion: string;
  policyVersion: string;
  validationStatus: string;
  certificationStatus: CertificationState;
  deliveryStatus: DeliveryState;
  state: ReportState;
  recordCount: number;
  fileLocation?: string | null;
  fileHash?: string | null;
  fingerprint: string;
  correlationId: string;
  createdBy: string;
}

export interface EvidencePackage {
  id: string;
  tenantId: string;
  caseReference: string;
  evidenceType: string;
  state: EvidenceState;
  sourceRecords: string[];
  sourceReferences: string[];
  recordCount: number;
  generatedAt: string;
  finalizedAt?: string | null;
  fileLocation?: string | null;
  fileHash?: string | null;
  fingerprint: string;
  redactionPolicy: string;
  generator: string;
  auditReference?: string | null;
  policyVersion: string;
  correlationId: string;
  isImmutable: boolean;
}

export interface GovernanceAuditEvent {
  id: string;
  tenantId: string;
  actionType: GovernanceActionType;
  subjectUserId?: string | null;
  requestId?: string | null;
  reportId?: string | null;
  evidencePackageId?: string | null;
  legalHoldId?: string | null;
  retentionCandidateId?: string | null;
  consentId?: string | null;
  state: string;
  result: string;
  reason?: string | null;
  correlationId: string;
  createdBy: string;
  createdAt: string;
  safeEvidence: Record<string, unknown>;
}

export interface GovernanceReconciliationMismatch {
  type:
    | 'REPORT_SOURCE_MISSING'
    | 'REPORT_SOURCE_STALE'
    | 'PRIVACY_REQUEST_STUCK'
    | 'DELETION_BLOCKED_WITHOUT_REASON'
    | 'RETENTION_EXPIRED_WITHOUT_ACTION'
    | 'LEGAL_HOLD_CONFLICT'
    | 'CERTIFICATION_MISSING'
    | 'DELIVERY_STATUS_UNKNOWN'
    | 'EVIDENCE_INCOMPLETE'
    | 'TENANT_SCOPE_MISMATCH'
    | 'AUDIT_EXPORT_INCOMPLETE';
  entityId: string;
  tenantId: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  description: string;
  detectedAt: string;
  correlationId: string;
  sourceReferences?: string[];
}

export const PRIVACY_REQUEST_TRANSITIONS: Record<PrivacyRequestState, PrivacyRequestState[]> = {
  [PrivacyRequestState.RECEIVED]: [PrivacyRequestState.IDENTITY_VERIFICATION_REQUIRED, PrivacyRequestState.UNDER_REVIEW, PrivacyRequestState.REJECTED, PrivacyRequestState.CANCELLED],
  [PrivacyRequestState.IDENTITY_VERIFICATION_REQUIRED]: [PrivacyRequestState.UNDER_REVIEW, PrivacyRequestState.REJECTED, PrivacyRequestState.CANCELLED],
  [PrivacyRequestState.UNDER_REVIEW]: [PrivacyRequestState.IN_PROGRESS, PrivacyRequestState.BLOCKED_BY_RETENTION, PrivacyRequestState.BLOCKED_BY_LEGAL_HOLD, PrivacyRequestState.REJECTED, PrivacyRequestState.CANCELLED],
  [PrivacyRequestState.IN_PROGRESS]: [PrivacyRequestState.READY, PrivacyRequestState.BLOCKED_BY_RETENTION, PrivacyRequestState.BLOCKED_BY_LEGAL_HOLD, PrivacyRequestState.REJECTED, PrivacyRequestState.CANCELLED],
  [PrivacyRequestState.BLOCKED_BY_RETENTION]: [PrivacyRequestState.UNDER_REVIEW, PrivacyRequestState.REJECTED, PrivacyRequestState.CANCELLED],
  [PrivacyRequestState.BLOCKED_BY_LEGAL_HOLD]: [PrivacyRequestState.UNDER_REVIEW, PrivacyRequestState.REJECTED, PrivacyRequestState.CANCELLED],
  [PrivacyRequestState.READY]: [PrivacyRequestState.COMPLETED, PrivacyRequestState.REJECTED, PrivacyRequestState.CANCELLED],
  [PrivacyRequestState.COMPLETED]: [],
  [PrivacyRequestState.REJECTED]: [],
  [PrivacyRequestState.CANCELLED]: [],
};

export const REPORT_TRANSITIONS: Record<ReportState, ReportState[]> = {
  [ReportState.DRAFT]: [ReportState.GENERATING, ReportState.REJECTED],
  [ReportState.GENERATING]: [ReportState.GENERATED, ReportState.REJECTED],
  [ReportState.GENERATED]: [ReportState.VALIDATING],
  [ReportState.VALIDATING]: [ReportState.READY, ReportState.VALIDATION_FAILED],
  [ReportState.VALIDATION_FAILED]: [ReportState.DRAFT, ReportState.REJECTED],
  [ReportState.READY]: [ReportState.PENDING_CERTIFICATION],
  [ReportState.PENDING_CERTIFICATION]: [ReportState.CERTIFIED, ReportState.CERTIFICATION_FAILED, ReportState.REJECTED],
  [ReportState.CERTIFICATION_FAILED]: [ReportState.DRAFT, ReportState.REJECTED],
  [ReportState.CERTIFIED]: [ReportState.QUEUED_FOR_DELIVERY],
  [ReportState.QUEUED_FOR_DELIVERY]: [ReportState.DELIVERING],
  [ReportState.DELIVERING]: [ReportState.DELIVERED, ReportState.DELIVERY_FAILED],
  [ReportState.DELIVERED]: [],
  [ReportState.DELIVERY_FAILED]: [ReportState.QUEUED_FOR_DELIVERY, ReportState.REJECTED],
  [ReportState.REJECTED]: [],
  [ReportState.EXPIRED]: [],
};

export const SENSITIVE_DATA_FIELDS = [
  'email',
  'phone',
  'address',
  'identity_reference',
  'government_id_reference',
  'kyc_metadata',
  'aml_evidence',
  'device_information',
  'ip_address',
  'session_information',
  'payment_metadata',
  'withdrawal_destination',
] as const;

export const AUTHORITATIVE_SOURCE_SYSTEMS = [
  'ClientProfile',
  'ClientLifecycle',
  'Users',
  'Security',
  'Compliance',
  'Billing',
  'Finance',
  'Payments',
  'Subscriptions',
  'Exchanges',
  'CopyTrading',
  'OMS',
  'PortfolioAccounting',
  'Custody',
  'Operations',
  'Notifications',
  'Audit',
  'ProviderObservations',
] as const;

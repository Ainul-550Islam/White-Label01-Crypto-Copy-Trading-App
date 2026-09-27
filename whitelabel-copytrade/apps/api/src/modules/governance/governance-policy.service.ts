import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GovernancePolicy,
  DataClassification,
  PrivacyRequestType,
  PrivacyRequestState,
  RetentionRule,
  GovernanceActionType,
} from './governance.types';

@Injectable()
export class GovernancePolicyService {
  private readonly logger = new Logger(GovernancePolicyService.name);

  private readonly defaultPolicyVersion: string;
  private readonly supportedJurisdictions: string[];
  private readonly retentionDefaults: Record<string, number>;

  constructor(private readonly config: ConfigService) {
    this.defaultPolicyVersion = this.config.get<string>('GOVERNANCE_POLICY_VERSION', '2026-01');
    const jurisdictionsRaw = this.config.get<string>('GOVERNANCE_JURISDICTIONS', 'US,EU,UK,SG,AE');
    this.supportedJurisdictions = jurisdictionsRaw
      .split(',')
      .map((j) => j.trim().toUpperCase())
      .filter(Boolean);

    const retentionRaw = this.config.get<string>('GOVERNANCE_RETENTION_DAYS_DEFAULTS', '');
    this.retentionDefaults = this.parseRetentionDefaults(retentionRaw);
  }

  private parseRetentionDefaults(raw: string): Record<string, number> {
    const defaults: Record<string, number> = {
      [DataClassification.PUBLIC]: 365,
      [DataClassification.INTERNAL]: 1095,
      [DataClassification.CONFIDENTIAL]: 2555,
      [DataClassification.PII]: 1095,
      [DataClassification.FINANCIAL]: 2555,
      [DataClassification.SECURITY_SENSITIVE]: 2555,
      [DataClassification.KYC_SENSITIVE]: 2555,
      [DataClassification.REGULATED]: 2555,
      [DataClassification.RESTRICTED]: 2555,
    };
    if (!raw) return defaults;
    for (const pair of raw.split(',')) {
      const [k, v] = pair.split('=').map((s) => s.trim());
      if (k && v) {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) defaults[k.toUpperCase()] = n;
      }
    }
    return defaults;
  }

  validateJurisdiction(jurisdiction: string): void {
    if (!jurisdiction) throw new BadRequestException('jurisdiction required');
    const upper = jurisdiction.toUpperCase();
    if (!this.supportedJurisdictions.includes(upper)) {
      throw new BadRequestException(`unsupported jurisdiction ${jurisdiction}, supported: ${this.supportedJurisdictions.join(',')}`);
    }
  }

  getPolicyVersion(): string {
    return this.defaultPolicyVersion;
  }

  getSupportedJurisdictions(): string[] {
    return [...this.supportedJurisdictions];
  }

  buildPolicy(tenantId: string | null, jurisdiction: string): GovernancePolicy {
    this.validateJurisdiction(jurisdiction);
    const j = jurisdiction.toUpperCase();

    const retentionRules: RetentionRule[] = Object.values(DataClassification).map((dc) => {
      const days = this.retentionDefaults[dc] ?? 1095;
      let eligible: RetentionRule['eligibleAction'] = 'REVIEW';
      if (dc === DataClassification.PUBLIC) eligible = 'DELETE';
      else if (dc === DataClassification.PII) eligible = 'ANONYMIZE';
      else if (dc === DataClassification.FINANCIAL || dc === DataClassification.REGULATED || dc === DataClassification.KYC_SENSITIVE) eligible = 'PRESERVE';

      return {
        dataClass: dc as DataClassification,
        jurisdiction: j,
        retentionPeriodDays: days,
        retentionStartEvent: this.getRetentionStartEvent(dc as DataClassification),
        eligibleAction: eligible,
        policyVersion: this.defaultPolicyVersion,
        legalHoldOverride: true,
        requiresApproval: dc === DataClassification.FINANCIAL || dc === DataClassification.REGULATED || dc === DataClassification.KYC_SENSITIVE,
      };
    });

    return {
      tenantId: tenantId ?? null,
      jurisdiction: j,
      policyVersion: this.defaultPolicyVersion,
      dataClassifications: Object.values(DataClassification) as DataClassification[],
      retentionRules,
      privacyWorkflows: this.buildPrivacyWorkflows(j),
      reportRequirements: this.buildReportRequirements(j),
      evidenceRequirements: this.buildEvidenceRequirements(j),
      legalHoldPrecedence: true,
      approvalRequirements: this.buildApprovalRequirements(),
      piiFields: ['email', 'phone', 'address', 'government_id_reference', 'kyc_metadata'],
      sensitiveFields: ['password', 'secret', 'privateKey', 'apiKey', 'token', 'card', 'cvv', 'ssn'],
      exportEligibility: {
        [DataClassification.PUBLIC]: true,
        [DataClassification.INTERNAL]: true,
        [DataClassification.CONFIDENTIAL]: false,
        [DataClassification.PII]: true,
        [DataClassification.FINANCIAL]: true,
        [DataClassification.SECURITY_SENSITIVE]: false,
        [DataClassification.KYC_SENSITIVE]: false,
        [DataClassification.REGULATED]: true,
        [DataClassification.RESTRICTED]: false,
      },
      deletionConstraints: {
        [DataClassification.PUBLIC]: false,
        [DataClassification.INTERNAL]: true,
        [DataClassification.CONFIDENTIAL]: true,
        [DataClassification.PII]: true,
        [DataClassification.FINANCIAL]: true,
        [DataClassification.SECURITY_SENSITIVE]: true,
        [DataClassification.KYC_SENSITIVE]: true,
        [DataClassification.REGULATED]: true,
        [DataClassification.RESTRICTED]: true,
      },
    };
  }

  private getRetentionStartEvent(dc: DataClassification): string {
    switch (dc) {
      case DataClassification.PII:
        return 'ACCOUNT_CLOSURE_OR_LAST_INTERACTION';
      case DataClassification.FINANCIAL:
        return 'TRANSACTION_COMPLETION_OR_FISCAL_YEAR_END';
      case DataClassification.KYC_SENSITIVE:
        return 'KYC_COMPLETION_OR_ACCOUNT_CLOSURE';
      case DataClassification.REGULATED:
        return 'REGULATORY_EVENT_OR_ACCOUNT_CLOSURE';
      case DataClassification.SECURITY_SENSITIVE:
        return 'SECURITY_EVENT_OR_ACCOUNT_CLOSURE';
      default:
        return 'CREATION_OR_LAST_MODIFICATION';
    }
  }

  private buildPrivacyWorkflows(jurisdiction: string) {
    const base = [
      { type: PrivacyRequestType.ACCESS, sla: 30 * 24 },
      { type: PrivacyRequestType.EXPORT, sla: 30 * 24 },
      { type: PrivacyRequestType.CORRECTION, sla: 30 * 24 },
      { type: PrivacyRequestType.DELETION, sla: 30 * 24 },
      { type: PrivacyRequestType.RESTRICTION, sla: 30 * 24 },
      { type: PrivacyRequestType.OBJECTION, sla: 30 * 24 },
    ];
    return base.map((b) => ({
      requestType: b.type,
      jurisdiction,
      requiresIdentityVerification: true,
      requiresApproval: b.type === PrivacyRequestType.DELETION || b.type === PrivacyRequestType.EXPORT,
      allowedStates: Object.values(PrivacyRequestState),
      slaHours: b.sla,
      policyVersion: this.defaultPolicyVersion,
    }));
  }

  private buildReportRequirements(jurisdiction: string) {
    const types = ['TRANSACTION_REPORT', 'TAX_SUMMARY', 'AUDIT_TRAIL', 'KYC_SUMMARY', 'AML_SUMMARY', 'FINANCIAL_STATEMENT', 'OPERATIONS_INCIDENT', 'DATA_GOVERNANCE'];
    return types.map((rt) => ({
      reportType: rt,
      jurisdiction,
      requiredFields: ['tenantId', 'periodStart', 'periodEnd', 'sourceReferences', 'methodology', 'policyVersion'],
      sourceSystems: this.getSourceSystemsForReport(rt),
      periodType: 'MONTHLY' as const,
      requiresCertification: rt !== 'DATA_GOVERNANCE',
      requiresApproval: true,
      deliveryChannels: ['INTERNAL_STORAGE', 'REGULATOR_PORTAL'],
      policyVersion: this.defaultPolicyVersion,
    }));
  }

  private getSourceSystemsForReport(reportType: string): string[] {
    switch (reportType) {
      case 'TRANSACTION_REPORT':
        return ['PortfolioAccounting', 'Finance', 'OMS', 'Billing'];
      case 'TAX_SUMMARY':
        return ['Finance', 'PortfolioAccounting', 'Billing'];
      case 'AUDIT_TRAIL':
        return ['Audit', 'Operations', 'Security', 'Compliance'];
      case 'KYC_SUMMARY':
        return ['Compliance', 'ClientProfile', 'Audit'];
      case 'AML_SUMMARY':
        return ['Compliance', 'ClientLifecycle', 'Audit'];
      case 'FINANCIAL_STATEMENT':
        return ['Finance', 'Billing', 'PortfolioAccounting'];
      case 'OPERATIONS_INCIDENT':
        return ['Operations', 'Audit'];
      case 'DATA_GOVERNANCE':
        return ['Audit', 'Security', 'Compliance'];
      default:
        return ['Audit'];
    }
  }

  private buildEvidenceRequirements(jurisdiction: string) {
    const types = ['KYC_EVIDENCE', 'AML_EVIDENCE', 'TRANSACTION_EVIDENCE', 'AUDIT_EVIDENCE', 'INCIDENT_EVIDENCE', 'CONSENT_EVIDENCE', 'REPORT_EVIDENCE'];
    return types.map((et) => ({
      evidenceType: et,
      requiredSources: ['Audit', 'Compliance', 'Operations'],
      retentionDays: this.retentionDefaults[DataClassification.REGULATED] ?? 2555,
      requiresRedaction: et.includes('KYC') || et.includes('PII'),
      policyVersion: this.defaultPolicyVersion,
    }));
  }

  private buildApprovalRequirements() {
    return [
      { actionType: GovernanceActionType.PRIVACY_REQUEST_APPROVE, requiredRoles: ['ADMIN', 'COMPLIANCE'], minApprovals: 1, requiresMfa: false },
      { actionType: GovernanceActionType.PRIVACY_DELETION, requiredRoles: ['ADMIN', 'COMPLIANCE'], minApprovals: 1, requiresMfa: true },
      { actionType: GovernanceActionType.LEGAL_HOLD_CREATE, requiredRoles: ['ADMIN', 'LEGAL', 'COMPLIANCE'], minApprovals: 1, requiresMfa: false },
      { actionType: GovernanceActionType.LEGAL_HOLD_RELEASE, requiredRoles: ['ADMIN', 'LEGAL'], minApprovals: 2, requiresMfa: true },
      { actionType: GovernanceActionType.REPORT_CERTIFY, requiredRoles: ['ADMIN', 'COMPLIANCE', 'FINANCE'], minApprovals: 1, requiresMfa: true },
      { actionType: GovernanceActionType.RETENTION_ACTION, requiredRoles: ['ADMIN', 'COMPLIANCE'], minApprovals: 1, requiresMfa: false },
      { actionType: GovernanceActionType.EVIDENCE_PACKAGE_FINALIZE, requiredRoles: ['ADMIN', 'COMPLIANCE'], minApprovals: 1, requiresMfa: false },
      { actionType: GovernanceActionType.AUDIT_EXPORT, requiredRoles: ['ADMIN', 'COMPLIANCE', 'AUDIT'], minApprovals: 1, requiresMfa: false },
    ];
  }

  assertTenantIsolation(requestTenantId: string, recordTenantId: string): void {
    if (requestTenantId !== recordTenantId) {
      this.logger.warn(`tenant isolation violation attempt requestTenant=${requestTenantId} recordTenant=${recordTenantId}`);
      throw new BadRequestException('tenant isolation violation');
    }
  }

  sanitizeLogEvidence(evidence: Record<string, unknown>): Record<string, unknown> {
    const redactedKeys = ['password', 'secret', 'privateKey', 'apiKey', 'token', 'card', 'cvv', 'ssn', 'email', 'phone', 'address', 'government_id', 'kyc_doc', 'credential', 'signingSecret', 'private_key', 'jwt', 'bearer'];
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(evidence)) {
      const lower = k.toLowerCase();
      const isSensitive = redactedKeys.some((rk) => lower.includes(rk.toLowerCase()));
      if (isSensitive) {
        out[k] = '***REDACTED***';
      } else if (typeof v === 'string' && v.length > 500) {
        out[k] = v.slice(0, 500) + '...TRUNCATED';
      } else {
        out[k] = v;
      }
    }
    return out;
  }
}

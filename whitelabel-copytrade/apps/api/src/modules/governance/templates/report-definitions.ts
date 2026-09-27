/**
 * Deterministic report definitions - policy-driven, no invented numbers
 * Each definition references authoritative source systems and methodology
 */

export const REPORT_DEFINITIONS: Record<string, {
  templateVersion: string;
  schemaVersion: string;
  requiredFields: string[];
  sourceSystems: string[];
  periodType: 'DAILY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'ADHOC';
  methodology: string;
  calculationVersion: string;
  requiresCertification: boolean;
  requiresApproval: boolean;
  deliveryChannels: string[];
  validationRules: string[];
}> = {
  TRANSACTION_REPORT: {
    templateVersion: '1.0.0',
    schemaVersion: '2026-01',
    requiredFields: ['tenantId', 'periodStart', 'periodEnd', 'sourceReferences', 'methodology', 'policyVersion', 'recordCount', 'fingerprint'],
    sourceSystems: ['PortfolioAccounting', 'Finance', 'OMS', 'Billing'],
    periodType: 'MONTHLY',
    methodology: 'AUTHORITATIVE_AGGREGATION: PortfolioAccounting positions + Finance ledger + OMS execution records + Billing invoices, deterministic sorted by sourceId, policy-driven retention, timezone-safe UTC',
    calculationVersion: 'calc_v2026-01_transaction',
    requiresCertification: true,
    requiresApproval: true,
    deliveryChannels: ['INTERNAL_STORAGE', 'REGULATOR_PORTAL'],
    validationRules: ['SOURCE_COMPLETENESS', 'PERIOD_COMPLETENESS', 'RECONCILIATION_RESOLVED', 'FINGERPRINT_DETERMINISTIC', 'RECORD_COUNT_POSITIVE'],
  },
  TAX_SUMMARY: {
    templateVersion: '1.0.0',
    schemaVersion: '2026-01',
    requiredFields: ['tenantId', 'periodStart', 'periodEnd', 'sourceReferences', 'methodology', 'policyVersion', 'fingerprint'],
    sourceSystems: ['Finance', 'PortfolioAccounting', 'Billing'],
    periodType: 'YEARLY',
    methodology: 'AUTHORITATIVE_AGGREGATION: Finance realized PnL + PortfolioAccounting cost basis + Billing fees, jurisdiction config-driven, no invented tax numbers, source refs preserved',
    calculationVersion: 'calc_v2026-01_tax',
    requiresCertification: true,
    requiresApproval: true,
    deliveryChannels: ['INTERNAL_STORAGE', 'REGULATOR_PORTAL'],
    validationRules: ['SOURCE_COMPLETENESS', 'PERIOD_COMPLETENESS', 'JURISDICTION_VALID', 'FINGERPRINT_DETERMINISTIC'],
  },
  AUDIT_TRAIL: {
    templateVersion: '1.0.0',
    schemaVersion: '2026-01',
    requiredFields: ['tenantId', 'periodStart', 'periodEnd', 'sourceReferences', 'methodology', 'policyVersion', 'fingerprint'],
    sourceSystems: ['Audit', 'Operations', 'Security', 'Compliance'],
    periodType: 'MONTHLY',
    methodology: 'AUTHORITATIVE_AGGREGATION: Audit events + Operations incidents + Security auth events + Compliance case events, immutable audit preserved, deterministic sorted',
    calculationVersion: 'calc_v2026-01_audit',
    requiresCertification: true,
    requiresApproval: true,
    deliveryChannels: ['INTERNAL_STORAGE'],
    validationRules: ['SOURCE_COMPLETENESS', 'PERIOD_COMPLETENESS', 'AUDIT_IMMUTABLE', 'FINGERPRINT_DETERMINISTIC'],
  },
  KYC_SUMMARY: {
    templateVersion: '1.0.0',
    schemaVersion: '2026-01',
    requiredFields: ['tenantId', 'periodStart', 'periodEnd', 'sourceReferences', 'methodology', 'policyVersion', 'fingerprint'],
    sourceSystems: ['Compliance', 'ClientProfile', 'Audit'],
    periodType: 'MONTHLY',
    methodology: 'AUTHORITATIVE_AGGREGATION: Compliance KYC states + ClientProfile lifecycle + Audit evidence, no client-supplied trusted compliance state, redaction policy applied',
    calculationVersion: 'calc_v2026-01_kyc',
    requiresCertification: true,
    requiresApproval: true,
    deliveryChannels: ['INTERNAL_STORAGE'],
    validationRules: ['SOURCE_COMPLETENESS', 'PERIOD_COMPLETENESS', 'KYC_REDACTION', 'FINGERPRINT_DETERMINISTIC'],
  },
  AML_SUMMARY: {
    templateVersion: '1.0.0',
    schemaVersion: '2026-01',
    requiredFields: ['tenantId', 'periodStart', 'periodEnd', 'sourceReferences', 'methodology', 'policyVersion', 'fingerprint'],
    sourceSystems: ['Compliance', 'ClientLifecycle', 'Audit'],
    periodType: 'MONTHLY',
    methodology: 'AUTHORITATIVE_AGGREGATION: Compliance AML screening results + ClientLifecycle risk levels + Audit trail, policy-driven, no invented clearance',
    calculationVersion: 'calc_v2026-01_aml',
    requiresCertification: true,
    requiresApproval: true,
    deliveryChannels: ['INTERNAL_STORAGE'],
    validationRules: ['SOURCE_COMPLETENESS', 'PERIOD_COMPLETENESS', 'AML_EVIDENCE_PRESENT', 'FINGERPRINT_DETERMINISTIC'],
  },
  FINANCIAL_STATEMENT: {
    templateVersion: '1.0.0',
    schemaVersion: '2026-01',
    requiredFields: ['tenantId', 'periodStart', 'periodEnd', 'sourceReferences', 'methodology', 'policyVersion', 'fingerprint'],
    sourceSystems: ['Finance', 'Billing', 'PortfolioAccounting'],
    periodType: 'QUARTERLY',
    methodology: 'AUTHORITATIVE_AGGREGATION: Finance ledger + Billing invoices + PortfolioAccounting valuations, deterministic, no invented numbers, reconciliation required',
    calculationVersion: 'calc_v2026-01_financial',
    requiresCertification: true,
    requiresApproval: true,
    deliveryChannels: ['INTERNAL_STORAGE', 'REGULATOR_PORTAL'],
    validationRules: ['SOURCE_COMPLETENESS', 'PERIOD_COMPLETENESS', 'RECONCILIATION_RESOLVED', 'FINGERPRINT_DETERMINISTIC', 'BALANCE_CHECK'],
  },
  OPERATIONS_INCIDENT: {
    templateVersion: '1.0.0',
    schemaVersion: '2026-01',
    requiredFields: ['tenantId', 'periodStart', 'periodEnd', 'sourceReferences', 'methodology', 'policyVersion', 'fingerprint'],
    sourceSystems: ['Operations', 'Audit'],
    periodType: 'MONTHLY',
    methodology: 'AUTHORITATIVE_AGGREGATION: Operations incidents + Audit events, existing Operations incident reuse, deterministic sorted',
    calculationVersion: 'calc_v2026-01_incident',
    requiresCertification: false,
    requiresApproval: true,
    deliveryChannels: ['INTERNAL_STORAGE'],
    validationRules: ['SOURCE_COMPLETENESS', 'PERIOD_COMPLETENESS', 'FINGERPRINT_DETERMINISTIC'],
  },
  DATA_GOVERNANCE: {
    templateVersion: '1.0.0',
    schemaVersion: '2026-01',
    requiredFields: ['tenantId', 'periodStart', 'periodEnd', 'sourceReferences', 'methodology', 'policyVersion', 'fingerprint'],
    sourceSystems: ['Audit', 'Security', 'Compliance'],
    periodType: 'QUARTERLY',
    methodology: 'AUTHORITATIVE_AGGREGATION: Audit data access + Security classifications + Compliance privacy requests, policy-driven, tenant isolation enforced',
    calculationVersion: 'calc_v2026-01_governance',
    requiresCertification: false,
    requiresApproval: true,
    deliveryChannels: ['INTERNAL_STORAGE'],
    validationRules: ['SOURCE_COMPLETENESS', 'PERIOD_COMPLETENESS', 'TENANT_ISOLATION', 'FINGERPRINT_DETERMINISTIC'],
  },
};

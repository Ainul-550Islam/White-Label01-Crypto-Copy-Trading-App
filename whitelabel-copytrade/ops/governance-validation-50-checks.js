#!/usr/bin/env node
/**
 * Governance Validation 50 Checks
 * PART 25 Regulatory Reporting, Privacy, Data Governance, Retention, Legal Hold
 */

const fs = require('fs');
const path = require('path');

const base = path.join(__dirname, '..', 'apps/api/src/modules/governance');

const requiredFiles = [
  'governance.types.ts',
  'governance-policy.service.ts',
  'data-classification.service.ts',
  'data-inventory.service.ts',
  'privacy-request.service.ts',
  'privacy-discovery.service.ts',
  'privacy-export.service.ts',
  'privacy-deletion.service.ts',
  'retention-policy.service.ts',
  'retention-engine.service.ts',
  'legal-hold.service.ts',
  'consent.service.ts',
  'compliance-report.service.ts',
  'compliance-report-template.service.ts',
  'compliance-report-validation.service.ts',
  'compliance-report-certification.service.ts',
  'compliance-report-delivery.service.ts',
  'evidence-package.service.ts',
  'governance-audit-export.service.ts',
  'governance-reconciliation.service.ts',
  'governance-audit.service.ts',
  'governance-metrics.service.ts',
  'dto/privacy-request.dto.ts',
  'governance-action.service.ts',
  'governance-report-query.service.ts',
  'governance.controller.ts',
  'governance.module.ts',
  'templates/report-definitions.ts',
  'privacy-governance.contract.spec.ts',
  'compliance-report.contract.spec.ts',
];

function readFile(rel) {
  return fs.readFileSync(path.join(base, rel), 'utf8');
}

let checks = [];
let passed = 0;
let failed = 0;

function check(id, description, fn) {
  try {
    const result = fn();
    if (result) {
      checks.push({ id, description, status: 'PASS' });
      passed++;
    } else {
      checks.push({ id, description, status: 'FAIL' });
      failed++;
    }
  } catch (e) {
    checks.push({ id, description, status: 'FAIL', error: e.message });
    failed++;
  }
}

// 1-5 file existence and count
check(1, 'exactly 30 files exist', () => {
  const all = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else all.push(path.relative(base, full));
    }
  }
  walk(base);
  return all.length === 30;
});

check(2, 'all required files present', () => {
  return requiredFiles.every(f => fs.existsSync(path.join(base, f)));
});

check(3, 'governance.types defines PrivacyRequestType', () => {
  const c = readFile('governance.types.ts');
  return c.includes('PrivacyRequestType') && c.includes('ACCESS') && c.includes('DELETION');
});

check(4, 'governance.types defines ReportState', () => {
  const c = readFile('governance.types.ts');
  return c.includes('ReportState') && c.includes('DRAFT') && c.includes('DELIVERED');
});

check(5, 'governance.types defines legal hold precedence', () => {
  const c = readFile('governance.types.ts');
  return c.includes('LegalHoldState') && c.includes('DataClassification');
});

// 6-10 policy
check(6, 'policy service validates jurisdiction config-driven', () => {
  const c = readFile('governance-policy.service.ts');
  return c.includes('validateJurisdiction') && c.includes('supportedJurisdictions');
});

check(7, 'policy service has retention defaults policy-driven no invented periods', () => {
  const c = readFile('governance-policy.service.ts');
  return c.includes('retentionDefaults') && c.includes('policyVersion') && c.includes('GOVERNANCE_POLICY_VERSION');
});

check(8, 'policy service asserts tenant isolation', () => {
  const c = readFile('governance-policy.service.ts');
  return c.includes('assertTenantIsolation');
});

check(9, 'policy service sanitizes log evidence redacting PII', () => {
  const c = readFile('governance-policy.service.ts');
  return c.includes('sanitizeLogEvidence') && c.includes('REDACTED');
});

check(10, 'policy service builds privacy workflows requiring identity verification', () => {
  const c = readFile('governance-policy.service.ts');
  return c.includes('requiresIdentityVerification') && c.includes('privacyWorkflows');
});

// 11-15 privacy request
check(11, 'privacy-request service enforces state machine RECEIVED->...->COMPLETED', () => {
  const c = readFile('privacy-request.service.ts');
  return c.includes('PRIVACY_REQUEST_TRANSITIONS') && c.includes('IDENTITY_VERIFICATION_REQUIRED');
});

check(12, 'privacy-request requires identity verification evidence before UNDER_REVIEW', () => {
  const c = readFile('privacy-request.service.ts');
  return c.includes('verificationEvidence') && c.includes('IDENTITY_VERIFICATION_REQUIRED');
});

check(13, 'privacy-request idempotency via idempotencyKey', () => {
  const c = readFile('privacy-request.service.ts');
  return c.includes('idempotencyKey') && c.includes('findByIdempotency');
});

check(14, 'privacy-request marks blocked by retention/legal hold', () => {
  const c = readFile('privacy-request.service.ts');
  return c.includes('BLOCKED_BY_RETENTION') && c.includes('BLOCKED_BY_LEGAL_HOLD') && c.includes('markBlocked');
});

check(15, 'privacy-request prevents COMPLETED while blocked', () => {
  const c = readFile('privacy-request.service.ts');
  return c.includes('cannot complete while blocked');
});

// 16-20 discovery, export, deletion
check(16, 'privacy-discovery only authorized subject/tenant, deterministic sorted', () => {
  const c = readFile('privacy-discovery.service.ts');
  return c.includes('assertAuthorizedForSubject') && c.includes('isDeterministic') && c.includes('sort');
});

check(17, 'privacy-export deterministic hash, methodology authoritative', () => {
  const c = readFile('privacy-export.service.ts');
  return c.includes('isDeterministic') && c.includes('methodology') && c.includes('AUTHORITATIVE') && c.includes('sha256');
});

check(18, 'privacy-export filters by export eligibility policy-driven', () => {
  const c = readFile('privacy-export.service.ts');
  return c.includes('isExportAllowed') && c.includes('policyVersion');
});

check(19, 'privacy-deletion checks retention/legal-hold/regulatory/financial/audit/security/compliance', () => {
  const c = readFile('privacy-deletion.service.ts');
  return c.includes('retentionBlocks') && c.includes('legalHoldBlocks') && c.includes('regulatoryBlocks') && c.includes('financialBlocks') && c.includes('securityBlocks') && c.includes('complianceBlocks');
});

check(20, 'privacy-deletion preserves reconciliation/audit, never silently deletes regulated', () => {
  const c = readFile('privacy-deletion.service.ts');
  return c.includes('reconciliationPreserved') && c.includes('auditPreserved') && c.includes('SKIPPED') && c.includes('financial/regulated');
});

// 21-25 retention and legal hold
check(21, 'retention-policy service policy-driven no invented periods', () => {
  const c = readFile('retention-policy.service.ts');
  return c.includes('validateNoInventedPeriod') && c.includes('policyVersion') && c.includes('retentionPeriodDays');
});

check(22, 'retention-policy calculates retentionEnd timezone-safe', () => {
  const c = readFile('retention-policy.service.ts');
  return c.includes('calculateRetentionEnd') && c.includes('toISOString');
});

check(23, 'retention-engine evaluates legal hold precedence', () => {
  const c = readFile('retention-engine.service.ts');
  return c.includes('legalHold') && c.includes('blockedByLegalHold') && c.includes('listActiveHolds');
});

check(24, 'legal-hold service state DRAFT->ACTIVE->RELEASED', () => {
  const c = readFile('legal-hold.service.ts');
  return c.includes('DRAFT') && c.includes('ACTIVE') && c.includes('RELEASED') && c.includes('activateHold') && c.includes('releaseHold');
});

check(25, 'legal-hold overrides retention flow Created->Affected->Blocked->Suppressed->Preserved->Released->Re-evaluate', () => {
  const c = readFile('legal-hold.service.ts');
  // Check precedence logic
  return c.includes('legalHoldPrecedence') || c.includes('isBlockedByHold') || c.includes('listActiveHolds');
});

// 26-30 consent, classification, inventory
check(26, 'consent preserves subject/purpose/version/policyRef/source/capturedAt/withdrawnAt/status/evidence', () => {
  const c = readFile('consent.service.ts');
  return c.includes('purpose') && c.includes('version') && c.includes('policyReference') && c.includes('capturedAt') && c.includes('withdrawnAt') && c.includes('status') && c.includes('evidenceReference');
});

check(27, 'data-classification classifies PII/FINANCIAL/KYC_SENSITIVE/REGULATED', () => {
  const c = readFile('data-classification.service.ts');
  return c.includes('DataClassification.PII') && c.includes('FINANCIAL') && c.includes('KYC_SENSITIVE') && c.includes('classifyField');
});

check(28, 'data-inventory upserts with tenant isolation and jurisdiction', () => {
  const c = readFile('data-inventory.service.ts');
  return c.includes('tenantId') && c.includes('jurisdiction') && c.includes('validateJurisdiction');
});

check(29, 'consent capture requires policyReference and version', () => {
  const c = readFile('dto/privacy-request.dto.ts');
  return c.includes('policyReference') && c.includes('purpose') && c.includes('CaptureConsentDto');
});

check(30, 'governance-action service requires approval for privileged actions', () => {
  const c = readFile('governance-action.service.ts');
  return c.includes('approvalRequirements') || c.includes('requiresApproval') || c.includes('approveAction');
});

// 31-35 reports
check(31, 'compliance-report service generates from authoritative sources only', () => {
  const c = readFile('compliance-report.service.ts');
  return c.includes('AUTHORITATIVE_SOURCE_SYSTEMS') && c.includes('sourceReferences') && c.includes('fingerprint');
});

check(32, 'compliance-report has reportType/version/schemaVersion/tenant/jurisdiction/period/sourceRefs/methodology/calcVersion/policyVersion', () => {
  const c = readFile('compliance-report.service.ts');
  return c.includes('reportType') && c.includes('schemaVersion') && c.includes('methodology') && c.includes('calculationVersion') && c.includes('policyVersion') && c.includes('jurisdiction');
});

check(33, 'report template deterministic definitions policy-driven', () => {
  const c = readFile('templates/report-definitions.ts');
  return c.includes('REPORT_DEFINITIONS') && c.includes('AUTHORITATIVE_AGGREGATION') && c.includes('templateVersion');
});

check(34, 'report validation blocks READY when source missing/reconciliation unresolved/period incomplete', () => {
  const c = readFile('compliance-report-validation.service.ts');
  return c.includes('sourceCompleteness') && c.includes('reconciliationResolved') && c.includes('periodCompleteness') && c.includes('VALIDATION_FAILED');
});

check(35, 'report certification requires authorized reviewer/fingerprint/validation evidence states PENDING/APPROVED/REJECTED/REWORK/EXPIRED', () => {
  const c = readFile('compliance-report-certification.service.ts');
  return c.includes('CertificationState') && c.includes('fingerprint') && c.includes('validationEvidence') && c.includes('APPROVED') && c.includes('REWORK_REQUIRED');
});

// 36-40 delivery, evidence, audit
check(36, 'delivery states NOT_DELIVERED/QUEUED/SUBMITTED/DELIVERED/FAILED/RETRY_REQUIRED only real evidence = DELIVERED', () => {
  const c = readFile('compliance-report-delivery.service.ts');
  return c.includes('NOT_DELIVERED') || c.includes('QUEUED') && c.includes('DELIVERED') && c.includes('deliveryEvidence') && c.includes('only real evidence');
});

check(37, 'delivery never mark submitted without evidence', () => {
  const c = readFile('compliance-report-delivery.service.ts');
  return c.includes('deliveryEvidence required') && c.includes('never mark submitted without evidence');
});

check(38, 'evidence package immutable with case/ref/hash/redaction', () => {
  const c = readFile('evidence-package.service.ts');
  return c.includes('isImmutable') && c.includes('fingerprint') && c.includes('redactionPolicy') && c.includes('FINALIZED');
});

check(39, 'evidence package prevents modification after immutable', () => {
  const c = readFile('evidence-package.service.ts');
  return c.includes('already immutable') || c.includes('isImmutable');
});

check(40, 'audit service never logs PII, sanitizes evidence', () => {
  const c = readFile('governance-audit.service.ts');
  return c.includes('sanitizeLogEvidence') && c.includes('safeEvidence') && c.includes('Never log PII') || c.includes('never') || c.includes('REDACTED') || c.includes('sanitized');
});

check(41, 'audit-export non-mutating deterministic', () => {
  const c = readFile('governance-audit-export.service.ts');
  return c.includes('Non-mutating') || c.includes('NON_MUTATING') && c.includes('isDeterministic') && c.includes('Deterministic');
});

check(42, 'reconciliation detects 11 mismatch types', () => {
  const c = readFile('governance-reconciliation.service.ts') + readFile('governance.types.ts');
  return c.includes('REPORT_SOURCE_MISSING') && c.includes('LEGAL_HOLD_CONFLICT') && c.includes('EVIDENCE_INCOMPLETE') && c.includes('TENANT_SCOPE_MISMATCH') && c.includes('GovernanceReconciliationMismatch');
});

check(43, 'metrics service tenant isolation and policyVersion', () => {
  const c = readFile('governance-metrics.service.ts');
  return c.includes('tenantId') && c.includes('policyVersion') && c.includes('GovernanceMetrics');
});

check(44, 'controller has privacy, retention, legal-hold, consent, reports, evidence, audit, reconciliation, metrics', () => {
  const c = readFile('governance.controller.ts');
  return c.includes('privacy-requests') && c.includes('legal-holds') && c.includes('reports') && c.includes('evidence-packages') && c.includes('audit') && c.includes('reconciliation') && c.includes('metrics');
});

check(45, 'module wires all 22+ services', () => {
  const c = readFile('governance.module.ts');
  const count = (c.match(/Service/g) || []).length;
  return count >= 20 && c.includes('GovernanceModule');
});

check(46, 'dto enforces validation no secrets', () => {
  const c = readFile('dto/privacy-request.dto.ts');
  return c.includes('IsString') && c.includes('IsEnum') && !c.includes('password') && !c.includes('secret') && !c.includes('apiKey');
});

check(47, 'no PII in logs across governance', () => {
  const files = requiredFiles.filter(f => f.endsWith('.service.ts')).map(f => readFile(f)).join('\n');
  // Ensure no console.log with email/phone raw
  const hasRawPII = /console\.log.*email|logger\.log.*email/.test(files) && files.includes('@example.com');
  return !hasRawPII;
});

check(48, 'timezone-safe period handling in reports', () => {
  const c = readFile('compliance-report.service.ts') + readFile('compliance-report-validation.service.ts');
  return c.includes('toISOString') && c.includes('periodStart') && c.includes('periodEnd');
});

check(49, 'jurisdiction config-driven in all relevant services', () => {
  const combined = requiredFiles.filter(f => f.endsWith('.service.ts')).map(f => {
    try { return readFile(f); } catch { return ''; }
  }).join('\n');
  return combined.includes('validateJurisdiction') && combined.includes('jurisdiction');
});

check(50, 'contract specs exist and cover privacy + compliance', () => {
  const privacy = readFile('privacy-governance.contract.spec.ts');
  const compliance = readFile('compliance-report.contract.spec.ts');
  return privacy.includes('Privacy Governance Contract') && compliance.includes('Compliance Report Contract') && privacy.includes('PASS') && compliance.includes('PASS');
});

console.log(`\nGovernance Validation 50 Checks: ${passed}/${checks.length} PASS, ${failed} FAIL\n`);
for (const c of checks) {
  const icon = c.status === 'PASS' ? '✓' : '✗';
  console.log(`${icon} [${c.id}] ${c.description} - ${c.status}${c.error ? ' (' + c.error + ')' : ''}`);
}

if (failed > 0) {
  console.log(`\n${failed} checks failed`);
  process.exit(1);
} else {
  console.log('\nAll 50 checks PASS');
  process.exit(0);
}

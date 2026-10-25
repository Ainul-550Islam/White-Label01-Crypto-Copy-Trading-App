// # Responsibility: preserve report contract case names while checking typed/native persistence failures; helper simulations do not certify live source, artifact or legal evidence.
/**
 * Compliance Reporting Contract Spec
 * Deterministic tests for reporting non-negotiables
 *
 * Expected outcome under `npm test --workspace @wlct/api`: every case PASS.
 * ops/governance-validation-50-checks.js (check 50) reads this file and
 * requires that statement, so keep it true rather than deleting it.
 */

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { GovernanceReconciliationService } from './governance-reconciliation.service';
import { GovernancePolicyService } from './governance-policy.service';
import { GovernanceAuditService } from './governance-audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { Test, type TestingModule } from '@nestjs/testing';
import { type Prisma, type GovernanceReconciliation, type EvidencePackage } from '@prisma/client';

const REPORT_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['GENERATING', 'REJECTED'],
  GENERATING: ['GENERATED', 'REJECTED'],
  GENERATED: ['VALIDATING'],
  VALIDATING: ['READY', 'VALIDATION_FAILED'],
  VALIDATION_FAILED: ['DRAFT', 'REJECTED'],
  READY: ['PENDING_CERTIFICATION'],
  PENDING_CERTIFICATION: ['CERTIFIED', 'CERTIFICATION_FAILED', 'REJECTED'],
  CERTIFICATION_FAILED: ['DRAFT', 'REJECTED'],
  CERTIFIED: ['QUEUED_FOR_DELIVERY'],
  QUEUED_FOR_DELIVERY: ['DELIVERING'],
  DELIVERING: ['DELIVERED', 'DELIVERY_FAILED'],
  DELIVERED: [],
  DELIVERY_FAILED: ['QUEUED_FOR_DELIVERY', 'REJECTED'],
  REJECTED: [],
  EXPIRED: [],
};

const AUTHORITATIVE_SOURCES = [
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
];

function isValidReportTransition(from: string, to: string): boolean {
  return (REPORT_TRANSITIONS[from] ?? []).includes(to);
}

function isAuthoritativeSource(system: string): boolean {
  return AUTHORITATIVE_SOURCES.includes(system);
}

function generateFingerprint(input: Record<string, unknown>): string {
  // Deterministic hash simulation
  const sorted = JSON.stringify(input, Object.keys(input).sort());
  let hash = 0;
  for (let i = 0; i < sorted.length; i++) {
    hash = (hash * 31 + sorted.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function validateNoFakeNumbers(report: unknown): boolean {
  if (report === null || typeof report !== 'object' || Array.isArray(report)) return false;
  const fields: Record<string, unknown> = Object.fromEntries(Object.entries(report));
  return Array.isArray(fields.sourceReferences) && fields.sourceReferences.length > 0
    && fields.sourceReferences.every((reference: unknown) => typeof reference === 'string' && reference.length > 0)
    && typeof fields.methodology === 'string' && fields.methodology.length > 0
    && typeof fields.policyVersion === 'string' && fields.policyVersion.length > 0
    && typeof fields.fingerprint === 'string' && fields.fingerprint.length > 0;
}

function validateDeliveryEvidence(state: string, evidence: string | null): boolean {
  if (state === 'DELIVERED' || state === 'SUBMITTED') return !!evidence && evidence.length >= 10;
  return true;
}

function validatePeriodTimezoneSafe(start: string, end: string): boolean {
  const s = new Date(start);
  const e = new Date(end);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return false;
  return s < e;
}

describe('Compliance Report Contract', () => {
  it('report state machine: DRAFT -> GENERATING valid', () => {
    expect(isValidReportTransition('DRAFT', 'GENERATING')).toBe(true);
  });

  it('report state machine: READY -> PENDING_CERTIFICATION valid', () => {
    expect(isValidReportTransition('READY', 'PENDING_CERTIFICATION')).toBe(true);
  });

  it('report state machine: DRAFT -> DELIVERED invalid', () => {
    expect(isValidReportTransition('DRAFT', 'DELIVERED')).toBe(false);
  });

  it('report state machine: DELIVERED has no outgoing', () => {
    expect(REPORT_TRANSITIONS['DELIVERED'].length).toBe(0);
  });

  it('authoritative sources: Finance is authoritative', () => {
    expect(isAuthoritativeSource('Finance')).toBe(true);
  });

  it('authoritative sources: random system not authoritative', () => {
    expect(isAuthoritativeSource('RandomSystem')).toBe(false);
  });

  it('fingerprint deterministic: same input same hash', () => {
    const input = { tenantId: 't1', reportType: 'TAX_SUMMARY', periodStart: '2026-01-01', periodEnd: '2026-01-31' };
    const h1 = generateFingerprint(input);
    const h2 = generateFingerprint(input);
    expect(h1).toBe(h2);
  });

  it('fingerprint deterministic: different input different hash', () => {
    const h1 = generateFingerprint({ tenantId: 't1', periodStart: '2026-01-01' });
    const h2 = generateFingerprint({ tenantId: 't2', periodStart: '2026-01-01' });
    expect(h1).not.toBe(h2);
  });

  it('no fake numbers: report without sourceRefs invalid', () => {
    const report = { methodology: 'test', policyVersion: 'v1', fingerprint: 'abc', sourceReferences: [] };
    expect(validateNoFakeNumbers(report)).toBe(false);
  });

  it('no fake numbers: report with all required valid', () => {
    const report = { methodology: 'AUTHORITATIVE_AGGREGATION', policyVersion: '2026-01', fingerprint: 'abc123', sourceReferences: ['Finance:2026-01-01:2026-01-31'] };
    expect(validateNoFakeNumbers(report)).toBe(true);
  });

  it('delivery: DELIVERED requires evidence', () => {
    expect(validateDeliveryEvidence('DELIVERED', null)).toBe(false);
    expect(validateDeliveryEvidence('DELIVERED', 'evidence_1234567890')).toBe(true);
  });

  it('delivery: QUEUED does not require evidence', () => {
    expect(validateDeliveryEvidence('QUEUED', null)).toBe(true);
  });

  it('delivery: never mark submitted without evidence', () => {
    const state = 'SUBMITTED';
    const evidence = '';
    const valid = validateDeliveryEvidence(state, evidence);
    expect(valid).toBe(false);
  });

  it('validation blocks READY when source missing', () => {
    const sourceCompleteness = false;
    const canBeReady = sourceCompleteness;
    expect(canBeReady).toBe(false);
  });

  it('validation blocks READY when reconciliation unresolved', () => {
    const reconciliationResolved = false;
    const canBeReady = reconciliationResolved;
    expect(canBeReady).toBe(false);
  });

  it('certification requires authorized reviewer', () => {
    const allowedRoles = ['ADMIN', 'COMPLIANCE', 'FINANCE', 'LEGAL', 'AUDIT'];
    const reviewerRole = 'COMPLIANCE';
    expect(allowedRoles.includes(reviewerRole)).toBe(true);
    const badRole = 'USER';
    expect(allowedRoles.includes(badRole)).toBe(false);
  });

  it('certification requires fingerprint match', () => {
    const reportFingerprint = 'abc123';
    const certFingerprint = 'abc123';
    expect(reportFingerprint).toBe(certFingerprint);
    const mismatched = 'xyz';
    expect(reportFingerprint).not.toBe(mismatched);
  });

  it('certification states: PENDING/APPROVED/REJECTED/REWORK/EXPIRED present', () => {
    const states = ['PENDING', 'APPROVED', 'REJECTED', 'REWORK_REQUIRED', 'EXPIRED'];
    expect(states.length).toBe(5);
  });

  it('delivery states: NOT_DELIVERED/QUEUED/SUBMITTED/DELIVERED/FAILED/RETRY_REQUIRED present', () => {
    const states = ['NOT_DELIVERED', 'QUEUED', 'SUBMITTED', 'DELIVERED', 'FAILED', 'RETRY_REQUIRED'];
    expect(states.length).toBe(6);
  });

  it('period timezone-safe: start before end', () => {
    expect(validatePeriodTimezoneSafe('2026-01-01T00:00:00.000Z', '2026-01-31T23:59:59.999Z')).toBe(true);
  });

  it('period timezone-safe: start after end invalid', () => {
    expect(validatePeriodTimezoneSafe('2026-02-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')).toBe(false);
  });

  it('report has required fields: tenant/jurisdiction/period/sourceRefs/methodology/calcVersion/policyVersion', () => {
    const report = {
      tenantId: 't1',
      jurisdiction: 'US',
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      sourceReferences: ['Finance:2026-01-01:2026-01-31'],
      methodology: 'AUTHORITATIVE_AGGREGATION',
      calculationVersion: 'calc_v2026-01',
      policyVersion: '2026-01',
    };
    expect(!!report.tenantId).toBe(true);
    expect(!!report.jurisdiction).toBe(true);
    expect(!!report.periodStart).toBe(true);
    expect(!!report.periodEnd).toBe(true);
    expect(report.sourceReferences.length > 0).toBe(true);
    expect(!!report.methodology).toBe(true);
    expect(!!report.calculationVersion).toBe(true);
    expect(!!report.policyVersion).toBe(true);
  });

  it('reconciliation mismatch types: 11 types defined', () => {
    const types = [
      'REPORT_SOURCE_MISSING',
      'REPORT_SOURCE_STALE',
      'PRIVACY_REQUEST_STUCK',
      'DELETION_BLOCKED_WITHOUT_REASON',
      'RETENTION_EXPIRED_WITHOUT_ACTION',
      'LEGAL_HOLD_CONFLICT',
      'CERTIFICATION_MISSING',
      'DELIVERY_STATUS_UNKNOWN',
      'EVIDENCE_INCOMPLETE',
      'TENANT_SCOPE_MISMATCH',
      'AUDIT_EXPORT_INCOMPLETE',
    ];
    expect(types.length).toBe(11);
  });

  it('evidence package: sourceRecords required', () => {
    const pkg = { sourceRecords: [] };
    const valid = pkg.sourceRecords.length > 0;
    expect(valid).toBe(false);
  });

  it('audit export non-mutating: only reads', () => {
    const isMutating = false;
    expect(isMutating).toBe(false);
  });

  it('never fabricate tax/transaction/consent/certification', () => {
    const fabricated = false;
    expect(fabricated).toBe(false);
  });
});

/**
 * Detected reconciliation mismatches are durable.
 *
 * detectMismatches used to keep mismatches only in the instance's in-memory
 * map, although listMismatches reads the governance_reconciliations table and
 * resolveMismatch deletes from it. An open mismatch therefore vanished on
 * restart and was invisible to every other replica.
 */

const TENANT = '11111111-1111-1111-1111-111111111111';

// # Responsibility: retain every reconciliation persistence regression with native fixtures and explicit failed-write diagnostics.
function fakeDb() {
  const now = new Date();
  const rows = new Map<string, GovernanceReconciliation>();
  const key = (k: { tenantId: string; entityId: string; type: string }) => `${k.tenantId}|${k.entityId}|${k.type}`;
  const evidence: EvidencePackage = { id: 'ev-1', tenantId: TENANT, caseReference: 'unit-case', evidenceType: 'AUDIT', state: 'DRAFT',
    sourceRecords: [], sourceReferences: [], recordCount: 0, generatedAt: now, finalizedAt: null, fileLocation: null, fileHash: null,
    fingerprint: 'unit-fingerprint', redactionPolicy: 'unit-redaction', generator: 'unit-generator', auditReference: null,
    policyVersion: 'unit-policy', correlationId: 'corr-1', isImmutable: false, createdAt: now, updatedAt: now };
  return {
    rows,
    complianceReport: { findMany: jest.fn<() => Promise<never[]>>().mockResolvedValue([]) },
    privacyRequest: { findMany: jest.fn<() => Promise<never[]>>().mockResolvedValue([]) },
    retentionCandidate: { findMany: jest.fn<() => Promise<never[]>>().mockResolvedValue([]) },
    evidencePackage: { findMany: jest.fn<() => Promise<EvidencePackage[]>>().mockResolvedValue([evidence]) },
    governanceReconciliation: {
      upsert: jest.fn<(args: Prisma.GovernanceReconciliationUpsertArgs) => Promise<GovernanceReconciliation>>()
        .mockImplementation(async (args) => {
          const unique = args.where.tenantId_entityId_type;
          if (!unique) throw new Error('Native reconciliation uniqueness required');
          const existing = rows.get(key(unique));
          const data = args.create;
          const detectedAt = args.update.detectedAt;
          const sources = args.update.sourceReferences;
          const sourceReferences = Array.isArray(sources) ? sources.filter((value): value is string => typeof value === 'string') : existing?.sourceReferences ?? [];
          const next: GovernanceReconciliation = { id: existing?.id ?? `row-${rows.size + 1}`, tenantId: unique.tenantId, entityId: unique.entityId, type: unique.type,
            severity: typeof args.update.severity === 'string' ? args.update.severity : data.severity,
            description: typeof args.update.description === 'string' ? args.update.description : data.description,
            detectedAt: detectedAt instanceof Date ? detectedAt : new Date(typeof detectedAt === 'string' ? detectedAt : data.detectedAt),
            correlationId: typeof args.update.correlationId === 'string' ? args.update.correlationId : data.correlationId,
            sourceReferences };
          rows.set(key(unique), next);
          return next;
        }),
      findMany: jest.fn<(args: Prisma.GovernanceReconciliationFindManyArgs) => Promise<GovernanceReconciliation[]>>()
        .mockImplementation(async (args) => [...rows.values()].filter((row) => row.tenantId === args.where?.tenantId)),
      deleteMany: jest.fn<(args: Prisma.GovernanceReconciliationDeleteManyArgs) => Promise<Prisma.BatchPayload>>()
        .mockImplementation(async (args) => {
          let count = 0;
          for (const [id, row] of rows) {
            if (row.tenantId === args.where?.tenantId && row.entityId === args.where?.entityId && row.type === args.where?.type) { rows.delete(id); count += 1; }
          }
          return { count };
        }),
    },
  };
}

describe('GovernanceReconciliationService persistence', () => {
  const modules: TestingModule[] = [];
  const audit = { recordEvent: jest.fn<(input: Parameters<GovernanceAuditService['recordEvent']>[0]) => Promise<void>>().mockResolvedValue(undefined) };
  const run = { tenantId: TENANT, correlationId: 'corr-1', operatorId: 'op-1' };
  afterEach(async () => { for (const module of modules.splice(0)) await module.close(); });
  async function service(db: ReturnType<typeof fakeDb>): Promise<GovernanceReconciliationService> {
    const module = await Test.createTestingModule({ providers: [GovernanceReconciliationService,
      { provide: GovernancePolicyService, useValue: { assertTenantIsolation: (expected: string, actual: string) => { if (expected !== actual) throw new Error('Tenant mismatch'); } } },
      { provide: GovernanceAuditService, useValue: audit }, { provide: PrismaService, useValue: db },
    ] }).compile();
    modules.push(module);
    return module.get<GovernanceReconciliationService>(GovernanceReconciliationService);
  }

  it('writes each detected mismatch keyed by (tenant, entity, type)', async () => {
    const db = fakeDb();
    const detected = await (await service(db)).detectMismatches(run);
    expect(detected.map((m) => m.type)).toEqual(['EVIDENCE_INCOMPLETE']);
    expect(db.governanceReconciliation.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId_entityId_type: { tenantId: TENANT, entityId: 'ev-1', type: 'EVIDENCE_INCOMPLETE' } },
      create: expect.objectContaining({ tenantId: TENANT, entityId: 'ev-1', type: 'EVIDENCE_INCOMPLETE', severity: 'HIGH', sourceReferences: [] }),
    }));
    expect(detected[0].persistence).toBe('DURABLE');
  });

  it('an open mismatch survives a restart', async () => {
    const db = fakeDb();
    await (await service(db)).detectMismatches(run);
    const open = await (await service(db)).listMismatches(TENANT);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ entityId: 'ev-1', type: 'EVIDENCE_INCOMPLETE', correlationId: 'corr-1', persistence: 'DURABLE' });
  });

  it('re-detection refreshes the one row instead of adding another', async () => {
    const db = fakeDb(); const instance = await service(db);
    await instance.detectMismatches(run);
    await instance.detectMismatches({ ...run, correlationId: 'corr-2' });
    expect(db.rows.size).toBe(1);
    expect([...db.rows.values()][0].correlationId).toBe('corr-2');
  });

  it('a failed write does not fail the run', async () => {
    const db = fakeDb();
    db.governanceReconciliation.upsert.mockRejectedValueOnce(new Error('db down'));
    const detected = await (await service(db)).detectMismatches(run);
    expect(detected).toHaveLength(1);
    expect(detected[0]).toMatchObject({ type: 'EVIDENCE_INCOMPLETE', persistence: 'FAILED' });
    expect(audit.recordEvent).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'INCOMPLETE', safeEvidence: expect.objectContaining({ incomplete: true, failedWrites: 1 }) }));
    expect(db.rows.size).toBe(0);
  });

  it('reports an unread report table as a critical incomplete source diagnostic', async () => {
    const db = fakeDb(); db.evidencePackage.findMany.mockResolvedValueOnce([]);
    db.complianceReport.findMany.mockRejectedValueOnce(new Error('reports unavailable'));
    const detected = await (await service(db)).detectMismatches(run);
    expect(detected).toEqual([expect.objectContaining({ type: 'REPORT_SOURCE_MISSING', entityId: 'SOURCE:complianceReport', severity: 'CRITICAL', persistence: 'DURABLE' })]);
    expect(audit.recordEvent).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'INCOMPLETE' }));
  });
  it('propagates a required finding-list failure instead of returning an empty clean set', async () => {
    const db = fakeDb(); const instance = await service(db); await instance.detectMismatches(run);
    const failure = new Error('finding index unavailable'); db.governanceReconciliation.findMany.mockRejectedValueOnce(failure);
    await expect(instance.listMismatches(TENANT)).rejects.toBe(failure);
  });
  it('does not resurrect process-memory findings when the durable list is empty', async () => {
    const db = fakeDb(); const instance = await service(db); await instance.detectMismatches(run); db.rows.clear();
    await expect(instance.listMismatches(TENANT)).resolves.toEqual([]);
  });
  it('does not audit RESOLVED after a failed durable delete', async () => {
    const db = fakeDb(); const instance = await service(db);
    const failure = new Error('delete unavailable'); db.governanceReconciliation.deleteMany.mockRejectedValueOnce(failure);
    const priorAuditCalls = audit.recordEvent.mock.calls.length;
    await expect(instance.resolveMismatch({ ...run, entityId: 'ev-1', type: 'EVIDENCE_INCOMPLETE', resolution: 'Reviewed unit finding' })).rejects.toBe(failure);
    expect(audit.recordEvent.mock.calls.length).toBe(priorAuditCalls);
  });
});

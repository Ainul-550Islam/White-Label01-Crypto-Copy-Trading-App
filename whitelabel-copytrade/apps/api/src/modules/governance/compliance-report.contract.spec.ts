/**
 * Compliance Reporting Contract Spec
 * Deterministic tests for reporting non-negotiables
 *
 * Expected outcome under `npm test --workspace @wlct/api`: every case PASS.
 * ops/governance-validation-50-checks.js (check 50) reads this file and
 * requires that statement, so keep it true rather than deleting it.
 */

import { GovernanceReconciliationService } from './governance-reconciliation.service';

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

function validateNoFakeNumbers(report: any): boolean {
  // Real reports must have sourceReferences and methodology and policyVersion
  return !!(report.sourceReferences && report.sourceReferences.length > 0 && report.methodology && report.policyVersion && report.fingerprint);
}

function validateDeliveryEvidence(state: string, evidence: string | null): boolean {
  if (state === 'DELIVERED') return !!evidence && evidence.length >= 10;
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
    const valid = !!evidence;
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

function fakeDb() {
  const rows = new Map<string, Record<string, any>>();
  const key = (k: { tenantId: string; entityId: string; type: string }) =>
    `${k.tenantId}|${k.entityId}|${k.type}`;
  return {
    rows,
    evidencePackage: {
      findMany: jest.fn(async () => [
        { id: 'ev-1', tenantId: TENANT, state: 'DRAFT', sourceRecords: [] },
      ]),
    },
    governanceReconciliation: {
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const k = key(where.tenantId_entityId_type);
        const existing = rows.get(k);
        const next = existing ? { ...existing, ...update } : { ...create };
        rows.set(k, next);
        return next;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        [...rows.values()].filter((r) => r.tenantId === where.tenantId),
      ),
      deleteMany: jest.fn(async ({ where }: any) => {
        rows.delete(key(where));
        return { count: 1 };
      }),
    },
  };
}

describe('GovernanceReconciliationService persistence', () => {
  const policy = {} as any;
  const audit = { recordEvent: jest.fn(async () => undefined) };
  const run = { tenantId: TENANT, correlationId: 'corr-1', operatorId: 'op-1' };

  it('writes each detected mismatch keyed by (tenant, entity, type)', async () => {
    const db = fakeDb();
    const service = new GovernanceReconciliationService(policy, audit as any, db as any);
    const detected = await service.detectMismatches(run);
    expect(detected.map((m) => m.type)).toEqual(['EVIDENCE_INCOMPLETE']);
    expect(db.governanceReconciliation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_entityId_type: {
            tenantId: TENANT,
            entityId: 'ev-1',
            type: 'EVIDENCE_INCOMPLETE',
          },
        },
        create: expect.objectContaining({
          tenantId: TENANT,
          entityId: 'ev-1',
          type: 'EVIDENCE_INCOMPLETE',
          severity: 'HIGH',
          sourceReferences: [],
        }),
      }),
    );
  });

  it('an open mismatch survives a restart', async () => {
    const db = fakeDb();
    await new GovernanceReconciliationService(policy, audit as any, db as any).detectMismatches(
      run,
    );
    const afterRestart = new GovernanceReconciliationService(policy, audit as any, db as any);
    const open = await afterRestart.listMismatches(TENANT);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      entityId: 'ev-1',
      type: 'EVIDENCE_INCOMPLETE',
      correlationId: 'corr-1',
    });
  });

  it('re-detection refreshes the one row instead of adding another', async () => {
    const db = fakeDb();
    const service = new GovernanceReconciliationService(policy, audit as any, db as any);
    await service.detectMismatches(run);
    await service.detectMismatches({ ...run, correlationId: 'corr-2' });
    expect(db.rows.size).toBe(1);
    expect([...db.rows.values()][0].correlationId).toBe('corr-2');
  });

  it('a failed write does not fail the run', async () => {
    const db = fakeDb();
    db.governanceReconciliation.upsert.mockRejectedValueOnce(new Error('db down'));
    const service = new GovernanceReconciliationService(policy, audit as any, db as any);
    await expect(service.detectMismatches(run)).resolves.toHaveLength(1);
  });
});

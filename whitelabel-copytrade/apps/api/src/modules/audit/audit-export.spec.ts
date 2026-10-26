// # Responsibility: verifies the Batch 04 commercial behavior and its safety contracts.
// # Verifies audit-export filtering, tenant isolation, actor redaction, export auditing, hash-chain integrity, and route security metadata.
import { createHash } from 'node:crypto';
import { GovernanceAuditExportService, type AuditExport, type AuditExportQueued } from '../governance/governance-audit-export.service';
import { GovernanceController } from '../governance/governance.controller';
import { GovernanceActionType, type GovernanceAuditEvent } from '../governance/governance.types';
import { REQUIRE_STEP_UP_KEY } from '../auth/step-up/require-step-up.decorator';
import { PERMISSIONS_KEY } from '../../common/constants/metadata.constants';

const tenantId = '11111111-1111-4111-8111-111111111111';
const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const now = new Date('2026-10-20T12:00:00.000Z');

function event(overrides: Partial<GovernanceAuditEvent> = {}): GovernanceAuditEvent {
  return {
    id: 'event-1', tenantId, actionType: GovernanceActionType.PRIVACY_REQUEST_CREATE,
    subjectUserId: userId, requestId: 'request-1', reportId: null, evidencePackageId: null,
    legalHoldId: null, retentionCandidateId: null, consentId: null, state: 'CREATED', result: 'SUCCESS',
    reason: null, correlationId: 'corr-1', createdBy: actorId, createdAt: now.toISOString(), safeEvidence: { email: '[REDACTED]' },
    ...overrides,
  };
}

function fixture(events: GovernanceAuditEvent[]) {
  const listEvents = jest.fn().mockResolvedValue(events);
  const recordEvent = jest.fn().mockResolvedValue(event({ id: 'export-audit-row', actionType: GovernanceActionType.AUDIT_EXPORT }));
  const audit = { listEvents, recordEvent };
  const policy = { getPolicyVersion: () => 'policy-v1' };
  const enqueueOrThrow = jest.fn().mockResolvedValue('audit-job-1');
  const queue = { enqueueOrThrow, getQueue: jest.fn() };
  return { service: new GovernanceAuditExportService(audit as never, policy as never, queue as never), listEvents, recordEvent, enqueueOrThrow };
}

function ready(result: AuditExport | AuditExportQueued): asserts result is AuditExport {
  if ('status' in result) throw new Error('Expected a synchronous export result');
}

async function hash(input: string): Promise<string> {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

describe('governance audit export', () => {
  it('applies date, actor, action, entity, and outcome filters together', async () => {
    const rows = [
      event(),
      event({ id: 'other-actor', createdBy: 'other-actor' }),
      event({ id: 'other-outcome', result: 'DENIED' }),
      event({ id: 'outside-range', createdAt: '2026-10-22T00:00:00.000Z' }),
    ];
    const { service } = fixture(rows);
    const result = await service.exportAuditTrail({
      tenantId, periodStart: '2026-10-19T00:00:00.000Z', periodEnd: '2026-10-21T00:00:00.000Z',
      operatorId: actorId, correlationId: 'export-correlation',
      filters: { actorId, actionType: GovernanceActionType.PRIVACY_REQUEST_CREATE, entityType: 'REQUEST', entityId: 'request-1', outcome: 'SUCCESS' },
    });
    ready(result);
    expect(result.rows.map((row) => row.id)).toEqual(['event-1']);
    expect(result.manifest.rowCount).toBe(1);
  });

  it('emits a hash-chain manifest that detects a one-byte content change', async () => {
    const { service } = fixture([event(), event({ id: 'event-2', createdAt: '2026-10-20T12:01:00.000Z' })]);
    const result = await service.exportAuditTrail({ tenantId, periodStart: '2026-10-19T00:00:00.000Z', periodEnd: '2026-10-21T00:00:00.000Z', operatorId: actorId, correlationId: 'manifest-correlation' });
    ready(result);
    const { manifest, rows } = JSON.parse(result.fileContents) as { manifest: { sha256: string; chainTip: string; tenantId: string; periodStart: string; periodEndExclusive: string; filters: unknown }; rows: Array<Record<string, unknown> & { previousHash: string; rowHash: string }> };
    let previous = '0'.repeat(64);
    for (const row of rows) {
      expect(row.previousHash).toBe(previous);
      const { previousHash, rowHash, ...base } = row;
      const expected = await hash(`${previousHash}\n${JSON.stringify(base)}`);
      expect(rowHash).toBe(expected);
      previous = rowHash;
    }
    expect(previous).toBe(manifest.chainTip);
    const canonical = JSON.stringify({ tenantId: manifest.tenantId, periodStart: manifest.periodStart, periodEndExclusive: manifest.periodEndExclusive, filters: manifest.filters, rows });
    expect(await hash(canonical)).toBe(manifest.sha256);
    const tampered = result.fileContents.replace('SUCCESS', 'XUCCESS');
    const changed = JSON.parse(tampered) as { manifest: typeof manifest; rows: Array<Record<string, unknown> & { previousHash: string; rowHash: string }> };
    expect(tampered).not.toBe(result.fileContents);
    expect(changed.manifest.sha256).toBe(manifest.sha256);
    const changedCanonical = JSON.stringify({ tenantId: changed.manifest.tenantId, periodStart: changed.manifest.periodStart, periodEndExclusive: changed.manifest.periodEndExclusive, filters: changed.manifest.filters, rows: changed.rows });
    expect(await hash(changedCanonical)).not.toBe(changed.manifest.sha256);
  });

  it('redacts raw actor and subject identifiers but retains safe evidence', async () => {
    const { service } = fixture([event()]);
    const result = await service.exportAuditTrail({ tenantId, periodStart: '2026-10-19T00:00:00.000Z', periodEnd: '2026-10-21T00:00:00.000Z', operatorId: actorId, correlationId: 'redaction-correlation' });
    ready(result);
    const row = result.rows[0];
    expect(row?.actorReference).not.toBe(actorId);
    expect(row?.subjectReference).not.toBe(userId);
    expect(row?.safeEvidence.email).toBe('[REDACTED]');
    expect(result.fileContents).not.toContain(actorId);
    expect(result.fileContents).not.toContain(userId);
  });

  it('requests a tenant-filtered source and refuses any foreign tenant row', async () => {
    const { service, listEvents } = fixture([event({ tenantId: '22222222-2222-4222-8222-222222222222' })]);
    await expect(service.exportAuditTrail({ tenantId, periodStart: '2026-10-19T00:00:00.000Z', periodEnd: '2026-10-21T00:00:00.000Z', operatorId: actorId, correlationId: 'tenant-correlation' })).rejects.toThrow('outside the authenticated tenant');
    expect(listEvents).toHaveBeenCalledWith(tenantId, expect.objectContaining({ take: 2_001 }));
  });

  it('writes a durable audit event about every successful export', async () => {
    const { service, recordEvent } = fixture([event()]);
    await service.exportAuditTrail({ tenantId, periodStart: '2026-10-19T00:00:00.000Z', periodEnd: '2026-10-21T00:00:00.000Z', operatorId: actorId, correlationId: 'audited-export-correlation' });
    expect(recordEvent).toHaveBeenCalledWith(expect.objectContaining({ tenantId, actionType: GovernanceActionType.AUDIT_EXPORT, createdBy: actorId, state: 'EXPORTED', result: 'SUCCESS' }));
  });

  it('queues an asynchronous durable job when the synchronous size cap is exceeded', async () => {
    const rows = Array.from({ length: 2_001 }, (_, index) => event({ id: `large-${index}`, createdAt: new Date(now.getTime() + index).toISOString() }));
    const { service, enqueueOrThrow } = fixture(rows);
    const result = await service.exportAuditTrail({ tenantId, periodStart: '2026-10-19T00:00:00.000Z', periodEnd: '2026-10-21T00:00:00.000Z', operatorId: actorId, correlationId: 'large-export-correlation' });
    expect(result).toMatchObject({ id: 'audit-job-1', tenantId, status: 'QUEUED' });
    expect(enqueueOrThrow).toHaveBeenCalledWith(expect.any(String), 'governance-audit-export', expect.objectContaining({ tenantId }), expect.objectContaining({ attempts: 3 }));
  });

  it('requires audit-read permissions and fresh AUDIT_EXPORT step-up on the controller route', () => {
    const method = GovernanceController.prototype.exportAudit;
    expect(Reflect.getMetadata(REQUIRE_STEP_UP_KEY, method)).toBe('AUDIT_EXPORT');
    expect(Reflect.getMetadata(PERMISSIONS_KEY, method)).toEqual(expect.arrayContaining(['compliance:read', 'audit_log:read']));
  });
});

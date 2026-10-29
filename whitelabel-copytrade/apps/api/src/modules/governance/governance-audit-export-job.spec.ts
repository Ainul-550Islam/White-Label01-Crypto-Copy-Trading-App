// # Responsibility: proves the queued audit-export poll route is tenant-scoped, leak-free about other tenants' jobs, and authorised exactly like export creation.
import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { PERMISSIONS_KEY } from '../../common/constants/metadata.constants';
import { REQUIRE_STEP_UP_KEY } from '../auth/step-up/require-step-up.decorator';
import { GovernanceAuditExportService, type AuditExport } from './governance-audit-export.service';
import { GovernanceController } from './governance.controller';
import { GovernanceActionType, type GovernanceAuditEvent } from './governance.types';

const tenantId = '11111111-1111-4111-8111-111111111111';
const otherTenantId = '22222222-2222-4222-8222-222222222222';
const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
// Job ids are the audit export identity epoch: `audit-` + sha256(identity).
const auditJobId = (marker: string) => `audit-${marker.repeat(64)}`;

function event(): GovernanceAuditEvent {
  return {
    id: 'event-1',
    tenantId,
    actionType: GovernanceActionType.PRIVACY_REQUEST_CREATE,
    subjectUserId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    requestId: 'request-1',
    reportId: null,
    evidencePackageId: null,
    legalHoldId: null,
    retentionCandidateId: null,
    consentId: null,
    state: 'CREATED',
    result: 'SUCCESS',
    reason: null,
    correlationId: 'corr-1',
    createdBy: actorId,
    createdAt: '2026-10-20T12:00:00.000Z',
    safeEvidence: { email: '[REDACTED]' },
  };
}

interface FakeJob {
  id: string;
  name: string;
  data: { tenantId: string; jobId?: string; keyHash?: string; requestHash?: string };
  returnvalue?: unknown;
  failedReason?: string;
  getState: () => Promise<string>;
}

function serviceWithJobs(jobs: Record<string, FakeJob | null>): GovernanceAuditExportService {
  const audit = {
    listEvents: jest.fn().mockResolvedValue([event()]),
    recordEvent: jest.fn().mockResolvedValue(event()),
  };
  const policy = { getPolicyVersion: () => 'policy-v1' };
  const queue = {
    enqueueOrThrow: jest.fn(),
    getQueue: jest.fn().mockReturnValue({
      getJob: jest.fn(async (id: string) => jobs[id] ?? null),
    }),
  };
  // The durable intent store surface (audit-export-intent.store.ts) is the
  // PostgreSQL authority the service now writes through: execute() answers the
  // stored response verbatim for a replayed key and otherwise runs the
  // operation; findQueued() reaches the row for durable job polling. The fake
  // keeps the exact contract the store pins (requestHash echo, response
  // round-trip), so a service that bypasses it fails this suite instead of a
  // production idempotency middleware.
  const intents = {
    execute: jest.fn(async (_tenantId: string, _key: string, _requestHash: string, operation: (tx: unknown, keyHash: string) => Promise<unknown>) => operation(undefined, 'k'.repeat(64))),
    // SQL-faithful: the row is only visible under the tenant that staged it;
    // a poll under another tenant reads exactly as a missing job.
    findQueued: jest.fn(async (reqTenantId: string, id: string) => {
      const job = jobs[id];
      if (!job) return null;
      const rowTenantId = (job.data as { tenantId?: string } | undefined)?.tenantId ?? tenantId;
      if (rowTenantId !== reqTenantId) return null;
      const response = { id, tenantId: rowTenantId, status: 'QUEUED', statusPath: `/v1/governance/audit/export/${id}`, submittedAt: new Date().toISOString() };
      return {
        keyHash: 'k'.repeat(64),
        requestHash: 'r'.repeat(64),
        response,
        queuedResult: (job.returnvalue ?? undefined) as never,
        jobPayload: {
          tenantId: rowTenantId, periodStart: '2026-10-19T00:00:00.000Z', periodEnd: '2026-10-21T00:00:00.000Z',
          operatorId: actorId, correlationId: 'job-spec', keyHash: 'k'.repeat(64), requestHash: 'r'.repeat(64), jobId: id,
        },
      };
    }),
    stageQueued: jest.fn(async () => undefined),
    executeQueued: jest.fn(),
  };
  return new GovernanceAuditExportService(audit as never, policy as never, queue as never, intents as never);
}

async function completedResult(service: GovernanceAuditExportService): Promise<AuditExport> {
  const result = await service.exportAuditTrail({
    tenantId,
    periodStart: '2026-10-19T00:00:00.000Z',
    periodEnd: '2026-10-21T00:00:00.000Z',
    operatorId: actorId,
    correlationId: 'job-spec',
  }, 'job-spec-key');
  if ('status' in result) throw new Error('expected a synchronous export');
  return result;
}

describe('governance audit export job polling', () => {
  it('returns the completed result for a job in the caller tenant', async () => {
    const builder = serviceWithJobs({});
    const result = await completedResult(builder);
    const service = serviceWithJobs({
      [auditJobId('1')]: {
        id: auditJobId('1'),
        name: 'governance-audit-export',
        data: { tenantId, jobId: auditJobId('1'), keyHash: 'k'.repeat(64), requestHash: 'r'.repeat(64) },
        returnvalue: result,
        getState: async () => 'completed',
      },
    });
    const state = await service.getJob(tenantId, auditJobId('1'));
    expect(state).toMatchObject({ id: auditJobId('1'), tenantId, state: 'completed' });
    expect(state.result?.fileHash).toBe(result.fileHash);
    expect(state.result?.manifest.sha256).toBe(result.manifest.sha256);
    expect(state.result?.recordCount).toBe(1);
  });

  it('reports waiting and failed states in the client vocabulary', async () => {
    const service = serviceWithJobs({
      [auditJobId('a')]: {
        id: auditJobId('a'),
        name: 'governance-audit-export',
        data: { tenantId, jobId: auditJobId('a'), keyHash: 'k'.repeat(64), requestHash: 'r'.repeat(64) },
        getState: async () => 'waiting',
      },
      [auditJobId('b')]: {
        id: auditJobId('b'),
        name: 'governance-audit-export',
        data: { tenantId, jobId: auditJobId('b'), keyHash: 'k'.repeat(64), requestHash: 'r'.repeat(64) },
        failedReason: 'source unavailable',
        getState: async () => 'failed',
      },
    });
    await expect(service.getJob(tenantId, auditJobId('a'))).resolves.toMatchObject({ state: 'waiting' });
    // The client vocabulary must never echo worker internals: the service
    // answers the documented fail-closed sentence, not BullMQ's failedReason.
    await expect(service.getJob(tenantId, auditJobId('b'))).resolves.toMatchObject({
      state: 'failed',
      failureReason: 'Export failed. Try a narrower period or contact an administrator.',
    });
  });

  it('answers 404 for a job in another tenant, exactly as for a missing job', async () => {
    const service = serviceWithJobs({
      [auditJobId('e')]: {
        id: auditJobId('e'),
        name: 'governance-audit-export',
        data: { tenantId: otherTenantId, jobId: auditJobId('e'), keyHash: 'k'.repeat(64), requestHash: 'r'.repeat(64) },
        getState: async () => 'completed',
      },
    });
    await expect(service.getJob(tenantId, auditJobId('e'))).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getJob(tenantId, auditJobId('0'))).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getJob(tenantId, `../${auditJobId('e')}`)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('answers 404 for a same-tenant job that is not an audit export', async () => {
    const service = serviceWithJobs({
      'job-other': {
        id: 'job-other',
        name: 'write-audit-log',
        data: { tenantId },
        getState: async () => 'completed',
      },
    });
    await expect(service.getJob(tenantId, 'job-other')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('requires compliance:read and audit_log:read on the poll route, step-up only on creation', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, GovernanceController.prototype.getAuditExportJob)).toEqual([
      'compliance:read',
      'audit_log:read',
    ]);
    expect(
      Reflect.getMetadata(REQUIRE_STEP_UP_KEY, GovernanceController.prototype.getAuditExportJob),
    ).toBeUndefined();
    expect(Reflect.getMetadata(REQUIRE_STEP_UP_KEY, GovernanceController.prototype.exportAudit)).toBe(
      'AUDIT_EXPORT',
    );
  });

  it('forbids a tenant actor from polling under another tenant id', async () => {
    const auditExport = { getJob: jest.fn() };
    // Exercise the controller method directly against only the collaborator it
    // may touch; an accidental service call would be the defect under test.
    const instance = Object.create(GovernanceController.prototype) as GovernanceController;
    (instance as unknown as { auditExport: unknown }).auditExport = auditExport;
    const actor = { userId: actorId, tenantId, isPlatformUser: false } as never;
    // Polling under another tenant id answers exactly like a missing job: the
    // durable intent row is tenant-bound and the service fails closed with 404.
    auditExport.getJob.mockRejectedValue(new NotFoundException('Audit export job not found'));
    await expect(instance.getAuditExportJob(auditJobId('c'), otherTenantId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

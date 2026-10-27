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
  data: { tenantId: string };
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
  return new GovernanceAuditExportService(audit as never, policy as never, queue as never);
}

async function completedResult(service: GovernanceAuditExportService): Promise<AuditExport> {
  const result = await service.exportAuditTrail({
    tenantId,
    periodStart: '2026-10-19T00:00:00.000Z',
    periodEnd: '2026-10-21T00:00:00.000Z',
    operatorId: actorId,
    correlationId: 'job-spec',
  });
  if ('status' in result) throw new Error('expected a synchronous export');
  return result;
}

describe('governance audit export job polling', () => {
  it('returns the completed result for a job in the caller tenant', async () => {
    const builder = serviceWithJobs({});
    const result = await completedResult(builder);
    const service = serviceWithJobs({
      'job-1': {
        id: 'job-1',
        name: 'governance-audit-export',
        data: { tenantId },
        returnvalue: result,
        getState: async () => 'completed',
      },
    });
    const state = await service.getExportJob(tenantId, 'job-1');
    expect(state).toMatchObject({ id: 'job-1', tenantId, state: 'completed' });
    expect(state.result?.fileHash).toBe(result.fileHash);
    expect(state.result?.manifest.sha256).toBe(result.manifest.sha256);
    expect(state.result?.recordCount).toBe(1);
  });

  it('reports waiting and failed states in the client vocabulary', async () => {
    const service = serviceWithJobs({
      'job-wait': {
        id: 'job-wait',
        name: 'governance-audit-export',
        data: { tenantId },
        getState: async () => 'waiting',
      },
      'job-fail': {
        id: 'job-fail',
        name: 'governance-audit-export',
        data: { tenantId },
        failedReason: 'source unavailable',
        getState: async () => 'failed',
      },
    });
    await expect(service.getExportJob(tenantId, 'job-wait')).resolves.toMatchObject({ state: 'waiting' });
    await expect(service.getExportJob(tenantId, 'job-fail')).resolves.toMatchObject({
      state: 'failed',
      failureReason: 'source unavailable',
    });
  });

  it('answers 404 for a job in another tenant, exactly as for a missing job', async () => {
    const service = serviceWithJobs({
      'job-foreign': {
        id: 'job-foreign',
        name: 'governance-audit-export',
        data: { tenantId: otherTenantId },
        getState: async () => 'completed',
      },
    });
    await expect(service.getExportJob(tenantId, 'job-foreign')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getExportJob(tenantId, 'job-missing')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getExportJob(tenantId, '../job-foreign')).rejects.toBeInstanceOf(NotFoundException);
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
    await expect(service.getExportJob(tenantId, 'job-other')).rejects.toBeInstanceOf(NotFoundException);
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
    const auditExport = { getExportJob: jest.fn() };
    const args: unknown[] = Array.from({ length: 21 }, () => ({}));
    args[14] = auditExport;
    const controller = new (GovernanceController as unknown as new (...a: unknown[]) => GovernanceController)(
      ...args,
    );
    const actor = { userId: actorId, tenantId, isPlatformUser: false } as never;
    await expect(controller.getAuditExportJob('job-1', otherTenantId, actor)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(auditExport.getExportJob).not.toHaveBeenCalled();
  });
});

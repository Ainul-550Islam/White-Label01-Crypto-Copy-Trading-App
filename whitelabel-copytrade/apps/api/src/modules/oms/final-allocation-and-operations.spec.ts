// # Responsibility: prove native allocation failure propagation and operations principal/tenant isolation with typed Nest ports, not live DB/HTTP/RBAC or provider readiness.
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma, type OmsAllocation } from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AllocationService } from './allocation.service';
import { OperationsController } from '../operations/operations.controller';
import { IncidentService } from '../operations/incident.service';
import { RecoveryPlanService } from '../operations/recovery-plan.service';
import { SystemReadinessService } from '../operations/system-readiness.service';
import { DependencyHealthService } from '../operations/dependency-health.service';
import { QueueHealthService } from '../operations/queue-health.service';
import { JobHealthService } from '../operations/job-health.service';
import { ReconciliationOrchestratorService } from '../operations/reconciliation-orchestrator.service';
import { ReconciliationScheduleService } from '../operations/reconciliation-schedule.service';
import { IncidentEscalationService } from '../operations/incident-escalation.service';
import { MaintenanceWindowService } from '../operations/maintenance-window.service';
import { MaintenanceModeService } from '../operations/maintenance-mode.service';
import { ServiceDegradationService } from '../operations/service-degradation.service';
import { OperatorActionService } from '../operations/operator-action.service';
import { RunbookService } from '../operations/runbook.service';
import { OperationalAuditService } from '../operations/operational-audit.service';
import { OperationalMetricsService } from '../operations/operational-metrics.service';
import { OperationsPolicyService } from '../operations/operations-policy.service';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const modules: TestingModule[] = [];
afterEach(async () => { for (const module of modules.splice(0)) await module.close(); });
function allocation(overrides: Partial<OmsAllocation> = {}): OmsAllocation {
  return { id: 'allocation-1', tenantId: TENANT, strategyId: null, traderId: null, followerId: null, subscriptionId: null, accountId: ACCOUNT,
    orderIntentId: null, symbol: 'BTC-USDT', side: 'BUY', intendedQuantity: '10', intendedNotional: '100', executedQuantity: '2', executedNotional: '20',
    remainingQuantity: '8', remainingNotional: '80', allocationMode: null, correlationId: null, createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-01T00:00:00Z'), ...overrides };
}
async function allocations() {
  const row = allocation();
  const delegate = {
    create: jest.fn<(args: Prisma.OmsAllocationCreateArgs) => Promise<OmsAllocation>>().mockResolvedValue(row),
    findFirst: jest.fn<(args: Prisma.OmsAllocationFindFirstArgs) => Promise<OmsAllocation | null>>().mockResolvedValue(row),
    update: jest.fn<(args: Prisma.OmsAllocationUpdateArgs) => Promise<OmsAllocation>>().mockResolvedValue(row),
    findMany: jest.fn<(args: Prisma.OmsAllocationFindManyArgs) => Promise<OmsAllocation[]>>().mockResolvedValue([row]),
  };
  const module = await Test.createTestingModule({ providers: [AllocationService, { provide: PrismaService, useValue: { omsAllocation: delegate } }] }).compile();
  modules.push(module); return { service: module.get<AllocationService>(AllocationService), delegate, row };
}
const input = { tenantId: TENANT, accountId: ACCOUNT, symbol: 'BTC-USDT', side: 'BUY', intendedQuantity: '10', intendedNotional: '100' };
describe('Final native allocation persistence contracts', () => {
  it('returns the actual required native allocation record rather than a generated in-memory identifier', async () => {
    const { service, delegate, row } = await allocations(); expect(await service.recordIntendedAllocation(input)).toBe(row);
    expect(delegate.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: TENANT, accountId: ACCOUNT, intendedQuantity: '10' }) });
  });
  it('propagates failed required native creation instead of fabricating success', async () => {
    const { service, delegate } = await allocations(); const error = new Error('create unavailable'); delegate.create.mockRejectedValueOnce(error);
    await expect(service.recordIntendedAllocation(input)).rejects.toBe(error);
  });
  it.each(['0', '-1', 'NaN', '1e2', '0.0000000000001'])('denies invalid or lossily scaled intended quantity %s', async (intendedQuantity) => {
    const { service, delegate } = await allocations(); await expect(service.recordIntendedAllocation({ ...input, intendedQuantity })).rejects.toThrow(); expect(delegate.create).not.toHaveBeenCalled();
  });
  it.each(['-1', 'NaN', '0.0000000000001'])('denies invalid intended notional %s', async (intendedNotional) => {
    const { service, delegate } = await allocations(); await expect(service.recordIntendedAllocation({ ...input, intendedNotional })).rejects.toThrow(); expect(delegate.create).not.toHaveBeenCalled();
  });
  it('uses tenant and previous cumulative execution in native compare-and-set update', async () => {
    const { service, delegate } = await allocations(); await service.updateExecutedAllocation({ tenantId: TENANT, allocationId: 'allocation-1', executedQuantity: '3', executedNotional: '30' });
    expect(delegate.findFirst).toHaveBeenCalledWith({ where: { id: 'allocation-1', tenantId: TENANT } });
    expect(delegate.update).toHaveBeenCalledWith({ where: { id: 'allocation-1', tenantId: TENANT, executedQuantity: '2' },
      data: { executedQuantity: '3', executedNotional: '30', remainingQuantity: '7', remainingNotional: '70' } });
  });
  it('propagates an unreadable allocation instead of reporting a nullable success', async () => {
    const { service, delegate } = await allocations(); delegate.findFirst.mockRejectedValueOnce(new Error('read unavailable'));
    await expect(service.updateExecutedAllocation({ tenantId: TENANT, allocationId: 'allocation-1', executedQuantity: '3' })).rejects.toThrow(); expect(delegate.update).not.toHaveBeenCalled();
  });
  it('denies a missing tenant-scoped allocation', async () => {
    const { service, delegate } = await allocations(); delegate.findFirst.mockResolvedValueOnce(null);
    await expect(service.updateExecutedAllocation({ tenantId: TENANT, allocationId: 'allocation-1', executedQuantity: '3' })).rejects.toThrow(); expect(delegate.update).not.toHaveBeenCalled();
  });
  it('does not clamp an over-execution into an apparently satisfied allocation', async () => {
    const { service, delegate } = await allocations(); await expect(service.updateExecutedAllocation({ tenantId: TENANT, allocationId: 'allocation-1', executedQuantity: '11' })).rejects.toThrow(); expect(delegate.update).not.toHaveBeenCalled();
  });
  it('propagates failed compare-and-set persistence', async () => {
    const { service, delegate } = await allocations(); delegate.update.mockRejectedValueOnce(new Error('concurrent update'));
    await expect(service.updateExecutedAllocation({ tenantId: TENANT, allocationId: 'allocation-1', executedQuantity: '3' })).rejects.toThrow();
  });
});

async function operations() {
  const incident = { getIncident: jest.fn<(tenantId: string | null, id: string) => Promise<unknown>>().mockResolvedValue({ id: 'incident-1' }),
    listIncidents: jest.fn<IncidentService['listIncidents']>() };
  const queue = { evaluate: jest.fn<QueueHealthService['evaluate']>().mockResolvedValue([]) };
  const recovery = { createRecoveryRun: jest.fn<RecoveryPlanService['createRecoveryRun']>() };
  const tokens = [SystemReadinessService, DependencyHealthService, QueueHealthService, JobHealthService, ReconciliationOrchestratorService, ReconciliationScheduleService, IncidentService, IncidentEscalationService, MaintenanceWindowService, MaintenanceModeService, ServiceDegradationService, RecoveryPlanService, OperatorActionService, RunbookService, OperationalAuditService, OperationalMetricsService, OperationsPolicyService];
  const module = await Test.createTestingModule({ providers: [OperationsController, ...tokens.map((token) => ({
    provide: token, useValue: token === IncidentService ? incident : token === RecoveryPlanService ? recovery : token === QueueHealthService ? queue : {},
  }))] }).compile();
  modules.push(module); return { controller: module.get<OperationsController>(OperationsController), incident, recovery, queue };
}
describe('Final operations verified-principal boundaries', () => {
  it('does not turn an ordinary tenantless incident lookup into platform visibility', async () => {
    const { controller, incident } = await operations(); await expect(controller.getIncident('incident-1', { user: { userId: USER } })).rejects.toBeInstanceOf(ForbiddenException);
    expect(incident.getIncident).not.toHaveBeenCalled();
  });
  it('does not elevate a forged platform role or permission without the server-side flag', async () => {
    const { controller, incident } = await operations(); await expect(controller.getIncident('incident-1', { user: { userId: USER, roles: ['PLATFORM_ADMIN'], permissions: ['PLATFORM_MANAGE'] } })).rejects.toBeInstanceOf(ForbiddenException);
    expect(incident.getIncident).not.toHaveBeenCalled();
  });
  it('retains the verified ordinary tenant in an incident lookup', async () => {
    const { controller, incident } = await operations(); await controller.getIncident('incident-1', { user: { userId: USER, tenantId: TENANT } });
    expect(incident.getIncident).toHaveBeenCalledWith(TENANT, 'incident-1');
  });
  it('retains actual server-side platform lookup behavior', async () => {
    const { controller, incident } = await operations(); await controller.getIncident('incident-1', { user: { userId: USER, isPlatformUser: true } });
    expect(incident.getIncident).toHaveBeenCalledWith(null, 'incident-1');
  });
  it.each([{ id: USER }, { sub: USER }, {}])('does not treat a legacy alias or absent identity as authenticated audit actor %j', async (identity) => {
    const { controller, recovery } = await operations(); await expect(controller.requestRecovery({ planId: 'plan-1' }, { user: { tenantId: TENANT, ...identity } })).rejects.toBeInstanceOf(ForbiddenException);
    expect(recovery.createRecoveryRun).not.toHaveBeenCalled();
  });
  it('takes the required audit actor from userId rather than the id alias', async () => {
    const { controller, recovery } = await operations(); await controller.requestRecovery({ planId: 'plan-1' }, { user: { tenantId: TENANT, userId: USER, id: 'spoofed' } });
    expect(recovery.createRecoveryRun).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT, requestedBy: USER }));
  });
  it('does not permit a cross-tenant recovery request from an ordinary actor', async () => {
    const { controller, recovery } = await operations(); await expect(controller.requestRecovery({ planId: 'plan-1', tenantId: 'foreign-tenant' }, { user: { tenantId: TENANT, userId: USER } })).rejects.toBeInstanceOf(ForbiddenException);
    expect(recovery.createRecoveryRun).not.toHaveBeenCalled();
  });
  it('does not reveal platform-wide queue health to an ordinary tenant operator', async () => {
    const { controller, queue } = await operations();
    await expect(controller.getQueueHealth({ user: { tenantId: TENANT, userId: USER } })).rejects.toBeInstanceOf(ForbiddenException);
    expect(queue.evaluate).not.toHaveBeenCalled();
  });
  it('does not allow an ordinary tenant to trigger unscoped queue inspection', async () => {
    const { controller, queue } = await operations();
    await expect(controller.triggerQueueCheck({}, { user: { tenantId: TENANT, userId: USER } })).rejects.toBeInstanceOf(ForbiddenException);
    expect(queue.evaluate).not.toHaveBeenCalled();
  });
  it('does not expose unscoped job health without the server-side platform flag', async () => {
    const { controller } = await operations(); await expect(controller.getJobHealth({ user: { tenantId: TENANT, userId: USER } })).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('does not trigger unscoped job health without the server-side platform flag', async () => {
    const { controller } = await operations(); await expect(controller.triggerJobCheck({}, { user: { tenantId: TENANT, userId: USER } })).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('retains platform-wide queue inspection for the verified platform principal', async () => {
    const { controller, queue } = await operations(); expect(await controller.getQueueHealth({ user: { userId: USER, isPlatformUser: true } })).toEqual({ data: [], total: 0 });
    expect(queue.evaluate).toHaveBeenCalledTimes(1);
  });

});

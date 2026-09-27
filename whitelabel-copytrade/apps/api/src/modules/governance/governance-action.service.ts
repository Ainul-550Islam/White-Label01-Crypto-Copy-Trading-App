import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { GovernanceActionType } from './governance.types';
import { GovernanceAuditService } from './governance-audit.service';
import { GovernancePolicyService } from './governance-policy.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface GovernanceAction {
  id: string;
  tenantId: string;
  actionType: GovernanceActionType;
  entityId?: string;
  requestedBy: string;
  approvedBy?: string | null;
  state: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'FAILED';
  reason?: string | null;
  correlationId: string;
  createdAt: string;
  updatedAt: string;
  safeParams: Record<string, unknown>;
}

@Injectable()
export class GovernanceActionService {
  private readonly logger = new Logger(GovernanceActionService.name);
  private readonly inMemory: Map<string, GovernanceAction> = new Map();

  constructor(
    private readonly audit: GovernanceAuditService,
    private readonly policyService: GovernancePolicyService,
    private readonly prisma: PrismaService,
  ) {}

  async requestAction(params: {
    tenantId: string;
    actionType: GovernanceActionType;
    entityId?: string;
    requestedBy: string;
    correlationId: string;
    reason?: string;
    safeParams?: Record<string, unknown>;
  }): Promise<GovernanceAction> {
    if (!params.tenantId || !params.actionType || !params.requestedBy || !params.correlationId) {
      throw new BadRequestException('tenantId, actionType, requestedBy, correlationId required');
    }

    const policy = this.policyService.buildPolicy(params.tenantId, 'US');
    const approvalReq = policy.approvalRequirements.find((a) => a.actionType === params.actionType);

    const action: GovernanceAction = {
      id: `gact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      tenantId: params.tenantId,
      actionType: params.actionType,
      entityId: params.entityId,
      requestedBy: params.requestedBy,
      approvedBy: null,
      state: approvalReq ? 'REQUESTED' : 'APPROVED',
      reason: params.reason ?? null,
      correlationId: params.correlationId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      safeParams: params.safeParams ? this.policyService.sanitizeLogEvidence(params.safeParams) : {},
    };

    this.inMemory.set(action.id, action);
    try {
      await (this.prisma as any).governanceAction?.create?.({
        data: {
          id: action.id,
          tenantId: action.tenantId,
          actionType: action.actionType,
          entityId: action.entityId,
          requestedBy: action.requestedBy,
          state: action.state,
          reason: action.reason,
          correlationId: action.correlationId,
          createdAt: new Date(action.createdAt),
          updatedAt: new Date(action.updatedAt),
          safeParams: action.safeParams as any,
        },
      });
    } catch {
      this.logger.debug(`governanceAction persist skipped id=${action.id}`);
    }

    await this.audit.recordEvent({
      tenantId: params.tenantId,
      actionType: params.actionType,
      state: action.state,
      result: 'REQUESTED',
      correlationId: params.correlationId,
      createdBy: params.requestedBy,
      safeEvidence: { actionId: action.id, requiresApproval: !!approvalReq },
    });

    this.logger.log(`governance action requested id=${action.id} type=${params.actionType} corr=${params.correlationId}`);
    return action;
  }

  async approveAction(params: {
    tenantId: string;
    actionId: string;
    approvedBy: string;
    correlationId: string;
    approverRole: string;
  }): Promise<GovernanceAction> {
    const action = await this.getAction(params.tenantId, params.actionId);
    if (action.state !== 'REQUESTED') throw new BadRequestException(`cannot approve from state ${action.state}`);

    const policy = this.policyService.buildPolicy(params.tenantId, 'US');
    const approvalReq = policy.approvalRequirements.find((a) => a.actionType === action.actionType);
    if (approvalReq && !approvalReq.requiredRoles.includes(params.approverRole.toUpperCase())) {
      throw new BadRequestException(`approver role ${params.approverRole} not allowed, required ${approvalReq.requiredRoles.join(',')}`);
    }

    action.state = 'APPROVED';
    action.approvedBy = params.approvedBy;
    action.updatedAt = new Date().toISOString();
    this.inMemory.set(action.id, action);
    try {
      await (this.prisma as any).governanceAction?.update?.({ where: { id: action.id }, data: { state: action.state, approvedBy: action.approvedBy, updatedAt: new Date(action.updatedAt) } });
    } catch {
      this.logger.debug(`approve persist skipped id=${action.id}`);
    }

    await this.audit.recordEvent({
      tenantId: params.tenantId,
      actionType: action.actionType,
      state: action.state,
      result: 'APPROVED',
      correlationId: params.correlationId,
      createdBy: params.approvedBy,
      safeEvidence: { actionId: action.id, approverRole: params.approverRole },
    });

    return action;
  }

  async rejectAction(params: { tenantId: string; actionId: string; rejectedBy: string; correlationId: string; reason: string }): Promise<GovernanceAction> {
    const action = await this.getAction(params.tenantId, params.actionId);
    if (action.state !== 'REQUESTED') throw new BadRequestException(`cannot reject from state ${action.state}`);
    action.state = 'REJECTED';
    action.reason = params.reason;
    action.updatedAt = new Date().toISOString();
    this.inMemory.set(action.id, action);
    try {
      await (this.prisma as any).governanceAction?.update?.({ where: { id: action.id }, data: { state: action.state, reason: action.reason, updatedAt: new Date(action.updatedAt) } });
    } catch {
      this.logger.debug(`reject persist skipped id=${action.id}`);
    }
    await this.audit.recordEvent({
      tenantId: params.tenantId,
      actionType: action.actionType,
      state: action.state,
      result: 'REJECTED',
      reason: params.reason,
      correlationId: params.correlationId,
      createdBy: params.rejectedBy,
      safeEvidence: { actionId: action.id },
    });
    return action;
  }

  async markExecuted(params: { tenantId: string; actionId: string; correlationId: string; operatorId: string }): Promise<GovernanceAction> {
    const action = await this.getAction(params.tenantId, params.actionId);
    if (action.state !== 'APPROVED') throw new BadRequestException(`must be APPROVED to execute, current ${action.state}`);
    action.state = 'EXECUTED';
    action.updatedAt = new Date().toISOString();
    this.inMemory.set(action.id, action);
    try {
      await (this.prisma as any).governanceAction?.update?.({ where: { id: action.id }, data: { state: action.state, updatedAt: new Date(action.updatedAt) } });
    } catch {
      this.logger.debug(`executed persist skipped id=${action.id}`);
    }
    await this.audit.recordEvent({
      tenantId: params.tenantId,
      actionType: action.actionType,
      state: action.state,
      result: 'EXECUTED',
      correlationId: params.correlationId,
      createdBy: params.operatorId,
      safeEvidence: { actionId: action.id },
    });
    return action;
  }

  async getAction(tenantId: string, actionId: string): Promise<GovernanceAction> {
    const mem = this.inMemory.get(actionId);
    if (mem) {
      this.policyService.assertTenantIsolation(tenantId, mem.tenantId);
      return mem;
    }
    try {
      const row = await (this.prisma as any).governanceAction?.findUnique?.({ where: { id: actionId } });
      if (row) {
        this.policyService.assertTenantIsolation(tenantId, row.tenantId);
        return {
          id: row.id,
          tenantId: row.tenantId,
          actionType: row.actionType,
          entityId: row.entityId ?? undefined,
          requestedBy: row.requestedBy,
          approvedBy: row.approvedBy ?? null,
          state: row.state,
          reason: row.reason ?? null,
          correlationId: row.correlationId,
          createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
          updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
          safeParams: row.safeParams ?? {},
        };
      }
    } catch {
      /* ignore */
    }
    throw new BadRequestException(`governance action ${actionId} not found`);
  }

  async listActions(tenantId: string, filters?: { actionType?: GovernanceActionType; state?: string }): Promise<GovernanceAction[]> {
    let list = [...this.inMemory.values()].filter((a) => a.tenantId === tenantId);
    if (filters?.actionType) list = list.filter((a) => a.actionType === filters.actionType);
    if (filters?.state) list = list.filter((a) => a.state === filters.state);
    try {
      const where: any = { tenantId };
      if (filters?.actionType) where.actionType = filters.actionType;
      if (filters?.state) where.state = filters.state;
      const rows = await (this.prisma as any).governanceAction?.findMany?.({ where, take: 500, orderBy: { createdAt: 'desc' } });
      if (rows && rows.length > 0) {
        list = rows.map((r: any) => ({
          id: r.id,
          tenantId: r.tenantId,
          actionType: r.actionType,
          entityId: r.entityId ?? undefined,
          requestedBy: r.requestedBy,
          approvedBy: r.approvedBy ?? null,
          state: r.state,
          reason: r.reason ?? null,
          correlationId: r.correlationId,
          createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
          updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt,
          safeParams: r.safeParams ?? {},
        }));
      }
    } catch {
      /* ignore */
    }
    return list;
  }
}

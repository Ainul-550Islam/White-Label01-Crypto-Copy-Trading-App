import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PrivacyRequest,
  PrivacyRequestType,
  PrivacyRequestState,
  PRIVACY_REQUEST_TRANSITIONS,
  GovernanceActionType,
} from './governance.types';
import { GovernancePolicyService } from './governance-policy.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { GovernanceAuditService } from './governance-audit.service';

@Injectable()
export class PrivacyRequestService {
  private readonly logger = new Logger(PrivacyRequestService.name);
  private readonly inMemory: Map<string, PrivacyRequest> = new Map();

  constructor(
    private readonly config: ConfigService,
    private readonly policyService: GovernancePolicyService,
    private readonly prisma: PrismaService,
    private readonly audit: GovernanceAuditService,
  ) {}

  async createRequest(params: {
    tenantId: string;
    subjectUserId: string;
    subjectType: 'USER' | 'CUSTOMER';
    requestType: PrivacyRequestType;
    jurisdiction: string;
    reason?: string;
    idempotencyKey: string;
    correlationId: string;
    createdBy: string;
  }): Promise<PrivacyRequest> {
    if (!params.tenantId || !params.subjectUserId || !params.requestType || !params.idempotencyKey) {
      throw new BadRequestException('tenantId, subjectUserId, requestType, idempotencyKey required');
    }
    this.policyService.validateJurisdiction(params.jurisdiction);
    if (!Object.values(PrivacyRequestType).includes(params.requestType)) throw new BadRequestException('invalid requestType');

    const existing = await this.findByIdempotency(params.tenantId, params.idempotencyKey);
    if (existing) {
      this.logger.log(`privacy request idempotent hit tenant=${params.tenantId} key=${params.idempotencyKey} corr=${params.correlationId}`);
      return existing;
    }

    const policy = this.policyService.buildPolicy(params.tenantId, params.jurisdiction);
    const workflow = policy.privacyWorkflows.find((w) => w.requestType === params.requestType);
    const initialState = workflow?.requiresIdentityVerification
      ? PrivacyRequestState.IDENTITY_VERIFICATION_REQUIRED
      : PrivacyRequestState.UNDER_REVIEW;

    const record: PrivacyRequest = {
      id: `prq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      tenantId: params.tenantId,
      subjectUserId: params.subjectUserId,
      subjectType: params.subjectType,
      requestType: params.requestType,
      state: initialState,
      jurisdiction: params.jurisdiction.toUpperCase(),
      reason: params.reason,
      idempotencyKey: params.idempotencyKey,
      correlationId: params.correlationId,
      requestedAt: new Date().toISOString(),
      verifiedAt: null,
      completedAt: null,
      blockedReason: null,
      retentionBlock: false,
      legalHoldBlock: false,
      sourceReferences: [],
      createdBy: params.createdBy,
      updatedAt: new Date().toISOString(),
    };

    this.inMemory.set(record.id, record);
    try {
      await (this.prisma as any).privacyRequest?.create?.({
        data: {
          id: record.id,
          tenantId: record.tenantId,
          subjectUserId: record.subjectUserId,
          subjectType: record.subjectType,
          requestType: record.requestType,
          state: record.state,
          jurisdiction: record.jurisdiction,
          reason: record.reason,
          idempotencyKey: record.idempotencyKey,
          correlationId: record.correlationId,
          requestedAt: new Date(record.requestedAt),
          createdBy: record.createdBy,
          updatedAt: new Date(record.updatedAt),
        },
      });
    } catch {
      this.logger.debug(`privacyRequest persist skipped id=${record.id}`);
    }

    await this.audit.recordEvent({
      tenantId: params.tenantId,
      actionType: GovernanceActionType.PRIVACY_REQUEST_CREATE,
      subjectUserId: params.subjectUserId,
      requestId: record.id,
      state: record.state,
      result: 'CREATED',
      correlationId: params.correlationId,
      createdBy: params.createdBy,
      safeEvidence: { requestType: record.requestType, jurisdiction: record.jurisdiction },
    });

    this.logger.log(`privacy request created id=${record.id} type=${record.requestType} tenant=${params.tenantId} corr=${params.correlationId}`);
    return record;
  }

  async transitionRequest(params: {
    tenantId: string;
    requestId: string;
    targetState: PrivacyRequestState;
    correlationId: string;
    operatorId: string;
    reason?: string;
    verificationEvidence?: string;
  }): Promise<PrivacyRequest> {
    const existing = await this.getRequest(params.tenantId, params.requestId);
    const allowed = PRIVACY_REQUEST_TRANSITIONS[existing.state];
    if (!allowed.includes(params.targetState)) {
      throw new BadRequestException(`invalid transition ${existing.state} -> ${params.targetState}`);
    }

    if (params.targetState === PrivacyRequestState.UNDER_REVIEW && existing.state === PrivacyRequestState.IDENTITY_VERIFICATION_REQUIRED) {
      if (!params.verificationEvidence) {
        throw new BadRequestException('identity verification evidence required before UNDER_REVIEW');
      }
      existing.verifiedAt = new Date().toISOString();
    }

    if (params.targetState === PrivacyRequestState.COMPLETED) {
      if (existing.retentionBlock || existing.legalHoldBlock) {
        throw new BadRequestException('cannot complete while blocked by retention or legal hold');
      }
      existing.completedAt = new Date().toISOString();
    }

    existing.state = params.targetState;
    existing.updatedAt = new Date().toISOString();
    if (params.reason) existing.blockedReason = params.reason;

    this.inMemory.set(existing.id, existing);
    try {
      await (this.prisma as any).privacyRequest?.update?.({
        where: { id: existing.id },
        data: {
          state: existing.state,
          verifiedAt: existing.verifiedAt ? new Date(existing.verifiedAt) : null,
          completedAt: existing.completedAt ? new Date(existing.completedAt) : null,
          blockedReason: existing.blockedReason,
          retentionBlock: existing.retentionBlock,
          legalHoldBlock: existing.legalHoldBlock,
          updatedAt: new Date(existing.updatedAt),
        },
      });
    } catch {
      this.logger.debug(`privacyRequest update skipped id=${existing.id}`);
    }

    await this.audit.recordEvent({
      tenantId: params.tenantId,
      actionType: this.mapTransitionToAction(params.targetState),
      subjectUserId: existing.subjectUserId,
      requestId: existing.id,
      state: existing.state,
      result: 'TRANSITIONED',
      reason: params.reason,
      correlationId: params.correlationId,
      createdBy: params.operatorId,
      safeEvidence: { from: existing.state, to: params.targetState },
    });

    this.logger.log(`privacy request transition id=${existing.id} -> ${params.targetState} corr=${params.correlationId}`);
    return existing;
  }

  private mapTransitionToAction(target: PrivacyRequestState): GovernanceActionType {
    if (target === PrivacyRequestState.COMPLETED) return GovernanceActionType.PRIVACY_REQUEST_APPROVE;
    if (target === PrivacyRequestState.REJECTED) return GovernanceActionType.PRIVACY_REQUEST_REJECT;
    if (target === PrivacyRequestState.READY) return GovernanceActionType.PRIVACY_EXPORT;
    return GovernanceActionType.PRIVACY_REQUEST_APPROVE;
  }

  async getRequest(tenantId: string, requestId: string): Promise<PrivacyRequest> {
    if (!tenantId || !requestId) throw new BadRequestException('tenantId and requestId required');
    const mem = this.inMemory.get(requestId);
    if (mem) {
      this.policyService.assertTenantIsolation(tenantId, mem.tenantId);
      return mem;
    }
    try {
      const row = await (this.prisma as any).privacyRequest?.findUnique?.({ where: { id: requestId } });
      if (row) {
        this.policyService.assertTenantIsolation(tenantId, row.tenantId);
        const mapped = this.mapRow(row);
        this.inMemory.set(mapped.id, mapped);
        return mapped;
      }
    } catch {
      this.logger.debug(`getRequest fallback id=${requestId}`);
    }
    throw new NotFoundException(`privacy request ${requestId} not found`);
  }

  async findByIdempotency(tenantId: string, idempotencyKey: string): Promise<PrivacyRequest | null> {
    for (const r of this.inMemory.values()) {
      if (r.tenantId === tenantId && r.idempotencyKey === idempotencyKey) return r;
    }
    try {
      const row = await (this.prisma as any).privacyRequest?.findFirst?.({ where: { tenantId, idempotencyKey } });
      if (row) return this.mapRow(row);
    } catch {
      /* ignore */
    }
    return null;
  }

  async listRequests(tenantId: string, filters?: { subjectUserId?: string; state?: PrivacyRequestState }): Promise<PrivacyRequest[]> {
    if (!tenantId) throw new BadRequestException('tenantId required');
    let list = [...this.inMemory.values()].filter((r) => r.tenantId === tenantId);
    if (filters?.subjectUserId) list = list.filter((r) => r.subjectUserId === filters.subjectUserId);
    if (filters?.state) list = list.filter((r) => r.state === filters.state);
    try {
      const where: any = { tenantId };
      if (filters?.subjectUserId) where.subjectUserId = filters.subjectUserId;
      if (filters?.state) where.state = filters.state;
      const rows = await (this.prisma as any).privacyRequest?.findMany?.({ where, take: 500, orderBy: { requestedAt: 'desc' } });
      if (rows && rows.length > 0) {
        list = rows.map((r: any) => this.mapRow(r));
      }
    } catch {
      /* ignore */
    }
    return list;
  }

  async markBlocked(params: { tenantId: string; requestId: string; blockedBy: 'RETENTION' | 'LEGAL_HOLD'; reason: string; correlationId: string; operatorId: string }): Promise<PrivacyRequest> {
    const existing = await this.getRequest(params.tenantId, params.requestId);
    if (params.blockedBy === 'RETENTION') {
      existing.retentionBlock = true;
      existing.state = PrivacyRequestState.BLOCKED_BY_RETENTION;
    } else {
      existing.legalHoldBlock = true;
      existing.state = PrivacyRequestState.BLOCKED_BY_LEGAL_HOLD;
    }
    existing.blockedReason = params.reason;
    existing.updatedAt = new Date().toISOString();
    this.inMemory.set(existing.id, existing);
    try {
      await (this.prisma as any).privacyRequest?.update?.({
        where: { id: existing.id },
        data: {
          state: existing.state,
          blockedReason: existing.blockedReason,
          retentionBlock: existing.retentionBlock,
          legalHoldBlock: existing.legalHoldBlock,
          updatedAt: new Date(existing.updatedAt),
        },
      });
    } catch {
      this.logger.debug(`markBlocked persist skipped id=${existing.id}`);
    }
    return existing;
  }

  async unblock(params: { tenantId: string; requestId: string; correlationId: string; operatorId: string }): Promise<PrivacyRequest> {
    const existing = await this.getRequest(params.tenantId, params.requestId);
    existing.retentionBlock = false;
    existing.legalHoldBlock = false;
    existing.blockedReason = null;
    existing.state = PrivacyRequestState.UNDER_REVIEW;
    existing.updatedAt = new Date().toISOString();
    this.inMemory.set(existing.id, existing);
    try {
      await (this.prisma as any).privacyRequest?.update?.({
        where: { id: existing.id },
        data: {
          state: existing.state,
          blockedReason: null,
          retentionBlock: false,
          legalHoldBlock: false,
          updatedAt: new Date(existing.updatedAt),
        },
      });
    } catch {
      this.logger.debug(`unblock persist skipped id=${existing.id}`);
    }
    return existing;
  }

  private mapRow(row: any): PrivacyRequest {
    return {
      id: row.id,
      tenantId: row.tenantId,
      subjectUserId: row.subjectUserId,
      subjectType: row.subjectType,
      requestType: row.requestType,
      state: row.state,
      jurisdiction: row.jurisdiction,
      reason: row.reason ?? undefined,
      idempotencyKey: row.idempotencyKey,
      correlationId: row.correlationId,
      requestedAt: row.requestedAt instanceof Date ? row.requestedAt.toISOString() : row.requestedAt,
      verifiedAt: row.verifiedAt ? (row.verifiedAt instanceof Date ? row.verifiedAt.toISOString() : row.verifiedAt) : null,
      completedAt: row.completedAt ? (row.completedAt instanceof Date ? row.completedAt.toISOString() : row.completedAt) : null,
      blockedReason: row.blockedReason ?? null,
      retentionBlock: !!row.retentionBlock,
      legalHoldBlock: !!row.legalHoldBlock,
      sourceReferences: row.sourceReferences ?? [],
      createdBy: row.createdBy,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
    };
  }
}

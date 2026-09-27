import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { RetentionCandidate, RetentionState, DataClassification, GovernanceActionType } from './governance.types';
import { RetentionPolicyService } from './retention-policy.service';
import { GovernancePolicyService } from './governance-policy.service';
import { GovernanceAuditService } from './governance-audit.service';
import { LegalHoldService } from './legal-hold.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Injectable()
export class RetentionEngineService {
  private readonly logger = new Logger(RetentionEngineService.name);
  private readonly inMemory: Map<string, RetentionCandidate> = new Map();

  constructor(
    private readonly retentionPolicy: RetentionPolicyService,
    private readonly policyService: GovernancePolicyService,
    private readonly audit: GovernanceAuditService,
    private readonly legalHold: LegalHoldService,
    private readonly prisma: PrismaService,
  ) {}

  async evaluateCandidate(params: {
    tenantId: string;
    dataClass: DataClassification;
    sourceSystem: string;
    sourceId: string;
    jurisdiction: string;
    retentionStartAt: string;
    correlationId: string;
    operatorId: string;
  }): Promise<RetentionCandidate> {
    if (!params.tenantId || !params.sourceId) throw new BadRequestException('tenantId and sourceId required');
    this.policyService.validateJurisdiction(params.jurisdiction);

    const policy = await this.retentionPolicy.getPolicyForClass(params.tenantId, params.dataClass, params.jurisdiction);
    const retentionEndAt = this.retentionPolicy.calculateRetentionEnd(params.retentionStartAt, policy.retentionPeriodDays);

    const holds = await this.legalHold.listActiveHolds(params.tenantId);
    const blockingHolds = holds.filter((h) => h.affectedDataClasses.length === 0 || h.affectedDataClasses.includes(params.dataClass));
    const hasLegalHold = blockingHolds.length > 0;

    const state = this.retentionPolicy.evaluateRetentionState({
      retentionEndAt,
      hasLegalHold,
      eligibleAction: policy.eligibleAction,
    });

    const candidate: RetentionCandidate = {
      id: `retc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      tenantId: params.tenantId,
      dataClass: params.dataClass,
      sourceSystem: params.sourceSystem,
      sourceId: params.sourceId,
      jurisdiction: params.jurisdiction.toUpperCase(),
      retentionStartAt: params.retentionStartAt,
      retentionEndAt,
      state,
      eligibleAction: policy.eligibleAction,
      blockedByLegalHold: hasLegalHold,
      legalHoldIds: blockingHolds.map((h) => h.id),
      policyVersion: policy.policyVersion,
      correlationId: params.correlationId,
      createdAt: new Date().toISOString(),
    };

    this.inMemory.set(candidate.id, candidate);
    try {
      await (this.prisma as any).retentionCandidate?.create?.({
        data: {
          id: candidate.id,
          tenantId: candidate.tenantId,
          dataClass: candidate.dataClass,
          sourceSystem: candidate.sourceSystem,
          sourceId: candidate.sourceId,
          jurisdiction: candidate.jurisdiction,
          retentionStartAt: new Date(candidate.retentionStartAt),
          retentionEndAt: new Date(candidate.retentionEndAt),
          state: candidate.state,
          eligibleAction: candidate.eligibleAction,
          blockedByLegalHold: candidate.blockedByLegalHold,
          legalHoldIds: candidate.legalHoldIds,
          policyVersion: candidate.policyVersion,
          correlationId: candidate.correlationId,
          createdAt: new Date(candidate.createdAt),
        },
      });
    } catch {
      this.logger.debug(`retentionCandidate persist skipped id=${candidate.id}`);
    }

    await this.audit.recordEvent({
      tenantId: params.tenantId,
      actionType: GovernanceActionType.RETENTION_EVALUATE,
      retentionCandidateId: candidate.id,
      state: candidate.state,
      result: 'EVALUATED',
      correlationId: params.correlationId,
      createdBy: params.operatorId,
      safeEvidence: { dataClass: params.dataClass, state, retentionEndAt, blockedByLegalHold: hasLegalHold },
    });

    this.logger.log(`retention evaluated id=${candidate.id} tenant=${params.tenantId} state=${state} corr=${params.correlationId}`);
    return candidate;
  }

  async findCandidate(tenantId: string, sourceSystem: string, sourceId: string): Promise<RetentionCandidate | null> {
    for (const c of this.inMemory.values()) {
      if (c.tenantId === tenantId && c.sourceSystem === sourceSystem && c.sourceId === sourceId) return c;
    }
    try {
      const row = await (this.prisma as any).retentionCandidate?.findFirst?.({ where: { tenantId, sourceSystem, sourceId }, orderBy: { createdAt: 'desc' } });
      if (row) return this.mapRow(row);
    } catch {
      /* ignore */
    }
    return null;
  }

  async listCandidates(tenantId: string, filters?: { state?: RetentionState; dataClass?: DataClassification }): Promise<RetentionCandidate[]> {
    let list = [...this.inMemory.values()].filter((c) => c.tenantId === tenantId);
    if (filters?.state) list = list.filter((c) => c.state === filters.state);
    if (filters?.dataClass) list = list.filter((c) => c.dataClass === filters.dataClass);
    try {
      const where: any = { tenantId };
      if (filters?.state) where.state = filters.state;
      if (filters?.dataClass) where.dataClass = filters.dataClass;
      const rows = await (this.prisma as any).retentionCandidate?.findMany?.({ where, take: 500, orderBy: { createdAt: 'desc' } });
      if (rows && rows.length > 0) list = rows.map((r: any) => this.mapRow(r));
    } catch {
      /* ignore */
    }
    return list;
  }

  async executeAction(params: {
    tenantId: string;
    candidateId: string;
    action: 'DELETE' | 'ANONYMIZE' | 'REVIEW' | 'PRESERVE';
    correlationId: string;
    operatorId: string;
    reason: string;
  }): Promise<RetentionCandidate> {
    const candidate = this.inMemory.get(params.candidateId) ?? (await this.getCandidate(params.tenantId, params.candidateId));
    if (candidate.blockedByLegalHold) throw new BadRequestException(`candidate blocked by legal hold ${candidate.legalHoldIds.join(',')}`);
    if (candidate.eligibleAction !== params.action && params.action !== 'REVIEW' && params.action !== 'PRESERVE') {
      throw new BadRequestException(`action ${params.action} not eligible, expected ${candidate.eligibleAction}`);
    }
    if (candidate.state === RetentionState.RETENTION_REQUIRED) throw new BadRequestException('retention still required, cannot execute deletion/anonymization');

    let newState: RetentionState;
    switch (params.action) {
      case 'DELETE':
        newState = RetentionState.DELETED;
        break;
      case 'ANONYMIZE':
        newState = RetentionState.ANONYMIZED;
        break;
      case 'PRESERVE':
        newState = RetentionState.PRESERVED;
        break;
      default:
        newState = RetentionState.ELIGIBLE_FOR_REVIEW;
    }

    candidate.state = newState;
    this.inMemory.set(candidate.id, candidate);
    try {
      await (this.prisma as any).retentionCandidate?.update?.({ where: { id: candidate.id }, data: { state: newState } });
    } catch {
      this.logger.debug(`retention execute persist skipped id=${candidate.id}`);
    }

    await this.audit.recordEvent({
      tenantId: params.tenantId,
      actionType: GovernanceActionType.RETENTION_ACTION,
      retentionCandidateId: candidate.id,
      state: newState,
      result: params.action,
      reason: params.reason,
      correlationId: params.correlationId,
      createdBy: params.operatorId,
      safeEvidence: { action: params.action, previousEligible: candidate.eligibleAction },
    });

    this.logger.log(`retention action id=${candidate.id} action=${params.action} -> ${newState} corr=${params.correlationId}`);
    return candidate;
  }

  private async getCandidate(tenantId: string, candidateId: string): Promise<RetentionCandidate> {
    const mem = this.inMemory.get(candidateId);
    if (mem) {
      this.policyService.assertTenantIsolation(tenantId, mem.tenantId);
      return mem;
    }
    try {
      const row = await (this.prisma as any).retentionCandidate?.findUnique?.({ where: { id: candidateId } });
      if (row) {
        this.policyService.assertTenantIsolation(tenantId, row.tenantId);
        return this.mapRow(row);
      }
    } catch {
      /* ignore */
    }
    throw new BadRequestException(`retention candidate ${candidateId} not found`);
  }

  private mapRow(row: any): RetentionCandidate {
    return {
      id: row.id,
      tenantId: row.tenantId,
      dataClass: row.dataClass,
      sourceSystem: row.sourceSystem,
      sourceId: row.sourceId,
      jurisdiction: row.jurisdiction,
      retentionStartAt: row.retentionStartAt instanceof Date ? row.retentionStartAt.toISOString() : row.retentionStartAt,
      retentionEndAt: row.retentionEndAt instanceof Date ? row.retentionEndAt.toISOString() : row.retentionEndAt,
      state: row.state,
      eligibleAction: row.eligibleAction,
      blockedByLegalHold: !!row.blockedByLegalHold,
      legalHoldIds: row.legalHoldIds ?? [],
      policyVersion: row.policyVersion,
      correlationId: row.correlationId,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    };
  }
}

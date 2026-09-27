import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { GovernanceAuditEvent, GovernanceActionType } from './governance.types';
import { GovernancePolicyService } from './governance-policy.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Injectable()
export class GovernanceAuditService {
  private readonly logger = new Logger(GovernanceAuditService.name);
  private readonly inMemory: GovernanceAuditEvent[] = [];

  constructor(
    private readonly policyService: GovernancePolicyService,
    private readonly prisma: PrismaService,
  ) {}

  async recordEvent(params: {
    tenantId: string;
    actionType: GovernanceActionType;
    subjectUserId?: string | null;
    requestId?: string | null;
    reportId?: string | null;
    evidencePackageId?: string | null;
    legalHoldId?: string | null;
    retentionCandidateId?: string | null;
    consentId?: string | null;
    state: string;
    result: string;
    reason?: string | null;
    correlationId: string;
    createdBy: string;
    safeEvidence?: Record<string, unknown>;
  }): Promise<GovernanceAuditEvent> {
    if (!params.tenantId || !params.actionType || !params.correlationId || !params.createdBy) {
      throw new BadRequestException('tenantId, actionType, correlationId, createdBy required');
    }

    const sanitized = params.safeEvidence ? this.policyService.sanitizeLogEvidence(params.safeEvidence) : {};

    const event: GovernanceAuditEvent = {
      id: `gaud_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      tenantId: params.tenantId,
      actionType: params.actionType,
      subjectUserId: params.subjectUserId ?? null,
      requestId: params.requestId ?? null,
      reportId: params.reportId ?? null,
      evidencePackageId: params.evidencePackageId ?? null,
      legalHoldId: params.legalHoldId ?? null,
      retentionCandidateId: params.retentionCandidateId ?? null,
      consentId: params.consentId ?? null,
      state: params.state,
      result: params.result,
      reason: params.reason ?? null,
      correlationId: params.correlationId,
      createdBy: params.createdBy,
      createdAt: new Date().toISOString(),
      safeEvidence: sanitized,
    };

    this.inMemory.push(event);
    if (this.inMemory.length > 5000) this.inMemory.splice(0, 1000);

    try {
      await (this.prisma as any).governanceAudit?.create?.({
        data: {
          id: event.id,
          tenantId: event.tenantId,
          actionType: event.actionType,
          subjectUserId: event.subjectUserId,
          requestId: event.requestId,
          reportId: event.reportId,
          evidencePackageId: event.evidencePackageId,
          legalHoldId: event.legalHoldId,
          retentionCandidateId: event.retentionCandidateId,
          consentId: event.consentId,
          state: event.state,
          result: event.result,
          reason: event.reason,
          correlationId: event.correlationId,
          createdBy: event.createdBy,
          createdAt: new Date(event.createdAt),
          safeEvidence: sanitized as any,
        },
      });
    } catch {
      this.logger.debug(`governance audit persist skipped id=${event.id}`);
    }

    // Never log PII
    this.logger.log(`audit tenant=${params.tenantId} action=${params.actionType} state=${params.state} corr=${params.correlationId}`);
    return event;
  }

  async listEvents(tenantId: string, filters?: { actionType?: GovernanceActionType; correlationId?: string; subjectUserId?: string; take?: number }): Promise<GovernanceAuditEvent[]> {
    if (!tenantId) throw new BadRequestException('tenantId required');
    let list = this.inMemory.filter((e) => e.tenantId === tenantId);
    if (filters?.actionType) list = list.filter((e) => e.actionType === filters.actionType);
    if (filters?.correlationId) list = list.filter((e) => e.correlationId === filters.correlationId);
    if (filters?.subjectUserId) list = list.filter((e) => e.subjectUserId === filters.subjectUserId);
    list = list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (filters?.take) list = list.slice(0, filters.take);

    try {
      const where: any = { tenantId };
      if (filters?.actionType) where.actionType = filters.actionType;
      if (filters?.correlationId) where.correlationId = filters.correlationId;
      if (filters?.subjectUserId) where.subjectUserId = filters.subjectUserId;
      const rows = await (this.prisma as any).governanceAudit?.findMany?.({ where, take: filters?.take ?? 200, orderBy: { createdAt: 'desc' } });
      if (rows && rows.length > 0) {
        list = rows.map((r: any) => ({
          id: r.id,
          tenantId: r.tenantId,
          actionType: r.actionType,
          subjectUserId: r.subjectUserId ?? null,
          requestId: r.requestId ?? null,
          reportId: r.reportId ?? null,
          evidencePackageId: r.evidencePackageId ?? null,
          legalHoldId: r.legalHoldId ?? null,
          retentionCandidateId: r.retentionCandidateId ?? null,
          consentId: r.consentId ?? null,
          state: r.state,
          result: r.result,
          reason: r.reason ?? null,
          correlationId: r.correlationId,
          createdBy: r.createdBy,
          createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
          safeEvidence: r.safeEvidence ?? {},
        }));
      }
    } catch {
      /* ignore */
    }
    return list;
  }
}

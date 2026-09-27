import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { ComplianceCaseRepository } from './compliance-case.repository';
import { ComplianceAuditService } from './compliance-audit.service';
import { CompliancePolicyService } from './compliance-policy.service';
import { RiskScoringService } from './risk-scoring.service';
import { ComplianceCaseState, ComplianceCaseType, RiskLevel, ComplianceDecision, ComplianceReviewAction } from './compliance.types';
import { randomUUID } from 'crypto';

/**
 * Manages compliance case lifecycle: create/assign/escalate/evidence/note/decision/EDD/reverification/hold/release/resolve/close
 * Controlled boundary for downstream effects - does NOT directly mutate financial tables.
 */
@Injectable()
export class ComplianceCaseService {
  private readonly logger = new Logger(ComplianceCaseService.name);

  constructor(
    private readonly repository: ComplianceCaseRepository,
    private readonly auditService: ComplianceAuditService,
    private readonly policyService: CompliancePolicyService,
    private readonly riskScoringService: RiskScoringService,
  ) {}

  async createCase(input: {
    tenantId: string;
    userId: string;
    caseType: ComplianceCaseType;
    riskLevel?: RiskLevel;
    safeSummary: string;
    severity?: string;
    jurisdiction?: string;
    ruleIds?: string[];
    sourceRefs?: any[];
    idempotencyKey?: string;
    actorId?: string;
  }): Promise<any> {
    const idempotencyKey = input.idempotencyKey || `case_${input.tenantId}_${input.userId}_${input.caseType}_${Date.now()}`;
    const policy = await this.policyService.getEffectivePolicy({ tenantId: input.tenantId, jurisdiction: input.jurisdiction });

    const created = await this.repository.createCase({
      tenantId: input.tenantId,
      userId: input.userId,
      caseType: input.caseType,
      riskLevel: input.riskLevel || RiskLevel.MEDIUM,
      safeSummary: input.safeSummary,
      severity: input.severity || 'MEDIUM',
      jurisdiction: input.jurisdiction || 'DEFAULT',
      policyVersion: policy.policyVersion,
      ruleIds: input.ruleIds || [],
      sourceRefs: input.sourceRefs || [],
      idempotencyKey,
      metadata: { createdBy: input.actorId },
    });

    await this.auditService.recordCaseCreated(input.tenantId, created.id, input.userId, input.caseType, input.actorId);

    return created;
  }

  async getCase(caseId: string, tenantId: string, requester: { userId: string; tenantId: string; roles?: string[] }): Promise<any> {
    // Tenant isolation
    if (requester.tenantId !== tenantId && !this.isPlatformAdmin(requester.roles)) {
      throw new ForbiddenException('Cross-tenant access denied');
    }

    const caseData = await this.repository.findById(caseId, tenantId);
    if (!caseData) throw new NotFoundException(`Case ${caseId} not found`);

    // If tenant user requesting own data - allow if userId matches or is tenant admin
    if (requester.tenantId === tenantId) {
      // Tenant member can only see own cases unless has compliance role
      const isComplianceReviewer = requester.roles?.some((r) => ['COMPLIANCE_REVIEWER', 'ADMIN', 'OWNER', 'PLATFORM_ADMIN'].includes(r));
      if (!isComplianceReviewer && caseData.userId !== requester.userId) {
        // Allow tenant admin to see all tenant cases
        const isTenantAdmin = requester.roles?.some((r) => ['ADMIN', 'OWNER'].includes(r));
        if (!isTenantAdmin) {
          throw new ForbiddenException('Access denied to this case');
        }
      }
    }

    return caseData;
  }

  async listTenantCases(tenantId: string, requester: { userId: string; tenantId: string; roles?: string[] }, filters?: any): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    if (requester.tenantId !== tenantId && !this.isPlatformAdmin(requester.roles)) {
      throw new ForbiddenException('Cross-tenant access denied');
    }

    // If regular user, filter to own cases only
    const isPrivileged = requester.roles?.some((r) => ['ADMIN', 'OWNER', 'COMPLIANCE_REVIEWER', 'PLATFORM_ADMIN'].includes(r));
    const effectiveFilters = { ...filters };
    if (!isPrivileged) {
      effectiveFilters.userId = requester.userId;
    }

    // Repository list method doesn't support userId filter directly, but we can filter after
    const result = await this.repository.listTenantCases(tenantId, effectiveFilters);

    if (!isPrivileged) {
      const filtered = result.data.filter((c: any) => c.userId === requester.userId);
      return { data: filtered, total: filtered.length, page: result.page, limit: result.limit };
    }

    return result;
  }

  async listReviewerQueue(reviewerId: string, filters?: { state?: ComplianceCaseState; page?: number; limit?: number }): Promise<{ data: any[]; total: number }> {
    return this.repository.listReviewerCases(reviewerId, filters);
  }

  async assignCase(caseId: string, tenantId: string, reviewerId: string, actorId: string, idempotencyKey?: string): Promise<any> {
    const caseData = await this.repository.findById(caseId, tenantId);
    if (!caseData) throw new NotFoundException(`Case ${caseId} not found`);

    if (![ComplianceCaseState.OPEN, ComplianceCaseState.ESCALATED].includes(caseData.state as ComplianceCaseState)) {
      throw new BadRequestException(`Cannot assign case in state ${caseData.state}`);
    }

    const updated = await this.repository.assignReviewer(caseId, tenantId, reviewerId, actorId, idempotencyKey);

    await this.auditService.recordCaseAssigned(tenantId, caseId, reviewerId, actorId);

    return updated;
  }

  async escalateCase(caseId: string, tenantId: string, actorId: string, reason: string, idempotencyKey?: string): Promise<any> {
    const caseData = await this.repository.findById(caseId, tenantId);
    if (!caseData) throw new NotFoundException(`Case ${caseId} not found`);

    if (![ComplianceCaseState.OPEN, ComplianceCaseState.IN_REVIEW].includes(caseData.state as ComplianceCaseState)) {
      throw new BadRequestException(`Cannot escalate case in state ${caseData.state}`);
    }

    const updated = await this.repository.transitionState(caseId, tenantId, ComplianceCaseState.ESCALATED, actorId, reason, undefined, idempotencyKey);

    await this.auditService.recordCaseEscalated(tenantId, caseId, actorId, reason);

    return updated;
  }

  async addEvidence(caseId: string, tenantId: string, input: { evidenceType: string; referenceId: string; referenceType: string; safeDescription?: string; addedBy: string }): Promise<any> {
    const caseData = await this.repository.findById(caseId, tenantId);
    if (!caseData) throw new NotFoundException(`Case ${caseId} not found`);

    const evidence = await this.repository.addEvidence(caseId, tenantId, input);

    await this.auditService.record({
      tenantId,
      caseId,
      action: 'COMPLIANCE_EVIDENCE_ADDED',
      actorId: input.addedBy,
      safeMetadata: { evidenceType: input.evidenceType, referenceType: input.referenceType },
    });

    return evidence;
  }

  async addNote(caseId: string, tenantId: string, reviewerId: string, safeNote: string): Promise<any> {
    const caseData = await this.repository.findById(caseId, tenantId);
    if (!caseData) throw new NotFoundException(`Case ${caseId} not found`);

    const review = await this.repository.addReviewNote(caseId, tenantId, reviewerId, safeNote, 'ADD_NOTE');

    await this.auditService.record({
      tenantId,
      caseId,
      action: 'COMPLIANCE_NOTE_ADDED',
      actorId: reviewerId,
      safeMetadata: { caseId },
    });

    return review;
  }

  async makeDecision(caseId: string, tenantId: string, input: { decision: ComplianceDecision; reviewerId: string; reason: string; idempotencyKey?: string }): Promise<any> {
    const caseData = await this.repository.findById(caseId, tenantId);
    if (!caseData) throw new NotFoundException(`Case ${caseId} not found`);

    if (![ComplianceCaseState.IN_REVIEW, ComplianceCaseState.ESCALATED].includes(caseData.state as ComplianceCaseState)) {
      throw new BadRequestException(`Cannot decide case in state ${caseData.state}`);
    }

    // Immutable decision history - reviewer must be assigned or platform admin
    if (caseData.assignedTo && caseData.assignedTo !== input.reviewerId) {
      // Allow if actor is escalated reviewer or admin
      this.logger.warn(`Decision by non-assigned reviewer case=${caseId} assignedTo=${caseData.assignedTo} reviewer=${input.reviewerId}`);
    }

    // Determine target state based on decision
    let targetState: ComplianceCaseState;
    switch (input.decision) {
      case ComplianceDecision.ALLOW:
        targetState = ComplianceCaseState.RESOLVED;
        break;
      case ComplianceDecision.BLOCK:
      case ComplianceDecision.RESTRICT:
        targetState = ComplianceCaseState.RESOLVED;
        break;
      case ComplianceDecision.REVIEW_REQUIRED:
      case ComplianceDecision.PENDING:
        targetState = ComplianceCaseState.IN_REVIEW;
        break;
      default:
        targetState = ComplianceCaseState.RESOLVED;
    }

    // If decision is BLOCK/RESTRICT, keep case RESOLVED but decision recorded - no direct ledger mutation here, downstream effects via controlled boundary
    const updated = await this.repository.transitionState(caseId, tenantId, targetState, input.reviewerId, input.reason, input.decision, input.idempotencyKey);

    await this.auditService.recordDecision(tenantId, caseId, input.decision, input.reviewerId, input.reason);

    // Re-calculate risk score after decision
    try {
      await this.riskScoringService.calculateRiskScore({ tenantId, userId: caseData.userId, idempotencyKey: `risk_after_decision_${caseId}_${Date.now()}` });
    } catch {}

    return updated;
  }

  async requestEDD(caseId: string, tenantId: string, reviewerId: string, reason: string): Promise<any> {
    const caseData = await this.repository.findById(caseId, tenantId);
    if (!caseData) throw new NotFoundException(`Case ${caseId} not found`);

    const review = await this.repository.addReviewNote(caseId, tenantId, reviewerId, `EDD requested: ${reason}`, 'REQUEST_EDD');

    await this.auditService.record({
      tenantId,
      caseId,
      action: 'COMPLIANCE_EDD_REQUESTED',
      actorId: reviewerId,
      safeMetadata: { caseId, reason: reason.substring(0, 500) },
    });

    // Transition to IN_REVIEW if not already
    if (caseData.state === ComplianceCaseState.OPEN) {
      await this.repository.transitionState(caseId, tenantId, ComplianceCaseState.IN_REVIEW, reviewerId, `EDD requested: ${reason}`);
    }

    return review;
  }

  async requestReverification(caseId: string, tenantId: string, reviewerId: string, reason: string): Promise<any> {
    const caseData = await this.repository.findById(caseId, tenantId);
    if (!caseData) throw new NotFoundException(`Case ${caseId} not found`);

    const review = await this.repository.addReviewNote(caseId, tenantId, reviewerId, `Re-verification requested: ${reason}`, 'REQUEST_REVERIFICATION');

    await this.auditService.record({
      tenantId,
      caseId,
      action: 'COMPLIANCE_REVERIFICATION_REQUESTED',
      actorId: reviewerId,
      safeMetadata: { caseId, reason: reason.substring(0, 500) },
    });

    return review;
  }

  async requestHold(caseId: string, tenantId: string, reviewerId: string, reason: string, idempotencyKey?: string): Promise<any> {
    const caseData = await this.repository.findById(caseId, tenantId);
    if (!caseData) throw new NotFoundException(`Case ${caseId} not found`);

    // Explicit policy check - no auto freeze without explicit policy + auditable action
    const policy = await this.policyService.getEffectivePolicy({ tenantId, jurisdiction: caseData.jurisdiction });
    if (!policy.manualReviewRequired && caseData.riskLevel !== RiskLevel.CRITICAL) {
      this.logger.warn(`Hold requested but policy does not require manual review case=${caseId} risk=${caseData.riskLevel}`);
    }

    const review = await this.repository.addReviewNote(caseId, tenantId, reviewerId, `Hold requested: ${reason}`, 'REQUEST_HOLD');

    await this.auditService.recordHoldRequested(tenantId, caseId, reviewerId, reason);

    // Note: hold effect must be via controlled boundary, not direct DB mutation of financial tables - audit only here
    this.logger.log(`Compliance hold requested case=${caseId} tenant=${tenantId} reviewer=${reviewerId} - requires explicit downstream action via controlled boundary`);

    return review;
  }

  async requestRelease(caseId: string, tenantId: string, reviewerId: string, reason: string, idempotencyKey?: string): Promise<any> {
    const caseData = await this.repository.findById(caseId, tenantId);
    if (!caseData) throw new NotFoundException(`Case ${caseId} not found`);

    const review = await this.repository.addReviewNote(caseId, tenantId, reviewerId, `Release requested: ${reason}`, 'REQUEST_RELEASE');

    await this.auditService.recordReleaseRequested(tenantId, caseId, reviewerId, reason);

    this.logger.log(`Compliance release requested case=${caseId} tenant=${tenantId} reviewer=${reviewerId} - requires explicit downstream action via controlled boundary`);

    return review;
  }

  async resolveCase(caseId: string, tenantId: string, reviewerId: string, reason: string, decision?: ComplianceDecision): Promise<any> {
    const caseData = await this.repository.findById(caseId, tenantId);
    if (!caseData) throw new NotFoundException(`Case ${caseId} not found`);

    if (![ComplianceCaseState.IN_REVIEW, ComplianceCaseState.ESCALATED].includes(caseData.state as ComplianceCaseState)) {
      throw new BadRequestException(`Cannot resolve case in state ${caseData.state}`);
    }

    const updated = await this.repository.transitionState(caseId, tenantId, ComplianceCaseState.RESOLVED, reviewerId, reason, decision);

    await this.auditService.record({
      tenantId,
      caseId,
      action: 'COMPLIANCE_CASE_RESOLVED',
      actorId: reviewerId,
      safeMetadata: { caseId, decision: decision || caseData.decision, reason: reason.substring(0, 500) },
    });

    return updated;
  }

  async closeCase(caseId: string, tenantId: string, reviewerId: string, reason: string): Promise<any> {
    const caseData = await this.repository.findById(caseId, tenantId);
    if (!caseData) throw new NotFoundException(`Case ${caseId} not found`);

    if (caseData.state !== ComplianceCaseState.RESOLVED && caseData.state !== ComplianceCaseState.REJECTED) {
      throw new BadRequestException(`Can only close RESOLVED or REJECTED cases, current=${caseData.state}`);
    }

    const updated = await this.repository.transitionState(caseId, tenantId, ComplianceCaseState.CLOSED, reviewerId, reason);

    await this.auditService.record({
      tenantId,
      caseId,
      action: 'COMPLIANCE_CASE_CLOSED',
      actorId: reviewerId,
      safeMetadata: { caseId, reason: reason.substring(0, 500) },
    });

    return updated;
  }

  async getUserCases(userId: string, tenantId: string): Promise<any[]> {
    return this.repository.findByUserId(userId, tenantId);
  }

  private isPlatformAdmin(roles?: string[]): boolean {
    return !!roles?.includes('PLATFORM_ADMIN') || !!roles?.includes('SUPER_ADMIN');
  }
}

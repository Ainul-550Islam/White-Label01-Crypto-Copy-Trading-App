// # Implements compliance case state transitions and account restriction hooks
import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ComplianceCaseRepository } from './compliance-case.repository';
import { ComplianceAuditService } from './compliance-audit.service';
import { CompliancePolicyService } from './compliance-policy.service';
import { RiskScoringService } from './risk-scoring.service';
import { ComplianceCaseState, ComplianceCaseType, ComplianceDecision, ComplianceReviewAction, RiskLevel } from './compliance.types';


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
      const isComplianceReviewer = requester.roles?.some((r) => ['COMPLIANCE_REVIEWER', 'ADMIN', 'OWNER', 'PLATFORM_ADMIN', 'SUPER_ADMIN', 'PLATFORM_MANAGE'].includes(r));
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
    const isPrivileged = requester.roles?.some((r) => ['ADMIN', 'OWNER', 'COMPLIANCE_REVIEWER', 'PLATFORM_ADMIN', 'SUPER_ADMIN', 'PLATFORM_MANAGE'].includes(r));
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

  async assignCase(
    caseId: string,
    tenantId: string,
    reviewerId: string,
    actorId: string,
    idempotencyKey?: string,
    reason?: string,
  ): Promise<any> {
    return this.repository.assignReviewer(caseId, tenantId, reviewerId, actorId, idempotencyKey, reason);
  }

  async escalateCase(caseId: string, tenantId: string, actorId: string, reason: string, idempotencyKey?: string): Promise<any> {
    return this.repository.transitionState(
      caseId,
      tenantId,
      ComplianceCaseState.ESCALATED,
      actorId,
      reason,
      undefined,
      idempotencyKey,
      {
        action: ComplianceReviewAction.ESCALATE,
        auditAction: 'COMPLIANCE_CASE_ESCALATED',
        allowedFromStates: [ComplianceCaseState.OPEN, ComplianceCaseState.IN_REVIEW],
      },
    );
  }

  async addEvidence(caseId: string, tenantId: string, input: {
    evidenceType: string;
    referenceId: string;
    referenceType: string;
    safeDescription?: string;
    addedBy: string;
    idempotencyKey?: string;
  }): Promise<any> {
    return this.repository.addEvidence(caseId, tenantId, input);
  }

  async addNote(caseId: string, tenantId: string, reviewerId: string, safeNote: string, idempotencyKey?: string): Promise<any> {
    return this.repository.addReviewNote(
      caseId,
      tenantId,
      reviewerId,
      safeNote,
      ComplianceReviewAction.ADD_NOTE,
      { idempotencyKey, auditAction: 'COMPLIANCE_NOTE_ADDED' },
    );
  }

  async makeDecision(caseId: string, tenantId: string, input: {
    decision: ComplianceDecision;
    reviewerId: string;
    reason: string;
    idempotencyKey?: string;
  }): Promise<any> {
    const caseData = await this.repository.findById(caseId, tenantId);
    if (!caseData) throw new NotFoundException(`Case ${caseId} not found`);

    if (caseData.assignedTo && caseData.assignedTo !== input.reviewerId) {
      this.logger.warn(`Decision by non-assigned reviewer case=${caseId} assignedTo=${caseData.assignedTo} reviewer=${input.reviewerId}`);
    }

    let targetState: ComplianceCaseState;
    switch (input.decision) {
      case ComplianceDecision.ALLOW:
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

    const action = input.decision === ComplianceDecision.ALLOW
      ? ComplianceReviewAction.APPROVE
      : input.decision === ComplianceDecision.BLOCK || input.decision === ComplianceDecision.RESTRICT
        ? ComplianceReviewAction.REJECT
        : ComplianceReviewAction.ADD_NOTE;
    const updated = await this.repository.transitionState(
      caseId,
      tenantId,
      targetState,
      input.reviewerId,
      input.reason,
      input.decision,
      input.idempotencyKey,
      {
        action,
        auditAction: 'COMPLIANCE_DECISION_RECORDED',
        allowedFromStates: [ComplianceCaseState.IN_REVIEW, ComplianceCaseState.ESCALATED],
        allowSameState: targetState === ComplianceCaseState.IN_REVIEW,
      },
    );

    try {
      const riskKey = input.idempotencyKey?.trim()
        ? `risk_after_decision_${caseId}_${createHash('sha256').update(input.idempotencyKey.trim()).digest('hex')}`
        : `risk_after_decision_${caseId}_${Date.now()}`;
      await this.riskScoringService.calculateRiskScore({
        tenantId,
        userId: caseData.userId,
        idempotencyKey: riskKey,
      });
    } catch {}

    return updated;
  }

  async requestEDD(caseId: string, tenantId: string, reviewerId: string, reason: string, idempotencyKey?: string): Promise<any> {
    return this.repository.addReviewNote(
      caseId,
      tenantId,
      reviewerId,
      `EDD requested: ${reason}`,
      ComplianceReviewAction.REQUEST_EDD,
      {
        idempotencyKey,
        transitionOpenToReview: true,
        auditAction: 'COMPLIANCE_EDD_REQUESTED',
        auditMetadata: { reason: reason.substring(0, 500) },
      },
    );
  }

  async requestReverification(caseId: string, tenantId: string, reviewerId: string, reason: string, idempotencyKey?: string): Promise<any> {
    return this.repository.addReviewNote(
      caseId,
      tenantId,
      reviewerId,
      `Re-verification requested: ${reason}`,
      ComplianceReviewAction.REQUEST_REVERIFICATION,
      {
        idempotencyKey,
        auditAction: 'COMPLIANCE_REVERIFICATION_REQUESTED',
        auditMetadata: { reason: reason.substring(0, 500) },
      },
    );
  }

  async requestHold(caseId: string, tenantId: string, reviewerId: string, reason: string, idempotencyKey?: string): Promise<any> {
    const caseData = await this.repository.findById(caseId, tenantId);
    if (!caseData) throw new NotFoundException(`Case ${caseId} not found`);

    const policy = await this.policyService.getEffectivePolicy({ tenantId, jurisdiction: caseData.jurisdiction });
    if (!policy.manualReviewRequired && caseData.riskLevel !== RiskLevel.CRITICAL) {
      this.logger.warn(`Hold requested but policy does not require manual review case=${caseId} risk=${caseData.riskLevel}`);
    }

    const review = await this.repository.addReviewNote(
      caseId,
      tenantId,
      reviewerId,
      `Hold requested: ${reason}`,
      ComplianceReviewAction.REQUEST_HOLD,
      {
        idempotencyKey,
        auditAction: 'COMPLIANCE_HOLD_REQUESTED',
        auditMetadata: { reason: reason.substring(0, 500) },
      },
    );
    this.logger.log(`Compliance hold requested case=${caseId} tenant=${tenantId} reviewer=${reviewerId} - requires explicit downstream action via controlled boundary`);
    return review;
  }

  async requestRelease(caseId: string, tenantId: string, reviewerId: string, reason: string, idempotencyKey?: string): Promise<any> {
    const caseData = await this.repository.findById(caseId, tenantId);
    if (!caseData) throw new NotFoundException(`Case ${caseId} not found`);

    const review = await this.repository.addReviewNote(
      caseId,
      tenantId,
      reviewerId,
      `Release requested: ${reason}`,
      ComplianceReviewAction.REQUEST_RELEASE,
      {
        idempotencyKey,
        auditAction: 'COMPLIANCE_RELEASE_REQUESTED',
        auditMetadata: { reason: reason.substring(0, 500) },
      },
    );
    this.logger.log(`Compliance release requested case=${caseId} tenant=${tenantId} reviewer=${reviewerId} - requires explicit downstream action via controlled boundary`);
    return review;
  }

  async resolveCase(
    caseId: string,
    tenantId: string,
    reviewerId: string,
    reason: string,
    decision?: ComplianceDecision,
    idempotencyKey?: string,
  ): Promise<any> {
    return this.repository.transitionState(
      caseId,
      tenantId,
      ComplianceCaseState.RESOLVED,
      reviewerId,
      reason,
      decision,
      idempotencyKey,
      {
        action: ComplianceReviewAction.RESOLVE,
        auditAction: 'COMPLIANCE_CASE_RESOLVED',
        allowedFromStates: [ComplianceCaseState.IN_REVIEW, ComplianceCaseState.ESCALATED],
      },
    );
  }

  async closeCase(caseId: string, tenantId: string, reviewerId: string, reason: string, idempotencyKey?: string): Promise<any> {
    return this.repository.transitionState(
      caseId,
      tenantId,
      ComplianceCaseState.CLOSED,
      reviewerId,
      reason,
      undefined,
      idempotencyKey,
      {
        action: ComplianceReviewAction.CLOSE,
        auditAction: 'COMPLIANCE_CASE_CLOSED',
        allowedFromStates: [ComplianceCaseState.RESOLVED, ComplianceCaseState.REJECTED],
      },
    );
  }

  async getUserCases(userId: string, tenantId: string): Promise<any[]> {
    return this.repository.findByUserId(userId, tenantId);
  }

  private isPlatformAdmin(roles?: string[]): boolean {
    return !!roles?.some((role) => ['PLATFORM_ADMIN', 'SUPER_ADMIN', 'PLATFORM_MANAGE'].includes(role));
  }
}

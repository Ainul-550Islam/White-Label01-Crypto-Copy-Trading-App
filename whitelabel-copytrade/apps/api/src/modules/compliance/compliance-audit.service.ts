import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { sanitizeMetadata } from './compliance.types';
import { randomUUID } from 'crypto';

/**
 * Immutable compliance audit events for KYC, AML, screening, risk, cases, policy actions, and administrative decisions.
 * Never audits raw identity documents, passwords, provider secrets, API keys, private keys, full webhook payloads, financial credentials.
 */
@Injectable()
export class ComplianceAuditService {
  private readonly logger = new Logger(ComplianceAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(params: {
    tenantId: string;
    caseId?: string;
    userId?: string;
    action: string;
    actorId?: string;
    actorType?: string;
    outcome?: string;
    safeMetadata?: Record<string, any>;
    ipHash?: string;
    requestId?: string;
  }): Promise<void> {
    const safeMeta = params.safeMetadata ? sanitizeMetadata(params.safeMetadata) : {};

    try {
      await (this.prisma as any).complianceAuditLog?.create({
        data: {
          id: randomUUID(),
          tenantId: params.tenantId,
          caseId: params.caseId || null,
          userId: params.userId || null,
          action: params.action,
          actorId: params.actorId || null,
          actorType: params.actorType || 'USER',
          outcome: params.outcome || 'SUCCESS',
          safeMetadata: safeMeta,
          ipHash: params.ipHash || null,
          requestId: params.requestId || null,
          createdAt: new Date(),
        },
      });

      this.logger.log(`Compliance audit recorded action=${params.action} tenant=${params.tenantId} case=${params.caseId || 'none'} actor=${params.actorId || 'system'}`);
    } catch (e: any) {
      this.logger.warn(`Failed to record compliance audit ${params.action}: ${e.message}, fallback to auditLog`);

      try {
        await (this.prisma as any).auditLog?.create({
          data: {
            id: randomUUID(),
            tenantId: params.tenantId,
            actorType: (params.actorType as any) || 'USER',
            actorId: params.actorId || null,
            action: params.action,
            outcome: (params.outcome as any) || 'SUCCESS',
            resourceType: 'ComplianceCase',
            resourceId: params.caseId || params.userId || 'unknown',
            description: `Compliance ${params.action}`,
            metadata: safeMeta,
            ipHash: params.ipHash || null,
            requestId: params.requestId || null,
            createdAt: new Date(),
          },
        });
      } catch (e2: any) {
        this.logger.warn(`Fallback audit also failed: ${e2.message}`);
      }
    }
  }

  async recordKycStarted(tenantId: string, userId: string, actorId: string, providerRef: string, ipHash?: string, requestId?: string): Promise<void> {
    await this.record({
      tenantId,
      userId,
      action: 'KYC_STARTED',
      actorId,
      outcome: 'SUCCESS',
      safeMetadata: { providerRef, userId },
      ipHash,
      requestId,
    });
  }

  async recordKycSubmitted(tenantId: string, userId: string, providerRef: string, ipHash?: string): Promise<void> {
    await this.record({
      tenantId,
      userId,
      action: 'KYC_SUBMITTED',
      outcome: 'SUCCESS',
      safeMetadata: { providerRef, userId },
      ipHash,
    });
  }

  async recordKycVerified(tenantId: string, userId: string, providerRef: string, reviewerId?: string): Promise<void> {
    await this.record({
      tenantId,
      userId,
      action: 'KYC_VERIFIED',
      actorId: reviewerId,
      outcome: 'SUCCESS',
      safeMetadata: { providerRef, userId, reviewerId },
    });
  }

  async recordKycRejected(tenantId: string, userId: string, providerRef: string, reason: string, reviewerId?: string): Promise<void> {
    await this.record({
      tenantId,
      userId,
      action: 'KYC_REJECTED',
      actorId: reviewerId,
      outcome: 'FAILURE',
      safeMetadata: { providerRef, userId, reason: reason.substring(0, 200), reviewerId },
    });
  }

  async recordKycExpired(tenantId: string, userId: string, providerRef: string): Promise<void> {
    await this.record({
      tenantId,
      userId,
      action: 'KYC_EXPIRED',
      outcome: 'SUCCESS',
      safeMetadata: { providerRef, userId },
    });
  }

  async recordAmlStarted(tenantId: string, userId: string, providerRef: string, screeningType: string): Promise<void> {
    await this.record({
      tenantId,
      userId,
      action: 'AML_SCREENING_STARTED',
      outcome: 'SUCCESS',
      safeMetadata: { providerRef, userId, screeningType },
    });
  }

  async recordAmlClear(tenantId: string, userId: string, providerRef: string): Promise<void> {
    await this.record({
      tenantId,
      userId,
      action: 'AML_CLEAR',
      outcome: 'SUCCESS',
      safeMetadata: { providerRef, userId },
    });
  }

  async recordAmlPotentialMatch(tenantId: string, userId: string, providerRef: string, matchedLists?: string[]): Promise<void> {
    await this.record({
      tenantId,
      userId,
      action: 'AML_POTENTIAL_MATCH',
      outcome: 'SUCCESS',
      safeMetadata: { providerRef, userId, matchedLists: matchedLists?.slice(0, 5) },
    });
  }

  async recordAmlMatch(tenantId: string, userId: string, providerRef: string, matchedLists?: string[]): Promise<void> {
    await this.record({
      tenantId,
      userId,
      action: 'AML_MATCH',
      outcome: 'SUCCESS',
      safeMetadata: { providerRef, userId, matchedLists: matchedLists?.slice(0, 5) },
    });
  }

  async recordAmlBlocked(tenantId: string, userId: string, providerRef: string, reason?: string): Promise<void> {
    await this.record({
      tenantId,
      userId,
      action: 'AML_BLOCKED',
      outcome: 'SUCCESS',
      safeMetadata: { providerRef, userId, reason: reason?.substring(0, 200) },
    });
  }

  async recordRiskScoreCalculated(tenantId: string, userId: string, score: number, riskLevel: string, ruleIds: string[]): Promise<void> {
    await this.record({
      tenantId,
      userId,
      action: 'RISK_SCORE_CALCULATED',
      outcome: 'SUCCESS',
      safeMetadata: { userId, score, riskLevel, ruleIds },
    });
  }

  async recordMonitoringSignal(tenantId: string, userId: string | undefined, signalId: string, ruleId: string, riskLevel: string): Promise<void> {
    await this.record({
      tenantId,
      userId,
      action: 'MONITORING_SIGNAL_CREATED',
      outcome: 'SUCCESS',
      safeMetadata: { signalId, ruleId, riskLevel, userId },
    });
  }

  async recordCaseCreated(tenantId: string, caseId: string, userId: string, caseType: string, actorId?: string): Promise<void> {
    await this.record({
      tenantId,
      caseId,
      userId,
      action: 'COMPLIANCE_CASE_CREATED',
      actorId,
      outcome: 'SUCCESS',
      safeMetadata: { caseId, userId, caseType },
    });
  }

  async recordCaseAssigned(tenantId: string, caseId: string, assignedTo: string, actorId: string): Promise<void> {
    await this.record({
      tenantId,
      caseId,
      action: 'COMPLIANCE_CASE_ASSIGNED',
      actorId,
      outcome: 'SUCCESS',
      safeMetadata: { caseId, assignedTo },
    });
  }

  async recordCaseEscalated(tenantId: string, caseId: string, actorId: string, reason: string): Promise<void> {
    await this.record({
      tenantId,
      caseId,
      action: 'COMPLIANCE_CASE_ESCALATED',
      actorId,
      outcome: 'SUCCESS',
      safeMetadata: { caseId, reason: reason.substring(0, 200) },
    });
  }

  async recordDecision(tenantId: string, caseId: string, decision: string, reviewerId: string, reason: string): Promise<void> {
    await this.record({
      tenantId,
      caseId,
      action: 'COMPLIANCE_DECISION_RECORDED',
      actorId: reviewerId,
      outcome: 'SUCCESS',
      safeMetadata: { caseId, decision, reason: reason.substring(0, 500) },
    });
  }

  async recordHoldRequested(tenantId: string, caseId: string, actorId: string, reason: string): Promise<void> {
    await this.record({
      tenantId,
      caseId,
      action: 'COMPLIANCE_HOLD_REQUESTED',
      actorId,
      outcome: 'SUCCESS',
      safeMetadata: { caseId, reason: reason.substring(0, 500) },
    });
  }

  async recordReleaseRequested(tenantId: string, caseId: string, actorId: string, reason: string): Promise<void> {
    await this.record({
      tenantId,
      caseId,
      action: 'COMPLIANCE_RELEASE_REQUESTED',
      actorId,
      outcome: 'SUCCESS',
      safeMetadata: { caseId, reason: reason.substring(0, 500) },
    });
  }

  async recordReconciliationDetected(tenantId: string, issueId: string, category: string, expected: string, detected: string): Promise<void> {
    await this.record({
      tenantId,
      action: 'COMPLIANCE_RECONCILIATION_DETECTED',
      outcome: 'SUCCESS',
      safeMetadata: { issueId, category, expected, detected },
    });
  }

  async recordReconciliationResolved(tenantId: string, issueId: string, resolverId: string): Promise<void> {
    await this.record({
      tenantId,
      action: 'COMPLIANCE_RECONCILIATION_RESOLVED',
      actorId: resolverId,
      outcome: 'SUCCESS',
      safeMetadata: { issueId },
    });
  }
}

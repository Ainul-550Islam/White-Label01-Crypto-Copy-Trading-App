import { Injectable, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ClientPolicyService } from './client-policy.service';
import { LifecycleAuditService } from './lifecycle-audit.service';
import { deterministicIdempotencyKey, FundingApprovalDecision } from './client-lifecycle.types';

/**
 * Evaluates authorization and workflow prerequisites for funding/withdrawal approvals
 * and delegates actual payment/custody/exchange movement to the authoritative external service.
 */

@Injectable()
export class FundingApprovalService {
  private readonly logger = new Logger(FundingApprovalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: ClientPolicyService,
    private readonly auditService: LifecycleAuditService,
  ) {}

  async approveFundingRequest(params: {
    tenantId: string;
    fundingRequestId?: string | null;
    withdrawalRequestId?: string | null;
    approverId: string;
    isSelfApproval?: boolean;
    reason?: string;
    approvedAmount?: string | null;
    correlationId?: string | null;
  }): Promise<any> {
    const { tenantId, fundingRequestId = null, withdrawalRequestId = null, approverId, isSelfApproval = false, reason, approvedAmount = null, correlationId = null } = params;

    if (!fundingRequestId && !withdrawalRequestId) throw new BadRequestException('Either fundingRequestId or withdrawalRequestId required');

    // Never allow a client to self-approve a privileged workflow
    if (isSelfApproval) {
      throw new ForbiddenException('Client cannot self-approve funding/withdrawal — privileged workflow requires operator approval');
    }

    let request: any = null;
    let requestType = '';

    if (fundingRequestId) {
      request = await (this.prisma as any).fundingRequest.findFirst({ where: { id: fundingRequestId, tenantId } });
      requestType = 'FUNDING';
    } else {
      request = await (this.prisma as any).withdrawalRequest.findFirst({ where: { id: withdrawalRequestId, tenantId } });
      requestType = 'WITHDRAWAL';
    }

    if (!request) throw new BadRequestException(`${requestType} request not found`);

    // Verify approval policy — reuse existing IAM/RBAC
    const policy = await this.policyService.resolvePolicy({ tenantId, accountId: request.accountId, clientProfileId: request.clientProfileId });

    // Check if funding requires approval per policy
    if (requestType === 'FUNDING' && !policy.approvalRequirements.fundingRequiresApproval) {
      // Auto-approval allowed but still needs operator? For safety, still require approver
    }

    const idempotencyKey = deterministicIdempotencyKey({
      type: `funding-approval:${requestType}:${FundingApprovalDecision.APPROVED}`,
      tenantId,
      accountId: request.accountId,
      externalRef: fundingRequestId ?? withdrawalRequestId ?? '',
    });

    try {
      const existing = await (this.prisma as any).fundingApproval.findFirst({ where: { idempotencyKey } });
      if (existing) return existing;
    } catch {}

    const approval = await (this.prisma as any).fundingApproval.create({
      data: {
        tenantId,
        fundingRequestId: fundingRequestId ?? null,
        withdrawalRequestId: withdrawalRequestId ?? null,
        decision: 'APPROVED',
        approverId,
        reason: reason ?? null,
        approvalPolicyVersion: policy.policyVersion,
        evidence: { requestType, approvedAmount: approvedAmount ?? request.requestedAmount, policyVersion: policy.policyVersion },
        idempotencyKey,
        decidedAt: new Date(),
      },
    });

    // Update request state to APPROVED — but not CONFIRMED, actual movement delegated to external service
    try {
      if (fundingRequestId) {
        await (this.prisma as any).fundingRequest.update({
          where: { id: fundingRequestId },
          data: { state: 'APPROVED', approvedAt: new Date(), approvedBy: approverId, approvedAmount: approvedAmount ?? request.requestedAmount },
        });
      } else if (withdrawalRequestId) {
        await (this.prisma as any).withdrawalRequest.update({
          where: { id: withdrawalRequestId },
          data: { state: 'APPROVED', approvedAt: new Date(), approvedBy: approverId, approvedAmount: approvedAmount ?? request.requestedAmount },
        });
      }
    } catch {}

    await this.auditService.log({
      tenantId,
      clientProfileId: request.clientProfileId,
      accountId: request.accountId,
      action: `${requestType}_APPROVED`,
      entityType: 'FUNDING_APPROVAL',
      entityId: approval.id,
      actorId: approverId,
      toState: 'APPROVED',
      reason: reason ?? null,
      correlationId,
      evidence: { requestType, fundingRequestId, withdrawalRequestId, approvedAmount },
    });

    this.logger.log({ event: `client.${requestType.toLowerCase()}.approved`, tenantId, requestId: fundingRequestId ?? withdrawalRequestId, approverId, note: 'Approval is workflow record, not proof of movement — settlement delegated to authoritative external service' });

    return approval;
  }

  async rejectFundingRequest(params: {
    tenantId: string;
    fundingRequestId?: string | null;
    withdrawalRequestId?: string | null;
    approverId: string;
    reason: string;
    correlationId?: string | null;
  }): Promise<any> {
    const { tenantId, fundingRequestId = null, withdrawalRequestId = null, approverId, reason, correlationId = null } = params;

    if (!reason || reason.trim().length < 5) throw new BadRequestException('Rejection reason required');

    let request: any = null;
    let requestType = '';

    if (fundingRequestId) {
      request = await (this.prisma as any).fundingRequest.findFirst({ where: { id: fundingRequestId, tenantId } });
      requestType = 'FUNDING';
    } else {
      request = await (this.prisma as any).withdrawalRequest.findFirst({ where: { id: withdrawalRequestId, tenantId } });
      requestType = 'WITHDRAWAL';
    }

    if (!request) throw new BadRequestException('Request not found');

    const policy = await this.policyService.resolvePolicy({ tenantId, accountId: request.accountId });

    const idempotencyKey = deterministicIdempotencyKey({
      type: `funding-approval:${requestType}:${FundingApprovalDecision.REJECTED}`,
      tenantId,
      accountId: request.accountId,
      externalRef: fundingRequestId ?? withdrawalRequestId ?? '',
    });

    const approval = await (this.prisma as any).fundingApproval.create({
      data: {
        tenantId,
        fundingRequestId: fundingRequestId ?? null,
        withdrawalRequestId: withdrawalRequestId ?? null,
        decision: 'REJECTED',
        approverId,
        reason,
        approvalPolicyVersion: policy.policyVersion,
        idempotencyKey,
        decidedAt: new Date(),
      },
    });

    try {
      if (fundingRequestId) {
        await (this.prisma as any).fundingRequest.update({
          where: { id: fundingRequestId },
          data: { state: 'FAILED', failedAt: new Date(), failureReason: reason },
        });
      } else if (withdrawalRequestId) {
        await (this.prisma as any).withdrawalRequest.update({
          where: { id: withdrawalRequestId },
          data: { state: 'FAILED', failedAt: new Date(), failureReason: reason },
        });
      }
    } catch {}

    await this.auditService.log({
      tenantId,
      clientProfileId: request.clientProfileId,
      accountId: request.accountId,
      action: `${requestType}_REJECTED`,
      entityType: 'FUNDING_APPROVAL',
      entityId: approval.id,
      actorId: approverId,
      toState: 'REJECTED',
      reason,
      correlationId,
      evidence: { requestType, reason },
    });

    return approval;
  }

  async listApprovals(params: {
    tenantId: string;
    fundingRequestId?: string;
    withdrawalRequestId?: string;
    decision?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const { tenantId, fundingRequestId, withdrawalRequestId, decision, page = 1, limit = 50 } = params;
    const where: any = { tenantId };
    if (fundingRequestId) where.fundingRequestId = fundingRequestId;
    if (withdrawalRequestId) where.withdrawalRequestId = withdrawalRequestId;
    if (decision) where.decision = decision;

    try {
      const [data, total] = await Promise.all([
        (this.prisma as any).fundingApproval.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        (this.prisma as any).fundingApproval.count({ where }),
      ]);
      return { data, total, page, limit };
    } catch {
      return { data: [], total: 0, page, limit };
    }
  }
}

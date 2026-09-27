import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LifecycleAuditService } from './lifecycle-audit.service';
import { deterministicIdempotencyKey, ClientReviewType, ClientReviewDecision, redactPiiAndSecrets } from './client-lifecycle.types';

/**
 * Coordinates periodic/manual client-account reviews using Compliance, Risk, Security, Operations,
 * and account activity evidence. Must preserve reviewer identity, decision reason, evidence references,
 * and review timestamp. Do not duplicate KYC/AML or risk scoring algorithms. Reference authoritative decisions.
 */

@Injectable()
export class AccountReviewService {
  private readonly logger = new Logger(AccountReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: LifecycleAuditService,
  ) {}

  async createReview(params: {
    tenantId: string;
    clientProfileId?: string | null;
    accountId?: string | null;
    reviewType: ClientReviewType;
    reviewerId?: string | null;
    reason?: string | null;
    reviewPeriodStart?: Date | null;
    reviewPeriodEnd?: Date | null;
    evidenceReferences?: string[];
    riskSummaryReference?: string | null;
    complianceSummaryReference?: string | null;
    securitySummaryReference?: string | null;
    activitySummary?: any;
    nextReviewDate?: Date | null;
    correlationId?: string | null;
  }): Promise<any> {
    const { tenantId, clientProfileId = null, accountId = null, reviewType, reviewerId = null, reason = null, reviewPeriodStart = null, reviewPeriodEnd = null, evidenceReferences = [], riskSummaryReference = null, complianceSummaryReference = null, securitySummaryReference = null, activitySummary = null, nextReviewDate = null, correlationId = null } = params;

    if (!clientProfileId && !accountId) throw new BadRequestException('Either clientProfileId or accountId required');

    if (clientProfileId) {
      const profile = await (this.prisma as any).clientProfile.findFirst({ where: { id: clientProfileId, tenantId } });
      if (!profile) throw new BadRequestException('Client profile not found');
    }
    if (accountId) {
      const account = await (this.prisma as any).institutionalAccount.findFirst({ where: { id: accountId, tenantId } });
      if (!account) throw new BadRequestException('Account not found');
    }

    const idempotencyKey = deterministicIdempotencyKey({
      type: `client-review:${reviewType}`,
      tenantId,
      clientProfileId: clientProfileId ?? undefined,
      accountId: accountId ?? undefined,
      externalRef: `${reviewType}:${reviewPeriodStart?.toISOString() ?? ''}:${reviewPeriodEnd?.toISOString() ?? ''}`,
    });

    try {
      const existing = await (this.prisma as any).clientReview.findFirst({ where: { idempotencyKey } });
      if (existing) return existing;
    } catch {}

    const review = await (this.prisma as any).clientReview.create({
      data: {
        tenantId,
        clientProfileId: clientProfileId ?? null,
        accountId: accountId ?? null,
        reviewType: reviewType as any,
        decision: 'PENDING',
        reviewerId: reviewerId ?? null,
        reason: reason ?? null,
        evidenceReferences: evidenceReferences as any,
        riskSummaryReference: riskSummaryReference ?? null,
        complianceSummaryReference: complianceSummaryReference ?? null,
        securitySummaryReference: securitySummaryReference ?? null,
        activitySummary: activitySummary ? redactPiiAndSecrets(activitySummary) as any : null,
        reviewPeriodStart: reviewPeriodStart ?? null,
        reviewPeriodEnd: reviewPeriodEnd ?? null,
        nextReviewDate: nextReviewDate ?? null,
        idempotencyKey,
      },
    });

    await this.auditService.log({
      tenantId,
      clientProfileId: clientProfileId ?? null,
      accountId: accountId ?? null,
      action: 'REVIEW_CREATED',
      entityType: 'CLIENT_REVIEW',
      entityId: review.id,
      actorId: reviewerId,
      toState: 'PENDING',
      correlationId,
      evidence: { reviewType, reason, evidenceReferences },
    });

    return review;
  }

  async decideReview(params: {
    tenantId: string;
    reviewId: string;
    decision: ClientReviewDecision;
    reviewerId: string;
    reason: string;
    nextReviewDate?: Date | null;
    correlationId?: string | null;
  }): Promise<any> {
    const { tenantId, reviewId, decision, reviewerId, reason, nextReviewDate = null, correlationId = null } = params;

    if (!reason || reason.trim().length < 5) throw new BadRequestException('Review decision reason required');

    const review = await (this.prisma as any).clientReview.findFirst({ where: { id: reviewId, tenantId } });
    if (!review) throw new BadRequestException('Review not found');

    const updated = await (this.prisma as any).clientReview.update({
      where: { id: reviewId },
      data: {
        decision: decision as any,
        reviewerId,
        reason,
        reviewedAt: new Date(),
        ...(nextReviewDate ? { nextReviewDate } : {}),
      },
    });

    await this.auditService.log({
      tenantId,
      clientProfileId: review.clientProfileId,
      accountId: review.accountId,
      action: 'REVIEW_DECIDED',
      entityType: 'CLIENT_REVIEW',
      entityId: reviewId,
      actorId: reviewerId,
      fromState: review.decision,
      toState: decision as any,
      reason,
      correlationId,
      evidence: { decision, reason, reviewerId, riskSummaryReference: review.riskSummaryReference, complianceSummaryReference: review.complianceSummaryReference },
    });

    this.logger.log({ event: 'client.review.decided', reviewId, decision, reviewerId });

    return updated;
  }

  async listReviews(params: {
    tenantId: string;
    clientProfileId?: string;
    accountId?: string;
    reviewType?: string;
    decision?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const { tenantId, clientProfileId, accountId, reviewType, decision, page = 1, limit = 50 } = params;
    const where: any = { tenantId };
    if (clientProfileId) where.clientProfileId = clientProfileId;
    if (accountId) where.accountId = accountId;
    if (reviewType) where.reviewType = reviewType;
    if (decision) where.decision = decision;

    try {
      const [data, total] = await Promise.all([
        (this.prisma as any).clientReview.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        (this.prisma as any).clientReview.count({ where }),
      ]);
      return { data, total, page, limit };
    } catch {
      return { data: [], total: 0, page, limit };
    }
  }
}

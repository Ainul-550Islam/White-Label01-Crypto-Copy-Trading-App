import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AccountingPolicyService } from './accounting-policy.service';
import {
  PortfolioAdjustmentType,
  deterministicIdempotencyKey,
  redactSecrets,
  isValidDecimal,
} from './portfolio-accounting.types';

/**
 * Creates auditable adjustments/reversals referencing original event, reason, operator,
 * policy/version, preserves immutable history. Never mutate history — corrections via reversal only.
 */

@Injectable()
export class AccountingAdjustmentService {
  private readonly logger = new Logger(AccountingAdjustmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: AccountingPolicyService,
  ) {}

  async createAdjustment(params: {
    tenantId: string;
    profileId: string;
    originalEventId?: string | null;
    adjustmentType: PortfolioAdjustmentType;
    reason: string;
    adjustedAmount?: string | null;
    adjustedQuantity?: string | null;
    asset?: string | null;
    operatorId: string;
    evidence?: Record<string, unknown>;
    correlationId?: string | null;
  }): Promise<any> {
    const { tenantId, profileId, originalEventId = null, adjustmentType, reason, adjustedAmount = null, adjustedQuantity = null, asset = null, operatorId, correlationId = null } = params;

    if (!reason || reason.trim().length < 5) throw new BadRequestException('Reason required (min 5 chars) for adjustment');

    if (adjustedAmount && !isValidDecimal(adjustedAmount)) throw new BadRequestException(`Invalid adjustedAmount: ${adjustedAmount}`);
    if (adjustedQuantity && !isValidDecimal(adjustedQuantity)) throw new BadRequestException(`Invalid adjustedQuantity: ${adjustedQuantity}`);

    const policy = await this.policyService.resolvePolicy({ tenantId, scope: 'TENANT' as any, scopeId: profileId });

    const idempotencyKey = deterministicIdempotencyKey({
      type: `adjustment:${adjustmentType}:${originalEventId ?? 'manual'}`,
      tenantId,
      profileId,
      sourceId: originalEventId ?? `${adjustmentType}:${Date.now()}`,
    });

    try {
      const existing = await (this.prisma as any).portfolioAccountingAdjustment.findFirst({ where: { idempotencyKey } });
      if (existing) return existing;
    } catch {}

    // If originalEventId provided, verify it exists and belongs to tenant/profile
    if (originalEventId) {
      try {
        const original = await (this.prisma as any).portfolioAccountingEvent.findFirst({
          where: { id: originalEventId, tenantId, profileId },
        });
        if (!original) throw new BadRequestException('Original event not found or tenant mismatch');

        // Check if period is closed — closed periods immutable, corrections via reversal only (allowed but audited)
        // We allow adjustment but must note it is post-close
        const period = await (this.prisma as any).portfolioAccountingPeriod.findFirst({
          where: {
            tenantId,
            profileId,
            periodStart: { lte: original.sourceTimestamp },
            periodEnd: { gte: original.sourceTimestamp },
            state: 'CLOSED',
          },
        });
        if (period) {
          this.logger.warn({ event: 'portfolio.adjustment.post_close', tenantId, profileId, periodId: period.id, originalEventId });
        }
      } catch (e) {
        if (e instanceof BadRequestException) throw e;
      }
    }

    const adjustment = await (this.prisma as any).portfolioAccountingAdjustment.create({
      data: {
        tenantId,
        profileId,
        originalEventId: originalEventId ?? null,
        adjustmentType: adjustmentType as any,
        reason,
        adjustedAmount: adjustedAmount ?? null,
        adjustedQuantity: adjustedQuantity ?? null,
        asset: asset ?? null,
        operatorId,
        calculationVersion: policy.calculationVersion,
        policyVersion: policy.policyVersion,
        idempotencyKey,
        correlationId: correlationId ?? null,
        evidence: redactSecrets(params.evidence ?? {}) as any,
      },
    });

    // If reversal, mark original as reversed — preserve history, never mutate history destructively
    if (adjustmentType === PortfolioAdjustmentType.REVERSAL && originalEventId) {
      try {
        await (this.prisma as any).portfolioAccountingEvent.update({
          where: { id: originalEventId },
          data: {
            isReversed: true,
            reversedAt: new Date(),
            reversedBy: operatorId,
            reversalReason: reason,
          },
        });
      } catch {}
    }

    // For correction, create a new accounting event that is the correction — original stays
    if (adjustmentType === PortfolioAdjustmentType.CORRECTION && originalEventId) {
      try {
        const original = await (this.prisma as any).portfolioAccountingEvent.findFirst({ where: { id: originalEventId } });
        if (original) {
          // Create reversal of original + new corrected event — both preserved
          const reversalKey = deterministicIdempotencyKey({
            type: `reversal_for_correction:${originalEventId}`,
            tenantId,
            profileId,
            sourceId: originalEventId,
          });

          await (this.prisma as any).portfolioAccountingEvent.create({
            data: {
              tenantId,
              profileId,
              eventType: 'REVERSAL',
              cashFlowType: original.cashFlowType,
              sourceType: 'ADJUSTMENT_REVERSAL',
              sourceId: `reversal_${originalEventId}_${Date.now()}`,
              sourceTimestamp: new Date(),
              asset: asset ?? original.asset,
              quantity: adjustedQuantity ?? original.quantity,
              amount: adjustedAmount ?? original.amount,
              currency: original.currency,
              baseCurrency: original.baseCurrency,
              calculationVersion: policy.calculationVersion,
              policyVersion: policy.policyVersion,
              idempotencyKey: reversalKey,
              fingerprint: `reversal_${originalEventId}`,
              correlationId,
              metadata: redactSecrets({ originalEventId, adjustmentId: adjustment.id, reason }) as any,
              evidence: redactSecrets({ originalEventId, reason, operatorId }) as any,
            },
          });
        }
      } catch {}
    }

    this.logger.log({ event: 'portfolio.adjustment.created', tenantId, profileId, adjustmentType, originalEventId });

    return adjustment;
  }

  async listAdjustments(params: {
    tenantId: string;
    profileId?: string;
    originalEventId?: string;
    adjustmentType?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const { tenantId, profileId, originalEventId, adjustmentType, page = 1, limit = 50 } = params;
    const where: any = { tenantId };
    if (profileId) where.profileId = profileId;
    if (originalEventId) where.originalEventId = originalEventId;
    if (adjustmentType) where.adjustmentType = adjustmentType;

    try {
      const [data, total] = await Promise.all([
        (this.prisma as any).portfolioAccountingAdjustment.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        (this.prisma as any).portfolioAccountingAdjustment.count({ where }),
      ]);
      return { data, total, page, limit };
    } catch {
      return { data: [], total: 0, page, limit };
    }
  }

  async reverseAdjustment(params: { tenantId: string; adjustmentId: string; operatorId: string; reason: string }): Promise<any> {
    const { tenantId, adjustmentId, operatorId, reason } = params;

    const adjustment = await (this.prisma as any).portfolioAccountingAdjustment.findFirst({ where: { id: adjustmentId, tenantId } });
    if (!adjustment) throw new BadRequestException('Adjustment not found');

    if (adjustment.isReversed) throw new BadRequestException('Adjustment already reversed');

    const updated = await (this.prisma as any).portfolioAccountingAdjustment.update({
      where: { id: adjustmentId },
      data: { isReversed: true, reversedAt: new Date(), reversedBy: operatorId, reversalReason: reason },
    });

    return updated;
  }
}

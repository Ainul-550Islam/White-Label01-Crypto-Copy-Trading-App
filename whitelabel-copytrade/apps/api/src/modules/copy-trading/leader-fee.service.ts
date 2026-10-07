// # Responsibility: maintains tenant-scoped, versioned lead-trader fee disclosures and exact, preview-only HWM arithmetic.
// # Safety: this service does not accept client PnL, create fee accruals, post ledger entries, or trigger payouts.

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditActorType, AuditOutcome } from '@wlct/shared-types';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { DECIMAL_FACTOR, formatDecimalString, parseDecimalString } from '../../common/decimal-string';
import { AuditService } from '../audit/audit.service';
import { FeePolicyService } from '../billing/fees/fee-policy.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SetLeaderFeePolicyDto } from './dto/leader-fee.dto';

const LEADER_FEE_POLICY_SELECT = {
  id: true,
  traderId: true,
  currency: true,
  profitShareBps: true,
  highWaterMarkScope: true,
  version: true,
  effectiveFrom: true,
  effectiveTo: true,
  createdAt: true,
} satisfies Prisma.LeaderFeePolicySelect;

type LeaderFeePolicyView = Prisma.LeaderFeePolicyGetPayload<{ select: typeof LEADER_FEE_POLICY_SELECT }>;
type PolicyWriteResult = { policy: LeaderFeePolicyView; created: boolean; previous: LeaderFeePolicyView | null };

export interface LeaderFeeCalculationPreview {
  currency: string;
  cumulativeRealizedProfit: string;
  openingHighWaterMark: string;
  eligibleProfitAboveHighWaterMark: string;
  closingHighWaterMark: string;
  profitShareBps: number;
  feeAmount: string;
  calculationVersion: 'leader-fee-hwm-v1-integer-decimal';
  status: 'PREVIEW_ONLY';
}

/**
 * Exact, side-effect-free calculation. Inputs are intended for internal tests or
 * a future source-verified accounting adapter; no controller accepts them.
 */
export function calculateLeaderFeePreview(params: {
  currency: string;
  cumulativeRealizedProfit: string;
  openingHighWaterMark: string;
  profitShareBps: number;
}): LeaderFeeCalculationPreview {
  const currency = params.currency.trim().toUpperCase();
  if (!/^[A-Z]{3,4}$/.test(currency)) throw new BadRequestException('Unsupported fee currency.');
  if (!Number.isInteger(params.profitShareBps) || params.profitShareBps < 0 || params.profitShareBps > 10000) {
    throw new BadRequestException('Profit-share basis points must be an integer from 0 through 10000.');
  }

  const minorUnits = currencyMinorUnits(currency);
  const cumulativeRealizedProfit = parseDecimalString(params.cumulativeRealizedProfit);
  const openingHighWaterMark = parseDecimalString(params.openingHighWaterMark);
  if (openingHighWaterMark < 0n) throw new BadRequestException('High-water mark cannot be negative.');

  const eligible = cumulativeRealizedProfit > openingHighWaterMark
    ? cumulativeRealizedProfit - openingHighWaterMark
    : 0n;
  const closingHighWaterMark = cumulativeRealizedProfit > openingHighWaterMark
    ? cumulativeRealizedProfit
    : openingHighWaterMark;
  const feeAmount = formatMinorUnits(
    roundedFeeMinorUnits(eligible, params.profitShareBps, minorUnits),
    minorUnits,
  );

  return {
    currency,
    cumulativeRealizedProfit: formatDecimalString(cumulativeRealizedProfit, 12),
    openingHighWaterMark: formatDecimalString(openingHighWaterMark, 12),
    eligibleProfitAboveHighWaterMark: formatDecimalString(eligible, 12),
    closingHighWaterMark: formatDecimalString(closingHighWaterMark, 12),
    profitShareBps: params.profitShareBps,
    feeAmount,
    calculationVersion: 'leader-fee-hwm-v1-integer-decimal',
    status: 'PREVIEW_ONLY',
  };
}

@Injectable()
export class LeaderFeeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly feePolicyService: FeePolicyService,
  ) {}

  /** Public, tenant-scoped view; only a verified, public trader's effective rate is exposed. */
  async getPublicPolicy(tenantId: string, traderId: string, currency: string, at = new Date()) {
    const normalizedCurrency = this.normalizeCurrency(currency);
    const trader = await this.prisma.traderProfile.findFirst({
      where: { id: traderId, tenantId, deletedAt: null, isPublic: true, verificationState: 'VERIFIED' },
      select: { id: true },
    });
    if (!trader) throw new NotFoundException('Trader fee policy not found.');

    const policy = await this.prisma.leaderFeePolicy.findFirst({
      where: {
        tenantId,
        traderId,
        currency: normalizedCurrency,
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      },
      orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
      select: LEADER_FEE_POLICY_SELECT,
    });

    return {
      traderId,
      currency: normalizedCurrency,
      policy,
      status: policy ? 'AVAILABLE' as const : 'UNCONFIGURED' as const,
      feeCalculation: {
        status: 'UNAVAILABLE' as const,
        reason: 'A verified, reconciled, posted follower-profit source and settlement integration are not connected to this fee disclosure.',
      },
    };
  }

  /** Tenant-operator view of the immutable policy version history. */
  async listPolicyHistory(tenantId: string, traderId: string, currency: string): Promise<LeaderFeePolicyView[]> {
    const normalizedCurrency = this.normalizeCurrency(currency);
    const trader = await this.prisma.traderProfile.findFirst({
      where: { id: traderId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!trader) throw new NotFoundException('Trader profile not found.');

    return this.prisma.leaderFeePolicy.findMany({
      where: { tenantId, traderId, currency: normalizedCurrency },
      orderBy: [{ version: 'desc' }],
      take: 100,
      select: LEADER_FEE_POLICY_SELECT,
    });
  }

  /**
   * Tenant-admin write path. Each change creates a version, closes the prior
   * effective interval, checks the tenant's canonical performance-fee ceiling,
   * and is auditable/idempotent. It never creates a charge or payout.
   */
  async setPolicy(tenantId: string, traderId: string, actorUserId: string, input: SetLeaderFeePolicyDto): Promise<LeaderFeePolicyView> {
    if (!tenantId || !traderId || !actorUserId) throw new BadRequestException('Authenticated tenant, trader, and operator context are required.');
    const currency = this.normalizeCurrency(input.currency);
    const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : new Date();
    if (!Number.isFinite(effectiveFrom.getTime())) throw new BadRequestException('A valid policy effective date is required.');
    const fingerprintInput = {
      currency,
      profitShareBps: input.profitShareBps,
      highWaterMarkScope: input.highWaterMarkScope,
      effectiveFrom: input.effectiveFrom ? effectiveFrom.toISOString() : null,
    };
    const requestFingerprint = createHash('sha256').update(JSON.stringify(fingerprintInput)).digest('hex');
    const existingReplay = await this.prisma.leaderFeePolicy.findFirst({
      where: { tenantId, idempotencyKey: input.idempotencyKey },
      select: { ...LEADER_FEE_POLICY_SELECT, requestFingerprint: true },
    });
    if (existingReplay) {
      if (existingReplay.traderId !== traderId || existingReplay.requestFingerprint !== requestFingerprint) {
        throw new ConflictException('The idempotency key was already used for a different fee-policy request.');
      }
      return policyView(existingReplay);
    }

    const canonicalFeePolicy = await this.feePolicyService.resolvePerformanceFeePolicy(tenantId, currency);
    const maximumShareBps = canonicalFeePolicy.performanceFeeBps;
    if (!Number.isInteger(maximumShareBps) || maximumShareBps < 0 || maximumShareBps > 10000) {
      throw new ConflictException('The canonical tenant performance-fee ceiling is invalid; policy changes are blocked.');
    }
    if (input.profitShareBps > maximumShareBps) {
      throw new ConflictException('The requested lead-trader share exceeds the canonical tenant performance-fee ceiling.');
    }

    let result: PolicyWriteResult;
    try {
      result = await this.prisma.$transaction(async (transaction) => {
        const replay = await transaction.leaderFeePolicy.findFirst({
          where: { tenantId, idempotencyKey: input.idempotencyKey },
          select: { ...LEADER_FEE_POLICY_SELECT, requestFingerprint: true },
        });
        if (replay) {
          if (replay.traderId !== traderId || replay.requestFingerprint !== requestFingerprint) {
            throw new ConflictException('The idempotency key was already used for a different fee-policy request.');
          }
          return { policy: policyView(replay), created: false, previous: null };
        }

        const [trader, operator] = await Promise.all([
          transaction.traderProfile.findFirst({
            where: { id: traderId, tenantId, deletedAt: null },
            select: { id: true, verificationState: true },
          }),
          transaction.user.findFirst({
            where: { id: actorUserId, tenantId, deletedAt: null },
            select: { id: true },
          }),
        ]);
        if (!operator) throw new ForbiddenException('The fee-policy operator does not belong to this tenant.');
        if (!trader) throw new NotFoundException('Trader profile not found in this tenant.');
        if (trader.verificationState !== 'VERIFIED') {
          throw new ConflictException('A fee policy can be published only for a verified lead trader.');
        }
        if (effectiveFrom.getTime() < Date.now()) {
          throw new BadRequestException('Fee policies cannot be backdated.');
        }

        const previous = await transaction.leaderFeePolicy.findFirst({
          where: { tenantId, traderId, currency },
          orderBy: [{ version: 'desc' }],
          select: LEADER_FEE_POLICY_SELECT,
        });
        if (previous && effectiveFrom.getTime() <= previous.effectiveFrom.getTime()) {
          throw new ConflictException('A fee-policy version must start after the latest version.');
        }

        const version = (previous?.version ?? 0) + 1;
        if (previous && (!previous.effectiveTo || previous.effectiveTo.getTime() > effectiveFrom.getTime())) {
          const closed = await transaction.leaderFeePolicy.updateMany({
            where: { id: previous.id, tenantId, effectiveTo: previous.effectiveTo },
            data: { effectiveTo: effectiveFrom },
          });
          if (closed.count !== 1) throw new ConflictException('The fee policy changed concurrently; refresh before retrying.');
        }

        const created = await transaction.leaderFeePolicy.create({
          data: {
            tenantId,
            traderId,
            currency,
            profitShareBps: input.profitShareBps,
            maximumShareBpsAtCreation: maximumShareBps,
            feePolicySource: canonicalFeePolicy.source,
            feePolicyReference: canonicalFeePolicy.planId ?? canonicalFeePolicy.planCode,
            highWaterMarkScope: input.highWaterMarkScope,
            version,
            effectiveFrom,
            createdByUserId: actorUserId,
            requestFingerprint,
            idempotencyKey: input.idempotencyKey,
          },
          select: LEADER_FEE_POLICY_SELECT,
        });
        return { policy: created, created: true, previous };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (this.isUniqueConstraintError(error) || this.isSerializationError(error)) {
        const committedReplay = await this.prisma.leaderFeePolicy.findFirst({
          where: { tenantId, idempotencyKey: input.idempotencyKey },
          select: { ...LEADER_FEE_POLICY_SELECT, requestFingerprint: true },
        });
        if (
          committedReplay
          && committedReplay.traderId === traderId
          && committedReplay.requestFingerprint === requestFingerprint
        ) {
          return policyView(committedReplay);
        }
        throw new ConflictException('The fee policy changed concurrently. Refresh and review the current policy.');
      }
      throw error;
    }

    if (result.created) {
      await this.auditService.recordImmediate({
        tenantId,
        actorType: AuditActorType.USER,
        actorId: actorUserId,
        action: 'LEAD_TRADER_FEE_POLICY_VERSION_CREATED',
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'LEADER_FEE_POLICY',
        resourceId: result.policy.id,
        description: 'A versioned lead-trader fee disclosure was created.',
        changes: {
          profitShareBps: {
            before: result.previous?.profitShareBps ?? null,
            after: result.policy.profitShareBps,
          },
          highWaterMarkScope: {
            before: result.previous?.highWaterMarkScope ?? null,
            after: result.policy.highWaterMarkScope,
          },
          version: {
            before: result.previous?.version ?? null,
            after: result.policy.version,
          },
          effectiveFrom: {
            before: result.previous?.effectiveFrom.toISOString() ?? null,
            after: result.policy.effectiveFrom.toISOString(),
          },
          effectiveTo: {
            before: result.previous?.effectiveTo?.toISOString() ?? null,
            after: result.previous ? effectiveFrom.toISOString() : null,
          },
        },
        metadata: {
          requestFingerprint,
          idempotencyKey: input.idempotencyKey,
          previousPolicyId: result.previous?.id ?? null,
          currentPolicyId: result.policy.id,
          currency: result.policy.currency,
          maximumShareBpsAtCreation: maximumShareBps,
          canonicalFeePolicySource: canonicalFeePolicy.source,
          canonicalFeePolicyReference: canonicalFeePolicy.planId ?? canonicalFeePolicy.planCode,
        },
      });
    }
    return result.policy;
  }

  private normalizeCurrency(currency: string): string {
    const normalized = currency.trim().toUpperCase();
    if (!/^(USD|EUR|GBP|JPY|CAD|AUD|BTC|ETH|USDT|USDC)$/.test(normalized)) {
      throw new BadRequestException('Unsupported fee currency.');
    }
    return normalized;
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  private isSerializationError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
  }
}

function policyView(policy: LeaderFeePolicyView): LeaderFeePolicyView {
  return {
    id: policy.id,
    traderId: policy.traderId,
    currency: policy.currency,
    profitShareBps: policy.profitShareBps,
    highWaterMarkScope: policy.highWaterMarkScope,
    version: policy.version,
    effectiveFrom: policy.effectiveFrom,
    effectiveTo: policy.effectiveTo,
    createdAt: policy.createdAt,
  };
}

function currencyMinorUnits(currency: string): number {
  const minorUnits: Record<string, number> = {
    USD: 2, EUR: 2, GBP: 2, JPY: 0, CAD: 2, AUD: 2,
    BTC: 8, ETH: 12, USDT: 6, USDC: 6,
  };
  const precision = minorUnits[currency];
  if (precision === undefined) throw new BadRequestException('Unsupported fee currency.');
  return precision;
}

function roundedFeeMinorUnits(eligibleProfitScaled: bigint, profitShareBps: number, minorUnits: number): bigint {
  if (eligibleProfitScaled <= 0n || profitShareBps === 0) return 0n;
  const scale = 10n ** BigInt(minorUnits);
  const numerator = eligibleProfitScaled * BigInt(profitShareBps) * scale;
  const denominator = DECIMAL_FACTOR * 10000n;
  return (numerator + denominator / 2n) / denominator;
}

function formatMinorUnits(value: bigint, minorUnits: number): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const scale = 10n ** BigInt(minorUnits);
  const whole = absolute / scale;
  if (minorUnits === 0) return `${negative && absolute !== 0n ? '-' : ''}${whole.toString()}`;
  const fraction = (absolute % scale).toString().padStart(minorUnits, '0');
  return `${negative && absolute !== 0n ? '-' : ''}${whole.toString()}.${fraction}`;
}

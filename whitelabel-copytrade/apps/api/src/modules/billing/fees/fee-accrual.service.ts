import { Injectable, Logger } from '@nestjs/common';
import { FeeAccrualRepository } from './fee-accrual.repository';
import { FeePolicyService } from './fee-policy.service';
import { FeeCalculatorService } from './fee-calculator.service';
import { FeeLedgerService } from './fee-ledger.service';
import { FeeAuditService } from './fee-audit.service';
import { FeeType, FeeSourceType, RateBasis, FeeAccrualStatus, SettlementState, FeeAccrual } from './fee.types';
import { randomUUID } from 'crypto';

/**
 * Creates immutable fee accruals from eligible commercial/trading events.
 * Reuses existing trading/performance source of truth - does NOT invent new PnL engine.
 * Idempotent via source + feeType + idempotencyKey.
 */
@Injectable()
export class FeeAccrualService {
  private readonly logger = new Logger(FeeAccrualService.name);

  constructor(
    private readonly accrualRepository: FeeAccrualRepository,
    private readonly policyService: FeePolicyService,
    private readonly calculatorService: FeeCalculatorService,
    private readonly ledgerService: FeeLedgerService,
    private readonly auditService: FeeAuditService,
  ) {}

  async accrueFee(params: {
    tenantId: string;
    sourceType: FeeSourceType;
    sourceId: string;
    feeType: FeeType;
    grossAmount: string;
    currency: string;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
    minimumFee?: string | null;
    maximumCap?: string | null;
    actorId?: string;
  }): Promise<FeeAccrual> {
    const idempotencyKey = params.idempotencyKey || this.generateIdempotencyKey(params.tenantId, params.sourceType, params.sourceId, params.feeType);

    // Idempotency check
    const existingByKey = await this.accrualRepository.findByIdempotencyKey(idempotencyKey);
    if (existingByKey) {
      this.logger.log(`Idempotent accrual hit by idempotencyKey: ${idempotencyKey}`);
      return existingByKey;
    }

    const existingBySource = await this.accrualRepository.findBySource(params.tenantId, params.sourceType, params.sourceId, params.feeType);
    if (existingBySource) {
      this.logger.log(`Idempotent accrual hit by source: ${params.sourceType}:${params.sourceId} feeType=${params.feeType}`);
      return existingBySource;
    }

    // Resolve canonical fee policy
    let policy: any;
    try {
      policy = await this.policyService.resolvePolicy(params.tenantId, params.feeType, params.currency);
    } catch (e) {
      await this.auditService.logAccrualRejected(params.tenantId, params.sourceId, params.sourceType, params.feeType, `Policy resolve failed: ${(e as Error).message}`);
      throw e;
    }

    const effectiveBps = params.feeType === FeeType.PLATFORM_FEE ? policy.platformFeeBps : policy.performanceFeeBps;

    // If effective rate is 0, still accrue with 0 fee for audit trail, or skip? We accrue 0 for completeness
    // But if rate is 0, we can still create accrual with 0 fee
    let calculation: any;
    try {
      calculation = this.calculatorService.calculate({
        tenantId: params.tenantId,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        feeType: params.feeType,
        grossAmount: params.grossAmount,
        currency: params.currency,
        feeRateBps: effectiveBps,
        minimumFee: params.minimumFee || policy.minimumFee,
        maximumCap: params.maximumCap || policy.maximumCap,
        idempotencyKey,
        metadata: params.metadata,
      });
    } catch (e) {
      await this.auditService.logAccrualRejected(params.tenantId, params.sourceId, params.sourceType, params.feeType, `Calculation failed: ${(e as Error).message}`);
      throw e;
    }

    await this.auditService.logFeeCalculated(params.tenantId, params.sourceId, params.feeType, calculation.feeAmount, params.currency, effectiveBps);

    // Create accrual
    const accrual = await this.accrualRepository.create({
      tenantId: params.tenantId,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      feeType: params.feeType,
      feeRateBps: effectiveBps,
      rateBasis: RateBasis.BPS,
      grossAmount: calculation.grossAmount,
      feeAmount: calculation.feeAmount,
      netAmount: calculation.netAmount,
      currency: calculation.currency,
      status: FeeAccrualStatus.ACCRUED,
      settlementState: SettlementState.DRAFT,
      payoutState: null,
      settlementId: null,
      payoutId: null,
      ledgerTransactionId: null,
      idempotencyKey,
      policySnapshot: policy,
      calculationTimestamp: calculation.calculatedAt,
      metadata: params.metadata || null,
      safeMetadata: this.sanitizeSafeMetadata(params.metadata),
    });

    await this.auditService.logFeeAccrued(params.tenantId, accrual.id, params.feeType, calculation.feeAmount, params.currency, params.sourceId);

    // Post to existing billing ledger
    try {
      const ledgerResult = await this.ledgerService.postAccrualToLedger(accrual);
      if (ledgerResult && ledgerResult.length > 0) {
        const txId = (ledgerResult[0] as any).id || ledgerResult[0].sourceId || null;
        // Update accrual with ledger reference if needed
        if (txId) {
          await this.accrualRepository.updateStatus(accrual.id, {
            ledgerTransactionId: txId,
          });
        }
      }
    } catch (e) {
      this.logger.warn(`Failed to post accrual ${accrual.id} to ledger: ${(e as Error).message}`);
      // Do not fail accrual creation if ledger posting fails - reconciliation will detect
      await this.auditService.logLedgerPostingFailed(params.tenantId, accrual.id, (e as Error).message);
    }

    this.logger.log(`Fee accrued tenant=${params.tenantId} accrual=${accrual.id} feeType=${params.feeType} fee=${calculation.feeAmount} gross=${calculation.grossAmount} bps=${effectiveBps}`);

    return accrual;
  }

  async accrueFromPayment(params: {
    tenantId: string;
    paymentId: string;
    grossAmount: string;
    currency: string;
    feeType?: FeeType;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
    actorId?: string;
  }): Promise<FeeAccrual> {
    // Platform fee from successful payment revenue
    return this.accrueFee({
      tenantId: params.tenantId,
      sourceType: FeeSourceType.PAYMENT,
      sourceId: params.paymentId,
      feeType: params.feeType || FeeType.PLATFORM_FEE,
      grossAmount: params.grossAmount,
      currency: params.currency,
      idempotencyKey: params.idempotencyKey || `fee_payment_${params.paymentId}_${params.feeType || FeeType.PLATFORM_FEE}`,
      metadata: params.metadata,
      actorId: params.actorId,
    });
  }

  async accrueFromTradingPerformance(params: {
    tenantId: string;
    performanceSourceId: string;
    grossPerformanceAmount: string;
    currency: string;
    traderId?: string;
    followerId?: string;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
    actorId?: string;
  }): Promise<FeeAccrual> {
    // Performance fee from validated trading performance
    // Source amount must come from existing trading performance calculation, not client
    return this.accrueFee({
      tenantId: params.tenantId,
      sourceType: FeeSourceType.TRADING_PERFORMANCE,
      sourceId: params.performanceSourceId,
      feeType: FeeType.PERFORMANCE_FEE,
      grossAmount: params.grossPerformanceAmount,
      currency: params.currency,
      idempotencyKey: params.idempotencyKey || `fee_perf_${params.performanceSourceId}_${params.traderId || 'unknown'}`,
      metadata: {
        traderId: params.traderId,
        followerId: params.followerId,
        ...params.metadata,
      },
      actorId: params.actorId,
    });
  }

  async accrueFromCopyTradingSettlement(params: {
    tenantId: string;
    settlementSourceId: string;
    grossAmount: string;
    currency: string;
    feeType: FeeType;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
    actorId?: string;
  }): Promise<FeeAccrual> {
    return this.accrueFee({
      tenantId: params.tenantId,
      sourceType: FeeSourceType.COPY_TRADING_SETTLEMENT,
      sourceId: params.settlementSourceId,
      feeType: params.feeType,
      grossAmount: params.grossAmount,
      currency: params.currency,
      idempotencyKey: params.idempotencyKey || `fee_copy_${params.settlementSourceId}_${params.feeType}`,
      metadata: params.metadata,
      actorId: params.actorId,
    });
  }

  async getAccrual(id: string, tenantId?: string): Promise<FeeAccrual | null> {
    return this.accrualRepository.findById(id, tenantId);
  }

  async listAccruals(
    tenantId: string,
    filter?: {
      feeType?: FeeType;
      sourceType?: FeeSourceType;
      status?: FeeAccrualStatus;
      settlementState?: SettlementState;
      currency?: string;
      fromDate?: Date;
      toDate?: Date;
      limit?: number;
      offset?: number;
    },
  ): Promise<FeeAccrual[]> {
    return this.accrualRepository.listByTenant(tenantId, filter);
  }

  private generateIdempotencyKey(tenantId: string, sourceType: FeeSourceType, sourceId: string, feeType: FeeType): string {
    return `fee_${tenantId}_${sourceType}_${sourceId}_${feeType}`;
  }

  private sanitizeSafeMetadata(metadata?: Record<string, unknown> | null): Record<string, unknown> | null {
    if (!metadata) return null;
    const forbidden = ['secret', 'apiKey', 'privateKey', 'accessToken', 'password', 'exchangeSecret', 'providerSecret', 'bankAccount', 'walletKey', 'private_key', 'credentials'];
    const safe: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(metadata)) {
      const lowerKey = key.toLowerCase();
      if (forbidden.some((f) => lowerKey.includes(f.toLowerCase()))) {
        safe[key] = '[REDACTED]';
      } else {
        safe[key] = value;
      }
    }
    return safe;
  }
}

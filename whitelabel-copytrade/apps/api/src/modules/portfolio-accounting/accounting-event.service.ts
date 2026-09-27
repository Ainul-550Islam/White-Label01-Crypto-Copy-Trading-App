import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AccountingEventRepository } from './accounting-event.repository';
import { AccountingPolicyService } from './accounting-policy.service';
import {
  PortfolioCashFlowType,
  deterministicIdempotencyKey,
  redactSecrets,
  CALCULATION_VERSION,
  parseScaled,
  formatScaled,
  SCALE_FACTOR,
} from './portfolio-accounting.types';

/**
 * Converts authoritative OMS fills, trade lifecycle events, balances, positions, fees,
 * deposits, withdrawals, transfers, and copy allocations into normalized immutable
 * accounting events. Every event must preserve sourceType/sourceId/sourceTimestamp
 * and deterministic idempotency.
 *
 * Source-of-truth rules enforced:
 * - Exchange balance = authoritative for exchange balance truth (we reference, not overwrite)
 * - Exchange position / existing position service = authoritative for live position state
 * - OMS fill = authoritative execution event
 * - Fees module = authoritative platform/performance fee accounting
 * - Finance ledger = authoritative billing/financial ledger
 * - Portfolio Accounting = authoritative accounting/reporting interpretation
 */

@Injectable()
export class AccountingEventService {
  private readonly logger = new Logger(AccountingEventService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventRepo: AccountingEventRepository,
    private readonly policyService: AccountingPolicyService,
  ) {}

  async ingestFromOmsFill(params: {
    tenantId: string;
    profileId: string;
    fill: any;
    correlationId?: string | null;
  }): Promise<any> {
    const { tenantId, profileId, fill, correlationId = null } = params;

    if (!fill) throw new BadRequestException('Fill required');
    // Authoritative OMS fill is used as source — must have providerFillId, qty, price, timestamp
    const sourceType = 'OMS_FILL';
    const sourceId = fill.providerFillId ?? fill.id ?? fill.fillId;
    if (!sourceId) throw new BadRequestException('Fill missing providerFillId');

    const quantity = fill.quantity?.toString() ?? fill.qty?.toString();
    const price = fill.price?.toString();
    const fee = fill.fee?.toString() ?? '0';
    const symbol = fill.symbol;
    const side = fill.side;

    const policy = await this.policyService.resolvePolicy({ tenantId, scope: 'TENANT' as any, scopeId: profileId });

    const idempotencyKey = deterministicIdempotencyKey({
      type: `accounting:${sourceType}`,
      tenantId,
      profileId,
      sourceId,
      timestampBucket: new Date(fill.timestampMicros ? Number(fill.timestampMicros) / 1000 : Date.now()).toISOString().slice(0, 10),
    });

    const cashFlowType = side === 'BUY' ? PortfolioCashFlowType.TRADE_SETTLEMENT_BUY : PortfolioCashFlowType.TRADE_SETTLEMENT_SELL;

    const amount = this.calculateTradeAmount(quantity, price);

    const event = await this.eventRepo.createEvent({
      tenantId,
      profileId,
      eventType: 'TRADE_FILL',
      cashFlowType: cashFlowType as any,
      sourceType,
      sourceId,
      sourceTimestamp: fill.timestampMicros ? new Date(Number(fill.timestampMicros) / 1000) : fill.createdAt ? new Date(fill.createdAt) : new Date(),
      asset: symbol,
      quantity,
      price,
      amount,
      feeAmount: fee,
      currency: fill.feeCurrency ?? 'USDT',
      orderId: fill.orderIntentId ?? fill.orderId ?? null,
      fillId: sourceId,
      baseCurrency: policy.baseCurrency,
      calculationVersion: policy.calculationVersion,
      policyVersion: policy.policyVersion,
      idempotencyKey,
      correlationId,
      metadata: redactSecrets({ symbol, side, venue: fill.venue }) as any,
      evidence: redactSecrets({
        providerFillId: fill.providerFillId,
        providerOrderId: fill.providerOrderId,
        quantity,
        price,
        fee,
        timestamp: fill.timestampMicros,
        source: 'OMS_FILL authoritative',
      }) as any,
    });

    this.logger.log({ event: 'portfolio.event.ingested_fill', tenantId, profileId, sourceId, idempotencyKey });
    return event;
  }

  async ingestFromFeeAccrual(params: {
    tenantId: string;
    profileId: string;
    feeAccrual: any;
    correlationId?: string | null;
  }): Promise<any> {
    const { tenantId, profileId, feeAccrual, correlationId = null } = params;

    if (!feeAccrual) throw new BadRequestException('Fee accrual required');
    // Authoritative fee record is not duplicated — we reference it, not duplicate calculation
    const sourceType = 'FEE_ACCRUAL';
    const sourceId = feeAccrual.id;

    const policy = await this.policyService.resolvePolicy({ tenantId, scope: 'TENANT' as any, scopeId: profileId });

    const idempotencyKey = deterministicIdempotencyKey({
      type: `accounting:${sourceType}`,
      tenantId,
      profileId,
      sourceId,
    });

    const cashFlowType = feeAccrual.feeType === 'PERFORMANCE' ? PortfolioCashFlowType.PERFORMANCE_FEE : PortfolioCashFlowType.PLATFORM_FEE;

    const event = await this.eventRepo.createEvent({
      tenantId,
      profileId,
      eventType: 'FEE',
      cashFlowType: cashFlowType as any,
      sourceType,
      sourceId,
      sourceTimestamp: feeAccrual.createdAt ? new Date(feeAccrual.createdAt) : new Date(),
      asset: feeAccrual.currency ?? 'USD',
      amount: feeAccrual.feeAmount?.toString() ?? '0',
      feeAmount: feeAccrual.feeAmount?.toString() ?? '0',
      currency: feeAccrual.currency ?? 'USD',
      feeAccrualId: sourceId,
      baseCurrency: policy.baseCurrency,
      calculationVersion: policy.calculationVersion,
      policyVersion: policy.policyVersion,
      idempotencyKey,
      correlationId,
      metadata: redactSecrets({ feeType: feeAccrual.feeType, sourceId }) as any,
      evidence: redactSecrets({
        feeAccrualId: feeAccrual.id,
        feeAmount: feeAccrual.feeAmount,
        feeType: feeAccrual.feeType,
        source: 'Fees module authoritative',
      }) as any,
    });

    return event;
  }

  async ingestFromFinanceLedger(params: {
    tenantId: string;
    profileId: string;
    ledgerEntry: any;
    cashFlowType: PortfolioCashFlowType;
    correlationId?: string | null;
  }): Promise<any> {
    const { tenantId, profileId, ledgerEntry, cashFlowType, correlationId = null } = params;

    const sourceType = 'FINANCE_LEDGER';
    const sourceId = ledgerEntry.id ?? ledgerEntry.ledgerId ?? `${Date.now()}`;

    const policy = await this.policyService.resolvePolicy({ tenantId, scope: 'TENANT' as any, scopeId: profileId });

    const idempotencyKey = deterministicIdempotencyKey({
      type: `accounting:${sourceType}`,
      tenantId,
      profileId,
      sourceId,
    });

    const event = await this.eventRepo.createEvent({
      tenantId,
      profileId,
      eventType: 'CASH_MOVEMENT',
      cashFlowType: cashFlowType as any,
      sourceType,
      sourceId,
      sourceTimestamp: ledgerEntry.createdAt ? new Date(ledgerEntry.createdAt) : new Date(),
      asset: ledgerEntry.currency ?? ledgerEntry.asset ?? 'USD',
      amount: ledgerEntry.amount?.toString() ?? '0',
      currency: ledgerEntry.currency ?? 'USD',
      financeLedgerId: sourceId,
      baseCurrency: policy.baseCurrency,
      calculationVersion: policy.calculationVersion,
      policyVersion: policy.policyVersion,
      idempotencyKey,
      correlationId,
      metadata: redactSecrets({ cashFlowType, sourceId }) as any,
      evidence: redactSecrets({
        ledgerId: sourceId,
        amount: ledgerEntry.amount,
        source: 'Finance ledger authoritative',
      }) as any,
    });

    return event;
  }

  async ingestFromCopyAllocation(params: {
    tenantId: string;
    profileId: string;
    allocation: any;
    correlationId?: string | null;
  }): Promise<any> {
    const { tenantId, profileId, allocation, correlationId = null } = params;

    const sourceType = 'COPY_ALLOCATION';
    const sourceId = allocation.id;

    const policy = await this.policyService.resolvePolicy({ tenantId, scope: 'TENANT' as any, scopeId: profileId });

    const idempotencyKey = deterministicIdempotencyKey({
      type: `accounting:${sourceType}`,
      tenantId,
      profileId,
      sourceId,
    });

    const event = await this.eventRepo.createEvent({
      tenantId,
      profileId,
      eventType: 'COPY_ALLOCATION',
      sourceType,
      sourceId,
      sourceTimestamp: allocation.createdAt ? new Date(allocation.createdAt) : new Date(),
      asset: allocation.symbol ?? allocation.asset ?? 'UNKNOWN',
      quantity: allocation.executedQuantity ?? allocation.intendedQuantity ?? '0',
      amount: allocation.executedNotional ?? allocation.intendedNotional ?? '0',
      currency: 'USDT',
      copyAllocationId: sourceId,
      baseCurrency: policy.baseCurrency,
      calculationVersion: policy.calculationVersion,
      policyVersion: policy.policyVersion,
      idempotencyKey,
      correlationId,
      metadata: redactSecrets({ traderId: allocation.traderId, followerId: allocation.followerId }) as any,
      evidence: redactSecrets({
        allocationId: allocation.id,
        intendedQty: allocation.intendedQuantity,
        executedQty: allocation.executedQuantity,
        source: 'Copy-trading allocation authoritative',
      }) as any,
    });

    return event;
  }

  async ingestFromPositionSnapshot(params: {
    tenantId: string;
    profileId: string;
    position: any;
    correlationId?: string | null;
  }): Promise<any> {
    const { tenantId, profileId, position, correlationId = null } = params;

    const sourceType = 'POSITION_SNAPSHOT';
    const sourceId = position.id;

    const policy = await this.policyService.resolvePolicy({ tenantId, scope: 'TENANT' as any, scopeId: profileId });

    const idempotencyKey = deterministicIdempotencyKey({
      type: `accounting:${sourceType}`,
      tenantId,
      profileId,
      sourceId,
      timestampBucket: new Date().toISOString().slice(0, 10),
    });

    const event = await this.eventRepo.createEvent({
      tenantId,
      profileId,
      eventType: 'POSITION_SNAPSHOT',
      sourceType,
      sourceId,
      sourceTimestamp: position.updatedAt ? new Date(position.updatedAt) : new Date(),
      asset: position.symbol ?? position.asset,
      quantity: position.quantity?.toString() ?? '0',
      currency: 'USDT',
      baseCurrency: policy.baseCurrency,
      calculationVersion: policy.calculationVersion,
      policyVersion: policy.policyVersion,
      idempotencyKey,
      correlationId,
      metadata: redactSecrets({ symbol: position.symbol, side: position.side }) as any,
      evidence: redactSecrets({
        positionId: position.id,
        quantity: position.quantity,
        side: position.side,
        source: 'Position service authoritative, not rewritten',
      }) as any,
    });

    return event;
  }

  private calculateTradeAmount(quantity: string, price: string | null | undefined): string {
    if (!quantity || !price) return '0';
    try {
      // Decimal-safe string arithmetic, sharing the exact scaled helpers
      // (and the exact SCALE_FACTOR) that portfolio-accounting.types uses,
      // so both sides can never drift apart on scale.
      const q = parseScaled(quantity);
      const p = parseScaled(price);
      const amountScaled = (q * p) / SCALE_FACTOR;
      return formatScaled(amountScaled);
    } catch {
      return '0';
    }
  }
}

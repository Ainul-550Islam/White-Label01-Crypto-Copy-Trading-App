// # Responsibility: maintain portfolio cash accounting from authoritative financial events.
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AccountingEventRepository } from './accounting-event.repository';
import { AccountingPolicyService } from './accounting-policy.service';
import { PortfolioCashFlowType, deterministicIdempotencyKey, add, sub, mul, cmp, isValidDecimal } from './portfolio-accounting.types';

/**
 * Maintains portfolio-level accounting cash movements derived from authoritative deposits,
 * withdrawals, transfers, trading settlement, fees, and other supported financial events.
 * Must never become an independent exchange-balance truth.
 */

@Injectable()
export class CashLedgerService {
  private readonly logger = new Logger(CashLedgerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventRepo: AccountingEventRepository,
    private readonly policyService: AccountingPolicyService,
  ) {}

  async recordCashMovement(params: {
    tenantId: string;
    profileId: string;
    accountingEventId?: string | null;
    cashFlowType: PortfolioCashFlowType;
    asset: string;
    amount: string;
    currency: string;
    occurredAt: Date;
    sourceType?: string | null;
    sourceId?: string | null;
    correlationId?: string | null;
    baseCurrency?: string | null;
    conversionRate?: string | null;
    conversionSource?: string | null;
    conversionStatus?: string | null;
  }): Promise<any> {
    const { tenantId, profileId, accountingEventId = null, cashFlowType, asset, amount, currency, occurredAt, sourceType = null, sourceId = null, correlationId = null } = params;

    if (!isValidDecimal(amount) || cmp(amount, '0') < 0) throw new BadRequestException(`Invalid non-negative amount decimal: ${amount}`);

    const policy = await this.policyService.resolvePolicy({ tenantId, scope: 'TENANT' as any, scopeId: profileId });

    const idempotencyKey = deterministicIdempotencyKey({
      type: `cash:${cashFlowType}`,
      tenantId,
      profileId,
      sourceId: sourceId ?? accountingEventId ?? `${cashFlowType}:${asset}:${amount}:${occurredAt.toISOString()}`,
      timestampBucket: occurredAt.toISOString().slice(0, 10),
    });

    // Idempotency and balance reads are mandatory: never write after an unknown read result.
    const existing = await (this.prisma as any).portfolioCashLedgerEntry.findFirst({ where: { tenantId, idempotencyKey } });
    if (existing) return existing;

    const lastEntry = await (this.prisma as any).portfolioCashLedgerEntry.findFirst({
      where: { tenantId, profileId, asset },
      orderBy: { occurredAt: 'desc' },
    });
    const isOutflow = [PortfolioCashFlowType.WITHDRAWAL, PortfolioCashFlowType.TRANSFER_OUT, PortfolioCashFlowType.FEE, PortfolioCashFlowType.PLATFORM_FEE, PortfolioCashFlowType.PERFORMANCE_FEE, PortfolioCashFlowType.TRADE_SETTLEMENT_BUY].includes(cashFlowType);
    if (!lastEntry && isOutflow && cmp(amount, '0') > 0) {
      throw new BadRequestException('No prior cash-ledger balance is available for this outflow; no movement was recorded.');
    }
    let runningBalance = isOutflow ? sub('0', amount) : amount;
    if (lastEntry) {
      if (typeof lastEntry.runningBalance !== 'string' || !isValidDecimal(lastEntry.runningBalance)) {
        throw new BadRequestException('The previous cash-ledger balance is invalid; no movement was recorded.');
      }
      runningBalance = isOutflow ? sub(lastEntry.runningBalance, amount) : add(lastEntry.runningBalance, amount);
      if (cmp(runningBalance, '0') < 0) throw new BadRequestException('Cash movement would produce a negative ledger balance.');
    }

    const baseCurrency = params.baseCurrency ?? policy.baseCurrency;
    let baseCurrencyAmount: string | null = null;
    if (baseCurrency !== currency && params.conversionRate !== null && params.conversionRate !== undefined) {
      if (!isValidDecimal(params.conversionRate) || cmp(params.conversionRate, '0') <= 0 || !params.conversionSource?.trim()) {
        throw new BadRequestException('A valid positive FX rate and source are required for converted cash movements.');
      }
      baseCurrencyAmount = mul(amount, params.conversionRate);
    } else if (baseCurrency === currency) {
      baseCurrencyAmount = amount;
    }

    const created = await (this.prisma as any).portfolioCashLedgerEntry.create({
      data: {
        tenantId,
        profileId,
        accountingEventId: accountingEventId ?? null,
        cashFlowType: cashFlowType as any,
        asset,
        amount,
        currency,
        runningBalance,
        baseCurrency,
        baseCurrencyAmount,
        conversionRate: params.conversionRate ?? null,
        conversionSource: params.conversionSource ?? null,
        conversionTimestamp: new Date(),
        conversionStatus: params.conversionStatus ?? (baseCurrency === currency ? 'SAME_CURRENCY' : params.conversionRate ? 'CONVERTED' : 'MISSING_FX'),
        sourceType: sourceType ?? null,
        sourceId: sourceId ?? null,
        idempotencyKey,
        calculationVersion: policy.calculationVersion,
        policyVersion: policy.policyVersion,
        correlationId: correlationId ?? null,
        occurredAt,
      },
    });

    this.logger.log({ event: 'portfolio.cash.recorded', tenantId, profileId, cashFlowType, asset, amount });

    return created;
  }

  async getCashBalance(params: {
    tenantId: string;
    profileId: string;
    asset?: string;
    currency?: string;
    at?: Date;
  }): Promise<{ asset: string; balance: string; currency: string; baseCurrency: string; baseCurrencyBalance: string | null }> {
    const { tenantId, profileId, asset, at = new Date() } = params;

    const where: any = { tenantId, profileId, occurredAt: { lte: at } };
      if (asset) where.asset = asset;

      const entries = await (this.prisma as any).portfolioCashLedgerEntry.findMany({
        where,
        orderBy: { occurredAt: 'asc' },
      });

      // Deterministic sum using Decimal-safe arithmetic
      let balance = '0';
      let baseBalance: string | null = null;
      let currency = asset ?? 'USD';
      let baseCurrency = 'USD';

      for (const entry of entries) {
        if (asset && entry.asset !== asset) continue;
        currency = entry.currency;
        baseCurrency = entry.baseCurrency;
        const isOutflow = [PortfolioCashFlowType.WITHDRAWAL, PortfolioCashFlowType.TRANSFER_OUT, PortfolioCashFlowType.FEE, PortfolioCashFlowType.PLATFORM_FEE, PortfolioCashFlowType.PERFORMANCE_FEE, PortfolioCashFlowType.TRADE_SETTLEMENT_BUY].includes(entry.cashFlowType as any);
        balance = isOutflow ? sub(balance, entry.amount) : add(balance, entry.amount);
        if (entry.baseCurrencyAmount) {
          if (baseBalance === null) baseBalance = '0';
          baseBalance = isOutflow ? sub(baseBalance, entry.baseCurrencyAmount) : add(baseBalance, entry.baseCurrencyAmount);
        }
      }

    return { asset: asset ?? 'CASH', balance, currency, baseCurrency, baseCurrencyBalance: baseBalance };
  }

  async listCashEntries(params: {
    tenantId: string;
    profileId: string;
    asset?: string;
    cashFlowType?: string;
    from?: Date;
    to?: Date;
    page?: number;
    limit?: number;
  }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const { tenantId, profileId, asset, cashFlowType, from, to, page = 1, limit = 50 } = params;
    const where: any = { tenantId, profileId };
    if (asset) where.asset = asset;
    if (cashFlowType) where.cashFlowType = cashFlowType;
    if (from || to) {
      where.occurredAt = {};
      if (from) where.occurredAt.gte = from;
      if (to) where.occurredAt.lte = to;
    }

    const [data, total] = await Promise.all([
      (this.prisma as any).portfolioCashLedgerEntry.findMany({
        where,
        orderBy: { occurredAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      (this.prisma as any).portfolioCashLedgerEntry.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async reconcileAgainstExchangeBalance(params: {
    tenantId: string;
    profileId: string;
    exchangeBalance: string;
    asset: string;
  }): Promise<{ matched: boolean; accountingBalance: string; exchangeBalance: string; drift: string }> {
    // Never become independent exchange-balance truth — we compare, not overwrite
    const accounting = await this.getCashBalance({ tenantId: params.tenantId, profileId: params.profileId, asset: params.asset });
    const drift = sub(accounting.balance, params.exchangeBalance);
    const matched = drift === '0';
    return {
      matched,
      accountingBalance: accounting.balance,
      exchangeBalance: params.exchangeBalance,
      drift,
    };
  }
}

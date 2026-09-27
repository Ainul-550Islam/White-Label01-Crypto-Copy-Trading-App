import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AccountingPolicyService } from './accounting-policy.service';
import {
  PortfolioPositionClassification,
  deterministicIdempotencyKey,
  add,
  sub,
  cmp,
  redactSecrets,
  isValidDecimal,
} from './portfolio-accounting.types';

/**
 * Builds accounting views of holdings and position lots from authoritative positions/fills.
 * Must support opening, increasing, reducing, closing, realized/unrealized classification,
 * and lot continuity without changing the authoritative position engine.
 */

@Injectable()
export class PositionAccountingService {
  private readonly logger = new Logger(PositionAccountingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: AccountingPolicyService,
  ) {}

  async openLot(params: {
    tenantId: string;
    profileId: string;
    accountingEventId?: string | null;
    symbol: string;
    asset: string;
    venue?: string | null;
    quantity: string;
    costBasisPerUnit?: string | null;
    currency: string;
    occurredAt: Date;
    correlationId?: string | null;
  }): Promise<any> {
    const { tenantId, profileId, accountingEventId = null, symbol, asset, venue = null, quantity, costBasisPerUnit = null, currency, occurredAt, correlationId = null } = params;

    if (!isValidDecimal(quantity)) throw new BadRequestException(`Invalid quantity: ${quantity}`);
    if (cmp(quantity, '0') <= 0) throw new BadRequestException('Quantity must be > 0');

    const policy = await this.policyService.resolvePolicy({ tenantId, scope: 'TENANT' as any, scopeId: profileId });

    const totalCostBasis = costBasisPerUnit ? this.mulSafe(quantity, costBasisPerUnit) : null;

    const idempotencyKey = deterministicIdempotencyKey({
      type: `position-lot:open:${symbol}`,
      tenantId,
      profileId,
      sourceId: accountingEventId ?? `${symbol}:${quantity}:${occurredAt.toISOString()}`,
      timestampBucket: occurredAt.toISOString().slice(0, 10),
    });

    try {
      const existing = await (this.prisma as any).portfolioPositionLot.findFirst({ where: { idempotencyKey } });
      if (existing) return existing;
    } catch {}

    const lot = await (this.prisma as any).portfolioPositionLot.create({
      data: {
        tenantId,
        profileId,
        accountingEventId: accountingEventId ?? null,
        symbol,
        asset,
        venue: venue ?? null,
        classification: quantity.startsWith('-') ? PortfolioPositionClassification.SHORT : PortfolioPositionClassification.LONG,
        quantity,
        remainingQuantity: quantity,
        costBasisPerUnit: costBasisPerUnit ?? null,
        totalCostBasis: totalCostBasis ?? null,
        currency,
        baseCurrency: policy.baseCurrency,
        costBasisMethod: policy.costBasisMethod,
        calculationVersion: policy.calculationVersion,
        policyVersion: policy.policyVersion,
        isClosed: false,
        openedAt: occurredAt,
        idempotencyKey,
        metadata: redactSecrets({ symbol, venue }) as any,
        evidence: redactSecrets({ quantity, costBasisPerUnit, source: 'Position accounting from authoritative fills' }) as any,
      },
    });

    return lot;
  }

  async reduceLot(params: {
    tenantId: string;
    profileId: string;
    symbol: string;
    quantity: string;
    closingEventId?: string | null;
    occurredAt: Date;
    correlationId?: string | null;
  }): Promise<{ closedLots: any[]; remainingQuantity: string; realizedPnl: string }> {
    const { tenantId, profileId, symbol, quantity, closingEventId = null, occurredAt } = params;

    if (!isValidDecimal(quantity)) throw new BadRequestException(`Invalid quantity: ${quantity}`);

    const policy = await this.policyService.resolvePolicy({ tenantId, scope: 'TENANT' as any, scopeId: profileId });

    // FIFO reduction — deterministic
    const openLots = await (this.prisma as any).portfolioPositionLot.findMany({
      where: { tenantId, profileId, symbol, isClosed: false, isReversed: false },
      orderBy: { openedAt: 'asc' },
    }).catch(() => []);

    let remainingToClose = quantity;
    let totalRealizedPnl = '0';
    const closedLots: any[] = [];

    for (const lot of openLots) {
      if (cmp(remainingToClose, '0') <= 0) break;
      const lotRemaining = lot.remainingQuantity;
      const closeQty = cmp(remainingToClose, lotRemaining) >= 0 ? lotRemaining : remainingToClose;

      // Realized PnL = (closeQty * currentPrice?) — here we calculate as proportional cost basis release, actual PnL calculated in cost-basis service
      // For position accounting, we just reduce remainingQuantity
      const newRemaining = sub(lotRemaining, closeQty);
      const isNowClosed = cmp(newRemaining, '0') === 0;

      const updated = await (this.prisma as any).portfolioPositionLot.update({
        where: { id: lot.id },
        data: {
          remainingQuantity: newRemaining,
          isClosed: isNowClosed,
          closedAt: isNowClosed ? occurredAt : null,
          closingEventId: isNowClosed ? closingEventId : null,
        },
      });

      closedLots.push(updated);
      remainingToClose = sub(remainingToClose, closeQty);
    }

    return { closedLots, remainingQuantity: remainingToClose, realizedPnl: totalRealizedPnl };
  }

  async getHoldings(params: {
    tenantId: string;
    profileId: string;
    at?: Date;
  }): Promise<Array<{ symbol: string; asset: string; quantity: string; classification: string; costBasis: string | null }>> {
    try {
      const where: any = { tenantId: params.tenantId, profileId: params.profileId, isClosed: false, isReversed: false };
      if (params.at) where.openedAt = { lte: params.at };

      const lots = await (this.prisma as any).portfolioPositionLot.findMany({
        where,
        orderBy: { openedAt: 'asc' },
      });

      // Aggregate by symbol — deterministic
      const holdingsMap = new Map<string, { asset: string; quantity: string; classification: string; costBasis: string | null }>();
      for (const lot of lots) {
        const existing = holdingsMap.get(lot.symbol);
        if (!existing) {
          holdingsMap.set(lot.symbol, {
            asset: lot.asset,
            quantity: lot.remainingQuantity,
            classification: lot.classification,
            costBasis: lot.totalCostBasis,
          });
        } else {
          existing.quantity = add(existing.quantity, lot.remainingQuantity);
          if (existing.costBasis && lot.totalCostBasis) {
            existing.costBasis = add(existing.costBasis, lot.totalCostBasis);
          } else if (lot.totalCostBasis) {
            existing.costBasis = lot.totalCostBasis;
          }
        }
      }

      return Array.from(holdingsMap.entries()).map(([symbol, data]) => ({
        symbol,
        asset: data.asset,
        quantity: data.quantity,
        classification: data.classification,
        costBasis: data.costBasis,
      }));
    } catch {
      return [];
    }
  }

  async listLots(params: {
    tenantId: string;
    profileId: string;
    symbol?: string;
    isClosed?: boolean;
    page?: number;
    limit?: number;
  }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const { tenantId, profileId, symbol, isClosed, page = 1, limit = 50 } = params;
    const where: any = { tenantId, profileId };
    if (symbol) where.symbol = symbol;
    if (isClosed !== undefined) where.isClosed = isClosed;

    try {
      const [data, total] = await Promise.all([
        (this.prisma as any).portfolioPositionLot.findMany({
          where,
          orderBy: { openedAt: 'asc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        (this.prisma as any).portfolioPositionLot.count({ where }),
      ]);
      return { data, total, page, limit };
    } catch {
      return { data: [], total: 0, page, limit };
    }
  }

  private mulSafe(a: string, b: string): string {
    try {
      const { mul } = require('./portfolio-accounting.types');
      return mul(a, b);
    } catch {
      return '0';
    }
  }
}
